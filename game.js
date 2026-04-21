// Bananageddon — Client game engine (game.js)
// Handles rendering, sprites, audio, input, and game state display.
// All network communication goes through Net (net.js).

(function () {
  'use strict';

  const Shared = globalThis.MonkeyMaddnessShared || {};

  // ─── Shared configs (must match server) ───────────────────────────────────
  const MAP_SIZES = Shared.MAP_SIZES || {
    normal: { w: 640, h: 480, minBuildings: 8, maxBuildings: 12 },
    large:  { w: 960, h: 540, minBuildings: 12, maxBuildings: 18 },
    xl:     { w: 1280, h: 600, minBuildings: 16, maxBuildings: 24 },
    huge:   { w: 1920, h: 720, minBuildings: 24, maxBuildings: 36 },
  };
  const MODE_CONFIGS = Shared.MODE_CONFIGS || {};
  const DEFAULT_SETTINGS = Shared.DEFAULT_SETTINGS || {
    roundsToWin: 3,
    gravityMultiplier: 1,
    explosionRadius: 30,
    timeOfDay: 'day',
    mapSize: 'normal',
    biome: 'city',
    weather: 'clear',
    windIntensity: 'normal',
    maxVelocity: 200,
    bananaType: 'standard',
    gameMode: 'classic',
    turnTimer: 0,
    friendlyFire: true,
    shakeIntensity: 'normal',
    trailStyle: 'dotted',
    crtOverlay: false,
  };

  // ─── Active logical dimensions ─────────────────────────────────────────────
  let LOGICAL_W = 640;
  let LOGICAL_H = 480;
  const GORILLA_W = 28;
  const GORILLA_H = 28;
  let SUN_X = LOGICAL_W / 2;
  let SUN_Y = 40;
  const SUN_RADIUS = 30;

  // ─── Biome color palettes ──────────────────────────────────────────────────
  const BIOME_COLORS = {
    city:        { sky: '#0000AA', buildings: ['#55FFFF', '#FF55FF', '#AAAAAA'], windowLit: '#FFFF55', windowUnlit: '#555555' },
    desert:      { sky: '#C2A060', buildings: ['#D2A679', '#C4965A', '#B8860B'], windowLit: '#FFD700', windowUnlit: '#8B7355' },
    arctic:      { sky: '#87CEEB', buildings: ['#B0C4DE', '#87CEEB', '#F0F8FF'], windowLit: '#E0FFFF', windowUnlit: '#708090' },
    jungle:      { sky: '#004400', buildings: ['#228B22', '#2E8B57', '#006400'], windowLit: '#7FFF00', windowUnlit: '#2F4F2F' },
    volcanic:    { sky: '#1A0000', buildings: ['#4A0000', '#8B0000', '#333333'], windowLit: '#FF4500', windowUnlit: '#1C1C1C' },
    moon:        { sky: '#000011', buildings: ['#808080', '#696969', '#A9A9A9'], windowLit: '#CCCCCC', windowUnlit: '#333333' },
    underwater:  { sky: '#003366', buildings: ['#008B8B', '#006666', '#20B2AA'], windowLit: '#00FFFF', windowUnlit: '#004444' },
    postapoc:    { sky: '#2A2A1A', buildings: ['#555555', '#666644', '#444444'], windowLit: '#AA8800', windowUnlit: '#333322' },
    cyberpunk:   { sky: '#0A0A1E', buildings: ['#1A1A2E', '#16213E', '#0F3460'], windowLit: '#FF00FF', windowUnlit: '#1A002E' },
  };

  // ─── Sky colors by time of day ─────────────────────────────────────────────
  const SKY_COLORS = { day: '#0000AA', night: '#000022', dawn: '#0000AA', dusk: '#0000AA' };
  const STAR_COLOR = '#FFFFFF';
  const GORILLA_COLOR = '#8B5A2B';
  const GORILLA_DARK = '#5C3317';
  const BANANA_COLOR = '#FFFF55';
  const SUN_COLOR = '#FFFF55';

  // ─── Canvas setup ──────────────────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Offscreen terrain canvas
  let terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = LOGICAL_W;
  terrainCanvas.height = LOGICAL_H;
  let terrainCtx = terrainCanvas.getContext('2d');
  terrainCtx.imageSmoothingEnabled = false;

  function setLogicalSize(w, h) {
    LOGICAL_W = w;
    LOGICAL_H = h;
    SUN_X = LOGICAL_W / 2;
    SUN_Y = 40;
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false;
    terrainCanvas.width = w;
    terrainCanvas.height = h;
    terrainCtx = terrainCanvas.getContext('2d');
    terrainCtx.imageSmoothingEnabled = false;
    Lighting.resize(w, h);
    Particles.resize(w, h);
    Background.resize(w, h);
    resizeCanvas();
  }

  function resizeCanvas() {
    const container = document.getElementById('game-container');
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / LOGICAL_W, ch / LOGICAL_H);
    canvas.style.width = Math.floor(LOGICAL_W * scale) + 'px';
    canvas.style.height = Math.floor(LOGICAL_H * scale) + 'px';
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ─── Seeded PRNG (mulberry32, must match server) ───────────────────────────
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const MAX_PLAYER_SLOTS = 4;

  function buildDefaultScores(count = MAX_PLAYER_SLOTS) {
    return Array.from({ length: count }, () => 0);
  }

  function buildDefaultPlayerNames(count = MAX_PLAYER_SLOTS) {
    return Array.from({ length: count }, (_, idx) => `Player ${idx + 1}`);
  }

  function buildDefaultPlayerTeams(count = MAX_PLAYER_SLOTS) {
    return Array.from({ length: count }, (_, idx) => idx);
  }

  // ─── Game State ─────────────────────────────────────────────────────────────
  let gameState = 'title';
  let previousState = null;
  let myPlayer = 0;
  let myName = 'Player';
  let scores = buildDefaultScores();
  let playerNames = buildDefaultPlayerNames();
  let playerTeams = buildDefaultPlayerTeams();
  let scoreMode = 'individual';
  let teamScores = null;
  let currentPlayer = 1;
  let wind = 0;

  // Settings (synced from server)
  let settings = {
    ...DEFAULT_SETTINGS,
    musicEnabled: true,
  };

  // Round state
  let roundBiome = 'city';
  let roundWeather = 'clear';
  let roundTimeOfDay = 'day';
  let roundNumber = 0;
  let maxVelocity = 200;

  // City
  let buildings = [];
  let citySeed = 0;

  // Gorillas
  let gorillas = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  let gorillaAnim = [0, 0];
  let gorillaVisible = [true, true];
  let victoryDanceTimer = null;
  let panicPlayers = new Set();
  let flinchTimers = {};
  let phewTimers = {};             // near-miss "phew" arm-wipe reaction
  let frustratedTimers = {};       // miss-streak grimace
  let boredTimers = {};            // idle-too-long on your turn
  let missedTimers = {};           // shooter slump on miss
  let turnStartedAt = 0;
  let activeTaunts = [null, null, null, null]; // per-player {defIdx, start, dur}
  let reactionStart = {};          // per-player start time for body animation

  // Banana
  let banana = null;
  let bananaTrail = [];
  let previousTrail = [];
  let showBanana = false;
  let activeBananaType = 'standard';

  // Cluster bananas
  let clusterBananas = [];

  // Anti-banana turrets
  const TURRET_W = 16;
  const TURRET_H = 16;
  let turrets = [];              // {id, ownerIdx, x, y, cx, cy, aimAngle, barrelKick, expireTurn}
  let turretTracers = [];        // {x1,y1,x2,y2,life,maxLife}
  let turretCharges = [2, 2, 2, 2];

  // Explosion
  let explosions = [];
  let carvedExplosions = [];

  // Napalm fire patches
  let napalmPatches = [];

  // Death chunks
  let deathChunks = [];

  // Sun / Moon emote state
  // Possible emotes: 'idle', 'watching', 'worried', 'surprised', 'winking', 'hit',
  //                  'happy' (on miss), 'shocked' (on gorilla hit), 'celebrating'
  let sunEmote = 'idle';
  let sunEmoteTimer = null;
  let sunWatchFrame = 0; // for eye tracking animation
  let sunSurprised = false; // kept for backward compat
  let sunSurpriseTimer = null;
  let sunWinking = false;
  let sunWinkTimer = null;

  function setSunEmote(emote, duration) {
    sunEmote = emote;
    if (sunEmoteTimer) clearTimeout(sunEmoteTimer);
    sunEmoteTimer = null;
    if (duration > 0) {
      sunEmoteTimer = setTimeout(() => {
        sunEmote = 'idle';
        sunEmoteTimer = null;
      }, duration);
    }
  }

  // Window twinkles
  let twinkleWindows = [];

  // Screen shake
  let shakeOffset = { x: 0, y: 0 };
  let shakeTimer = null;

  // Cinematic camera (near-miss zoom-and-follow)
  let cam = {
    zoom: 1, targetZoom: 1,
    x: 320, y: 240,
    targetX: 320, targetY: 240,
    phase: 'idle',      // 'idle' | 'in' | 'follow' | 'out'
    safetyTimer: null,
  };

  // Cinematic time dilation — scales world update dt while active. Does NOT affect
  // camera lerp, UI, or sprite reaction animations (those stay snappy/wall-clock).
  let cinematicTimeScale = 1;
  let cinematicOwnsBgAudio = false;

  // Slow motion
  let slowmoActive = false;
  let slowmoTimer = null;

  // Stars
  let stars = [];

  // Turn timer
  let turnTimerValue = 0;
  let turnTimerInterval = null;

  // Session token — persisted in sessionStorage so a page refresh can still reconnect
  let sessionToken = null;
  try { sessionToken = sessionStorage.getItem('mm_token'); } catch(e) {}

  // Auto-reconnect state
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 20; // 3s intervals ≈ 60s (matches server's 60s timer)

  // Building collapse tracking
  let collapsedBuildings = new Set();

  // ─── localStorage persistence ──────────────────────────────────────────────
  function saveSettings() {
    try {
      const s = {};
      s.playerName = document.getElementById('player-name').value;
      s.gameMode = document.getElementById('gamemode-select').value;
      s.roundsToWin = document.getElementById('rounds-to-win').value;
      s.mapSize = document.getElementById('mapsize-select').value;
      s.turnTimer = document.getElementById('turntimer-select').value;
      s.biome = document.getElementById('biome-select').value;
      s.weather = document.getElementById('weather-select').value;
      s.timeOfDay = document.getElementById('timeofday-select').value;
      s.gravity = document.getElementById('gravity-select').value;
      s.wind = document.getElementById('wind-select').value;
      s.maxVelocity = document.getElementById('maxvel-select').value;
      s.explosionRadius = document.getElementById('explosive-select').value;
      s.bananaType = document.getElementById('banana-select').value;
      s.friendlyFire = document.getElementById('friendlyfire-select').value;
      s.shake = document.getElementById('shake-select').value;
      s.trail = document.getElementById('trail-select').value;
      s.crt = document.getElementById('crt-select').value;
      s.music = document.getElementById('music-select').value;
      s.musicOrder = document.getElementById('music-order-select').value;
      s.effectsQuality = document.getElementById('effects-quality-select').value;
      localStorage.setItem('monkeyMaddnessSettings', JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem('monkeyMaddnessSettings');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.playerName) document.getElementById('player-name').value = s.playerName;
      if (s.gameMode) document.getElementById('gamemode-select').value = s.gameMode;
      if (s.roundsToWin) document.getElementById('rounds-to-win').value = s.roundsToWin;
      if (s.mapSize) document.getElementById('mapsize-select').value = s.mapSize;
      if (s.turnTimer) document.getElementById('turntimer-select').value = s.turnTimer;
      if (s.biome) document.getElementById('biome-select').value = s.biome;
      if (s.weather) document.getElementById('weather-select').value = s.weather;
      if (s.timeOfDay) document.getElementById('timeofday-select').value = s.timeOfDay;
      if (s.gravity) document.getElementById('gravity-select').value = s.gravity;
      if (s.wind) document.getElementById('wind-select').value = s.wind;
      if (s.maxVelocity) document.getElementById('maxvel-select').value = s.maxVelocity;
      if (s.explosionRadius) document.getElementById('explosive-select').value = s.explosionRadius;
      if (s.bananaType) document.getElementById('banana-select').value = s.bananaType;
      if (s.friendlyFire) document.getElementById('friendlyfire-select').value = s.friendlyFire;
      if (s.shake) document.getElementById('shake-select').value = s.shake;
      if (s.trail) document.getElementById('trail-select').value = s.trail;
      if (s.crt) document.getElementById('crt-select').value = s.crt;
      if (s.music) document.getElementById('music-select').value = s.music;
      if (s.musicOrder) document.getElementById('music-order-select').value = s.musicOrder;
      if (s.effectsQuality) document.getElementById('effects-quality-select').value = s.effectsQuality;
    } catch (e) { /* ignore */ }
  }

  function syncSetupSelectionsToState() {
    settings.roundsToWin = parseInt(document.getElementById('rounds-to-win').value, 10) || settings.roundsToWin;
    settings.gameMode = document.getElementById('gamemode-select').value;
    settings.mapSize = document.getElementById('mapsize-select').value;
    settings.turnTimer = parseInt(document.getElementById('turntimer-select').value, 10) || 0;
    settings.biome = document.getElementById('biome-select').value;
    settings.weather = document.getElementById('weather-select').value;
    settings.timeOfDay = document.getElementById('timeofday-select').value;
    settings.gravityMultiplier = parseFloat(document.getElementById('gravity-select').value) || settings.gravityMultiplier;
    settings.windIntensity = document.getElementById('wind-select').value;
    settings.maxVelocity = parseInt(document.getElementById('maxvel-select').value, 10) || settings.maxVelocity;
    settings.explosionRadius = parseInt(document.getElementById('explosive-select').value, 10) || settings.explosionRadius;
    settings.bananaType = document.getElementById('banana-select').value;
    settings.friendlyFire = document.getElementById('friendlyfire-select').value !== 'false';
    settings.shakeIntensity = document.getElementById('shake-select').value;
    settings.trailStyle = document.getElementById('trail-select').value;
    settings.crtOverlay = document.getElementById('crt-select').value === 'true';
    settings.musicEnabled = document.getElementById('music-select').value !== 'false';
  }

  function resetToClassic() {
    document.getElementById('gamemode-select').value = 'classic';
    document.getElementById('rounds-to-win').value = '3';
    document.getElementById('mapsize-select').value = 'normal';
    document.getElementById('turntimer-select').value = '0';
    document.getElementById('biome-select').value = 'city';
    document.getElementById('weather-select').value = 'clear';
    document.getElementById('timeofday-select').value = 'day';
    document.getElementById('gravity-select').value = '1';
    document.getElementById('wind-select').value = 'normal';
    document.getElementById('maxvel-select').value = '200';
    document.getElementById('explosive-select').value = '30';
    document.getElementById('banana-select').value = 'standard';
    document.getElementById('friendlyfire-select').value = 'true';
    document.getElementById('shake-select').value = 'normal';
    document.getElementById('trail-select').value = 'dotted';
    document.getElementById('crt-select').value = 'false';
    document.getElementById('music-select').value = 'true';
    document.getElementById('music-order-select').value = 'forward';
    document.getElementById('effects-quality-select').value = '2';
    syncSetupSelectionsToState();
    saveSettings();
  }

  // ─── Audio (Web Audio API) ─────────────────────────────────────────────────
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // One-time unlock on first user gesture
      const unlock = () => {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      };
      document.addEventListener('click', unlock, { once: true });
      document.addEventListener('keydown', unlock, { once: true });
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playThrowSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(200, t);
      osc.frequency.linearRampToValueAtTime(500, t + 0.12);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.12);
      // Noise burst layer for impact
      const bufSize = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const nSrc = ctx.createBufferSource(); nSrc.buffer = buf;
      const nGain = ctx.createGain(); nGain.gain.setValueAtTime(0.1, t);
      nGain.gain.linearRampToValueAtTime(0, t + 0.05);
      nSrc.connect(nGain).connect(ctx.destination);
      nSrc.start(t);
    } catch (e) {}
  }

  function playTurretBurst() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      // Short filtered-noise burst — "wild AA chatter"
      const bufSize = Math.floor(ctx.sampleRate * 0.07);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2400;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(t);
      // Brief square blip for mechanical character
      const osc = ctx.createOscillator(); const og = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = 520 + Math.random() * 160;
      og.gain.setValueAtTime(0.04, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(og).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.06);
    } catch (e) {}
  }

  function playTurretDeploySound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      // Low thud + metallic clang
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.2);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(g).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.3);

      const bufSize = Math.floor(ctx.sampleRate * 0.15);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 1800; filter.Q.value = 1.5;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.18, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      src.connect(filter).connect(ng).connect(ctx.destination);
      src.start(t);
    } catch (e) {}
  }

  function playTurretDestroySound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.3);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(g).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.4);
    } catch (e) {}
  }

  function playExplosionSound() {
    const ctx = ensureAudio();
    const bufferSize = ctx.sampleRate * 0.3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(ctx.currentTime);
  }

  function playGorillaHitSound() {
    playExplosionSound();
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, ctx.currentTime + 0.1);
    osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.12, ctx.currentTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + 0.1);
    osc.stop(ctx.currentTime + 0.5);
  }

  function playSunHitSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      [1200, 1800, 2400].forEach((f, i) => {
        const osc = ctx.createOscillator(); const g = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.15 - i * 0.04, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15 + i * 0.05);
        osc.connect(g).connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.2 + i * 0.05);
      });
    } catch (e) {}
  }

  function playBounceSound() {
    try {
      const ctx = ensureAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {}
  }

  function playDudSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.5);
      const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
      lfo.type = 'sine'; lfo.frequency.value = 8; lfoGain.gain.value = 80;
      lfo.connect(lfoGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0.12, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain).connect(ctx.destination);
      lfo.start(t); osc.start(t); lfo.stop(t + 0.55); osc.stop(t + 0.55);
    } catch (e) {}
  }

  function playThunderSound() {
    const ctx = ensureAudio();
    // Low frequency rumble (deep boom)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.8);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 2);

    // Noise burst overlay for crackling
    const bufLen = ctx.sampleRate * 0.3;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2000;
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
    noise.start(ctx.currentTime);
  }

  // ─── Background music (MP3) playlist ─────────────────────────────────────
  const BG_PLAYLIST = [
    'robotic.mp3',
    'reganati-swag-national-anthem-414505.mp3',
    'reganati-fartysoup-mcdouble-414392.mp3',
    'reganati-singularity-funkyglitchy-videogame-music-512162.mp3',
    'reganati-fruity-dx10-synth-ringtone-411349.mp3',
    'reganati-fartysoup-mctriple-414508.mp3',
  ];
  let bgTrackIndex = 0;
  let bgAudio = null;

  const victoryMusic = new Audio('Victory%20Screen.mp3');
  victoryMusic.loop = false;
  victoryMusic.volume = 0.4;

  function isMusicEnabled() {
    const sel = document.getElementById('music-select');
    return !sel || sel.value !== 'false';
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────
  function appendChatMessage(name, text, playerIdx) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    if (name) {
      const nameSpan = document.createElement('span');
      const chatClass = playerIdx >= 0 && playerIdx < 4 ? `p${playerIdx + 1}` : 'system';
      nameSpan.className = 'chat-msg-name ' + chatClass;
      nameSpan.textContent = name + ': ';
      div.appendChild(nameSpan);
    }
    const textSpan = document.createElement('span');
    textSpan.className = 'chat-msg-text';
    textSpan.textContent = text;
    div.appendChild(textSpan);
    log.appendChild(div);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function openChatInput() {
    const row = document.getElementById('chat-input-row');
    const input = document.getElementById('chat-input');
    if (!row || !input) return;
    row.style.display = 'flex';
    input.value = '';
    input.focus();
  }

  function closeChatInput() {
    const row = document.getElementById('chat-input-row');
    const input = document.getElementById('chat-input');
    if (!row || !input) return;
    row.style.display = 'none';
    input.blur();
  }

  function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    closeChatInput();
    if (!text) return;
    // Server broadcasts back to everyone including us, so no optimistic display needed
    Net.send({ type: 'chat', text });
  }

  function updateMusicHUD() {
    const el = document.getElementById('hud-music');
    if (!el) return;
    if (isMusicEnabled()) {
      el.textContent = '\u266A MUSIC ON [M]';
      el.classList.remove('music-off');
    } else {
      el.textContent = '\u266A MUSIC OFF [M]';
      el.classList.add('music-off');
    }
  }

  function applyMusicSetting() {
    settings.musicEnabled = isMusicEnabled();
    if (!settings.musicEnabled) {
      stopBGMusic();
      stopVictoryMusic();
      updateMusicHUD();
      return;
    }
    if (gameState === 'playing') {
      startBGMusic();
    }
    updateMusicHUD();
  }

  function advanceBGTrack() {
    if (!isMusicEnabled()) return;
    playBGTrack(nextBGIndex(bgTrackIndex));
  }

  function getBGOrder() {
    const sel = document.getElementById('music-order-select');
    return sel ? sel.value : 'forward';
  }

  function nextBGIndex(current) {
    const order = getBGOrder();
    const n = BG_PLAYLIST.length;
    if (order === 'backward') return ((current - 1) + n) % n;
    if (order === 'random') {
      if (n <= 1) return 0;
      let r;
      do { r = Math.floor(Math.random() * n); } while (r === current);
      return r;
    }
    return (current + 1) % n; // forward
  }

  function playBGTrack(index) {
    if (bgAudio) {
      bgAudio.pause();
      bgAudio.onended = null;
    }
    bgTrackIndex = ((index % BG_PLAYLIST.length) + BG_PLAYLIST.length) % BG_PLAYLIST.length;
    bgAudio = new Audio(BG_PLAYLIST[bgTrackIndex]);
    bgAudio.volume = 0.3;
    bgAudio.onended = () => { if (isMusicEnabled()) playBGTrack(nextBGIndex(bgTrackIndex)); };
    bgAudio.play().catch(() => {});
  }

  function startBGMusic() {
    if (!isMusicEnabled()) return;
    victoryMusic.pause();
    victoryMusic.currentTime = 0;
    // If music is already playing, don't restart it
    if (bgAudio && !bgAudio.paused) return;
    playBGTrack(bgTrackIndex);
  }

  function stopBGMusic() {
    if (bgAudio) {
      bgAudio.pause();
      bgAudio.onended = null;
      bgAudio.currentTime = 0;
    }
  }

  function startVictoryMusic() {
    if (!isMusicEnabled()) return;
    stopBGMusic();
    victoryMusic.currentTime = 0;
    victoryMusic.play().catch(() => {});
  }

  function stopVictoryMusic() {
    victoryMusic.pause();
    victoryMusic.currentTime = 0;
  }

  let victoryAudioTimer = null;
  function playVictorySound() {
    const ctx = ensureAudio();
    const notes = [523, 659, 784];
    let i = 0;
    victoryAudioTimer = setInterval(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(notes[i % notes.length], ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
      i++;
    }, 125);
  }

  function stopVictorySound() {
    if (victoryAudioTimer) {
      clearInterval(victoryAudioTimer);
      victoryAudioTimer = null;
    }
  }

  function playBuildingCollapseSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const bufSize = Math.floor(ctx.sampleRate * 0.4);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 600;
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.3, t); gain.gain.linearRampToValueAtTime(0, t + 0.4);
      src.connect(filt).connect(gain).connect(ctx.destination);
      src.start(t);
    } catch (e) {}
  }

  function playNapalmSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 120;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 8;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 40;
      lfo.connect(lfoGain).connect(osc.frequency);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.18, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      osc.connect(gain).connect(ctx.destination);
      lfo.start(t); osc.start(t); lfo.stop(t + 0.8); osc.stop(t + 0.8);
    } catch (e) {}
  }

  function playGorillaDeathSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'square';
      osc.frequency.setValueAtTime(400, t); osc.frequency.exponentialRampToValueAtTime(60, t + 0.6);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.2, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.65);
    } catch (e) {}
  }

  function playCountdownBeep(n) {
    try {
      const ctx = ensureAudio();
      if (ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const freq = n === 1 ? 880 : 660;
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'square'; osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(g).connect(ctx.destination); osc.start(t); osc.stop(t + 0.2);
    } catch (e) {}
  }

  function playUIConfirm() {
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  }

  // ─── Weather ambient audio ────────────────────────────────────────────────
  let weatherAudioNodes = null;

  function startWeatherAudio(weather) {
    stopWeatherAudio();
    const actx = ensureAudio();
    if (!actx) return;
    const nodes = { ctx: actx, sources: [], gains: [] };

    const master = actx.createGain();
    master.gain.setValueAtTime(0, actx.currentTime);
    master.gain.linearRampToValueAtTime(1, actx.currentTime + 2); // fade in
    master.connect(actx.destination);
    nodes.master = master;

    if (weather === 'rain' || weather === 'acidrain' || weather === 'storm') {
      // Rain — filtered noise
      const bufLen = actx.sampleRate * 2;
      const buf = actx.createBuffer(1, bufLen, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const noise = actx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const filter = actx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = weather === 'storm' ? 800 : 1200;
      const gain = actx.createGain();
      gain.gain.value = weather === 'storm' ? 0.12 : 0.07;
      noise.connect(filter).connect(gain).connect(master);
      noise.start();
      nodes.sources.push(noise);
      nodes.gains.push(gain);

      if (weather === 'storm') {
        // Low rumble for storm
        const rumble = actx.createOscillator();
        rumble.type = 'sawtooth';
        rumble.frequency.value = 40;
        const rumbleGain = actx.createGain();
        rumbleGain.gain.value = 0.04;
        const rumbleFilter = actx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 80;
        rumble.connect(rumbleFilter).connect(rumbleGain).connect(master);
        rumble.start();
        nodes.sources.push(rumble);
        nodes.gains.push(rumbleGain);
      }
    }

    if (weather === 'snow') {
      // Soft wind hiss
      const bufLen = actx.sampleRate * 2;
      const buf = actx.createBuffer(1, bufLen, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const noise = actx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const filter = actx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 600;
      filter.Q.value = 0.5;
      const gain = actx.createGain();
      gain.gain.value = 0.03;
      noise.connect(filter).connect(gain).connect(master);
      noise.start();
      nodes.sources.push(noise);
      nodes.gains.push(gain);
    }

    if (weather === 'fog') {
      // Low drone
      const osc = actx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 80;
      const gain = actx.createGain();
      gain.gain.value = 0.025;
      osc.connect(gain).connect(master);
      osc.start();
      nodes.sources.push(osc);
      nodes.gains.push(gain);
    }

    if (weather === 'windshear' || weather === 'sandstorm') {
      // Howling wind — modulated noise
      const bufLen = actx.sampleRate * 2;
      const buf = actx.createBuffer(1, bufLen, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const noise = actx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const filter = actx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = weather === 'sandstorm' ? 400 : 700;
      filter.Q.value = 2;
      // LFO to modulate filter for howling effect
      const lfo = actx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.3;
      const lfoGain = actx.createGain();
      lfoGain.gain.value = weather === 'sandstorm' ? 300 : 400;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();
      const gain = actx.createGain();
      gain.gain.value = weather === 'sandstorm' ? 0.1 : 0.06;
      noise.connect(filter).connect(gain).connect(master);
      noise.start();
      nodes.sources.push(noise, lfo);
      nodes.gains.push(gain);
    }

    if (weather === 'acidrain') {
      // Sizzle overlay — filtered noise for a soft hiss, not a shrill oscillator
      const bufLen = actx.sampleRate * 2;
      const buf = actx.createBuffer(1, bufLen, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const noise = actx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const filter = actx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1600;
      filter.Q.value = 0.8;
      const gain = actx.createGain();
      gain.gain.value = 0.03;
      noise.connect(filter).connect(gain).connect(master);
      noise.start();
      nodes.sources.push(noise);
      nodes.gains.push(gain);
    }

    // Only keep nodes if we actually created sounds
    if (nodes.sources.length > 0) {
      weatherAudioNodes = nodes;
    }
  }

  function stopWeatherAudio() {
    if (!weatherAudioNodes) return;
    const nodes = weatherAudioNodes;
    weatherAudioNodes = null;
    try {
      // Fade out over 0.5s
      const now = nodes.ctx.currentTime;
      nodes.master.gain.linearRampToValueAtTime(0, now + 0.5);
      setTimeout(() => {
        nodes.sources.forEach(s => { try { s.stop(); } catch (e) {} });
        try { nodes.master.disconnect(); } catch (e) {}
      }, 600);
    } catch (e) {}
  }

  // ─── City generation (must match server exactly) ───────────────────────────
  function generateCity(seed, mapSize, biome) {
    const rng = mulberry32(seed);
    const cfg = MAP_SIZES[mapSize] || MAP_SIZES.normal;
    const W = cfg.w;
    const H = cfg.h;
    const numBuildings = cfg.minBuildings + Math.floor(rng() * (cfg.maxBuildings - cfg.minBuildings + 1));
    const blds = [];
    let x = 0;
    const buildingWidth = W / numBuildings;
    const colors = getBiomeColors(biome);

    for (let i = 0; i < numBuildings; i++) {
      const w = Math.floor(buildingWidth);
      const h = Math.floor(rng() * (H * 0.42)) + Math.floor(H * 0.17);
      const color = colors[Math.floor(rng() * colors.length)];
      blds.push({ x, w, h, y: H - h, color });
      x += w;
    }
    return blds;
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

  // ─── Drawing functions ────────────────────────────────────────────────────

  function generateStars() {
    stars = [];
    if (roundTimeOfDay === 'night' || roundTimeOfDay === 'dawn' || roundTimeOfDay === 'dusk') {
      const count = roundTimeOfDay === 'night' ? 120 :
                    roundTimeOfDay === 'dusk' ? 40 : 20;
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * LOGICAL_W,
          y: Math.random() * (LOGICAL_H * 0.5),
          brightness: 0.3 + Math.random() * 0.7,
          twinkleSpeed: 1 + Math.random() * 3,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  function getBiomeSkyColor() {
    const biomePalette = BIOME_COLORS[roundBiome];
    if (!biomePalette) return SKY_COLORS[roundTimeOfDay] || SKY_COLORS.day;
    if (roundTimeOfDay === 'night') {
      return '#000022';
    }
    if (roundTimeOfDay === 'dawn' || roundTimeOfDay === 'dusk') {
      return biomePalette.sky; // gradient handled by Background.renderSky
    }
    return biomePalette.sky;
  }

  function drawSky() {
    // Dawn/dusk get gradient sky from Background; day/night keep flat color
    if (roundTimeOfDay === 'dawn' || roundTimeOfDay === 'dusk') {
      Background.renderSky(ctx, roundTimeOfDay, roundBiome);
    } else {
      const skyColor = getBiomeSkyColor();
      ctx.fillStyle = skyColor;
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    }

    // Stars for night only (Background.renderSky handles dawn/dusk stars)
    if (stars.length > 0 && roundTimeOfDay !== 'dawn' && roundTimeOfDay !== 'dusk') {
      const t = performance.now() / 1000;
      let starAlpha = 1;
      if (roundTimeOfDay === 'dawn') starAlpha = 0.3;
      if (roundTimeOfDay === 'dusk') starAlpha = 0.5;
      for (const s of stars) {
        const flicker = 0.5 + 0.5 * Math.sin(t * s.twinkleSpeed + s.phase);
        const alpha = s.brightness * flicker * starAlpha;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
        ctx.fillRect(Math.floor(s.x), Math.floor(s.y), 2, 2);
      }
    }
  }

  function drawSun() {
    // Adjust sun position for dawn/dusk
    let cx = SUN_X;
    const r = 18;

    if (roundTimeOfDay === 'dawn') {
      cx = LOGICAL_W * 0.85; // Rising from east (right side)
    } else if (roundTimeOfDay === 'dusk') {
      cx = LOGICAL_W * 0.15; // Setting on west (left side)
    }

    if (roundTimeOfDay === 'night') {
      // Moon with face
      const cy = SUN_Y;
      ctx.fillStyle = '#CCCCCC';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // Crescent shadow
      ctx.fillStyle = '#000022';
      ctx.beginPath();
      ctx.arc(cx + 8, cy - 2, r - 2, 0, Math.PI * 2);
      ctx.fill();
      // Moon face on the lit portion
      drawCelestialFace(cx - 5, cy, sunEmote, true);
      return;
    }

    const cy = SUN_Y;
    const sunColor = SUN_COLOR;

    ctx.fillStyle = sunColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Rays - animated when celebrating
    const rayCount = 8;
    const now = performance.now() / 1000;
    for (let i = 0; i < rayCount; i++) {
      const baseAngle = (i / rayCount) * Math.PI * 2;
      const angle = sunEmote === 'celebrating'
        ? baseAngle + Math.sin(now * 6) * 0.15
        : baseAngle;
      const rayLen = sunEmote === 'celebrating'
        ? 8 + Math.sin(now * 8 + i) * 3
        : 8;
      const x1 = cx + Math.cos(angle) * (r + 2);
      const y1 = cy + Math.sin(angle) * (r + 2);
      const x2 = cx + Math.cos(angle) * (r + rayLen);
      const y2 = cy + Math.sin(angle) * (r + rayLen);
      ctx.strokeStyle = sunColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Face
    drawCelestialFace(cx, cy, sunEmote, false);
  }

  function drawCelestialFace(cx, cy, emote, isMoon) {
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;

    switch (emote) {
      case 'watching': {
        // Wide eyes tracking the banana
        const eyeOffX = banana ? Math.sign(banana.x - cx) * 1 : 0;
        const eyeOffY = banana ? Math.min(1, Math.max(-1, (banana.y - cy) * 0.02)) : 0;
        // Left eye (wide)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - 6, cy - 5, 5, 4);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - 5 + eyeOffX, cy - 4 + eyeOffY, 2, 2);
        // Right eye (wide)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx + 1, cy - 5, 5, 4);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx + 3 + eyeOffX, cy - 4 + eyeOffY, 2, 2);
        // Small open mouth (o shape)
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - 1, cy + 3, 3, 3);
        break;
      }

      case 'worried': {
        // Very wide eyes, eyebrows raised
        const eyeOffX = banana ? Math.sign(banana.x - cx) * 1 : 0;
        const eyeOffY = banana ? Math.min(1, Math.max(-1, (banana.y - cy) * 0.02)) : 0;
        // Eyebrows (raised)
        ctx.fillRect(cx - 6, cy - 8, 5, 1);
        ctx.fillRect(cx + 1, cy - 8, 5, 1);
        // Left eye (very wide)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - 6, cy - 6, 5, 5);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - 5 + eyeOffX, cy - 4 + eyeOffY, 2, 2);
        // Right eye
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx + 1, cy - 6, 5, 5);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx + 3 + eyeOffX, cy - 4 + eyeOffY, 2, 2);
        // Grimace mouth
        ctx.strokeStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 4);
        ctx.lineTo(cx - 1, cy + 5);
        ctx.lineTo(cx + 1, cy + 4);
        ctx.lineTo(cx + 3, cy + 5);
        ctx.stroke();
        break;
      }

      case 'surprised':
      case 'hit': {
        // Shocked wide eyes + big O mouth
        ctx.fillRect(cx - 5, cy - 5, 4, 4);
        ctx.fillRect(cx + 2, cy - 5, 4, 4);
        // O mouth
        ctx.beginPath();
        ctx.arc(cx, cy + 4, 3, 0, Math.PI * 2);
        ctx.stroke();
        if (emote === 'hit') {
          // X eyes for when banana hits the sun
          ctx.lineWidth = 2;
          // Left X
          ctx.beginPath();
          ctx.moveTo(cx - 6, cy - 6); ctx.lineTo(cx - 2, cy - 2);
          ctx.moveTo(cx - 2, cy - 6); ctx.lineTo(cx - 6, cy - 2);
          ctx.stroke();
          // Right X
          ctx.beginPath();
          ctx.moveTo(cx + 2, cy - 6); ctx.lineTo(cx + 6, cy - 2);
          ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx + 2, cy - 2);
          ctx.stroke();
          ctx.lineWidth = 1;
          // Big O mouth
          ctx.beginPath();
          ctx.arc(cx, cy + 4, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }

      case 'winking': {
        // Wink face
        ctx.fillRect(cx - 4, cy - 4, 3, 3); // left eye open
        ctx.fillRect(cx + 2, cy - 3, 3, 1); // right eye winking (line)
        // Smile
        ctx.beginPath();
        ctx.arc(cx, cy + 4, 3, 0, Math.PI);
        ctx.stroke();
        break;
      }

      case 'happy': {
        // Happy/relieved on miss - closed happy eyes + big smile
        // Happy eyes (^_^)
        ctx.beginPath();
        ctx.arc(cx - 3, cy - 3, 2, Math.PI, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + 3, cy - 3, 2, Math.PI, 0);
        ctx.stroke();
        // Big smile
        ctx.beginPath();
        ctx.arc(cx, cy + 3, 4, 0, Math.PI);
        ctx.fill();
        break;
      }

      case 'shocked': {
        // Gorilla was killed - jaw drop
        // Huge wide eyes
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - 6, cy - 6, 5, 5);
        ctx.fillRect(cx + 1, cy - 6, 5, 5);
        ctx.fillStyle = '#000000';
        // Tiny pupils
        ctx.fillRect(cx - 4, cy - 4, 2, 2);
        ctx.fillRect(cx + 3, cy - 4, 2, 2);
        // Huge open mouth
        ctx.fillRect(cx - 3, cy + 2, 6, 5);
        break;
      }

      case 'celebrating': {
        // Match over celebration
        const t = performance.now() / 1000;
        const bounce = Math.sin(t * 10) > 0;
        // Happy squint eyes
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx - 3, cy - 3, 2, Math.PI, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + 3, cy - 3, 2, Math.PI, 0);
        ctx.stroke();
        ctx.lineWidth = 1;
        // Alternating open/closed mouth
        if (bounce) {
          ctx.beginPath();
          ctx.arc(cx, cy + 3, 4, 0, Math.PI);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy + 4, 3, 0, Math.PI);
          ctx.stroke();
        }
        break;
      }

      default: {
        // Idle face - simple neutral
        ctx.fillRect(cx - 3, cy - 4, 2, 2);
        ctx.fillRect(cx + 1, cy - 4, 2, 2);
        // Small smile
        ctx.beginPath();
        ctx.arc(cx, cy + 3, 2, 0, Math.PI);
        ctx.stroke();
        break;
      }
    }
  }

  function drawBuildings() {
    ctx.drawImage(terrainCanvas, 0, 0);
    drawTwinkles();
  }

  function initTwinkles() {
    twinkleWindows = [];
    const biomePalette = BIOME_COLORS[roundBiome] || BIOME_COLORS.city;
    for (const b of buildings) {
      const rng = mulberry32(citySeed + b.x * 1000 + b.y);
      const winW = 4, winH = 4, gap = 2, padX = 4, padY = 4;
      for (let wy = b.y + padY; wy < LOGICAL_H - winH - gap; wy += winH + gap) {
        for (let wx = b.x + padX; wx < b.x + b.w - winW - padX; wx += winW + gap) {
          const isLit = rng() > 0.4;
          if (isLit && Math.random() < 0.15) {
            twinkleWindows.push({
              x: wx, y: wy, w: winW, h: winH,
              phase: Math.random() * Math.PI * 2,
              speed: 1.5 + Math.random() * 3,
            });
          }
        }
      }
    }
  }

  function drawTwinkles() {
    const now = performance.now() / 1000;
    for (const tw of twinkleWindows) {
      const glow = 0.3 + 0.7 * ((Math.sin(now * tw.speed + tw.phase) + 1) / 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${(glow * 0.45).toFixed(2)})`;
      ctx.fillRect(tw.x, tw.y, tw.w, tw.h);
    }
  }

  function buildTerrainCanvas() {
    terrainCtx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    const biomePalette = BIOME_COLORS[roundBiome] || BIOME_COLORS.city;

    for (let bi = 0; bi < buildings.length; bi++) {
      if (collapsedBuildings.has(bi)) continue;
      const b = buildings[bi];
      terrainCtx.fillStyle = b.color;
      terrainCtx.fillRect(b.x, b.y, b.w, LOGICAL_H - b.y);

      const rng = mulberry32(citySeed + b.x * 1000 + b.y);
      const winW = 4;
      const winH = 4;
      const gap = 2;
      const padX = 4;
      const padY = 4;
      for (let wy = b.y + padY; wy < LOGICAL_H - winH - gap; wy += winH + gap) {
        for (let wx = b.x + padX; wx < b.x + b.w - winW - padX; wx += winW + gap) {
          terrainCtx.fillStyle = rng() > 0.4 ? biomePalette.windowLit : biomePalette.windowUnlit;
          terrainCtx.fillRect(wx, wy, winW, winH);
        }
      }
    }

    for (const exp of carvedExplosions) {
      carveExplosion(exp.x, exp.y, exp.radius);
    }
  }

  function carveExplosion(x, y, radius) {
    terrainCtx.save();
    terrainCtx.globalCompositeOperation = 'destination-out';
    terrainCtx.beginPath();
    terrainCtx.arc(x, y, radius, 0, Math.PI * 2);
    terrainCtx.fill();
    terrainCtx.restore();
  }

  // ─── Gorilla sprite ────────────────────────────────────────────────────────

  // ─── Dancing monkey overlay (match-over screen) ────────────────────────────
  let _danceAnimId = null;

  // Self-contained gorilla renderer for arbitrary canvas contexts.
  // cx/cy is the center point; sc is pixel scale; mirror flips horizontally.
  function drawDancingMonkey(c, cx, cy, sc, pose, face, mirror) {
    const GC = GORILLA_COLOR;
    const GD = GORILLA_DARK;
    c.save();
    c.translate(cx, cy);
    c.scale(mirror ? -sc : sc, sc);

    // Body
    c.fillStyle = GC;
    c.fillRect(-8, -6, 16, 14);
    // Head
    c.fillRect(-6, -12, 12, 8);
    // Legs
    c.fillRect(-6, 8, 5, 6);
    c.fillRect(1,  8, 5, 6);

    // Arms
    switch (pose) {
      case 0: c.fillRect(-12, -4, 4, 12); c.fillRect(8, -4, 4, 12); break; // both down
      case 1: c.fillRect(-12, -4, 4, 12); c.fillRect(8,-14, 4, 12); break; // R up
      case 2: c.fillRect(-12,-14, 4, 12); c.fillRect(8, -4, 4, 12); break; // L up
      case 3: c.fillRect(-12,-14, 4, 12); c.fillRect(8,-14, 4, 12); break; // both up
      case 4: c.fillRect(-12, -2, 4, 12); c.fillRect(8, -2, 4, 12); break; // slight up
    }

    // Face
    c.fillStyle = GD;
    switch (face) {
      case 'h': // happy
        c.fillRect(-3, -9, 2, 2);
        c.fillRect( 1, -9, 2, 2);
        c.fillRect(-3, -5, 6, 1);
        c.fillRect(-4, -6, 1, 1);
        c.fillRect( 3, -6, 1, 1);
        break;
      case 't': // tongue out
        c.fillRect(-3, -9, 2, 2);
        c.fillRect( 1, -9, 2, 2);
        c.fillRect(-2, -6, 4, 2);
        c.fillStyle = '#FF5588';
        c.fillRect(-1, -4, 3, 2);
        break;
      default: // normal
        c.fillRect(-3, -9, 2, 2);
        c.fillRect( 1, -9, 2, 2);
        c.fillRect(-2, -6, 4, 2);
    }

    c.restore();
  }

  // Dance pose sequence (index = beat mod 8)
  const DANCE_POSES = [3, 0, 3, 4, 1, 3, 2, 3];

  function startDanceAnimation(winnerIdx) {
    stopDanceAnimation();
    const lCanvas = document.getElementById('monkey-canvas-left');
    const rCanvas = document.getElementById('monkey-canvas-right');
    if (!lCanvas || !rCanvas) return;
    const lc = lCanvas.getContext('2d');
    const rc = rCanvas.getContext('2d');
    lc.imageSmoothingEnabled = false;
    rc.imageSmoothingEnabled = false;

    const SC = 3.8; // pixel scale
    const LCX = lCanvas.width  / 2;
    const LCY = lCanvas.height * 0.58;
    const RCX = rCanvas.width  / 2;
    const RCY = rCanvas.height * 0.58;

    function frame() {
      const t    = Date.now();
      const beat = Math.floor(t / 210) % DANCE_POSES.length;
      const pose = DANCE_POSES[beat];
      const face = (Math.floor(t / 900) % 4 === 0) ? 't' : 'h';

      // Winner gets a bigger bounce; loser gets a smaller one
      const lBounce = Math.sin(t / 190) * (winnerIdx === 0 ? 8 : 4);
      const rBounce = Math.sin(t / 190) * (winnerIdx === 1 ? 8 : 4);

      lc.clearRect(0, 0, lCanvas.width, lCanvas.height);
      rc.clearRect(0, 0, rCanvas.width, rCanvas.height);

      drawDancingMonkey(lc, LCX, LCY - lBounce, SC, pose, face, false);
      // Right monkey faces left (mirror)
      drawDancingMonkey(rc, RCX, RCY - rBounce, SC, pose, face, true);

      _danceAnimId = requestAnimationFrame(frame);
    }

    _danceAnimId = requestAnimationFrame(frame);
  }

  function stopDanceAnimation() {
    if (_danceAnimId !== null) {
      cancelAnimationFrame(_danceAnimId);
      _danceAnimId = null;
    }
    // Clear canvases so they don't linger
    ['monkey-canvas-left', 'monkey-canvas-right'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.getContext('2d').clearRect(0, 0, el.width, el.height);
    });
  }


  function drawGorillaFace(cx, cy, kind) {
    ctx.fillStyle = GORILLA_DARK;
    switch (kind) {
      case 'panic':
        ctx.fillRect(cx - 4, cy - 10, 4, 3);
        ctx.fillRect(cx + 1, cy - 10, 4, 3);
        ctx.fillRect(cx - 3, cy - 6, 6, 3);
        break;
      case 'flinch':
        ctx.fillRect(cx - 4, cy - 8, 3, 1);
        ctx.fillRect(cx + 1, cy - 8, 3, 1);
        ctx.fillRect(cx - 2, cy - 6, 4, 2);
        break;
      case 'h': // happy
        ctx.fillRect(cx - 3, cy - 9, 2, 2);
        ctx.fillRect(cx + 1, cy - 9, 2, 2);
        ctx.fillRect(cx - 3, cy - 5, 6, 1);
        ctx.fillRect(cx - 4, cy - 6, 1, 1);
        ctx.fillRect(cx + 3, cy - 6, 1, 1);
        break;
      case 'a': // angry
        ctx.fillRect(cx - 4, cy - 10, 3, 1);
        ctx.fillRect(cx + 2, cy - 10, 3, 1);
        ctx.fillRect(cx - 3, cy - 9, 2, 2);
        ctx.fillRect(cx + 1, cy - 9, 2, 2);
        ctx.fillRect(cx - 3, cy - 5, 6, 2);
        ctx.fillRect(cx - 2, cy - 6, 1, 1);
        ctx.fillRect(cx + 2, cy - 6, 1, 1);
        break;
      case 't': // tongue out
        ctx.fillRect(cx - 3, cy - 9, 2, 2);
        ctx.fillRect(cx + 1, cy - 9, 2, 2);
        ctx.fillRect(cx - 2, cy - 6, 4, 2);
        ctx.fillStyle = '#FF5588';
        ctx.fillRect(cx - 1, cy - 4, 3, 2);
        break;
      case 'w': // woozy/dizzy
        ctx.strokeStyle = GORILLA_DARK; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx - 3, cy - 9, 2, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + 3, cy - 9, 2, 0, Math.PI*2); ctx.stroke();
        ctx.fillStyle = GORILLA_DARK;
        ctx.fillRect(cx - 2, cy - 5, 4, 1);
        break;
      case 's': // smug
        ctx.fillRect(cx - 3, cy - 10, 3, 1);
        ctx.fillRect(cx - 3, cy - 9, 2, 1);
        ctx.fillRect(cx + 1, cy - 9, 2, 2);
        ctx.fillRect(cx - 2, cy - 5, 4, 1);
        ctx.fillRect(cx + 2, cy - 6, 1, 1);
        break;
      case 'x': // x-eyes
        ctx.fillRect(cx - 4, cy - 10, 1, 1); ctx.fillRect(cx - 3, cy - 9, 1, 1);
        ctx.fillRect(cx - 2, cy - 8, 1, 1); ctx.fillRect(cx - 4, cy - 8, 1, 1);
        ctx.fillRect(cx - 2, cy - 10, 1, 1);
        ctx.fillRect(cx + 2, cy - 10, 1, 1); ctx.fillRect(cx + 3, cy - 9, 1, 1);
        ctx.fillRect(cx + 4, cy - 8, 1, 1); ctx.fillRect(cx + 2, cy - 8, 1, 1);
        ctx.fillRect(cx + 4, cy - 10, 1, 1);
        ctx.fillRect(cx - 1, cy - 5, 2, 1);
        break;
      case 'c': // crying
        ctx.fillRect(cx - 3, cy - 9, 2, 2);
        ctx.fillRect(cx + 1, cy - 9, 2, 2);
        ctx.fillRect(cx - 3, cy - 5, 6, 2);
        ctx.fillRect(cx - 2, cy - 4, 1, 1); ctx.fillRect(cx + 3, cy - 4, 1, 1);
        ctx.fillStyle = '#55AAFF';
        ctx.fillRect(cx - 4, cy - 7, 1, 2); ctx.fillRect(cx + 4, cy - 7, 1, 2);
        break;
      case 'frustrated':
        ctx.fillRect(cx - 4, cy - 10, 3, 1);
        ctx.fillRect(cx + 2, cy - 10, 3, 1);
        ctx.fillRect(cx - 3, cy - 8, 2, 1);
        ctx.fillRect(cx + 1, cy - 8, 2, 1);
        ctx.fillRect(cx - 3, cy - 5, 2, 1); ctx.fillRect(cx, cy - 5, 2, 1); ctx.fillRect(cx + 3, cy - 5, 1, 1);
        break;
      case 'bored':
        ctx.fillRect(cx - 4, cy - 8, 3, 1);
        ctx.fillRect(cx + 1, cy - 8, 3, 1);
        ctx.fillRect(cx - 2, cy - 4, 3, 1);
        break;
      case 'phew':
        ctx.fillRect(cx - 3, cy - 8, 2, 1);
        ctx.fillRect(cx + 1, cy - 8, 2, 1);
        ctx.fillRect(cx - 2, cy - 5, 4, 2);
        break;
      default: // normal
        ctx.fillRect(cx - 3, cy - 9, 2, 2);
        ctx.fillRect(cx + 1, cy - 9, 2, 2);
        ctx.fillRect(cx - 2, cy - 6, 4, 2);
    }
  }

  function drawGorillaArms(cx, cy, pose, isPanicking) {
    ctx.fillStyle = GORILLA_COLOR;
    switch (pose) {
      case 0:
        if (isPanicking) {
          ctx.fillRect(cx - 12, cy - 14, 4, 12);
          ctx.fillRect(cx + 8, cy - 14, 4, 12);
        } else {
          ctx.fillRect(cx - 12, cy - 4, 4, 12);
          ctx.fillRect(cx + 8, cy - 4, 4, 12);
        }
        break;
      case 1:
        ctx.fillRect(cx - 12, cy - 4, 4, 12);
        ctx.fillRect(cx + 8, cy - 14, 4, 12);
        break;
      case 2:
        ctx.fillRect(cx - 12, cy - 14, 4, 12);
        ctx.fillRect(cx + 8, cy - 4, 4, 12);
        break;
      case 3:
        ctx.fillRect(cx - 12, cy - 14, 4, 12);
        ctx.fillRect(cx + 8, cy - 14, 4, 12);
        break;
      case 4:
        ctx.fillRect(cx - 12, cy - 2, 4, 12);
        ctx.fillRect(cx + 8, cy - 2, 4, 12);
        break;
      case 5: // phew — one arm across brow
        ctx.fillRect(cx - 12, cy - 4, 4, 12);
        ctx.fillRect(cx - 4, cy - 12, 10, 3);
        break;
    }
  }

  function drawGorilla(x, y, pose, playerIdx) {
    if (!gorillaVisible[playerIdx]) return;

    const baseCx = x + GORILLA_W / 2;
    const baseCy = y + GORILLA_H / 2;

    const isPanicking = panicPlayers.has(playerIdx);
    const isFlinching = !!flinchTimers[playerIdx];
    const isPhew      = !!phewTimers[playerIdx];
    const isFrust     = !!frustratedTimers[playerIdx];
    const isBored     = !!boredTimers[playerIdx];
    const isMissed    = !!missedTimers[playerIdx];
    const taunt       = getTauntTransform(playerIdx);
    const isWet = roundWeather === 'rain' || roundWeather === 'storm' || roundWeather === 'acidrain';

    // Resolve pose + face precedence
    // Taunt > panic > missed > phew > flinch > frustrated > bored > idle pose
    let effPose = pose;
    let faceKind = 'normal';
    if (taunt) { effPose = taunt.pose; faceKind = taunt.face || 'normal'; }
    else if (isPanicking) { faceKind = 'panic'; }
    else if (isMissed) { effPose = 0; faceKind = 'frustrated'; }
    else if (isPhew) { effPose = 5; faceKind = 'phew'; }
    else if (isFlinching) { faceKind = 'flinch'; }
    else if (isFrust) { faceKind = 'frustrated'; effPose = 3; }
    else if (isBored) { faceKind = 'bored'; effPose = 0; }

    // ── Body-level reaction transforms (no-taunt path) ───────────────────────
    // These make tiny face changes READABLE at 28px by moving the whole body.
    let bodyDx = 0, bodyDy = 0, bodyRot = 0;
    const rStart = reactionStart[playerIdx] || 0;
    const rNow = performance.now();
    const rElapsed = rStart ? (rNow - rStart) : 0;
    if (!taunt) {
      if (isPanicking) {
        // Frantic shake
        bodyDx = Math.sin(rNow / 28) * 2;
        bodyDy = Math.abs(Math.sin(rNow / 45)) * -1.5;
      } else if (isMissed) {
        // Shooter slump: sag down + lean forward, ease back over 1200ms
        const t = Math.min(1, rElapsed / 1200);
        const ease = 1 - t * t; // strong at start, eases out
        const side = getGorillaSide(playerIdx);
        bodyDy = 3 * ease;
        bodyRot = -0.12 * ease * side;
      } else if (isFlinching) {
        // Crouch away: quick duck down
        const t = Math.min(1, rElapsed / 600);
        const ease = Math.sin(t * Math.PI);
        const side = getGorillaSide(playerIdx);
        bodyDy = 3 * ease;
        bodyDx = 1.5 * ease * side; // lean away
      } else if (isPhew) {
        // Recovery bounce
        const t = Math.min(1, rElapsed / 1200);
        bodyDy = Math.sin(t * Math.PI * 2) * -1.5 * (1 - t);
      } else if (isFrust) {
        // Rage shake
        bodyDx = Math.sin(rNow / 35) * 2;
        bodyDy = Math.sin(rNow / 22) * 1;
      }
    }

    ctx.save();
    if (taunt) {
      ctx.translate(baseCx + (taunt.dx || 0), baseCy + (taunt.dy || 0));
      if (taunt.rot) ctx.rotate(taunt.rot);
      if (taunt.sc && taunt.sc !== 1) ctx.scale(taunt.sc, taunt.sc);
      ctx.translate(-baseCx, -baseCy);
    } else if (bodyDx || bodyDy || bodyRot) {
      ctx.translate(baseCx + bodyDx, baseCy + bodyDy);
      if (bodyRot) ctx.rotate(bodyRot);
      ctx.translate(-baseCx, -baseCy);
    }

    const cx = baseCx;
    const cy = baseCy;

    // Body
    ctx.fillStyle = GORILLA_COLOR;
    ctx.fillRect(cx - 8, cy - 6, 16, 14);
    // Head
    ctx.fillRect(cx - 6, cy - 12, 12, 8);

    drawGorillaFace(cx, cy, faceKind);

    // Legs
    ctx.fillStyle = GORILLA_COLOR;
    ctx.fillRect(cx - 6, cy + 8, 5, 6);
    ctx.fillRect(cx + 1, cy + 8, 5, 6);

    drawGorillaArms(cx, cy, effPose, isPanicking);

    // Wet overlay: blue tint + drip below feet
    if (isWet) {
      ctx.fillStyle = 'rgba(85, 170, 255, 0.18)';
      ctx.fillRect(cx - 8, cy - 12, 16, 26);
      ctx.fillStyle = '#55AAFF';
      const dripPhase = (performance.now() / 180 + playerIdx * 2) % 8;
      ctx.fillRect(cx - 5, cy + 14 + dripPhase, 1, 2);
      ctx.fillRect(cx + 4, cy + 14 + ((dripPhase + 4) % 8), 1, 2);
    }

    ctx.restore();

    // ── Reaction FX drawn in world-space (not transformed with body) ─────────
    if (!taunt) {
      // Phew: blue sweat drop falling from brow
      if (isPhew) {
        const t = Math.min(1, rElapsed / 1200);
        const dropY = baseCy - 8 + t * 18;
        const dropA = Math.max(0, 1 - t);
        ctx.fillStyle = `rgba(120, 200, 255, ${dropA.toFixed(2)})`;
        ctx.fillRect(baseCx + 4, dropY, 2, 3);
        ctx.fillRect(baseCx + 3, dropY + 3, 4, 2);
      }
      // Frustrated: steam puffs rising from head + red anger marks
      if (isFrust) {
        for (let i = 0; i < 3; i++) {
          const phase = ((rNow / 600) + i / 3) % 1;
          const px = baseCx - 6 + i * 6 + Math.sin(phase * Math.PI * 2) * 2;
          const py = baseCy - 14 - phase * 12;
          const pa = Math.max(0, 1 - phase) * 0.7;
          const pr = 2 + phase * 2;
          ctx.fillStyle = `rgba(220, 220, 220, ${pa.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fill();
        }
        // Red anger bolts on head
        const flash = Math.sin(rNow / 90) > 0 ? 1 : 0.3;
        ctx.fillStyle = `rgba(255, 40, 40, ${flash.toFixed(2)})`;
        ctx.fillRect(baseCx - 8, baseCy - 13, 2, 2);
        ctx.fillRect(baseCx + 6, baseCy - 13, 2, 2);
      }
      // Missed (shooter slump): droplet of sweat + "..." above head
      if (isMissed) {
        const t = Math.min(1, rElapsed / 1200);
        const a = Math.max(0, 1 - t);
        ctx.fillStyle = `rgba(120, 200, 255, ${a.toFixed(2)})`;
        ctx.fillRect(baseCx - 9, baseCy - 10 + t * 4, 2, 3);
        ctx.fillStyle = `rgba(200, 200, 220, ${a.toFixed(2)})`;
        ctx.fillRect(baseCx - 3, baseCy - 16, 2, 2);
        ctx.fillRect(baseCx,     baseCy - 16, 2, 2);
        ctx.fillRect(baseCx + 3, baseCy - 16, 2, 2);
      }
      // Flinch: motion squiggle lines behind the duck
      if (isFlinching) {
        const side = getGorillaSide(playerIdx);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(baseCx + side * (10 + i * 3), baseCy - 6 + i * 5, 3, 1);
        }
      }
      // Bored "Zzz" above head
      if (isBored) {
        const wig = Math.sin(rNow / 240) * 2;
        ctx.fillStyle = '#CCCCFF';
        ctx.font = '10px "Courier New", monospace';
        ctx.fillText('z', baseCx + 6 + wig, baseCy - 14);
        ctx.fillText('Z', baseCx + 10 - wig, baseCy - 20);
      }
    }
  }

  // ─── Banana sprite ─────────────────────────────────────────────────────────
  function getBananaColor(type) {
    switch (type) {
      case 'heavy': return '#FF8800';
      case 'cluster': return '#00FF00';
      case 'napalm': return '#FF4400';
      case 'skipper': return '#55AAFF';
      case 'dud': return '#888888';
      default: return BANANA_COLOR;
    }
  }

  function drawBanana(x, y, frame, type) {
    if (type === 'turret-deploy') {
      drawTurretDeployProjectile(x, y, frame);
      return;
    }
    ctx.fillStyle = getBananaColor(type || activeBananaType);
    const s = type === 'heavy' ? 6 : 4;
    switch (frame % 4) {
      case 0:
        ctx.fillRect(x - s, y - 2, s * 2, 4);
        break;
      case 1:
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 4);
        ctx.fillRect(-s, -2, s * 2, 4);
        ctx.restore();
        break;
      case 2:
        ctx.fillRect(x - 2, y - s, 4, s * 2);
        break;
      case 3:
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-s, -2, s * 2, 4);
        ctx.restore();
        break;
    }
  }

  // Tumbling metal banana — used while a turret is being thrown toward its landing spot.
  function drawTurretDeployProjectile(x, y, frame) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((frame % 4) * (Math.PI / 4));
    // Chrome body
    ctx.fillStyle = '#b8b8c2';
    ctx.fillRect(-7, -3, 14, 6);
    // Highlight stripe
    ctx.fillStyle = '#e6e6ee';
    ctx.fillRect(-6, -3, 12, 1);
    // Shadow stripe
    ctx.fillStyle = '#5a5a66';
    ctx.fillRect(-6, 2, 12, 1);
    // Rivets
    ctx.fillStyle = '#2a2a33';
    ctx.fillRect(-5, -1, 1, 1);
    ctx.fillRect(3, -1, 1, 1);
    ctx.restore();
  }

  function drawTurret(t) {
    const cx = t.cx;
    const cy = t.cy;
    ctx.save();
    // Base (metal banana body)
    ctx.fillStyle = '#8a8a94';
    ctx.fillRect(t.x, t.y + 4, TURRET_W, TURRET_H - 4);
    ctx.fillStyle = '#b0b0bc';
    ctx.fillRect(t.x + 1, t.y + 5, TURRET_W - 2, 2);
    ctx.fillStyle = '#555560';
    ctx.fillRect(t.x, t.y + TURRET_H - 2, TURRET_W, 2);
    // Rivets
    ctx.fillStyle = '#23232a';
    ctx.fillRect(t.x + 2, t.y + 8, 1, 1);
    ctx.fillRect(t.x + TURRET_W - 3, t.y + 8, 1, 1);
    ctx.fillRect(t.x + 2, t.y + TURRET_H - 4, 1, 1);
    ctx.fillRect(t.x + TURRET_W - 3, t.y + TURRET_H - 4, 1, 1);
    // Dome / mount
    ctx.fillStyle = '#6a6a75';
    ctx.beginPath();
    ctx.arc(cx, t.y + 4, 5, Math.PI, 0);
    ctx.fill();
    // Rotating barrel
    ctx.translate(cx, t.y + 3);
    ctx.rotate(t.aimAngle || 0);
    const kick = t.barrelKick || 0;
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(-1 + kick, -1, 10, 2);
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(8 + kick, -1, 1, 2);
    ctx.restore();
  }

  function drawTurretTracers(dt) {
    if (!turretTracers.length) return;
    for (let i = turretTracers.length - 1; i >= 0; i--) {
      const tr = turretTracers[i];
      tr.life -= dt;
      if (tr.life <= 0) { turretTracers.splice(i, 1); continue; }

      // Advance the head along the segment
      const travelTime = tr.dist / tr.speed;
      if (travelTime > 0) tr.progress += dt / travelTime;

      const headP = Math.min(1, tr.progress);
      const tailP = Math.max(0, headP - 0.28);  // visible streak = 28% of journey

      const headX = tr.sx + (tr.tx - tr.sx) * headP;
      const headY = tr.sy + (tr.ty - tr.sy) * headP;
      const tailX = tr.sx + (tr.tx - tr.sx) * tailP;
      const tailY = tr.sy + (tr.ty - tr.sy) * tailP;

      // Fade out over the last 0.15s of life
      const a = Math.min(1, tr.life / 0.15);
      ctx.strokeStyle = `rgba(255, 230, 120, ${(a * 0.9).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(headX, headY);
      ctx.stroke();
      // Bright dot at the head
      ctx.fillStyle = `rgba(255, 255, 180, ${a.toFixed(2)})`;
      ctx.fillRect(headX - 1, headY - 1, 2, 2);
    }
  }

  // ─── Trail drawing ─────────────────────────────────────────────────────────
  function drawTrail(trail, alpha) {
    if (trail.length < 2) return;
    const style = settings.trailStyle;
    if (style === 'none') return;

    switch (style) {
      case 'smoke':
        for (let i = 0; i < trail.length; i++) {
          if (i % 2 === 0) {
            const a = alpha * (0.3 + 0.3 * (i / trail.length));
            ctx.fillStyle = `rgba(180, 180, 180, ${a.toFixed(2)})`;
            const size = 2 + Math.random() * 3;
            ctx.beginPath();
            ctx.arc(trail[i].x, trail[i].y, size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      case 'fire':
        for (let i = 0; i < trail.length; i++) {
          if (i % 2 === 0) {
            const a = alpha * (0.4 + 0.4 * (i / trail.length));
            const r = 200 + Math.floor(Math.random() * 55);
            const g = Math.floor(Math.random() * 150);
            ctx.fillStyle = `rgba(${r}, ${g}, 0, ${a.toFixed(2)})`;
            const size = 1 + Math.random() * 3;
            ctx.fillRect(Math.floor(trail[i].x) - 1, Math.floor(trail[i].y) - 1, size, size);
          }
        }
        break;
      default: // dotted
        ctx.fillStyle = `rgba(255, 255, 85, ${alpha})`;
        for (let i = 0; i < trail.length; i++) {
          if (i % 3 === 0) {
            ctx.fillRect(Math.floor(trail[i].x) - 1, Math.floor(trail[i].y) - 1, 2, 2);
          }
        }
        break;
    }
  }

  // ─── Explosion animation ──────────────────────────────────────────────────
  function drawExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
      const exp = explosions[i];
      exp.progress += dt;

      let r, alpha;
      if (exp.progress < 0.15) {
        r = (exp.progress / 0.15) * exp.maxRadius;
        alpha = 1;
      } else if (exp.progress < 0.40) {
        r = exp.maxRadius;
        alpha = 1 - (exp.progress - 0.15) / 0.25;
      } else {
        explosions.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = BANANA_COLOR;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#FF5500';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1;
    }
  }

  // ─── Napalm fire patches ──────────────────────────────────────────────────
  function drawNapalmPatches() {
    const now = performance.now() / 1000;
    for (let i = napalmPatches.length - 1; i >= 0; i--) {
      const np = napalmPatches[i];
      const age = now - np.startTime;
      if (age > 5) {
        napalmPatches.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, 1 - age / 5);
      ctx.fillStyle = `rgba(255, ${Math.floor(60 + Math.random() * 80)}, 0, ${(alpha * 0.6).toFixed(2)})`;
      for (let j = 0; j < 8; j++) {
        const px = np.x + (Math.random() - 0.5) * np.radius * 2;
        const py = np.y + (Math.random() - 0.5) * np.radius;
        ctx.fillRect(px, py - age * 5, 2 + Math.random() * 3, 3 + Math.random() * 4);
      }
    }
  }

  // ─── Death chunks ──────────────────────────────────────────────────────────
  function spawnDeathChunks(x, y) {
    for (let i = 0; i < 12; i++) {
      deathChunks.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 5 - 2,
        size: 2 + Math.random() * 4,
        color: Math.random() > 0.5 ? GORILLA_COLOR : GORILLA_DARK,
        life: 1,
      });
    }
  }

  function updateDeathChunks(dt) {
    for (let i = deathChunks.length - 1; i >= 0; i--) {
      const c = deathChunks[i];
      c.x += c.vx;
      c.y += c.vy;
      c.vy += 0.15 * dt * 60;
      c.life -= 0.02 * dt * 60;
      if (c.life <= 0 || c.y > LOGICAL_H) {
        deathChunks.splice(i, 1);
      }
    }
  }

  function drawDeathChunks() {
    for (const c of deathChunks) {
      ctx.fillStyle = c.color;
      ctx.globalAlpha = Math.max(0, c.life);
      ctx.fillRect(c.x, c.y, c.size, c.size);
    }
    ctx.globalAlpha = 1;
  }

  // ─── Wind arrow ────────────────────────────────────────────────────────────
  function drawWindArrow() {
    const hudWind = document.getElementById('hud-wind');
    hudWind.classList.remove('wind-low', 'wind-med', 'wind-high', 'wind-extreme');
    const strength = Math.abs(wind);
    if (Math.abs(wind) < 0.5) {
      hudWind.textContent = 'WIND: CALM (0.0)';
      hudWind.classList.add('wind-low');
      return;
    }
    const dir = wind > 0 ? '→' : '←';
    const bars = Math.min(10, Math.max(1, Math.round(strength)));
    let arrow = '';
    for (let i = 0; i < bars; i++) arrow += dir;
    hudWind.textContent = `WIND ${arrow}  (${strength.toFixed(1)})`;

    if (strength < 4) hudWind.classList.add('wind-low');
    else if (strength < 8) hudWind.classList.add('wind-med');
    else if (strength < 12) hudWind.classList.add('wind-high');
    else hudWind.classList.add('wind-extreme');
  }

  // ─── Main render loop ─────────────────────────────────────────────────────
  let lastRenderTime = performance.now();
  function render() {
    const now = performance.now();
    const dt = Math.min((now - lastRenderTime) / 1000, 0.05); // cap at 50ms
    lastRenderTime = now;

    if (gameState === 'playing' || gameState === 'paused') {
      // Update systems — world systems respect cinematic time dilation;
      // camera lerp uses real dt so zoom feels snappy regardless.
      const worldDt = dt * cinematicTimeScale;
      Background.update(worldDt);
      Particles.update(worldDt);
      Lighting.update(worldDt);
      updateCam(dt);

      ctx.save();
      // Cinematic camera: pivot scale around cam center
      if (cam.zoom !== 1 || cam.phase !== 'idle') {
        ctx.translate(LOGICAL_W / 2, LOGICAL_H / 2);
        ctx.scale(cam.zoom, cam.zoom);
        ctx.translate(-cam.x, -cam.y);
      }
      // Shake applied in screen space (divide to stay constant-magnitude under zoom)
      ctx.translate(shakeOffset.x / cam.zoom, shakeOffset.y / cam.zoom);

      // 1. Sky
      drawSky();

      // 2. Background layers (distant biome elements)
      Background.renderBackground(ctx);

      // 3. Background events (aurora, distant volcano, whale, etc.)
      Background.renderEvents(ctx);

      // 4. Sun/Moon
      drawSun();

      // 5. Particles behind terrain (fog, glow)
      Particles.renderBehind(ctx);

      // 6. Terrain & buildings
      drawBuildings();

      // 7. Trails
      drawTrail(previousTrail, 0.25);
      drawTrail(bananaTrail, 0.5);

      // 8. Gorillas
      for (let gi = 0; gi < gorillas.length; gi++) {
        drawGorilla(gorillas[gi].x, gorillas[gi].y, gorillaAnim[gi], gi);
      }

      // 8.5 Turrets — rendered before bananas so a banana in front occludes
      for (const t of turrets) {
        // Decay barrel kick over real time so recoil feels snappy regardless of cinematic slowdown
        if (t.barrelKick) t.barrelKick = Math.max(0, t.barrelKick - dt * 30);
        drawTurret(t);
      }
      drawTurretTracers(worldDt);

      // 9. Banana
      if (showBanana && banana) {
        drawBanana(banana.x, banana.y, banana.frame, activeBananaType);
      }

      // 10. Cluster bananas
      for (const cb of clusterBananas) {
        drawBanana(cb.x, cb.y, Math.floor(cb.x / 10) % 4, 'cluster');
      }

      // 11. Explosions
      drawExplosions(worldDt);

      // 12. Napalm
      drawNapalmPatches();

      // 13. Death chunks
      updateDeathChunks(worldDt);
      drawDeathChunks();

      // 14. Particles in front (rain, snow, sparks, etc.)
      Particles.renderFront(ctx);

      ctx.restore();

      // 15. Lighting overlay (ambient tint, lights, flashes)
      Lighting.render(ctx);

      // 16. Shadows
      Lighting.drawShadows(ctx, buildings, gorillas, gorillaVisible, roundTimeOfDay, GORILLA_W, GORILLA_H, LOGICAL_H);

      // 17. Slow-mo overlay
      if (slowmoActive) {
        ctx.fillStyle = 'rgba(255, 255, 200, 0.08)';
        ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      }
    } else if (gameState === 'title' || gameState === 'setup' || gameState === 'waiting' || gameState === 'matchOver') {
      drawSky();
      drawSun();
      if (buildings.length > 0) {
        drawBuildings();
        for (let gi = 0; gi < gorillas.length; gi++) {
          drawGorilla(gorillas[gi].x, gorillas[gi].y, 0, gi);
        }
      }
    }

    requestAnimationFrame(render);
  }

  // ─── Screen management ────────────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    if (id) {
      document.getElementById(id).classList.add('active');
    }
    if (gameState === 'playing') {
      document.getElementById('hud').classList.add('active');
    }
  }

  function clearElement(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function isHostPlayer() {
    return myPlayer === 1;
  }

  function getModeConfigLocal(mode = settings.gameMode) {
    return MODE_CONFIGS[mode] || MODE_CONFIGS.classic || { label: mode || 'Mode', scoreMode: 'individual' };
  }

  function getPlayerDisplayName(playerIdx) {
    return playerNames[playerIdx] || `Player ${playerIdx + 1}`;
  }

  function getTeamLabel(teamIdx) {
    return teamIdx === 0 ? 'Blue Team' : teamIdx === 1 ? 'Gold Team' : `Team ${teamIdx + 1}`;
  }

  function getTurnDisplayName() {
    const idx = currentPlayer - 1;
    return getPlayerDisplayName(idx);
  }

  function getActivePlayerCountLocal() {
    if (Array.isArray(scores) && scores.length) return scores.length;
    if (Array.isArray(playerNames) && playerNames.length) return playerNames.length;
    return 2;
  }

  function getGorillaSide(playerIdx) {
    const gorilla = gorillas[playerIdx];
    if (gorilla) {
      return (gorilla.x + GORILLA_W / 2) < (LOGICAL_W / 2) ? -1 : 1;
    }

    const activeCount = Math.max(1, getActivePlayerCountLocal());
    return playerIdx < Math.ceil(activeCount / 2) ? -1 : 1;
  }

  function hasStoredHostSession() {
    try {
      return sessionStorage.getItem('mm_player') === '1' &&
        !!sessionStorage.getItem('mm_name') &&
        !!sessionStorage.getItem('mm_token');
    } catch (e) {
      return false;
    }
  }

  function renderHudScores() {
    const container = document.getElementById('hud-scores');
    if (!container) return;
    clearElement(container);

    const mode = settings.gameMode;
    const activeCount = getActivePlayerCountLocal();

    for (let i = 0; i < activeCount; i++) {
      const card = document.createElement('div');
      card.className = `hud-team team-${playerTeams[i] != null ? playerTeams[i] : i}`;
      if (i + 1 === myPlayer) card.classList.add('is-me');
      if (i + 1 === currentPlayer) card.classList.add('is-turn');

      const meta = document.createElement('div');
      meta.className = 'hud-team-meta';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'hud-pname';
      nameSpan.textContent = getPlayerDisplayName(i);
      meta.appendChild(nameSpan);

      const subSpan = document.createElement('span');
      subSpan.className = 'hud-pmeta';
      if (scoreMode === 'team') {
        subSpan.textContent = getTeamLabel(playerTeams[i] || 0);
      } else if (mode === 'koth') {
        subSpan.textContent = `Slot ${i + 1}`;
      } else if (getModeConfigLocal(mode).soloTurn && i === 0) {
        subSpan.textContent = 'Host';
      } else {
        subSpan.textContent = `P${i + 1}`;
      }
      meta.appendChild(subSpan);

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'hud-pscore';
      if (scoreMode === 'team' && Array.isArray(teamScores)) {
        const teamIdx = playerTeams[i] || 0;
        scoreSpan.textContent = String(teamScores[teamIdx] || 0);
      } else {
        scoreSpan.textContent = String(scores[i] || 0);
      }

      card.appendChild(meta);
      card.appendChild(scoreSpan);
      container.appendChild(card);
    }
  }

  function renderMatchStats(statsEl, stats) {
    clearElement(statsEl);
    if (!stats || stats.length < 1) return;

    const table = document.createElement('table');
    const headerRow = document.createElement('tr');
    headerRow.appendChild(document.createElement('th'));

    for (let i = 0; i < stats.length; i++) {
      const th = document.createElement('th');
      th.textContent = getPlayerDisplayName(i);
      headerRow.appendChild(th);
    }
    table.appendChild(headerRow);

    const rows = [
      ['Shots', 'shots'],
      ['Hits', 'hits'],
      ['Accuracy', null],
      ['Near Misses', 'nearMisses'],
      ['Longest Shot', 'longestShot'],
      ['Fastest Power', 'fastestBanana'],
    ];

    for (const [label, key] of rows) {
      const row = document.createElement('tr');
      const labelCell = document.createElement('td');
      labelCell.textContent = label;
      row.appendChild(labelCell);

      for (let i = 0; i < stats.length; i++) {
        const valueCell = document.createElement('td');
        let value;
        if (key === null) {
          value = stats[i].shots > 0 ? Math.round((stats[i].hits / stats[i].shots) * 100) + '%' : '—';
        } else {
          value = stats[i][key] || 0;
          if (key === 'longestShot') value = value + ' units';
        }
        valueCell.textContent = String(value);
        row.appendChild(valueCell);
      }

      table.appendChild(row);
    }

    statsEl.appendChild(table);
  }

  function updateMatchOverActions() {
    const canControlMatch = isHostPlayer();
    const rematchAction = document.getElementById('rematch-btn');
    const newMatchAction = document.getElementById('new-match-btn');
    const hint = document.querySelector('.match-over-hint');

    if (rematchAction) rematchAction.disabled = !canControlMatch;
    if (newMatchAction) newMatchAction.disabled = !canControlMatch;
    if (hint) {
      hint.textContent = canControlMatch ?
        'Press R for rematch | N for new match | Esc for title' :
        'Waiting for host to choose rematch or new match | Esc for title';
    }
  }

  function updateRoundsLabel() {
    const label = document.querySelector('label[for="rounds-to-win"]');
    if (!label) return;
    label.textContent = settings.gameMode === 'bestof' ? 'Series Length:' : 'Rounds to Win:';
  }

  function applyCurrentSettingsToSetupUI() {
    document.getElementById('rounds-to-win').value = settings.roundsToWin;
    document.getElementById('gravity-select').value = settings.gravityMultiplier;
    document.getElementById('explosive-select').value = settings.explosionRadius;
    document.getElementById('timeofday-select').value = settings.timeOfDay;
    document.getElementById('gamemode-select').value = settings.gameMode;
    document.getElementById('mapsize-select').value = settings.mapSize;
    document.getElementById('turntimer-select').value = settings.turnTimer;
    document.getElementById('biome-select').value = settings.biome;
    document.getElementById('weather-select').value = settings.weather;
    document.getElementById('wind-select').value = settings.windIntensity;
    document.getElementById('maxvel-select').value = settings.maxVelocity;
    document.getElementById('banana-select').value = settings.bananaType;
    document.getElementById('friendlyfire-select').value = String(settings.friendlyFire);
    document.getElementById('shake-select').value = settings.shakeIntensity;
    document.getElementById('trail-select').value = settings.trailStyle;
    document.getElementById('crt-select').value = String(settings.crtOverlay);
  }

  function updateSetupPresentation(joining) {
    const connected = Net.isConnected();
    const hostSettings = document.getElementById('setup-host-settings');
    const setupHeader = document.querySelector('.setup-box h2');
    const setupHint = document.querySelector('.setup-hint');
    const hostNote = document.getElementById('setup-host-note');
    const resetBtn = document.getElementById('reset-classic-btn');
    const canEditMatchSettings = !connected || isHostPlayer();
    const localOnlyIds = new Set(['music-select', 'music-order-select', 'effects-quality-select']);

    if (connected) {
      hostSettings.style.display = 'block';
      setupHeader.textContent = 'LOBBY SETTINGS';
      setupHint.textContent = isHostPlayer() ?
        'Press Enter to sync settings and return to the lobby' :
        'Press Enter to return to the lobby';
    } else if (joining) {
      hostSettings.style.display = 'none';
      setupHeader.textContent = 'JOIN GAME';
      setupHint.textContent = 'Press Enter to join';
    } else {
      hostSettings.style.display = 'block';
      setupHeader.textContent = 'GAME SETUP';
      setupHint.textContent = 'Press Enter to host';
    }

    document.querySelectorAll('.setup-field select, .setup-field input[type="number"]').forEach(el => {
      el.disabled = !canEditMatchSettings && !localOnlyIds.has(el.id);
    });

    hostNote.style.display = connected && !isHostPlayer() ? 'block' : 'none';
    resetBtn.style.display = connected && !isHostPlayer() ? 'none' : 'block';
  }

  function updateWaitingStatus(msg) {
    const statusEl = document.getElementById('waiting-status');
    if (!statusEl) return;

    const requiredPlayers = Math.max(1, Number(msg?.requiredPlayers || getModeConfigLocal().requiredPlayers || 2));
    const supportedPlayers = Math.max(
      requiredPlayers,
      Number(msg?.supportedPlayers || getModeConfigLocal().supportedPlayers || requiredPlayers)
    );
    const connectedPlayers = Math.max(1, Number(msg?.connectedPlayers || playerNames.length || 1));
    const remaining = Math.max(0, requiredPlayers - connectedPlayers);
    const modeLabel = getModeConfigLocal(msg?.mode || settings.gameMode).label;

    if (connectedPlayers > supportedPlayers) {
      statusEl.textContent =
        `${modeLabel} supports up to ${supportedPlayers} player${supportedPlayers === 1 ? '' : 's'}. ${connectedPlayers} are connected.`;
      return;
    }

    if (myPlayer === 1) {
      if (remaining <= 0) {
        statusEl.textContent = 'Lobby ready. Starting match...';
      } else if (remaining === 1) {
        statusEl.textContent = 'Share the URL above with 1 more player';
      } else {
        statusEl.textContent = `Share the URL above with ${remaining} more players`;
      }
    } else {
      statusEl.textContent = remaining > 0 ?
        'Waiting for more players to join...' :
        'Waiting for host to start the game...';
    }
  }

  function setDisconnectCopy(text) {
    const el = document.getElementById('disconnect-copy');
    if (el) el.textContent = text;
  }

  function attemptStoredHostClear() {
    let token = null;
    let storedName = null;

    try {
      token = sessionStorage.getItem('mm_token');
      storedName = sessionStorage.getItem('mm_name');
    } catch (e) {}

    if (!token || !storedName) {
      checkServerStatus();
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;
    const tempWs = new WebSocket(url);
    let clearRequested = false;

    tempWs.onopen = () => {
      tempWs.send(JSON.stringify({ type: 'join', name: storedName, token }));
    };

    tempWs.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (msg.type === 'assigned' && msg.player === 1 && !clearRequested) {
        clearRequested = true;
        tempWs.send(JSON.stringify({ type: 'clearMatch' }));
        return;
      }

      if (msg.type === 'matchCleared' || msg.type === 'error') {
        tempWs.close();
      }
    };

    tempWs.onclose = () => {
      setTimeout(() => checkServerStatus(), 150);
    };

    tempWs.onerror = () => {
      checkServerStatus();
    };
  }

  function switchToTitle() {
    gameState = 'title';
    myPlayer = 0;
    stopDanceAnimation();
    document.getElementById('hud-bottombar').classList.remove('match-over-active');
    roundBiome = 'city';
    roundTimeOfDay = 'day';
    roundWeather = 'clear';
    setLogicalSize(640, 480);
    showScreen('title-screen');
    citySeed = (Math.random() * 0xFFFFFFFF) >>> 0;
    buildings = generateCity(citySeed, 'normal', 'city');
    collapsedBuildings.clear();
    buildTerrainCanvas();
    const rng = mulberry32(citySeed + 12345);
    gorillas = placeGorillasClient(buildings, rng);
    gorillaAnim = gorillas.map(() => 0);
    gorillaVisible = gorillas.map(() => true);
    scores = buildDefaultScores();
    playerNames = buildDefaultPlayerNames();
    playerTeams = buildDefaultPlayerTeams();
    teamScores = null;
    scoreMode = 'individual';
    currentPlayer = 1;
    turrets = [];
    turretTracers = [];
    turretCharges = [2, 2, 2, 2];
    initTwinkles();
    checkServerStatus();
  }

  function placeGorillasClient(blds, rng) {
    const mid = Math.floor(blds.length / 2);
    const leftIdx = Math.floor(rng() * Math.max(1, mid));
    const rightIdx = Math.min(blds.length - 1, mid + Math.floor(rng() * (blds.length - mid)));
    function pos(b) {
      return {
        x: Math.floor(b.x + b.w / 2 - GORILLA_W / 2),
        y: b.y - GORILLA_H,
      };
    }
    return [pos(blds[leftIdx]), pos(blds[rightIdx])];
  }

  // ─── Server status check (lobby detection) ─────────────────────────────────
  function checkServerStatus() {
    const lobbyEl = document.getElementById('title-lobby');
    const lobbyInfo = document.getElementById('lobby-info');
    const clearBtn = document.getElementById('clear-host-btn');
    const joinBtn = document.getElementById('join-btn');
    const canClear = hasStoredHostSession();
    lobbyEl.style.display = 'none';
    clearBtn.style.display = 'none';
    joinBtn.style.display = 'none';

    fetch('/status')
      .then(r => r.json())
      .then(data => {
        if (data.active && data.playerCount > 0) {
          const names = data.playerNames.join(', ');
          const stateLabel = data.state === 'playing' ? 'In Progress' : data.state === 'waiting' ? 'Waiting' : data.state;
          lobbyInfo.textContent = `Game found: ${names} (${stateLabel})`;
          lobbyEl.style.display = 'block';
          joinBtn.style.display = 'inline-block';
          if (canClear) clearBtn.style.display = 'inline-block';
        }
      })
      .catch(() => { /* server unreachable, ignore */ });
  }

  let isJoining = false;

  document.getElementById('host-btn').addEventListener('click', () => {
    playUIConfirm();
    isJoining = false;
    switchToSetup(false);
  });

  document.getElementById('join-btn').addEventListener('click', () => {
    playUIConfirm();
    isJoining = true;
    switchToSetup(true);
  });

  document.getElementById('clear-host-btn').addEventListener('click', () => {
    playUIConfirm();
    attemptStoredHostClear();
  });

  function switchToSetup(joining) {
    gameState = 'setup';
    showScreen('setup-screen');
    playUIConfirm();
    loadSettings();
    if (Net.isConnected()) {
      applyCurrentSettingsToSetupUI();
      if (myName) document.getElementById('player-name').value = myName;
    }
    syncSetupSelectionsToState();
    updateRoundsLabel();
    updateSetupPresentation(joining);
    document.getElementById('player-name').focus();
  }

  function switchToWaiting() {
    gameState = 'waiting';
    stopDanceAnimation();
    document.getElementById('hud-bottombar').classList.remove('match-over-active');
    showScreen('waiting-screen');
    document.getElementById('waiting-url').textContent = window.location.href;
    // Copy-link button
    const copyBtn = document.getElementById('copy-url-btn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 1800);
        }).catch(() => {});
      };
    }
  }

  function switchToPlaying() {
    gameState = 'playing';
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById('hud').classList.add('active');
    updateHUD();
    // Pick a random track when starting fresh (music not already playing)
    if (!bgAudio || bgAudio.paused) {
      bgTrackIndex = Math.floor(Math.random() * BG_PLAYLIST.length);
    }
    startBGMusic();
  }

  function switchToMatchOver(winner, finalScores, stats) {
    gameState = 'matchOver';
    const winnerIdx = Math.max(0, (winner | 0) - 1);
    const winnerLabel = scoreMode === 'team' && Array.isArray(teamScores)
      ? getTeamLabel(playerTeams[winnerIdx] || 0)
      : getPlayerDisplayName(winnerIdx);
    const displayScores = Array.isArray(finalScores) && finalScores.length ? finalScores : scores.slice(0, getActivePlayerCountLocal());
    document.getElementById('winner-text').textContent = winnerLabel + ' WINS!';

    if (scoreMode === 'team' && Array.isArray(teamScores)) {
      document.getElementById('final-scores').textContent =
        `${getTeamLabel(0)}: ${teamScores[0] || 0}  —  ${getTeamLabel(1)}: ${teamScores[1] || 0}`;
    } else {
      document.getElementById('final-scores').textContent =
        displayScores.map((score, idx) => `${getPlayerDisplayName(idx)}: ${score || 0}`).join('  —  ');
    }

    // Build stats table
    const statsEl = document.getElementById('match-stats');
    renderMatchStats(statsEl, stats);

    showScreen('match-over-screen');
    // Keep HUD active so the chat bar stays visible and usable
    document.getElementById('hud').classList.add('active');
    // Highlight the chat area so players notice it
    document.getElementById('hud-bottombar').classList.add('match-over-active');
    // Hide the input panel on matchOver — only chat is relevant
    document.getElementById('input-panel').style.display = 'none';
    updateMatchOverActions();

    // Start the dancing monkey canvases (winner = 1-indexed → 0-indexed)
    startDanceAnimation(winnerIdx % 2);
  }

  // ─── HUD updates ──────────────────────────────────────────────────────────
  function updateHUD() {
    renderHudScores();

    const turnName = getTurnDisplayName();
    const turnEl = document.getElementById('hud-turn');
    turnEl.classList.remove('my-turn', 'waiting-turn');
    if (myPlayer === currentPlayer) {
      turnEl.textContent = 'YOUR TURN - FIRE WHEN READY';
      turnEl.classList.add('my-turn');
    } else {
      turnEl.textContent = `WAITING FOR ${turnName.toUpperCase()}...`;
      turnEl.classList.add('waiting-turn');
    }

    drawWindArrow();

    // Show round info
    const infoEl = document.getElementById('hud-info');
    if (roundBiome !== 'city' || roundWeather !== 'clear') {
      infoEl.style.display = 'block';
      const parts = [];
      if (roundBiome !== 'city') parts.push(roundBiome);
      if (roundWeather !== 'clear') parts.push(roundWeather);
      infoEl.textContent = parts.join(' / ');
    } else {
      infoEl.style.display = 'none';
    }

    updateInputPanel();
  }

  function updateInputPanel() {
    const panel = document.getElementById('input-panel');
    const isMyTurn = myPlayer === currentPlayer && gameState === 'playing' && !showBanana;

    // Always show the panel so the bottom bar always has both sections
    panel.style.display = 'flex';

    const ctrlHeader  = panel.querySelector('.ctrl-header');
    const ctrlInputs  = panel.querySelector('.ctrl-inputs');
    const fireBtn     = document.getElementById('fire-btn');
    const tauntBtn    = document.getElementById('taunt-btn');
    const angleInput  = document.getElementById('input-angle');
    const velInput    = document.getElementById('input-velocity');

    if (isMyTurn) {
      // Full controls visible
      if (ctrlHeader) { ctrlHeader.style.display = ''; ctrlHeader.textContent = '⚡ YOUR SHOT'; }
      if (ctrlInputs) ctrlInputs.style.display = 'flex';
      fireBtn.style.display = '';
      tauntBtn.style.flex = '1';
      panel.classList.remove('panel-disabled');
      angleInput.disabled = false;
      velInput.disabled   = false;
      fireBtn.disabled    = false;
      tauntBtn.disabled   = false;
      velInput.max = maxVelocity;
      updateAmmoSelect();
      if (!document.activeElement || document.activeElement === document.body) angleInput.focus();
    } else {
      // Waiting: hide everything except taunt button
      if (ctrlHeader) ctrlHeader.style.display = 'none';
      if (ctrlInputs) ctrlInputs.style.display = 'none';
      fireBtn.style.display = 'none';
      tauntBtn.style.flex = '1 1 100%';
      panel.classList.add('panel-disabled');
      tauntBtn.disabled = false;
      const ammoSel = document.getElementById('ammo-select');
      if (ammoSel) ammoSel.style.display = 'none';
    }
  }

  function updateAmmoSelect() {
    const ammoSel = document.getElementById('ammo-select');
    if (!ammoSel) return;
    ammoSel.style.display = '';
    const myIdx = myPlayer - 1;
    const charges = (myIdx >= 0 && myIdx < 4) ? (turretCharges[myIdx] || 0) : 0;
    const chargeLabel = document.getElementById('turret-charges');
    if (chargeLabel) chargeLabel.textContent = `(${charges})`;
    const bananaRadio = document.getElementById('ammo-banana');
    const turretRadio = document.getElementById('ammo-turret');
    const turretLabel = document.getElementById('ammo-turret-label');
    if (!bananaRadio || !turretRadio) return;
    if (charges <= 0) {
      turretRadio.disabled = true;
      turretRadio.checked = false;
      bananaRadio.checked = true;
      if (turretLabel) turretLabel.classList.add('ammo-disabled');
    } else {
      turretRadio.disabled = false;
      if (turretLabel) turretLabel.classList.remove('ammo-disabled');
    }
    // Default to banana at the start of each turn so a prior turret choice doesn't stick
    if (!bananaRadio.checked && !turretRadio.checked) bananaRadio.checked = true;
  }

  // ─── Screen shake ──────────────────────────────────────────────────────────
  function startShake() {
    const intensityMap = { off: 0, light: 3, normal: 6, heavy: 12 };
    const intensity = intensityMap[settings.shakeIntensity] || 6;
    if (intensity === 0) return;

    let elapsed = 0;
    const duration = 150;
    if (shakeTimer) clearInterval(shakeTimer);
    shakeTimer = setInterval(() => {
      elapsed += 16;
      if (elapsed > duration) {
        shakeOffset.x = 0;
        shakeOffset.y = 0;
        clearInterval(shakeTimer);
        shakeTimer = null;
        return;
      }
      const decayFactor = 1 - elapsed / duration;
      shakeOffset.x = (Math.random() - 0.5) * intensity * decayFactor;
      shakeOffset.y = (Math.random() - 0.5) * intensity * decayFactor;
    }, 16);
  }

  // ─── Cinematic camera ──────────────────────────────────────────────────────
  const CAM_ZOOM = 2.4;

  function startCinematicZoom() {
    if (settings.shakeIntensity === 'off') return;
    if (cam.phase !== 'idle') return; // already engaged — don't re-trigger
    cam.phase = 'in';
    cam.targetZoom = CAM_ZOOM;
    // The server can emit `cinematicStart` before the first `banana` position
    // packet reaches the client. Arm the zoom immediately and let `updateCam()`
    // lock onto the projectile as soon as `banana` is populated.
    cam.targetX = banana ? banana.x : cam.x;
    cam.targetY = banana ? banana.y : cam.y;
    if (cam.safetyTimer) clearTimeout(cam.safetyTimer);
    cam.safetyTimer = setTimeout(() => endCinematicZoom(0), 2500);
  }

  function endCinematicZoom(delayMs = 0) {
    if (cam.phase === 'idle' || cam.phase === 'out') return;
    if (cam.safetyTimer) { clearTimeout(cam.safetyTimer); cam.safetyTimer = null; }
    const go = () => {
      cam.phase = 'out';
      cam.targetZoom = 1;
      cam.targetX = LOGICAL_W / 2;
      cam.targetY = LOGICAL_H / 2;
    };
    if (delayMs > 0) setTimeout(go, delayMs);
    else go();
  }

  function resetCinematicZoom() {
    if (cam.safetyTimer) { clearTimeout(cam.safetyTimer); cam.safetyTimer = null; }
    cam.phase = 'idle';
    cam.zoom = cam.targetZoom = 1;
    cam.x = cam.targetX = LOGICAL_W / 2;
    cam.y = cam.targetY = LOGICAL_H / 2;
    restoreCinematicTime();
  }

  function enterCinematicTime() {
    cinematicTimeScale = 0.4;
    if (bgAudio && !bgAudio.paused && !cinematicOwnsBgAudio) {
      bgAudio.playbackRate = 0.6;
      cinematicOwnsBgAudio = true;
    }
    // Gasp stinger — independent Audio so it plays at full speed regardless of
    // bgAudio's slowed playbackRate.
    try {
      const gasp = new Audio('freesound_community-gasp-6253.mp3');
      gasp.volume = 0.7;
      gasp.play().catch(() => {});
    } catch (e) {}
  }

  function restoreCinematicTime() {
    cinematicTimeScale = 1;
    if (cinematicOwnsBgAudio) {
      if (bgAudio && !bgAudio.paused) bgAudio.playbackRate = 1.0;
      cinematicOwnsBgAudio = false;
    }
  }

  function updateCam(dt) {
    // Trigger is now server-authoritative via Net.on('cinematicStart') — the server
    // detects 180px proximity on its sim tick and broadcasts so both clients stay
    // in sync with the time-dilated physics.
    // Follow banana while zooming in or holding
    if ((cam.phase === 'in' || cam.phase === 'follow') && banana) {
      cam.targetX = banana.x;
      cam.targetY = banana.y;
    }
    // Promote 'in' -> 'follow' once zoom is essentially there
    if (cam.phase === 'in' && Math.abs(cam.zoom - cam.targetZoom) < 0.05) {
      cam.phase = 'follow';
    }
    // Settle 'out' -> 'idle' once fully zoomed out
    if (cam.phase === 'out' && Math.abs(cam.zoom - 1) < 0.01) {
      cam.phase = 'idle';
      cam.zoom = 1;
      cam.x = LOGICAL_W / 2;
      cam.y = LOGICAL_H / 2;
      restoreCinematicTime();
      return;
    }
    // Frame-rate-independent lerp: alpha per 1/60s step
    const zoomAlpha60 = cam.phase === 'in' ? 0.18 : (cam.phase === 'out' ? 0.12 : 0.22);
    const posAlpha60  = cam.phase === 'in' ? 0.20 : (cam.phase === 'out' ? 0.14 : 0.28);
    const steps = Math.max(0, Math.min(1, dt * 60));
    const zk = 1 - Math.pow(1 - zoomAlpha60, steps);
    const pk = 1 - Math.pow(1 - posAlpha60, steps);
    cam.zoom += (cam.targetZoom - cam.zoom) * zk;
    cam.x    += (cam.targetX    - cam.x)    * pk;
    cam.y    += (cam.targetY    - cam.y)    * pk;
    // Clamp so we don't show beyond world bounds
    const halfW = LOGICAL_W / (2 * cam.zoom);
    const halfH = LOGICAL_H / (2 * cam.zoom);
    cam.x = Math.max(halfW, Math.min(LOGICAL_W - halfW, cam.x));
    cam.y = Math.max(halfH, Math.min(LOGICAL_H - halfH, cam.y));
  }

  // ─── Victory dance ─────────────────────────────────────────────────────────
  function startVictoryDance(winnerIdx) {
    let toggle = true;
    playVictorySound();
    victoryDanceTimer = setInterval(() => {
      gorillaAnim[winnerIdx] = toggle ? 3 : 4;
      toggle = !toggle;
    }, 250);
    setTimeout(() => {
      clearInterval(victoryDanceTimer);
      victoryDanceTimer = null;
      gorillaAnim[winnerIdx] = 0;
      stopVictorySound();
    }, 2500);
  }

  // ─── Turn timer display ────────────────────────────────────────────────────
  function startTurnTimerDisplay(seconds) {
    stopTurnTimerDisplay();
    if (seconds <= 0) return;
    turnTimerValue = seconds;
    const timerEl = document.getElementById('hud-timer');
    timerEl.style.display = 'block';
    timerEl.textContent = turnTimerValue;
    timerEl.classList.remove('urgent', 'critical');
    turnTimerInterval = setInterval(() => {
      turnTimerValue--;
      if (turnTimerValue <= 0) {
        stopTurnTimerDisplay();
        return;
      }
      timerEl.textContent = turnTimerValue;
      timerEl.classList.remove('urgent', 'critical');
      if (turnTimerValue <= 3) {
        timerEl.classList.add('critical');
        playCountdownBeep(turnTimerValue);
      } else if (turnTimerValue <= 10) {
        timerEl.classList.add('urgent');
      }
    }, 1000);
  }

  function stopTurnTimerDisplay() {
    if (turnTimerInterval) {
      clearInterval(turnTimerInterval);
      turnTimerInterval = null;
    }
    const timerEl = document.getElementById('hud-timer');
    timerEl.style.display = 'none';
    timerEl.classList.remove('urgent', 'critical');
  }

  // ─── Tab navigation ───────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      playUIConfirm();
    });
  });

  // Reset to classic button
  document.getElementById('reset-classic-btn').addEventListener('click', () => {
    resetToClassic();
    updateRoundsLabel();
    playUIConfirm();
  });

  const modeSelect = document.getElementById('gamemode-select');
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      settings.gameMode = modeSelect.value;
      updateRoundsLabel();
    });
  }

  // ─── Network message handlers ─────────────────────────────────────────────

  Net.on('_connected', () => {
    // Clear any pending reconnect timer — we made it
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;

    if (gameState === 'playing') {
      // We're reconnecting mid-game — server will send assigned + roundStart to resync.
      // Don't call switchToWaiting() or send settings; just wait for server response.
      return;
    }
    switchToWaiting();
    saveSettings();
    // Send all settings to server
    sendAllSettings();
  });

  function sendAllSettings() {
    syncSetupSelectionsToState();
    Net.send({
      type: 'setSettings',
      roundsToWin: parseInt(document.getElementById('rounds-to-win').value) || 3,
      gameMode: document.getElementById('gamemode-select').value,
      mapSize: document.getElementById('mapsize-select').value,
      turnTimer: parseInt(document.getElementById('turntimer-select').value) || 0,
      biome: document.getElementById('biome-select').value,
      weather: document.getElementById('weather-select').value,
      timeOfDay: document.getElementById('timeofday-select').value,
      gravity: parseFloat(document.getElementById('gravity-select').value) || 1,
      windIntensity: document.getElementById('wind-select').value,
      maxVelocity: parseInt(document.getElementById('maxvel-select').value) || 200,
      explosionRadius: parseInt(document.getElementById('explosive-select').value) || 30,
      bananaType: document.getElementById('banana-select').value,
      friendlyFire: document.getElementById('friendlyfire-select').value !== 'false',
      shakeIntensity: document.getElementById('shake-select').value,
      trailStyle: document.getElementById('trail-select').value,
      crtOverlay: document.getElementById('crt-select').value === 'true',
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      if (gameState !== 'playing') return;
      Net.connect(myName, sessionToken);
    }, 3000);
  }

  Net.on('_disconnected', () => {
    if (gameState === 'playing') {
      setDisconnectCopy('Connection lost. Attempting to reconnect...');
      document.getElementById('disconnect-screen').classList.add('active');
      scheduleReconnect();
    } else {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      reconnectAttempts = 0;
    }
  });

  Net.on('waiting', (msg) => {
    if (typeof msg.player === 'number') myPlayer = msg.player;
    if (gameState !== 'setup') switchToWaiting();
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) {
      playerNames = msg.playerNames.slice();
    }
    if (msg.mode) settings.gameMode = msg.mode;
    updateWaitingStatus(msg);
    if (gameState === 'setup') updateSetupPresentation(isJoining);
  });

  Net.on('assigned', (msg) => {
    myPlayer = msg.player;
    if (msg.token) {
      sessionToken = msg.token;
      try { sessionStorage.setItem('mm_token', sessionToken); } catch(e) {}
    }
    try {
      sessionStorage.setItem('mm_player', String(myPlayer));
      sessionStorage.setItem('mm_name', myName);
    } catch (e) {}
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) playerNames = msg.playerNames.slice();
    if (Array.isArray(msg.playerTeams)) playerTeams = msg.playerTeams.slice();
    if (msg.scoreMode) scoreMode = msg.scoreMode;
    teamScores = Array.isArray(msg.teamScores) ? msg.teamScores.slice() : null;
    document.getElementById('disconnect-screen').classList.remove('active');
    updateMatchOverActions();
    updateSetupPresentation(isJoining);
  });

  Net.on('roundStart', (msg) => {
    citySeed = msg.citySeed;
    gorillas = msg.gorillas;
    wind = msg.wind;
    currentPlayer = msg.currentPlayer;
    scores = Array.isArray(msg.scores) ? msg.scores.slice() : buildDefaultScores(2);
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) playerNames = msg.playerNames.slice();
    if (Array.isArray(msg.playerTeams)) playerTeams = msg.playerTeams.slice();
    scoreMode = msg.scoreMode || 'individual';
    teamScores = Array.isArray(msg.teamScores) ? msg.teamScores.slice() : null;
    roundBiome = msg.biome || 'city';
    roundWeather = msg.weather || 'clear';
    roundTimeOfDay = msg.timeOfDay || 'day';
    resetCinematicZoom();
    turnStartedAt = performance.now();
    activeTaunts = [null, null, null, null];
    // Clear all reaction timers from previous round
    if (victoryDanceTimer) { clearInterval(victoryDanceTimer); victoryDanceTimer = null; stopVictorySound(); }
    for (const k of Object.keys(flinchTimers))       { clearTimeout(flinchTimers[k]); delete flinchTimers[k]; }
    for (const k of Object.keys(missedTimers))        { clearTimeout(missedTimers[k]); delete missedTimers[k]; }
    for (const k of Object.keys(phewTimers))        { clearTimeout(phewTimers[k]); delete phewTimers[k]; }
    for (const k of Object.keys(frustratedTimers))  { clearTimeout(frustratedTimers[k]); delete frustratedTimers[k]; }
    for (const k of Object.keys(boredTimers))       { clearTimeout(boredTimers[k]); delete boredTimers[k]; }
    setSunEmote('idle', 0);
    roundNumber = msg.roundNumber || 1;
    maxVelocity = msg.maxVelocity || 200;
    activeBananaType = msg.bananaType || 'standard';
    if (Array.isArray(msg.turretCharges)) {
      for (let i = 0; i < 4; i++) turretCharges[i] = msg.turretCharges[i] != null ? msg.turretCharges[i] : turretCharges[i];
    }
    turrets = [];
    turretTracers = [];

    // Sync settings
    if (msg.explosionRadius) settings.explosionRadius = msg.explosionRadius;
    if (msg.gravity) settings.gravityMultiplier = msg.gravity;
    if (msg.shakeIntensity) settings.shakeIntensity = msg.shakeIntensity;
    if (msg.trailStyle) settings.trailStyle = msg.trailStyle;
    if (msg.crtOverlay !== undefined) settings.crtOverlay = msg.crtOverlay;
    if (msg.turnTimer !== undefined) settings.turnTimer = msg.turnTimer;
    if (msg.mode) settings.gameMode = msg.mode;
    if (msg.mapSize) settings.mapSize = msg.mapSize;

    // Set logical size based on map
    const mapCfg = MAP_SIZES[msg.mapSize] || MAP_SIZES.normal;
    setLogicalSize(mapCfg.w, mapCfg.h);

    // CRT overlay
    document.getElementById('crt-overlay').style.display = settings.crtOverlay ? 'block' : 'none';

    // Generate matching city
    buildings = generateCity(citySeed, msg.mapSize || 'normal', roundBiome);
    carvedExplosions = [];
    collapsedBuildings.clear();
    buildTerrainCanvas();

    // Reset state
    banana = null;
    bananaTrail = [];
    previousTrail = [];
    showBanana = false;
    explosions = [];
    napalmPatches = [];
    deathChunks = [];
    clusterBananas = [];
    gorillaAnim = gorillas.map(() => 0);
    gorillaVisible = gorillas.map(() => true);
    panicPlayers.clear();
    slowmoActive = false;

    initTwinkles();
    generateStars();

    // Initialize visual effects systems for this round
    Lighting.setAmbient(roundTimeOfDay, roundWeather, roundBiome);
    Particles.configureForRound(roundBiome, roundWeather, roundTimeOfDay);
    Particles.setWind(wind);
    Background.configureForRound(roundBiome, roundWeather, roundTimeOfDay, citySeed);

    startWeatherAudio(roundWeather);
    switchToPlaying();

    // Windshear notification banner
    if (msg.windshear) {
      const banner = document.getElementById('windshear-banner');
      if (banner) {
        banner.style.display = 'block';
        setTimeout(() => { banner.style.display = 'none'; }, 3000);
      }
    }

    // Start turn timer
    if (settings.turnTimer > 0) {
      startTurnTimerDisplay(settings.turnTimer);
    }
  });

  Net.on('turn', (msg) => {
    currentPlayer = msg.currentPlayer;
    showBanana = false;
    banana = null;
    clusterBananas = [];
    previousTrail = [...bananaTrail];
    bananaTrail = [];
    gorillaAnim = gorillaAnim.map(() => 0);
    panicPlayers.clear();
    resetCinematicZoom();
    turnStartedAt = performance.now();
    // Clear any stale bored reaction when the turn changes
    for (const k of Object.keys(boredTimers)) {
      clearTimeout(boredTimers[k]); delete boredTimers[k];
    }
    updateHUD();

    // Two-note ascending turn-start beep
    try {
      const actx = ensureAudio();
      if (actx.state !== 'suspended') {
        const t = actx.currentTime;
        [440, 660].forEach((f, i) => {
          const o = actx.createOscillator(); const g = actx.createGain();
          o.type = 'square'; o.frequency.value = f;
          g.gain.setValueAtTime(0.07, t + i * 0.1);
          g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.12);
          o.connect(g).connect(actx.destination);
          o.start(t + i * 0.1); o.stop(t + i * 0.1 + 0.15);
        });
      }
    } catch (e) {}

    if (settings.turnTimer > 0) {
      startTurnTimerDisplay(msg.turnTimer || settings.turnTimer);
    }
  });

  Net.on('throwAnim', (msg) => {
    const idx = msg.player - 1;
    if (msg.bananaType) activeBananaType = msg.bananaType;
    playThrowSound();
    stopTurnTimerDisplay();
    setSunEmote('watching', 0); // Start watching when banana is thrown

    if (getGorillaSide(idx) < 0) {
      gorillaAnim[idx] = 1;
    } else {
      gorillaAnim[idx] = 2;
    }
    setTimeout(() => {
      if (getGorillaSide(idx) < 0) {
        gorillaAnim[idx] = 2;
      } else {
        gorillaAnim[idx] = 1;
      }
      setTimeout(() => {
        gorillaAnim[idx] = 0;
      }, 100);
    }, 200);
  });

  Net.on('banana', (msg) => {
    showBanana = true;
    banana = { x: msg.x, y: msg.y, frame: msg.frame };
    if (msg.bananaType) activeBananaType = msg.bananaType;
    bananaTrail.push({ x: msg.x, y: msg.y });

    // Sun emote: track banana and react based on proximity
    const dx = msg.x - SUN_X;
    const dy = msg.y - SUN_Y;
    const distSq = dx * dx + dy * dy;
    const watchRadius = SUN_RADIUS * 4;

    if (distSq <= SUN_RADIUS * SUN_RADIUS) {
      // Very close / hitting sun
      setSunEmote('surprised', 500);
      sunSurprised = true;
      if (sunSurpriseTimer) clearTimeout(sunSurpriseTimer);
      sunSurpriseTimer = setTimeout(() => { sunSurprised = false; }, 500);
    } else if (distSq <= watchRadius * watchRadius) {
      // Nearby - worried
      if (sunEmote !== 'surprised' && sunEmote !== 'hit') {
        setSunEmote('worried', 0); // stays while banana nearby
      }
    } else if (showBanana) {
      // In flight but far - just watching
      if (sunEmote !== 'surprised' && sunEmote !== 'hit' && sunEmote !== 'worried') {
        setSunEmote('watching', 0);
      }
    }
  });

  Net.on('clusterSplit', (msg) => {
    showBanana = false;
    banana = null;
    playBounceSound();
  });

  Net.on('clusterBanana', (msg) => {
    const existing = clusterBananas.find(c => c.idx === msg.idx);
    if (existing) {
      existing.x = msg.x;
      existing.y = msg.y;
    } else {
      clusterBananas.push({ idx: msg.idx, x: msg.x, y: msg.y });
    }
  });

  Net.on('bananaBounce', (msg) => {
    playBounceSound();
  });

  Net.on('dud', (msg) => {
    showBanana = false;
    banana = null;
    playDudSound();
    endCinematicZoom(200);
  });

  Net.on('sunHit', () => {
    playSunHitSound();
    setSunEmote('hit', 800);
    sunSurprised = true;
    if (sunSurpriseTimer) clearTimeout(sunSurpriseTimer);
    sunSurpriseTimer = setTimeout(() => { sunSurprised = false; }, 500);
  });

  Net.on('sunWink', () => {
    setSunEmote('winking', 800);
    sunWinking = true;
    if (sunWinkTimer) clearTimeout(sunWinkTimer);
    sunWinkTimer = setTimeout(() => { sunWinking = false; }, 800);
  });

  Net.on('panic', (msg) => {
    const gi = msg.player - 1;
    panicPlayers.add(gi);
    reactionStart[gi] = performance.now();
    playMonkeyChatter(false);
    const duration = Math.max(0, Number(msg.duration) || 0);
    if (duration > 0) {
      setTimeout(() => panicPlayers.delete(gi), duration);
    }
  });

  Net.on('nearMiss', (msg) => {
    const gi = msg.player - 1;
    reactionStart[gi] = performance.now();
    if (flinchTimers[gi]) clearTimeout(flinchTimers[gi]);
    flinchTimers[gi] = setTimeout(() => {
      delete flinchTimers[gi];
      if (phewTimers[gi]) clearTimeout(phewTimers[gi]);
      reactionStart[gi] = performance.now();
      phewTimers[gi] = setTimeout(() => { delete phewTimers[gi]; }, 1200);
      playPhewSound();
    }, 600);
  });

  Net.on('cinematicStart', () => {
    startCinematicZoom();
    enterCinematicTime();
  });

  Net.on('turretDeploy', (msg) => {
    turrets.push({
      id: msg.id,
      ownerIdx: msg.playerIdx,
      x: msg.x, y: msg.y,
      cx: msg.cx, cy: msg.cy,
      aimAngle: 0,
      barrelKick: 0,
      expireTurn: msg.expireTurn,
    });
    playTurretDeploySound();
    startShake();
  });

  Net.on('turretFire', (msg) => {
    const t = turrets.find(x => x.id === msg.id);
    if (!t) return;
    t.aimAngle = Math.atan2(msg.ty - t.cy, msg.tx - t.cx);
    t.barrelKick = -2;
    // Muzzle point ~10px out along barrel
    const mx = t.cx + Math.cos(t.aimAngle) * 10;
    const my = (t.y + 3) + Math.sin(t.aimAngle) * 10;
    // Animated tracer: travels from muzzle to target at 350 px/sec
    const tdx = msg.tx - mx;
    const tdy = msg.ty - my;
    const dist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
    const TRACER_SPEED = 350; // px/sec — slow enough to track visually
    const travelTime = dist / TRACER_SPEED;
    turretTracers.push({
      sx: mx, sy: my,
      tx: msg.tx, ty: msg.ty,
      dist,
      speed: TRACER_SPEED,
      progress: 0,
      life: travelTime + 0.15,
      maxLife: travelTime + 0.15,
    });
    playTurretBurst();
    if (msg.hit) {
      // Small airburst at the impact point
      Particles.burstSparks(msg.tx, msg.ty, 12);
      Particles.burstSmoke(msg.tx, msg.ty, 6);
      Lighting.triggerExplosionFlash(false);
    }
  });

  Net.on('turretKill', (msg) => {
    // Banana shot down mid-air — cosmetic only, server follows up with a `miss`
    showBanana = false;
    banana = null;
    Particles.burstSparks(msg.x, msg.y, 18);
    Particles.burstSmoke(msg.x, msg.y, 10);
    playExplosionSound();
    endCinematicZoom(300);
  });

  Net.on('turretDestroy', (msg) => {
    const idx = turrets.findIndex(x => x.id === msg.id);
    if (idx < 0) return;
    const t = turrets[idx];
    turrets.splice(idx, 1);
    if (msg.reason === 'expired') {
      // Quiet self-destruct — small sparks, no shake
      Particles.burstSparks(t.cx, t.cy, 10);
      playTurretDestroySound();
    } else {
      // 'hit' or 'explosion' — bigger reaction
      Particles.burstSparks(t.cx, t.cy, 25);
      Particles.burstSmoke(t.cx, t.cy, 15);
      startShake();
      playTurretDestroySound();
    }
  });

  Net.on('turretDud', (msg) => {
    // Deploy projectile went off-map or hit a gorilla — treat like a dud banana
    showBanana = false;
    banana = null;
    playDudSound();
    endCinematicZoom(200);
  });

  Net.on('turretCharges', (msg) => {
    if (Array.isArray(msg.charges)) {
      for (let i = 0; i < 4; i++) {
        if (msg.charges[i] != null) turretCharges[i] = msg.charges[i];
      }
      updateAmmoSelect();
    }
  });

  Net.on('frustrated', (msg) => {
    const gi = (msg.player | 0) - 1;
    if (gi < 0 || gi > 3) return;
    reactionStart[gi] = performance.now();
    if (frustratedTimers[gi]) clearTimeout(frustratedTimers[gi]);
    frustratedTimers[gi] = setTimeout(() => { delete frustratedTimers[gi]; }, 2500);
    playFrustratedSound();
  });

  Net.on('gorillaDeath', (msg) => {
    const gi = msg.player - 1;
    gorillaVisible[gi] = false;
    spawnDeathChunks(msg.x, msg.y);
    playGorillaDeathSound();
  });

  Net.on('napalm', (msg) => {
    napalmPatches.push({
      x: msg.x, y: msg.y,
      radius: msg.radius,
      startTime: performance.now() / 1000,
    });
    playNapalmSound();
  });

  Net.on('erosion', (msg) => {
    for (const pt of msg.points) {
      carvedExplosions.push({ x: pt.x, y: pt.y, radius: pt.radius });
      carveExplosion(pt.x, pt.y, pt.radius);
    }
  });

  Net.on('buildingCollapse', (msg) => {
    collapsedBuildings.add(msg.index);
    buildTerrainCanvas();
    startShake();
    playBuildingCollapseSound();
  });

  Net.on('gorillaFall', (msg) => {
    gorillas[msg.player - 1].y = msg.newY;
  });

  Net.on('weatherTick', (msg) => {
    wind = msg.wind;
    drawWindArrow();
  });

  Net.on('explosion', (msg) => {
    showBanana = false;
    banana = null;

    playExplosionSound();
    startShake();
    endCinematicZoom(300);

    // Sun reacts to explosion
    if (sunEmote === 'watching' || sunEmote === 'worried') {
      setSunEmote('surprised', 600);
    }

    carvedExplosions.push({ x: msg.x, y: msg.y, radius: msg.radius });
    carveExplosion(msg.x, msg.y, msg.radius);

    explosions.push({
      x: msg.x,
      y: msg.y,
      maxRadius: msg.radius,
      progress: 0,
    });

    // Visual effects for explosion
    Lighting.addExplosionLight(msg.x, msg.y, msg.radius);
    Lighting.triggerExplosionFlash(false);
    Particles.burstSparks(msg.x, msg.y, 20);
    Particles.burstSmoke(msg.x, msg.y, 15);
    Lighting.addBananaGlow(msg.x, msg.y);
  });

  Net.on('gorillaHit', (msg) => {
    showBanana = false;
    banana = null;
    clusterBananas = [];
    scores = Array.isArray(msg.scores) ? msg.scores.slice() : scores;
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) playerNames = msg.playerNames.slice();
    if (Array.isArray(msg.playerTeams)) playerTeams = msg.playerTeams.slice();
    scoreMode = msg.scoreMode || scoreMode;
    teamScores = Array.isArray(msg.teamScores) ? msg.teamScores.slice() : null;

    playGorillaHitSound();
    startShake();
    // Bright flash for match-winning kill
    Lighting.triggerExplosionFlash(!!msg.slowmo);

    const winnerIdx = msg.winner - 1;
    startVictoryDance(winnerIdx);

    // Sun reacts to the hit
    if (msg.slowmo) {
      setSunEmote('celebrating', 3000);
    } else {
      setSunEmote('shocked', 2000);
    }

    if (msg.slowmo) {
      slowmoActive = true;
      if (slowmoTimer) clearTimeout(slowmoTimer);
      // Slow down background music during slowmo
      if (bgAudio && !bgAudio.paused) bgAudio.playbackRate = 0.7;
      slowmoTimer = setTimeout(() => {
        slowmoActive = false;
        if (bgAudio && !bgAudio.paused) bgAudio.playbackRate = 1.0;
      }, 2500);
    }

    updateHUD();
  });

  Net.on('miss', () => {
    showBanana = false;
    banana = null;
    clusterBananas = [];
    setSunEmote('happy', 1500);
    // Shooter slumps
    const shooterIdx = currentPlayer - 1;
    if (shooterIdx >= 0 && shooterIdx < 4) {
      reactionStart[shooterIdx] = performance.now();
      if (missedTimers[shooterIdx]) clearTimeout(missedTimers[shooterIdx]);
      missedTimers[shooterIdx] = setTimeout(() => { delete missedTimers[shooterIdx]; }, 1200);
    }
  });

  Net.on('matchOver', (msg) => {
    stopVictorySound();
    stopTurnTimerDisplay();
    stopBGMusic();
    stopWeatherAudio();
    startVictoryMusic();
    if (Array.isArray(msg.finalScores)) scores = msg.finalScores.slice();
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) playerNames = msg.playerNames.slice();
    if (Array.isArray(msg.playerTeams)) playerTeams = msg.playerTeams.slice();
    scoreMode = msg.scoreMode || scoreMode;
    teamScores = Array.isArray(msg.teamScores) ? msg.teamScores.slice() : null;
    // Staggered confetti bursts for more celebration impact
    Particles.burstConfetti(LOGICAL_W / 2, LOGICAL_H / 3, 60);
    setTimeout(() => Particles.burstConfetti(LOGICAL_W * 0.25, LOGICAL_H * 0.4, 40), 300);
    setTimeout(() => Particles.burstConfetti(LOGICAL_W * 0.75, LOGICAL_H * 0.4, 40), 600);
    setTimeout(() => Particles.burstConfetti(LOGICAL_W * 0.4, LOGICAL_H * 0.25, 50), 900);
    setTimeout(() => Particles.burstConfetti(LOGICAL_W * 0.6, LOGICAL_H * 0.25, 50), 1200);
    switchToMatchOver(msg.winner, msg.finalScores, msg.stats);
  });

  Net.on('returnToSetup', () => {
    stopBGMusic();
    stopVictoryMusic();
    stopWeatherAudio();
    switchToSetup(false);
  });

  Net.on('effectEvent', (msg) => {
    Background.handleEffectEvent(msg);
  });

  Net.on('matchCleared', () => {
    stopBGMusic();
    stopVictoryMusic();
    stopWeatherAudio();
    Net.disconnect();
    switchToTitle();
  });

  Net.on('opponentDisconnected', (msg) => {
    if (gameState === 'playing') {
      const name = typeof msg?.playerName === 'string' && msg.playerName ? msg.playerName : 'A player';
      setDisconnectCopy(`${name} disconnected. Waiting 60 seconds for reconnect...`);
      document.getElementById('disconnect-screen').classList.add('active');
    }
  });

  Net.on('opponentReconnected', () => {
    setDisconnectCopy('Waiting 60 seconds for reconnect...');
    document.getElementById('disconnect-screen').classList.remove('active');
  });

  Net.on('opponentTimedOut', (msg) => {
    const name = typeof msg?.playerName === 'string' && msg.playerName ? msg.playerName : 'A player';
    setDisconnectCopy(`${name} timed out. Returning to the lobby...`);
    document.getElementById('disconnect-screen').classList.remove('active');
    switchToWaiting();
  });

  Net.on('settingsSync', (msg) => {
    if (msg.settings) {
      Object.assign(settings, msg.settings);
      applyCurrentSettingsToSetupUI();
      updateRoundsLabel();
      updateSetupPresentation(isJoining);
      if (gameState === 'waiting') {
        updateWaitingStatus({
          mode: settings.gameMode,
          requiredPlayers: getModeConfigLocal(settings.gameMode).requiredPlayers,
          supportedPlayers: getModeConfigLocal(settings.gameMode).supportedPlayers,
          connectedPlayers: playerNames.length,
        });
      }
    }
  });

  const musicSel = document.getElementById('music-select');
  if (musicSel) {
    musicSel.addEventListener('change', () => {
      saveSettings();
      applyMusicSetting();
    });
  }

  const musicHudEl = document.getElementById('hud-music');
  if (musicHudEl) {
    musicHudEl.addEventListener('click', () => {
      const sel = document.getElementById('music-select');
      if (sel) sel.value = isMusicEnabled() ? 'false' : 'true';
      applyMusicSetting();
      saveSettings();
    });
  }

  const prevTrackBtn = document.getElementById('hud-prev-track');
  if (prevTrackBtn) {
    prevTrackBtn.addEventListener('click', () => {
      const prev = ((bgTrackIndex - 1) + BG_PLAYLIST.length) % BG_PLAYLIST.length;
      playBGTrack(prev);
    });
  }

  const nextTrackBtn = document.getElementById('hud-next-track');
  if (nextTrackBtn) {
    nextTrackBtn.addEventListener('click', () => {
      playBGTrack(nextBGIndex(bgTrackIndex));
    });
  }

  Net.on('error', (msg) => {
    const message = typeof msg.message === 'string' ? msg.message : 'Unexpected server error';
    console.warn('Server error:', message);
    appendChatMessage('System', message, -1);
    if (gameState === 'waiting') {
      const statusEl = document.getElementById('waiting-status');
      if (statusEl) statusEl.textContent = message;
    }
  });

  Net.on('chat', (msg) => {
    const from = typeof msg.from === 'string' ? msg.from : '';
    const text = typeof msg.text === 'string' ? msg.text : '';
    if (!from || !text) return;
    // Use playerNames to pick the colour class; fall back to -1 (system style)
    const idx = playerNames.indexOf(from);
    appendChatMessage(from, text, idx);
  });

  // ─── Fire shot helper ──────────────────────────────────────────────────────
  function fireShot() {
    if (gameState !== 'playing') return;
    if (myPlayer !== currentPlayer) return;
    if (showBanana) return;
    const angle = Math.max(0, Math.min(180, parseInt(document.getElementById('input-angle').value) || 0));
    const velocity = Math.max(0, Math.min(maxVelocity, parseInt(document.getElementById('input-velocity').value) || 0));
    const turretRadio = document.getElementById('ammo-turret');
    const ammoType = (turretRadio && turretRadio.checked && !turretRadio.disabled) ? 'turret' : 'banana';
    Net.send({ type: 'fire', angle, velocity, ammoType });
    playUIConfirm();
    document.getElementById('input-panel').style.display = 'none';
  }

  document.getElementById('fire-btn').addEventListener('click', fireShot);

  // ─── Chat box click-to-type ───────────────────────────────────────────────
  document.getElementById('chat-box').addEventListener('click', (e) => {
    // Don't re-open if already clicking inside the input itself
    if (e.target.id === 'chat-input') return;
    openChatInput();
  });

  // ─── Taunt engine — 100 monkey animations ────────────────────────────────
  // Each taunt is a composition: {b: baseAnim, c: cycles, a: amp, f: face, s: sound,
  //                                p: armPose, r: rotRange, sc: scalePulse, dir: ±1}
  // Base anim takes (t∈[0,1], def) and returns {dx,dy,rot,sc,pose,face}
  const TAUNT_BASES = {
    bounce(t, d) {
      const ph = t * d.c * Math.PI * 2;
      return { dx: 0, dy: -Math.abs(Math.sin(ph)) * d.a, rot: 0, sc: 1,
               pose: (Math.floor(t * d.c * 2) % 2) ? 3 : 0 };
    },
    hop(t, d) {
      const local = (t * d.c) % 1;
      return { dx: 0, dy: -Math.sin(local * Math.PI) * d.a, rot: 0, sc: 1,
               pose: local < 0.5 ? 3 : 0 };
    },
    shake(t, d) {
      return { dx: Math.sin(t * d.c * Math.PI * 2) * d.a, dy: 0, rot: 0, sc: 1, pose: 3 };
    },
    wiggle(t, d) {
      const ph = t * d.c * Math.PI * 2;
      return { dx: Math.sin(ph) * d.a, dy: Math.cos(ph) * d.a * 0.4, rot: 0, sc: 1,
               pose: (Math.floor(t * d.c * 2) % 2) ? 1 : 2 };
    },
    spin(t, d) {
      return { dx: 0, dy: -Math.sin(t * Math.PI) * 4, rot: t * d.c * Math.PI * 2 * (d.dir || 1),
               sc: 1, pose: 3 };
    },
    flip(t, d) {
      return { dx: 0, dy: -Math.sin(t * Math.PI) * 24, rot: t * Math.PI * 2 * (d.dir || 1),
               sc: 1, pose: 3 };
    },
    grow(t, d) {
      const s = 1 + Math.sin(t * d.c * Math.PI * 2) * d.a;
      return { dx: 0, dy: 0, rot: 0, sc: s, pose: 3 };
    },
    moonwalk(t, d) {
      const step = (t * d.c) % 1;
      return { dx: (t - 0.5) * d.a * 2 * (d.dir || -1), dy: -Math.abs(Math.cos(step * Math.PI * 2)) * 3,
               rot: 0, sc: 1, pose: step < 0.5 ? 1 : 2 };
    },
    worm(t, d) {
      const w = Math.sin(t * d.c * Math.PI * 2);
      return { dx: w * d.a * 0.3, dy: w * d.a, rot: w * 0.25, sc: 1, pose: 4 };
    },
    headbang(t, d) {
      const p = Math.sin(t * d.c * Math.PI * 2);
      return { dx: 0, dy: Math.max(0, p) * d.a, rot: p * 0.18, sc: 1, pose: p > 0 ? 0 : 3 };
    },
    tantrum(t, d) {
      const ph = t * d.c * Math.PI * 2;
      return { dx: Math.sin(ph) * d.a, dy: -Math.abs(Math.sin(ph * 2)) * 4,
               rot: Math.sin(ph) * 0.12, sc: 1, pose: (Math.floor(t * d.c * 2) % 2) ? 3 : 0 };
    },
    lean(t, d) {
      const r = Math.sin(t * d.c * Math.PI * 2) * 0.4 * (d.dir || 1);
      return { dx: r * 6, dy: 0, rot: r, sc: 1, pose: r > 0 ? 1 : 2 };
    },
    flex(t, d) {
      const pulse = 1 + Math.sin(t * d.c * Math.PI * 2) * 0.08;
      return { dx: 0, dy: 0, rot: 0, sc: pulse, pose: 3 };
    },
    bow(t, d) {
      const bow = Math.sin(Math.min(1, t * 1.5) * Math.PI);
      return { dx: 0, dy: bow * 3, rot: bow * 0.5, sc: 1, pose: 0 };
    },
    slap(t, d) {
      const ph = (t * d.c) % 1;
      return { dx: 0, dy: Math.abs(Math.sin(ph * Math.PI)) * d.a, rot: 0, sc: 1, pose: ph < 0.5 ? 1 : 2 };
    },
  };

  // 100 taunt defs. Keep compact — base+params vary every entry.
  // Faces: h=happy, a=angry, t=tongue, w=woozy, s=smug, x=x_eyes, c=crying, n=normal
  // Sounds: beep,rasp,trill,honk,laugh,boo,drum,bell,whoop,squeak,horn,oof
  const TAUNT_DEFS = [
    {b:'bounce', c:4,a:10,s:'beep',f:'h',d:900},     // 1 chest bounce
    {b:'shake', c:10,a:3,s:'rasp',f:'t',d:900},      // 2 raspberry shake
    {b:'spin', c:2,a:0,s:'whoop',f:'h',d:900},       // 3 spin
    {b:'flip', c:1,a:0,s:'whoop',f:'w',d:800,dir:1}, // 4 backflip
    {b:'moonwalk',c:4,a:14,s:'bell',f:'s',d:1200},   // 5 moonwalk left
    {b:'flex', c:6,a:0,s:'drum',f:'s',d:1100,p:3},   // 6 flex
    {b:'bow', c:1,a:0,s:'bell',f:'h',d:900},         // 7 bow
    {b:'wiggle',c:5,a:6,s:'squeak',f:'t',d:900},     // 8 wiggle jazz
    {b:'tantrum',c:6,a:5,s:'honk',f:'a',d:1000},     // 9 stomp tantrum
    {b:'worm', c:4,a:6,s:'squeak',f:'n',d:1100},     // 10 worm
    {b:'headbang',c:8,a:4,s:'drum',f:'a',d:1000},    // 11 headbang
    {b:'lean', c:3,a:0,s:'beep',f:'s',d:900,dir:1},  // 12 lean swagger
    {b:'hop', c:4,a:10,s:'whoop',f:'h',d:900},       // 13 victory hops
    {b:'grow', c:3,a:0.2,s:'boo',f:'a',d:900},       // 14 grow shrink
    {b:'slap', c:5,a:2,s:'laugh',f:'h',d:900},       // 15 knee slaps
    {b:'shake',c:14,a:2,s:'trill',f:'n',d:700},      // 16 shiver
    {b:'spin', c:4,a:0,s:'horn',f:'t',d:1100,dir:-1},// 17 fast reverse spin
    {b:'bounce',c:6,a:14,s:'drum',f:'h',d:1200},     // 18 big bounces
    {b:'moonwalk',c:3,a:14,s:'bell',f:'s',d:1100,dir:1}, // 19 moonwalk right
    {b:'flip', c:1,a:0,s:'whoop',f:'w',d:800,dir:-1},// 20 front flip
    {b:'wiggle',c:3,a:10,s:'squeak',f:'t',d:900},    // 21 wiggle big
    {b:'tantrum',c:8,a:7,s:'honk',f:'a',d:1200},     // 22 tantrum loud
    {b:'lean', c:2,a:0,s:'beep',f:'c',d:900,dir:-1}, // 23 lean crying
    {b:'worm', c:6,a:8,s:'squeak',f:'w',d:1200},     // 24 worm frantic
    {b:'headbang',c:4,a:6,s:'drum',f:'n',d:900},     // 25 slow bang
    {b:'hop', c:5,a:6,s:'boo',f:'s',d:900},          // 26 cocky hops
    {b:'flex', c:3,a:0,s:'horn',f:'s',d:1000,p:3},   // 27 hold flex
    {b:'bow', c:1,a:0,s:'bell',f:'s',d:1200},        // 28 deep bow
    {b:'shake',c:6,a:5,s:'oof',f:'x',d:800},         // 29 quake
    {b:'grow', c:5,a:0.25,s:'boo',f:'t',d:900},      // 30 taunt grow
    {b:'bounce',c:2,a:6,s:'squeak',f:'c',d:800},     // 31 fake sad
    {b:'spin', c:3,a:0,s:'whoop',f:'h',d:1000},      // 32 medium spin
    {b:'wiggle',c:8,a:4,s:'rasp',f:'t',d:900},       // 33 raspberry wiggle
    {b:'moonwalk',c:2,a:20,s:'bell',f:'s',d:1400},   // 34 long moonwalk
    {b:'slap', c:8,a:2,s:'laugh',f:'h',d:1000},      // 35 rapid slaps
    {b:'tantrum',c:4,a:4,s:'honk',f:'a',d:800},      // 36 quick tantrum
    {b:'hop', c:3,a:14,s:'horn',f:'h',d:900},        // 37 big airhorn hop
    {b:'lean', c:4,a:0,s:'beep',f:'s',d:1000,dir:1}, // 38 lean swagger 2
    {b:'headbang',c:10,a:3,s:'drum',f:'a',d:1100},   // 39 metal bang
    {b:'flip', c:2,a:0,s:'whoop',f:'x',d:1200,dir:1},// 40 double flip
    {b:'bounce',c:8,a:5,s:'bell',f:'h',d:1000},      // 41 tiny jumps
    {b:'worm', c:2,a:10,s:'squeak',f:'t',d:900},     // 42 slow worm
    {b:'spin', c:5,a:0,s:'horn',f:'w',d:1300,dir:1}, // 43 dizzy spin
    {b:'flex', c:4,a:0,s:'drum',f:'s',d:1100,p:3},   // 44 pose
    {b:'bow', c:2,a:0,s:'bell',f:'h',d:1200},        // 45 double bow
    {b:'shake',c:8,a:6,s:'oof',f:'a',d:900},         // 46 angry shake
    {b:'wiggle',c:4,a:8,s:'squeak',f:'h',d:900},     // 47 jazz hands
    {b:'tantrum',c:10,a:6,s:'honk',f:'a',d:1300},    // 48 full meltdown
    {b:'grow', c:2,a:0.3,s:'boo',f:'s',d:900},       // 49 big grow
    {b:'slap', c:3,a:4,s:'laugh',f:'h',d:900},       // 50 heavy slaps
    {b:'hop', c:6,a:8,s:'whoop',f:'h',d:1000},       // 51 joy hops
    {b:'moonwalk',c:5,a:10,s:'bell',f:'s',d:1100,dir:-1}, // 52 moonwalk fast
    {b:'flip', c:1,a:0,s:'oof',f:'x',d:900},         // 53 failed flip
    {b:'headbang',c:6,a:5,s:'drum',f:'t',d:900},     // 54 tongue bang
    {b:'lean', c:5,a:0,s:'beep',f:'s',d:1100,dir:-1},// 55 hip swagger
    {b:'worm', c:3,a:7,s:'squeak',f:'w',d:1000},     // 56 silly worm
    {b:'spin', c:1,a:0,s:'whoop',f:'h',d:600},       // 57 quick spin
    {b:'bounce',c:5,a:8,s:'drum',f:'s',d:1000},      // 58 drumline
    {b:'shake',c:12,a:1.5,s:'trill',f:'h',d:800},    // 59 giggle shake
    {b:'flex', c:2,a:0,s:'horn',f:'a',d:900,p:3},    // 60 grunt
    {b:'tantrum',c:5,a:8,s:'honk',f:'c',d:1000},     // 61 cry tantrum
    {b:'wiggle',c:2,a:12,s:'rasp',f:'t',d:900},      // 62 big raspberry
    {b:'grow', c:4,a:0.15,s:'bell',f:'s',d:900},     // 63 chest puff
    {b:'hop', c:2,a:18,s:'horn',f:'h',d:900},        // 64 huge hop
    {b:'headbang',c:12,a:4,s:'drum',f:'a',d:1200},   // 65 rage bang
    {b:'spin', c:6,a:0,s:'horn',f:'w',d:1500,dir:-1},// 66 super dizzy
    {b:'lean', c:1,a:0,s:'beep',f:'s',d:700,dir:1},  // 67 single lean
    {b:'flip', c:2,a:0,s:'whoop',f:'h',d:1200,dir:-1},// 68 double back
    {b:'bow', c:3,a:0,s:'bell',f:'s',d:1300},        // 69 triple bow
    {b:'moonwalk',c:6,a:8,s:'bell',f:'s',d:1100,dir:1}, // 70 shuffle
    {b:'slap', c:10,a:2,s:'laugh',f:'h',d:1100},     // 71 manic slaps
    {b:'worm', c:5,a:5,s:'squeak',f:'w',d:1100},     // 72 fast worm
    {b:'bounce',c:3,a:12,s:'beep',f:'t',d:800},      // 73 tongue bounce
    {b:'shake',c:4,a:8,s:'oof',f:'x',d:800},         // 74 rattle
    {b:'wiggle',c:6,a:5,s:'squeak',f:'t',d:900},     // 75 shimmy
    {b:'flex', c:5,a:0,s:'drum',f:'a',d:1100,p:3},   // 76 tense flex
    {b:'hop', c:8,a:5,s:'bell',f:'h',d:1100},        // 77 rapid hops
    {b:'tantrum',c:3,a:10,s:'honk',f:'a',d:800},     // 78 short burst
    {b:'spin', c:2,a:0,s:'whoop',f:'s',d:800,dir:-1},// 79 cocky spin
    {b:'grow', c:1,a:0.4,s:'boo',f:'a',d:900},       // 80 swell
    {b:'lean', c:2,a:0,s:'beep',f:'s',d:900,dir:-1}, // 81 lean other
    {b:'headbang',c:5,a:6,s:'drum',f:'a',d:950},     // 82 thrash
    {b:'flip', c:1,a:0,s:'whoop',f:'s',d:700,dir:1}, // 83 smug flip
    {b:'moonwalk',c:4,a:12,s:'bell',f:'t',d:1100,dir:-1}, // 84 tongue slide
    {b:'bow', c:1,a:0,s:'horn',f:'a',d:700},         // 85 mock bow
    {b:'worm', c:8,a:4,s:'squeak',f:'w',d:1300},     // 86 long worm
    {b:'shake',c:16,a:2,s:'trill',f:'t',d:900},      // 87 chatter
    {b:'bounce',c:10,a:4,s:'drum',f:'h',d:1100},     // 88 pitter-patter
    {b:'wiggle',c:10,a:3,s:'squeak',f:'h',d:1000},   // 89 jiggle
    {b:'flex', c:7,a:0,s:'horn',f:'s',d:1200,p:3},   // 90 muscle show
    {b:'slap', c:6,a:3,s:'laugh',f:'s',d:1000},      // 91 smug slaps
    {b:'hop', c:4,a:12,s:'whoop',f:'h',d:950},       // 92 bouncy joy
    {b:'tantrum',c:2,a:12,s:'honk',f:'c',d:700},     // 93 pout stomp
    {b:'spin', c:8,a:0,s:'horn',f:'w',d:1700,dir:1}, // 94 mega spin
    {b:'grow', c:6,a:0.1,s:'bell',f:'n',d:1000},     // 95 breathe
    {b:'bow', c:4,a:0,s:'bell',f:'s',d:1500},        // 96 encore
    {b:'headbang',c:3,a:7,s:'drum',f:'a',d:800},     // 97 slam
    {b:'worm', c:7,a:6,s:'squeak',f:'t',d:1300},     // 98 waggle
    {b:'moonwalk',c:2,a:22,s:'bell',f:'s',d:1500,dir:1}, // 99 epic glide
    {b:'flip', c:3,a:0,s:'whoop',f:'x',d:1500,dir:-1},// 100 triple flip
  ];

  // Compute transform for an active taunt at current time
  function getTauntTransform(playerIdx) {
    const tt = activeTaunts[playerIdx];
    if (!tt) return null;
    const t = (performance.now() - tt.start) / tt.dur;
    if (t >= 1) { activeTaunts[playerIdx] = null; return null; }
    const def = TAUNT_DEFS[tt.defIdx] || TAUNT_DEFS[0];
    const base = TAUNT_BASES[def.b] || TAUNT_BASES.bounce;
    const tr = base(t, def);
    tr.face = def.f;
    if (def.p !== undefined) tr.pose = def.p;
    return tr;
  }

  // ─── Taunt sound library ─────────────────────────────────────────────────
  function tauntAudio() { return ensureAudio(); }
  function _tone(type, freq, dur, vol, t0) {
    const ctx = tauntAudio();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur);
    return o;
  }
  const TAUNT_SOUNDS = {
    beep() {
      const ctx = tauntAudio(); let t = ctx.currentTime;
      [880,1100,880,1320].forEach((f,i) => _tone('square', f, 0.09, 0.15, t + i*0.08));
    },
    rasp() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t);
      o.frequency.linearRampToValueAtTime(90, t + 0.5);
      const lfo = ctx.createOscillator(); const lg = ctx.createGain();
      lfo.frequency.value = 30; lg.gain.value = 40;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.connect(g).connect(ctx.destination);
      lfo.start(t); o.start(t); lfo.stop(t + 0.55); o.stop(t + 0.55);
    },
    trill() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      for (let i = 0; i < 8; i++) _tone('triangle', 1200 + (i%2)*400, 0.05, 0.12, t + i*0.05);
    },
    honk() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      _tone('sawtooth', 220, 0.25, 0.22, t);
      _tone('sawtooth', 180, 0.25, 0.22, t + 0.02);
    },
    laugh() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      const notes = [440,520,460,540,480,560];
      notes.forEach((f,i) => _tone('square', f, 0.08, 0.14, t + i*0.07));
    },
    boo() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(500, t);
      o.frequency.exponentialRampToValueAtTime(100, t + 0.6);
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.65);
    },
    drum() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      for (let i = 0; i < 6; i++) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(90, t + i*0.08);
        o.frequency.exponentialRampToValueAtTime(40, t + i*0.08 + 0.08);
        g.gain.setValueAtTime(0.35, t + i*0.08); g.gain.exponentialRampToValueAtTime(0.001, t + i*0.08 + 0.1);
        o.connect(g).connect(ctx.destination); o.start(t + i*0.08); o.stop(t + i*0.08 + 0.12);
      }
    },
    bell() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      [880, 1320, 1760].forEach((f,i) => _tone('sine', f, 0.5, 0.1 - i*0.02, t + i*0.05));
    },
    whoop() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(400, t);
      o.frequency.exponentialRampToValueAtTime(1600, t + 0.4);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.45);
    },
    squeak() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) _tone('square', 1800 + i*200, 0.04, 0.1, t + i*0.06);
    },
    horn() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      _tone('sawtooth', 330, 0.18, 0.22, t);
      _tone('sawtooth', 440, 0.25, 0.2,  t + 0.18);
    },
    oof() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      const bufSize = ctx.sampleRate * 0.25;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = (Math.random()*2-1) * (1 - i/bufSize);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      const g = ctx.createGain(); g.gain.value = 0.25;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t);
    },
  };
  function playTauntSound(soundId) {
    try { (TAUNT_SOUNDS[soundId] || TAUNT_SOUNDS.beep)(); }
    catch (e) { /* audio unavailable */ }
  }

  function startTaunt(playerIdx, animId) {
    const idx = Math.max(0, Math.min(TAUNT_DEFS.length - 1, (animId | 0) - 1));
    const def = TAUNT_DEFS[idx];
    activeTaunts[playerIdx] = { defIdx: idx, start: performance.now(), dur: def.d || 1000 };
    playTauntSound(def.s);
  }

  // ─── Cooldown UI ─────────────────────────────────────────────────────────
  let tauntCooldownUntil = 0;
  let tauntCooldownInterval = null;
  function applyTauntCooldown(ms) {
    tauntCooldownUntil = performance.now() + ms;
    const btn = document.getElementById('taunt-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.classList.add('cooling');
    if (tauntCooldownInterval) clearInterval(tauntCooldownInterval);
    const originalLabel = 'TAUNT';
    const tick = () => {
      const left = Math.max(0, tauntCooldownUntil - performance.now());
      if (left <= 0) {
        btn.disabled = false;
        btn.classList.remove('cooling');
        btn.textContent = originalLabel;
        clearInterval(tauntCooldownInterval);
        tauntCooldownInterval = null;
        return;
      }
      btn.textContent = `COOLDOWN ${(left / 1000).toFixed(1)}s`;
    };
    tick();
    tauntCooldownInterval = setInterval(tick, 100);
  }

  document.getElementById('taunt-btn').addEventListener('click', () => {
    if (performance.now() < tauntCooldownUntil) return;
    const animId = Math.floor(Math.random() * TAUNT_DEFS.length) + 1;
    Net.send({ type: 'taunt', animId });
    if (myPlayer >= 1) startTaunt(myPlayer - 1, animId);
  });

  Net.on('taunt', (msg) => {
    const player = typeof msg.player === 'number' ? msg.player : 0;
    const animId = typeof msg.animId === 'number' ? msg.animId : 1;
    if (player >= 1 && player <= 4) startTaunt(player - 1, animId);
  });

  Net.on('tauntCooldown', (msg) => {
    const ms = Math.max(0, Math.floor(Number(msg.ms) || 0));
    if (ms > 0) applyTauntCooldown(ms);
  });

  // ─── Picnic! button: self-panic your own monkey ─────────────────────────
  let picnicCooldownUntil = 0;
  const picnicBtn = document.getElementById('picnic-btn');
  if (picnicBtn) {
    picnicBtn.addEventListener('click', () => {
      const now = performance.now();
      if (now < picnicCooldownUntil) return;
      if (myPlayer < 1) return;
      picnicCooldownUntil = now + 3000;
      picnicBtn.classList.add('cooling');
      setTimeout(() => picnicBtn.classList.remove('cooling'), 3000);
      Net.send({ type: 'picnic' });
      playMonkeyChatter(true);
      // Local echo in case we're offline/solo
      const gi = myPlayer - 1;
      panicPlayers.add(gi);
      reactionStart[gi] = performance.now();
      setTimeout(() => panicPlayers.delete(gi), 2000);
    });
  }

  // ─── Input handling ────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT');

    switch (gameState) {
      case 'title':
        if (e.key === 'Enter') {
          e.preventDefault();
          isJoining = false;
          switchToSetup(false);
        }
        break;

      case 'setup':
        if (e.key === 'Enter') {
          e.preventDefault();
          myName = document.getElementById('player-name').value.trim() || 'Player';
          saveSettings();
          playUIConfirm();
          if (Net.isConnected()) {
            if (isHostPlayer()) {
              sendAllSettings();
              switchToWaiting();
            } else {
              switchToWaiting();
            }
          } else {
            Net.connect(myName, sessionToken);
          }
        }
        break;

      case 'waiting':
        break;

      case 'playing':
        // Chat input has priority over all other bindings
        if (activeEl && activeEl.id === 'chat-input') {
          if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
          if (e.key === 'Escape') { e.preventDefault(); closeChatInput(); }
          break;
        }

        if ((e.key === 'm' || e.key === 'M') && !isInput) {
          e.preventDefault();
          const sel = document.getElementById('music-select');
          if (sel) sel.value = isMusicEnabled() ? 'false' : 'true';
          applyMusicSetting();
          saveSettings();
        }

        if ((e.key === 't' || e.key === 'T') && !isInput) {
          e.preventDefault();
          openChatInput();
        }

        if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
          if (!isInput || e.key === 'Escape') {
            e.preventDefault();
            previousState = gameState;
            gameState = 'paused';
            showScreen('pause-screen');
            document.getElementById('hud').classList.add('active');
          }
        }

        if (e.key === 'r' || e.key === 'R') {
          if (!isInput) {
            showConfirmOverlay();
          }
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          if (!isInput) {
            // Open chat if fire panel not showing, otherwise fire
            const panel = document.getElementById('input-panel');
            if (panel && panel.style.display === 'none') {
              openChatInput();
            } else {
              fireShot();
            }
          } else if (activeEl.id === 'input-angle') {
            document.getElementById('input-velocity').focus();
          } else {
            fireShot();
          }
        }

        if (isInput && e.key === 'Tab') {
          e.preventDefault();
          if (activeEl.id === 'input-angle') {
            document.getElementById('input-velocity').focus();
          } else {
            document.getElementById('input-angle').focus();
          }
        }
        break;

      case 'paused':
        if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          gameState = previousState || 'playing';
          document.getElementById('pause-screen').classList.remove('active');
          if (gameState === 'playing') {
            document.getElementById('hud').classList.add('active');
            updateInputPanel();
          }
        }
        break;

      case 'matchOver':
        // Chat input has priority
        if (activeEl && activeEl.id === 'chat-input') {
          if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
          if (e.key === 'Escape') { e.preventDefault(); closeChatInput(); }
          break;
        }

        if ((e.key === 't' || e.key === 'T') && !isInput) {
          e.preventDefault();
          openChatInput();
          break;
        }

        if (e.key === 'Enter' && !isInput) {
          e.preventDefault();
          openChatInput();
          break;
        }

        if (e.key === 'r' || e.key === 'R') {
          if (!isHostPlayer()) break;
          stopVictoryMusic();
          Net.send({ type: 'rematch' });
        }
        if (e.key === 'n' || e.key === 'N') {
          if (!isHostPlayer()) break;
          stopVictoryMusic();
          Net.send({ type: 'newMatch' });
        }
        if (e.key === 'Escape') {
          stopVictoryMusic();
          Net.disconnect();
          switchToTitle();
        }
        break;
    }
  });

  // ─── Match over action buttons ──────────────────────────────────────────────
  const rematchBtn = document.getElementById('rematch-btn');
  if (rematchBtn) {
    rematchBtn.addEventListener('click', () => {
      if (!isHostPlayer()) return;
      stopVictoryMusic();
      Net.send({ type: 'rematch' });
    });
  }
  const newMatchBtn = document.getElementById('new-match-btn');
  if (newMatchBtn) {
    newMatchBtn.addEventListener('click', () => {
      if (!isHostPlayer()) return;
      stopVictoryMusic();
      Net.send({ type: 'newMatch' });
    });
  }
  const titleReturnBtn = document.getElementById('title-return-btn');
  if (titleReturnBtn) {
    titleReturnBtn.addEventListener('click', () => {
      stopVictoryMusic();
      Net.disconnect();
      switchToTitle();
    });
  }

  // ─── Confirm overlay ──────────────────────────────────────────────────────
  function showConfirmOverlay() {
    document.getElementById('confirm-screen').classList.add('active');
  }
  function hideConfirmOverlay() {
    document.getElementById('confirm-screen').classList.remove('active');
  }
  document.getElementById('confirm-yes').addEventListener('click', () => {
    hideConfirmOverlay();
    if (!isHostPlayer()) return;
    Net.send({ type: 'rematch' });
  });
  document.getElementById('confirm-no').addEventListener('click', () => {
    hideConfirmOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('confirm-screen').classList.contains('active')) return;
    if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault();
      hideConfirmOverlay();
      if (!isHostPlayer()) return;
      Net.send({ type: 'rematch' });
    } else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
      e.preventDefault();
      hideConfirmOverlay();
    }
  });

  // ─── Initialize ────────────────────────────────────────────────────────────
  // Init visual effects systems
  Lighting.init(LOGICAL_W, LOGICAL_H);
  Particles.init(LOGICAL_W, LOGICAL_H);
  Background.init(LOGICAL_W, LOGICAL_H);

  // Apply effects quality from settings
  const eqSel = document.getElementById('effects-quality-select');
  if (eqSel) {
    const q = parseInt(eqSel.value, 10);
    Lighting.setQuality(q);
    Particles.setQuality(q);
    Background.setQuality(q);
    eqSel.addEventListener('change', () => {
      const nq = parseInt(eqSel.value, 10);
      Lighting.setQuality(nq);
      Particles.setQuality(nq);
      Background.setQuality(nq);
    });
  }

  applyMusicSetting();

  switchToTitle();
  render();

  // Wrap thunder to also briefly scare every visible monkey
  function thunderScare() {
    const count = gorillas.length || 2;
    for (let i = 0; i < count; i++) {
      if (!gorillaVisible[i]) continue;
      panicPlayers.add(i);
      // Auto-clear after ~700ms so they settle back down
      setTimeout(() => panicPlayers.delete(i), 700);
    }
  }
  window.playThunderSound = function () {
    playThunderSound();
    thunderScare();
  };

  // Small procedural sound for "phew"
  function playPhewSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(800, t);
      o.frequency.exponentialRampToValueAtTime(300, t + 0.35);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.4);
    } catch (e) {}
  }

  // Monkey chatter: rapid pitched "ooh-ooh-ah-ah" via FM-like oscillator bursts
  function playMonkeyChatter(loud) {
    try {
      const actx = ensureAudio();
      const masterGain = actx.createGain();
      masterGain.gain.setValueAtTime(loud ? 0.22 : 0.14, actx.currentTime);
      masterGain.connect(actx.destination);

      // Series of quick hoots pitched like a real chimp
      const hoots = [520, 480, 560, 420, 580, 460, 600, 400];
      hoots.forEach((freq, i) => {
        const tStart = actx.currentTime + i * 0.11;
        const dur = 0.09;

        const osc = actx.createOscillator();
        const g   = actx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, tStart);
        // Rising chirp within each burst
        osc.frequency.linearRampToValueAtTime(freq * 1.35, tStart + dur * 0.4);
        osc.frequency.linearRampToValueAtTime(freq * 0.85, tStart + dur);

        g.gain.setValueAtTime(0, tStart);
        g.gain.linearRampToValueAtTime(1, tStart + 0.015);
        g.gain.setValueAtTime(1,   tStart + dur * 0.6);
        g.gain.linearRampToValueAtTime(0, tStart + dur);

        // Low-pass to keep it from sounding too harsh
        const filt = actx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(2200, tStart);

        osc.connect(filt).connect(g).connect(masterGain);
        osc.start(tStart);
        osc.stop(tStart + dur + 0.01);
      });
    } catch (e) {}
  }

  // Small procedural grumble for "frustrated"
  function playFrustratedSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(160, t);
      o.frequency.linearRampToValueAtTime(90, t + 0.6);
      const lfo = ctx.createOscillator(); const lg = ctx.createGain();
      lfo.frequency.value = 12; lg.gain.value = 20;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      o.connect(g).connect(ctx.destination);
      lfo.start(t); o.start(t); lfo.stop(t + 0.65); o.stop(t + 0.65);
    } catch (e) {}
  }

  // Idle watcher: if it's your turn and you haven't fired in IDLE_MS, yawn.
  const IDLE_MS = 20000;
  let idleBoredInterval = setInterval(() => {
    if (gameState !== 'playing') return;
    if (myPlayer < 1 || myPlayer !== currentPlayer) return;
    if (showBanana) return;
    if (performance.now() - turnStartedAt < IDLE_MS) return;
    const gi = myPlayer - 1;
    if (boredTimers[gi]) return; // already bored
    boredTimers[gi] = setTimeout(() => { delete boredTimers[gi]; }, 3000);
  }, 1000);

  // Expose thunder sound to global scope for background.js
})();
