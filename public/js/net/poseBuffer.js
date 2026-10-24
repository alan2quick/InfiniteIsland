// Compact pose wire format (15 packets/s, normally under 1 KB/s/player upstream):
// [slot, x*100, z*100, y*100, facing*1000, vx*10, vz*10, flags, heldItemId, hatId, seq, tailId, garlandId, pageBits, pageTool, petId, variantId?].
// Flags: walking=1, swing=2, hop=4, steady pose/cook=8, rising in a storybook page=16, falling in a page=32, dandelion puff=64, held sail glide=128 (Step 68b; real y carries the descent; only the canopy needs this flag), fishing line out=256 (Step 72a: the Glowline Rod is cast; avatars draw a bobber and line from the facing, world/fishingPlay.js). (Step 49; y is always sent, so page jumps show on other screens). Hat 0 = default beanie, 1 = bare head, 2 + i = feast hat HATS[i] (game/hatLogic.js), 64 + i = a party bot's ears (Step 80a, player/partyHats.js).
// tailId (Step 36b, field 12; older clients ignore it, packets without it decode as no tail): 0 = no tail, 1 + i = TAILS[i] (game/tailLogic.js).
// garlandId (Step 40, field 13): 0 = none, 1 + index; older 12-field packets imply none.
// pageBits (Step 51, field 14; older packets decode as 0): the storybook-page poses a remote avatar shows: 1 carrying an object, 2 carrying a friend, 4 being carried, 8 twirling, bits 4-5 the puff kind
// (0 none, 1 pit, 2 hearts, 3 lost); petId (Step 73a, field 16; older packets decode as none): 0 = no pet, 1 + i = PET_IDS[i] (game/petLogic.js); pageTool (field 15): 0 none, 1 axe, 2 hammer, 3 shovel, 4 sword (game/pageCoopLogic.js). A puffed player's x / y are the puff's place, so friends on other screens can pop it.
import { encodeHatId, HAT_BARE_ID } from '../game/hatLogic.js';
import { encodeTailId } from '../game/tailLogic.js';
import { encodeGarlandId } from '../game/garlandLogic.js';
import { encodePetId } from '../game/petLogic.js';
import { partyHatId } from '../player/partyHats.js';
// Optional field 17 keeps original-character packets byte-for-byte compatible. Unknown IDs safely use the original.
const VARIANT_IDS = ['original', 'rowan', 'pip', 'marlow', 'clover', 'sunny'];
export const encodeVariantId = (id) => Math.max(0, VARIANT_IDS.indexOf(id));
export const decodeVariantId = (id) => Number.isInteger(id) && id >= 0 && id < VARIANT_IDS.length ? VARIANT_IDS[id] : 'original';
const q = (v, scale) => Math.round((Number(v) || 0) * scale);
export function encodePose(player, held = -1, seq = 0) {
  const p = player.position;
  const packet = [player.index, q(p.x, 100), q(p.z, 100), q(p.y, 100), q(player.facing, 1000),
    q(player.velocity.x, 10), q(player.velocity.z, 10),
    (player.moving ? 1 : 0) | (player.swinging ? 2 : 0) | (player._hopY > 0 ? 4 : 0) | (player._pose ? 8 : 0) | (player._air === 1 ? 16 : player._air === 2 ? 32 : 0) | (player._puff ? 64 : 0) | (player._gliding ? 128 : 0) | (player._lineOut ? 256 : 0),
    held, player.partyHat ? partyHatId(player.partyHat) : player.character.hat ? encodeHatId(player.hatIndex ?? -1) : HAT_BARE_ID, seq, encodeTailId(player.tailIndex ?? -1), encodeGarlandId(player.garlandIndex ?? -1),
    player._pageBits | 0, player._pageToolCode | 0, encodePetId(player.petIndex ?? -1)];
  const variant = encodeVariantId(player.characterVariant);
  if (variant) packet.push(variant);
  return packet;
}
export function decodePose(p) {
  if (!Array.isArray(p) || p.length < 10 || !p.every(Number.isFinite)) return null;
  return { slot: p[0] | 0, x: p[1] / 100, z: p[2] / 100, y: p[3] / 100, facing: p[4] / 1000,
    vx: p[5] / 10, vz: p[6] / 10, flags: p[7] | 0, held: p[8] | 0, hat: p[9] | 0, seq: Number.isInteger(p[10]) ? p[10] : null, tail: Number.isInteger(p[11]) ? p[11] : 0, garland: Number.isInteger(p[12]) ? p[12] : 0,
    pbits: Number.isInteger(p[13]) ? p[13] : 0, ptool: Number.isInteger(p[14]) ? p[14] : 0, pet: Number.isInteger(p[15]) ? p[15] : 0, variant: decodeVariantId(p[16]) };
}
const lerp = (a, b, k) => a + (b - a) * k;
const angle = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class PoseBuffer {
  constructor(delayMs = 100) { this.delayMs = delayMs; this.samples = []; }
  push(pose, at) {
    const p = Array.isArray(pose) ? decodePose(pose) : pose;
    if (!p) return false;
    const last = this.samples.at(-1);
    if (last && p.seq !== null && last.p.seq !== null) {
      const diff = (p.seq - last.p.seq + 65536) % 65536;
      if (diff === 0 || diff > 32768) return false;
    }
    if (last && Math.hypot(last.p.x - p.x, last.p.z - p.z) > 6) this.samples.length = 0; // teleport
    this.samples.push({ p, at });
    if (this.samples.length > 5) this.samples.shift();
    return true;
  }
  sample(now) {
    const list = this.samples;
    if (!list.length) return null;
    const target = now - this.delayMs;
    while (list.length > 2 && list[1].at <= target) list.shift();
    const a = list[0], b = list[1];
    if (b && target >= a.at && target <= b.at) {
      const k = Math.min(1, Math.max(0, (target - a.at) / Math.max(1, b.at - a.at)));
      return { ...b.p, x: lerp(a.p.x, b.p.x, k), z: lerp(a.p.z, b.p.z, k), y: lerp(a.p.y, b.p.y, k), facing: a.p.facing + angle(a.p.facing, b.p.facing) * k };
    }
    const p = target < a.at ? a.p : list.at(-1).p;
    const age = Math.min(0.08, Math.max(0, (target - list.at(-1).at) / 1000));
    return { ...p, x: p.x + p.vx * age, z: p.z + p.vz * age };
  }
}
