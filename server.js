// Bananageddon — Authoritative game server
// Serves static files over HTTP, runs WebSocket for multiplayer

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Shared = require('./shared.js');

const {
  DEFAULT_SETTINGS,
  MAP_SIZES,
  MODE_CONFIGS,
  SETTINGS_LIMITS,
  VALID_GAME_MODES,
  getDefaultPlayerColor,
  sanitizePlayerColor,
} = Shared;

const PORT = parseInt(process.env.PORT, 10) || 3000;
const DISCONNECT_TIMEOUT_MS = Math.max(100, Number(process.env.DISCONNECT_TIMEOUT_MS) || 15000);
const MAX_SPECTATORS = 8;

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Biome configs ───────────────────────────────────────────────────────────
const BIOME_CONFIGS = {
  city:        { windMult: 1.0, gravMult: 1.0 },
  desert:      { windMult: 0.6, gravMult: 1.0 },
  arctic:      { windMult: 1.5, gravMult: 1.0 },
  jungle:      { windMult: 0.7, gravMult: 1.0 },
  volcanic:    { windMult: 1.0, gravMult: 1.2 },
  moon:        { windMult: 0.0, gravMult: 0.35 },
  underwater:  { windMult: 0.8, gravMult: 0.65 },
  postapoc:    { windMult: 1.4, gravMult: 1.0 },
  cyberpunk:   { windMult: 1.0, gravMult: 1.0 },
};
const BIOME_LIST = Object.keys(BIOME_CONFIGS);

// ─── Weather configs ─────────────────────────────────────────────────────────
const WEATHER_CONFIGS = {
  clear:     { windMult: 1.0, dynamicWind: false },
  rain:      { windMult: 1.2, dynamicWind: false },
  snow:      { windMult: 0.8, dynamicWind: false },
  fog:       { windMult: 1.0, dynamicWind: false },
  storm:     { windMult: 1.5, dynamicWind: true, windChangeInterval: 5 },
  windshear: { windMult: 1.0, dynamicWind: false, shear: true },
  acidrain:  { windMult: 1.0, dynamicWind: false, erode: true },
  sandstorm: { windMult: 2.0, dynamicWind: true, windChangeInterval: 3 },
};
const WEATHER_LIST = Object.keys(WEATHER_CONFIGS);

// ─── Banana type configs ─────────────────────────────────────────────────────
const BANANA_CONFIGS = {
  standard: { gravMult: 1.0, radius: null, cluster: false, bounces: 0, dud: false, napalm: false },
  heavy:    { gravMult: 1.5, radius: null, cluster: false, bounces: 0, dud: false, napalm: false },
  cluster:  { gravMult: 1.0, radius: 15,   cluster: true,  bounces: 0, dud: false, napalm: false },
  napalm:   { gravMult: 1.0, radius: null, cluster: false, bounces: 0, dud: false, napalm: true },
  skipper:  { gravMult: 1.0, radius: null, cluster: false, bounces: 2, dud: false, napalm: false },
  dud:      { gravMult: 1.0, radius: 0,   cluster: false, bounces: 0, dud: true,  napalm: false },
};
const BANANA_LIST = Object.keys(BANANA_CONFIGS);

// ─── Terrain generation ─────────────────────────────────────────────────────
function generateTerrain(seed, mapSize, biome) {
  const rng = mulberry32(seed);
  const cfg = MAP_SIZES[mapSize] || MAP_SIZES.normal;
  const W = cfg.w;
  const H = cfg.h;
  const numBuildings = cfg.minBuildings + Math.floor(rng() * (cfg.maxBuildings - cfg.minBuildings + 1));
  const buildings = [];
  let x = 0;
  const buildingWidth = W / numBuildings;
  const colors = getBiomeColors(biome);

  for (let i = 0; i < numBuildings; i++) {
    const w = Math.floor(buildingWidth);
    const h = Math.floor(rng() * (H * 0.42)) + Math.floor(H * 0.17);
    const color = colors[Math.floor(rng() * colors.length)];
    buildings.push({ x, w, h, y: H - h, color });
    x += w;
  }
  return buildings;
}

function getBiomeColors(biome) {
  switch (biome) {
    case 'desert':     return ['#D2A679', '#C4965A', '#B8860B'];
    case 'arctic':     return ['#B0C4DE', '#87CEEB', '#F0F8FF'];
    case 'jungle':     return ['#228B22', '#2E8B57', '#006400'];
    case 'volcanic':   return ['#4A0000', '#8B0000', '#333333'];
    case 'moon':       return ['#808080', '#696969', '#A9A9A9'];
    case 'underwater': return ['#008B8B', '#006666', '#20B2AA'];
    case 'postapoc':   return ['#555555', '#666644', '#444444'];
    case 'cyberpunk':  return ['#1A1A2E', '#16213E', '#0F3460'];
    default:           return ['#55FFFF', '#FF55FF', '#AAAAAA'];
  }
}

function placeGorillas(buildings, rng, gorillaCount = 2) {
  const GORILLA_W = 28;
  const GORILLA_H = 28;

  function pos(b) {
    return {
      x: Math.floor(b.x + b.w / 2 - GORILLA_W / 2),
      y: b.y - GORILLA_H,
    };
  }

  if (gorillaCount <= 1) {
    const idx = Math.min(buildings.length - 1, Math.floor(rng() * Math.max(1, buildings.length)));
    return [pos(buildings[idx])];
  }

  const chosen = [];
  const maxIdx = buildings.length - 1;
  const separation = Math.max(1, Math.floor(buildings.length / Math.max(3, gorillaCount * 2)));

  for (let i = 0; i < gorillaCount; i++) {
    const ratio = gorillaCount === 1 ? 0.5 : i / (gorillaCount - 1);
    const jitter = Math.floor((rng() - 0.5) * separation * 2);
    let idx = Math.round(ratio * maxIdx) + jitter;
    idx = Math.max(0, Math.min(maxIdx, idx));

    while (chosen.some(existing => Math.abs(existing - idx) < separation)) {
      idx = Math.min(maxIdx, idx + 1);
      if (chosen.every(existing => Math.abs(existing - idx) >= separation)) break;
      idx = Math.max(0, idx - 2);
      if (chosen.every(existing => Math.abs(existing - idx) >= separation)) break;
      idx = Math.max(0, Math.min(maxIdx, idx + 1));
      break;
    }

    chosen.push(idx);
  }

  chosen.sort((a, b) => a - b);
  return chosen.map(idx => pos(buildings[idx]));
}

// Co-op vs CPU: humans (slots 0,1) clustered on the LEFT half of the map,
// CPUs (slots 2,3) clustered on the RIGHT half. This keeps allies adjacent
// without crowding them onto a single rooftop.
function placeCoopGorillas(buildings, rng) {
  const GORILLA_W = 28;
  const GORILLA_H = 28;
  const total = buildings.length;
  if (total === 0) return [];

  function pos(b) {
    return {
      x: Math.floor(b.x + b.w / 2 - GORILLA_W / 2),
      y: b.y - GORILLA_H,
    };
  }

  // Pick an index inside [lo, hi] with a small jitter from rng.
  function pickIn(lo, hi, jitterMag = 1) {
    const span = Math.max(0, hi - lo);
    const center = lo + Math.floor(span / 2);
    const jitter = Math.floor((rng() - 0.5) * 2 * (jitterMag + 1));
    return Math.max(0, Math.min(total - 1, center + jitter));
  }

  // Split building list roughly in half — humans take the left third/quarter,
  // CPUs take the right third/quarter, leaving a buffer in the middle.
  const leftHi = Math.max(0, Math.floor(total * 0.35));
  const leftLoInner = Math.max(0, Math.floor(total * 0.10));
  const rightLo = Math.min(total - 1, Math.floor(total * 0.65));
  const rightHiInner = Math.min(total - 1, Math.floor(total * 0.90));

  const p1 = pickIn(leftLoInner, Math.max(leftLoInner, Math.floor(leftHi * 0.5)), 1);
  let p2 = pickIn(Math.min(total - 1, p1 + 1), leftHi, 1);
  if (p2 === p1) p2 = Math.min(total - 1, p1 + 1);

  const c1 = pickIn(rightLo, Math.min(rightHiInner, Math.floor((rightLo + rightHiInner) / 2)), 1);
  let c2 = pickIn(Math.min(total - 1, c1 + 1), rightHiInner, 1);
  if (c2 === c1) c2 = Math.min(total - 1, c1 + 1);

  return [pos(buildings[p1]), pos(buildings[p2]), pos(buildings[c1]), pos(buildings[c2])];
}

// ─── CPU AI (co-op mode) ─────────────────────────────────────────────────────
// Picks a target (one of the two human gorillas) and computes an angle/velocity
// to land near it using projectile motion. "Medium" difficulty adds random
// jitter so it occasionally misses.
function pickCpuShot(cpuIdx) {
  const shooter = match.gorillas[cpuIdx];
  if (!shooter) return null;
  const targets = [match.gorillas[0], match.gorillas[1]].filter(Boolean);
  if (!targets.length) return null;
  const target = targets[Math.floor(Math.random() * targets.length)];

  const sx = shooter.x + GORILLA_W / 2;
  const sy = shooter.y - 4;
  const tx = target.x + GORILLA_W / 2;
  const ty = target.y + GORILLA_H / 2;

  const dx = tx - sx;
  const dy = ty - sy;
  const horiz = Math.abs(dx) || 1;

  const gravity = BASE_GRAVITY * (Number(match.settings.gravityMultiplier) || 1);
  const wind = Number(match.wind) || 0;

  // Choose a flight time appropriate to the horizontal distance, then solve
  // for the launch velocity that lands at the target at that time:
  //   x: dx = (vxWorld + wind) * t      → vxWorld = dx/t - wind
  //   y (screen, down=+): dy = vyScreen*t + 0.5*g*t^2
  //                       → vyScreen = dy/t - 0.5*g*t
  //   server uses vyScreen = -velocity*sin(angleRad), so define vyUp = -vyScreen
  //                       → vyUp = 0.5*g*t - dy/t
  const t = Math.max(1.2, Math.min(3.5, horiz / 120 + 1.4));
  let vx = dx / t - wind;
  let vyUp = 0.5 * gravity * t - dy / t; // = 0.5*g*t - dy/t

  // Speed magnitude.
  const speed = Math.hypot(vx, vyUp);
  if (!isFinite(speed) || speed <= 0) return null;

  const side = getThrowSide(cpuIdx);   // -1 = facing right (left side of map), 1 = facing left
  // Server: angleRad = (side<0) ? a*pi/180 : (180-a)*pi/180
  //   vx     = velocity*cos(angleRad)
  //   vyUp   = velocity*sin(angleRad)
  // For side<0: cos(a)=vx/v, sin(a)=vyUp/v → a = atan2(vyUp, vx)
  // For side>=0: vx = v*cos(180-a) = -v*cos(a), so cos(a) = -vx/v;
  //              vyUp = v*sin(180-a) = v*sin(a), so sin(a) = vyUp/v → a = atan2(vyUp, -vx)
  let angleDeg;
  if (side < 0) {
    angleDeg = Math.atan2(vyUp, vx) * 180 / Math.PI;
  } else {
    angleDeg = Math.atan2(vyUp, -vx) * 180 / Math.PI;
  }

  // Clamp to launchable range and add medium-difficulty jitter.
  angleDeg = Math.max(15, Math.min(165, angleDeg));
  const angleJitter = (Math.random() - 0.5) * 16;   // ±8°
  const speedJitter = 1 + (Math.random() - 0.5) * 0.18;   // ±9%
  const finalAngle = Math.max(5, Math.min(175, angleDeg + angleJitter));
  const maxV = Math.min(999, match.settings.maxVelocity || 200);
  const finalVel = Math.max(20, Math.min(maxV, speed * speedJitter));

  return { angle: Math.round(finalAngle), velocity: Math.round(finalVel) };
}

function isCpuSlot(slotIdx) {
  return match.settings.gameMode === 'coop' && slotIdx >= 2;
}

function scheduleCpuTurnIfNeeded() {
  if (match.state !== 'playing') return;
  if (match.settings.gameMode !== 'coop') return;
  const cpuIdx = match.currentPlayer - 1;
  if (!isCpuSlot(cpuIdx)) return;

  // "Thinking" delay so the human sees who's shooting before the banana flies.
  const thinkMs = 1100 + Math.floor(Math.random() * 900);
  broadcast({ type: 'cpuThinking', cpu: match.currentPlayer });

  scheduleGameplayAction(() => {
    if (match.state !== 'playing') return;
    if (match.currentPlayer !== cpuIdx + 1) return;
    if (match.banana || match.bananas.length > 0 || match.fireInProgress) return;

    const shot = pickCpuShot(cpuIdx);
    if (!shot) return;

    // Mirror the relevant parts of handleFire so the CPU shot follows the
    // exact same physics path as a human shot.
    match.fireInProgress = true;
    match.turnNumber++;
    expireTurrets();
    startBanana(cpuIdx, shot.angle, shot.velocity);
  }, thinkMs);
}

// ─── Physics constants ───────────────────────────────────────────────────────
const EARTH_GRAVITY = 9.8;
const GRAVITY_SCALE = 3;
const BASE_GRAVITY = EARTH_GRAVITY * GRAVITY_SCALE;
const SIM_HZ = 60;
const DT = 1 / SIM_HZ;
const BROADCAST_HZ = 30;
const BROADCAST_INTERVAL = Math.round(SIM_HZ / BROADCAST_HZ);
const GORILLA_W = 28;
const GORILLA_H = 28;
const DEFAULT_EXPLOSION_RADIUS = 30;
const MAX_EXPLOSIONS = 200;

// ─── Turret constants ───────────────────────────────────────────────────────
const TURRET_CHARGES_PER_LIFE = 3;
const TURRET_FIRE_RANGE = 180;
const TURRET_FIRE_RANGE_SQ = TURRET_FIRE_RANGE * TURRET_FIRE_RANGE;
const TURRET_HIT_PROB_PER_TICK = 0.05;
const TURRET_COSMETIC_MISS_EVERY = 3;   // sim ticks between cosmetic tracer bursts (lower = more shots)
const TURRET_COSMETIC_MISS_COUNT = 2;   // how many miss tracers to fire per burst
const TURRET_LIFETIME_TURNS = 4;        // alive for this many opponent turns after deploy
const TURRET_W = 16;
const TURRET_H = 16;
const MAX_TURRET_LAUNCH_V = 140;        // heavier than banana (cap is ~200)
let nextTurretId = 1;

// ─── Static file server ─────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.mp3':  'audio/mpeg',
};

const ALLOWED_FILES = new Set([
  'index.html',
  'ui-mockups.html',
  'game.js',
  'net.js',
  'shared.js',
  'styles.css',
  'lighting.js',
  'particles.js',
  'background.js',
  'robotic.mp3',
  'Gameplay BG.mp3',
  'Victory Screen.mp3',
  'reganati-swag-national-anthem-414505.mp3',
  'reganati-fartysoup-mcdouble-414392.mp3',
  'reganati-singularity-funkyglitchy-videogame-music-512162.mp3',
  'reganati-fruity-dx10-synth-ringtone-411349.mp3',
  'reganati-fartysoup-mctriple-414508.mp3',
  'freesound_community-gasp-6253.mp3',
  'freesound_community-hq-explosion-6288.mp3',
  'freesound_community-clean-machine-gun-burst-98224.mp3',
  'freesound_community-beep-warning-6387.mp3',
  'u_cs6o615ob2-mono-505080.mp3',
]);

