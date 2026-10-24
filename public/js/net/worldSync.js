// WorldSync (PLAN Step 22): host-authoritative replication of the shared world. PURE LOGIC: no three.js, no DOM, no network
// code of its own (a transport adapter is plugged in), so it is unit-tested in Node (test/worldSync.test.js).
//
// Roles
//   'host'     owns the world. Every page is a host by default (today's single-screen game). `sync.request()` runs the domain's
//              handleRequest synchronously, exactly the old code path; `sync.emit()` is a no-op while no replica is connected.
//   'replica'  (`?join=CODE`) renders the world and has its own local players but never changes shared state by itself: it
//              sends requests to the host and applies the host's events / snapshots.
//
// Domains: a world system (inventory, items, pickups, later harvest ...) registers one object:
//   sync.register('items', {
//     snapshot()                       -> JSON of the complete authoritative state (sent to a joining replica)
//     applySnapshot(json)              replica: replace local state with it (instantly, no animations)
//     applyEvent(kind, data)           replica (AND host, via its own code): mirror one change, playing the animation
//     handleRequest(kind, data, actor, screenId) host: validate + perform (screenId = the requesting screen, 'host' for the host itself); call sync.emit(...) for every change replicas must mirror.
//                                      return true | { reject: 'reason' } | { result: any }
//     hashView()        (optional)     JSON used by hash() instead of snapshot() (leave out cosmetic / physics-dependent data)
//     screenLeft(screenId) (optional)  host: a screen stayed away past the grace period (drop what its actors hold ...)
//   });
//
// Messages (plain JSON, reliable + ordered transport):
//   replica -> host   {type:'request', id, domain, kind, data, actor}        {type:'resync'}
//   host -> replica   {type:'snapshot', seq, screenId, domains:{name: json}}  sent on connect and on {type:'resync'}
//                     {type:'event', seq, domain, kind, data}                 broadcast to ALL replicas, `seq` is gapless
//                     {type:'ack', id, result?}  |  {type:'reject', id, reason}   answer to the requester only (after the event)
// Events carry everything needed to replay the change identically (ids, positions, velocities, random outcomes decided by the host).
// A replica applies events in order, ignores stale ones (seq <= last), and on a gap drops events and asks for a fresh snapshot.
//
// Actors: a player anywhere is { screen: 'host' | '<screenId>', index, pos:{x,y,z} }. `actorKey(a)` = "screen:index". The host assigns a
// screenId to each connecting screen (stable for a clientId: a reload within the grace period gets the same id back). Requests carry the
// actor's current position so the host can range-check it (trusted for now); the host keeps `sync.actors` (last known remote positions).

export const GRACE_S = 10;            // a disconnected screen keeps its actors (held items ...) this long; same as DISCONNECT_GRACE_S
export const REQUEST_TIMEOUT_MS = 8000;   // a replica request with no answer after this much WALL-CLOCK time resolves { ok:false, reason:'timeout' }
const wallClock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export const actorKey = (a) => (a ? `${a.screen}:${a.index}` : '');
export const isHostActor = (a) => !!a && a.screen === 'host';
const r3 = (v) => Math.round(v * 1000) / 1000;

