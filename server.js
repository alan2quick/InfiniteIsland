// Infinite Island server: static files, three.js vendor route, small JSON/QR API
// and a WebSocket relay that pairs phone controllers (and, Step 22, other game pages = "screens") with the game (host) page.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { collectReleaseStatus } from './scripts/release-status.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

// ---------------------------------------------------------------- helpers

function getLanUrls() {
  const urls = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal) urls.push(`http://${a.address}:${PORT}`);
    }
  }
  return urls;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

function sendText(res, status, text) {
  send(res, status, text, { 'Content-Type': 'text/plain; charset=utf-8' });
}

/**
 * Resolve a URL path inside `root`. Returns an absolute file path, or null if
 * the request is malformed or tries to escape the root.
 */
function safeResolve(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  // Reject any backslashes / parent segments outright (Windows path separators too).
  if (decoded.includes('\\')) return null;
  if (decoded.split('/').some((seg) => seg === '..')) return null;
  const target = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) return null;
  return target;
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-cache' };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

// ---------------------------------------------------------------- HTTP

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/api/release-status') {
      let buildDate = null, buildVersion = null;
      try {
        const built = JSON.parse(await fs.promises.readFile(path.join(PUBLIC_DIR, 'generated', 'release-status.json'), 'utf8'));
        if (typeof built.buildDate === 'string') buildDate = built.buildDate;
        if (typeof built.buildVersion === 'string') buildVersion = built.buildVersion;
      } catch { /* A checkout may not have been built yet. */ }
      const status = await collectReleaseStatus({ cwd: __dirname, buildDate, buildVersion });
      return send(res, 200, req.method === 'HEAD' ? '' : JSON.stringify(status), {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      });
    }

    if (pathname === '/api/info') {
      return send(res, 200, JSON.stringify({ lanUrls: getLanUrls(), port: PORT }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
    }

    if (pathname === '/api/qr') {
      const text = url.searchParams.get('text');
      if (!text || text.length > 1000) return sendText(res, 400, 'Missing or too long "text" parameter');
      const svg = await QRCode.toString(text, { type: 'svg', margin: 1 });
      return send(res, 200, svg, { 'Content-Type': 'image/svg+xml' });
    }

    let filePath;
    if (pathname.startsWith('/vendor/three/')) {
      filePath = safeResolve(THREE_DIR, pathname.slice('/vendor/three/'.length));
    } else {
      let p = pathname === "/editor" ? "/index.html" : pathname;
      if (p.endsWith('/')) p += 'index.html';
      filePath = safeResolve(PUBLIC_DIR, p);
    }
    if (!filePath) return sendText(res, 400, 'Bad request');
    serveFile(req, res, filePath);
  } catch (err) {
    console.error('HTTP error:', err);
    if (!res.headersSent) sendText(res, 500, 'Server error');
    else res.destroy();
  }
});

// ---------------------------------------------------------------- WebSocket relay

// Letters only, no ambiguous ones (I, O, L). No digits at all, so 0/1 are excluded too.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

/** @type {Map<string, {host: import('ws').WebSocket|null, controllers: Set<import('ws').WebSocket>, nextId: number, screens: Set<import('ws').WebSocket>, nextScreenId: number}>} */
const rooms = new Map();

function makeCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate room code');
}

/** Controller clientId: persistent per phone (localStorage on the controller page). Sanitised, optional. */
function cleanClientId(v) {
  const s = String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return s || null;
}

function sendJson(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const c of room.controllers) {
    sendJson(c, { type: 'host-left' });
    c.roomCode = null;
    c.controllerId = null;
    c.clientId = null;
  }
  for (const s of room.screens) {
    sendJson(s, { type: 'host-left' });
    s.roomCode = null;
    s.controllerId = null;
    s.clientId = null;
  }
  rooms.delete(code);
}

function leaveAsController(ws) {
  const room = ws.roomCode && rooms.get(ws.roomCode);
  if (room && room.controllers.delete(ws)) {
    sendJson(room.host, { type: 'controller-disconnected', id: ws.controllerId });
  }
  ws.roomCode = null;
  ws.controllerId = null;
  ws.clientId = null;
}

/** A screen (another game page, `role:'screen'`) leaves its room: the host is told so it can start the grace period. */
function leaveAsScreen(ws) {
  const room = ws.roomCode && rooms.get(ws.roomCode);
  if (room && room.screens.delete(ws)) {
    sendJson(room.host, { type: 'screen-disconnected', id: ws.controllerId });
  }
  ws.roomCode = null;
  ws.controllerId = null;
  ws.clientId = null;
}

function cleanup(ws) {
  if (ws.role === 'host') {
    if (ws.roomCode) closeRoom(ws.roomCode);
  } else if (ws.role === 'controller') {
    leaveAsController(ws);
  } else if (ws.role === 'screen') {
    leaveAsScreen(ws);
  }
}

// host -> controller message types the relay forwards (everything else is dropped)
const RELAYED_TO_CONTROLLER = new Set(['assign']);