const httpServer = http.createServer((req, res) => {
  // /status endpoint — returns match availability info
  if (req.url === '/status') {
    const connectedPlayers = match.players.filter(p => p && p.connected);
    const reservedPlayers = getReservedPlayerCount();
    const spectatorCount = getSpectatorCount();
    const playerNames = match.players
      .filter((p, i) => p && (p.connected || match.disconnectTimers[i]))
      .map(p => p.name);
    const body = JSON.stringify({
      active: connectedPlayers.length > 0 || reservedPlayers > 0 || spectatorCount > 0,
      state: match.state,
      playerCount: connectedPlayers.length,
      connectedPlayerCount: connectedPlayers.length,
      reservedPlayerCount: reservedPlayers,
      playerNames,
      spectatorCount,
      spectatorNames: getSpectatorNames(),
      maxSpectators: MAX_SPECTATORS,
      joinableAsPlayer: canJoinAsPlayer(),
      joinableAsSpectator: canJoinAsSpectator(),
      full: !canJoinAsPlayer(),
      gameMode: match.settings.gameMode,
      mapSize: match.settings.mapSize,
      hostPlayer: getHostPlayerNumber(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  const reqPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url);
  const fileName = path.basename(reqPath);

  if (!ALLOWED_FILES.has(fileName)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const fullPath = path.join(__dirname, fileName);
  if (!fullPath.startsWith(__dirname + path.sep) && fullPath !== path.join(__dirname, fileName)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ─── WebSocket server ────────────────────────────────────────────────────────
// Reject cross-origin WebSocket connections to prevent CSRF-via-WebSocket.
// Allow: same-origin browser connections (Origin matches Host header).
// Allow: no Origin header (non-browser clients, reconnect after page reload).
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  verifyClient: ({ origin, req }) => {
    if (!origin) return true; // non-browser client — allow
    const host = req.headers.host || `localhost:${PORT}`;
    return origin === `http://${host}` || origin === `https://${host}`;
  },
});

// ─── Default settings (classic) ─────────────────────────────────────────────
const CLASSIC_SETTINGS = { ...DEFAULT_SETTINGS };

// ─── Match state ─────────────────────────────────────────────────────────────
let match = null;

function createMatch() {
  return {
    players: [null, null, null, null],
    spectators: new Map(),
    spectatorDisconnectTimers: new Map(),
    challengeQueue: [],
    scores: [0, 0, 0, 0],
    settings: { ...CLASSIC_SETTINGS },
    rosterSize: 0,
    currentPlayer: 1,
    state: 'waiting',
    starting: false,
    citySeed: 0,
    buildings: [],
    gorillas: [],
    wind: 0,
    baseWind: 0,
    explosions: [],
    banana: null,
    bananas: [],
    disconnectTimers: [null, null, null, null],
    roundEndTimer: null,
    matchOverTimer: null,
    roundNumber: 0,
    roundBiome: 'city',
    roundWeather: 'clear',
    roundTimeOfDay: 'day',
    turnStartTime: 0,
    turnTimerDeadline: 0,
    turnTimeRemainingMs: 0,
    turnTimerInterval: null,
    weatherTickInterval: null,
    pause: {
      active: false,
      byPlayer: 0,
      byName: '',
    },
    deferredGameplayTimers: new Set(),
    stats: [
      { shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 },
      { shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 },
      { shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 },
      { shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 },
    ],
    artilleryShots: 0,
    panicSent: [false, false, false, false],
    buildingMass: [],
    windShearFlipped: false,
    erosionInterval: null,
    tauntTimes: [[], [], [], []],
    tauntCooldownUntil: [0, 0, 0, 0],
    missStreak: [0, 0, 0, 0],
    chatTimes: [[], [], [], []],
    turrets: [],
    turretCharges: [TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE],
    fireInProgress: false,
    turnNumber: 0,
    currentTurnId: 0,
    sunHitsThisRound: 0,
    playerSunHits: [0, 0, 0, 0],
    sunRetaliating: null,
    sunAttackInProgress: false,
    gauntletLevel: 0,
    matchOverSummary: null,
  };
}

match = createMatch();

function getModeConfig(mode = match.settings.gameMode) {
  return MODE_CONFIGS[mode] || MODE_CONFIGS.classic;
}

function getSupportedPlayerCount(mode = match.settings.gameMode) {
  return getModeConfig(mode).supportedPlayers || 2;
}

function getControlledPlayerCount(mode = match.settings.gameMode) {
  return getModeConfig(mode).controlledPlayers || getSupportedPlayerCount(mode);
}

function getRequiredPlayerCount(mode = match.settings.gameMode) {
  return Math.min(getSupportedPlayerCount(mode), getModeConfig(mode).requiredPlayers || 2);
}

function isSoloTurnMode(mode = match.settings.gameMode) {
  return !!getModeConfig(mode).soloTurn;
}

function getScoreMode(mode = match.settings.gameMode) {
  return getModeConfig(mode).scoreMode || 'individual';
}

function getConnectedPlayerCount() {
  return match.players.filter(p => p?.connected).length;
}

function getReservedPlayerCount() {
  return match.players.filter((p, i) => p && !p.connected && match.disconnectTimers[i]).length;
}

function getSpectatorEntries({ includeReserved = true } = {}) {
  return Array.from(match.spectators.values()).filter(spec =>
    spec && (spec.connected || (includeReserved && match.spectatorDisconnectTimers.has(spec.id)))
  );
}

function getConnectedSpectatorEntries() {
  return getSpectatorEntries({ includeReserved: false });
}

function getSpectatorCount({ includeReserved = true } = {}) {
  return getSpectatorEntries({ includeReserved }).length;
}

function getSpectatorNames({ includeReserved = true } = {}) {
  return getSpectatorEntries({ includeReserved }).map(spec => spec.name);
}

function getClaimedPlayerSlotCount(mode = match.settings.gameMode) {
  const maxPlayers = getSupportedPlayerCount(mode);
  let claimed = 0;
  for (let i = 0; i < maxPlayers; i++) {
    if (match.players[i] || match.disconnectTimers[i]) claimed++;
  }
  return claimed;
}

function canJoinAsPlayer() {
  if (match.state === 'playing' || match.state === 'roundEnd') return false;
  return getClaimedPlayerSlotCount() < getSupportedPlayerCount();
}

function canJoinAsSpectator() {
  return getSpectatorCount() < MAX_SPECTATORS;
}

function getConnectedPlayerNames() {
  return match.players
    .filter(p => p?.connected)
    .map(p => p.name);
}

function getLobbyPlayerNames() {
  const count = match.players.reduce((lastIdx, player, idx) => (player ? idx : lastIdx), -1) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => match.players[i]?.name || `Player ${i + 1}`);
}

function getPlayerColorsView(count = getActivePlayerCount()) {
  const isHotseat = match.settings.gameMode === 'hotseat';
  const isCoop = match.settings.gameMode === 'coop';
  return Array.from({ length: count }, (_, i) => {
    if ((isHotseat || isCoop) && i === 1) {
      return sanitizePlayerColor(match.settings.player2Color, getDefaultPlayerColor(1));
    }
    if (isCoop && i >= 2) {
      // Distinct CPU colors so they read as the enemy team.
      return i === 2 ? '#FF4D4D' : '#FF8855';
    }
    const color = match.players[i]?.color;
    return sanitizePlayerColor(color, getDefaultPlayerColor(i));
  });
}

function getLobbyPlayerColors() {
  const count = match.players.reduce((lastIdx, player, idx) => (player ? idx : lastIdx), -1) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const color = match.players[i]?.color;
    return sanitizePlayerColor(color, getDefaultPlayerColor(i));
  });
}

function getHostPlayerIndex() {
  return match.players.findIndex(p => p);
}

function getHostPlayerNumber() {
  const idx = getHostPlayerIndex();
  return idx >= 0 ? idx + 1 : 0;
}

function getActivePlayerCount() {
  const mode = match.settings.gameMode;
  if (match.rosterSize > 0 && match.state !== 'waiting') {
    return Math.min(match.rosterSize, getControlledPlayerCount(mode));
  }
  if (mode === 'hotseat') return getControlledPlayerCount(mode);
  if (mode === 'coop') return 4; // 2 humans + 2 CPUs
  if (isSoloTurnMode(mode)) return 1;
  if (mode === 'team' || mode === 'koth') {
    const claimedPlayers = match.players.filter(p => p).length;
    return Math.max(1, Math.min(getSupportedPlayerCount(mode), claimedPlayers || getSupportedPlayerCount(mode)));
  }
  return getSupportedPlayerCount(mode);
}

function getRoundGorillaCount(mode = match.settings.gameMode) {
  return getActivePlayerCount() + (getModeConfig(mode).targetCount || 0);
}

function getPlayerNamesView() {
  const count = getActivePlayerCount();
  const isHotseat = match.settings.gameMode === 'hotseat';
  const isCoop = match.settings.gameMode === 'coop';
  return Array.from({ length: count }, (_, i) => {
    if (isHotseat && i === 1) {
      const name = match.settings.player2Name;
      return (typeof name === 'string' && name.trim()) ? name.trim().substring(0, 20) : 'Player 2';
    }
    if (isCoop) {
      if (i === 0) return match.players[0]?.name || 'Player 1';
      if (i === 1) {
        const name = match.settings.player2Name;
        return (typeof name === 'string' && name.trim()) ? name.trim().substring(0, 20) : 'Player 2';
      }
      return i === 2 ? 'CPU 1' : 'CPU 2';
    }
    return match.players[i]?.name || `Player ${i + 1}`;
  });
}

function getPlayerTeamsView(mode = match.settings.gameMode) {
  const count = getActivePlayerCount();
  if (mode === 'team') {
    return Array.from({ length: count }, (_, i) => i % 2);
  }
  if (mode === 'coop') {
    // Slots 0,1 = humans (team 0). Slots 2,3 = CPUs (team 1).
    return Array.from({ length: count }, (_, i) => (i < 2 ? 0 : 1));
  }
  return Array.from({ length: count }, (_, i) => i);
}

function getTeamIndexForSlot(slotIdx, mode = match.settings.gameMode) {
  if (mode === 'team') return slotIdx % 2;
  if (mode === 'coop') return slotIdx < 2 ? 0 : 1;
  return slotIdx;
}

function getTeamLabel(teamIdx) {
  return teamIdx === 0 ? 'Blue Team' : 'Gold Team';
}

function getTeamScores() {
  const totals = [0, 0];
  for (let i = 0; i < getActivePlayerCount(); i++) {
    totals[getTeamIndexForSlot(i)] += match.scores[i] || 0;
  }
  return totals;
}

function getDisplayScores() {
  return match.scores.slice(0, getActivePlayerCount());
}

function getCompletedRounds() {
  return getDisplayScores().reduce((sum, score) => sum + score, 0);
}

function getScoreSummary() {
  if (getScoreMode() === 'team') {
    const teamScores = getTeamScores();
    return `${getTeamLabel(0)}: ${teamScores[0]}  |  ${getTeamLabel(1)}: ${teamScores[1]}`;
  }

  return getPlayerNamesView()
    .map((name, idx) => `${name}: ${match.scores[idx] || 0}`)
    .join('  |  ');
}

function getWinnerLabel(winnerIdx, mode = match.settings.gameMode) {
  if (winnerIdx == null || winnerIdx < 0) return 'No Winner';
  if (getScoreMode(mode) === 'team') {
    return getTeamLabel(getTeamIndexForSlot(winnerIdx, mode));
  }
  return getPlayerNamesView()[winnerIdx] || `Player ${winnerIdx + 1}`;
}

function buildRoundStartPayload() {
  return {
    type: 'roundStart',
    citySeed: match.citySeed,
    gorillas: match.gorillas,
    wind: match.wind,
    windshear: match.roundWeather === 'windshear',
    currentPlayer: match.currentPlayer,
    scores: getDisplayScores(),
    playerNames: getPlayerNamesView(),
    playerColors: getPlayerColorsView(),
    playerTeams: getPlayerTeamsView(),
    scoreMode: getScoreMode(),
    teamScores: getScoreMode() === 'team' ? getTeamScores() : null,
    scoreSummary: getScoreSummary(),
    timeOfDay: match.roundTimeOfDay,
    explosionRadius: match.settings.explosionRadius,
    gravity: match.settings.gravityMultiplier,
    biome: match.roundBiome,
    weather: match.roundWeather,
    mapSize: match.settings.mapSize,
    mode: match.settings.gameMode,
    modeLabel: getModeConfig().label,
    roundNumber: match.roundNumber,
    maxVelocity: match.settings.maxVelocity,
    bananaType: match.settings.bananaType,
    turnTimer: match.settings.turnTimer,
    shakeIntensity: match.settings.shakeIntensity,
    trailStyle: match.settings.trailStyle,
    crtOverlay: match.settings.crtOverlay,
    turretCharges: match.turretCharges.slice(0, getActivePlayerCount()),
    gauntletLevel: match.gauntletLevel,
    hostPlayer: getHostPlayerNumber(),
    spectatorCount: getSpectatorCount(),
    spectatorNames: getSpectatorNames(),
    maxSpectators: MAX_SPECTATORS,
  };
}

function buildAssignedPayload(playerIdx, { waiting = match.state === 'waiting' } = {}) {
  const playerNames = waiting ? getLobbyPlayerNames() : getPlayerNamesView();
  const playerColors = waiting ? getLobbyPlayerColors() : getPlayerColorsView();
  return {
    type: 'assigned',
    role: 'player',
    player: playerIdx + 1,
    playerNames,
    playerColors,
    playerTeams: waiting ? [] : getPlayerTeamsView(),
    scoreMode: getScoreMode(),
    teamScores: waiting || getScoreMode() !== 'team' ? null : getTeamScores(),
    activePlayerCount: waiting ? playerNames.length : getActivePlayerCount(),
    token: match.players[playerIdx]?.token,
    hostPlayer: getHostPlayerNumber(),
    spectatorCount: getSpectatorCount(),
    spectatorNames: getSpectatorNames(),
    maxSpectators: MAX_SPECTATORS,
  };
}

function buildSpectatorAssignedPayload(spec) {
  const waiting = match.state === 'waiting';
  const playerNames = waiting ? getLobbyPlayerNames() : getPlayerNamesView();
  const playerColors = waiting ? getLobbyPlayerColors() : getPlayerColorsView();
  return {
    type: 'spectatorAssigned',
    role: 'spectator',
    spectatorId: spec.id,
    name: spec.name,
    token: spec.token,
    playerNames,
    playerColors,
    playerTeams: waiting ? [] : getPlayerTeamsView(),
    scoreMode: getScoreMode(),
    teamScores: waiting || getScoreMode() !== 'team' ? null : getTeamScores(),
    activePlayerCount: waiting ? playerNames.length : getActivePlayerCount(),
    hostPlayer: getHostPlayerNumber(),
    spectatorCount: getSpectatorCount(),
    spectatorNames: getSpectatorNames(),
    maxSpectators: MAX_SPECTATORS,
    challengeQueue: getChallengeQueueView(),
  };
}

function buildSpectatorStatusPayload() {
  return {
    type: 'spectators',
    spectatorCount: getSpectatorCount(),
    spectatorNames: getSpectatorNames(),
    maxSpectators: MAX_SPECTATORS,
  };
}

function getChallengeQueueView() {
  return match.challengeQueue.map((entry, idx) => ({
    position: idx + 1,
    targetPlayer: entry.targetPlayer,
    targetName: getPlayerNamesView()[entry.targetPlayer - 1] || `Player ${entry.targetPlayer}`,
    spectatorName: entry.spectatorName,
    spectatorId: entry.spectatorId,
  }));
}

function broadcastChallengeQueue() {
  broadcast({
    type: 'challengeQueue',
    challengeQueue: getChallengeQueueView(),
  });
}

function getTurnRemainingMs() {
  if (match.settings.turnTimer <= 0) return 0;
  if (match.turnTimerDeadline > 0) {
    return Math.max(0, match.turnTimerDeadline - Date.now());
  }
  return Math.max(0, Number(match.turnTimeRemainingMs) || 0);
}

function isGameplayPaused() {
  return !!match.pause?.active;
}

// Guard against stale switchTurn() calls (e.g. multiple cluster bananas each
// scheduling a turn switch). Captures the current turn-ID so that only the
// FIRST callback that fires for this turn actually runs switchTurn(); all
// later callbacks see a higher ID and skip silently.
function scheduleGuardedSwitchTurn(delayMs) {
  const expectedId = match.currentTurnId;
  scheduleGameplayAction(() => {
    if (match.currentTurnId === expectedId) switchTurn();
  }, delayMs);
}

function getTerrainY(x) {
  for (const b of match.buildings) {
    if (x >= b.x && x <= b.x + b.w) return b.y;
  }
  return getMapConfig().h;
}

function findOpponentOf(targetIdx) {
  const activeCount = getActivePlayerCount();
  for (let i = 0; i < activeCount; i++) {
    if (i !== targetIdx && getTeamIndexForSlot(i) !== getTeamIndexForSlot(targetIdx)) return i;
  }
  for (let i = 0; i < activeCount; i++) {
    if (i !== targetIdx) return i;
  }
  return 0;
}

function handleSunHit(playerIdx) {
  match.sunHitsThisRound++;
  match.playerSunHits[playerIdx] = (match.playerSunHits[playerIdx] || 0) + 1;
  const totalHits = match.sunHitsThisRound;

  if (!match.goldenGorilla) {
    const angerT = match.sunAngerThreshold;
    const punishT = match.sunPunishThreshold;
    let angerLevel = 0;
    if (totalHits >= punishT)       angerLevel = 3;
    else if (totalHits >= angerT + 1) angerLevel = 2;
    else if (totalHits >= angerT)     angerLevel = 1;
    broadcast({ type: 'sunAngry', angerLevel, totalHits });

    // Lesser punishments — triggers once at sunPunishThreshold
    if (totalHits >= punishT && !match.sunPunishmentDone) {
      match.sunPunishmentDone = true;
      const roll = Math.random();
      let punishType;
      if (roll < 0.03)       punishType = 'bounceback';
      else if (roll < 0.35)  punishType = 'windblast';
      else if (roll < 0.67)  punishType = 'meteor';
      else                   punishType = 'flare';
      match.sunRetaliating = { type: punishType, targetPlayerIdx: playerIdx };
      broadcast({ type: 'sunPunish' });
    }

    if (totalHits >= 25) {
      spawnGoldenGorilla(playerIdx);
    }
  }
}

function scheduleGameplayAction(action, delayMs) {
  let timer = null;
  const run = () => {
    if (match.state !== 'playing') return;
    if (isGameplayPaused()) {
      timer = setTimeout(() => {
        match.deferredGameplayTimers.delete(timer);
        run();
      }, 100);
      match.deferredGameplayTimers.add(timer);
      return;
    }
    action();
  };

  timer = setTimeout(() => {
    match.deferredGameplayTimers.delete(timer);
    run();
  }, delayMs);
  match.deferredGameplayTimers.add(timer);
  return timer;
}

function buildPauseStatePayload() {
  return {
    type: 'pauseState',
    paused: isGameplayPaused(),
    pausedByPlayer: match.pause?.byPlayer || 0,
    pausedByName: match.pause?.byName || '',
    turnRemainingMs: getTurnRemainingMs(),
  };
}

function clearPauseState() {
  if (!match.pause) {
    match.pause = { active: false, byPlayer: 0, byName: '' };
    return;
  }
  match.pause.active = false;
  match.pause.byPlayer = 0;
  match.pause.byName = '';
}

function broadcastPauseState() {
  broadcast(buildPauseStatePayload());
}

function setGameplayPaused(paused, playerIdx) {
  if (match.state !== 'playing') return false;

  if (paused) {
    if (isGameplayPaused()) return false;
    const player = match.players[playerIdx];
    match.pause.active = true;
    match.pause.byPlayer = playerIdx + 1;
    match.pause.byName = player?.name || `Player ${playerIdx + 1}`;
    stopTurnTimer(true);
    broadcastPauseState();
    return true;
  }

  if (!isGameplayPaused()) return false;

  const remainingMs = getTurnRemainingMs();
  clearPauseState();
  broadcastPauseState();

  if (!match.banana && match.bananas.length === 0 && remainingMs > 0) {
    startTurnTimer(remainingMs);
  }

  return true;
}

function buildStateSyncPayload() {
  const payload = {
    ...buildRoundStartPayload(),
    type: 'stateSync',
    state: match.state,
    paused: isGameplayPaused(),
    pausedByPlayer: match.pause?.byPlayer || 0,
    pausedByName: match.pause?.byName || '',
    explosions: match.explosions.map(exp => ({ x: exp.x, y: exp.y, radius: exp.radius })),
    collapsedBuildings: Array.from(match.collapsedBuildingIndices || []),
    banana: match.banana ? {
      x: match.banana.x,
      y: match.banana.y,
      frame: match.banana.frame || 0,
      type: match.banana.type || 'standard',
    } : null,
    clusterBananas: match.bananas.map(b => ({ idx: b.clusterIdx, x: b.x, y: b.y })),
    serverTimeMs: Date.now(),
    turrets: match.turrets.map(t => ({
      id: t.id,
      ownerIdx: t.ownerIdx,
      x: t.x,
      y: t.y,
      cx: t.cx,
      cy: t.cy,
      expireTurn: t.expireTurn,
    })),
    turnRemainingMs: getTurnRemainingMs(),
    spectatorCount: getSpectatorCount(),
    spectatorNames: getSpectatorNames(),
    maxSpectators: MAX_SPECTATORS,
    challengeQueue: getChallengeQueueView(),
  };

  if (match.state === 'matchOver' && match.matchOverSummary) {
    payload.matchOver = { ...match.matchOverSummary };
  }

  return payload;
}

function getMapConfig() {
  return MAP_SIZES[match.settings.mapSize] || MAP_SIZES.normal;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  const count = match.state === 'waiting' ? match.players.length : getActivePlayerCount();
  for (let i = 0; i < count; i++) {
    const p = match.players[i];
    if (p && p.connected && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  }
  for (const spec of match.spectators.values()) {
    if (spec && spec.connected && spec.ws.readyState === 1) {
      spec.ws.send(data);
    }
  }
}

function sendTo(playerIdx, msg) {
  const p = match.players[playerIdx];
  if (p && p.connected && p.ws.readyState === 1) {
    p.ws.send(JSON.stringify(msg));
  }
}

function sendToSpectator(spec, msg) {
  if (spec && spec.connected && spec.ws.readyState === 1) {
    spec.ws.send(JSON.stringify(msg));
  }
}

function sendWaitingState() {
  const payload = {
    type: 'waiting',
    mode: match.settings.gameMode,
    requiredPlayers: getRequiredPlayerCount(),
    supportedPlayers: getSupportedPlayerCount(),
    connectedPlayers: getConnectedPlayerCount(),
    playerNames: getLobbyPlayerNames(),
    playerColors: getLobbyPlayerColors(),
    hostPlayer: getHostPlayerNumber(),
    spectatorCount: getSpectatorCount(),
    spectatorNames: getSpectatorNames(),
    maxSpectators: MAX_SPECTATORS,
    challengeQueue: getChallengeQueueView(),
  };

  for (let i = 0; i < match.players.length; i++) {
    if (match.players[i]?.connected) {
      sendTo(i, { ...payload, player: i + 1 });
    }
  }
  for (const spec of match.spectators.values()) {
    if (spec?.connected) {
      sendToSpectator(spec, { ...payload, role: 'spectator' });
    }
  }
}

function findSpectatorByWs(ws) {
  for (const spec of match.spectators.values()) {
    if (spec?.ws === ws) return spec;
  }
  return null;
}

function findSpectatorByToken(token) {
  if (!token) return null;
  for (const spec of match.spectators.values()) {
    if (spec?.token === token) return spec;
  }
  return null;
}

function findConnectionByWs(ws) {
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx !== -1) {
    return { role: 'player', playerIdx, client: match.players[playerIdx] };
  }

  const spectator = findSpectatorByWs(ws);
  if (spectator) {
    return { role: 'spectator', spectatorId: spectator.id, client: spectator };
  }

  return null;
}

function broadcastSpectatorStatus() {
  broadcast(buildSpectatorStatusPayload());
}

function removeSpectatorChallenges(specId) {
  const before = match.challengeQueue.length;
  match.challengeQueue = match.challengeQueue.filter(entry => entry.spectatorId !== specId);
  if (match.challengeQueue.length !== before) broadcastChallengeQueue();
}

function getNextChallengeForSlot(slotIdx) {
  const targetPlayer = slotIdx + 1;
  return match.challengeQueue.find(entry => entry.targetPlayer === targetPlayer) || null;
}

function popNextConnectedChallengeForSlot(slotIdx) {
  const targetPlayer = slotIdx + 1;
  for (let i = 0; i < match.challengeQueue.length; i++) {
    const entry = match.challengeQueue[i];
    if (entry.targetPlayer !== targetPlayer) continue;

    const spec = match.spectators.get(entry.spectatorId);
    if (!spec) {
      match.challengeQueue.splice(i, 1);
      i--;
      continue;
    }

    if (!spec.connected || !spec.ws || spec.ws.readyState !== 1) {
      continue;
    }

    match.challengeQueue.splice(i, 1);
    return { entry, spec };
  }

  return null;
}

function makeSpectator(name, ws, token = crypto.randomUUID()) {
  const id = crypto.randomUUID();
  const spec = {
    id,
    ws,
    name,
    token,
    connected: true,
    chatTimes: [],
  };
  match.spectators.set(id, spec);
  return spec;
}

function convertPlayerToSpectator(playerIdx, { allowAtCapacity = false } = {}) {
  const player = match.players[playerIdx];
  if (!player || !player.connected || !player.ws || player.ws.readyState !== 1) return null;
  if (allowAtCapacity ? getSpectatorCount() > MAX_SPECTATORS : getSpectatorCount() >= MAX_SPECTATORS) return null;

  const spec = makeSpectator(player.name || `Player ${playerIdx + 1}`, player.ws);
  match.players[playerIdx] = null;
  if (match.disconnectTimers[playerIdx]) {
    clearTimeout(match.disconnectTimers[playerIdx]);
    match.disconnectTimers[playerIdx] = null;
  }
  sendToSpectator(spec, buildSpectatorAssignedPayload(spec));
  return spec;
}

function promoteSpectatorToPlayer(spec, slotIdx) {
  if (!spec || slotIdx < 0 || slotIdx >= match.players.length) return false;

  if (match.spectatorDisconnectTimers.has(spec.id)) {
    clearTimeout(match.spectatorDisconnectTimers.get(spec.id));
    match.spectatorDisconnectTimers.delete(spec.id);
  }
  match.spectators.delete(spec.id);
  removeSpectatorChallenges(spec.id);

  match.players[slotIdx] = {
    ws: spec.ws,
    name: spec.name,
    connected: !!spec.connected,
    token: spec.token,
    color: getDefaultPlayerColor(slotIdx),
  };

  if (match.players[slotIdx].connected) {
    sendTo(slotIdx, buildAssignedPayload(slotIdx, { waiting: match.state === 'waiting' }));
  }

  return true;
}

function claimQueuedChallengeForSlot(slotIdx, { convertOldPlayer = false } = {}) {
  const oldPlayer = match.players[slotIdx];
  const claim = popNextConnectedChallengeForSlot(slotIdx);
  if (!claim) return false;

  if (convertOldPlayer && oldPlayer?.connected) {
    convertPlayerToSpectator(slotIdx, { allowAtCapacity: true });
  } else {
    match.players[slotIdx] = null;
  }

  promoteSpectatorToPlayer(claim.spec, slotIdx);
  broadcast({
    type: 'challengeResolved',
    player: slotIdx + 1,
    playerName: oldPlayer?.name || `Player ${slotIdx + 1}`,
    challengerName: claim.spec.name,
  });
  broadcastSpectatorStatus();
  broadcastChallengeQueue();
  return true;
}

function getThrowSide(playerIdx) {
  const gorilla = match.gorillas[playerIdx];
  const mapCfg = getMapConfig();
  if (gorilla) {
    return (gorilla.x + GORILLA_W / 2) < (mapCfg.w / 2) ? -1 : 1;
  }

  const activeCount = Math.max(1, getActivePlayerCount());
  return playerIdx < Math.ceil(activeCount / 2) ? -1 : 1;
}

// ─── Round management ────────────────────────────────────────────────────────
function newRound() {
  const mode = match.settings.gameMode;
  match.roundNumber++;
  match.citySeed = (Math.random() * 0xFFFFFFFF) >>> 0;
  match.gauntletLevel = mode === 'gauntlet' ? (match.scores[0] || 0) : 0;

  // Determine biome for this round
  if (mode === 'gauntlet') {
    const biomeCycle = ['city', 'desert', 'arctic', 'jungle', 'volcanic', 'moon', 'underwater', 'postapoc', 'cyberpunk'];
    match.roundBiome = biomeCycle[match.gauntletLevel % biomeCycle.length];
  } else if (match.settings.biome === 'random') {
    const rng = mulberry32(match.citySeed + 99999);
    match.roundBiome = BIOME_LIST[Math.floor(rng() * BIOME_LIST.length)];
  } else {
    match.roundBiome = match.settings.biome;
  }

  // Determine weather for this round
  if (mode === 'gauntlet') {
    const weatherCycle = ['clear', 'rain', 'fog', 'storm', 'acidrain', 'sandstorm', 'windshear', 'snow'];
    match.roundWeather = weatherCycle[match.gauntletLevel % weatherCycle.length];
  } else if (match.settings.weather === 'random') {
    const rng = mulberry32(match.citySeed + 88888);
    match.roundWeather = WEATHER_LIST[Math.floor(rng() * WEATHER_LIST.length)];
  } else {
    match.roundWeather = match.settings.weather;
  }

  // Determine time of day
  if (mode === 'gauntlet') {
    const timeCycle = ['day', 'dusk', 'night', 'dawn'];
    match.roundTimeOfDay = timeCycle[match.gauntletLevel % timeCycle.length];
  } else if (match.settings.timeOfDay === 'random') {
    const rng = mulberry32(match.citySeed + 77777);
    const times = ['day', 'night', 'dawn', 'dusk'];
    match.roundTimeOfDay = times[Math.floor(rng() * times.length)];
  } else if (match.settings.timeOfDay === 'cycle') {
    const cycle = ['dawn', 'day', 'dusk', 'night'];
    match.roundTimeOfDay = cycle[(match.roundNumber - 1) % cycle.length];
  } else {
    match.roundTimeOfDay = match.settings.timeOfDay;
  }

  // Cyberpunk is always night
  if (match.roundBiome === 'cyberpunk') match.roundTimeOfDay = 'night';

  const biomeCfg = BIOME_CONFIGS[match.roundBiome] || BIOME_CONFIGS.city;
  const weatherCfg = WEATHER_CONFIGS[match.roundWeather] || WEATHER_CONFIGS.clear;
  const mapCfg = getMapConfig();

  match.buildings = generateTerrain(match.citySeed, match.settings.mapSize, match.roundBiome);
  const rng = mulberry32(match.citySeed + 12345);
  if (mode === 'coop') {
    // Humans (slots 0,1) on the LEFT half, CPUs (slots 2,3) on the RIGHT half.
    match.gorillas = placeCoopGorillas(match.buildings, rng);
  } else {
    match.gorillas = placeGorillas(match.buildings, rng, getRoundGorillaCount(mode));
  }

  // Calculate building mass for collapse detection
  match.buildingMass = match.buildings.map(b => b.w * (mapCfg.h - b.y));

  // Wind
  let effectiveWindIntensity = match.settings.windIntensity;
  if (mode === 'gauntlet') {
    // Smoother escalation: calm L0, normal L1-2, gusty L3-4, storm L5+
    const gauntletWind = ['calm', 'normal', 'normal', 'gusty', 'gusty', 'storm'];
    effectiveWindIntensity = gauntletWind[Math.min(gauntletWind.length - 1, match.gauntletLevel)];
  }
  const windIntensityMult = { calm: 0.3, normal: 1.0, gusty: 1.5, storm: 2.0 }[effectiveWindIntensity] || 1.0;
  const effectiveWindMult = biomeCfg.windMult * weatherCfg.windMult * windIntensityMult;

  if (match.roundBiome === 'moon') {
    match.wind = 0;
    match.baseWind = 0;
  } else {
    match.baseWind = (Math.random() * 20 - 10) * effectiveWindMult;
    match.wind = match.baseWind;
  }

  match.explosions = [];
  match.banana = null;
  match.bananas = [];
  match.turrets = [];
  match.turretCharges = [TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE];
  match.fireInProgress = false;
  match.collapsedBuildingIndices = new Set();
  match.matchOverSummary = null;
  match.turnNumber = 0;
  match.sunHitsThisRound = 0;
  match.playerSunHits = [0, 0, 0, 0];
  match.sunRetaliating = null;
  match.sunAttackInProgress = false;
  match.sunAngerThreshold = 3 + Math.floor(Math.random() * 3);   // 3–5
  match.sunPunishThreshold = 8 + Math.floor(Math.random() * 3);  // 8–10
  match.sunPunishmentDone = false;
  match.goldenGorilla = null;
  match.goldenGorillaQueue = [];
  match.goldenGorillaAttackInProgress = false;
  // Alternate starting player across rounds so P1 doesn't always open
  {
    if (isSoloTurnMode(mode)) {
      match.currentPlayer = 1;
    } else if (mode === 'team' || mode === 'koth') {
      const activeCount = Math.max(1, getActivePlayerCount());
      match.currentPlayer = ((match.roundNumber - 1) % activeCount) + 1;
    } else if (mode === 'coop') {
      // Always start with a human (slot 0 or 1) so the CPU doesn't open.
      match.currentPlayer = (match.roundNumber % 2 === 1) ? 1 : 2;
    } else {
      match.currentPlayer = (match.roundNumber % 2 === 1) ? 1 : 2;
    }
  }
  match.state = 'playing';
  match.panicSent = [false, false, false, false];
  match.artilleryShots = 0;
  match.windShearFlipped = false;
  match.turnTimeRemainingMs = 0;
  match.turnTimerDeadline = 0;
  clearPauseState();

  // Clear previous intervals
  if (match.weatherTickInterval) { clearInterval(match.weatherTickInterval); match.weatherTickInterval = null; }
  if (match.erosionInterval) { clearInterval(match.erosionInterval); match.erosionInterval = null; }
  stopTurnTimer(false);

  // Dynamic wind for storm/sandstorm weather
  if (weatherCfg.dynamicWind) {
    const interval = (weatherCfg.windChangeInterval || 5) * 1000;
    match.weatherTickInterval = setInterval(() => {
      if (match.state !== 'playing' || isGameplayPaused()) return;
      match.wind = match.baseWind + (Math.random() * 10 - 5) * windIntensityMult;
      match.wind = Math.max(-30, Math.min(30, match.wind));
      broadcast({ type: 'weatherTick', wind: match.wind });
    }, interval);
  }

  // Acid rain erosion
  if (match.roundWeather === 'acidrain') {
    match.erosionInterval = setInterval(() => {
      if (match.state !== 'playing' || isGameplayPaused()) return;
      const erodeRng = mulberry32((Date.now() & 0xFFFFFF) + match.citySeed);
      const erosions = [];
      for (let i = 0; i < 3; i++) {
        const bi = Math.floor(erodeRng() * match.buildings.length);
        const b = match.buildings[bi];
        const ex = b.x + Math.floor(erodeRng() * b.w);
        const ey = b.y + Math.floor(erodeRng() * (mapCfg.h - b.y));
        erosions.push({ x: ex, y: ey, radius: 3 + Math.floor(erodeRng() * 4) });
      }
      for (const erosion of erosions) {
        match.explosions.push(erosion);
        if (match.explosions.length > MAX_EXPLOSIONS) match.explosions.shift();
      }
      broadcast({ type: 'erosion', points: erosions });
    }, 2000);
  }

  // Windshear flag in round broadcast for client notification
  broadcast(buildRoundStartPayload());

  startTurnTimer();
}

function stopTurnTimer(preserveRemaining = false) {
  if (match.turnTimerInterval) {
    clearInterval(match.turnTimerInterval);
    match.turnTimerInterval = null;
  }

  if (preserveRemaining) {
    match.turnTimeRemainingMs = getTurnRemainingMs();
  } else {
    match.turnTimeRemainingMs = 0;
  }

  match.turnTimerDeadline = 0;
  match.turnStartTime = 0;
}

function startTurnTimer(remainingMs = null) {
  if (match.settings.turnTimer <= 0) return;
  if (isGameplayPaused()) {
    if (remainingMs != null) {
      match.turnTimeRemainingMs = Math.max(1, Math.ceil(Number(remainingMs) || 0));
    }
    return;
  }
  stopTurnTimer(false);

  const initialRemaining = remainingMs == null
    ? match.settings.turnTimer * 1000
    : Math.max(1, Math.ceil(Number(remainingMs) || 0));

  match.turnStartTime = Date.now();
  match.turnTimeRemainingMs = initialRemaining;
  match.turnTimerDeadline = match.turnStartTime + initialRemaining;

  match.turnTimerInterval = setInterval(() => {
    if (match.state !== 'playing') {
      stopTurnTimer(false);
      return;
    }
    if (isGameplayPaused()) return;

    const remaining = Math.max(0, match.turnTimerDeadline - Date.now());
    match.turnTimeRemainingMs = remaining;

    if (remaining <= 0) {
      stopTurnTimer(false);
      if (!match.banana) {
        const rng = mulberry32(Date.now() & 0xFFFFFF);
        const angle = Math.floor(rng() * 180);
        const velocity = Math.floor(rng() * match.settings.maxVelocity);
        startBanana(match.currentPlayer - 1, angle, velocity);
      }
    }
  }, 250);
}

function switchTurn() {
  // Invalidate any stale scheduleGuardedSwitchTurn callbacks before doing anything.
  match.currentTurnId = (match.currentTurnId || 0) + 1;
  match.fireInProgress = false;

  // Sun punishment: intercept the turn switch to launch an attack first.
  if (match.sunRetaliating && !match.sunAttackInProgress) {
    const ret = match.sunRetaliating;
    match.sunRetaliating = null;
    match.sunAttackInProgress = true;
    launchSunAttack(ret);
    return;
  }
  match.sunAttackInProgress = false;

  // Golden Gorilla: attacks both players every turn switch while active.
  if (match.goldenGorilla?.active && !match.goldenGorillaAttackInProgress) {
    match.goldenGorillaAttackInProgress = true;
    launchGoldenGorillaAttacks();
    return;
  }
  match.goldenGorillaAttackInProgress = false;

  const mode = match.settings.gameMode;

  if (mode === 'artillery') {
    match.artilleryShots++;
    if (match.artilleryShots < 3) {
      broadcast({ type: 'turn', currentPlayer: match.currentPlayer, shotsLeft: 3 - match.artilleryShots });
      startTurnTimer();
      return;
    }
    match.artilleryShots = 0;
  }

  if (mode === 'chaos') {
    match.wind = (Math.random() * 20 - 10) * 2;
  }

  if (isSoloTurnMode(mode)) {
    match.currentPlayer = 1;
  } else if (mode === 'team' || mode === 'koth' || mode === 'coop') {
    const activeCount = getActivePlayerCount();
    match.currentPlayer = (match.currentPlayer % activeCount) + 1;
  } else {
    match.currentPlayer = match.currentPlayer === 1 ? 2 : 1;
  }
  match.panicSent = [false, false, false, false];

  const turnMsg = { type: 'turn', currentPlayer: match.currentPlayer };
  if (mode === 'artillery') turnMsg.shotsLeft = 3;
  if (match.settings.turnTimer > 0) turnMsg.turnTimer = match.settings.turnTimer;
  broadcast(turnMsg);

  startTurnTimer();

  // Co-op vs CPU: if the new turn belongs to a CPU slot, schedule its shot.
  scheduleCpuTurnIfNeeded();
}

// ─── Sun punishment attack ───────────────────────────────────────────────────
function launchSunAttack(punishment) {
  const mapCfg = getMapConfig();
  const W = mapCfg.w;
  const H = mapCfg.h;
  const SUN_X = match.roundTimeOfDay === 'dawn' ? W * 0.85 :
                match.roundTimeOfDay === 'dusk' ? W * 0.15 : W / 2;
  const SUN_Y = 68;

  broadcast({ type: 'sunAttacking', punishType: punishment.type });

  if (punishment.type === 'bounceback') {
    const targetIdx = punishment.targetPlayerIdx;
    const gorilla = match.gorillas[targetIdx];
    if (!gorilla) {
      match.sunAttackInProgress = false;
      scheduleGuardedSwitchTurn(300);
      return;
    }

    // Accuracy scales with hit count — perfect only at 15+ hits
    const totalHits = match.sunHitsThisRound;
    const maxOffset = 90;
    const inaccuracy = totalHits >= 15 ? 0 : maxOffset * Math.max(0, 1 - (totalHits - 3) / 12);
    const aimX = gorilla.x + GORILLA_W / 2 + (Math.random() - 0.5) * 2 * inaccuracy;
    const aimY = gorilla.y + GORILLA_H / 2 + (Math.random() - 0.5) * inaccuracy * 0.4;

    const gcx = gorilla.x + GORILLA_W / 2;
    const gcy = gorilla.y + GORILLA_H / 2;
    const dx = aimX - SUN_X;
    const dy = aimY - SUN_Y;
    const biomeCfg = BIOME_CONFIGS[match.roundBiome] || BIOME_CONFIGS.city;
    const gravity = BASE_GRAVITY * match.settings.gravityMultiplier * biomeCfg.gravMult;
    const T = 2.5;
    const vx = dx / T;
    const vy = (dy - 0.5 * gravity * T * T) / T;

    match.banana = {
      x: SUN_X, y: SUN_Y,
      vx, vy,
      tick: 0, frame: 0,
      distanceTraveled: 0,
      sunHitSent: true,
      type: 'standard',
      bouncesLeft: 0,
      hasClusterSplit: false,
      launchVelocity: Math.sqrt(vx * vx + vy * vy),
      isSunAttack: true,
      sunAttackTargetIdx: targetIdx,
    };

    broadcast({ type: 'throwAnim', player: 0, angle: 0, velocity: 0, bananaType: 'standard', isSunAttack: true });
    scheduleGameplayAction(() => { if (match.banana) simulateBanana(); }, 600);

  } else if (punishment.type === 'flare') {
    // Solar barrage: 5 sunflare projectiles fan out from the sun across the map
    const flareCount = 5;
    const flareRadius = 18;
    broadcast({ type: 'throwAnim', player: 0, angle: 0, velocity: 0, bananaType: 'sunflare', isSunAttack: true });
    broadcast({ type: 'clusterSplit', x: SUN_X, y: SUN_Y });

    for (let i = 0; i < flareCount; i++) {
      const fraction = (i - (flareCount - 1) / 2) / ((flareCount - 1) / 2); // -1 to +1
      const spreadVx = fraction * 90;    // horizontal spread across map
      const baseVy = 55 + Math.abs(fraction) * 20; // centre falls fastest
      match.bananas.push({
        x: SUN_X, y: SUN_Y,
        vx: spreadVx, vy: baseVy,
        tick: 0, frame: 0,
        distanceTraveled: 0,
        sunHitSent: true,
        type: 'sunflare',
        bouncesLeft: 0,
        hasClusterSplit: true,
        clusterIdx: i,
        launchVelocity: Math.sqrt(spreadVx * spreadVx + baseVy * baseVy),
        isSunAttack: true,
      });
    }
    for (const fb of match.bananas) {
      simulateClusterBanana(fb, flareRadius, mapCfg);
    }

  } else if (punishment.type === 'windblast') {
    const targetIdx = punishment.targetPlayerIdx;
    match.wind = getThrowSide(targetIdx) > 0 ? -30 : 30;
    match.baseWind = match.wind;
    broadcast({ type: 'weatherTick', wind: match.wind });
    match.sunAttackInProgress = false;
    scheduleGuardedSwitchTurn(800);

  } else if (punishment.type === 'meteor') {
    for (let i = 0; i < 3; i++) {
      const mx = Math.floor(Math.random() * (W - 80)) + 40;
      const mRadius = 25 + Math.floor(Math.random() * 15);
      scheduleGameplayAction(() => {
        const mY = getTerrainY(mx); // land on building tops, not the map floor
        broadcast({ type: 'meteor', x: mx, y: mY, radius: mRadius });
        scheduleGameplayAction(() => {
          const exp = { x: mx, y: mY, radius: mRadius };
          match.explosions.push(exp);
          if (match.explosions.length > MAX_EXPLOSIONS) match.explosions.shift();
          broadcast({ type: 'explosion', x: exp.x, y: exp.y, radius: exp.radius });
          destroyTurretsInBlast(mx, mY, mRadius);
          for (let gi = 0; gi < match.gorillas.length; gi++) {
            const g = match.gorillas[gi];
            const gcx = g.x + GORILLA_W / 2;
            const gcy = g.y + GORILLA_H / 2;
            const ddx = gcx - mx;
            const ddy = gcy - mY;
            if (ddx * ddx + ddy * ddy <= mRadius * mRadius) {
              const forceScorerIdx = findOpponentOf(gi);
              scheduleGameplayAction(() => determineWinnerAndScore(gi, gcx, gcy, forceScorerIdx), 100);
            }
          }
        }, 400);
      }, 400 + i * 600);
    }
    scheduleGameplayAction(() => {
      match.sunAttackInProgress = false;
      if (match.state === 'playing') scheduleGuardedSwitchTurn(300);
    }, 2500);
  }
}

// ─── Golden Gorilla ──────────────────────────────────────────────────────────
function getGoldenGorillaPosition() {
  const mapCfg = getMapConfig();
  const W = mapCfg.w;
  let best = null;
  let bestDist = Infinity;
  for (const b of match.buildings) {
    const dist = Math.abs((b.x + b.w / 2) - W / 2);
    if (dist < bestDist) { bestDist = dist; best = b; }
  }
  if (best) {
    return { x: Math.floor(best.x + best.w / 2 - GORILLA_W / 2), y: best.y - GORILLA_H };
  }
  return { x: Math.floor(W / 2 - GORILLA_W / 2), y: Math.floor(mapCfg.h * 0.45) };
}

function spawnGoldenGorilla(triggerPlayerIdx) {
  const pos = getGoldenGorillaPosition();
  match.goldenGorilla = { active: true, x: pos.x, y: pos.y, triggerPlayerIdx };
  match.sunRetaliating = null;
  broadcast({ type: 'goldenGorillaSpawn', x: pos.x, y: pos.y });
}

function despawnGoldenGorilla() {
  if (!match.goldenGorilla) return;
  match.goldenGorilla = null;
  match.goldenGorillaQueue = [];
  match.goldenGorillaAttackInProgress = false;
  broadcast({ type: 'goldenGorillaDespawn' });
}

function launchGoldenGorillaAttacks() {
  const activeCount = getActivePlayerCount();
  const targets = [];
  for (let i = 0; i < activeCount; i++) targets.push(i);
  // Shuffle attack order
  for (let i = targets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [targets[i], targets[j]] = [targets[j], targets[i]];
  }
  match.goldenGorillaQueue = targets;
  broadcast({ type: 'goldenGorillaAttacking' });
  scheduleGameplayAction(() => {
    if (match.state !== 'playing') return;
    const next = match.goldenGorillaQueue.shift();
    if (next !== undefined) fireGoldenGorillaBanana(next);
    else onGoldenGorillaAttackComplete();
  }, 600);
}

function fireGoldenGorillaBanana(targetIdx) {
  if (!match.goldenGorilla?.active || match.state !== 'playing') {
    onGoldenGorillaAttackComplete();
    return;
  }
  const gg = match.goldenGorilla;
  const gorilla = match.gorillas[targetIdx];
  if (!gorilla) { onGoldenGorillaAttackComplete(); return; }

  const ggCx = gg.x + GORILLA_W / 2;
  const ggCy = gg.y + GORILLA_H / 2;
  const gcx = gorilla.x + GORILLA_W / 2;
  const gcy = gorilla.y + GORILLA_H / 2;

  // Bimodal inaccuracy: usually decent, occasionally completely wild
  const wildShot = Math.random() < 0.4;
  const inaccuracy = wildShot
    ? 120 + Math.random() * 80   // wild: ±160–200px
    : 10 + Math.random() * 30;   // controlled: ±10–40px
  const aimX = gcx + (Math.random() - 0.5) * 2 * inaccuracy;
  const aimY = gcy + (Math.random() - 0.5) * inaccuracy * 0.4;

  // Insane weapon pool
  const roll = Math.random();
  let bType, isTossback = false, bouncesOverride = null, blastRadiusOverride = null, isBarrage = false, isFlareBurst = false;
  if      (roll < 0.05) bType = 'standard';
  else if (roll < 0.13) bType = 'heavy';
  else if (roll < 0.23) bType = 'cluster';
  else if (roll < 0.31) bType = 'napalm';
  else if (roll < 0.38) bType = 'skipper';
  else if (roll < 0.43) { bType = 'standard'; isTossback = true; }         // high-arc lob
  else if (roll < 0.57) { bType = 'heavy';    isBarrage = true; }          // 3-shot rapid barrage
  else if (roll < 0.75) { isFlareBurst = true; bType = 'sunflare'; }       // 5 targeted flares
  else if (roll < 0.89) { bType = 'napalm';  blastRadiusOverride = 85; }  // mega napalm
  else if (roll < 0.96) { bType = 'skipper'; bouncesOverride = 6; }       // triple skipper
  else                    bType = 'dud';                                    // troll

  // Flare burst is handled by a separate multi-banana function
  if (isFlareBurst) {
    fireGoldenGorillaFlares(targetIdx);
    return;
  }

  // Queue 2 extra same-target shots for barrage (they fire after this one resolves)
  if (isBarrage) {
    match.goldenGorillaQueue.unshift(targetIdx, targetIdx);
  }

  const dx = aimX - ggCx;
  const dy = aimY - ggCy;
  const biomeCfg = BIOME_CONFIGS[match.roundBiome] || BIOME_CONFIGS.city;
  const gravity = BASE_GRAVITY * match.settings.gravityMultiplier * biomeCfg.gravMult;
  const T = isTossback ? 4.0 : 2.2;
  const vx = dx / T;
  const vy = (dy - 0.5 * gravity * T * T) / T;

  const cfg = BANANA_CONFIGS[bType] || BANANA_CONFIGS.standard;
  match.banana = {
    x: ggCx, y: ggCy,
    vx, vy,
    tick: 0, frame: 0,
    distanceTraveled: 0,
    sunHitSent: true,
    type: bType,
    bouncesLeft: bouncesOverride ?? cfg.bounces ?? 0,
    hasClusterSplit: false,
    launchVelocity: Math.sqrt(vx * vx + vy * vy),
    isSunAttack: true,
    goldenGorillaAttack: true,
    sunAttackTargetIdx: targetIdx,
    blastRadiusOverride,
  };

  const throwSide = gcx > ggCx ? 1 : -1;
  broadcast({
    type: 'throwAnim',
    player: 0,
    angle: 0, velocity: 0,
    bananaType: bType,
    isSunAttack: true,
    isGoldenGorilla: true,
    goldenGorillaThrowSide: throwSide,
    isTossback,
  });
  scheduleGameplayAction(() => { if (match.banana) simulateBanana(); }, 700);
}

function fireGoldenGorillaFlares(targetIdx) {
  if (!match.goldenGorilla?.active || match.state !== 'playing') {
    onGoldenGorillaAttackComplete();
    return;
  }
  const gg = match.goldenGorilla;
  const gorilla = match.gorillas[targetIdx];
  if (!gorilla) { onGoldenGorillaAttackComplete(); return; }

  const ggCx = gg.x + GORILLA_W / 2;
  const ggCy = gg.y + GORILLA_H / 2;
  const gcx = gorilla.x + GORILLA_W / 2;
  const mapCfg = getMapConfig();
  const biomeCfg = BIOME_CONFIGS[match.roundBiome] || BIOME_CONFIGS.city;
  const gravity = BASE_GRAVITY * match.settings.gravityMultiplier * biomeCfg.gravMult;
  const flareCount = 5;
  const flareRadius = 22;
  let pending = flareCount;

  const throwSide = gcx > ggCx ? 1 : -1;
  broadcast({
    type: 'throwAnim', player: 0, angle: 0, velocity: 0,
    bananaType: 'sunflare', isSunAttack: true, isGoldenGorilla: true,
    goldenGorillaThrowSide: throwSide,
  });
  broadcast({ type: 'clusterSplit', x: ggCx, y: ggCy });

  for (let i = 0; i < flareCount; i++) {
    // Fan spread: ±56px around target with slight random jitter
    const spread = (i - 2) * 28 + (Math.random() - 0.5) * 20;
    const aimX = gcx + spread;
    const aimY = gorilla.y + GORILLA_H * 0.5;
    const dx = aimX - ggCx;
    const dy = aimY - ggCy;
    const T = 1.6 + Math.random() * 0.6;
    const vx = dx / T;
    const vy = (dy - 0.5 * gravity * T * T) / T;

    const fb = {
      x: ggCx, y: ggCy,
      vx, vy,
      tick: 0, frame: 0,
      distanceTraveled: 0,
      sunHitSent: true,
      type: 'sunflare',
      bouncesLeft: 0,
      hasClusterSplit: true,
      clusterIdx: i,
      launchVelocity: Math.sqrt(vx * vx + vy * vy),
      isSunAttack: true,
      goldenGorillaAttack: true,
      sunAttackTargetIdx: targetIdx,
    };
    match.bananas.push(fb);

    simulateGGFlareBanana(fb, flareRadius, mapCfg, () => {
      pending--;
      if (pending === 0) onGoldenGorillaAttackComplete();
    });
  }
}

function simulateGGFlareBanana(cb, clusterRadius, mapCfg, onDone) {
  const biomeCfg = BIOME_CONFIGS[match.roundBiome] || BIOME_CONFIGS.city;
  let stepCount = 0;
  const maxSteps = SIM_HZ * 10;

  const simInterval = setInterval(() => {
    if (match.state !== 'playing') { clearInterval(simInterval); onDone(); return; }
    if (isGameplayPaused()) return;

    const gravity = BASE_GRAVITY * match.settings.gravityMultiplier * biomeCfg.gravMult;
    cb.vx += match.wind * 0.5 * DT;
    cb.vy += gravity * DT;
    cb.x += cb.vx * DT;
    cb.y += cb.vy * DT;
    cb.tick++;
    stepCount++;

    if (tickTurretsAgainstBanana(cb)) {
      clearInterval(simInterval);
      const idx = match.bananas.indexOf(cb);
      if (idx >= 0) match.bananas.splice(idx, 1);
      onDone();
      return;
    }

    const result = checkBananaCollision(cb, simInterval, stepCount, clusterRadius, mapCfg);
    if (result) {
      const idx = match.bananas.indexOf(cb);
      if (idx >= 0) match.bananas.splice(idx, 1);
      onDone();
      return;
    }

    if (cb.x < -50 || cb.x > mapCfg.w + 50 || cb.y > mapCfg.h + 50 || stepCount > maxSteps) {
      clearInterval(simInterval);
      const idx = match.bananas.indexOf(cb);
      if (idx >= 0) match.bananas.splice(idx, 1);
      onDone();
      return;
    }

    if (cb.tick % BROADCAST_INTERVAL === 0) {
      broadcast({ type: 'clusterBanana', idx: cb.clusterIdx, x: cb.x, y: cb.y });
    }
  }, 1000 / SIM_HZ);
}

function onGoldenGorillaAttackComplete() {
  if (match.state !== 'playing') return;
  if (match.goldenGorillaQueue && match.goldenGorillaQueue.length > 0) {
    const next = match.goldenGorillaQueue.shift();
    scheduleGameplayAction(() => fireGoldenGorillaBanana(next), 900);
  } else {
    match.goldenGorillaAttackInProgress = false;
    scheduleGuardedSwitchTurn(500);
  }
}

// ─── Banana physics simulation ──────────────────────────────────────────────
function getBananaType() {
  if (match.settings.bananaType === 'random') {
    const types = BANANA_LIST.filter(t => t !== 'dud');
    if (Math.random() < 0.05) return 'dud';
    return types[Math.floor(Math.random() * types.length)];
  }
  return match.settings.bananaType || 'standard';
}

function startBanana(playerIdx, angle, velocity) {
  const gorilla = match.gorillas[playerIdx];
  const startX = gorilla.x + GORILLA_W / 2;
  const startY = gorilla.y - 4;

  const angleRad = getThrowSide(playerIdx) < 0
    ? (angle * Math.PI) / 180
    : ((180 - angle) * Math.PI) / 180;

  const vx = velocity * Math.cos(angleRad);
  const vy = -velocity * Math.sin(angleRad);

  const bananaType = getBananaType();

  match.banana = {
    x: startX, y: startY,
    vx, vy,
    tick: 0, frame: 0,
    distanceTraveled: 0,
    sunHitSent: false,
    type: bananaType,
    bouncesLeft: BANANA_CONFIGS[bananaType].bounces,
    hasClusterSplit: false,
    launchVelocity: velocity,
  };

  // Stats
  match.stats[playerIdx].shots++;
  if (velocity > match.stats[playerIdx].fastestBanana) {
    match.stats[playerIdx].fastestBanana = velocity;
  }

  broadcast({
    type: 'throwAnim',
    player: playerIdx + 1,
    angle, velocity,
    bananaType,
  });

  scheduleGameplayAction(() => {
    if (match.banana) simulateBanana();
  }, 300);
}

function simulateBanana() {
  if (!match.banana || match.state !== 'playing') return;

  const sim = match.banana;
  let stepCount = 0;
  const maxSteps = SIM_HZ * 15;
  const mapCfg = getMapConfig();
  const biomeCfg = BIOME_CONFIGS[match.roundBiome] || BIOME_CONFIGS.city;
  const bananaCfg = BANANA_CONFIGS[sim.type] || BANANA_CONFIGS.standard;
  const effectiveExpRadius = sim.blastRadiusOverride ?? (bananaCfg.radius != null ? bananaCfg.radius : match.settings.explosionRadius);

  const simInterval = setInterval(() => {
    if (!match.banana || match.state !== 'playing') {
      clearInterval(simInterval);
      return;
    }
    if (isGameplayPaused()) return;

    // Chaos mode: randomize physics every 2 seconds
    if (match.settings.gameMode === 'chaos' && sim.tick > 0 && sim.tick % (SIM_HZ * 2) === 0) {
      match.wind = (Math.random() * 40 - 20);
      broadcast({ type: 'weatherTick', wind: match.wind });
    }

    // Wind shear: reverse wind halfway through flight
    if (match.roundWeather === 'windshear' && !match.windShearFlipped && sim.vy > 0) {
      match.windShearFlipped = true;
      match.wind = -match.wind;
      broadcast({ type: 'weatherTick', wind: match.wind });
    }

    // Cinematic proximity check — triggers time dilation once per shot when banana
    // approaches a non-shooter gorilla. Applied via effectiveDT below.
    if (!sim._cinematicActive) {
      const CINEMATIC_TRIG_SQ = 100 * 100;
      for (let gi = 0; gi < match.gorillas.length; gi++) {
        if (gi === match.currentPlayer - 1) continue;
        const g = match.gorillas[gi];
        if (!g) continue;
        const dx = sim.x - (g.x + GORILLA_W / 2);
        const dy = sim.y - (g.y + GORILLA_H / 2);
        if (dx * dx + dy * dy < CINEMATIC_TRIG_SQ) {
          sim._cinematicActive = true;
          broadcast({ type: 'cinematicStart' });
          break;
        }
      }
    }

    // Time-dilation during cinematic: physics advances at 40% real-time rate
    const timeScale = sim._cinematicActive ? 0.4 : 1;
    const effectiveDT = DT * timeScale;

    // Gravity
    const gravity = BASE_GRAVITY * match.settings.gravityMultiplier * biomeCfg.gravMult * bananaCfg.gravMult;

    // Underwater current
    let currentForce = 0;
    if (match.roundBiome === 'underwater') {
      currentForce = Math.sin(sim.tick * 0.05) * 3;
    }

    sim.vx += (match.wind * 0.5 + currentForce * 0.02) * effectiveDT;
    sim.vy += gravity * effectiveDT;

    // Sub-stepping
    const speed = Math.sqrt(sim.vx * sim.vx + sim.vy * sim.vy);
    const stepDist = speed * effectiveDT;
    const MAX_STEP_PX = 4;
    const subSteps = stepDist > MAX_STEP_PX ? Math.ceil(stepDist / MAX_STEP_PX) : 1;
    const subDT = effectiveDT / subSteps;

    for (let sub = 0; sub < subSteps; sub++) {
      const oldX = sim.x;
      const oldY = sim.y;
      sim.x += sim.vx * subDT;
      sim.y += sim.vy * subDT;
      sim.distanceTraveled += Math.sqrt((sim.x - oldX) ** 2 + (sim.y - oldY) ** 2);

      // Enemy-owned turrets fire at the banana whenever it's in range. If any
      // scores a hit, the banana is shot down mid-air (no terrain damage, no
      // gorilla kill credit).
      if (tickTurretsAgainstBanana(sim)) {
        clearInterval(simInterval);
        match.banana = null;
        if (sim.goldenGorillaAttack) { onGoldenGorillaAttackComplete(); }
        else { recordMiss(); scheduleGuardedSwitchTurn(500); }
        return;
      }

      // Direct hit on a turret AABB destroys the turret but doesn't stop the banana.
      checkBananaHitsTurret(sim);

      const result = checkBananaCollision(sim, simInterval, stepCount, effectiveExpRadius, mapCfg);
      if (result) return;
    }

    // Cluster split at TRUE apex (vy sign flip from negative to positive)
    const prevVy = sim.vy - gravity * effectiveDT; // approximate previous vy
    if (sim.type === 'cluster' && !sim.hasClusterSplit && sim.vy > 0 && prevVy <= 0) {
      sim.hasClusterSplit = true;
      clearInterval(simInterval);
      match.banana = null;
      const clusterRadius = 15;
      // 9-part spread: fan from -100° to +100°, each sub-banana kicked strongly
      // upward so they arc high before raining down.
      for (let i = 0; i < 9; i++) {
        const fraction = (i - 4) / 4; // -1 to +1
        const spreadAngle = fraction * (Math.PI * 0.56); // ±100° fan
        const cvx = sim.vx * 0.25 + Math.cos(spreadAngle) * 34;
        const cvy = sim.vy - 58 + Math.sin(spreadAngle) * 18; // strong upward kick
        match.bananas.push({
          x: sim.x, y: sim.y,
          vx: cvx, vy: cvy,
          tick: 0, frame: 0,
          distanceTraveled: 0,
          sunHitSent: false,
          type: 'standard',
          bouncesLeft: 0,
          hasClusterSplit: true,
          clusterIdx: i,
          launchVelocity: sim.launchVelocity,
        });
      }
      broadcast({ type: 'clusterSplit', x: sim.x, y: sim.y });
      for (const cb of match.bananas) {
        simulateClusterBanana(cb, clusterRadius, mapCfg);
      }
      return;
    }

    // Panic detection
    if (sim.vy > 0) {
      for (let gi = 0; gi < match.gorillas.length; gi++) {
        const g = match.gorillas[gi];
        if (gi === match.currentPlayer - 1) continue;
        const dx = Math.abs(sim.x - (g.x + GORILLA_W / 2));
        if (dx < 80 && sim.y < g.y && !match.panicSent[gi]) {
          match.panicSent[gi] = true;
          broadcast({ type: 'panic', player: gi + 1 });
        }
      }
    }

    sim.frame = Math.floor(sim.distanceTraveled / 15) % 4;
    sim.tick++;
    stepCount++;

    // Ground-level hit: banana reaches ground between buildings or through carved gap
    if (sim.y >= mapCfg.h && sim.x >= 0 && sim.x <= mapCfg.w) {
      clearInterval(simInterval);
      match.banana = null;
      if (sim.type === 'dud') {
        broadcast({ type: 'dud', x: sim.x, y: mapCfg.h - 1 });
      } else {
        const exp = { x: sim.x, y: mapCfg.h - 1, radius: effectiveExpRadius };
        match.explosions.push(exp);
        if (match.explosions.length > MAX_EXPLOSIONS) match.explosions.shift();
        broadcast({ type: 'explosion', x: exp.x, y: exp.y, radius: exp.radius });
        destroyTurretsInBlast(exp.x, exp.y, exp.radius);
        if (sim.type === 'napalm') {
          broadcast({ type: 'napalm', x: sim.x, y: mapCfg.h - 1, radius: effectiveExpRadius });
        }
      }
      if (sim.goldenGorillaAttack) { onGoldenGorillaAttackComplete(); }
      else { recordMiss(); scheduleGuardedSwitchTurn(600); }
      return;
    }

    // Off-screen check
    if (sim.x < -50 || sim.x > mapCfg.w + 50 || sim.y > mapCfg.h + 50 || stepCount > maxSteps) {
      clearInterval(simInterval);
      match.banana = null;
      if (sim.goldenGorillaAttack) { onGoldenGorillaAttackComplete(); }
      else { recordMiss(); scheduleGuardedSwitchTurn(500); }
      return;
    }

    // Broadcast position
    if (sim.tick % BROADCAST_INTERVAL === 0) {
      broadcast({ type: 'banana', x: sim.x, y: sim.y, frame: sim.frame, bananaType: sim.type });
    }
  }, 1000 / SIM_HZ);
}

function simulateClusterBanana(cb, clusterRadius, mapCfg) {
  const biomeCfg = BIOME_CONFIGS[match.roundBiome] || BIOME_CONFIGS.city;
  let stepCount = 0;
  const maxSteps = SIM_HZ * 10;

  const simInterval = setInterval(() => {
    if (match.state !== 'playing') { clearInterval(simInterval); return; }
    if (isGameplayPaused()) return;

    const gravity = BASE_GRAVITY * match.settings.gravityMultiplier * biomeCfg.gravMult;
    cb.vx += match.wind * 0.5 * DT;
    cb.vy += gravity * DT;
    cb.x += cb.vx * DT;
    cb.y += cb.vy * DT;
    cb.tick++;
    stepCount++;

    // Turrets can intercept cluster sub-munitions just like the primary banana
    if (tickTurretsAgainstBanana(cb)) {
      clearInterval(simInterval);
      const idx = match.bananas.indexOf(cb);
      if (idx >= 0) match.bananas.splice(idx, 1);
      if (match.bananas.length === 0 && !match.banana) {
        recordMiss();
        scheduleGuardedSwitchTurn(500);
      }
      return;
    }

    const result = checkBananaCollision(cb, simInterval, stepCount, clusterRadius, mapCfg);
    if (result) {
      const idx = match.bananas.indexOf(cb);
      if (idx >= 0) match.bananas.splice(idx, 1);
      return;
    }

    if (cb.x < -50 || cb.x > mapCfg.w + 50 || cb.y > mapCfg.h + 50 || stepCount > maxSteps) {
      clearInterval(simInterval);
      const idx = match.bananas.indexOf(cb);
      if (idx >= 0) match.bananas.splice(idx, 1);
      if (match.bananas.length === 0 && !match.banana) {
        recordMiss();
        scheduleGuardedSwitchTurn(500);
      }
      return;
    }

    if (cb.tick % BROADCAST_INTERVAL === 0) {
      broadcast({ type: 'clusterBanana', idx: cb.clusterIdx, x: cb.x, y: cb.y });
    }
  }, 1000 / SIM_HZ);
}

// ─── Collision checks ────────────────────────────────────────────────────────
function checkBananaCollision(sim, simInterval, stepCount, effectiveRadius, mapCfg) {
  const bx = sim.x;
  const by = sim.y;
  const W = mapCfg.w;
  const H = mapCfg.h;
  const SUN_X = W / 2;
  const SUN_Y = 68;
  const SUN_RADIUS = 30;

  // 1. Gorilla hit
  for (let gi = 0; gi < match.gorillas.length; gi++) {
    const g = match.gorillas[gi];
    if (bx >= g.x && bx <= g.x + GORILLA_W && by >= g.y && by <= g.y + GORILLA_H) {
      clearInterval(simInterval);
      match.banana = null;

      if (sim.type === 'dud') {
        broadcast({ type: 'dud', x: bx, y: by, hitPlayer: gi + 1 });
        if (sim.goldenGorillaAttack) onGoldenGorillaAttackComplete();
        else scheduleGuardedSwitchTurn(1000);
        return true;
      }

      const exp = { x: bx, y: by, radius: effectiveRadius };
      match.explosions.push(exp);
      if (match.explosions.length > MAX_EXPLOSIONS) match.explosions.shift();
      broadcast({ type: 'explosion', x: exp.x, y: exp.y, radius: exp.radius });
      destroyTurretsInBlast(exp.x, exp.y, exp.radius);

      if (sim.type === 'napalm') {
        broadcast({ type: 'napalm', x: bx, y: by, radius: effectiveRadius });
      }

      if (sim.isSunAttack) {
        determineWinnerAndScore(gi, g.x + GORILLA_W / 2, g.y + GORILLA_H / 2, findOpponentOf(gi));
      } else {
        if (sim.distanceTraveled > match.stats[match.currentPlayer - 1].longestShot) {
          match.stats[match.currentPlayer - 1].longestShot = Math.floor(sim.distanceTraveled);
        }
        match.stats[match.currentPlayer - 1].hits++;
        determineWinnerAndScore(gi, g.x + GORILLA_W / 2, g.y + GORILLA_H / 2);
      }

      return true;
    }
  }

  // Near miss detection (15px)
  for (let gi = 0; gi < match.gorillas.length; gi++) {
    if (gi === match.currentPlayer - 1) continue;
    const g = match.gorillas[gi];
    const gcx = g.x + GORILLA_W / 2;
    const gcy = g.y + GORILLA_H / 2;
    const dx = bx - gcx;
    const dy = by - gcy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 15 + GORILLA_W / 2 && dist > GORILLA_W / 2 && !sim._nearMissSent) {
      sim._nearMissSent = true;
      broadcast({ type: 'nearMiss', player: gi + 1 });
      match.stats[match.currentPlayer - 1].nearMisses++;
    }
  }

  // 2. Terrain hit
  if (by >= 0) {
    let hitBuildingIdx = -1;
    for (let bi = 0; bi < match.buildings.length; bi++) {
      const b = match.buildings[bi];
      if (bx >= b.x && bx <= b.x + b.w && by >= b.y && by <= H) {
        hitBuildingIdx = bi;
        break;
      }
    }
    if (hitBuildingIdx >= 0) {
      let carved = false;
      for (const e of match.explosions) {
        const dx = bx - e.x;
        const dy = by - e.y;
        if (dx * dx + dy * dy <= e.radius * e.radius) {
          carved = true;
          break;
        }
      }
      if (!carved) {
        // Sun attack bananas phase through terrain so the hit is guaranteed
        if (sim.isSunAttack) return false;

        // Skipper: bounce
        if (sim.bouncesLeft > 0) {
          sim.bouncesLeft--;
          sim.vy = -Math.abs(sim.vy) * 0.6;
          sim.vx *= 0.8;
          broadcast({ type: 'bananaBounce', x: bx, y: by, bouncesLeft: sim.bouncesLeft });
          return false;
        }

        clearInterval(simInterval);
        match.banana = null;

        if (sim.type === 'dud') {
          broadcast({ type: 'dud', x: bx, y: by });
          scheduleGuardedSwitchTurn(1000);
          return true;
        }

        const exp = { x: bx, y: by, radius: effectiveRadius };
        match.explosions.push(exp);
        if (match.explosions.length > MAX_EXPLOSIONS) match.explosions.shift();
        broadcast({ type: 'explosion', x: exp.x, y: exp.y, radius: exp.radius });
        destroyTurretsInBlast(exp.x, exp.y, exp.radius);

        if (sim.type === 'napalm') {
          broadcast({ type: 'napalm', x: bx, y: by, radius: effectiveRadius });
        }

        if (sim.distanceTraveled > match.stats[match.currentPlayer - 1].longestShot) {
          match.stats[match.currentPlayer - 1].longestShot = Math.floor(sim.distanceTraveled);
        }

        // Blast radius gorilla check
        let blastHit = -1;
        for (let gi = 0; gi < match.gorillas.length; gi++) {
          const g = match.gorillas[gi];
          const gcx = g.x + GORILLA_W / 2;
          const gcy = g.y + GORILLA_H / 2;
          const dx = gcx - exp.x;
          const dy = gcy - exp.y;
          if (dx * dx + dy * dy <= exp.radius * exp.radius) {
            blastHit = gi;
            break;
          }
        }

        if (blastHit >= 0) {
          match.stats[match.currentPlayer - 1].hits++;
          const gBlast = match.gorillas[blastHit];
          scheduleGameplayAction(
            () => determineWinnerAndScore(blastHit, gBlast.x + GORILLA_W / 2, gBlast.y + GORILLA_H / 2),
            400
          );
        } else {
          checkBuildingCollapse(hitBuildingIdx, exp);
          scheduleGuardedSwitchTurn(600);
        }
        return true;
      }
    }
  }

  // 3. Sun/moon hit
  {
    const effectiveSunX = match.roundTimeOfDay === 'dawn' ? W * 0.85 :
                          match.roundTimeOfDay === 'dusk' ? W * 0.15 : SUN_X;
    const dx = bx - effectiveSunX;
    const dy = by - SUN_Y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= SUN_RADIUS * SUN_RADIUS && !sim.sunHitSent) {
      sim.sunHitSent = true;
      broadcast({ type: 'sunHit' });
      if (!sim.isSunAttack && !match.goldenGorilla) handleSunHit(match.currentPlayer - 1);
    } else if (distSq > SUN_RADIUS * SUN_RADIUS) {
      sim.sunHitSent = false;
    }
    const dist = Math.sqrt(distSq);
    if (dist < SUN_RADIUS + 20 && dist > SUN_RADIUS && !sim._sunWinkSent) {
      sim._sunWinkSent = true;
      broadcast({ type: 'sunWink' });
    }
  }

  return false;
}

