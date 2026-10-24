// Remote player avatars for every occupied slot on another screen. Movement is local to its owner;
// this screen renders a 100 ms interpolation buffer (80 ms maximum extrapolation).
import { Player } from '../player/player.js';
import { PlayerVisuals } from '../players/playerVisuals.js';
import { PLAYER_COLORS, PLAYER_PUSH_RADIUS } from '../config.js';
import { PoseBuffer, encodePose, decodePose } from './poseBuffer.js';
import { decodeHatId } from '../game/hatLogic.js';
import { decodeTailId } from '../game/tailLogic.js';
import { decodeGarlandId } from '../game/garlandLogic.js';
import { decodePetId } from '../game/petLogic.js';
import { unpackPageBits } from '../game/pageCoopLogic.js';
import { partyHatKey } from '../player/partyHats.js';
import { botByName } from '../game/party/botRoster.js';
import { attachVariant, normaliseVariant } from '../player/characterVariants.js';

export class Avatars {
  constructor({ scene, hudRoot, players, table, sync, items, sfx }) {
    Object.assign(this, { scene, players, table, sync, items, sfx });
    this.visuals = new PlayerVisuals(hudRoot);
    this.remote = new Map(); // slot -> { player, buffer, lastFlags, item }
    this.sendT = 0;
    this.poseSeq = 0;
    this.bytesUp = 0;
    this.sendSeconds = 0;
    this.cinematic = false;
    sync.on('poses', (screen, poses) => {
      const at = performance.now();
      for (const wire of poses) {
        const pose = decodePose(wire);
        if (!pose) continue;
        const owner = this.table.get(pose.slot)?.screen;
        if (!owner || owner === this.sync.screenId || (screen !== 'snapshot' && owner !== screen)) continue;
        this._ensure(pose.slot, owner).buffer.push(pose, at);
      }
    });
    sync.on('snapshot', () => this.reconcile());
  }

  get list() { return [...this.remote.values()].map((r) => r.player); }
  get(slot) { return this.remote.get(slot)?.player || null; }
  get upstreamBpsPerPlayer() { return this.sendSeconds ? Math.round(this.bytesUp / this.sendSeconds / Math.max(1, this.players.count)) : 0; }
  setCinematic(on) { this.cinematic = !!on; }

  _ensure(slot, screen) {
    let r = this.remote.get(slot);
    if (r && r.player.screen === screen) return r;
    if (r) this._remove(slot);
    const player = new Player(this.scene, { colors: { ...PLAYER_COLORS[slot] }, index: slot });
    player.screen = screen;
    player.device = 'screen';
    player.frozen = false;
    player.leaving = 0;
    player.away = false;
    player.root.visible = false; // wait for the first pose (or a shared feast)
    this.visuals.attach(player);
    r = { player, buffer: new PoseBuffer(), lastFlags: 0, item: null, lastAt: 0, variant: 'original', variantCleanup: null };
    this.remote.set(slot, r);
    return r;
  }

  _remove(slot) {
    const r = this.remote.get(slot);
    if (!r) return;
    if (r.item?.pivot.parent === r.player.parts.handSocket) { r.item.pivot.removeFromParent(); r.item.pivot.visible = false; }
    this.visuals.detach(r.player);
    r.variantCleanup?.();
    r.player.dispose();
    this.remote.delete(slot);
  }

  reconcile() {
    const me = this.sync.screenId;
    this.table.slots.forEach((entry, slot) => {
      if (entry && entry.screen !== me) {
        const r = this._ensure(slot, entry.screen);
        r.player.away = !!entry.away;
        if (entry.bot && !r.player.bot) { r.player.bot = true; const b = botByName(entry.name); if (b) r.player.setColors({ ...b.colors, name: b.name }); }       // Step 80a: a party bot on the host screen: that Tdoong's colours and name
        else if (!entry.bot && r.player.bot) { r.player.bot = false; r.player.setColors({ ...PLAYER_COLORS[slot] }); }
        this.visuals.setAway(r.player, r.player.away);
      } else this._remove(slot);
    });
  }

  _publish(dt) {
    this.sendT += dt;
    this.sendSeconds += dt;
    if (this.sendT < 1 / 15 || (this.sync.isReplica && this.sync.status !== 'synced')) return;
    this.sendT %= 1 / 15;
    const seq = this.poseSeq = (this.poseSeq + 1) % 65536;
    const poses = this.players.list.map((p) => encodePose(p, this.hideHeld ? -1 : (this.items.heldBy(p)?.id ?? -1), seq));      // (hideHeld: the tools are tucked away while a party runs, Step 80a)
    if (!poses.length) return;
    const packet = JSON.stringify({ type: 'poses', p: poses });
    this.bytesUp += packet.length;
    this.sync.publishPoses(poses);
  }