// Controllers send tiny input messages (4 KB cap, enforced per message below); hosts and screens exchange world snapshots / events (64 KB).
const MAX_CONTROLLER_BYTES = 4096;
const MAX_SCREEN_BYTES = 65536;
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_SCREEN_BYTES });

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    /* fallthrough */
  }
  if (pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.role = null; // 'host' | 'controller' | 'screen'
  ws.roomCode = null;
  ws.controllerId = null;
  ws.clientId = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    ws.isAlive = true;
    if (data.length > ((ws.role === 'host' || ws.role === 'screen') ? MAX_SCREEN_BYTES : MAX_CONTROLLER_BYTES)) return;
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    // A screen's messages are opaque to the relay: wrapped and handed to the host ({type:'from-screen', id, msg}). 'join' registers it (below).
    if (ws.role === 'screen' && msg.type !== 'join') {
      if (msg.type === 'ping') return;
      const room = rooms.get(ws.roomCode);
      if (room) sendJson(room.host, { type: 'from-screen', id: ws.controllerId, msg });
      return;
    }

    switch (msg.type) {
      case 'host': {
        if (ws.role) return; // already registered
        const code = makeCode();
        rooms.set(code, { host: ws, controllers: new Set(), nextId: 1, screens: new Set(), nextScreenId: 1 });
        ws.role = 'host';
        ws.roomCode = code;
        sendJson(ws, { type: 'room', code });
        break;
      }
      case 'join': {
        if (ws.role === 'host') return;
        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room || !room.host || room.host.readyState !== room.host.OPEN) {
          return sendJson(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
        }
        if (ws.roomCode === code) return; // already in this room
        if (ws.roomCode) (ws.role === 'screen' ? leaveAsScreen : leaveAsController)(ws); // switching rooms
        if (msg.role === 'screen') {
          // another game page (WorldSync replica). Its id space is separate from the controllers'.
          ws.role = 'screen';
          ws.roomCode = code;
          ws.controllerId = room.nextScreenId++;
          ws.clientId = cleanClientId(msg.clientId);
          room.screens.add(ws);
          sendJson(ws, { type: 'joined', screen: ws.controllerId });
          sendJson(room.host, { type: 'screen-connected', id: ws.controllerId, clientId: ws.clientId });
          break;
        }
        ws.role = 'controller';
        ws.roomCode = code;
        ws.controllerId = room.nextId++;
        ws.clientId = cleanClientId(msg.clientId);
        room.controllers.add(ws);
        sendJson(ws, { type: 'joined', player: ws.controllerId });
        sendJson(room.host, { type: 'controller-connected', id: ws.controllerId, clientId: ws.clientId });
        break;
      }
      case 'input': {
        if (ws.role !== 'controller') return;
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        sendJson(room.host, {
          type: 'input',
          id: ws.controllerId,
          clientId: ws.clientId,
          x: Number(msg.x) || 0,
          y: Number(msg.y) || 0,
          interact: !!msg.interact,
          cancel: !!msg.cancel,
          jump: !!msg.jump,
          charm: !!msg.charm,
          menu: !!msg.menu,
        });
        break;
      }
      case 'to-controller': {
        // host -> one controller: {type:'to-controller', id, msg:{type:'assign', ...}}
        if (ws.role !== 'host') return;
        const room = rooms.get(ws.roomCode);
        const inner = msg.msg;
        if (!room || !inner || typeof inner.type !== 'string' || !RELAYED_TO_CONTROLLER.has(inner.type)) return;
        for (const c of room.controllers) {
          if (c.controllerId === msg.id) { sendJson(c, inner); break; }
        }
        break;
      }
      case 'to-screen': {
        // host -> one screen: {type:'to-screen', id, msg:{...}} (any message object; the relay does not look inside)
        if (ws.role !== 'host') return;
        const room = rooms.get(ws.roomCode);
        const inner = msg.msg;
        if (!room || !inner || typeof inner.type !== 'string') return;
        for (const c of room.screens) {
          if (c.controllerId === msg.id) { sendJson(c, inner); break; }
        }
        break;
      }
      case 'broadcast-screens': {
        // host -> every screen
        if (ws.role !== 'host') return;
        const room = rooms.get(ws.roomCode);
        const inner = msg.msg;
        if (!room || !inner || typeof inner.type !== 'string') return;
        for (const c of room.screens) sendJson(c, inner);
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => cleanup(ws));
  ws.on('error', () => {});
});

// Ping every 15 s; terminate sockets that did not answer since the last round.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate(); // triggers 'close' -> cleanup
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 15000);
wss.on('close', () => clearInterval(heartbeat));

// ---------------------------------------------------------------- start

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Infinite Island is running!\n');
  console.log(`  Local:   http://localhost:${PORT}`);
  const lan = getLanUrls();
  if (lan.length) for (const u of lan) console.log(`  Network: ${u}`);
  else console.log('  Network: (no LAN address found)');
  console.log('');
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