function getFallbackWinnerForOwnGoal(shooterIdx) {
  const mode = match.settings.gameMode;
  const activeCount = getActivePlayerCount();

  if (isSoloTurnMode(mode)) return null;

  if (mode === 'team') {
    const opposingTeam = getTeamIndexForSlot(shooterIdx) === 0 ? 1 : 0;
    for (let i = 0; i < activeCount; i++) {
      if (getTeamIndexForSlot(i) === opposingTeam) return i;
    }
    return null;
  }

  if (mode === 'koth') {
    for (let offset = 1; offset < activeCount; offset++) {
      const candidate = (shooterIdx + offset) % activeCount;
      if (candidate !== shooterIdx) return candidate;
    }
    return null;
  }

  return shooterIdx === 0 ? 1 : 0;
}

function isFriendlyHit(shooterIdx, hitGorillaIdx) {
  if (hitGorillaIdx === shooterIdx) return true;
  if (match.settings.gameMode !== 'team') return false;
  if (hitGorillaIdx >= getActivePlayerCount()) return false;
  return getTeamIndexForSlot(shooterIdx) === getTeamIndexForSlot(hitGorillaIdx);
}

function getMatchWinState(scoringIdx) {
  const mode = match.settings.gameMode;

  if (mode === 'suddendeath') {
    return { matchOver: true, winnerIdx: scoringIdx, winnerLabel: getWinnerLabel(scoringIdx) };
  }

  if (mode === 'team') {
    const teamScores = getTeamScores();
    const teamIdx = getTeamIndexForSlot(scoringIdx);
    const teamScore = teamScores[teamIdx];
    return {
      matchOver: teamScore >= match.settings.roundsToWin,
      winnerIdx: scoringIdx,
      winnerLabel: getTeamLabel(teamIdx),
    };
  }

  if (mode === 'bestof') {
    const scores = getDisplayScores();
    const seriesLength = Math.max(1, match.settings.roundsToWin);
    const completedRounds = getCompletedRounds();
    const maxScore = Math.max(...scores);
    const leaderIdx = scores.indexOf(maxScore);
    const uniqueLeader = scores.filter(score => score === maxScore).length === 1;
    const majority = Math.floor(seriesLength / 2) + 1;
    const matchOver = maxScore >= majority || (completedRounds >= seriesLength && uniqueLeader);

    return {
      matchOver,
      winnerIdx: uniqueLeader ? leaderIdx : scoringIdx,
      winnerLabel: getWinnerLabel(uniqueLeader ? leaderIdx : scoringIdx),
    };
  }

  return {
    matchOver: (match.scores[scoringIdx] || 0) >= match.settings.roundsToWin,
    winnerIdx: scoringIdx,
    winnerLabel: getWinnerLabel(scoringIdx),
  };
}

