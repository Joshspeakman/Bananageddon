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
    crtOverlay: true,
  };
  const PLAYER_COLOR_DEFAULTS = Shared.PLAYER_COLOR_DEFAULTS || ['#9D52FF', '#FF8A4C', '#55E9FF', '#A6FF55'];
  const getDefaultPlayerColor = typeof Shared.getDefaultPlayerColor === 'function'
    ? Shared.getDefaultPlayerColor
    : function (slotIdx = 0) {
      const idx = Math.abs(Math.floor(Number(slotIdx) || 0)) % PLAYER_COLOR_DEFAULTS.length;
      return PLAYER_COLOR_DEFAULTS[idx];
    };
  const sanitizePlayerColor = typeof Shared.sanitizePlayerColor === 'function'
    ? Shared.sanitizePlayerColor
    : function (value, fallback = PLAYER_COLOR_DEFAULTS[0]) {
      const safeFallback = /^#[0-9A-F]{6}$/i.test(fallback || '')
        ? fallback.toUpperCase()
        : PLAYER_COLOR_DEFAULTS[0];

      if (typeof value !== 'string') return safeFallback;

      const trimmed = value.trim();
      const shortMatch = trimmed.match(/^#([0-9a-fA-F]{3})$/);
      if (shortMatch) {
        return `#${shortMatch[1].split('').map(ch => ch + ch).join('')}`.toUpperCase();
      }

      const longMatch = trimmed.match(/^#([0-9a-fA-F]{6})$/);
      if (longMatch) {
        return `#${longMatch[1]}`.toUpperCase();
      }

      return safeFallback;
    };

  const DEFAULT_MAP_CONFIG = MAP_SIZES.normal || { w: 640, h: 480 };

  // ─── Active logical dimensions ─────────────────────────────────────────────
  let LOGICAL_W = DEFAULT_MAP_CONFIG.w;
  let LOGICAL_H = DEFAULT_MAP_CONFIG.h;
  const GORILLA_W = 28;
  const GORILLA_H = 28;
  let SUN_X = LOGICAL_W / 2;
  let SUN_Y = 68;
  const SUN_RADIUS = 30;

  // ─── Biome color palettes ──────────────────────────────────────────────────
  const BIOME_COLORS = {
    city: {
      sky: '#2440A8',
      buildings: ['#55FFFF', '#FF55FF', '#AAAAAA'],
      windowLit: '#FFF26A',
      windowUnlit: '#23355A',
      outline: '#060A1A',
      shadow: '#14285C',
      highlight: '#9FE8FF',
      roof: '#0A1A3E',
      accent: '#FFDC55',
      sun: '#FFF07A',
      haze: '#5E86FF',
      stageFar: '#13256B',
      stageMid: '#08103C',
      stageNear: '#060A21',
    },
    desert: {
      sky: '#D8923F',
      buildings: ['#D2A679', '#C4965A', '#B8860B'],
      windowLit: '#FFD76D',
      windowUnlit: '#7A5732',
      outline: '#1F0E05',
      shadow: '#8C5427',
      highlight: '#FFD4A0',
      roof: '#5B310F',
      accent: '#FFB347',
      sun: '#FFE18A',
      haze: '#F8B46C',
      stageFar: '#915126',
      stageMid: '#5A2D12',
      stageNear: '#2D1507',
    },
    arctic: {
      sky: '#78BCE6',
      buildings: ['#B0C4DE', '#87CEEB', '#F0F8FF'],
      windowLit: '#E9FFFF',
      windowUnlit: '#466480',
      outline: '#081521',
      shadow: '#6F9BC0',
      highlight: '#F8FFFF',
      roof: '#3A5A79',
      accent: '#8CF4FF',
      sun: '#FFF3B8',
      haze: '#BFE9FF',
      stageFar: '#7EA8C3',
      stageMid: '#436684',
      stageNear: '#1A3142',
    },
    jungle: {
      sky: '#184B22',
      buildings: ['#228B22', '#2E8B57', '#006400'],
      windowLit: '#B8FF5A',
      windowUnlit: '#173420',
      outline: '#041006',
      shadow: '#0E4A14',
      highlight: '#5CCB74',
      roof: '#07260B',
      accent: '#E7D950',
      sun: '#FFE77A',
      haze: '#2E7A37',
      stageFar: '#0E3212',
      stageMid: '#081D0A',
      stageNear: '#041006',
    },
    volcanic: {
      sky: '#36110A',
      buildings: ['#4A0000', '#8B0000', '#333333'],
      windowLit: '#FF7A2C',
      windowUnlit: '#221010',
      outline: '#0D0202',
      shadow: '#4B0E06',
      highlight: '#C84E18',
      roof: '#230404',
      accent: '#FF8A3D',
      sun: '#FFC16C',
      haze: '#7A2412',
      stageFar: '#541107',
      stageMid: '#250605',
      stageNear: '#120202',
    },
    moon: {
      sky: '#0A0E22',
      buildings: ['#808080', '#696969', '#A9A9A9'],
      windowLit: '#DDE1F2',
      windowUnlit: '#2B3146',
      outline: '#02040B',
      shadow: '#5F6477',
      highlight: '#D8DCE8',
      roof: '#393F56',
      accent: '#A5B1D4',
      sun: '#E6EAF7',
      haze: '#354264',
      stageFar: '#2A344F',
      stageMid: '#161C30',
      stageNear: '#090C18',
    },
    underwater: {
      sky: '#0A4B79',
      buildings: ['#008B8B', '#006666', '#20B2AA'],
      windowLit: '#86FFF3',
      windowUnlit: '#033F44',
      outline: '#021317',
      shadow: '#045D5D',
      highlight: '#56D8D0',
      roof: '#04353B',
      accent: '#8CF7FF',
      sun: '#B7F5FF',
      haze: '#1C8CBD',
      stageFar: '#0C5F7B',
      stageMid: '#053542',
      stageNear: '#02171C',
    },
    postapoc: {
      sky: '#705A2B',
      buildings: ['#555555', '#666644', '#444444'],
      windowLit: '#D4A337',
      windowUnlit: '#2B241C',
      outline: '#0D0906',
      shadow: '#3E3428',
      highlight: '#8C7A56',
      roof: '#231B14',
      accent: '#FF9344',
      sun: '#FFD07B',
      haze: '#AD7B40',
      stageFar: '#655031',
      stageMid: '#382A18',
      stageNear: '#171008',
    },
    cyberpunk: {
      sky: '#0A1033',
      buildings: ['#1A1A2E', '#16213E', '#0F3460'],
      windowLit: '#FF5BE8',
      windowUnlit: '#100F2B',
      outline: '#02030B',
      shadow: '#0A1A4A',
      highlight: '#4AD6FF',
      roof: '#070A1A',
      accent: '#FF5BE8',
      sun: '#FF8A6B',
      haze: '#3E57BA',
      stageFar: '#22195B',
      stageMid: '#100B31',
      stageNear: '#050813',
    },
  };

  // ─── Sky colors by time of day ─────────────────────────────────────────────
  const SKY_COLORS = { day: '#0000AA', night: '#000022', dawn: '#0000AA', dusk: '#0000AA' };
  const STAR_COLOR = '#FFFFFF';
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
  let backdropCanvas = document.createElement('canvas');
  backdropCanvas.width = LOGICAL_W;
  backdropCanvas.height = LOGICAL_H;
  let backdropCtx = backdropCanvas.getContext('2d');
  backdropCtx.imageSmoothingEnabled = false;

  function setLogicalSize(w, h) {
    LOGICAL_W = w;
    LOGICAL_H = h;
    SUN_X = LOGICAL_W / 2;
    SUN_Y = 68;
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false;
    terrainCanvas.width = w;
    terrainCanvas.height = h;
    terrainCtx = terrainCanvas.getContext('2d');
    terrainCtx.imageSmoothingEnabled = false;
    backdropCanvas.width = w;
    backdropCanvas.height = h;
    backdropCtx = backdropCanvas.getContext('2d');
    backdropCtx.imageSmoothingEnabled = false;
    Lighting.resize(w, h);
    Particles.resize(w, h);
    Background.resize(w, h);
    resizeCanvas();
  }

  let resizeCanvasFrame = null;

  function scheduleCanvasResize() {
    if (resizeCanvasFrame !== null) cancelAnimationFrame(resizeCanvasFrame);
    resizeCanvasFrame = requestAnimationFrame(() => {
      resizeCanvasFrame = null;
      resizeCanvas();
    });
  }

  function resizeCanvas() {
    const container = document.getElementById('game-container');
    if (!container) return;
    const cw = Math.max(1, container.clientWidth);
    const containerHeight = Math.max(1, container.clientHeight);
    const scale = Math.min(cw / LOGICAL_W, containerHeight / LOGICAL_H);
    const renderWidth = Math.max(1, Math.floor(LOGICAL_W * scale));
    const renderHeight = Math.max(1, Math.floor(LOGICAL_H * scale));
    const offsetX = Math.floor((cw - renderWidth) / 2);
    const offsetY = Math.floor((containerHeight - renderHeight) / 2);
    container.style.setProperty('--playfield-left', offsetX + 'px');
    container.style.setProperty('--playfield-top', offsetY + 'px');
    container.style.setProperty('--playfield-width', renderWidth + 'px');
    container.style.setProperty('--playfield-height', renderHeight + 'px');
    canvas.style.width = renderWidth + 'px';
    canvas.style.height = renderHeight + 'px';
    canvas.style.left = Math.floor(offsetX + (renderWidth / 2)) + 'px';
    canvas.style.top = Math.floor(offsetY + (renderHeight / 2)) + 'px';
  }
  window.addEventListener('resize', (() => {
    let _resizeTimer = null;
    return () => {
      if (_resizeTimer) clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => { _resizeTimer = null; scheduleCanvasResize(); }, 80);
    };
  })());
  if (window.ResizeObserver) {
    const layoutObserver = new ResizeObserver(() => scheduleCanvasResize());
    ['game-container'].forEach(id => {
      const el = document.getElementById(id);
      if (el) layoutObserver.observe(el);
    });
  }
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hexToRgb(hexColor) {
    const hex = (hexColor || '#000000').replace('#', '');
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  function blendHex(baseColor, tintColor, amount) {
    const a = clamp(amount, 0, 1);
    const base = hexToRgb(baseColor);
    const tint = hexToRgb(tintColor);
    const r = Math.round(base.r + (tint.r - base.r) * a);
    const g = Math.round(base.g + (tint.g - base.g) * a);
    const b = Math.round(base.b + (tint.b - base.b) * a);
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }

  function alphaColor(color, alpha) {
    const rgb = hexToRgb(color);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
  }

  function getRoundPalette() {
    return BIOME_COLORS[roundBiome] || BIOME_COLORS.city;
  }

  function fillOutlinedRect(target, x, y, w, h, outline, fill) {
    if (w <= 0 || h <= 0) return;
    target.fillStyle = outline;
    target.fillRect(x - 1, y - 1, w + 2, h + 2);
    target.fillStyle = fill;
    target.fillRect(x, y, w, h);
  }

  function fillSpriteRect(target, x, y, w, h, colors, options) {
    if (w <= 0 || h <= 0) return;
    const opts = options || {};
    fillOutlinedRect(target, x, y, w, h, colors.outline, colors.fill);

    if (opts.highlight !== false && w >= 4 && h >= 4) {
      target.fillStyle = colors.highlight;
      target.fillRect(x + 1, y + 1, Math.max(1, Math.min(3, Math.floor(w * 0.25))), Math.max(1, h - 3));
      target.fillRect(x + 1, y + 1, Math.max(1, w - 3), 1);
    }
    if (opts.shadow !== false && w >= 4 && h >= 4) {
      target.fillStyle = colors.shadow;
      target.fillRect(x + w - 3, y + 1, 2, Math.max(1, h - 2));
      target.fillRect(x + 1, y + h - 2, Math.max(1, w - 2), 1);
    }
    if (opts.inner && w >= 6 && h >= 6) {
      target.fillStyle = opts.inner;
      target.fillRect(x + 3, y + 3, Math.max(1, w - 6), Math.max(1, h - 6));
    }
  }

  function getGorillaRamp(color = getDefaultPlayerColor(0)) {
    const fill = sanitizePlayerColor(color, getDefaultPlayerColor(0));
    // Only fur follows the player's picked color. Face, beard, palms, eyes,
    // and outlines are fixed across all players so the picked color reads
    // cleanly as jersey/fur and doesn't recolor skin and features.
    return {
      fill,
      highlight: blendHex(fill, '#FFFFFF', 0.30),
      shadow:    blendHex(fill, '#14041E', 0.50),
      detail:    blendHex(fill, '#FFFFFF', 0.22),
      glow:      blendHex(fill, '#FFB8FF', 0.18),
      outline:   '#1a1c22',
      muzzle:    '#dccca8',
      face:      '#c09070',
      hand:      '#b07858',
      foot:      '#1f1b18',
    };
  }

  // Compact Dome sprite: rounded dome head merging into the shoulders, tan
  // face insert with a cream beard/chin, pink palms at the arm ends.
  // All values are in logical pixels, relative to the gorilla's center (cy = hips).
  const GORILLA_SPRITE = Object.freeze({
    // Dome (head + back merged into one rounded silhouette)
    headW: 13,
    headH: 14,
    headY: -14,
    headShiftX: 0,
    // Shoulders (wider strip that flares above the body)
    shoulderW: 15,
    shoulderH: 3,
    // Body barrel
    bodyW: 10,
    bodyH: 9,
    bodyY: 0,
    // Face insert (tan skin, lower portion of dome)
    faceW: 9,
    faceH: 5,
    faceY: -9,
    // Beard / chin (cream, sits at dome bottom)
    beardW: 7,
    beardH: 3,
    beardY: -4,
    // Legs
    legW: 4,
    legH: 4,
    legY: 9,
    stance: 2,
    // Arms
    armW: 4,
    armH: 12,
    armX: 10,
    armY: 0,
    armLift: 8,
    // Jaw removed in this sprite, retained as zeros for compat with older refs.
    jawW: 0,
    jawH: 0,
  });

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

  function buildDefaultPlayerColors(count = MAX_PLAYER_SLOTS) {
    return Array.from({ length: count }, (_, idx) => getDefaultPlayerColor(idx));
  }

  function getPlayerColor(playerIdx) {
    return sanitizePlayerColor(playerColors[playerIdx], getDefaultPlayerColor(playerIdx));
  }

  // ─── Game State ─────────────────────────────────────────────────────────────
  let gameState = 'title';
  let previousState = null;
  let myPlayer = 0;
  let hostPlayer = 0;
  let clientRole = 'player';
  let pendingJoinRole = 'player';
  let mySpectatorId = null;
  let myName = 'Player';
  let myColor = getDefaultPlayerColor(0);
  let scores = buildDefaultScores();
  let playerNames = buildDefaultPlayerNames();
  let playerColors = buildDefaultPlayerColors();
  let playerTeams = buildDefaultPlayerTeams();
  let spectatorCount = 0;
  let spectatorNames = [];
  let maxSpectators = 8;
  let challengeQueue = [];
  let scoreMode = 'individual';
  let teamScores = null;
  let currentPlayer = 1;
  let wind = 0;
  // Hot seat: when the local turn changes mid-match, an overlay blocks input
  // until the new player presses READY (so the next player can't see the prior
  // angle/velocity entries).
  let hotseatPassPending = false;
  let hotseatLastShownPlayer = 0;

  // Settings (synced from server)
  let settings = {
    ...DEFAULT_SETTINGS,
    musicEnabled: true,
    sfxEnabled: true,
    spectatorChatMuted: false,
  };

  let serverPaused = false;
  let pausedByPlayer = 0;
  let pausedByName = '';

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
  let shotPending = false;
  let activeBananaType = 'standard';

  // Cluster bananas
  let clusterBananas = [];

  // Anti-banana turrets
  const TURRET_W = 16;
  const TURRET_H = 16;
  let turrets = [];              // {id, ownerIdx, x, y, cx, cy, aimAngle, barrelKick, expireTurn}
  let turretTracers = [];        // {x1,y1,x2,y2,life,maxLife}
  let turretCharges = [3, 3, 3, 3];

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
  let sunPersistentEmote = 'idle'; // anger level that persists until round ends
  let sunEmoteTimer = null;
  let sunWatchFrame = 0; // for eye tracking animation
  let sunSurprised = false; // kept for backward compat
  let sunSurpriseTimer = null;
  let sunWinking = false;
  let sunWinkTimer = null;
  let sunSwearText = '';
  let sunSwearVisible = false;
  let sunSwearTimer = null;
  let sunSwearStartTime = 0;
  let goldenGorillaActive = false;
  let goldenGorillaPos = null;
  let goldenGorillaThrowAnim = 0;
  let goldenGorillaThrowTimer = null;
  let goldenGorillaSpawnTime = 0;

  function setSunEmote(emote, duration) {
    // Anger emotes persist for the rest of the round — only escalate, never go back
    if (emote === 'annoyed' || emote === 'angry' || emote === 'furious') {
      const angerRank = { annoyed: 1, angry: 2, furious: 3 };
      const curRank = angerRank[sunPersistentEmote] || 0;
      if (angerRank[emote] > curRank) sunPersistentEmote = emote;
    }
    sunEmote = emote;
    if (sunEmoteTimer) clearTimeout(sunEmoteTimer);
    sunEmoteTimer = null;
    if (duration > 0) {
      sunEmoteTimer = setTimeout(() => {
        sunEmote = sunPersistentEmote;
        sunEmoteTimer = null;
      }, duration);
    }
    if (emote === 'attacking') {
      const chars = '@#$%!*&^~?';
      const len = 3 + Math.floor(Math.random() * 3);
      sunSwearText = Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      sunSwearVisible = true;
      sunSwearStartTime = performance.now();
      if (sunSwearTimer) clearTimeout(sunSwearTimer);
      sunSwearTimer = setTimeout(() => { sunSwearVisible = false; }, 1800);
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
  try {
    const storedRole = sessionStorage.getItem('mm_role');
    if (storedRole === 'spectator') clientRole = 'spectator';
  } catch(e) {}
  try {
    const storedHostPlayer = parseInt(sessionStorage.getItem('mm_host_player'), 10);
    hostPlayer = Number.isFinite(storedHostPlayer) ? storedHostPlayer : 0;
  } catch(e) {}
  try { myColor = sanitizePlayerColor(sessionStorage.getItem('mm_color'), myColor); } catch(e) {}
  playerColors[0] = myColor;

  // Auto-reconnect state
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let suppressReconnect = false;
  const MAX_RECONNECT_ATTEMPTS = 5; // 3s intervals ~= server's 15s reconnect window

  // Building collapse tracking
  let collapsedBuildings = new Set();
  const DEFAULT_LOCAL_AUDIO_VOLUME = 100;
  const PLAYER_NAME_INPUT_IDS = ['player-name', 'pause-player-name'];
  const MUSIC_TOGGLE_CONTROL_IDS = ['music-select', 'pause-music-select'];
  const SFX_TOGGLE_CONTROL_IDS = ['pause-sfx-select'];
  const SPECTATOR_CHAT_MUTE_IDS = ['spectator-chat-select', 'pause-spectator-chat-select'];
  const SHAKE_SELECT_IDS = ['shake-select', 'pause-shake-select'];
  const TRAIL_SELECT_IDS = ['trail-select', 'pause-trail-select'];
  const CRT_SELECT_IDS = ['crt-select', 'pause-crt-select'];
  const EFFECTS_QUALITY_CONTROL_IDS = ['effects-quality-select', 'pause-effects-quality-select'];
  const MUSIC_VOLUME_CONTROL_IDS = ['music-volume', 'pause-music-volume'];
  const MUSIC_VOLUME_READOUT_IDS = ['music-volume-readout', 'pause-music-volume-readout'];
  const SFX_VOLUME_CONTROL_IDS = ['sfx-volume', 'pause-sfx-volume'];
  const SFX_VOLUME_READOUT_IDS = ['sfx-volume-readout', 'pause-sfx-volume-readout'];

  function asIdList(controlIds) {
    return Array.isArray(controlIds) ? controlIds : [controlIds];
  }

  function getFirstControl(controlIds) {
    for (const id of asIdList(controlIds)) {
      const control = document.getElementById(id);
      if (control) return control;
    }
    return null;
  }

  function getControlValue(controlIds, fallback = '') {
    const control = getFirstControl(controlIds);
    if (!control) return fallback;
    return control.value;
  }

  function setControlValues(controlIds, value) {
    for (const id of asIdList(controlIds)) {
      const control = document.getElementById(id);
      if (control) control.value = String(value);
    }
  }

  function getPlayerNameInputValue() {
    return getControlValue(PLAYER_NAME_INPUT_IDS, myName || 'Player').trim().substring(0, 20) || 'Player';
  }

  function getVolumePercent(controlIds, fallback = DEFAULT_LOCAL_AUDIO_VOLUME) {
    const control = getFirstControl(controlIds);
    const parsed = parseInt(control ? control.value : fallback, 10);
    return clamp(Number.isFinite(parsed) ? parsed : fallback, 0, 100);
  }

  function setVolumeControl(controlIds, readoutIds, value) {
    const safeValue = clamp(parseInt(value, 10) || 0, 0, 100);
    for (const controlId of asIdList(controlIds)) {
      const control = document.getElementById(controlId);
      if (control) control.value = String(safeValue);
    }
    for (const readoutId of asIdList(readoutIds)) {
      const readout = document.getElementById(readoutId);
      if (readout) readout.textContent = `${safeValue}%`;
    }
  }

  function updateAudioVolumeControls() {
    setVolumeControl(MUSIC_VOLUME_CONTROL_IDS, MUSIC_VOLUME_READOUT_IDS, getVolumePercent(MUSIC_VOLUME_CONTROL_IDS));
    setVolumeControl(SFX_VOLUME_CONTROL_IDS, SFX_VOLUME_READOUT_IDS, getVolumePercent(SFX_VOLUME_CONTROL_IDS));
  }

  function getMusicVolumeScale() {
    return getVolumePercent(MUSIC_VOLUME_CONTROL_IDS) / 100;
  }

  function getSfxVolumeScale() {
    return isSfxEnabled() ? getVolumePercent(SFX_VOLUME_CONTROL_IDS) / 100 : 0;
  }

  // ─── localStorage persistence ──────────────────────────────────────────────
  function saveSettings() {
    try {
      const s = {};
      s.playerName = getPlayerNameInputValue();
      s.playerColor = sanitizePlayerColor(document.getElementById('player-color').value, myColor);
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
      s.shake = getControlValue(SHAKE_SELECT_IDS, 'normal');
      s.trail = getControlValue(TRAIL_SELECT_IDS, 'dotted');
      s.crt = getControlValue(CRT_SELECT_IDS, String(settings.crtOverlay));
      s.music = getControlValue(MUSIC_TOGGLE_CONTROL_IDS, 'true');
      s.sfxEnabled = getControlValue(SFX_TOGGLE_CONTROL_IDS, 'true');
      s.spectatorChatMuted = getControlValue(SPECTATOR_CHAT_MUTE_IDS, 'false');
      s.musicOrder = document.getElementById('music-order-select').value;
      s.musicVolume = getVolumePercent(MUSIC_VOLUME_CONTROL_IDS);
      s.sfxVolume = getVolumePercent(SFX_VOLUME_CONTROL_IDS);
      s.effectsQuality = getControlValue(EFFECTS_QUALITY_CONTROL_IDS, '2');
      localStorage.setItem('monkeyMaddnessSettings', JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem('monkeyMaddnessSettings');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.playerName) setControlValues(PLAYER_NAME_INPUT_IDS, s.playerName);
      if (s.playerColor) {
        myColor = sanitizePlayerColor(s.playerColor, myColor);
        document.getElementById('player-color').value = myColor;
      }
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
      if (s.shake) setControlValues(SHAKE_SELECT_IDS, s.shake);
      if (s.trail) setControlValues(TRAIL_SELECT_IDS, s.trail);
      if (s.crt) setControlValues(CRT_SELECT_IDS, s.crt);
      if (s.music) setControlValues(MUSIC_TOGGLE_CONTROL_IDS, s.music);
      if (s.sfxEnabled) setControlValues(SFX_TOGGLE_CONTROL_IDS, s.sfxEnabled);
      if (s.spectatorChatMuted) setControlValues(SPECTATOR_CHAT_MUTE_IDS, s.spectatorChatMuted);
      if (s.musicOrder) document.getElementById('music-order-select').value = s.musicOrder;
      if (s.musicVolume !== undefined) setVolumeControl(MUSIC_VOLUME_CONTROL_IDS, MUSIC_VOLUME_READOUT_IDS, s.musicVolume);
      if (s.sfxVolume !== undefined) setVolumeControl(SFX_VOLUME_CONTROL_IDS, SFX_VOLUME_READOUT_IDS, s.sfxVolume);
      if (s.effectsQuality) setControlValues(EFFECTS_QUALITY_CONTROL_IDS, s.effectsQuality);
    } catch (e) { /* ignore */ }
    updateAudioVolumeControls();
  }

  function updatePlayerColorControl() {
    const colorInput = document.getElementById('player-color');
    const readout = document.getElementById('player-color-readout');
    if (!colorInput) return;

    const slotIdx = myPlayer > 0 ? myPlayer - 1 : 0;
    const color = sanitizePlayerColor(colorInput.value, myColor || getDefaultPlayerColor(slotIdx));
    colorInput.value = color;
    colorInput.style.boxShadow = `0 0 0 2px ${alphaColor(color, 0.45)}, 0 0 14px ${alphaColor(color, 0.35)}`;
    if (readout) readout.textContent = color;
  }

  function persistSessionIdentity() {
    try {
      sessionStorage.setItem('mm_name', myName);
      sessionStorage.setItem('mm_color', myColor);
      sessionStorage.setItem('mm_host_player', String(hostPlayer || 0));
      sessionStorage.setItem('mm_role', clientRole);
    } catch (e) {}
  }

  function updateHostPlayer(nextHostPlayer) {
    const parsed = Math.max(0, Math.floor(Number(nextHostPlayer) || 0));
    hostPlayer = parsed;
    try {
      sessionStorage.setItem('mm_host_player', String(hostPlayer));
    } catch (e) {}
  }

  function syncHostPlayerFromMessage(msg) {
    if (msg && msg.hostPlayer !== undefined) updateHostPlayer(msg.hostPlayer);
  }

  function syncSpectatorsFromMessage(msg) {
    if (!msg) return;
    if (typeof msg.spectatorCount === 'number') spectatorCount = Math.max(0, msg.spectatorCount | 0);
    if (Array.isArray(msg.spectatorNames)) spectatorNames = msg.spectatorNames.slice();
    if (typeof msg.maxSpectators === 'number') maxSpectators = Math.max(0, msg.maxSpectators | 0);
    if (Array.isArray(msg.challengeQueue)) challengeQueue = msg.challengeQueue.slice();
    updateSpectatorUI();
  }

  function getSelectedPlayerColor() {
    const colorInput = document.getElementById('player-color');
    const slotIdx = myPlayer > 0 ? myPlayer - 1 : 0;
    return sanitizePlayerColor(colorInput ? colorInput.value : myColor, myColor || getDefaultPlayerColor(slotIdx));
  }

  function syncSetupSelectionsToState() {
    myName = getPlayerNameInputValue();
    myColor = getSelectedPlayerColor();
    playerColors[myPlayer > 0 ? myPlayer - 1 : 0] = myColor;
    updatePlayerColorControl();
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
    settings.shakeIntensity = getControlValue(SHAKE_SELECT_IDS, settings.shakeIntensity);
    settings.trailStyle = getControlValue(TRAIL_SELECT_IDS, settings.trailStyle);
    settings.crtOverlay = getControlValue(CRT_SELECT_IDS, String(settings.crtOverlay)) === 'true';
    settings.musicEnabled = isMusicEnabled();
    settings.sfxEnabled = isSfxEnabled();
    settings.spectatorChatMuted = getControlValue(SPECTATOR_CHAT_MUTE_IDS, 'false') === 'true';
    // Hot seat: capture the second local player's identity for the host to broadcast.
    const p2NameEl = document.getElementById('player2-name');
    const p2ColorEl = document.getElementById('player2-color');
    if (p2NameEl) {
      const trimmed = (p2NameEl.value || '').trim();
      settings.player2Name = trimmed.substring(0, 20) || 'Player 2';
    }
    if (p2ColorEl) {
      settings.player2Color = sanitizePlayerColor(p2ColorEl.value, settings.player2Color || getDefaultPlayerColor(1));
    }
  }

  function applyLocalVisualSettingsFromControls() {
    settings.shakeIntensity = getControlValue(SHAKE_SELECT_IDS, settings.shakeIntensity);
    settings.trailStyle = getControlValue(TRAIL_SELECT_IDS, settings.trailStyle);
    settings.crtOverlay = getControlValue(CRT_SELECT_IDS, String(settings.crtOverlay)) === 'true';
    applyCRTSetting();
    applyEffectsQualitySetting();
  }

  function sendPlayerProfile() {
    if (!Net.isConnected()) return;
    syncSetupSelectionsToState();
    Net.send({
      type: 'setProfile',
      name: myName,
      color: myColor,
    });
    persistSessionIdentity();
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
    const p2NameInput = document.getElementById('player2-name');
    if (p2NameInput) p2NameInput.value = 'Player 2';
    const p2ColorInput = document.getElementById('player2-color');
    if (p2ColorInput) p2ColorInput.value = '#FF8A4C';
    const p2ColorReadout = document.getElementById('player2-color-readout');
    if (p2ColorReadout) p2ColorReadout.textContent = '#FF8A4C';
    setControlValues(SHAKE_SELECT_IDS, 'normal');
    setControlValues(TRAIL_SELECT_IDS, 'dotted');
    setControlValues(CRT_SELECT_IDS, 'true');
    setControlValues(MUSIC_TOGGLE_CONTROL_IDS, 'true');
    setControlValues(SFX_TOGGLE_CONTROL_IDS, 'true');
    document.getElementById('music-order-select').value = 'forward';
    setControlValues(EFFECTS_QUALITY_CONTROL_IDS, '2');
    setVolumeControl(MUSIC_VOLUME_CONTROL_IDS, MUSIC_VOLUME_READOUT_IDS, DEFAULT_LOCAL_AUDIO_VOLUME);
    setVolumeControl(SFX_VOLUME_CONTROL_IDS, SFX_VOLUME_READOUT_IDS, DEFAULT_LOCAL_AUDIO_VOLUME);
    syncSetupSelectionsToState();
    applyCRTSetting();
    applyEffectsQualitySetting();
    applyMusicSetting();
    applySfxVolumeSetting();
    saveSettings();
  }

  // ─── Audio (Web Audio API) ─────────────────────────────────────────────────
  let audioCtx = null;
  let sfxMasterGain = null;
  const activeHtmlSfxInstances = new Set();
  const BG_MUSIC_BASE_VOLUME = 0.3;
  const VICTORY_MUSIC_BASE_VOLUME = 0.3;

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

  function getSfxDestination(ctx) {
    if (!sfxMasterGain) {
      sfxMasterGain = ctx.createGain();
      sfxMasterGain.gain.setValueAtTime(getSfxVolumeScale(), ctx.currentTime);
      sfxMasterGain.connect(ctx.destination);
    }
    return sfxMasterGain;
  }

  function updateTrackedHtmlSfxInstance(instance) {
    if (!instance) return;
    const baseVolume = Number.isFinite(instance._baseSfxVolume) ? instance._baseSfxVolume : 1;
    instance.volume = getScaledSfxVolume(baseVolume);
  }

  function registerHtmlSfxInstance(instance, baseVolume = 1) {
    if (!instance) return null;
    instance._baseSfxVolume = baseVolume;
    activeHtmlSfxInstances.add(instance);
    updateTrackedHtmlSfxInstance(instance);
    const cleanup = () => activeHtmlSfxInstances.delete(instance);
    instance.addEventListener('ended', cleanup, { once: true });
    instance.addEventListener('error', cleanup, { once: true });
    instance.addEventListener('abort', cleanup, { once: true });
    return instance;
  }

  function syncHtmlSfxVolumes() {
    activeHtmlSfxInstances.forEach(instance => {
      if (!instance || instance.ended) {
        activeHtmlSfxInstances.delete(instance);
        return;
      }
      updateTrackedHtmlSfxInstance(instance);
    });
  }

  function applySfxVolumeSetting() {
    settings.sfxEnabled = isSfxEnabled();
    syncHtmlSfxVolumes();
    if (!audioCtx) return;
    const master = getSfxDestination(audioCtx);
    const now = audioCtx.currentTime;
    const target = getSfxVolumeScale();
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(target, now + 0.05);
  }

  function getScaledSfxVolume(baseVolume = 1) {
    return clamp(baseVolume * getSfxVolumeScale(), 0, 1);
  }

  function getScaledMusicVolume(baseVolume = 1) {
    return clamp(baseVolume * getMusicVolumeScale(), 0, 1);
  }

  function createSfx(src, volume) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = volume;
    audio.onerror = () => console.warn(`[Audio] Failed to load SFX: ${src}`);
    return audio;
  }

  function playAudioClip(clip, volume = clip.volume) {
    try {
      const ctx = ensureAudio();
      // Limit concurrent instances to 4 per clip to prevent audio flooding
      clip._activeCount = (clip._activeCount || 0);
      if (clip._activeCount >= 4) return null;
      const instance = new Audio(clip.src);
      clip._activeCount++;
      const release = () => {
        activeHtmlSfxInstances.delete(instance);
        clip._activeCount = Math.max(0, (clip._activeCount || 1) - 1);
      };
      instance.onended = release;
      instance.onerror = release;
      instance.onabort = release;
      try {
        // Route through the WebAudio gain chain so sfxMasterGain (bound to the
        // SFX volume slider) controls this clip in real-time alongside all other
        // WebAudio sounds.  Each clip gets its own gain node for relative level.
        const srcNode = ctx.createMediaElementSource(instance);
        const clipGain = ctx.createGain();
        clipGain.gain.value = volume;
        srcNode.connect(clipGain).connect(getSfxDestination(ctx));
      } catch (e) {
        // createMediaElementSource not supported; fall back to HTML Audio volume.
        registerHtmlSfxInstance(instance, volume);
      }
      instance.play().catch(() => { release(); });
      return instance;
    } catch (e) {}
    return null;
  }

  const explosionSfx = createSfx('freesound_community-hq-explosion-6288.mp3', 0.42);
  const turretFireSfx = createSfx('freesound_community-clean-machine-gun-burst-98224.mp3', 0.5);
  const turretLockSfx = createSfx('freesound_community-beep-warning-6387.mp3', 0.48);
  const panicSfx = createSfx('u_cs6o615ob2-mono-505080.mp3', 0.54);
  const gaspSfx = createSfx('freesound_community-gasp-6253.mp3', 0.7);

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
      osc.connect(gain).connect(getSfxDestination(ctx));
      osc.start(t); osc.stop(t + 0.12);
      // Noise burst layer for impact
      const bufSize = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const nSrc = ctx.createBufferSource(); nSrc.buffer = buf;
      const nGain = ctx.createGain(); nGain.gain.setValueAtTime(0.1, t);
      nGain.gain.linearRampToValueAtTime(0, t + 0.05);
      nSrc.connect(nGain).connect(getSfxDestination(ctx));
      nSrc.start(t);
    } catch (e) {}
  }

  function playTurretBurst() {
    playAudioClip(turretFireSfx);
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
      osc.connect(g).connect(getSfxDestination(ctx));
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
      src.connect(filter).connect(ng).connect(getSfxDestination(ctx));
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
      osc.connect(g).connect(getSfxDestination(ctx));
      osc.start(t); osc.stop(t + 0.4);
    } catch (e) {}
  }

  function playExplosionSound() {
    playAudioClip(explosionSfx);
  }

  function playTurretLockSound() {
    playAudioClip(turretLockSfx);
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
    osc.connect(gain).connect(getSfxDestination(ctx));
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
        osc.connect(g).connect(getSfxDestination(ctx));
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
      osc.connect(gain).connect(getSfxDestination(ctx));
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
      osc.connect(gain).connect(getSfxDestination(ctx));
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
    osc.connect(gain).connect(getSfxDestination(ctx));
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
    noise.connect(noiseFilter).connect(noiseGain).connect(getSfxDestination(ctx));
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
  const TITLE_MUSIC_TRACK = 'reganati-fruity-dx10-synth-ringtone-411349.mp3';
  const TITLE_MUSIC_INDEX = BG_PLAYLIST.indexOf(TITLE_MUSIC_TRACK);
  let bgTrackIndex = 0;
  let bgAudio = null;

  const victoryMusic = new Audio('Victory%20Screen.mp3');
  victoryMusic.loop = false;
  victoryMusic.volume = getScaledMusicVolume(VICTORY_MUSIC_BASE_VOLUME);
  victoryMusic.onerror = () => console.warn('[Audio] Failed to load: Victory Screen.mp3');

  function applyMusicVolumeSetting() {
    if (bgAudio) bgAudio.volume = getScaledMusicVolume(BG_MUSIC_BASE_VOLUME);
    victoryMusic.volume = getScaledMusicVolume(VICTORY_MUSIC_BASE_VOLUME);
  }

  function isMusicEnabled() {
    return getControlValue(MUSIC_TOGGLE_CONTROL_IDS, 'true') !== 'false';
  }

  function isSfxEnabled() {
    return getControlValue(SFX_TOGGLE_CONTROL_IDS, 'true') !== 'false';
  }

  function applyEffectsQualitySetting() {
    const quality = parseInt(getControlValue(EFFECTS_QUALITY_CONTROL_IDS, '2'), 10);
    const safeQuality = Number.isFinite(quality) ? quality : 2;
    Lighting.setQuality(safeQuality);
    Particles.setQuality(safeQuality);
    Background.setQuality(safeQuality);
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────
  function appendChatMessage(name, text, playerIdx, role = 'player') {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = role === 'spectator' ? 'chat-msg chat-msg-spectator' : 'chat-msg';
    if (name) {
      const nameSpan = document.createElement('span');
      const chatClass = role === 'spectator' ? 'spectator' : (playerIdx >= 0 && playerIdx < 4 ? `p${playerIdx + 1}` : 'system');
      nameSpan.className = 'chat-msg-name ' + chatClass;
      nameSpan.textContent = (role === 'spectator' ? `[SPEC] ${name}` : name) + ': ';
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
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.focus();
  }

  function closeChatInput() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.blur();
  }

  function blurFocusedInput() {
    const activeEl = document.activeElement;
    if (activeEl && activeEl.tagName === 'INPUT' && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }
  }

  function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    input.value = '';
    closeChatInput();
    if (!text) return;
    // Server broadcasts back to everyone including us, so no optimistic display needed
    Net.send({ type: 'chat', text });
  }

  function enableClickClearOnNumericInput(input, fallbackGetter) {
    if (!input) return;

    input.addEventListener('pointerdown', () => {
      if (input.disabled) return;
      input.dataset.clearOnFocus = 'true';
      input.dataset.restoreValue = input.value;
    });

    input.addEventListener('focus', () => {
      if (input.dataset.clearOnFocus !== 'true') return;
      input.dataset.clearOnFocus = 'false';
      input.value = '';
    });

    input.addEventListener('blur', () => {
      input.dataset.clearOnFocus = 'false';
      if (input.value.trim() !== '') return;
      const fallback = String(fallbackGetter());
      input.value = fallback;
      input.dataset.restoreValue = fallback;
    });
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

  function applyCRTSetting() {
    const overlay = document.getElementById('crt-overlay');
    const container = document.getElementById('game-container');
    if (overlay) overlay.style.display = settings.crtOverlay ? 'block' : 'none';
    if (container) container.classList.toggle('crt-active', !!settings.crtOverlay);
  }

  function applyMusicSetting() {
    settings.musicEnabled = isMusicEnabled();
    applyMusicVolumeSetting();
    if (!settings.musicEnabled) {
      stopBGMusic();
      stopVictoryMusic();
      updateMusicHUD();
      return;
    }
    if (gameState === 'playing') {
      startBGMusic();
    } else if (gameState === 'title' || gameState === 'setup' || gameState === 'waiting') {
      startTitleMusic();
    } else if (gameState === 'matchOver') {
      startVictoryMusic();
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
    bgAudio.volume = getScaledMusicVolume(BG_MUSIC_BASE_VOLUME);
    bgAudio.onended = () => { if (isMusicEnabled()) playBGTrack(nextBGIndex(bgTrackIndex)); };
    bgAudio.onerror = () => {
      console.warn(`[Audio] Failed to load track: ${BG_PLAYLIST[bgTrackIndex]}`);
      if (isMusicEnabled()) playBGTrack(nextBGIndex(bgTrackIndex));
    };
    bgAudio.play().catch(() => {});
  }

  function startTitleMusic() {
    if (!isMusicEnabled() || TITLE_MUSIC_INDEX < 0) return;
    if (bgAudio && !bgAudio.paused && bgTrackIndex === TITLE_MUSIC_INDEX) return;
    playBGTrack(TITLE_MUSIC_INDEX);
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
    applyMusicVolumeSetting();
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
      osc.connect(gain).connect(getSfxDestination(ctx));
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
      src.connect(filt).connect(gain).connect(getSfxDestination(ctx));
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
      osc.connect(gain).connect(getSfxDestination(ctx));
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
      osc.connect(gain).connect(getSfxDestination(ctx));
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
      osc.connect(g).connect(getSfxDestination(ctx)); osc.start(t); osc.stop(t + 0.2);
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
    osc.connect(gain).connect(getSfxDestination(ctx));
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
    master.connect(getSfxDestination(actx));
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
    Background.renderSky(ctx, roundTimeOfDay, roundBiome);

    // Extra star sparkle for pure night rounds so the foreground sky still breathes.
    if (stars.length > 0 && roundTimeOfDay === 'night') {
      const t = performance.now() / 1000;
      for (const s of stars) {
        const flicker = 0.3 + 0.7 * Math.sin(t * s.twinkleSpeed + s.phase);
        const alpha = s.brightness * flicker * 0.35;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
        ctx.fillRect(Math.floor(s.x), Math.floor(s.y), 1, 1);
      }
    }
  }

  // Use the actual terrain alpha as the backdrop mask so carved holes reveal
  // the backdrop while intact facade pixels still hide it.
  function maskBackdropWithTerrain(target) {
    target.save();
    target.globalCompositeOperation = 'destination-out';
    target.drawImage(terrainCanvas, 0, 0);
    target.restore();
  }

  function drawMaskedBackdrop() {
    backdropCtx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    Background.renderBackground(backdropCtx);
    Background.renderEvents(backdropCtx);
    Particles.renderBehind(backdropCtx);
    maskBackdropWithTerrain(backdropCtx);
    ctx.drawImage(backdropCanvas, 0, 0);
  }

  function drawSun() {
    if (goldenGorillaActive) return;
    const palette = getRoundPalette();
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
      ctx.fillStyle = alphaColor(palette.haze, 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.sun;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = alphaColor(palette.highlight, 0.28);
      ctx.fillRect(cx - 10, cy - 10, 6, 3);
      ctx.fillRect(cx - 7, cy - 6, 3, 2);
      ctx.restore();
      // Crescent shadow
      ctx.fillStyle = palette.stageNear;
      ctx.beginPath();
      ctx.arc(cx + 8, cy - 2, r - 2, 0, Math.PI * 2);
      ctx.fill();
      // Moon face on the lit portion
      drawCelestialFace(cx - 5, cy, sunEmote, true);
      drawSunSwearBubble(cx - 5, cy);
      return;
    }

    const cy = SUN_Y;
    const sunColor = palette.sun || SUN_COLOR;

    ctx.fillStyle = alphaColor(palette.haze, 0.12);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sunColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = alphaColor('#FFFFFF', 0.35);
    ctx.fillRect(cx - 7, cy - 10, 5, 3);
    ctx.fillRect(cx - 10, cy - 7, 2, 3);
    ctx.restore();

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
      fillOutlinedRect(ctx, Math.floor((x1 + x2) / 2) - 1, Math.floor((y1 + y2) / 2) - 1, 3, 3, palette.outline, palette.accent);
    }

    // Face
    drawCelestialFace(cx, cy, sunEmote, false);
    drawSunSwearBubble(cx, cy);
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

      case 'annoyed': {
        // One raised eyebrow, slight frown
        ctx.fillRect(cx - 6, cy - 8, 5, 1);         // left brow normal
        ctx.fillRect(cx + 1, cy - 9, 5, 1);          // right brow raised
        ctx.fillRect(cx - 4, cy - 5, 3, 3);          // left eye
        ctx.fillRect(cx + 2, cy - 5, 3, 3);          // right eye
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 5);
        ctx.lineTo(cx + 3, cy + 4);
        ctx.stroke();
        break;
      }

      case 'angry': {
        // V-shaped angry brows, scowl, whites-of-eyes showing
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy - 9); ctx.lineTo(cx - 2, cy - 7); // left brow angled in
        ctx.moveTo(cx + 6, cy - 9); ctx.lineTo(cx + 2, cy - 7); // right brow angled in
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - 5, cy - 5, 4, 3);
        ctx.fillRect(cx + 1, cy - 5, 4, 3);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - 4, cy - 4, 2, 2);
        ctx.fillRect(cx + 2, cy - 4, 2, 2);
        // Downturned mouth
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 5);
        ctx.lineTo(cx - 1, cy + 3);
        ctx.lineTo(cx + 1, cy + 3);
        ctx.lineTo(cx + 3, cy + 5);
        ctx.stroke();
        break;
      }

      case 'furious': {
        // Severe furrowed brows, gritted teeth, red tint
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy - 10); ctx.lineTo(cx - 1, cy - 7);
        ctx.moveTo(cx + 7, cy - 10); ctx.lineTo(cx + 1, cy - 7);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = '#FF3300';
        ctx.fillRect(cx - 5, cy - 6, 4, 4);
        ctx.fillRect(cx + 1, cy - 6, 4, 4);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - 4, cy - 5, 2, 3);
        ctx.fillRect(cx + 2, cy - 5, 2, 3);
        // Gritted teeth
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - 4, cy + 3, 8, 3);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - 3, cy + 3, 1, 3);
        ctx.fillRect(cx - 1, cy + 3, 1, 3);
        ctx.fillRect(cx + 1, cy + 3, 1, 3);
        ctx.fillRect(cx + 3, cy + 3, 1, 3);
        break;
      }

      case 'attacking': {
        // Determined, glaring — brows pressed down hard, tight grimace
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy - 8); ctx.lineTo(cx - 2, cy - 6);
        ctx.moveTo(cx + 6, cy - 8); ctx.lineTo(cx + 2, cy - 6);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = '#FF6600';
        ctx.fillRect(cx - 5, cy - 5, 4, 4);
        ctx.fillRect(cx + 1, cy - 5, 4, 4);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - 4, cy - 4, 2, 2);
        ctx.fillRect(cx + 2, cy - 4, 2, 2);
        // Tight set mouth
        ctx.fillRect(cx - 3, cy + 3, 6, 2);
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

  function drawSunSwearBubble(cx, cy) {
    if (!sunSwearVisible || !sunSwearText) return;
    const elapsed = performance.now() - sunSwearStartTime;
    const fadeDur = 300;
    const totalDur = 1800;
    let alpha = 1;
    if (elapsed < fadeDur) alpha = elapsed / fadeDur;
    else if (elapsed > totalDur - fadeDur) alpha = Math.max(0, (totalDur - elapsed) / fadeDur);

    const pad = 4;
    ctx.font = 'bold 9px monospace';
    const tw = ctx.measureText(sunSwearText).width;
    const bw = tw + pad * 2;
    const bh = 13;
    const bx = cx - bw / 2;
    const by = cy - 34 - bh;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Bubble body
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 3);
    ctx.fill();
    ctx.stroke();

    // Tail (small triangle pointing down toward sun face)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(cx - 3, by + bh);
    ctx.lineTo(cx + 3, by + bh);
    ctx.lineTo(cx, by + bh + 5);
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 3, by + bh);
    ctx.lineTo(cx, by + bh + 5);
    ctx.lineTo(cx + 3, by + bh);
    ctx.stroke();

    // Symbols — each one a different angry color
    const colors = ['#CC0000', '#FF6600', '#9900CC', '#0000CC', '#006600'];
    const chars = sunSwearText.split('');
    const charW = tw / chars.length;
    ctx.font = 'bold 9px monospace';
    chars.forEach((ch, i) => {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillText(ch, bx + pad + i * charW, by + bh - 3);
    });

    ctx.restore();
  }

  const GOLDEN_GORILLA_RAMP = {
    fill:      '#FFEE00',
    highlight: '#FFFF99',
    shadow:    '#AA7700',
    detail:    '#FFFF55',
    glow:      '#FFDD00',
    outline:   '#664400',
    muzzle:    '#FFD044',
    face:      '#FFAA22',
    hand:      '#CC8800',
    foot:      '#553300',
  };

  function drawGoldenGorilla() {
    if (!goldenGorillaActive || !goldenGorillaPos) return;
    const { x, y } = goldenGorillaPos;
    const cx = x + GORILLA_W / 2;
    const cy = y + GORILLA_H / 2;
    const now = performance.now();
    const elapsed = now - goldenGorillaSpawnTime;

    // Pulsing neon glow behind
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    ctx.save();
    ctx.globalAlpha = 0.28 + pulse * 0.22;
    ctx.fillStyle = '#FFEE00';
    ctx.beginPath();
    ctx.arc(cx, cy - 4, 22 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Gorilla sprite in neon yellow
    const side = goldenGorillaThrowAnim === 2 ? 1 : (goldenGorillaThrowAnim === 1 ? -1 : -1);
    drawGorillaSprite(ctx, cx, cy, goldenGorillaThrowAnim, 'normal', false, GOLDEN_GORILLA_RAMP, side);

    // "GOLDEN GORILLA" label fades in
    const labelAlpha = Math.min(1, elapsed / 500);
    ctx.save();
    ctx.globalAlpha = labelAlpha;
    ctx.textAlign = 'center';
    ctx.font = 'bold 7px monospace';
    ctx.fillStyle = '#664400';
    ctx.fillText('GOLDEN GORILLA', cx + 1, y - 7);
    ctx.fillStyle = '#FFEE00';
    ctx.fillText('GOLDEN GORILLA', cx, y - 8);
    ctx.restore();

    // Swear bubble above the label when throwing
    drawSunSwearBubble(cx, y - 18);
  }

  function drawBuildings() {
    ctx.drawImage(terrainCanvas, 0, 0);
    drawTwinkles();
  }

  function initTwinkles() {
    twinkleWindows = [];
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
              visible: true,
            });
          }
        }
      }
    }
    refreshTwinkleVisibility();
  }

  function refreshTwinkleVisibility() {
    for (const tw of twinkleWindows) {
      const sampleX = Math.max(0, Math.min(LOGICAL_W - 1, Math.floor(tw.x + tw.w / 2)));
      const sampleY = Math.max(0, Math.min(LOGICAL_H - 1, Math.floor(tw.y + tw.h / 2)));
      tw.visible = terrainCtx.getImageData(sampleX, sampleY, 1, 1).data[3] !== 0;
    }
  }

  function drawTwinkles() {
    const now = performance.now() / 1000;
    for (const tw of twinkleWindows) {
      if (!tw.visible) continue;
      const glow = 0.3 + 0.7 * ((Math.sin(now * tw.speed + tw.phase) + 1) / 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${(glow * 0.45).toFixed(2)})`;
      ctx.fillRect(tw.x, tw.y, tw.w, tw.h);
    }
  }

  function buildTerrainCanvas() {
    terrainCtx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    const biomePalette = getRoundPalette();

    for (let bi = 0; bi < buildings.length; bi++) {
      if (collapsedBuildings.has(bi)) continue;
      const b = buildings[bi];
      terrainCtx.fillStyle = b.color;
      terrainCtx.fillRect(b.x, b.y, b.w, LOGICAL_H - b.y);
      terrainCtx.fillStyle = biomePalette.outline;
      terrainCtx.fillRect(b.x, b.y, b.w, 1);
      terrainCtx.fillRect(b.x, b.y, 1, LOGICAL_H - b.y);
      terrainCtx.fillRect(b.x + b.w - 1, b.y, 1, LOGICAL_H - b.y);
      terrainCtx.fillStyle = biomePalette.shadow;
      terrainCtx.fillRect(b.x + Math.max(2, Math.floor(b.w * 0.65)), b.y + 1, Math.max(1, Math.ceil(b.w * 0.35) - 1), Math.max(1, LOGICAL_H - b.y - 1));
      terrainCtx.fillStyle = biomePalette.highlight;
      terrainCtx.fillRect(b.x + 1, b.y + 1, Math.max(1, Math.min(4, Math.floor(b.w * 0.12))), Math.max(1, LOGICAL_H - b.y - 3));
      terrainCtx.fillRect(b.x + 1, b.y + 1, Math.max(2, b.w - 2), 2);
      terrainCtx.fillStyle = biomePalette.roof;
      terrainCtx.fillRect(b.x + 1, b.y + 3, Math.max(1, b.w - 2), 2);
      terrainCtx.fillStyle = alphaColor(biomePalette.accent, 0.18);
      for (let stripeY = b.y + 12; stripeY < LOGICAL_H - 8; stripeY += 22) {
        terrainCtx.fillRect(b.x + 3, stripeY, Math.max(1, b.w - 6), 1);
      }

      const rng = mulberry32(citySeed + b.x * 1000 + b.y);
      const winW = 3;
      const winH = 3;
      const gap = 3;
      const padX = 4;
      const padY = 7;
      for (let wy = b.y + padY; wy < LOGICAL_H - winH - gap; wy += winH + gap) {
        for (let wx = b.x + padX; wx < b.x + b.w - winW - padX; wx += winW + gap) {
          const lit = rng() > 0.38;
          fillOutlinedRect(
            terrainCtx,
            wx,
            wy,
            winW,
            winH,
            biomePalette.outline,
            lit ? biomePalette.windowLit : biomePalette.windowUnlit
          );
          if (lit) {
            terrainCtx.fillStyle = alphaColor('#FFFFFF', 0.35);
            terrainCtx.fillRect(wx, wy, 1, 1);
          }
        }
      }
    }

    for (const exp of carvedExplosions) {
      applyExplosionDamage(exp.x, exp.y, exp.radius);
    }
    refreshTwinkleVisibility();
  }

  function applyExplosionDamage(x, y, radius) {
    carveExplosion(x, y, radius);
    refreshTwinkleVisibility();
  }

  function carveExplosion(x, y, radius) {
    terrainCtx.save();
    terrainCtx.globalCompositeOperation = 'destination-out';
    terrainCtx.fillStyle = '#000000'; // fully opaque — destination-out uses source alpha to determine erasure amount
    terrainCtx.beginPath();
    terrainCtx.arc(x, y, radius, 0, Math.PI * 2);
    terrainCtx.fill();
    terrainCtx.restore();
  }

  function stampExplosionScar(x, y, radius) {
    const seed = (
      citySeed ^
      ((Math.round(x) * 73856093) >>> 0) ^
      ((Math.round(y) * 19349663) >>> 0) ^
      ((Math.round(radius) * 83492791) >>> 0)
    ) >>> 0;
    const rng = mulberry32(seed);
    const palette = getRoundPalette();
    const ringRadius = Math.max(2, radius - 2);
    const chunkCount = Math.max(16, Math.round(radius * 2.1));
    const rimDark = alphaColor('#050201', 0.72);
    const rimMid = alphaColor(blendHex(palette.outline, '#231109', 0.4), 0.56);
    const rimLight = alphaColor(blendHex(palette.accent, '#FFF4D8', 0.58), 0.4);
    const crackColor = alphaColor(blendHex(palette.highlight, '#FFFFFF', 0.35), 0.32);

    // Add a few extra cut-outs around the blast so the facade loss reads as a
    // broken chunk even on biomes where the sky and building colors are close.
    terrainCtx.save();
    terrainCtx.globalCompositeOperation = 'destination-out';
    const chipCount = Math.max(8, Math.round(radius * 0.55));
    for (let i = 0; i < chipCount; i++) {
      const angle = (i / chipCount) * Math.PI * 2 + (rng() - 0.5) * 0.35;
      const dist = ringRadius - 1 + (rng() - 0.5) * Math.max(3, radius * 0.12);
      const size = 2 + Math.floor(rng() * 4);
      const px = Math.round(x + Math.cos(angle) * dist);
      const py = Math.round(y + Math.sin(angle) * dist);
      terrainCtx.fillRect(
        px - Math.floor(size / 2),
        py - Math.floor(size / 2),
        size,
        size
      );
    }
    terrainCtx.restore();

    terrainCtx.save();
    terrainCtx.globalCompositeOperation = 'source-atop';
    terrainCtx.fillStyle = rimDark;

    for (let i = 0; i < chunkCount; i++) {
      const angle = (i / chunkCount) * Math.PI * 2;
      const wobble = (rng() - 0.5) * Math.max(3, radius * 0.28);
      const px = Math.round(x + Math.cos(angle) * (ringRadius + wobble));
      const py = Math.round(y + Math.sin(angle) * (ringRadius + wobble));
      const size = 2 + Math.floor(rng() * 4);
      terrainCtx.fillRect(
        px - Math.floor(size / 2),
        py - Math.floor(size / 2),
        size,
        size
      );
    }

    terrainCtx.fillStyle = rimMid;
    const sootCount = Math.max(8, Math.round(radius * 0.9));
    for (let i = 0; i < sootCount; i++) {
      const angle = (i / sootCount) * Math.PI * 2 + (rng() - 0.5) * 0.28;
      const dist = ringRadius + 1 + (rng() - 0.5) * Math.max(2, radius * 0.18);
      const width = 2 + Math.floor(rng() * 3);
      const height = 1 + Math.floor(rng() * 2);
      const px = Math.round(x + Math.cos(angle) * dist);
      const py = Math.round(y + Math.sin(angle) * dist);
      terrainCtx.fillRect(px - Math.floor(width / 2), py - Math.floor(height / 2), width, height);
    }

    terrainCtx.fillStyle = rimLight;
    const highlightCount = Math.max(6, Math.round(radius * 0.36));
    for (let i = 0; i < highlightCount; i++) {
      const t = highlightCount === 1 ? 0.5 : i / (highlightCount - 1);
      const angle = -Math.PI * 1.02 + t * Math.PI * 0.8 + (rng() - 0.5) * 0.22;
      const px = Math.round(x + Math.cos(angle) * Math.max(1, radius - 3));
      const py = Math.round(y + Math.sin(angle) * Math.max(1, radius - 3));
      const width = 2 + Math.floor(rng() * 3);
      const height = 1 + Math.floor(rng() * 2);
      terrainCtx.fillRect(px, py, width, height);
    }

    terrainCtx.fillStyle = crackColor;
    const crackCount = Math.max(3, Math.round(radius * 0.14));
    for (let i = 0; i < crackCount; i++) {
      const angle = rng() * Math.PI * 2;
      const startDist = radius + 1 + rng() * 2;
      const crackLen = 4 + Math.floor(rng() * Math.max(3, radius * 0.18));
      const sx = Math.round(x + Math.cos(angle) * startDist);
      const sy = Math.round(y + Math.sin(angle) * startDist);
      const dx = Math.round(Math.cos(angle) * crackLen);
      const dy = Math.round(Math.sin(angle) * crackLen);
      const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
      for (let step = 0; step <= steps; step++) {
        const px = Math.round(sx + (dx * step) / steps + (rng() - 0.5) * 1.2);
        const py = Math.round(sy + (dy * step) / steps + (rng() - 0.5) * 1.2);
        terrainCtx.fillRect(px, py, 1 + (step % 3 === 0 ? 1 : 0), 1);
      }
    }

    terrainCtx.restore();
  }

  // ─── Gorilla sprite ────────────────────────────────────────────────────────

  // ─── Dancing monkey overlay (match-over screen) ────────────────────────────
  let _danceAnimId = null;

  function drawGorillaGlow(target, cx, cy, ramp) {
    // Outer soft halo, roughly tracing the dome + body + arm silhouette.
    target.fillStyle = alphaColor(ramp.glow, 0.11);
    target.fillRect(cx - 9,  cy - 16, 18, 3);
    target.fillRect(cx - 12, cy - 13, 24, 14);
    target.fillRect(cx - 14, cy - 1,   4, 14);
    target.fillRect(cx + 10, cy - 1,   4, 14);
    target.fillRect(cx - 11, cy + 12, 22, 4);

    // Tighter inner glow for a stepped pixel halo.
    target.fillStyle = alphaColor(ramp.glow, 0.20);
    target.fillRect(cx - 7,  cy - 15, 14, 2);
    target.fillRect(cx - 10, cy - 12, 20, 13);
    target.fillRect(cx - 12, cy,       3, 11);
    target.fillRect(cx + 10, cy,       3, 11);
    target.fillRect(cx - 9,  cy + 11, 18, 3);
  }

  function drawGorillaBody(target, cx, cy, ramp) {
    const s = GORILLA_SPRITE;
    const domeW = s.headW;
    const domeTop = cy + s.headY;

    // --- Dome: narrow top arc widening to full dome width ---
    target.fillStyle = ramp.fill;
    target.fillRect(cx - 4,                  domeTop,      8,     1);       // row 0 peak
    target.fillRect(cx - 6,                  domeTop + 1, 12,     1);       // row 1 widen
    for (let r = 2; r <= 13; r++) {
      target.fillRect(cx - Math.floor(domeW / 2), domeTop + r, domeW, 1);
    }

    // Subtle fur highlight on the upper-right dome
    target.fillStyle = ramp.detail;
    target.fillRect(cx + 2, domeTop + 1, 3, 1);
    target.fillRect(cx + 2, domeTop + 2, 4, 2);

    // --- Shoulders (wider strip drawn on top of body barrel) ---
    target.fillStyle = ramp.fill;
    target.fillRect(cx - Math.floor(s.bodyW / 2),     cy + s.bodyY, s.bodyW,     s.bodyH);
    target.fillRect(cx - Math.floor(s.shoulderW / 2), cy + s.bodyY, s.shoulderW, s.shoulderH);

    // --- Face insert (tan skin, sits in the lower dome) ---
    target.fillStyle = ramp.face;
    target.fillRect(cx - Math.floor(s.faceW / 2), cy + s.faceY, s.faceW, s.faceH);

    // --- Beard / chin (cream, directly below face insert) ---
    target.fillStyle = ramp.muzzle;
    target.fillRect(cx - Math.floor(s.beardW / 2), cy + s.beardY, s.beardW, s.beardH);

    // --- Ears (tiny dome-side bumps) ---
    target.fillStyle = ramp.fill;
    target.fillRect(cx - Math.floor(domeW / 2) - 1, domeTop + 5, 1, 2);
    target.fillRect(cx + Math.floor(domeW / 2),     domeTop + 5, 1, 2);

    // --- Legs ---
    const leftLegX = cx - s.stance - s.legW;
    const rightLegX = cx + s.stance;
    target.fillStyle = ramp.fill;
    target.fillRect(leftLegX,  cy + s.legY, s.legW, s.legH);
    target.fillRect(rightLegX, cy + s.legY, s.legW, s.legH);
    target.fillStyle = ramp.foot;
    target.fillRect(leftLegX - 1,  cy + s.legY + s.legH - 2, s.legW + 2, 2);
    target.fillRect(rightLegX - 1, cy + s.legY + s.legH - 2, s.legW + 2, 2);
  }

  function drawGorillaFace(target, cx, cy, kind, ramp = getGorillaRamp()) {
    const faceCx = cx + GORILLA_SPRITE.headShiftX;
    const faceCy = cy + 2;

    // Brow ridge above the eyes (part of the face insert).
    // The legacy "muzzle patch" is dropped — drawGorillaBody now paints a full
    // cream beard across the chin, so a second light patch would read as dirt.
    target.fillStyle = ramp.outline;
    target.fillRect(faceCx - 4, faceCy - 10, 3, 1);
    target.fillRect(faceCx + 1, faceCy - 10, 3, 1);

    switch (kind) {
      case 'panic':
        target.fillRect(faceCx - 4, faceCy - 10, 4, 3);
        target.fillRect(faceCx + 1, faceCy - 10, 4, 3);
        target.fillRect(faceCx - 3, faceCy - 6, 6, 3);
        break;
      case 'flinch':
        target.fillRect(faceCx - 4, faceCy - 8, 3, 1);
        target.fillRect(faceCx + 1, faceCy - 8, 3, 1);
        target.fillRect(faceCx - 2, faceCy - 6, 4, 2);
        break;
      case 'h':
        target.fillRect(faceCx - 3, faceCy - 9, 2, 2);
        target.fillRect(faceCx + 1, faceCy - 9, 2, 2);
        target.fillRect(faceCx - 3, faceCy - 5, 6, 1);
        target.fillRect(faceCx - 4, faceCy - 6, 1, 1);
        target.fillRect(faceCx + 3, faceCy - 6, 1, 1);
        break;
      case 'a':
        target.fillRect(faceCx - 4, faceCy - 10, 3, 1);
        target.fillRect(faceCx + 2, faceCy - 10, 3, 1);
        target.fillRect(faceCx - 3, faceCy - 9, 2, 2);
        target.fillRect(faceCx + 1, faceCy - 9, 2, 2);
        target.fillRect(faceCx - 3, faceCy - 5, 6, 2);
        target.fillRect(faceCx - 2, faceCy - 6, 1, 1);
        target.fillRect(faceCx + 2, faceCy - 6, 1, 1);
        break;
      case 't':
        target.fillRect(faceCx - 3, faceCy - 9, 2, 2);
        target.fillRect(faceCx + 1, faceCy - 9, 2, 2);
        target.fillRect(faceCx - 2, faceCy - 6, 4, 2);
        target.fillStyle = '#FF5588';
        target.fillRect(faceCx - 1, faceCy - 4, 3, 2);
        break;
      case 'w':
        target.strokeStyle = ramp.outline;
        target.lineWidth = 1;
        target.beginPath();
        target.arc(faceCx - 3, faceCy - 9, 2, 0, Math.PI * 2);
        target.stroke();
        target.beginPath();
        target.arc(faceCx + 3, faceCy - 9, 2, 0, Math.PI * 2);
        target.stroke();
        target.fillStyle = ramp.outline;
        target.fillRect(faceCx - 2, faceCy - 5, 4, 1);
        break;
      case 's':
        target.fillRect(faceCx - 3, faceCy - 10, 3, 1);
        target.fillRect(faceCx - 3, faceCy - 9, 2, 1);
        target.fillRect(faceCx + 1, faceCy - 9, 2, 2);
        target.fillRect(faceCx - 2, faceCy - 5, 4, 1);
        target.fillRect(faceCx + 2, faceCy - 6, 1, 1);
        break;
      case 'x':
        target.fillRect(faceCx - 4, faceCy - 10, 1, 1); target.fillRect(faceCx - 3, faceCy - 9, 1, 1);
        target.fillRect(faceCx - 2, faceCy - 8, 1, 1); target.fillRect(faceCx - 4, faceCy - 8, 1, 1);
        target.fillRect(faceCx - 2, faceCy - 10, 1, 1);
        target.fillRect(faceCx + 2, faceCy - 10, 1, 1); target.fillRect(faceCx + 3, faceCy - 9, 1, 1);
        target.fillRect(faceCx + 4, faceCy - 8, 1, 1); target.fillRect(faceCx + 2, faceCy - 8, 1, 1);
        target.fillRect(faceCx + 4, faceCy - 10, 1, 1);
        target.fillRect(faceCx - 1, faceCy - 5, 2, 1);
        break;
      case 'c':
        target.fillRect(faceCx - 3, faceCy - 9, 2, 2);
        target.fillRect(faceCx + 1, faceCy - 9, 2, 2);
        target.fillRect(faceCx - 3, faceCy - 5, 6, 2);
        target.fillRect(faceCx - 2, faceCy - 4, 1, 1);
        target.fillRect(faceCx + 3, faceCy - 4, 1, 1);
        target.fillStyle = '#55AAFF';
        target.fillRect(faceCx - 4, faceCy - 7, 1, 2);
        target.fillRect(faceCx + 4, faceCy - 7, 1, 2);
        break;
      case 'frustrated':
        target.fillRect(faceCx - 4, faceCy - 10, 3, 1);
        target.fillRect(faceCx + 2, faceCy - 10, 3, 1);
        target.fillRect(faceCx - 3, faceCy - 8, 2, 1);
        target.fillRect(faceCx + 1, faceCy - 8, 2, 1);
        target.fillRect(faceCx - 3, faceCy - 5, 2, 1);
        target.fillRect(faceCx, faceCy - 5, 2, 1);
        target.fillRect(faceCx + 3, faceCy - 5, 1, 1);
        break;
      case 'bored':
        target.fillRect(faceCx - 4, faceCy - 8, 3, 1);
        target.fillRect(faceCx + 1, faceCy - 8, 3, 1);
        target.fillRect(faceCx - 2, faceCy - 4, 3, 1);
        break;
      case 'phew':
        target.fillRect(faceCx - 3, faceCy - 8, 2, 1);
        target.fillRect(faceCx + 1, faceCy - 8, 2, 1);
        target.fillRect(faceCx - 2, faceCy - 5, 4, 2);
        break;
      default:
        // Neutral face: eyes only. The cream beard already reads as the muzzle.
        target.fillRect(faceCx - 3, faceCy - 9, 2, 2);
        target.fillRect(faceCx + 1, faceCy - 9, 2, 2);
    }
  }

  function drawGorillaArms(target, cx, cy, pose, isPanicking, ramp = getGorillaRamp(), side = -1) {
    const sprite = GORILLA_SPRITE;
    const leftX = cx - sprite.armX;
    const rightX = cx + sprite.armX - sprite.armW;
    const downY = cy + sprite.armY;
    const upY = downY - sprite.armLift;

    const arm = (x, y) => {
      target.fillStyle = ramp.fill;
      target.fillRect(x, y, sprite.armW, sprite.armH);
      // Contrasting pink palm across the bottom of the arm (extends 1px past
      // the arm to match the reference-image silhouette).
      target.fillStyle = ramp.hand;
      target.fillRect(x, y + sprite.armH - 2, sprite.armW + 1, 2);
    };

    switch (pose) {
      case 0:
        if (isPanicking) {
          arm(leftX, upY);
          arm(rightX, upY);
        } else {
          arm(leftX, downY);
          arm(rightX, downY);
        }
        break;
      case 1:
        arm(leftX, downY);
        arm(rightX, upY);
        break;
      case 2:
        arm(leftX, upY);
        arm(rightX, downY);
        break;
      case 3:
        arm(leftX, upY);
        arm(rightX, upY);
        break;
      case 4:
        arm(leftX, downY + 2);
        arm(rightX, downY + 2);
        break;
      case 5:
        arm(leftX, downY);
        target.fillStyle = ramp.fill;
        target.fillRect(cx - 4, cy - 10, 10, 3);
        target.fillStyle = ramp.outline;
        target.fillRect(cx - 4, cy - 8, 2, 1);
        target.fillRect(cx + 4, cy - 8, 2, 1);
        break;
      case 6: {
        const waveNudge = Math.round(Math.sin(performance.now() / 105 + cx * 0.09) * 2);
        if (side < 0) {
          arm(leftX, downY + 1);
          arm(rightX, upY - 1);
          target.fillStyle = ramp.fill;
          target.fillRect(rightX - 1, upY - 2, 6, 2);
          target.fillRect(rightX + 1 + waveNudge, upY - 4, 2, 2);
          target.fillStyle = ramp.outline;
          target.fillRect(rightX - 1, upY - 1, 1, 1);
          target.fillRect(rightX + 2 + waveNudge, upY - 3, 1, 1);
        } else {
          arm(leftX, upY - 1);
          arm(rightX, downY + 1);
          target.fillStyle = ramp.fill;
          target.fillRect(leftX - 1, upY - 2, 6, 2);
          target.fillRect(leftX + 1 + waveNudge, upY - 4, 2, 2);
          target.fillStyle = ramp.outline;
          target.fillRect(leftX + 4, upY - 1, 1, 1);
          target.fillRect(leftX + 1 + waveNudge, upY - 3, 1, 1);
        }
        break;
      }
    }
  }

  function drawGorillaSprite(target, cx, cy, pose, faceKind, isPanicking, ramp = getGorillaRamp(), side = -1) {
    drawGorillaBody(target, cx, cy, ramp);
    drawGorillaFace(target, cx, cy, faceKind, ramp);
    drawGorillaArms(target, cx, cy, pose, isPanicking, ramp, side);
  }

  // Self-contained gorilla renderer for arbitrary canvas contexts.
  // cx/cy is the center point; sc is pixel scale; mirror flips horizontally.
  function drawDancingMonkey(c, cx, cy, sc, pose, face, mirror, color) {
    c.save();
    c.translate(cx, cy);
    c.scale(mirror ? -sc : sc, sc);
    drawGorillaSprite(c, 0, 0, pose, face, false, getGorillaRamp(color), mirror ? 1 : -1);
    c.restore();
  }

  const DEFEATED_CURSE_TEXT = ['@#$!', '%&*!', '#!?@', '*$#?'];

  function drawDefeatedCurseBubble(c, cx, cy, mirror, t) {
    const text = DEFEATED_CURSE_TEXT[Math.floor(t / 520) % DEFEATED_CURSE_TEXT.length];
    const wobble = Math.round(Math.sin(t / 140) * 2);
    const bx = Math.round(cx - 25 + (mirror ? -4 : 4));
    const by = Math.round(cy - 74 + wobble);
    const bw = 50;
    const bh = 20;

    c.save();
    c.font = 'bold 13px monospace';
    c.lineWidth = 2;
    c.fillStyle = '#FFFFFF';
    c.strokeStyle = '#101010';
    c.beginPath();
    c.roundRect(bx, by, bw, bh, 4);
    c.fill();
    c.stroke();

    c.beginPath();
    c.moveTo(cx - 5, by + bh - 1);
    c.lineTo(cx + 2, by + bh - 1);
    c.lineTo(cx - (mirror ? 4 : -4), by + bh + 8);
    c.closePath();
    c.fill();
    c.stroke();

    const colors = ['#CC0000', '#FF6600', '#7700CC', '#111111'];
    for (let i = 0; i < text.length; i++) {
      c.fillStyle = colors[i % colors.length];
      c.fillText(text[i], bx + 8 + i * 9, by + 14);
    }
    c.restore();
  }

  function drawDefeatedMonkey(c, cx, cy, sc, mirror, color, t) {
    const slump = Math.round(Math.sin(t / 420) * 2);
    const faceCycle = Math.floor(t / 650) % 3;
    const face = faceCycle === 0 ? 'c' : (faceCycle === 1 ? 'frustrated' : 'a');
    const pose = faceCycle === 2 ? 3 : 4;
    const tilt = mirror ? 0.12 : -0.12;

    c.save();
    c.translate(cx, cy + 13 + slump);
    c.scale(mirror ? -sc : sc, sc);
    c.rotate(tilt);
    drawGorillaSprite(c, 0, 0, pose, face, false, getGorillaRamp(color), mirror ? 1 : -1);
    c.restore();

    drawDefeatedCurseBubble(c, cx, cy, mirror, t);
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
    const leftColor = getPlayerColor(0);
    const rightColor = getPlayerColor(1);

    function frame() {
      const t    = Date.now();
      const beat = Math.floor(t / 210) % DANCE_POSES.length;
      const dancePose = DANCE_POSES[beat];
      const danceFace = (Math.floor(t / 900) % 4 === 0) ? 't' : 'h';

      const lBounce = Math.sin(t / 190) * 8;
      const rBounce = Math.sin(t / 190) * 8;

      lc.clearRect(0, 0, lCanvas.width, lCanvas.height);
      rc.clearRect(0, 0, rCanvas.width, rCanvas.height);

      if (winnerIdx === 0) {
        drawDancingMonkey(lc, LCX, LCY - lBounce, SC, dancePose, danceFace, false, leftColor);
        drawDefeatedMonkey(rc, RCX, RCY, SC, true, rightColor, t);
      } else {
        drawDefeatedMonkey(lc, LCX, LCY, SC, false, leftColor, t);
        drawDancingMonkey(rc, RCX, RCY - rBounce, SC, dancePose, danceFace, true, rightColor);
      }

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


  function drawGorilla(x, y, pose, playerIdx) {
    if (!gorillaVisible[playerIdx]) return;

    const baseCx = x + GORILLA_W / 2;
    const baseCy = y + GORILLA_H / 2;
    const side = getGorillaSide(playerIdx);
    const ramp = getGorillaRamp(getPlayerColor(playerIdx));

    const isPanicking = panicPlayers.has(playerIdx);
    const isFlinching = !!flinchTimers[playerIdx];
    const isPhew      = !!phewTimers[playerIdx];
    const isFrust     = !!frustratedTimers[playerIdx];
    const isBored     = !!boredTimers[playerIdx];
    const isMissed    = !!missedTimers[playerIdx];
    const taunt       = getTauntTransform(playerIdx);
    const isWet = roundWeather === 'rain' || roundWeather === 'storm' || roundWeather === 'acidrain';
    const shouldTurnWave = !taunt &&
      !isPanicking &&
      !isFlinching &&
      !isPhew &&
      !isFrust &&
      !isBored &&
      !isMissed &&
      pose === 0 &&
      gameState === 'playing' &&
      currentPlayer === playerIdx + 1 &&
      !showBanana &&
      (performance.now() - turnStartedAt) < 1800;

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
    else if (shouldTurnWave) { effPose = 6; faceKind = 'h'; }

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
      } else if (shouldTurnWave) {
        bodyDy = Math.sin(rNow / 210 + playerIdx) * -1.3;
        bodyDx = side * 0.35;
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

    drawGorillaSprite(ctx, cx, cy, effPose, faceKind, isPanicking, ramp, side);

    // Wet overlay: blue tint + drip below feet
    if (isWet) {
      ctx.fillStyle = 'rgba(85, 170, 255, 0.14)';
      ctx.fillRect(cx - Math.floor(GORILLA_SPRITE.shoulderW / 2), cy + GORILLA_SPRITE.headY, GORILLA_SPRITE.shoulderW, 24);
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
      case 'sunflare': return '#FFD700';
      default: return BANANA_COLOR;
    }
  }

  function drawBananaSprite(fill, outline, highlight, shadow, sizeBias) {
    const segs = sizeBias > 0
      ? [[-6, -2, 8, 3], [-1, 1, 6, 3], [4, 3, 3, 2]]
      : [[-5, -2, 7, 3], [-1, 1, 5, 2], [3, 3, 2, 1]];
    for (const seg of segs) {
      fillOutlinedRect(ctx, seg[0], seg[1], seg[2], seg[3], outline, fill);
    }
    ctx.fillStyle = highlight;
    ctx.fillRect(-4, -2, 3, 1);
    ctx.fillRect(0, 1, 2, 1);
    ctx.fillStyle = shadow;
    ctx.fillRect(3, 2, 2, 1);
    ctx.fillRect(1, 2, 2, 1);
  }

  function drawBanana(x, y, frame, type) {
    if (type === 'turret-deploy') {
      drawTurretDeployProjectile(x, y, frame);
      return;
    }
    const fill = getBananaColor(type || activeBananaType);
    const outline = blendHex('#3B2205', getRoundPalette().outline, 0.35);
    const highlight = blendHex(fill, '#FFF8B8', 0.38);
    const shadow = blendHex(fill, '#5A2300', 0.4);
    const sizeBias = type === 'heavy' ? 1 : 0;

    ctx.save();
    ctx.translate(x, y);
    switch (frame % 4) {
      case 1: ctx.rotate(-Math.PI / 4); break;
      case 2: ctx.rotate(-Math.PI / 2); break;
      case 3: ctx.rotate(Math.PI / 4); break;
      default: break;
    }
    drawBananaSprite(fill, outline, highlight, shadow, sizeBias);
    ctx.restore();
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
            const a = alpha * (0.25 + 0.45 * (i / trail.length));
            const px = Math.floor(trail[i].x);
            const py = Math.floor(trail[i].y);
            const size = 2 + (i % 3);
            ctx.fillStyle = `rgba(32, 32, 44, ${a.toFixed(2)})`;
            ctx.fillRect(px - size, py - size, size + 2, size + 2);
            ctx.fillStyle = `rgba(155, 155, 168, ${(a * 0.9).toFixed(2)})`;
            ctx.fillRect(px - size + 1, py - size + 1, size, size);
            ctx.fillStyle = `rgba(235, 235, 240, ${(a * 0.25).toFixed(2)})`;
            ctx.fillRect(px - size + 2, py - size + 1, 1, 1);
          }
        }
        break;
      case 'fire':
        for (let i = 0; i < trail.length; i++) {
          if (i % 2 === 0) {
            const a = alpha * (0.4 + 0.4 * (i / trail.length));
            const px = Math.floor(trail[i].x);
            const py = Math.floor(trail[i].y);
            ctx.fillStyle = `rgba(121, 18, 0, ${(a * 0.85).toFixed(2)})`;
            ctx.fillRect(px - 2, py - 2, 5, 5);
            ctx.fillStyle = `rgba(255, 116, 0, ${a.toFixed(2)})`;
            ctx.fillRect(px - 1, py - 2, 3, 4);
            ctx.fillStyle = `rgba(255, 240, 120, ${(a * 0.8).toFixed(2)})`;
            ctx.fillRect(px, py - 2, 1, 2);
          }
        }
        break;
      default: // dotted
        for (let i = 0; i < trail.length; i++) {
          if (i % 3 === 0) {
            const px = Math.floor(trail[i].x);
            const py = Math.floor(trail[i].y);
            ctx.fillStyle = `rgba(100, 52, 0, ${(alpha * 0.8).toFixed(2)})`;
            ctx.fillRect(px - 2, py - 2, 4, 4);
            ctx.fillStyle = `rgba(255, 246, 133, ${alpha.toFixed(2)})`;
            ctx.fillRect(px - 1, py - 1, 2, 2);
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

      const pulse = Math.max(0.15, Math.sin(exp.progress * 40) * 0.15 + 0.85);
      const outerColor = alphaColor('#FF6B1A', alpha);
      const midColor = alphaColor('#FFC938', alpha * pulse);
      const coreColor = alphaColor('#FFF6C0', alpha);

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.translate(exp.x, exp.y);
      ctx.fillStyle = outerColor;
      ctx.beginPath();
      for (let p = 0; p < 12; p++) {
        const angle = (p / 12) * Math.PI * 2;
        const radius = p % 2 === 0 ? r : r * 0.55;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (p === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = midColor;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = coreColor;
      ctx.fillRect(-Math.max(2, r * 0.18), -Math.max(2, r * 0.18), Math.max(4, r * 0.36), Math.max(4, r * 0.36));
      ctx.fillStyle = alphaColor('#7A1300', alpha * 0.7);
      for (let p = 0; p < 8; p++) {
        const angle = (p / 8) * Math.PI * 2;
        const dist = r * 0.75;
        const size = 2 + (p % 2);
        ctx.fillRect(Math.round(Math.cos(angle) * dist) - 1, Math.round(Math.sin(angle) * dist) - 1, size, size);
      }
      ctx.restore();
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
  function spawnDeathChunks(x, y, playerIdx = 0) {
    const ramp = getGorillaRamp(getPlayerColor(playerIdx));
    for (let i = 0; i < 12; i++) {
      deathChunks.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 5 - 2,
        size: 2 + Math.random() * 4,
        color: Math.random() > 0.5 ? ramp.fill : ramp.shadow,
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
  let _renderErrorCount = 0;
  function render() {
    // Schedule next frame first so the loop never dies even if this frame throws
    requestAnimationFrame(render);
    const now = performance.now();
    const dt = Math.min((now - lastRenderTime) / 1000, 0.05); // cap at 50ms
    lastRenderTime = now;
    try {

    if (gameState === 'playing' || gameState === 'paused') {
      // worldDt is 0 while paused so explosions / tracers / chunks are frozen
      const worldDt = gameState === 'playing' ? dt * cinematicTimeScale : 0;
      if (gameState === 'playing') {
        // Update systems — world systems respect cinematic time dilation;
        // camera lerp uses real dt so zoom feels snappy regardless.
        Background.update(worldDt);
        Particles.update(worldDt);
        Lighting.update(worldDt);
        updateCam(dt);
      }

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

      // 2. Backdrop content that should not show through standing building columns.
      drawMaskedBackdrop();

      // 3. Sun/Moon
      drawSun();

      // 4. Terrain & buildings
      drawBuildings();

      // 5. Trails
      drawTrail(previousTrail, 0.25);
      drawTrail(bananaTrail, 0.5);

      // 6. Gorillas
      for (let gi = 0; gi < gorillas.length; gi++) {
        drawGorilla(gorillas[gi].x, gorillas[gi].y, gorillaAnim[gi], gi);
      }

      // 6.25 Golden Gorilla (rendered on top of regular gorillas)
      drawGoldenGorilla();

      // 6.5 Turrets — rendered before bananas so a banana in front occludes
      for (const t of turrets) {
        // Decay barrel kick over real time so recoil feels snappy regardless of cinematic slowdown
        if (t.barrelKick) t.barrelKick = Math.max(0, t.barrelKick - dt * 30);
        drawTurret(t);
      }
      drawTurretTracers(worldDt);

      // 7. Banana
      if (showBanana && banana) {
        drawBanana(banana.x, banana.y, banana.frame, activeBananaType);
      }

      // 8. Cluster bananas
      for (const cb of clusterBananas) {
        drawBanana(cb.x, cb.y, Math.floor(cb.x / 10) % 4, 'cluster');
      }

      // 9. Explosions
      drawExplosions(worldDt);

      // 10. Napalm
      drawNapalmPatches();

      // 11. Death chunks
      updateDeathChunks(worldDt);
      drawDeathChunks();

      // 12. Particles in front (rain, snow, sparks, etc.)
      Particles.renderFront(ctx);

      ctx.restore();

      // 13. Lighting overlay (ambient tint, lights, flashes)
      Lighting.render(ctx);

      // 14. Shadows
      Lighting.drawShadows(ctx, buildings, collapsedBuildings, gorillas, gorillaVisible, roundTimeOfDay, GORILLA_W, GORILLA_H, LOGICAL_H);

      // 15. Slow-mo overlay
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

    } catch (e) {
      _renderErrorCount++;
      if (_renderErrorCount <= 10) {
        console.error('[Render] Error in render loop (frame will continue):', e);
      }
    }
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
    scheduleCanvasResize();
  }

  function clearElement(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function isHostPlayer() {
    return myPlayer > 0 && myPlayer === hostPlayer;
  }

  function isSpectator() {
    return clientRole === 'spectator';
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
      return sessionStorage.getItem('mm_player') === sessionStorage.getItem('mm_host_player') &&
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

      const nameRow = document.createElement('div');
      nameRow.className = 'hud-name-row';

      const colorChip = document.createElement('span');
      colorChip.className = 'hud-color-chip';
      colorChip.style.backgroundColor = getPlayerColor(i);
      colorChip.style.boxShadow = `0 0 10px ${alphaColor(getPlayerColor(i), 0.45)}`;
      nameRow.appendChild(colorChip);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'hud-pname';
      nameSpan.textContent = getPlayerDisplayName(i);
      nameRow.appendChild(nameSpan);
      meta.appendChild(nameRow);

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
    updateSpectatorUI();
  }

  function getMyQueuedChallenge() {
    return challengeQueue.find(entry => entry.spectatorId === mySpectatorId) || null;
  }

  function getChallengeForMySeat() {
    if (myPlayer < 1) return null;
    return challengeQueue.find(entry => entry.targetPlayer === myPlayer) || null;
  }

  function renderChallengeQueueText() {
    if (!challengeQueue.length) return 'No spectator challenges queued.';
    return challengeQueue
      .map((entry, idx) => `${idx + 1}. ${entry.spectatorName} -> ${entry.targetName || `Player ${entry.targetPlayer}`}`)
      .join('  ');
  }

  function renderChallengeButtons(container) {
    if (!container) return;
    clearElement(container);
    if (!isSpectator()) return;

    const queued = getMyQueuedChallenge();
    const activeCount = Math.max(1, getActivePlayerCountLocal());
    for (let i = 0; i < activeCount; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spectator-challenge-btn';
      btn.textContent = queued && queued.targetPlayer === i + 1 ? `QUEUED P${i + 1}` : `CHALLENGE P${i + 1}`;
      btn.disabled = !!queued && queued.targetPlayer === i + 1;
      btn.addEventListener('click', () => {
        Net.send({ type: 'challengePlayer', targetPlayer: i + 1 });
      });
      container.appendChild(btn);
    }
  }

  function updateSpectatorUI() {
    const hudSpec = document.getElementById('hud-spectators');
    if (hudSpec) hudSpec.textContent = `SPEC ${spectatorCount}/${maxSpectators}`;

    const panel = document.getElementById('spectator-panel');
    const copy = document.getElementById('spectator-panel-copy');
    const buttons = document.getElementById('spectator-challenge-buttons');
    const queueList = document.getElementById('challenge-queue-list');
    if (panel) panel.style.display = isSpectator() ? 'flex' : 'none';
    if (copy) {
      const queued = getMyQueuedChallenge();
      copy.textContent = queued ?
        `Queued for ${queued.targetName || `Player ${queued.targetPlayer}`}. First open seat wins.` :
        'Challenge a player to claim the next open seat.';
    }
    renderChallengeButtons(buttons);
    if (queueList) queueList.textContent = renderChallengeQueueText();

    const matchPanel = document.getElementById('match-challenge-panel');
    if (matchPanel) {
      clearElement(matchPanel);
      if (isSpectator()) {
        const copyEl = document.createElement('div');
        const queued = getMyQueuedChallenge();
        copyEl.textContent = queued ?
          `You are queued for ${queued.targetName || `Player ${queued.targetPlayer}`}.` :
          'Challenge a player for the next open seat.';
        matchPanel.appendChild(copyEl);
        const row = document.createElement('div');
        row.className = 'spectator-challenge-buttons';
        renderChallengeButtons(row);
        matchPanel.appendChild(row);
      } else if (myPlayer > 0) {
        const challenger = getChallengeForMySeat();
        if (challenger) {
          const copyEl = document.createElement('div');
          copyEl.textContent = `${challenger.spectatorName} is first in line for your seat.`;
          matchPanel.appendChild(copyEl);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'match-action-btn';
          btn.textContent = 'GIVE SEAT';
          btn.addEventListener('click', () => Net.send({ type: 'acceptChallenge' }));
          matchPanel.appendChild(btn);
        }
      }

      const queueEl = document.createElement('div');
      queueEl.className = 'challenge-queue-list';
      queueEl.textContent = renderChallengeQueueText();
      matchPanel.appendChild(queueEl);
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
    setControlValues(SHAKE_SELECT_IDS, settings.shakeIntensity);
    setControlValues(TRAIL_SELECT_IDS, settings.trailStyle);
    setControlValues(CRT_SELECT_IDS, String(settings.crtOverlay));
    const p2NameEl = document.getElementById('player2-name');
    const p2ColorEl = document.getElementById('player2-color');
    const p2ColorRead = document.getElementById('player2-color-readout');
    if (p2NameEl) p2NameEl.value = settings.player2Name || 'Player 2';
    if (p2ColorEl) p2ColorEl.value = settings.player2Color || getDefaultPlayerColor(1);
    if (p2ColorRead) p2ColorRead.textContent = (settings.player2Color || getDefaultPlayerColor(1)).toUpperCase();
    updateHotseatFieldsVisibility();
  }

  function updateHotseatFieldsVisibility() {
    const fields = document.getElementById('hotseat-player2-fields');
    if (!fields) return;
    const modeSelect = document.getElementById('gamemode-select');
    const mode = modeSelect ? modeSelect.value : settings.gameMode;
    const canEdit = !Net.isConnected() || isHostPlayer();
    fields.style.display = (mode === 'hotseat' && canEdit) ? '' : 'none';
  }

  function updateSetupPresentation(joining) {
    const connected = Net.isConnected();
    const hostSettings = document.getElementById('setup-host-settings');
    const setupHeader = document.querySelector('.setup-box h2');
    const setupHint = document.querySelector('.setup-hint');
    const hostNote = document.getElementById('setup-host-note');
    const resetBtn = document.getElementById('reset-classic-btn');
    const canEditMatchSettings = (!connected && pendingJoinRole !== 'spectator') || isHostPlayer();
    const localOnlyIds = new Set(['music-select', 'music-order-select', 'effects-quality-select']);

    if (connected) {
      hostSettings.style.display = isSpectator() ? 'none' : 'block';
      setupHeader.textContent = isSpectator() ? 'SPECTATOR PROFILE' : 'LOBBY SETTINGS';
      setupHint.textContent = isSpectator() ? 'Press Enter to return to the game' : (isHostPlayer() ?
        'Press Enter to sync settings and return to the lobby' :
        'Press Enter to return to the lobby');
    } else if (pendingJoinRole === 'spectator') {
      hostSettings.style.display = 'none';
      setupHeader.textContent = 'SPECTATE GAME';
      setupHint.textContent = 'Press Enter to spectate';
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

    hostNote.style.display = connected && !isHostPlayer() && !isSpectator() ? 'block' : 'none';
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
    const specText = spectatorCount > 0 ? ` Spectators: ${spectatorCount}/${maxSpectators}.` : '';
    const remaining = Math.max(0, requiredPlayers - connectedPlayers);
    const modeLabel = getModeConfigLocal(msg?.mode || settings.gameMode).label;

    if (connectedPlayers > supportedPlayers) {
      statusEl.textContent =
        `${modeLabel} supports up to ${supportedPlayers} player${supportedPlayers === 1 ? '' : 's'}. ${connectedPlayers} are connected.${specText}`;
      return;
    }

    if (isHostPlayer()) {
      if (remaining <= 0) {
        statusEl.textContent = `Lobby ready. Starting match...${specText}`;
      } else if (remaining === 1) {
        statusEl.textContent = `Share the URL above with 1 more player.${specText}`;
      } else {
        statusEl.textContent = `Share the URL above with ${remaining} more players.${specText}`;
      }
    } else {
      statusEl.textContent = remaining > 0 ?
        `Waiting for more players to join...${specText}` :
        `Waiting for host to start the game...${specText}`;
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

      if (msg.type === 'assigned' && msg.player === msg.hostPlayer && !clearRequested) {
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

  function disconnectToTitle() {
    suppressReconnect = true;
    Net.disconnect();
    switchToTitle();
  }

  function clearPauseMenuState() {
    serverPaused = false;
    pausedByPlayer = 0;
    pausedByName = '';
    previousState = null;
    const pauseScreen = document.getElementById('pause-screen');
    if (pauseScreen) pauseScreen.classList.remove('active');
  }

  function syncPausePresentation() {
    const titleEl = document.getElementById('pause-title');
    const statusEl = document.getElementById('pause-status');
    if (titleEl) titleEl.textContent = 'PAUSED';
    if (!statusEl) return;

    if (pausedByPlayer > 0 && pausedByPlayer === myPlayer) {
      statusEl.textContent = 'You paused the match. Both players are frozen until someone resumes.';
      return;
    }

    if (pausedByName) {
      statusEl.textContent = `${pausedByName} paused the match. Both players are frozen until someone resumes.`;
      return;
    }

    statusEl.textContent = 'The match is paused. Both players are frozen until someone resumes.';
  }

  function openPauseMenu() {
    gameState = 'paused';
    previousState = 'playing';
    syncPausePresentation();
    setControlValues(PLAYER_NAME_INPUT_IDS, myName);
    document.getElementById('pause-screen').classList.add('active');
    document.getElementById('hud').classList.add('active');
    updateAudioVolumeControls();
    updateInputPanel();
    scheduleCanvasResize();
  }

  function closePauseMenu() {
    document.getElementById('pause-screen').classList.remove('active');
    gameState = 'playing';
    previousState = null;
    document.getElementById('hud').classList.add('active');
    updateHUD();
    updateInputPanel();
    scheduleCanvasResize();
  }

  function requestPauseState(paused) {
    if (!Net.isConnected()) return;
    Net.send({ type: 'setPaused', paused: !!paused });
  }

  function commitPauseNameChange() {
    const nextName = getPlayerNameInputValue();
    setControlValues(PLAYER_NAME_INPUT_IDS, nextName);
    if (nextName === myName) {
      saveSettings();
      return;
    }

    myName = nextName;
    saveSettings();
    sendPlayerProfile();
  }

  function leaveMatchToTitle() {
    commitPauseNameChange();
    suppressReconnect = true;
    if (Net.isConnected()) {
      try {
        Net.send({ type: 'leaveMatch' });
      } catch (e) {}
    }
    setTimeout(() => Net.disconnect(), 50);
    switchToTitle();
  }

  function applyPauseState(msg) {
    serverPaused = !!msg?.paused;
    pausedByPlayer = Math.max(0, Math.floor(Number(msg?.pausedByPlayer) || 0));
    pausedByName = typeof msg?.pausedByName === 'string' ? msg.pausedByName : '';
    syncPausePresentation();

    if (serverPaused) {
      stopTurnTimerDisplay();
      openPauseMenu();
      return;
    }

    if (gameState === 'paused') {
      closePauseMenu();
    } else {
      clearPauseMenuState();
    }
  }

  function switchToTitle() {
    clearPauseMenuState();
    gameState = 'title';
    myPlayer = 0;
    hostPlayer = 0;
    clientRole = 'player';
    pendingJoinRole = 'player';
    mySpectatorId = null;
    challengeQueue = [];
    // Reset hot-seat overlay state so it doesn't bleed across sessions
    hotseatLastShownPlayer = 0;
    hotseatPassPending = false;
    const _hotseatOverlay = document.getElementById('hotseat-pass-overlay');
    if (_hotseatOverlay) _hotseatOverlay.style.display = 'none';
    stopDanceAnimation();
    document.getElementById('hud-bottombar').classList.remove('match-over-active');
    roundBiome = 'city';
    roundTimeOfDay = 'day';
    roundWeather = 'clear';
    setLogicalSize(DEFAULT_MAP_CONFIG.w, DEFAULT_MAP_CONFIG.h);
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
    playerColors = buildDefaultPlayerColors();
    playerColors[0] = myColor;
    playerTeams = buildDefaultPlayerTeams();
    teamScores = null;
    scoreMode = 'individual';
    currentPlayer = 1;
    turrets = [];
    turretTracers = [];
    turretCharges = [3, 3, 3, 3];
    initTwinkles();
    checkServerStatus();
    startTitleMusic();
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
    const clearBtn = document.getElementById('clear-host-btn');
    const spectateBtn = document.getElementById('spectate-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    if (spectateBtn) spectateBtn.style.display = 'none';
    fetch('/status')
      .then(r => r.json())
      .then(data => {
        spectatorCount = Math.max(0, Number(data.spectatorCount || 0));
        maxSpectators = Math.max(0, Number(data.maxSpectators || maxSpectators));
        if (Array.isArray(data.spectatorNames)) spectatorNames = data.spectatorNames.slice();
        updateSpectatorUI();
        if (hasStoredHostSession() && data.active && clearBtn) clearBtn.style.display = 'inline-block';
        if (data.active && data.joinableAsSpectator && spectateBtn) spectateBtn.style.display = 'inline-block';
      })
      .catch(() => {});
  }

  function searchForGame() {
    const joinBtn = document.getElementById('join-btn');
    const spinner = document.getElementById('join-spinner');
    const lobbyEl = document.getElementById('title-lobby');
    const lobbyInfo = document.getElementById('lobby-info');

    joinBtn.disabled = true;
    lobbyEl.style.display = 'none';
    if (spinner) spinner.style.display = 'inline';

    fetch('/status')
      .then(r => r.json())
      .then(data => {
        if (spinner) spinner.style.display = 'none';
        const visiblePlayers = (Number(data.connectedPlayerCount || data.playerCount || 0) +
          Number(data.reservedPlayerCount || 0));
        if (data.active && visiblePlayers > 0) {
          spectatorCount = Math.max(0, Number(data.spectatorCount || 0));
          maxSpectators = Math.max(0, Number(data.maxSpectators || maxSpectators));
          updateSpectatorUI();
          isJoining = true;
          pendingJoinRole = data.joinableAsPlayer ? 'player' : 'spectator';
          switchToSetup(true);
        } else {
          lobbyInfo.textContent = 'No active game found. Ask someone to host first!';
          lobbyEl.style.display = 'block';
          joinBtn.disabled = false;
        }
      })
      .catch(() => {
        if (spinner) spinner.style.display = 'none';
        lobbyInfo.textContent = 'Could not reach server.';
        lobbyEl.style.display = 'block';
        joinBtn.disabled = false;
      });
  }

  let isJoining = false;

  document.getElementById('host-btn').addEventListener('click', () => {
    playUIConfirm();
    isJoining = false;
    pendingJoinRole = 'player';
    switchToSetup(false);
  });

  document.getElementById('join-btn').addEventListener('click', () => {
    playUIConfirm();
    searchForGame();
  });

  const spectateBtn = document.getElementById('spectate-btn');
  if (spectateBtn) {
    spectateBtn.addEventListener('click', () => {
      playUIConfirm();
      isJoining = true;
      pendingJoinRole = 'spectator';
      switchToSetup(true);
    });
  }

  document.getElementById('clear-host-btn').addEventListener('click', () => {
    playUIConfirm();
    attemptStoredHostClear();
  });

  function switchToSetup(joining) {
    clearPauseMenuState();
    gameState = 'setup';
    showScreen('setup-screen');
    playUIConfirm();
    loadSettings();
    document.getElementById('player-color').value = myColor;
    if (Net.isConnected()) {
      applyCurrentSettingsToSetupUI();
      if (myName) setControlValues(PLAYER_NAME_INPUT_IDS, myName);
      document.getElementById('player-color').value = myColor;
    }
    syncSetupSelectionsToState();
    updatePlayerColorControl();
    updateRoundsLabel();
    updateSetupPresentation(joining);
    applyCRTSetting();
    startTitleMusic();
    document.getElementById('player-name').focus();
  }

  function switchToWaiting() {
    clearPauseMenuState();
    gameState = 'waiting';
    const keysOverlay = document.getElementById('keys-overlay');
    if (keysOverlay) keysOverlay.style.display = 'none';
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
    startTitleMusic();
    updateSpectatorUI();
  }

  function switchToPlaying() {
    clearPauseMenuState();
    gameState = 'playing';
    shotPending = false;
    // Reset hot-seat overlay tracking so the first turn of a fresh match
    // displays the pass overlay (and any stale overlay from a prior match is hidden).
    hotseatLastShownPlayer = 0;
    const overlay = document.getElementById('hotseat-pass-overlay');
    if (overlay) overlay.style.display = 'none';
    hotseatPassPending = false;
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById('hud').classList.add('active');
    updateHUD();
    // Replace title music with a gameplay track when the round begins.
    if (!bgAudio || bgAudio.paused || bgTrackIndex === TITLE_MUSIC_INDEX) {
      if (bgAudio && !bgAudio.paused) stopBGMusic();
      bgTrackIndex = Math.floor(Math.random() * BG_PLAYLIST.length);
      if (BG_PLAYLIST.length > 1) {
        while (bgTrackIndex === TITLE_MUSIC_INDEX) {
          bgTrackIndex = Math.floor(Math.random() * BG_PLAYLIST.length);
        }
      }
    }
    startBGMusic();
    updateSpectatorUI();
    scheduleCanvasResize();
  }

  function switchToMatchOver(winner, finalScores, stats) {
    clearPauseMenuState();
    gameState = 'matchOver';
    shotPending = false;
    closeChatInput();
    blurFocusedInput();
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
    updateSpectatorUI();
    scheduleCanvasResize();

    // Start the dancing monkey canvases (winner = 1-indexed → 0-indexed)
    startDanceAnimation(winnerIdx % 2);
  }

  // ─── HUD updates ──────────────────────────────────────────────────────────
  function updateHUD() {
    renderHudScores();

    const turnName = getTurnDisplayName();
    const turnEl = document.getElementById('hud-turn');
    turnEl.classList.remove('my-turn', 'waiting-turn');
    const isHotseat = settings.gameMode === 'hotseat';
    if (isSpectator()) {
      turnEl.textContent = `WATCHING ${turnName.toUpperCase()}`;
      turnEl.classList.add('waiting-turn');
    } else if (isHotseat) {
      // Hot seat: every gorilla is local. Always frame as "<name>'S TURN".
      turnEl.textContent = `${turnName.toUpperCase()}'S TURN - FIRE WHEN READY`;
      turnEl.classList.add('my-turn');
    } else if (myPlayer === currentPlayer) {
      turnEl.textContent = 'YOUR TURN - FIRE WHEN READY';
      turnEl.classList.add('my-turn');
    } else {
      turnEl.textContent = `WAITING FOR ${turnName.toUpperCase()}...`;
      turnEl.classList.add('waiting-turn');
    }

    drawWindArrow();

    // Show round info — always visible during play
    const infoEl = document.getElementById('hud-info');
    {
      const BIOME_ICONS = {
        city:       '🏙',
        desert:     '🏜',
        arctic:     '❄️',
        jungle:     '🌿',
        volcanic:   '🌋',
        moon:       '🌕',
        underwater: '🌊',
        postapoc:   '☢️',
        cyberpunk:  '🤖',
      };
      const WEATHER_ICONS = {
        clear:     '☀️',
        rain:      '🌧',
        fog:       '🌫',
        storm:     '⛈',
        acidrain:  '☣️',
        sandstorm: '🌪',
        windshear: '💨',
        snow:      '🌨',
      };
      const biomeLabel = (roundBiome || 'city').charAt(0).toUpperCase() + (roundBiome || 'city').slice(1);
      const weatherLabel = (roundWeather || 'clear').charAt(0).toUpperCase() + (roundWeather || 'clear').slice(1);
      const biomeIcon   = BIOME_ICONS[roundBiome]   || '🏙';
      const weatherIcon = WEATHER_ICONS[roundWeather] || '☀️';
      infoEl.innerHTML =
        `<span class="hud-info-biome">${biomeIcon} ${biomeLabel}</span>` +
        `<span class="hud-info-sep"> · </span>` +
        `<span class="hud-info-weather">${weatherIcon} ${weatherLabel}</span>`;
      infoEl.style.display = 'block';
    }

    updateInputPanel();
    updateSpectatorUI();
  }

  function updateInputPanel() {
    const panel = document.getElementById('input-panel');
    const isSpec = isSpectator();
    const isHotseat = settings.gameMode === 'hotseat';
    // In hot seat, the host always controls input — but the pass-controller
    // overlay must be dismissed first.
    const hotseatReady = isHotseat && !hotseatPassPending && myPlayer > 0;
    const standardReady = !isHotseat && myPlayer === currentPlayer;
    const isMyTurn = !isSpec && (standardReady || hotseatReady) && gameState === 'playing' && !showBanana && !shotPending;

    // Always show the panel so the bottom bar always has both sections
    panel.style.display = 'flex';

    const statusEl = document.getElementById('ctrl-header-status');
    const fireBtn = document.getElementById('fire-btn');
    const tauntBtn = document.getElementById('taunt-btn');
    const picnicBtn = document.getElementById('picnic-btn');
    const angleInput = document.getElementById('input-angle');
    const velInput = document.getElementById('input-velocity');
    const velocityRange = document.getElementById('ctrl-velocity-range');
    const ammoSelect = document.getElementById('ammo-select');
    const ctrlInputs = document.querySelector('.ctrl-inputs');
    const btnRow = document.querySelector('.ctrl-btn-row');
    const spectatorPanel = document.getElementById('spectator-panel');

    panel.classList.toggle('panel-disabled', !isMyTurn);
    if (statusEl) statusEl.textContent = isSpec ? 'WATCHING' : (isMyTurn ? 'READY TO FIRE' : 'STANDBY');

    if (ammoSelect) ammoSelect.style.display = isSpec ? 'none' : 'grid';
    if (ctrlInputs) ctrlInputs.style.display = isSpec ? 'none' : 'flex';
    if (btnRow) btnRow.style.display = isSpec ? 'none' : 'grid';
    if (spectatorPanel) spectatorPanel.style.display = isSpec ? 'flex' : 'none';

    angleInput.disabled = !isMyTurn;
    velInput.disabled = !isMyTurn;
    velInput.max = maxVelocity;
    if (velocityRange) velocityRange.textContent = `0-${maxVelocity}`;

    updateAmmoSelect({ interactive: isMyTurn });

    fireBtn.disabled = !isMyTurn;
    tauntBtn.disabled = false;
    picnicBtn.disabled = false;

    if (isMyTurn && (!document.activeElement || document.activeElement === document.body)) {
      angleInput.focus();
    }

    updateSpectatorUI();
    scheduleCanvasResize();
  }

  function updateAmmoSelect({ interactive = (settings.gameMode === 'hotseat' ? !hotseatPassPending : myPlayer === currentPlayer) && gameState === 'playing' && !showBanana && !shotPending } = {}) {
    const ammoSel = document.getElementById('ammo-select');
    if (!ammoSel) return;
    // In hot seat, charges are tracked per gorilla (currentPlayer), not per host slot.
    const idxForCharges = settings.gameMode === 'hotseat' ? (currentPlayer - 1) : (myPlayer - 1);
    const charges = (idxForCharges >= 0 && idxForCharges < 4) ? (turretCharges[idxForCharges] || 0) : 0;
    const chargeLabel = document.getElementById('turret-charges');
    if (chargeLabel) chargeLabel.textContent = `${charges}`;
    const bananaRadio = document.getElementById('ammo-banana');
    const turretRadio = document.getElementById('ammo-turret');
    const turretLabel = document.getElementById('ammo-turret-label');
    if (!bananaRadio || !turretRadio) return;
    const turretAvailable = charges > 0;
    bananaRadio.disabled = !interactive;
    if (!turretAvailable) {
      turretRadio.checked = false;
      bananaRadio.checked = true;
      if (turretLabel) turretLabel.classList.add('ammo-disabled');
    } else {
      if (turretLabel) turretLabel.classList.remove('ammo-disabled');
    }
    turretRadio.disabled = !interactive || !turretAvailable;
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
  const CAM_ZOOM_CLOSE = 4.2; // extra zoom when banana is very close to a gorilla

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
    cam.superClose = false;
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
      playAudioClip(gaspSfx);
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

    // Super-close zoom: when banana is within 50px of any gorilla during cinematic,
    // boost zoom and slow time much further.
    if ((cam.phase === 'in' || cam.phase === 'follow') && banana && gorillas.length) {
      const SUPER_CLOSE_DIST = 50;
      let nearAny = false;
      for (const g of gorillas) {
        const dx = banana.x - g.x;
        const dy = banana.y - g.y;
        if (dx * dx + dy * dy < SUPER_CLOSE_DIST * SUPER_CLOSE_DIST) { nearAny = true; break; }
      }
      if (nearAny && !cam.superClose) {
        cam.superClose = true;
        cam.targetZoom = CAM_ZOOM_CLOSE;
        cinematicTimeScale = 0.15;
      } else if (!nearAny && cam.superClose) {
        cam.superClose = false;
        cam.targetZoom = CAM_ZOOM;
        cinematicTimeScale = 0.4;
      }
    }

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
  function startVictoryDance(winnerIdx, skipBeep = false) {
    let toggle = true;
    if (!skipBeep) playVictorySound();
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
      updateHotseatFieldsVisibility();
    });
  }

  // Hot seat: P2 name/color inputs (host-only); changes broadcast via setSettings
  const player2NameInput = document.getElementById('player2-name');
  if (player2NameInput) {
    const syncP2Name = () => {
      const trimmed = (player2NameInput.value || '').trim().substring(0, 20);
      settings.player2Name = trimmed || 'Player 2';
      saveSettings();
      if (Net.isConnected() && isHostPlayer()) {
        Net.send({ type: 'setSettings', player2Name: settings.player2Name });
      }
    };
    player2NameInput.addEventListener('input', syncP2Name);
    player2NameInput.addEventListener('change', syncP2Name);
  }

  const player2ColorInput = document.getElementById('player2-color');
  const player2ColorReadout = document.getElementById('player2-color-readout');
  if (player2ColorInput) {
    const syncP2Color = () => {
      const sanitized = sanitizePlayerColor(player2ColorInput.value, settings.player2Color || getDefaultPlayerColor(1));
      settings.player2Color = sanitized;
      if (player2ColorReadout) player2ColorReadout.textContent = sanitized;
      saveSettings();
      if (Net.isConnected() && isHostPlayer()) {
        Net.send({ type: 'setSettings', player2Color: sanitized });
      }
    };
    player2ColorInput.addEventListener('input', syncP2Color);
    player2ColorInput.addEventListener('change', syncP2Color);
  }

  // Hot seat: Ready button on the pass-controller overlay
  const hotseatReadyBtn = document.getElementById('hotseat-pass-ready');
  if (hotseatReadyBtn) {
    hotseatReadyBtn.addEventListener('click', () => {
      hideHotseatPassOverlay();
    });
  }

  function showHotseatPassOverlay(playerIdx) {
    const overlay = document.getElementById('hotseat-pass-overlay');
    const nameEl = document.getElementById('hotseat-pass-name');
    if (!overlay) return;
    hotseatPassPending = true;
    if (nameEl) {
      nameEl.textContent = playerNames[playerIdx] || `Player ${playerIdx + 1}`;
      const color = playerColors[playerIdx];
      if (color) nameEl.style.color = color;
    }
    overlay.style.display = 'flex';
  }

  function hideHotseatPassOverlay() {
    const overlay = document.getElementById('hotseat-pass-overlay');
    hotseatPassPending = false;
    if (overlay) overlay.style.display = 'none';
    updateInputPanel();
    updateHUD();
  }

  const playerColorInput = document.getElementById('player-color');
  if (playerColorInput) {
    const syncColorInput = () => {
      myColor = getSelectedPlayerColor();
      playerColors[myPlayer > 0 ? myPlayer - 1 : 0] = myColor;
      updatePlayerColorControl();
      saveSettings();
    };
    playerColorInput.addEventListener('input', syncColorInput);
    playerColorInput.addEventListener('change', syncColorInput);
  }

  // ─── Network message handlers ─────────────────────────────────────────────

  function canAutoReconnect() {
    return !suppressReconnect &&
      !!sessionToken &&
      (myPlayer > 0 || isSpectator()) &&
      gameState !== 'title' &&
      gameState !== 'setup';
  }

  function applyRoundSnapshot(msg, { hydrateTransientState = false } = {}) {
    syncHostPlayerFromMessage(msg);
    syncSpectatorsFromMessage(msg);
    citySeed = msg.citySeed;
    gorillas = msg.gorillas;
    wind = msg.wind;
    currentPlayer = msg.currentPlayer;
    scores = Array.isArray(msg.scores) ? msg.scores.slice() : buildDefaultScores(2);
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) playerNames = msg.playerNames.slice();
    if (Array.isArray(msg.playerColors) && msg.playerColors.length) {
      playerColors = msg.playerColors.map((color, idx) => sanitizePlayerColor(color, getDefaultPlayerColor(idx)));
      if (myPlayer > 0) myColor = playerColors[myPlayer - 1] || myColor;
    }
    if (myPlayer > 0 && Array.isArray(playerNames) && playerNames[myPlayer - 1]) {
      myName = playerNames[myPlayer - 1];
      setControlValues(PLAYER_NAME_INPUT_IDS, myName);
    }
    if (Array.isArray(msg.playerTeams)) playerTeams = msg.playerTeams.slice();
    scoreMode = msg.scoreMode || 'individual';
    teamScores = Array.isArray(msg.teamScores) ? msg.teamScores.slice() : null;
    roundBiome = msg.biome || 'city';
    roundWeather = msg.weather || 'clear';
    roundTimeOfDay = msg.timeOfDay || 'day';
    resetCinematicZoom();
    turnStartedAt = performance.now();
    activeTaunts = [null, null, null, null];
    if (victoryDanceTimer) { clearInterval(victoryDanceTimer); victoryDanceTimer = null; stopVictorySound(); }
    for (const k of Object.keys(flinchTimers)) { clearTimeout(flinchTimers[k]); delete flinchTimers[k]; }
    for (const k of Object.keys(missedTimers)) { clearTimeout(missedTimers[k]); delete missedTimers[k]; }
    for (const k of Object.keys(phewTimers)) { clearTimeout(phewTimers[k]); delete phewTimers[k]; }
    for (const k of Object.keys(frustratedTimers)) { clearTimeout(frustratedTimers[k]); delete frustratedTimers[k]; }
    for (const k of Object.keys(boredTimers)) { clearTimeout(boredTimers[k]); delete boredTimers[k]; }
    setSunEmote('idle', 0);
    sunPersistentEmote = 'idle';
    goldenGorillaActive = false;
    goldenGorillaPos = null;
    goldenGorillaThrowAnim = 0;
    sunSwearVisible = false;
    roundNumber = msg.roundNumber || 1;
    maxVelocity = msg.maxVelocity || 200;
    activeBananaType = (msg.banana && msg.banana.type) || msg.bananaType || 'standard';
    if (Array.isArray(msg.turretCharges)) {
      for (let i = 0; i < 4; i++) turretCharges[i] = msg.turretCharges[i] != null ? msg.turretCharges[i] : turretCharges[i];
    }
    turrets = hydrateTransientState && Array.isArray(msg.turrets)
      ? msg.turrets.map(t => ({
          id: t.id,
          ownerIdx: t.ownerIdx,
          x: t.x,
          y: t.y,
          cx: t.cx,
          cy: t.cy,
          aimAngle: 0,
          barrelKick: 0,
          lastLockBeepAt: -Infinity,
          lastBurstAt: -Infinity,
          expireTurn: t.expireTurn,
        }))
      : [];
    turretTracers = [];

    if (msg.explosionRadius) settings.explosionRadius = msg.explosionRadius;
    if (msg.gravity) settings.gravityMultiplier = msg.gravity;
    if (msg.shakeIntensity) settings.shakeIntensity = msg.shakeIntensity;
    if (msg.trailStyle) settings.trailStyle = msg.trailStyle;
    if (msg.crtOverlay !== undefined) settings.crtOverlay = msg.crtOverlay;
    if (msg.turnTimer !== undefined) settings.turnTimer = msg.turnTimer;
    if (msg.mode) settings.gameMode = msg.mode;
    if (msg.mapSize) settings.mapSize = msg.mapSize;

    const mapCfg = MAP_SIZES[msg.mapSize] || MAP_SIZES.normal;
    setLogicalSize(mapCfg.w, mapCfg.h);

    applyLocalVisualSettingsFromControls();

    buildings = generateCity(citySeed, msg.mapSize || 'normal', roundBiome);
    carvedExplosions = hydrateTransientState && Array.isArray(msg.explosions)
      ? msg.explosions.map(exp => ({ x: exp.x, y: exp.y, radius: exp.radius }))
      : [];
    collapsedBuildings = hydrateTransientState
      ? new Set(Array.isArray(msg.collapsedBuildings) ? msg.collapsedBuildings.map(index => Number(index)) : [])
      : new Set();
    buildTerrainCanvas();

    banana = hydrateTransientState && msg.banana
      ? { x: msg.banana.x, y: msg.banana.y, frame: msg.banana.frame || 0 }
      : null;
    bananaTrail = [];
    previousTrail = [];
    showBanana = !!banana;
    explosions = [];
    napalmPatches = [];
    deathChunks = [];
    clusterBananas = hydrateTransientState && Array.isArray(msg.clusterBananas)
      ? msg.clusterBananas.map(b => ({ idx: b.idx, x: b.x, y: b.y }))
      : [];
    gorillaAnim = gorillas.map(() => 0);
    gorillaVisible = hydrateTransientState && Array.isArray(msg.gorillaVisible) && msg.gorillaVisible.length === gorillas.length
      ? msg.gorillaVisible.slice()
      : gorillas.map(() => true);
    panicPlayers.clear();
    slowmoActive = false;

    initTwinkles();
    generateStars();

    Lighting.setAmbient(roundTimeOfDay, roundWeather, roundBiome);
    Particles.configureForRound(roundBiome, roundWeather, roundTimeOfDay);
    Particles.setWind(wind);
    Background.configureForRound(roundBiome, roundWeather, roundTimeOfDay, citySeed);
    // Keep the skyline hidden in open gaps so the playfield stays readable,
    // but preserve backdrop detail behind building columns. The per-frame
    // terrain alpha mask above then lets actual blast holes reveal that
    // backdrop instead of flat sky.
    {
      const sorted = [...buildings].sort((a, b) => a.x - b.x);
      // Left edge to first building
      if (sorted.length && sorted[0].x > 0) {
        Background.eraseColumn(0, sorted[0].x);
      }
      // Each building column and the gap after it
      for (let i = 0; i < sorted.length; i++) {
        const b = sorted[i];
        const gapStart = b.x + b.w;
        const gapEnd = i + 1 < sorted.length ? sorted[i + 1].x : LOGICAL_W;
        if (gapEnd > gapStart) Background.eraseColumn(gapStart, gapEnd - gapStart);
      }
    }
    startWeatherAudio(roundWeather);
  }

  function applyStateSync(msg) {
    applyRoundSnapshot(msg, { hydrateTransientState: true });
    stopTurnTimerDisplay();
    stopVictoryMusic();

    if (msg.state === 'matchOver' && msg.matchOver) {
      stopBGMusic();
      stopWeatherAudio();
      startVictoryMusic();
      if (Array.isArray(msg.matchOver.finalScores)) scores = msg.matchOver.finalScores.slice();
      if (Array.isArray(msg.matchOver.playerNames) && msg.matchOver.playerNames.length) playerNames = msg.matchOver.playerNames.slice();
      if (Array.isArray(msg.matchOver.playerColors) && msg.matchOver.playerColors.length) {
        playerColors = msg.matchOver.playerColors.map((color, idx) => sanitizePlayerColor(color, getDefaultPlayerColor(idx)));
      }
      if (Array.isArray(msg.matchOver.playerTeams)) playerTeams = msg.matchOver.playerTeams.slice();
      scoreMode = msg.matchOver.scoreMode || scoreMode;
      teamScores = Array.isArray(msg.matchOver.teamScores) ? msg.matchOver.teamScores.slice() : teamScores;
      syncHostPlayerFromMessage(msg.matchOver);
      switchToMatchOver(msg.matchOver.winner, msg.matchOver.finalScores, msg.matchOver.stats);
      return;
    }

    switchToPlaying();
    applyPauseState(msg);
    if (!serverPaused && msg.state === 'playing' && !msg.banana && Number(msg.turnRemainingMs) > 0) {
      // Compensate for network latency using the server's timestamp
      const latencyMs = (typeof msg.serverTimeMs === 'number') ? Math.max(0, Date.now() - msg.serverTimeMs) : 0;
      const adjustedMs = Math.max(0, Number(msg.turnRemainingMs) - latencyMs);
      startTurnTimerDisplay(Math.max(1, Math.ceil(adjustedMs / 1000)));
    }
  }

  Net.on('_connected', () => {
    // Clear any pending reconnect timer — we made it
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    suppressReconnect = false;

    if (myPlayer > 0 && gameState !== 'title' && gameState !== 'setup') {
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
      shakeIntensity: getControlValue(SHAKE_SELECT_IDS, settings.shakeIntensity),
      trailStyle: getControlValue(TRAIL_SELECT_IDS, settings.trailStyle),
      crtOverlay: getControlValue(CRT_SELECT_IDS, String(settings.crtOverlay)) === 'true',
      player2Name: settings.player2Name,
      player2Color: settings.player2Color,
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (!canAutoReconnect()) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      if (!canAutoReconnect()) return;
      Net.connect(myName, sessionToken, myColor, clientRole);
    }, 3000);
  }

  Net.on('_disconnected', () => {
    if (canAutoReconnect()) {
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
    syncHostPlayerFromMessage(msg);
    syncSpectatorsFromMessage(msg);
    if (gameState !== 'setup') switchToWaiting();
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) {
      playerNames = msg.playerNames.slice();
    }
    if (Array.isArray(msg.playerColors) && msg.playerColors.length) {
      playerColors = msg.playerColors.map((color, idx) => sanitizePlayerColor(color, getDefaultPlayerColor(idx)));
    }
    if (msg.mode) settings.gameMode = msg.mode;
    updateWaitingStatus(msg);
    if (gameState === 'setup') {
      updateSetupPresentation(isJoining);
      updatePlayerColorControl();
    }
  });

  Net.on('assigned', (msg) => {
    clientRole = 'player';
    mySpectatorId = null;
    myPlayer = msg.player;
    syncHostPlayerFromMessage(msg);
    syncSpectatorsFromMessage(msg);
    if (msg.token) {
      sessionToken = msg.token;
      try { sessionStorage.setItem('mm_token', sessionToken); } catch(e) {}
    }
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) playerNames = msg.playerNames.slice();
    if (Array.isArray(msg.playerColors) && msg.playerColors.length) {
      playerColors = msg.playerColors.map((color, idx) => sanitizePlayerColor(color, getDefaultPlayerColor(idx)));
      myColor = playerColors[myPlayer - 1] || myColor;
    }
    if (Array.isArray(msg.playerNames) && msg.playerNames[myPlayer - 1]) {
      myName = msg.playerNames[myPlayer - 1];
      setControlValues(PLAYER_NAME_INPUT_IDS, myName);
    }
    if (Array.isArray(msg.playerTeams)) playerTeams = msg.playerTeams.slice();
    if (msg.scoreMode) scoreMode = msg.scoreMode;
    teamScores = Array.isArray(msg.teamScores) ? msg.teamScores.slice() : null;
    try {
      sessionStorage.setItem('mm_player', String(myPlayer));
    } catch (e) {}
    persistSessionIdentity();
    document.getElementById('disconnect-screen').classList.remove('active');
    updateMatchOverActions();
    updateSetupPresentation(isJoining);
    updatePlayerColorControl();
    updateSpectatorUI();
  });

  Net.on('spectatorAssigned', (msg) => {
    clientRole = 'spectator';
    pendingJoinRole = 'spectator';
    myPlayer = 0;
    mySpectatorId = msg.spectatorId || null;
    syncHostPlayerFromMessage(msg);
    syncSpectatorsFromMessage(msg);
    if (msg.token) {
      sessionToken = msg.token;
      try { sessionStorage.setItem('mm_token', sessionToken); } catch(e) {}
    }
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) playerNames = msg.playerNames.slice();
    if (Array.isArray(msg.playerColors) && msg.playerColors.length) {
      playerColors = msg.playerColors.map((color, idx) => sanitizePlayerColor(color, getDefaultPlayerColor(idx)));
    }
    if (Array.isArray(msg.playerTeams)) playerTeams = msg.playerTeams.slice();
    if (msg.scoreMode) scoreMode = msg.scoreMode;
    teamScores = Array.isArray(msg.teamScores) ? msg.teamScores.slice() : null;
    if (typeof msg.name === 'string' && msg.name) {
      myName = msg.name;
      setControlValues(PLAYER_NAME_INPUT_IDS, myName);
    }
    try {
      sessionStorage.setItem('mm_player', '0');
      sessionStorage.setItem('mm_role', 'spectator');
    } catch (e) {}
    persistSessionIdentity();
    document.getElementById('disconnect-screen').classList.remove('active');
    updateMatchOverActions();
    updateSetupPresentation(isJoining);
    updatePlayerColorControl();
    updateSpectatorUI();
  });

  Net.on('roundStart', (msg) => {
    applyRoundSnapshot(msg);
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

  Net.on('stateSync', (msg) => {
    applyStateSync(msg);
  });

  Net.on('spectators', (msg) => {
    syncSpectatorsFromMessage(msg);
  });

  Net.on('challengeQueue', (msg) => {
    syncSpectatorsFromMessage(msg);
  });

  Net.on('challengeQueued', (msg) => {
    appendChatMessage('System', `Queued for ${msg.targetName || `Player ${msg.targetPlayer}`}.`, -1);
  });

  Net.on('challengeResolved', (msg) => {
    appendChatMessage('System', `${msg.challengerName} takes ${msg.playerName}'s seat.`, -1);
  });

  Net.on('pauseState', (msg) => {
    applyPauseState(msg);
    if (!msg.paused && Number(msg.turnRemainingMs) > 0 && !banana && clusterBananas.length === 0) {
      const latencyMs = (typeof msg.serverTimeMs === 'number') ? Math.max(0, Date.now() - msg.serverTimeMs) : 0;
      const adjustedMs = Math.max(0, Number(msg.turnRemainingMs) - latencyMs);
      startTurnTimerDisplay(Math.max(1, Math.ceil(adjustedMs / 1000)));
    }
  });

  Net.on('turn', (msg) => {
    const previousPlayer = currentPlayer;
    currentPlayer = msg.currentPlayer;
    shotPending = false;
    showBanana = false;
    banana = null;
    clusterBananas = [];
    previousTrail = [...bananaTrail];
    bananaTrail = [];
    Lighting.clearLights();
    gorillaAnim = gorillaAnim.map(() => 0);
    panicPlayers.clear();
    resetCinematicZoom();
    turnStartedAt = performance.now();
    // Restore persistent anger — clears transient emotes (watching, worried, etc.)
    if (sunPersistentEmote !== 'idle') setSunEmote(sunPersistentEmote, 0);
    // Clear any stale bored reaction when the turn changes
    for (const k of Object.keys(boredTimers)) {
      clearTimeout(boredTimers[k]); delete boredTimers[k];
    }
    updateHUD();

    // Hot seat: when control passes between local players, hide inputs behind
    // a pass-the-controller overlay so the next player can't see prior angle/velocity.
    // Lock input immediately, but defer the visual overlay so the previous
    // shot's result (explosion, score popup) is visible first.
    if (settings.gameMode === 'hotseat' && currentPlayer !== hotseatLastShownPlayer && currentPlayer >= 1) {
      const nextPlayer = currentPlayer;
      hotseatLastShownPlayer = nextPlayer;
      const isFirstTurnOfMatch = previousPlayer === 0 || previousPlayer === nextPlayer;
      // Lock input panel right away (prevents the next player from peeking
      // at the prior player's settings) and reflect that in the HUD.
      hotseatPassPending = true;
      const overlayDelay = isFirstTurnOfMatch ? 0 : 1800;
      setTimeout(() => {
        // Skip if state changed (match ended, returned to setup, etc.)
        if (gameState !== 'playing') return;
        if (currentPlayer !== nextPlayer) return;
        showHotseatPassOverlay(nextPlayer - 1);
      }, overlayDelay);
    }

    // Flash the turn indicator when it becomes your turn
    if (myPlayer === currentPlayer) {
      const el = document.getElementById('hud-turn');
      el.classList.remove('turn-notify');
      void el.offsetWidth; // force reflow to restart animation
      el.classList.add('turn-notify');
      setTimeout(() => el.classList.remove('turn-notify'), 900);
    }

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
          o.connect(g).connect(getSfxDestination(actx));
          o.start(t + i * 0.1); o.stop(t + i * 0.1 + 0.15);
        });
      }
    } catch (e) {}

    if (settings.turnTimer > 0) {
      startTurnTimerDisplay(msg.turnTimer || settings.turnTimer);
    }
  });

  Net.on('goldenGorillaSpawn', (msg) => {
    goldenGorillaActive = true;
    goldenGorillaPos = { x: msg.x, y: msg.y };
    goldenGorillaThrowAnim = 0;
    goldenGorillaSpawnTime = performance.now();
    sunSwearVisible = false;
    setSunEmote('idle', 0);
    startShake();
    Lighting.triggerExplosionFlash(false);
  });

  Net.on('goldenGorillaDespawn', () => {
    goldenGorillaActive = false;
    goldenGorillaPos = null;
    goldenGorillaThrowAnim = 0;
  });

  Net.on('goldenGorillaAttacking', () => {
    // GG is winding up — nothing visual needed beyond throwAnim per banana
  });

  Net.on('throwAnim', (msg) => {
    if (msg.bananaType) activeBananaType = msg.bananaType;
    stopTurnTimerDisplay();

    if (msg.isSunAttack) {
      if (msg.isGoldenGorilla && goldenGorillaActive) {
        // Animate the golden gorilla throwing
        const side = msg.goldenGorillaThrowSide || 1;
        goldenGorillaThrowAnim = side > 0 ? 2 : 1;
        playThrowSound();
        // Swear bubble — same angry symbols as the sun gets
        setSunEmote('attacking');
        if (goldenGorillaThrowTimer) clearTimeout(goldenGorillaThrowTimer);
        goldenGorillaThrowTimer = setTimeout(() => {
          goldenGorillaThrowAnim = 0;
          goldenGorillaThrowTimer = null;
        }, 500);
      }
      return;
    }

    const idx = msg.player - 1;
    // Own player already heard the throw sound immediately in fireShot()
    if (msg.player !== myPlayer) playThrowSound();
    setSunEmote('watching', 0);

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
    if (bananaTrail.length > 200) bananaTrail.shift();

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

  Net.on('sunAngry', (msg) => {
    const level = msg.angerLevel;
    if (level >= 3)      setSunEmote('furious', 0);
    else if (level >= 2) setSunEmote('angry', 0);
    else if (level >= 1) setSunEmote('annoyed', 0);
    // level 0 = first hit, just show 'hit' briefly (already sent via sunHit)
  });

  Net.on('sunPunish', () => {
    // Sun is about to retaliate — shake the screen as a warning
    startShake();
    Lighting.triggerExplosionFlash(false);
  });

  Net.on('sunAttacking', () => {
    setSunEmote('attacking', 0);
  });

  Net.on('meteor', (msg) => {
    // Flash warning at the impact site before explosion arrives
    Lighting.addExplosionLight(msg.x, 0, msg.radius * 2);
    Particles.burstSparks(msg.x, 0, 12);
    startShake();
  });

  Net.on('panic', (msg) => {
    const gi = msg.player - 1;
    panicPlayers.add(gi);
    reactionStart[gi] = performance.now();
    if (!(gi === myPlayer - 1 && (performance.now() - lastLocalPicnicAt) < 500)) {
      playMonkeyChatter(false);
    }
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
      lastLockBeepAt: -Infinity,
      lastBurstAt: -Infinity,
      expireTurn: msg.expireTurn,
    });
    playTurretDeploySound();
    startShake();
  });

  Net.on('turretFire', (msg) => {
    const t = turrets.find(x => x.id === msg.id);
    if (!t) return;
    const now = performance.now();
    t.aimAngle = Math.atan2(msg.ty - t.cy, msg.tx - t.cx);
    t.barrelKick = -2;
    // Fire the lock beep only on the first shot of each engagement (false → true edge).
    // A 400ms silence resets the engaging flag so the next banana triggers a fresh beep.
    if (!t.isEngaging) {
      t.isEngaging = true;
      playTurretLockSound();
    }
    if (t.engageResetTimer) clearTimeout(t.engageResetTimer);
    t.engageResetTimer = setTimeout(() => { t.isEngaging = false; t.engageResetTimer = null; }, 400);
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
    // One burst sound per engagement: the server fires a tracer every ~6 ticks
    // while a banana is in range, which is way too many "brrap"s. Suppress
    // repeats until the turret has been quiet long enough that the next
    // tracer reads as a fresh shot.
    if ((now - (t.lastBurstAt || -Infinity)) > 400) {
      t.lastBurstAt = now;
      playTurretBurst();
    }
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
    spawnDeathChunks(msg.x, msg.y, gi);
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
      applyExplosionDamage(pt.x, pt.y, pt.radius);
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
    applyExplosionDamage(msg.x, msg.y, msg.radius);

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
    if (Array.isArray(msg.playerColors) && msg.playerColors.length) {
      playerColors = msg.playerColors.map((color, idx) => sanitizePlayerColor(color, getDefaultPlayerColor(idx)));
    }
    if (Array.isArray(msg.playerTeams)) playerTeams = msg.playerTeams.slice();
    scoreMode = msg.scoreMode || scoreMode;
    teamScores = Array.isArray(msg.teamScores) ? msg.teamScores.slice() : null;

    playGorillaHitSound();
    startShake();
    // Bright flash for match-winning kill
    Lighting.triggerExplosionFlash(!!msg.slowmo);

    const winnerIdx = msg.winner - 1;
    startVictoryDance(winnerIdx, !!msg.slowmo); // skip beep on match-win: music covers it

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
    endCinematicZoom(0);
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
    syncHostPlayerFromMessage(msg);
    syncSpectatorsFromMessage(msg);
    stopVictorySound();
    stopTurnTimerDisplay();
    stopBGMusic();
    stopWeatherAudio();
    startVictoryMusic();
    if (Array.isArray(msg.finalScores)) scores = msg.finalScores.slice();
    if (Array.isArray(msg.playerNames) && msg.playerNames.length) playerNames = msg.playerNames.slice();
    if (Array.isArray(msg.playerColors) && msg.playerColors.length) {
      playerColors = msg.playerColors.map((color, idx) => sanitizePlayerColor(color, getDefaultPlayerColor(idx)));
    }
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
    if (isSpectator()) switchToWaiting();
    else switchToSetup(false);
  });

  Net.on('effectEvent', (msg) => {
    Background.handleEffectEvent(msg);
  });

  Net.on('matchCleared', () => {
    stopBGMusic();
    stopVictoryMusic();
    stopWeatherAudio();
    disconnectToTitle();
  });

  Net.on('opponentDisconnected', (msg) => {
    if (!isSpectator() && (gameState === 'playing' || gameState === 'paused')) {
      const name = typeof msg?.playerName === 'string' && msg.playerName ? msg.playerName : 'A player';
      setDisconnectCopy(`${name} disconnected. Waiting 15 seconds for reconnect...`);
      document.getElementById('disconnect-screen').classList.add('active');
    }
  });

  Net.on('opponentReconnected', () => {
    setDisconnectCopy('Waiting 15 seconds for reconnect...');
    document.getElementById('disconnect-screen').classList.remove('active');
  });

  Net.on('opponentTimedOut', (msg) => {
    const name = typeof msg?.playerName === 'string' && msg.playerName ? msg.playerName : 'A player';
    setDisconnectCopy(`${name} timed out. Returning to the lobby...`);
    document.getElementById('disconnect-screen').classList.remove('active');
    switchToWaiting();
  });

  Net.on('opponentLeft', (msg) => {
    const name = typeof msg?.playerName === 'string' && msg.playerName ? msg.playerName : 'A player';
    document.getElementById('disconnect-screen').classList.remove('active');
    appendChatMessage('System', `${name} left the match. Returning to the lobby.`, -1);
    switchToWaiting();
  });

  Net.on('leftMatch', () => {
    suppressReconnect = true;
    Net.disconnect();
    switchToTitle();
  });

  Net.on('settingsSync', (msg) => {
    if (msg.settings) {
      Object.assign(settings, msg.settings);
      applyCurrentSettingsToSetupUI();
      applyLocalVisualSettingsFromControls();
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

  function bindMirroredValueControls(controlIds, { events = ['change'], onChange = null } = {}) {
    const controls = asIdList(controlIds)
      .map(id => document.getElementById(id))
      .filter(Boolean);
    if (!controls.length) return;

    const sync = (source) => {
      for (const control of controls) {
        if (control !== source) control.value = source.value;
      }
      if (typeof onChange === 'function') onChange(source.value, source);
    };

    for (const control of controls) {
      for (const eventName of events) {
        control.addEventListener(eventName, () => sync(control));
      }
    }
  }

  bindMirroredValueControls(PLAYER_NAME_INPUT_IDS, {
    events: ['input', 'change'],
    onChange: () => {
      myName = getPlayerNameInputValue();
      saveSettings();
    },
  });

  bindMirroredValueControls(MUSIC_TOGGLE_CONTROL_IDS, {
    onChange: () => {
      saveSettings();
      applyMusicSetting();
    },
  });

  bindMirroredValueControls(SFX_TOGGLE_CONTROL_IDS, {
    onChange: () => {
      saveSettings();
      applySfxVolumeSetting();
    },
  });

  bindMirroredValueControls(SPECTATOR_CHAT_MUTE_IDS, {
    onChange: () => {
      syncSetupSelectionsToState();
      saveSettings();
    },
  });

  bindMirroredValueControls(CRT_SELECT_IDS, {
    onChange: () => {
      syncSetupSelectionsToState();
      applyCRTSetting();
      saveSettings();
    },
  });

  bindMirroredValueControls(SHAKE_SELECT_IDS, {
    onChange: () => {
      syncSetupSelectionsToState();
      saveSettings();
    },
  });

  bindMirroredValueControls(TRAIL_SELECT_IDS, {
    onChange: () => {
      syncSetupSelectionsToState();
      saveSettings();
    },
  });

  bindMirroredValueControls(EFFECTS_QUALITY_CONTROL_IDS, {
    onChange: () => {
      applyEffectsQualitySetting();
      saveSettings();
    },
  });

  const musicHudEl = document.getElementById('hud-music');
  if (musicHudEl) {
    musicHudEl.addEventListener('click', () => {
      setControlValues(MUSIC_TOGGLE_CONTROL_IDS, isMusicEnabled() ? 'false' : 'true');
      applyMusicSetting();
      saveSettings();
    });
  }

  function bindVolumeSlider(controlIds, readoutIds, applyFn) {
    const controls = asIdList(controlIds)
      .map(id => document.getElementById(id))
      .filter(Boolean);
    if (!controls.length) return;
    const sync = () => {
      updateAudioVolumeControls();
      applyFn();
      saveSettings();
    };
    for (const control of controls) {
      control.addEventListener('input', () => {
        for (const other of controls) {
          if (other !== control) other.value = control.value;
        }
        setVolumeControl(controlIds, readoutIds, control.value);
        sync();
      });
      control.addEventListener('change', () => {
        for (const other of controls) {
          if (other !== control) other.value = control.value;
        }
        setVolumeControl(controlIds, readoutIds, control.value);
        sync();
      });
    }
  }

  bindVolumeSlider(MUSIC_VOLUME_CONTROL_IDS, MUSIC_VOLUME_READOUT_IDS, applyMusicVolumeSetting);
  bindVolumeSlider(SFX_VOLUME_CONTROL_IDS, SFX_VOLUME_READOUT_IDS, applySfxVolumeSetting);

  const pauseResumeBtn = document.getElementById('pause-resume-btn');
  if (pauseResumeBtn) {
    pauseResumeBtn.addEventListener('click', () => {
      commitPauseNameChange();
      requestPauseState(false);
    });
  }

  const pauseExitBtn = document.getElementById('pause-exit-btn');
  if (pauseExitBtn) {
    pauseExitBtn.addEventListener('click', () => {
      leaveMatchToTitle();
    });
  }

  const pauseApplyNameBtn = document.getElementById('pause-apply-name-btn');
  if (pauseApplyNameBtn) {
    pauseApplyNameBtn.addEventListener('click', () => {
      commitPauseNameChange();
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
    shotPending = false;
    console.warn('Server error:', message);
    showErrorToast(message);
    if (gameState === 'waiting') {
      const statusEl = document.getElementById('waiting-status');
      if (statusEl) statusEl.textContent = message;
    } else if (gameState === 'playing') {
      updateInputPanel();
    }
  });

  function showErrorToast(message) {
    const toast = document.getElementById('error-toast');
    if (!toast) { appendChatMessage('System', message, -1); return; }
    toast.textContent = message;
    toast.classList.add('visible');
    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.classList.remove('visible');
      toast._hideTimer = null;
    }, 5000);
  }

  Net.on('chat', (msg) => {
    const from = typeof msg.from === 'string' ? msg.from : '';
    const text = typeof msg.text === 'string' ? msg.text : '';
    const role = msg.role === 'spectator' ? 'spectator' : 'player';
    if (!from || !text) return;
    if (role === 'spectator' && getControlValue(SPECTATOR_CHAT_MUTE_IDS, 'false') === 'true') return;
    // Use playerNames to pick the colour class; fall back to -1 (system style)
    const idx = typeof msg.player === 'number' && msg.player > 0 ? msg.player - 1 : playerNames.indexOf(from);
    appendChatMessage(from, text, idx, role);
  });

  // ─── Fire shot helper ──────────────────────────────────────────────────────
  function fireShot() {
    if (isSpectator()) return;
    if (gameState !== 'playing') return;
    // In hot seat, the host fires for whichever local player's turn it is.
    const isHotseat = settings.gameMode === 'hotseat';
    if (!isHotseat && myPlayer !== currentPlayer) return;
    if (isHotseat && hotseatPassPending) return;
    if (showBanana) return;
    if (shotPending) return;
    const angle = Math.max(0, Math.min(180, parseInt(document.getElementById('input-angle').value) || 0));
    const velocity = Math.max(0, Math.min(maxVelocity, parseInt(document.getElementById('input-velocity').value) || 0));
    const turretRadio = document.getElementById('ammo-turret');
    const ammoType = (turretRadio && turretRadio.checked && !turretRadio.disabled) ? 'turret' : 'banana';
    shotPending = true;
    Net.send({ type: 'fire', angle, velocity, ammoType });
    playThrowSound(); // play immediately — don't wait for server round-trip
    playUIConfirm();
    blurFocusedInput();
    updateInputPanel();
  }

  document.getElementById('fire-btn').addEventListener('click', fireShot);
  document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);

  enableClickClearOnNumericInput(
    document.getElementById('input-angle'),
    () => Math.max(0, Math.min(180, parseInt(document.getElementById('input-angle').dataset.restoreValue || document.getElementById('input-angle').defaultValue, 10) || 45))
  );
  enableClickClearOnNumericInput(
    document.getElementById('input-velocity'),
    () => Math.max(0, Math.min(maxVelocity, parseInt(document.getElementById('input-velocity').dataset.restoreValue || document.getElementById('input-velocity').defaultValue, 10) || 50))
  );

  // ─── Chat box click-to-type ───────────────────────────────────────────────
  document.getElementById('chat-box').addEventListener('click', (e) => {
    if (e.target.closest('#chat-send-btn')) return;
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
    o.connect(g).connect(getSfxDestination(ctx));
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
      o.connect(g).connect(getSfxDestination(ctx));
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
      o.connect(g).connect(getSfxDestination(ctx)); o.start(t); o.stop(t + 0.65);
    },
    drum() {
      const ctx = tauntAudio(); const t = ctx.currentTime;
      for (let i = 0; i < 6; i++) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(90, t + i*0.08);
        o.frequency.exponentialRampToValueAtTime(40, t + i*0.08 + 0.08);
        g.gain.setValueAtTime(0.35, t + i*0.08); g.gain.exponentialRampToValueAtTime(0.001, t + i*0.08 + 0.1);
        o.connect(g).connect(getSfxDestination(ctx)); o.start(t + i*0.08); o.stop(t + i*0.08 + 0.12);
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
      o.connect(g).connect(getSfxDestination(ctx)); o.start(t); o.stop(t + 0.45);
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
      src.connect(f).connect(g).connect(getSfxDestination(ctx));
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
    if (gameState !== 'playing') return;
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
  let lastLocalPicnicAt = -Infinity;
  const picnicBtn = document.getElementById('picnic-btn');
  if (picnicBtn) {
    picnicBtn.addEventListener('click', () => {
      if (gameState !== 'playing') return;
      const now = performance.now();
      if (now < picnicCooldownUntil) return;
      if (myPlayer < 1) return;
      picnicCooldownUntil = now + 3000;
      picnicBtn.classList.add('cooling');
      setTimeout(() => picnicBtn.classList.remove('cooling'), 3000);
      Net.send({ type: 'picnic' });
      lastLocalPicnicAt = performance.now();
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
          myName = getPlayerNameInputValue();
          setControlValues(PLAYER_NAME_INPUT_IDS, myName);
          myColor = getSelectedPlayerColor();
          saveSettings();
          playUIConfirm();
          if (Net.isConnected()) {
            sendPlayerProfile();
            if (isHostPlayer()) {
              sendAllSettings();
              switchToWaiting();
            } else {
              switchToWaiting();
            }
          } else {
            clientRole = pendingJoinRole;
            persistSessionIdentity();
            Net.connect(myName, sessionToken, myColor, pendingJoinRole);
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

        // Keyboard help overlay
        if (e.key === '?' && !isInput) {
          e.preventDefault();
          const overlay = document.getElementById('keys-overlay');
          if (overlay) overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
          break;
        }

        if ((e.key === 'm' || e.key === 'M') && !isInput) {
          e.preventDefault();
          setControlValues(MUSIC_TOGGLE_CONTROL_IDS, isMusicEnabled() ? 'false' : 'true');
          applyMusicSetting();
          saveSettings();
        }

        if ((e.key === 't' || e.key === 'T') && !isInput) {
          e.preventDefault();
          openChatInput();
        }

        if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
          // Close help overlay first if open
          const overlay = document.getElementById('keys-overlay');
          if (overlay && overlay.style.display !== 'none') {
            overlay.style.display = 'none';
            e.preventDefault();
            break;
          }
          if (!isInput || e.key === 'Escape') {
            e.preventDefault();
            requestPauseState(true);
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
        if (activeEl && activeEl.id === 'pause-player-name' && e.key === 'Enter') {
          e.preventDefault();
          commitPauseNameChange();
          break;
        }
        if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          commitPauseNameChange();
          requestPauseState(false);
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
          disconnectToTitle();
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
      disconnectToTitle();
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
  loadSettings();
  syncSetupSelectionsToState();
  updatePlayerColorControl();
  updateAudioVolumeControls();

  // Init visual effects systems
  Lighting.init(LOGICAL_W, LOGICAL_H);
  Particles.init(LOGICAL_W, LOGICAL_H);
  Background.init(LOGICAL_W, LOGICAL_H);

  applyEffectsQualitySetting();

  applyCRTSetting();
  applyMusicVolumeSetting();
  applySfxVolumeSetting();
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
      o.connect(g).connect(getSfxDestination(ctx));
      o.start(t); o.stop(t + 0.4);
    } catch (e) {}
  }

  // Picnic/panic sting
  function playMonkeyChatter(loud) {
    playAudioClip(panicSfx, loud ? 0.6 : 0.54);
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
      o.connect(g).connect(getSfxDestination(ctx));
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
