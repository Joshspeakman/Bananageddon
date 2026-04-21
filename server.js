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
} = Shared;

const PORT = parseInt(process.env.PORT, 10) || 3000;

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
  moon:        { windMult: 0.0, gravMult: 0.17 },
  underwater:  { windMult: 0.8, gravMult: 0.4 },
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
const TURRET_CHARGES_PER_MATCH = 2;
const TURRET_FIRE_RANGE = 180;
const TURRET_FIRE_RANGE_SQ = TURRET_FIRE_RANGE * TURRET_FIRE_RANGE;
const TURRET_HIT_PROB_PER_TICK = 0.05;
const TURRET_COSMETIC_MISS_EVERY = 3;   // sim ticks between cosmetic tracer bursts (lower = more shots)
const TURRET_COSMETIC_MISS_COUNT = 2;   // how many miss tracers to fire per burst
const TURRET_LIFETIME_TURNS = 2;        // alive for this many opponent turns after deploy
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

const ALLOWED_FILES = new Set(['index.html', 'game.js', 'net.js', 'shared.js', 'styles.css', 'lighting.js', 'particles.js', 'background.js', 'robotic.mp3', 'Gameplay BG.mp3', 'Victory Screen.mp3', 'reganati-swag-national-anthem-414505.mp3', 'reganati-fartysoup-mcdouble-414392.mp3', 'reganati-singularity-funkyglitchy-videogame-music-512162.mp3', 'reganati-fruity-dx10-synth-ringtone-411349.mp3', 'reganati-fartysoup-mctriple-414508.mp3', 'freesound_community-gasp-6253.mp3']);