function determineWinnerAndScore(hitGorillaIdx, deathX, deathY, forceScorerIdx = null) {
  const currentIdx = forceScorerIdx != null ? forceScorerIdx : match.currentPlayer - 1;
  let scoringIdx;

  if (forceScorerIdx != null) {
    scoringIdx = forceScorerIdx;
  } else if (isFriendlyHit(currentIdx, hitGorillaIdx)) {
    if (!match.settings.friendlyFire) {
      recordMiss();
      scheduleGuardedSwitchTurn(500);
      return false;
    }

    scoringIdx = getFallbackWinnerForOwnGoal(currentIdx);
    if (scoringIdx == null) {
      recordMiss();
      scheduleGuardedSwitchTurn(500);
      return false;
    }
  } else {
    scoringIdx = currentIdx;
  }

  // Broadcast gorilla death now that the friendly-fire check has passed
  if (deathX !== undefined) {
    broadcast({ type: 'gorillaDeath', player: hitGorillaIdx + 1, x: deathX, y: deathY });
  }

  if (match.goldenGorilla?.active) despawnGoldenGorilla();

  match.scores[scoringIdx]++;
  match.missStreak[scoringIdx] = 0;

  const winState = getMatchWinState(scoringIdx);

  broadcast({
    type: 'gorillaHit',
    winner: scoringIdx + 1,
    winnerLabel: winState.winnerLabel,
    scores: getDisplayScores(),
    playerNames: getPlayerNamesView(),
    playerColors: getPlayerColorsView(),
    playerTeams: getPlayerTeamsView(),
    scoreMode: getScoreMode(),
    teamScores: getScoreMode() === 'team' ? getTeamScores() : null,
    scoreSummary: getScoreSummary(),
      slowmo: winState.matchOver,
      hostPlayer: getHostPlayerNumber(),
      spectatorCount: getSpectatorCount(),
      spectatorNames: getSpectatorNames(),
      maxSpectators: MAX_SPECTATORS,
      challengeQueue: getChallengeQueueView(),
    });

  if (winState.matchOver) {
    match.state = 'matchOver';
    clearPauseState();
    match.matchOverSummary = {
      winner: scoringIdx + 1,
      winnerLabel: winState.winnerLabel,
      finalScores: getDisplayScores(),
      playerNames: getPlayerNamesView(),
      playerColors: getPlayerColorsView(),
      playerTeams: getPlayerTeamsView(),
      scoreMode: getScoreMode(),
      teamScores: getScoreMode() === 'team' ? getTeamScores() : null,
      scoreSummary: getScoreSummary(),
      stats: match.stats.slice(0, getActivePlayerCount()),
      hostPlayer: getHostPlayerNumber(),
      spectatorCount: getSpectatorCount(),
      spectatorNames: getSpectatorNames(),
      maxSpectators: MAX_SPECTATORS,
      challengeQueue: getChallengeQueueView(),
    };
    clearAllIntervals();
    match.matchOverTimer = setTimeout(() => {
      match.matchOverTimer = null;
      broadcast({
        type: 'matchOver',
        ...match.matchOverSummary,
      });
    }, 3000);
  } else {
    match.state = 'roundEnd';
    clearPauseState();
    if (match.roundEndTimer) { clearTimeout(match.roundEndTimer); }
    match.roundEndTimer = setTimeout(() => {
      match.roundEndTimer = null;
      newRound();
    }, 3000);
  }
  return winState.matchOver;
}