  _held(r, itemId) {
    const rec = this.items.list[itemId];
    const wanted = !r.player._pageTool && rec?.state === 'remote' && rec.holderKey === `${r.player.screen}:${r.player.index}` ? rec : null;   // (a storybook page tool hides the real item: items.setPageTool)
    if (r.item && r.item !== wanted && r.item.pivot.parent === r.player.parts.handSocket) {
      r.item.pivot.removeFromParent(); r.item.pivot.visible = false;
    }
    r.item = wanted;
    r.player.holding = !!wanted || !!r.player._pageTool;
    if (wanted && wanted.pivot.parent !== r.player.parts.handSocket) {
      r.player.parts.handSocket.add(wanted.pivot);
      wanted.pivot.position.set(0, 0, 0);
      wanted.pivot.quaternion.identity();
      wanted.pivot.scale.setScalar(1);
      wanted.model.position.y = 0;
      wanted.pivot.visible = true;
      wanted.model.userData.setBlade?.(1);
    }
  }

  /** Cosmetic identity is owner-controlled pose data, not shared-world authority. Build only on a change. */
  _appearance(r, pose) {
    const variant = normaliseVariant(pose.variant);
    if (variant === r.variant) return;
    r.variantCleanup?.();
    r.variantCleanup = attachVariant(r.player.character, variant);
    r.variant = variant;
    r.player.characterVariant = variant;
  }

  update(dt, camera) {
    if (!this.cinematic) this._publish(dt);
    const now = performance.now();
    for (const r of this.remote.values()) {
      const p = r.player;
      if (this.cinematic) { p.root.visible = true; continue; }
      const pose = r.buffer.sample(now);
      if (!pose) continue;
      this._appearance(r, pose);
      const dist = Math.hypot(pose.x - this.players.focus.x, pose.z - this.players.focus.z);
      const near = dist < 48;
      p.root.visible = near;
      if (!near) { p.position.set(pose.x, pose.y, pose.z); continue; }
      if ((pose.flags & 2) && !(r.lastFlags & 2)) {
        p.swing();
        if (dist < 20) this.sfx?.play('whoosh', { vol: 0.35 });
      }
      if ((pose.flags & 4) && !(r.lastFlags & 4)) p.hop();
      const pb = unpackPageBits(pose.pbits);                                 // storybook page poses (Step 51): carrying / carried / twirl / the puff kind
      if (pb.carryObj || pb.carryFriend) p.setPose([-2.7, -0.15, 0, 0]);
      else if (pb.carried) p.setPose([-2.4, 0.5, 0, 0]);
      else if (pb.vine) p.setPose([-3.1, 0, 0, 0]);                          // Step 53a: hanging on a vine
      else if (pose.flags & 8) p.setPose([-0.8, -0.2, 0, 0]); else p.setPose(null);
      p.spinAdd = pb.twirl ? ((now / 1000) % 0.35) / 0.35 * Math.PI * 2 * 1.6 : 0;
      p._puffKind = pb.puff; p._sled = pb.sled; p._duck = pb.duck; p._vine = pb.vine; p._cannon = pb.cannon;                     // (Step 52b: the sled under a remote rider: world/pageSnowVisuals.js)
      const earKey = partyHatKey(pose.hat);                                 // Step 80a: a party bot's ears (hat ids 64+)
      if (earKey) p.wearPartyHat(earKey);
      else {
      if (p.partyHat) p.wearPartyHat(null);
      const hat = decodeHatId(pose.hat);                                    // null = bare head, -1 = beanie, 0..9 = feast hat (built once per change, see Player.wearHat)
      if (hat === null) { if (p.character.hat) p.setHat(null); }
      else p.wearHat(hat);
      }
      p.wearGarland(decodeGarlandId(pose.garland));
      p.petIndex = decodePetId(pose.pet);                                    // Step 73a: which pet this avatar brings (world/pets.js builds and moves it locally)
      p.wearTail(decodeTailId(pose.tail));                                  // -1 = none (the model is built once per change and cached on the avatar, like the hat)
      this._held(r, pose.held);
      p.updateRemote(dt, pose, dist < 20);
      r.lastFlags = pose.flags;
      r.lastAt = now;
    }
    this.visuals.update(dt, camera, { multi: true });
  }

  /** Local bodies are displaced by nearby remote bodies, but remote authority is never moved here. */
  separateLocal(dt) {
    if (this.cinematic) return;
    const k = Math.min(1, 14 * dt) * 0.5;
    for (const local of this.players.list) for (const { player: remote, buffer } of this.remote.values()) {
      if (!buffer.samples.length || !remote.root.visible || remote.away) continue;
      if ((local.partyLayer || remote.partyLayer) && local.partyLayer !== remote.partyLayer) continue;
      const dx = local.position.x - remote.position.x, dz = local.position.z - remote.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.01 || d >= PLAYER_PUSH_RADIUS) continue;
      const push = (PLAYER_PUSH_RADIUS - d) * k;
      local.nudge(dx / d * push, dz / d * push);
    }
  }
}