const httpServer = http.createServer((req, res) => {
  // /status endpoint — returns match availability info
  if (req.url === '/status') {
    const hasPlayers = match.players.some(p => p && p.connected);
    const playerCount = match.players.filter(p => p && p.connected).length;
    const playerNames = match.players
      .filter(p => p && p.connected)
      .map(p => p.name);
    const body = JSON.stringify({
      active: hasPlayers,
      state: match.state,
      playerCount,
      playerNames,
      gameMode: match.settings.gameMode,
      mapSize: match.settings.mapSize,
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
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// ─── Default settings (classic) ─────────────────────────────────────────────
const CLASSIC_SETTINGS = { ...DEFAULT_SETTINGS };

// ─── Match state ─────────────────────────────────────────────────────────────
let match = null;

function createMatch() {
  return {
    players: [null, null, null, null],
    scores: [0, 0, 0, 0],
    settings: { ...CLASSIC_SETTINGS },
    rosterSize: 0,
    currentPlayer: 1,
    state: 'waiting',
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
    turnTimerInterval: null,
    weatherTickInterval: null,
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
    turretCharges: [TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH],
    turnNumber: 0,
    gauntletLevel: 0,
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

function getConnectedPlayerNames() {
  return match.players
    .filter(p => p?.connected)
    .map(p => p.name);
}

function getActivePlayerCount() {
  const mode = match.settings.gameMode;
  if (match.rosterSize > 0 && match.state !== 'waiting') {
    return Math.min(match.rosterSize, getControlledPlayerCount(mode));
  }
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
  return Array.from({ length: count }, (_, i) => match.players[i]?.name || `Player ${i + 1}`);
}

function getPlayerTeamsView(mode = match.settings.gameMode) {
  const count = getActivePlayerCount();
  if (mode === 'team') {
    return Array.from({ length: count }, (_, i) => i % 2);
  }
  return Array.from({ length: count }, (_, i) => i);
}

function getTeamIndexForSlot(slotIdx, mode = match.settings.gameMode) {
  return mode === 'team' ? slotIdx % 2 : slotIdx;
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
  };
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
}

function sendTo(playerIdx, msg) {
  const p = match.players[playerIdx];
  if (p && p.connected && p.ws.readyState === 1) {
    p.ws.send(JSON.stringify(msg));
  }
}

function sendWaitingState() {
  const payload = {
    type: 'waiting',
    mode: match.settings.gameMode,
    requiredPlayers: getRequiredPlayerCount(),
    supportedPlayers: getSupportedPlayerCount(),
    connectedPlayers: getConnectedPlayerCount(),
    playerNames: getConnectedPlayerNames(),
  };

  for (let i = 0; i < match.players.length; i++) {
    if (match.players[i]?.connected) {
      sendTo(i, { ...payload, player: i + 1 });
    }
  }
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
  match.gorillas = placeGorillas(match.buildings, rng, getRoundGorillaCount(mode));

  // Calculate building mass for collapse detection
  match.buildingMass = match.buildings.map(b => b.w * (mapCfg.h - b.y));

  // Wind
  let effectiveWindIntensity = match.settings.windIntensity;
  if (mode === 'gauntlet') {
    const gauntletWind = ['calm', 'normal', 'gusty', 'storm'];
    effectiveWindIntensity = gauntletWind[Math.min(gauntletWind.length - 1, Math.floor(match.gauntletLevel / 2))];
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
  match.collapsedBuildingIndices = new Set();
  match.turnNumber = 0;
  // Alternate starting player across rounds so P1 doesn't always open
  {
    if (isSoloTurnMode(mode)) {
      match.currentPlayer = 1;
    } else if (mode === 'team' || mode === 'koth') {
      const activeCount = Math.max(1, getActivePlayerCount());
      match.currentPlayer = ((match.roundNumber - 1) % activeCount) + 1;
    } else {
      match.currentPlayer = (match.roundNumber % 2 === 1) ? 1 : 2;
    }
  }
  match.state = 'playing';
  match.panicSent = [false, false, false, false];
  match.artilleryShots = 0;
  match.windShearFlipped = false;

  // Clear previous intervals
  if (match.weatherTickInterval) { clearInterval(match.weatherTickInterval); match.weatherTickInterval = null; }
  if (match.erosionInterval) { clearInterval(match.erosionInterval); match.erosionInterval = null; }
  if (match.turnTimerInterval) { clearInterval(match.turnTimerInterval); match.turnTimerInterval = null; }

  // Dynamic wind for storm/sandstorm weather
  if (weatherCfg.dynamicWind) {
    const interval = (weatherCfg.windChangeInterval || 5) * 1000;
    match.weatherTickInterval = setInterval(() => {
      if (match.state !== 'playing') return;
      match.wind = match.baseWind + (Math.random() * 10 - 5) * windIntensityMult;
      match.wind = Math.max(-30, Math.min(30, match.wind));
      broadcast({ type: 'weatherTick', wind: match.wind });
    }, interval);
  }

  // Acid rain erosion
  if (match.roundWeather === 'acidrain') {
    match.erosionInterval = setInterval(() => {
      if (match.state !== 'playing') return;
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

function startTurnTimer() {
  if (match.turnTimerInterval) { clearInterval(match.turnTimerInterval); match.turnTimerInterval = null; }
  if (match.settings.turnTimer <= 0) return;

  match.turnStartTime = Date.now();
  match.turnTimerInterval = setInterval(() => {
    if (match.state !== 'playing') {
      clearInterval(match.turnTimerInterval);
      match.turnTimerInterval = null;
      return;
    }
    const elapsed = (Date.now() - match.turnStartTime) / 1000;
    if (elapsed >= match.settings.turnTimer) {
      clearInterval(match.turnTimerInterval);
      match.turnTimerInterval = null;
      if (!match.banana) {
        const rng = mulberry32(Date.now() & 0xFFFFFF);
        const angle = Math.floor(rng() * 180);
        const velocity = Math.floor(rng() * match.settings.maxVelocity);
        startBanana(match.currentPlayer - 1, angle, velocity);
      }
    }
  }, 1000);
}

function switchTurn() {
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
  } else if (mode === 'team' || mode === 'koth') {
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

  setTimeout(() => {
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
  const effectiveExpRadius = bananaCfg.radius != null ? bananaCfg.radius : match.settings.explosionRadius;

  const simInterval = setInterval(() => {
    if (!match.banana || match.state !== 'playing') {
      clearInterval(simInterval);
      return;
    }

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
      const CINEMATIC_TRIG_SQ = 180 * 180;
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
        recordMiss();
        setTimeout(() => switchTurn(), 500);
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
      for (let i = 0; i < 3; i++) {
        const spreadAngle = (i - 1) * 0.3;
        const cvx = sim.vx + Math.cos(spreadAngle) * 20;
        const cvy = sim.vy + Math.sin(spreadAngle) * 15;
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
      recordMiss();
      setTimeout(() => switchTurn(), 600);
      return;
    }

    // Off-screen check
    if (sim.x < -50 || sim.x > mapCfg.w + 50 || sim.y > mapCfg.h + 50 || stepCount > maxSteps) {
      clearInterval(simInterval);
      match.banana = null;
      recordMiss();
      setTimeout(() => switchTurn(), 500);
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

    const gravity = BASE_GRAVITY * match.settings.gravityMultiplier * biomeCfg.gravMult;
    cb.vx += match.wind * 0.5 * DT;
    cb.vy += gravity * DT;
    cb.x += cb.vx * DT;
    cb.y += cb.vy * DT;
    cb.tick++;
    stepCount++;

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
        setTimeout(() => switchTurn(), 500);
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
  const SUN_Y = 40;
  const SUN_RADIUS = 30;

  // 1. Gorilla hit
  for (let gi = 0; gi < match.gorillas.length; gi++) {
    const g = match.gorillas[gi];
    if (bx >= g.x && bx <= g.x + GORILLA_W && by >= g.y && by <= g.y + GORILLA_H) {
      clearInterval(simInterval);
      match.banana = null;

      if (sim.type === 'dud') {
        broadcast({ type: 'dud', x: bx, y: by, hitPlayer: gi + 1 });
        setTimeout(() => switchTurn(), 1000);
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
      match.stats[match.currentPlayer - 1].hits++;

      determineWinnerAndScore(gi, g.x + GORILLA_W / 2, g.y + GORILLA_H / 2);

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
          setTimeout(() => switchTurn(), 1000);
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
          setTimeout(() => determineWinnerAndScore(blastHit, gBlast.x + GORILLA_W / 2, gBlast.y + GORILLA_H / 2), 400);
        } else {
          checkBuildingCollapse(hitBuildingIdx, exp);
          setTimeout(() => switchTurn(), 600);
        }
        return true;
      }
    }
  }

  // 3. Sun/moon hit
  {
    const dx = bx - SUN_X;
    const dy = by - SUN_Y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= SUN_RADIUS * SUN_RADIUS && !sim.sunHitSent) {
      sim.sunHitSent = true;
      broadcast({ type: 'sunHit' });
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

function determineWinnerAndScore(hitGorillaIdx, deathX, deathY) {
  const currentIdx = match.currentPlayer - 1;
  let scoringIdx;

  if (isFriendlyHit(currentIdx, hitGorillaIdx)) {
    if (!match.settings.friendlyFire) {
      recordMiss();
      setTimeout(() => switchTurn(), 500);
      return false;
    }

    scoringIdx = getFallbackWinnerForOwnGoal(currentIdx);
    if (scoringIdx == null) {
      recordMiss();
      setTimeout(() => switchTurn(), 500);
      return false;
    }
  } else {
    scoringIdx = currentIdx;
  }

  // Broadcast gorilla death now that the friendly-fire check has passed
  if (deathX !== undefined) {
    broadcast({ type: 'gorillaDeath', player: hitGorillaIdx + 1, x: deathX, y: deathY });
  }

  match.scores[scoringIdx]++;
  match.missStreak[scoringIdx] = 0;

  const winState = getMatchWinState(scoringIdx);

  broadcast({
    type: 'gorillaHit',
    winner: scoringIdx + 1,
    winnerLabel: winState.winnerLabel,
    scores: getDisplayScores(),
    playerNames: getPlayerNamesView(),
    playerTeams: getPlayerTeamsView(),
    scoreMode: getScoreMode(),
    teamScores: getScoreMode() === 'team' ? getTeamScores() : null,
    scoreSummary: getScoreSummary(),
    slowmo: winState.matchOver,
  });

  if (winState.matchOver) {
    match.state = 'matchOver';
    clearAllIntervals();
    match.matchOverTimer = setTimeout(() => {
      match.matchOverTimer = null;
      broadcast({
        type: 'matchOver',
        winner: scoringIdx + 1,
        winnerLabel: winState.winnerLabel,
        finalScores: getDisplayScores(),
        playerNames: getPlayerNamesView(),
        playerTeams: getPlayerTeamsView(),
        scoreMode: getScoreMode(),
        teamScores: getScoreMode() === 'team' ? getTeamScores() : null,
        scoreSummary: getScoreSummary(),
        stats: match.stats.slice(0, getActivePlayerCount()),
      });
    }, 3000);
  } else {
    match.state = 'roundEnd';
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
  if (match.turnTimerInterval) { clearInterval(match.turnTimerInterval); match.turnTimerInterval = null; }
  if (match.roundEndTimer) { clearTimeout(match.roundEndTimer); match.roundEndTimer = null; }
  if (match.matchOverTimer) { clearTimeout(match.matchOverTimer); match.matchOverTimer = null; }
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
        setTimeout(() => determineWinnerAndScore(gi, gCollapseX, gCollapseY), 500);
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
      case 'rematch': handleRematch(ws); break;
      case 'newMatch': handleNewMatch(ws); break;
      case 'setSettings': handleSetSettings(ws, msg); break;
      case 'clearMatch': handleClearMatch(ws); break;
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

  // If no slots are occupied and no reconnect timers are pending, the match is
  // truly abandoned — reset so new players can join cleanly.
  // We must NOT reset when a disconnected player still has a valid reconnect
  // timer running, as that would destroy their reconnect slot.
  const anyPlayerOrTimer = match.players.some((p, i) => p !== null || match.disconnectTimers[i] !== null);
  if (!anyPlayerOrTimer) {
    clearAllIntervals();
    match = createMatch();
  }

  // Reconnect check
  if (match.state === 'playing' || match.state === 'roundEnd' || match.state === 'matchOver') {
    for (let i = 0; i < 4; i++) {
      const p = match.players[i];
      if (p && !p.connected && p.name === name && p.token === msg.token) {
        p.ws = ws;
        p.connected = true;
        if (match.disconnectTimers[i]) {
          clearTimeout(match.disconnectTimers[i]);
          match.disconnectTimers[i] = null;
        }
        ws.send(JSON.stringify({
          type: 'assigned',
          player: i + 1,
          playerNames: getPlayerNamesView(),
          playerTeams: getPlayerTeamsView(),
          scoreMode: getScoreMode(),
          teamScores: getScoreMode() === 'team' ? getTeamScores() : null,
          activePlayerCount: getActivePlayerCount(),
          token: p.token,
        }));
        // Resync round state
        ws.send(JSON.stringify(buildRoundStartPayload()));
        for (const exp of match.explosions) {
          ws.send(JSON.stringify({ type: 'explosion', x: exp.x, y: exp.y, radius: exp.radius }));
        }
        // Re-send existing turrets so the reconnecting client can render them
        for (const t of match.turrets) {
          ws.send(JSON.stringify({
            type: 'turretDeploy',
            id: t.id,
            playerIdx: t.ownerIdx,
            x: t.x,
            y: t.y,
            cx: t.cx,
            cy: t.cy,
            expireTurn: t.expireTurn,
          }));
        }
        for (let otherIdx = 0; otherIdx < getActivePlayerCount(); otherIdx++) {
          if (otherIdx !== i) sendTo(otherIdx, { type: 'opponentReconnected' });
        }
        return;
      }
    }
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
      if (p && !p.connected) {
        if (match.disconnectTimers[i]) {
          clearTimeout(match.disconnectTimers[i]);
          match.disconnectTimers[i] = null;
        }
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
  match.players[slot] = { ws, name, connected: true, token };
  sendWaitingState();

  maybeStartMatchFromWaiting();
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
  match.rosterSize = isSoloTurnMode() ? 1 : Math.min(supportedPlayers, connectedCount);

  for (let i = 0; i < match.rosterSize; i++) {
    if (match.players[i]?.connected) {
      sendTo(i, {
        type: 'assigned',
        player: i + 1,
        playerNames: getPlayerNamesView(),
        playerTeams: getPlayerTeamsView(),
        scoreMode: getScoreMode(),
        teamScores: getScoreMode() === 'team' ? getTeamScores() : null,
        activePlayerCount: getActivePlayerCount(),
        token: match.players[i].token,
      });
    }
  }

  match.scores = [0, 0, 0, 0];
  match.stats = match.stats.map(() => ({ shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 }));
  setTimeout(() => newRound(), 1000);
  return true;
}

function handleChat(ws, msg) {
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) return;
  const from = match.players[playerIdx].name;
  const text = typeof msg.text === 'string' ? msg.text.trim().substring(0, 200) : '';
  if (!text) return;

  // Simple rate limiting: max 5 messages per 10 seconds
  const now = Date.now();
  const times = match.chatTimes[playerIdx];
  while (times.length && times[0] < now - 10000) times.shift();
  if (times.length >= 5) return;
  times.push(now);

  // Broadcast to ALL players including sender so everyone sees every message
  broadcast({ type: 'chat', from, text });
}

const TAUNT_WINDOW_MS = 60000;   // rolling window
const TAUNT_LIMIT     = 20;      // max taunts per window
const TAUNT_COOLDOWN  = 15000;   // cooldown duration when limit exceeded

function handleTaunt(ws, msg) {
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) return;
  const now = Date.now();

  // Still cooling down from previous burst
  if (now < match.tauntCooldownUntil[playerIdx]) {
    sendTo(playerIdx, { type: 'tauntCooldown', ms: match.tauntCooldownUntil[playerIdx] - now });
    return;
  }

  // Prune old timestamps
  const times = match.tauntTimes[playerIdx];
  while (times.length && times[0] < now - TAUNT_WINDOW_MS) times.shift();

  if (times.length >= TAUNT_LIMIT) {
    match.tauntCooldownUntil[playerIdx] = now + TAUNT_COOLDOWN;
    times.length = 0;
    sendTo(playerIdx, { type: 'tauntCooldown', ms: TAUNT_COOLDOWN });
    return;
  }

  times.push(now);
  const animId = Math.max(1, Math.min(100, Math.floor(Number(msg.animId) || 1)));
  const from = match.players[playerIdx].name;
  // Broadcast to everyone (so multi-player observers also see it); include player index
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

  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) return;
  if (playerIdx + 1 !== match.currentPlayer) return;
  if (match.banana || match.bananas.length > 0) return;

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

  setTimeout(() => {
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
          setTimeout(() => switchTurn(), 800);
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
            setTimeout(() => switchTurn(), 500);
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
      setTimeout(() => switchTurn(), 500);
      return;
    }

    // Off-screen → lost (charge already spent)
    if (sim.x < -50 || sim.x > mapCfg.w + 50 || sim.y > mapCfg.h + 50 || stepCount > maxSteps) {
      clearInterval(simInterval);
      match.banana = null;
      broadcast({ type: 'turretDud', x: sim.x, y: sim.y });
      setTimeout(() => switchTurn(), 400);
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
  if (playerIdx !== 0) {
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
  match.scores = [0, 0, 0, 0];
  match.stats = match.stats.map(() => ({ shots: 0, hits: 0, nearMisses: 0, longestShot: 0, fastestBanana: 0 }));
  match.roundNumber = 0;
  match.gauntletLevel = 0;
  match.turnNumber = 0;
  match.turrets = [];
  match.banana = null;
  match.turretCharges = [TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH];
  match.state = 'playing';
  newRound();
}

function handleNewMatch(ws) {
  if (match.state !== 'matchOver') return;
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx !== 0) {
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
  match.turrets = [];
  match.turretCharges = [TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH, TURRET_CHARGES_PER_MATCH];
  broadcast({ type: 'returnToSetup' });
}

function handleClearMatch(ws) {
  // Only allow from a connected player (host = player 0)
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx !== 0) {
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
  match = createMatch();
}

function handleSetSettings(ws, msg) {
  if (match.state !== 'waiting') return;
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx !== 0) return;

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

  broadcast({ type: 'settingsSync', settings: s });
  sendWaitingState();
  maybeStartMatchFromWaiting();
}

function handleDisconnect(ws) {
  const playerIdx = match.players.findIndex(p => p && p.ws === ws);
  if (playerIdx === -1) return;

  match.players[playerIdx].connected = false;
  const playerName = match.players[playerIdx].name || `Player ${playerIdx + 1}`;

  // Clear turn timer so the disconnected player's timer doesn't fire
  if (match.turnTimerInterval) {
    clearInterval(match.turnTimerInterval);
    match.turnTimerInterval = null;
  }

  if (match.state === 'waiting') {
    sendWaitingState();
  } else {
    // Notify ALL other connected players
    for (let i = 0; i < 4; i++) {
      if (i !== playerIdx) sendTo(i, { type: 'opponentDisconnected', player: playerIdx + 1, playerName });
    }
  }

  match.disconnectTimers[playerIdx] = setTimeout(() => {
    match.players[playerIdx] = null;
    match.disconnectTimers[playerIdx] = null;
    if (match.banana) match.banana = null;

    const anyConnected = match.players.some(p => p?.connected);
    if (!anyConnected) {
      clearAllIntervals();
      match = createMatch();
      return;
    }

    match.state = 'waiting';
    // Notify remaining connected players
    for (let i = 0; i < 4; i++) {
      if (i !== playerIdx) sendTo(i, { type: 'opponentTimedOut', player: playerIdx + 1, playerName });
    }
    sendWaitingState();
  }, 60000);
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