function clearAllIntervals() {
  if (match.weatherTickInterval) { clearInterval(match.weatherTickInterval); match.weatherTickInterval = null; }
  if (match.erosionInterval) { clearInterval(match.erosionInterval); match.erosionInterval = null; }
  stopTurnTimer(false);
  if (match.roundEndTimer) { clearTimeout(match.roundEndTimer); match.roundEndTimer = null; }
  if (match.matchOverTimer) { clearTimeout(match.matchOverTimer); match.matchOverTimer = null; }
  for (const timer of match.deferredGameplayTimers) {
    clearTimeout(timer);
  }
  match.deferredGameplayTimers.clear();
}

function checkBuildingCollapse(buildingIdx, explosion) {
  if (buildingIdx < 0 || buildingIdx >= match.buildings.length) return;
  const b = match.buildings[buildingIdx];
  const mapCfg = getMapConfig();
  const originalMass = match.buildingMass[buildingIdx];
  if (originalMass <= 0) return;

  let removed = 0;
  for (const e of match.explosions) {
    const overlapLeft = Math.max(b.x, e.x - e.radius);
    const overlapRight = Math.min(b.x + b.w, e.x + e.radius);
    const overlapTop = Math.max(b.y, e.y - e.radius);
    const overlapBottom = Math.min(mapCfg.h, e.y + e.radius);
    if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
      removed += Math.PI * e.radius * e.radius * 0.5;
    }
  }

  if (removed >= originalMass * 0.75) {
    broadcast({ type: 'buildingCollapse', index: buildingIdx });
    match.collapsedBuildingIndices.add(buildingIdx);
    for (let gi = 0; gi < match.gorillas.length; gi++) {
      const g = match.gorillas[gi];
      const gcx = g.x + GORILLA_W / 2;
      // Gorilla is ON the collapsed building if their center is within its footprint
      if (gcx >= b.x && gcx <= b.x + b.w) {
        broadcast({ type: 'gorillaFall', player: gi + 1, newY: mapCfg.h - GORILLA_H });
        const gCollapseX = g.x + GORILLA_W / 2;
        const gCollapseY = mapCfg.h - GORILLA_H / 2;
        match.gorillas[gi] = { x: g.x, y: mapCfg.h - GORILLA_H };
        // Credit the round to the current shooter if they didn't kill themselves with it
        scheduleGameplayAction(() => determineWinnerAndScore(gi, gCollapseX, gCollapseY), 500);
        return;
      }
    }
  }
}