/** JSON.stringify with sorted keys (stable for hashing / comparing snapshots). */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/** 32-bit FNV-1a as 8 hex digits: short and good enough to compare two worlds in a test. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export class WorldSync {
  /** @param {{role?: 'host'|'replica', graceSeconds?: number}} [o] */
  constructor({ role = 'host', graceSeconds = GRACE_S, now = wallClock, wallNow = Date.now, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.role = role;
    this._now = now;                                    // injectable clock (ms) so tests stay deterministic
    this._wallNow = wallNow;
    this.timeoutMs = timeoutMs;
    this.graceSeconds = graceSeconds;
    this.screenId = role === 'host' ? 'host' : null;   // replica: assigned by the snapshot
    this.domains = new Map();
    this.seq = 0;                                       // host: last event seq sent. replica: last event seq applied
    this.actors = new Map();                            // host: actorKey -> { screen, index, pos, at } of REMOTE actors (last request)
    this.stats = { requests: 0, rejects: 0, events: 0, snapshots: 0, resyncs: 0, stale: 0, gaps: 0 };
    this._handlers = {};
    // host side
    this._out = null;                                   // { sendTo(tid, msg), broadcast(msg) }
    this._screens = new Map();                          // screenId -> { tid, clientId }
    this._byTid = new Map();                            // transport id -> screenId
    this._clients = new Map();                          // clientId -> screenId (kept through the grace period)
    this._grace = new Map();                            // screenId -> seconds left
    this._screenCount = 0;
    this._poses = new Map();                            // global slot -> last compact pose (ephemeral, excluded from world hashes)
    this._poseOwners = new Map();
    this.hostAway = false;
    this.clockOffset = 0;                               // replica: host wall-clock milliseconds minus local wall clock
    this.clockRtt = Infinity;
    this._pingAt = 0;
    this._pingId = 0;
    // replica side
    this._send = null;                                  // (msg) => bool
    this.status = role === 'host' ? 'host' : 'offline';   // replica: 'offline' | 'connecting' (awaiting the snapshot) | 'synced'
    this._reqId = 0;
    this._pending = new Map();                          // id -> { resolve, age }
    this._resyncing = false;
  }

  get isHost() { return this.role === 'host'; }
  get isReplica() { return this.role === 'replica'; }
  /** Host only: true while at least one replica is connected (callers may skip building event payloads otherwise). */
  get hasReplicas() { return this._screens.size > 0; }
  get connectedScreens() { return [...this._screens.keys()]; }
  hostNow() { return this._wallNow() + (this.isReplica ? this.clockOffset : 0); }

  /** Compact local poses, sent at ~15 Hz by the avatar system. These never consume a world-event sequence number. */
  publishPoses(poses) {
    if (!Array.isArray(poses) || !poses.length) return false;
    if (this.isReplica) return this.status === 'synced' && !!this._send && this._send({ type: 'poses', p: poses });
    for (const p of poses) { this._poses.set(p[0], p); this._poseOwners.set(p[0], 'host'); }
    if (this.hasReplicas && this._out) this._out.broadcast({ type: 'poses', screen: 'host', p: poses });
    return true;
  }

  /** Host visibility fallback: every replica pauses its simulation until the host returns. */
  setHostAway(away) {
    if (!this.isHost || this.hostAway === !!away) return;
    this.hostAway = !!away;
    if (this.hasReplicas && this._out) this._out.broadcast({ type: 'host-away', away: this.hostAway });
    this._fire('host-away', this.hostAway);
  }

  /**
   * Host: is any REMOTE actor's last reported position within `d` of (x, z)? Poses keep positions fresh; requests also update them.
   * Entries older than `maxAgeS` wall-clock seconds are ignored: a disconnected player must not block a
   * regrowth or a respawn forever.
   */
  remoteActorNear(x, z, d, maxAgeS = 30) {
    const now = Date.now();
    for (const a of this.actors.values()) {
      if (now - (a.ts || 0) > maxAgeS * 1000) continue;
      if (Math.hypot(a.pos.x - x, a.pos.z - z) < d) return true;
    }
    return false;
  }

  on(type, fn) { (this._handlers[type] ||= []).push(fn); return this; }
  _fire(type, ...args) {
    for (const fn of this._handlers[type] || []) {
      try { fn(...args); } catch (err) { console.error(`WorldSync handler (${type}):`, err); }
    }
  }

  register(name, domain) {
    this.domains.set(name, domain);
    return this;
  }

  /** An actor object for a local player: { screen, index, pos }. Pass it to request() so the host can range-check. */
  actorFor(player) {
    const p = player.position;
    return { screen: this.screenId, index: player.index, pos: { x: r3(p.x), y: r3(p.y), z: r3(p.z) } };
  }

  // ------------------------------------------------------------------ requests
  /**
   * Ask for a world change. HOST: runs the domain's handleRequest right now (no serialization, no round trip) and returns
   * { ok, reason?, result? }. REPLICA: sends it to the host and returns a Promise of the same shape (resolved by ack / reject).
   */
  request(domain, kind, data = {}, actor = null) {
    this.stats.requests++;
    if (this.role === 'host') return this._handle(domain, kind, data, actor, 'host');
    return new Promise((resolve) => {
      if (this.status !== 'synced' || !this._send) { this.stats.rejects++; resolve({ ok: false, reason: 'offline' }); return; }
      const id = ++this._reqId;
      this._pending.set(id, { resolve, at: this._now() });
      const msg = { type: 'request', id, domain, kind, data, actor: actor ? { screen: actor.screen, index: actor.index, pos: actor.pos } : null };
      if (!this._send(msg)) { this._pending.delete(id); this.stats.rejects++; resolve({ ok: false, reason: 'offline' }); }
    });
  }

  _handle(domain, kind, data, actor, screenId = 'host') {
    const d = this.domains.get(domain);
    if (!d || !d.handleRequest) return { ok: false, reason: 'unknown-domain' };
    let r;
    try { r = d.handleRequest(kind, data, actor, screenId); } catch (err) { console.error(`WorldSync ${domain}.${kind}:`, err); return { ok: false, reason: 'error' }; }
    if (r === true) return { ok: true };
    if (r && typeof r === 'object' && 'result' in r) return { ok: true, result: r.result };
    if (r && typeof r === 'object' && r.reject) { this.stats.rejects++; return { ok: false, reason: String(r.reject) }; }
    this.stats.rejects++;
    return { ok: false, reason: 'rejected' };
  }

  // ------------------------------------------------------------------ events (host)
  /** Host: broadcast a state change to every replica. No-op (no serialization) when none is connected or on a replica. */
  emit(domain, kind, data = {}) {
    if (this.role !== 'host' || !this._screens.size || !this._out) return false;
    this.stats.events++;
    this._out.broadcast({ type: 'event', seq: ++this.seq, domain, kind, data });
    return true;
  }

  // ------------------------------------------------------------------ host transport adapter
  /** @param {{sendTo(tid, msg): any, broadcast(msg): any}} out */
  attachHost(out) { this._out = out; return this; }

  /** A replica's connection opened. `meta.clientId` is its stable identity (same clientId = same screen after a reload). */
  screenConnected(tid, meta = {}) {
    if (this.role !== 'host') return null;
    const clientId = meta && meta.clientId ? String(meta.clientId) : null;
    let screenId = clientId ? this._clients.get(clientId) : null;
    if (!screenId) screenId = 's' + (++this._screenCount);
    const old = this._screens.get(screenId);
    if (old && old.tid !== tid) this._byTid.delete(old.tid);          // the same screen came back before we noticed it left
    this._screens.set(screenId, { tid, clientId });
    this._byTid.set(tid, screenId);
    if (clientId) this._clients.set(clientId, screenId);
    this._grace.delete(screenId);
    this._sendSnapshot(screenId);
    this._fire('screen-connected', screenId);
    return screenId;
  }

  screenDisconnected(tid) {
    const screenId = this._byTid.get(tid);
    if (!screenId) return;
    this._byTid.delete(tid);
    const s = this._screens.get(screenId);
    if (!s || s.tid !== tid) return;                                  // already replaced by a newer connection
    this._screens.delete(screenId);
    this._grace.set(screenId, this.graceSeconds);
    this._fire('screen-disconnected', screenId);
  }

  screenMessage(tid, msg) {
    if (this.role !== 'host' || !msg || typeof msg !== 'object') return;
    const screenId = this._byTid.get(tid);
    if (!screenId) return;
    switch (msg.type) {
      case 'request': {
        const actor = msg.actor && typeof msg.actor === 'object'
          ? { screen: screenId, index: Number(msg.actor.index) | 0, pos: sanitizePos(msg.actor.pos) }   // the screen part is never taken from the client
          : null;
        if (actor) this.actors.set(actorKey(actor), { screen: screenId, index: actor.index, pos: actor.pos, at: this.seq, ts: Date.now() });
        const r = this._handle(String(msg.domain), String(msg.kind), msg.data && typeof msg.data === 'object' ? msg.data : {}, actor, screenId);
        this._out.sendTo(tid, r.ok ? { type: 'ack', id: msg.id, result: r.result } : { type: 'reject', id: msg.id, reason: r.reason });
        break;
      }
      case 'resync': this.stats.resyncs++; this._sendSnapshot(screenId); break;
      case 'poses': {
        const slots = this.domains.get('players')?.snapshot?.() || [];
        const poses = Array.isArray(msg.p) ? msg.p.filter((p) => Array.isArray(p) && p.length >= 10 && p.length <= 17 && Number.isInteger(p[0]) && slots[p[0]]?.screen === screenId && p.every(Number.isFinite)) : [];
        for (const p of poses) {
          this._poses.set(p[0], p);
          this._poseOwners.set(p[0], screenId);
          this.actors.set(`${screenId}:${p[0]}`, { screen: screenId, index: p[0], pos: { x: p[1] / 100, y: p[3] / 100, z: p[2] / 100 }, ts: this._wallNow() });
        }
        if (poses.length) { this._out.broadcast({ type: 'poses', screen: screenId, p: poses }); this._fire('poses', screenId, poses); }
        break;
      }
      case 'clock-ping': this._out.sendTo(tid, { type: 'clock-pong', id: msg.id, sent: msg.sent, host: this._wallNow() }); break;
      default: break;
    }
  }

  _sendSnapshot(screenId) {
    const s = this._screens.get(screenId);
    if (!s || !this._out) return;
    this.stats.snapshots++;
    const slots = this.domains.get('players')?.snapshot?.() || [];
    const poses = [...this._poses].filter(([slot]) => slots[slot]?.screen === this._poseOwners.get(slot)).map(([, p]) => p);
    this._out.sendTo(s.tid, { type: 'snapshot', seq: this.seq, screenId, domains: this._snapshots(), poses, hostAway: this.hostAway, hostTime: this._wallNow() });
  }

  _snapshots() {
    const out = {};
    for (const [name, d] of this.domains) if (d.snapshot) out[name] = d.snapshot();
    return out;
  }

  /**
   * Advance timers. Call once per tick with the simulation dt. Grace periods count simulation time; request timeouts count WALL-CLOCK time
   * (a replica stepped faster than real time must not give up on a request the host is about to answer). A late ack / reject / event after a
   * timeout finds no pending entry and is ignored by the requester (the event still updates the world; nothing is applied twice).
   */
  update(dt) {
    if (this._grace.size) {
      for (const [screenId, left] of [...this._grace]) {
        if (left - dt > 0) { this._grace.set(screenId, left - dt); continue; }
        this._grace.delete(screenId);
        for (const [clientId, sid] of this._clients) if (sid === screenId) this._clients.delete(clientId);
        for (const d of this.domains.values()) {                        // (the actors table still has their last positions here)
          try { if (d.screenLeft) d.screenLeft(screenId); } catch (err) { console.error('WorldSync screenLeft:', err); }
        }
        for (const [key, a] of this.actors) if (a.screen === screenId) this.actors.delete(key);
        for (const [slot, owner] of this._poseOwners) if (owner === screenId) { this._poses.delete(slot); this._poseOwners.delete(slot); }
        this._fire('screen-left', screenId);
      }
    }
    if (this._pending.size) {
      const now = this._now();
      for (const [id, p] of [...this._pending]) {
        if (now - p.at > this.timeoutMs) { this._pending.delete(id); this.stats.rejects++; p.resolve({ ok: false, reason: 'timeout' }); }
      }
    }
    if (this.isReplica && this.status === 'synced' && this._send && this._wallNow() >= this._pingAt) {
      const sent = this._wallNow();
      this._send({ type: 'clock-ping', id: ++this._pingId, sent });
      this._pingAt = sent + 5000;
    }
  }

  // ------------------------------------------------------------------ replica transport adapter
  /** @param {{send(msg): boolean}} out */
  attachReplica(out) { this._send = (m) => out.send(m); return this; }

  /** The link to the host is usable: wait for the host's snapshot (sent automatically on connect). */
  linkUp() {
    if (this.role !== 'replica') return;
    this.status = 'connecting';
    this._resyncing = false;
    this._fire('status', this.status);
  }

  /** The link dropped: keep the world as it is (frozen) and fail pending requests. */
  linkDown() {
    if (this.role !== 'replica') return;
    this.status = 'offline';
    this._resyncing = false;
    for (const [id, p] of [...this._pending]) { this._pending.delete(id); p.resolve({ ok: false, reason: 'offline' }); }
    this._fire('status', this.status);
  }

  receive(msg) {
    if (this.role !== 'replica' || !msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'snapshot': {
        this.screenId = msg.screenId;
        this.hostAway = !!msg.hostAway;
        if (Number.isFinite(msg.hostTime)) this.clockOffset = msg.hostTime - this._wallNow();
        for (const [name, json] of Object.entries(msg.domains || {})) {
          const d = this.domains.get(name);
          if (d && d.applySnapshot) { try { d.applySnapshot(json); } catch (err) { console.error(`WorldSync ${name}.applySnapshot:`, err); } }
        }
        this.seq = msg.seq | 0;
        this._resyncing = false;
        this.stats.snapshots++;
        const first = this.status !== 'synced';
        this.status = 'synced';
        if (first) this._fire('status', this.status);
        this._fire('snapshot');
        this._fire('poses', 'snapshot', Array.isArray(msg.poses) ? msg.poses : []);
        this._fire('host-away', this.hostAway);
        break;
      }
      case 'event': {
        if (this.status !== 'synced' || this._resyncing) return;      // waiting for a snapshot: anything else is stale
        if (msg.seq <= this.seq) { this.stats.stale++; return; }
        if (msg.seq !== this.seq + 1) {                                // a message got lost: start over from a snapshot
          this.stats.gaps++;
          this._resyncing = true;
          if (this._send) this._send({ type: 'resync' });
          return;
        }
        this.seq = msg.seq;
        this.stats.events++;
        const d = this.domains.get(msg.domain);
        if (d && d.applyEvent) { try { d.applyEvent(msg.kind, msg.data || {}); } catch (err) { console.error(`WorldSync ${msg.domain}.${msg.kind}:`, err); } }
        break;
      }
      case 'ack': case 'reject': {
        const p = this._pending.get(msg.id);
        if (!p) return;
        this._pending.delete(msg.id);
        if (msg.type === 'ack') p.resolve({ ok: true, result: msg.result });
        else { this.stats.rejects++; p.resolve({ ok: false, reason: msg.reason || 'rejected' }); }
        break;
      }
      case 'poses': if (this.status === 'synced') this._fire('poses', msg.screen, Array.isArray(msg.p) ? msg.p : []); break;
      case 'host-away': this.hostAway = !!msg.away; this._fire('host-away', this.hostAway); break;
      case 'clock-pong': {
        if (this.status !== 'synced' || !Number.isFinite(msg.host) || !Number.isFinite(msg.sent)) break;
        const now = this._wallNow();
        const rtt = Math.max(0, now - msg.sent);
        if (rtt > 500) { this._pingAt = Math.min(this._pingAt, now + 1000); break; } // background/compile stall: midpoint would be misleading
        const offset = msg.host - (msg.sent + rtt / 2);
        if (rtt < this.clockRtt * 1.5 || !Number.isFinite(this.clockRtt)) {
          this.clockOffset += (offset - this.clockOffset) * (this.clockRtt === Infinity ? 1 : 0.25);
          this.clockRtt = rtt;
        }
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------------ tests / debug
  /** Stable hash of every domain's state (hashView() when a domain has one). Equal on the host and a synced replica. */
  hash() {
    const all = {};
    for (const name of [...this.domains.keys()].sort()) {
      const d = this.domains.get(name);
      const v = d.hashView ? d.hashView() : d.snapshot ? d.snapshot() : null;
      all[name] = v;
    }
    return hash32(stableStringify(all));
  }

  /** Per-domain hashes (to see WHICH domain diverged). */
  hashes() {
    const out = {};
    for (const name of [...this.domains.keys()].sort()) {
      const d = this.domains.get(name);
      out[name] = hash32(stableStringify(d.hashView ? d.hashView() : d.snapshot ? d.snapshot() : null));
    }
    return out;
  }

  summary() {
    return {
      role: this.role, screenId: this.screenId, status: this.status, seq: this.seq,
      domains: [...this.domains.keys()], hash: this.hash(), hashes: this.hashes(),
      screens: this.role === 'host' ? this.connectedScreens : undefined,
      remoteActors: this.role === 'host' ? [...this.actors.values()].map((a) => ({ key: actorKey(a), pos: a.pos })) : undefined,
      grace: this.role === 'host' ? Object.fromEntries(this._grace) : undefined,
      pending: this._pending.size, stats: { ...this.stats },
    };
  }
}

function sanitizePos(p) {
  if (!p || typeof p !== 'object') return { x: 0, y: 0, z: 0 };
  return { x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 };
}