// ─── WebSocket keepalive heartbeat ──────────────────────────────────────────
// NAT routers and firewalls silently drop idle connections after ~30-60s.
// Every 25s we ping all clients; any that don't pong back are terminated.
const PING_INTERVAL_MS = 25_000;
setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, PING_INTERVAL_MS);

// ─── WebSocket connection handling ──────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing message type' }));
      return;
    }

    switch (msg.type) {
      case 'join': handleJoin(ws, msg); break;
      case 'fire': handleFire(ws, msg); break;
      case 'setPaused': handleSetPaused(ws, msg); break;
      case 'rematch': handleRematch(ws); break;
      case 'newMatch': handleNewMatch(ws); break;
      case 'setProfile': handleSetProfile(ws, msg); break;
      case 'setSettings': handleSetSettings(ws, msg); break;
      case 'leaveMatch': handleLeaveMatch(ws); break;
      case 'clearMatch': handleClearMatch(ws); break;
      case 'challengePlayer': handleChallengePlayer(ws, msg); break;
      case 'acceptChallenge': handleAcceptChallenge(ws); break;
      case 'chat': handleChat(ws, msg); break;
      case 'taunt': handleTaunt(ws, msg); break;
      case 'picnic': handlePicnic(ws); break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  });

  ws.on('close', () => handleDisconnect(ws));
});

function handleJoin(ws, msg) {
  const name = (typeof msg.name === 'string' ? msg.name.trim().substring(0, 20) : 'Player') || 'Player';
  const requestedRole = msg.role === 'spectator' ? 'spectator' : 'player';

  // If no slots are occupied and no reconnect timers are pending, the match is
  // truly abandoned — reset so new players can join cleanly.
  // We must NOT reset when a disconnected player still has a valid reconnect
  // timer running, as that would destroy their reconnect slot.
  const anyPresence =
    match.players.some((p, i) => p !== null || match.disconnectTimers[i] !== null) ||
    getSpectatorCount() > 0;
  if (!anyPresence) {
    clearAllIntervals();
    match = createMatch();
  }

  // Reconnect check
  for (let i = 0; i < 4; i++) {
    const p = match.players[i];
    if (!p || p.connected || p.token !== msg.token || p.name !== name) continue;

    p.ws = ws;
    p.connected = true;
    p.name = name;
    if (typeof msg.color === 'string') {
      p.color = sanitizePlayerColor(msg.color, p.color || getDefaultPlayerColor(i));
    }
    if (match.disconnectTimers[i]) {
      clearTimeout(match.disconnectTimers[i]);
      match.disconnectTimers[i] = null;
    }

    const preservedTurnRemainingMs = getTurnRemainingMs();
    ws.send(JSON.stringify(buildAssignedPayload(i, { waiting: match.state === 'waiting' })));

    if (match.state === 'waiting') {
      sendWaitingState();
      return;
    }

    ws.send(JSON.stringify(buildStateSyncPayload()));

    if (match.state === 'playing' && !isGameplayPaused() && !match.banana && preservedTurnRemainingMs > 0) {
      startTurnTimer(preservedTurnRemainingMs);
    }

    for (let otherIdx = 0; otherIdx < getActivePlayerCount(); otherIdx++) {
      if (otherIdx !== i) sendTo(otherIdx, { type: 'opponentReconnected' });
    }
    return;
  }

  const reconnectingSpectator = requestedRole === 'spectator' ? findSpectatorByToken(msg.token) : null;
  if (reconnectingSpectator) {
    reconnectingSpectator.ws = ws;
    reconnectingSpectator.connected = true;
    reconnectingSpectator.name = name;
    if (match.spectatorDisconnectTimers.has(reconnectingSpectator.id)) {
      clearTimeout(match.spectatorDisconnectTimers.get(reconnectingSpectator.id));
      match.spectatorDisconnectTimers.delete(reconnectingSpectator.id);
    }

    ws.send(JSON.stringify(buildSpectatorAssignedPayload(reconnectingSpectator)));
    if (match.state === 'waiting') {
      sendWaitingState();
    } else {
      ws.send(JSON.stringify(buildStateSyncPayload()));
    }
    broadcastSpectatorStatus();
    broadcastChallengeQueue();
    return;
  }

  if (requestedRole === 'spectator') {
    handleSpectatorJoin(ws, msg, name);
    return;
  }

  if (match.state === 'playing' || match.state === 'roundEnd') {
    ws.send(JSON.stringify({ type: 'error', message: 'Match already in progress' }));
    ws.close();
    return;
  }

  // Clear stale slots
  if (match.state === 'matchOver' || match.state === 'waiting') {
    for (let i = 0; i < 4; i++) {
      const p = match.players[i];
      if (p && !p.connected && !match.disconnectTimers[i]) {
        match.players[i] = null;
      }
    }
  }

  // Find slot
  const maxPlayers = getSupportedPlayerCount();
  let slot = -1;
  for (let i = 0; i < maxPlayers; i++) {
    if (!match.players[i] || (!match.players[i].connected && !match.disconnectTimers[i])) {
      slot = i;
      break;
    }
  }

  if (slot === -1) {
    ws.send(JSON.stringify({ type: 'error', message: 'Match is full' }));
    ws.close();
    return;
  }

  const token = crypto.randomUUID();
  match.players[slot] = {
    ws,
    name,
    connected: true,
    token,
    color: sanitizePlayerColor(msg.color, getDefaultPlayerColor(slot)),
  };
  ws.send(JSON.stringify(buildAssignedPayload(slot, { waiting: true })));
  sendWaitingState();

  maybeStartMatchFromWaiting();
}

function handleSpectatorJoin(ws, msg, name) {
  if (!canJoinAsSpectator()) {
    ws.send(JSON.stringify({ type: 'error', message: 'Spectator seats are full' }));
    ws.close();
    return;
  }

  const spec = makeSpectator(name || 'Spectator', ws, msg.token || crypto.randomUUID());
  ws.send(JSON.stringify(buildSpectatorAssignedPayload(spec)));

  if (match.state === 'waiting') {
    sendWaitingState();
  } else {
    ws.send(JSON.stringify(buildStateSyncPayload()));
  }

  broadcastSpectatorStatus();
  broadcastChallengeQueue();
}

function maybeStartMatchFromWaiting() {
  if (match.state !== 'waiting') return false;

  const neededPlayers = getRequiredPlayerCount();
  const connectedCount = getConnectedPlayerCount();
  const supportedPlayers = getSupportedPlayerCount();

  if (connectedCount > supportedPlayers) {
    broadcast({
      type: 'error',
      message: `${getModeConfig().label} supports up to ${supportedPlayers} player${supportedPlayers === 1 ? '' : 's'}. ${connectedCount} are connected.`,
    });
    return false;
  }

  if (connectedCount < neededPlayers) return false;
  if (match.settings.gameMode === 'hotseat') {
    // Hot seat: one socket controls multiple gorillas locally.
    match.rosterSize = getControlledPlayerCount();
  } else if (match.settings.gameMode === 'coop') {
    // Co-op: one socket controls 2 humans + 2 CPUs join the field.
    match.rosterSize = 4;
  } else {
    match.rosterSize = isSoloTurnMode() ? 1 : Math.min(supportedPlayers, connectedCount);
  }

  for (let i = 0; i < match.rosterSize; i++) {
    if (match.players[i]?.connected) {
      sendTo(i, buildAssignedPayload(i, { waiting: false }));
    }
  }

  match.scores = [0, 0, 0, 0];
  match.stats = match.stats.map(() => ({ shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 }));
  match.matchOverSummary = null;
  match.turnTimeRemainingMs = 0;
  match.turnTimerDeadline = 0;
  match.starting = true;
  setTimeout(() => { match.starting = false; newRound(); }, 1000);
  return true;
}

function handleChat(ws, msg) {
  const conn = findConnectionByWs(ws);
  if (!conn) return;
  const from = conn.client.name;
  const text = typeof msg.text === 'string' ? msg.text.trim().substring(0, 200) : '';
  if (!text) return;

  // Simple rate limiting: max 5 messages per 10 seconds
  const now = Date.now();
  const times = conn.role === 'player' ? match.chatTimes[conn.playerIdx] : conn.client.chatTimes;
  while (times.length && times[0] < now - 10000) times.shift();
  if (times.length >= 5) return;
  times.push(now);

  // Broadcast to everyone including sender so chat stays consistent.
  broadcast({
    type: 'chat',
    from,
    text,
    role: conn.role,
    player: conn.role === 'player' ? conn.playerIdx + 1 : 0,
    spectatorId: conn.role === 'spectator' ? conn.spectatorId : null,
  });
}

function handleTaunt(ws, msg) {
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) return;
  const animId = Math.max(1, Math.min(100, Math.floor(Number(msg.animId) || 1)));
  const from = match.players[playerIdx].name;
  broadcast({ type: 'taunt', player: playerIdx + 1, from, animId });
}

const PICNIC_COOLDOWN = 3000;

function handlePicnic(ws) {
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) return;
  const now = Date.now();
  if (!match.picnicCooldownUntil) match.picnicCooldownUntil = [0, 0, 0, 0];
  if (now < match.picnicCooldownUntil[playerIdx]) return;
  match.picnicCooldownUntil[playerIdx] = now + PICNIC_COOLDOWN;
  broadcast({ type: 'panic', player: playerIdx + 1, duration: 2000 });
}

function recordMiss() {
  const idx = match.currentPlayer - 1;
  match.missStreak[idx] = (match.missStreak[idx] || 0) + 1;
  if (match.missStreak[idx] >= 3 && match.missStreak[idx] % 2 === 1) {
    // Fire at streak 3, 5, 7, ... so it stays dramatic without spam
    broadcast({ type: 'frustrated', player: match.currentPlayer });
  }
  broadcast({ type: 'miss' });
}

function handleFire(ws, msg) {
  if (match.state !== 'playing') return;
  if (isGameplayPaused()) return;

  const wsSlot = match.players.findIndex(p => p && p.ws === ws);
  if (wsSlot === -1) return;

  // In hot seat mode, the single connected socket (slot 0) fires on behalf of
  // whichever gorilla's turn it currently is. Otherwise the firing slot must
  // match the current turn.
  let playerIdx;
  if (match.settings.gameMode === 'hotseat') {
    if (wsSlot !== 0) return;
    playerIdx = match.currentPlayer - 1;
  } else if (match.settings.gameMode === 'coop') {
    // Slots 0,1 are local humans (one socket = host). Slots 2,3 are CPUs and
    // are never fired via a socket — the server schedules their shots.
    if (wsSlot !== 0) return;
    if (match.currentPlayer < 1 || match.currentPlayer > 2) return;
    playerIdx = match.currentPlayer - 1;
  } else {
    if (wsSlot + 1 !== match.currentPlayer) return;
    playerIdx = wsSlot;
  }
  if (match.banana || match.bananas.length > 0 || match.fireInProgress) return;

  // Atomically claim the fire slot before any async work to prevent a second
  // message arriving before match.banana is set from launching a second projectile.
  match.fireInProgress = true;

  // Each fire action counts as a turn. Increment before expiry check so a turret
  // deployed on turn N is still alive for turns N+1 and N+2.
  match.turnNumber++;
  expireTurrets();

  const ammoType = msg.ammoType === 'turret' ? 'turret' : 'banana';
  const maxV = Math.min(999, match.settings.maxVelocity || 200);
  const angle = Math.max(0, Math.min(180, Number(msg.angle) || 0));

  if (ammoType === 'turret') {
    if ((match.turretCharges[playerIdx] || 0) <= 0) {
      // No charges left — silently fall back to a banana shot so the turn still
      // ends cleanly (client should have prevented this, but defend in depth).
      const velocity = Math.max(0, Math.min(maxV, Number(msg.velocity) || 0));
      startBanana(playerIdx, angle, velocity);
      return;
    }
    match.turretCharges[playerIdx]--;
    broadcast({
      type: 'turretCharges',
      charges: match.turretCharges.slice(0, getActivePlayerCount()),
    });
    const velocity = Math.max(0, Math.min(MAX_TURRET_LAUNCH_V, Number(msg.velocity) || 0));
    startTurretDeploy(playerIdx, angle, velocity);
    return;
  }

  const velocity = Math.max(0, Math.min(maxV, Number(msg.velocity) || 0));
  startBanana(playerIdx, angle, velocity);
}

function expireTurrets() {
  if (!match.turrets.length) return;
  const survivors = [];
  for (const t of match.turrets) {
    if (match.turnNumber >= t.expireTurn) {
      broadcast({ type: 'turretDestroy', id: t.id, reason: 'expired' });
    } else {
      survivors.push(t);
    }
  }
  match.turrets = survivors;
}

function startTurretDeploy(playerIdx, angle, velocity) {
  const gorilla = match.gorillas[playerIdx];
  const startX = gorilla.x + GORILLA_W / 2;
  const startY = gorilla.y - 4;

  const angleRad = getThrowSide(playerIdx) < 0
    ? (angle * Math.PI) / 180
    : ((180 - angle) * Math.PI) / 180;

  const vx = velocity * Math.cos(angleRad);
  const vy = -velocity * Math.sin(angleRad);

  // Stash the deploy projectile on match.banana so the existing off-screen /
  // turn-handoff machinery works. Sentinel type marks it as a turret deploy.
  match.banana = {
    x: startX, y: startY,
    vx, vy,
    tick: 0, frame: 0,
    distanceTraveled: 0,
    sunHitSent: false,
    type: 'turret-deploy',
    bouncesLeft: 0,
    hasClusterSplit: false,
    launchVelocity: velocity,
    ownerIdx: playerIdx,
  };

  match.stats[playerIdx].shots++;

  broadcast({
    type: 'throwAnim',
    player: playerIdx + 1,
    angle, velocity,
    bananaType: 'turret-deploy',
  });

  scheduleGameplayAction(() => {
    if (match.banana) simulateTurretDeploy();
  }, 300);
}

function simulateTurretDeploy() {
  if (!match.banana || match.state !== 'playing') return;
  const sim = match.banana;
  if (sim.type !== 'turret-deploy') return;

  let stepCount = 0;
  const maxSteps = SIM_HZ * 15;
  const mapCfg = getMapConfig();
  const biomeCfg = BIOME_CONFIGS[match.roundBiome] || BIOME_CONFIGS.city;

  const simInterval = setInterval(() => {
    if (!match.banana || match.state !== 'playing') {
      clearInterval(simInterval);
      return;
    }
    if (isGameplayPaused()) return;

    const gravity = BASE_GRAVITY * match.settings.gravityMultiplier * biomeCfg.gravMult;
    sim.vx += match.wind * 0.5 * DT;
    sim.vy += gravity * DT;

    const speed = Math.sqrt(sim.vx * sim.vx + sim.vy * sim.vy);
    const stepDist = speed * DT;
    const MAX_STEP_PX = 4;
    const subSteps = stepDist > MAX_STEP_PX ? Math.ceil(stepDist / MAX_STEP_PX) : 1;
    const subDT = DT / subSteps;

    for (let sub = 0; sub < subSteps; sub++) {
      sim.x += sim.vx * subDT;
      sim.y += sim.vy * subDT;
      sim.distanceTraveled += Math.abs(sim.vx * subDT) + Math.abs(sim.vy * subDT);

      // Gorilla hit during flight → dud, no turret planted, charge already spent
      for (let gi = 0; gi < match.gorillas.length; gi++) {
        const g = match.gorillas[gi];
        if (sim.x >= g.x && sim.x <= g.x + GORILLA_W && sim.y >= g.y && sim.y <= g.y + GORILLA_H) {
          clearInterval(simInterval);
          match.banana = null;
          broadcast({ type: 'turretDud', x: sim.x, y: sim.y });
          scheduleGuardedSwitchTurn(800);
          return;
        }
      }

      // Terrain hit → plant turret on top of the building surface
      if (sim.y >= 0) {
        for (let bi = 0; bi < match.buildings.length; bi++) {
          const b = match.buildings[bi];
          if (sim.x >= b.x && sim.x <= b.x + b.w && sim.y >= b.y && sim.y <= mapCfg.h) {
            // Confirm we're not in a carved explosion crater
            let carved = false;
            for (const e of match.explosions) {
              const dx = sim.x - e.x;
              const dy = sim.y - e.y;
              if (dx * dx + dy * dy <= e.radius * e.radius) { carved = true; break; }
            }
            if (carved) break; // keep flying
            clearInterval(simInterval);
            plantTurret(sim.ownerIdx, sim.x, b.y);
            match.banana = null;
            scheduleGuardedSwitchTurn(500);
            return;
          }
        }
      }
    }

    sim.frame = Math.floor(sim.distanceTraveled / 15) % 4;
    sim.tick++;
    stepCount++;

    // Ground-level landing (between buildings or in a gap)
    if (sim.y >= mapCfg.h && sim.x >= 0 && sim.x <= mapCfg.w) {
      clearInterval(simInterval);
      plantTurret(sim.ownerIdx, sim.x, mapCfg.h - TURRET_H);
      match.banana = null;
      scheduleGuardedSwitchTurn(500);
      return;
    }

    // Off-screen → lost (charge already spent)
    if (sim.x < -50 || sim.x > mapCfg.w + 50 || sim.y > mapCfg.h + 50 || stepCount > maxSteps) {
      clearInterval(simInterval);
      match.banana = null;
      broadcast({ type: 'turretDud', x: sim.x, y: sim.y });
      scheduleGuardedSwitchTurn(400);
      return;
    }

    if (sim.tick % BROADCAST_INTERVAL === 0) {
      broadcast({ type: 'banana', x: sim.x, y: sim.y, frame: sim.frame, bananaType: 'turret-deploy' });
    }
  }, 1000 / SIM_HZ);
}

function plantTurret(ownerIdx, x, surfaceY) {
  const id = nextTurretId++;
  // Position turret sitting on top of the surface (top-left of its AABB)
  const turret = {
    id,
    ownerIdx,
    x: x - TURRET_W / 2,
    y: surfaceY - TURRET_H,
    cx: x,                        // center x for targeting math
    cy: surfaceY - TURRET_H / 2,  // center y for targeting math
    aimAngle: 0,
    lastFireTick: -999,
    expireTurn: match.turnNumber + TURRET_LIFETIME_TURNS,
  };
  match.turrets.push(turret);
  broadcast({
    type: 'turretDeploy',
    id: turret.id,
    playerIdx: ownerIdx,
    x: turret.x,
    y: turret.y,
    cx: turret.cx,
    cy: turret.cy,
    expireTurn: turret.expireTurn,
  });
}

function tickTurretsAgainstBanana(sim) {
  // Called from inside simulateBanana's per-tick loop. Returns true if the
  // banana was shot down (caller should end sim early).
  if (!match.turrets.length) return false;

  const mapH = getMapConfig().h;
  const bananaSpeed = Math.sqrt(sim.vx * sim.vx + sim.vy * sim.vy);

  for (const t of match.turrets) {
    if (t.ownerIdx === match.currentPlayer - 1) continue; // ignore friendly bananas
    const dx = sim.x - t.cx;
    const dy = sim.y - t.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > TURRET_FIRE_RANGE_SQ) continue;

    // Line-of-sight check — turret can't shoot through standing buildings
    if (!turretHasLoS(t.cx, t.cy, sim.x, sim.y, mapH)) continue;

    t.aimAngle = Math.atan2(dy, dx);

    // Hit probability scales down with distance and banana speed
    const dist = Math.sqrt(d2);
    const distFactor = 1 - (dist / TURRET_FIRE_RANGE) * 0.5;       // 0.5–1.0 (closer = easier)
    const speedFactor = Math.max(0.2, 1 - bananaSpeed / 300);      // 0.2–1.0 (faster = harder)
    const hitProb = TURRET_HIT_PROB_PER_TICK * distFactor * speedFactor;

    if (Math.random() < hitProb) {
      broadcast({
        type: 'turretFire',
        id: t.id,
        tx: sim.x, ty: sim.y,
        hit: true,
      });
      // Banana destroyed by turret — cosmetic poof, no terrain damage, no kill credit
      broadcast({ type: 'turretKill', x: sim.x, y: sim.y });
      return true;
    }

    if ((sim.tick - t.lastFireTick) >= TURRET_COSMETIC_MISS_EVERY) {
      t.lastFireTick = sim.tick;
      // Fire multiple miss tracers with spread so the turret looks like it's hosing the area
      for (let mi = 0; mi < TURRET_COSMETIC_MISS_COUNT; mi++) {
        const spread = (Math.random() - 0.5) * 30;
        broadcast({
          type: 'turretFire',
          id: t.id,
          tx: sim.x + spread, ty: sim.y + spread,
          hit: false,
        });
      }
    }
  }
  return false;
}

// Returns true if there is a clear line of sight between (x1,y1) and (x2,y2),
// i.e. no non-collapsed building AABB intersects the segment.
function turretHasLoS(x1, y1, x2, y2, mapH) {
  for (let bi = 0; bi < match.buildings.length; bi++) {
    if (match.collapsedBuildingIndices && match.collapsedBuildingIndices.has(bi)) continue;
    const b = match.buildings[bi];
    if (segmentIntersectsAABB(x1, y1, x2, y2, b.x, b.y, b.x + b.w, mapH)) {
      return false;
    }
  }
  return true;
}

// Slab method: does segment (x1,y1)-(x2,y2) clip inside AABB [ax,bx] x [ay,by]?
function segmentIntersectsAABB(x1, y1, x2, y2, ax, ay, bx, by) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tmin = 0, tmax = 1;
  // X slab
  if (Math.abs(dx) < 0.001) {
    if (x1 < ax || x1 > bx) return false;
  } else {
    const t1 = (ax - x1) / dx;
    const t2 = (bx - x1) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax < tmin) return false;
  }
  // Y slab
  if (Math.abs(dy) < 0.001) {
    if (y1 < ay || y1 > by) return false;
  } else {
    const t1 = (ay - y1) / dy;
    const t2 = (by - y1) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  return tmax >= tmin;
}

function destroyTurretsInBlast(ex, ey, radius) {
  if (!match.turrets.length) return;
  const r2 = radius * radius;
  const survivors = [];
  for (const t of match.turrets) {
    const dx = t.cx - ex;
    const dy = t.cy - ey;
    if (dx * dx + dy * dy <= r2) {
      broadcast({ type: 'turretDestroy', id: t.id, reason: 'explosion', x: t.cx, y: t.cy });
    } else {
      survivors.push(t);
    }
  }
  match.turrets = survivors;
}

function checkBananaHitsTurret(sim) {
  // Direct hit on a turret AABB — destroy turret but let the banana continue.
  if (!match.turrets.length) return;
  for (let i = match.turrets.length - 1; i >= 0; i--) {
    const t = match.turrets[i];
    if (sim.x >= t.x && sim.x <= t.x + TURRET_W && sim.y >= t.y && sim.y <= t.y + TURRET_H) {
      match.turrets.splice(i, 1);
      broadcast({ type: 'turretDestroy', id: t.id, reason: 'hit', x: t.cx, y: t.cy });
    }
  }
}

function handleRematch(ws) {
  if (match.state !== 'matchOver') return;
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx !== getHostPlayerIndex()) {
    ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start a rematch' }));
    return;
  }
  const neededPlayers = getRequiredPlayerCount();
  const connectedCount = getConnectedPlayerCount();
  if (connectedCount < neededPlayers) return;
  if (connectedCount > getSupportedPlayerCount()) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `${getModeConfig().label} supports up to ${getSupportedPlayerCount()} player${getSupportedPlayerCount() === 1 ? '' : 's'}. ${connectedCount} are connected.`,
    }));
    return;
  }
  match.rosterSize = isSoloTurnMode() ? 1 : Math.min(getSupportedPlayerCount(), connectedCount);
  if (getModeConfig().key === 'hotseat' || match.settings.gameMode === 'hotseat') {
    match.rosterSize = getControlledPlayerCount();
  }
  if (match.settings.gameMode === 'coop') {
    match.rosterSize = 4;
  }
  match.scores = [0, 0, 0, 0];
  match.stats = match.stats.map(() => ({ shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 }));
  match.roundNumber = 0;
  match.gauntletLevel = 0;
  match.turnNumber = 0;
  match.turrets = [];
  match.banana = null;
  match.bananas = [];
  match.matchOverSummary = null;
  match.turnTimeRemainingMs = 0;
  match.turnTimerDeadline = 0;
  match.turretCharges = [TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE];
  match.state = 'playing';
  newRound();
}

function handleNewMatch(ws) {
  if (match.state !== 'matchOver') return;
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx !== getHostPlayerIndex()) {
    ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start a new match' }));
    return;
  }
  // Go back to waiting/setup
  clearAllIntervals();
  match.state = 'waiting';
  match.scores = [0, 0, 0, 0];
  match.stats = match.stats.map(() => ({ shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 }));
  match.rosterSize = 0;
  match.roundNumber = 0;
  match.gauntletLevel = 0;
  match.turnNumber = 0;
  match.artilleryShots = 0;
  match.banana = null;
  match.bananas = [];
  match.turrets = [];
  match.matchOverSummary = null;
  match.turnTimeRemainingMs = 0;
  match.turnTimerDeadline = 0;
  match.turretCharges = [TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE, TURRET_CHARGES_PER_LIFE];
  broadcast({ type: 'returnToSetup' });
}

function handleClearMatch(ws) {
  // Only allow from the currently assigned host slot.
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx !== getHostPlayerIndex()) {
    ws.send(JSON.stringify({ type: 'error', message: 'Only the host can clear the match' }));
    return;
  }
  clearAllIntervals();
  // Disconnect all players
  for (let i = 0; i < 4; i++) {
    if (match.disconnectTimers[i]) {
      clearTimeout(match.disconnectTimers[i]);
      match.disconnectTimers[i] = null;
    }
    const p = match.players[i];
    if (p && p.connected && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({ type: 'matchCleared' }));
      p.ws.close();
    }
  }
  for (const spec of match.spectators.values()) {
    if (spec?.connected && spec.ws.readyState === 1) {
      spec.ws.send(JSON.stringify({ type: 'matchCleared' }));
      spec.ws.close();
    }
  }
  match = createMatch();
}

function handleSetProfile(ws, msg) {
  const conn = findConnectionByWs(ws);
  if (!conn) return;

  if (conn.role === 'spectator') {
    if (typeof msg.name === 'string') {
      conn.client.name = msg.name.trim().substring(0, 20) || conn.client.name;
    }
    sendToSpectator(conn.client, buildSpectatorAssignedPayload(conn.client));
    broadcastSpectatorStatus();
    broadcastChallengeQueue();
    return;
  }

  const playerIdx = conn.playerIdx;
  const player = match.players[playerIdx];
  if (typeof msg.name === 'string') {
    player.name = msg.name.trim().substring(0, 20) || player.name;
  }
  if (typeof msg.color === 'string') {
    player.color = sanitizePlayerColor(msg.color, player.color || getDefaultPlayerColor(playerIdx));
  }

  sendTo(playerIdx, buildAssignedPayload(playerIdx, { waiting: match.state === 'waiting' }));

  if (match.state === 'waiting') {
    sendWaitingState();
    return;
  }

  broadcast(buildStateSyncPayload());
}

function handleChallengePlayer(ws, msg) {
  const spec = findSpectatorByWs(ws);
  if (!spec) {
    ws.send(JSON.stringify({ type: 'error', message: 'Only spectators can challenge players' }));
    return;
  }

  const targetPlayer = Math.floor(Number(msg.targetPlayer) || 0);
  const activeCount = getActivePlayerCount();
  if (targetPlayer < 1 || targetPlayer > activeCount || !match.players[targetPlayer - 1]) {
    ws.send(JSON.stringify({ type: 'error', message: 'That player seat is not available to challenge' }));
    return;
  }

  const existing = match.challengeQueue.find(entry => entry.spectatorId === spec.id);
  if (existing) {
    existing.targetPlayer = targetPlayer;
    existing.spectatorName = spec.name;
  } else {
    match.challengeQueue.push({
      spectatorId: spec.id,
      spectatorToken: spec.token,
      spectatorName: spec.name,
      targetPlayer,
      createdAt: Date.now(),
    });
  }

  sendToSpectator(spec, {
    type: 'challengeQueued',
    targetPlayer,
    targetName: getPlayerNamesView()[targetPlayer - 1] || `Player ${targetPlayer}`,
  });
  broadcastChallengeQueue();
}

function handleAcceptChallenge(ws) {
  if (match.state !== 'matchOver') {
    ws.send(JSON.stringify({ type: 'error', message: 'Challenges can be accepted after the match ends' }));
    return;
  }

  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) return;

  const nextChallenge = getNextChallengeForSlot(playerIdx);
  if (!nextChallenge) {
    ws.send(JSON.stringify({ type: 'error', message: 'No queued challenge for your seat' }));
    return;
  }

  if (!claimQueuedChallengeForSlot(playerIdx, { convertOldPlayer: true })) {
    ws.send(JSON.stringify({ type: 'error', message: 'No connected challenger is ready for your seat' }));
    return;
  }

  broadcastChallengeQueue();
}

function handleSetPaused(ws, msg) {
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) return;
  if (playerIdx >= getActivePlayerCount()) return;
  if (typeof msg.paused !== 'boolean') return;
  setGameplayPaused(msg.paused, playerIdx);
}

function handleSetSettings(ws, msg) {
  if (match.state !== 'waiting' || match.starting) return;
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx !== getHostPlayerIndex()) return;

  const s = match.settings;

  // Match settings
  if (msg.roundsToWin != null) {
    s.roundsToWin = Math.max(
      SETTINGS_LIMITS.roundsToWin.min,
      Math.min(SETTINGS_LIMITS.roundsToWin.max, Math.floor(Number(msg.roundsToWin)) || 3)
    );
  }
  if (VALID_GAME_MODES.includes(msg.gameMode)) s.gameMode = msg.gameMode;
  if (Object.prototype.hasOwnProperty.call(MAP_SIZES, msg.mapSize)) s.mapSize = msg.mapSize;
  if (SETTINGS_LIMITS.turnTimers.includes(Number(msg.turnTimer))) s.turnTimer = Number(msg.turnTimer);

  // World
  if ([...BIOME_LIST, 'random'].includes(msg.biome)) s.biome = msg.biome;
  if ([...WEATHER_LIST, 'random'].includes(msg.weather)) s.weather = msg.weather;
  if (SETTINGS_LIMITS.timeOfDayOptions.includes(msg.timeOfDay)) s.timeOfDay = msg.timeOfDay;

  // Physics
  const validGravities = SETTINGS_LIMITS.gravities;
  const grav = parseFloat(msg.gravity);
  if (validGravities.includes(grav)) s.gravityMultiplier = grav;
  if (SETTINGS_LIMITS.windIntensities.includes(msg.windIntensity)) s.windIntensity = msg.windIntensity;
  const validMaxVel = SETTINGS_LIMITS.maxVelocities;
  if (validMaxVel.includes(parseInt(msg.maxVelocity))) s.maxVelocity = parseInt(msg.maxVelocity);
  if (msg.friendlyFire !== undefined) s.friendlyFire = msg.friendlyFire !== false;
  if (BANANA_LIST.includes(msg.bananaType) || msg.bananaType === 'random') s.bananaType = msg.bananaType;
  const validExplosions = SETTINGS_LIMITS.explosionRadii;
  if (validExplosions.includes(parseInt(msg.explosionRadius))) s.explosionRadius = parseInt(msg.explosionRadius);

  // Aesthetics
  if (SETTINGS_LIMITS.shakeIntensities.includes(msg.shakeIntensity)) s.shakeIntensity = msg.shakeIntensity;
  if (SETTINGS_LIMITS.trailStyles.includes(msg.trailStyle)) s.trailStyle = msg.trailStyle;
  if (msg.crtOverlay !== undefined) s.crtOverlay = msg.crtOverlay === true;

  // Hot seat: the host configures the second local player’s name/color via match settings.
  if (typeof msg.player2Name === 'string') {
    const trimmed = msg.player2Name.trim().substring(0, 20);
    s.player2Name = trimmed || 'Player 2';
  }
  if (typeof msg.player2Color === 'string') {
    s.player2Color = sanitizePlayerColor(msg.player2Color, getDefaultPlayerColor(1));
  }

  broadcast({ type: 'settingsSync', settings: s });
  sendWaitingState();
  maybeStartMatchFromWaiting();
}

function handleLeaveMatch(ws) {
  const conn = findConnectionByWs(ws);
  if (!conn) return;

  if (conn.role === 'spectator') {
    const spec = conn.client;
    removeSpectatorChallenges(spec.id);
    if (match.spectatorDisconnectTimers.has(spec.id)) {
      clearTimeout(match.spectatorDisconnectTimers.get(spec.id));
      match.spectatorDisconnectTimers.delete(spec.id);
    }
    match.spectators.delete(spec.id);
    try {
      ws.send(JSON.stringify({ type: 'leftMatch' }));
    } catch (err) {}
    broadcastSpectatorStatus();
    broadcastChallengeQueue();
    return;
  }

  const playerIdx = conn.playerIdx;

  const playerName = match.players[playerIdx]?.name || `Player ${playerIdx + 1}`;
  if (match.disconnectTimers[playerIdx]) {
    clearTimeout(match.disconnectTimers[playerIdx]);
    match.disconnectTimers[playerIdx] = null;
  }

  try {
    ws.send(JSON.stringify({ type: 'leftMatch' }));
  } catch (err) {}

  match.players[playerIdx] = null;
  claimQueuedChallengeForSlot(playerIdx);

  const anyConnected = match.players.some(p => p?.connected);
  if (!anyConnected) {
    clearAllIntervals();
    if (getSpectatorCount() === 0) {
      match = createMatch();
      return;
    }
  }

  clearAllIntervals();
  clearPauseState();
  match.state = 'waiting';
  match.rosterSize = 0;
  match.matchOverSummary = null;
  match.banana = null;
  match.bananas = [];
  match.turrets = [];
  match.collapsedBuildingIndices = new Set();

  broadcast({ type: 'opponentLeft', player: playerIdx + 1, playerName });

  sendWaitingState();
  maybeStartMatchFromWaiting();
}

function handleDisconnect(ws) {
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) {
    const spec = findSpectatorByWs(ws);
    if (!spec) return;

    spec.connected = false;
    spec.ws = null;
    broadcastSpectatorStatus();

    const timer = setTimeout(() => {
      match.spectatorDisconnectTimers.delete(spec.id);
      match.spectators.delete(spec.id);
      removeSpectatorChallenges(spec.id);
      if (!match.players.some(p => p) && getSpectatorCount() === 0) {
        clearAllIntervals();
        match = createMatch();
        return;
      }
      broadcastSpectatorStatus();
      broadcastChallengeQueue();
    }, DISCONNECT_TIMEOUT_MS);
    match.spectatorDisconnectTimers.set(spec.id, timer);
    return;
  }

  match.players[playerIdx].connected = false;
  const playerName = match.players[playerIdx].name || `Player ${playerIdx + 1}`;

  // Clear turn timer so the disconnected player's timer doesn't fire
  stopTurnTimer(true);

  if (match.state === 'waiting') {
    sendWaitingState();
  } else {
    broadcast({ type: 'opponentDisconnected', player: playerIdx + 1, playerName });
  }

  match.disconnectTimers[playerIdx] = setTimeout(() => {
    match.players[playerIdx] = null;
    match.disconnectTimers[playerIdx] = null;
    match.banana = null;
    match.bananas = [];
    claimQueuedChallengeForSlot(playerIdx);

    const anyConnected = match.players.some(p => p?.connected);
    if (!anyConnected) {
      clearAllIntervals();
      if (getSpectatorCount() === 0) {
        match = createMatch();
        return;
      }
    }

    clearAllIntervals();
    clearPauseState();
    match.state = 'waiting';
    match.rosterSize = 0;
    match.matchOverSummary = null;
    match.turrets = [];
    match.collapsedBuildingIndices = new Set();
    broadcast({ type: 'opponentTimedOut', player: playerIdx + 1, playerName });
    sendWaitingState();
  }, DISCONNECT_TIMEOUT_MS);
}

// ─── Start server ────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Bananageddon server listening on port ${PORT}`);
  console.log('Share one of these with other players:');

  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`  http://${addr.address}:${PORT}`);
      }
    }
  }
  console.log(`  http://localhost:${PORT}`);
});
