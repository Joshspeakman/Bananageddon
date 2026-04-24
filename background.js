// Bananageddon — Background events system (background.js)
// Manages parallax backgrounds, scheduled ambient events (lightning, tornadoes,
// meteors, UFOs, aurora, whales, eclipses, etc.), and per-biome-per-weather sky.

const Background = (function () {
  'use strict';

  let W = 640, H = 480;
  let quality = 2;

  // ─── Active background events ───────────────────────────────────────────
  let activeEvents = [];
  let eventQueue = []; // scheduled events from server
  let roundStartTime = 0;

  // ─── Seeded RNG for deterministic effects ───────────────────────────────
  let bgRng = null;
  let bgSeed = 0;

  // ─── Background layers (pre-rendered offscreen) ─────────────────────────
  let bgCanvas = null;
  let bgCtx = null;
  let currentBiome = 'city';
  let currentWeather = 'clear';
  let currentTime = 'day';

  // ─── Star field (shared with main game but enhanced) ────────────────────
  let bgStars = [];

  // ─── Dawn/Dusk sky gradient data ────────────────────────────────────────
  const SKY_GRADIENTS = {
    dawn: [
      { stop: 0, color: '#1a1a3e' },
      { stop: 0.4, color: '#4a2a6e' },
      { stop: 0.7, color: '#cc6644' },
      { stop: 1.0, color: '#ffaa55' },
    ],
    day: null, // solid color from biome
    dusk: [
      { stop: 0, color: '#1a1040' },
      { stop: 0.3, color: '#6a2060' },
      { stop: 0.6, color: '#cc4422' },
      { stop: 1.0, color: '#ff8833' },
    ],
    night: null, // solid dark + stars
  };

  const STAGE_PALETTES = {
    city: {
      day: ['#1D3AA6', '#3554C8', '#5A7BFF', '#9DB8FF'],
      dawn: ['#241B5F', '#51317F', '#AD563D', '#F0A35B'],
      dusk: ['#171C5A', '#4B2976', '#B14848', '#F08B44'],
      night: ['#070D25', '#10183D', '#1C2F66', '#233D7E'],
      far: '#1C2A71',
      mid: '#0D163F',
      near: '#050C23',
      accent: '#FFE266',
      glow: '#92B4FF',
    },
    desert: {
      day: ['#A4551D', '#D07B2C', '#E6A455', '#F6D18B'],
      dawn: ['#3C1E19', '#78402E', '#CB7444', '#F7BE74'],
      dusk: ['#271418', '#6A2D2D', '#C45C36', '#F3A257'],
      night: ['#090B21', '#171935', '#3C2C55', '#5A4675'],
      far: '#8A4E27',
      mid: '#5A2F15',
      near: '#241306',
      accent: '#FFB756',
      glow: '#FFD38A',
    },
    arctic: {
      day: ['#2D5477', '#4F86AE', '#88C2E0', '#DDF4FF'],
      dawn: ['#192A4B', '#4A5B86', '#B88088', '#FFE9C4'],
      dusk: ['#161F47', '#49508E', '#8F668F', '#F3B780'],
      night: ['#060D24', '#122146', '#213B67', '#335382'],
      far: '#7CA8C6',
      mid: '#486989',
      near: '#203241',
      accent: '#C2FBFF',
      glow: '#EFFFFF',
    },
    jungle: {
      day: ['#0B2315', '#154623', '#2E6A2F', '#7CA84D'],
      dawn: ['#14242B', '#2E3D3A', '#9C5F41', '#E0A44E'],
      dusk: ['#101B2C', '#2A2642', '#7F3F45', '#C36B3F'],
      night: ['#040914', '#09131E', '#10291E', '#174128'],
      far: '#194423',
      mid: '#0B2410',
      near: '#040E05',
      accent: '#D8D34D',
      glow: '#9DE862',
    },
    volcanic: {
      day: ['#2A0906', '#5A1308', '#88321A', '#C4612A'],
      dawn: ['#1E0915', '#5F1B2B', '#A2372E', '#F08E42'],
      dusk: ['#14040D', '#48121E', '#922B1D', '#E26A37'],
      night: ['#040205', '#140709', '#2B0A08', '#4C1208'],
      far: '#511306',
      mid: '#250705',
      near: '#110202',
      accent: '#FF8D3A',
      glow: '#FFC16E',
    },
    moon: {
      day: ['#202638', '#4C5573', '#9CA5C0', '#DCE3F2'],
      dawn: ['#182137', '#3D496E', '#98839A', '#E5D0C2'],
      dusk: ['#11182E', '#373F67', '#786593', '#C0A6C2'],
      night: ['#02040B', '#0A1022', '#18213B', '#28365A'],
      far: '#404A6B',
      mid: '#232A45',
      near: '#0A1122',
      accent: '#D9E0FF',
      glow: '#A5B4DC',
    },
    underwater: {
      day: ['#06233A', '#0A4F73', '#0E759A', '#5FD5D8'],
      dawn: ['#071A32', '#114C65', '#2D7A7D', '#A8D1A1'],
      dusk: ['#04192C', '#0B3550', '#1C5168', '#52909A'],
      night: ['#010A16', '#051626', '#072D3A', '#0D4252'],
      far: '#0D617C',
      mid: '#054152',
      near: '#02161E',
      accent: '#99FAFF',
      glow: '#5BE0E8',
    },
    postapoc: {
      day: ['#39261C', '#6D4730', '#A06A41', '#D7A05D'],
      dawn: ['#221521', '#4C2E39', '#8D4A36', '#D48A56'],
      dusk: ['#1A111B', '#402133', '#7A3A32', '#B85D44'],
      night: ['#040609', '#111214', '#2A221F', '#44382F'],
      far: '#6A5236',
      mid: '#382918',
      near: '#161008',
      accent: '#FF9244',
      glow: '#D1A15A',
    },
    cyberpunk: {
      day: ['#10215D', '#25409E', '#465FD6', '#FF9174'],
      dawn: ['#1A1757', '#3F2E7D', '#B74F75', '#FF9872'],
      dusk: ['#120D39', '#31205E', '#934092', '#F45F74'],
      night: ['#040514', '#0C0C2C', '#25155C', '#3D1E88'],
      far: '#25155C',
      mid: '#130A31',
      near: '#050813',
      accent: '#FF5DE8',
      glow: '#54D9FF',
    },
  };

  // ─── Event type definitions ─────────────────────────────────────────────
  const EVENT_TYPES = {
    lightning: { duration: 300, draw: drawLightning, update: updateLightning },
    tornado: { duration: 40000, draw: drawTornado, update: updateTornado },
    meteor: { duration: 500, draw: drawMeteor, update: updateMeteor },
    meteorShower: { duration: 8000, draw: drawMeteorShower, update: updateMeteorShower },
    aurora: { duration: 20000, draw: drawAurora, update: updateAurora },
    ufo: { duration: 15000, draw: drawUFO, update: updateUFO },
    airplane: { duration: 12000, draw: drawAirplane, update: updateAirplane },
    birds: { duration: 12000, draw: drawBirds, update: updateBirds },
    bats: { duration: 5000, draw: drawBats, update: updateBats },
    volcanicEruption: { duration: 5000, draw: drawVolcanicEruption, update: updateVolcanicEruption },
    solarEclipse: { duration: 11000, draw: drawSolarEclipse, update: updateSolarEclipse },
    earthquake: { duration: 3000, draw: null, update: updateEarthquake },
    whale: { duration: 20000, draw: drawWhale, update: updateWhale },
    fireworks: { duration: 4000, draw: drawFireworks, update: updateFireworks },
    satellite: { duration: 18000, draw: drawSatellite, update: updateSatellite },
    comet: { duration: 30000, draw: drawComet, update: updateComet },
    dustDevil: { duration: 8000, draw: drawDustDevil, update: updateDustDevil },
    kaiju: { duration: 6000, draw: drawKaiju, update: updateKaiju },
  };

  const EVENT_TYPE_CAPS = {
    lightning: 4,
    meteor: 5,
    birds: 4,
    fireworks: 4,
    satellite: 3,
    airplane: 3,
    default: 3,
  };

  // ─── Biome event spawn tables (weight-based) ───────────────────────────
  const BIOME_EVENT_TABLES = {
    city: {
      day:   { airplane: 5, birds: 7, satellite: 1 },
      dawn:  { birds: 7, airplane: 3 },
      dusk:  { birds: 5, bats: 3, airplane: 3 },
      night: { airplane: 4, satellite: 6, meteor: 3, fireworks: 2, ufo: 2, comet: 1 },
    },
    desert: {
      day:   { birds: 3, dustDevil: 6, airplane: 1 },
      dawn:  { birds: 3, dustDevil: 3 },
      dusk:  { birds: 3, dustDevil: 4 },
      night: { meteor: 7, meteorShower: 2, ufo: 3, satellite: 4, comet: 2 },
    },
    arctic: {
      day:   { birds: 3, airplane: 1 },
      dawn:  { aurora: 2, birds: 2 },
      dusk:  { aurora: 5, meteor: 1 },
      night: { aurora: 10, meteor: 4, satellite: 3, comet: 1 },
    },
    jungle: {
      day:   { birds: 8, airplane: 1 },
      dawn:  { birds: 8, bats: 1 },
      dusk:  { bats: 5, birds: 3 },
      night: { bats: 7, meteor: 2, ufo: 1 },
    },
    volcanic: {
      day:   { volcanicEruption: 8, meteor: 1 },
      dawn:  { volcanicEruption: 7, meteor: 1 },
      dusk:  { volcanicEruption: 8, meteor: 2 },
      night: { volcanicEruption: 10, meteor: 3, comet: 1 },
    },
    moon: {
      day:   { meteor: 8, satellite: 2 },
      dawn:  { meteor: 7, satellite: 2 },
      dusk:  { meteor: 7, meteorShower: 1, satellite: 2 },
      night: { meteor: 10, meteorShower: 3, satellite: 3, comet: 3, ufo: 1 },
    },
    underwater: {
      day:   { whale: 5, satellite: 1 },
      dawn:  { whale: 4 },
      dusk:  { whale: 4, fireworks: 1 },
      night: { whale: 3, ufo: 1 },
    },
    postapoc: {
      day:   { dustDevil: 5, birds: 2, airplane: 1 },
      dawn:  { birds: 2, dustDevil: 3 },
      dusk:  { bats: 5, fireworks: 1 },
      night: { ufo: 4, kaiju: 2, meteor: 3, fireworks: 3, comet: 1 },
    },
    cyberpunk: {
      day:   { airplane: 4, ufo: 1, satellite: 1 },
      dawn:  { airplane: 3, ufo: 1 },
      dusk:  { airplane: 4, fireworks: 2, satellite: 2 },
      night: { ufo: 4, fireworks: 5, airplane: 4, satellite: 4, comet: 2 },
    },
  };

  // Storm weather adds lightning to any biome
  const WEATHER_EVENT_OVERLAY = {
    storm:     { lightning: 12, meteor: 1 },
    sandstorm: { dustDevil: 5 },
    rain:      { airplane: 1 },
    snow:      { aurora: 1 },
  };

  // ─── Initialization ─────────────────────────────────────────────────────
  function init(width, height) {
    W = width;
    H = height;
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = W;
    bgCanvas.height = H;
    bgCtx = bgCanvas.getContext('2d');
    bgCtx.imageSmoothingEnabled = false;
    activeEvents = [];
    eventQueue = [];
  }

  function resize(width, height) {
    W = width;
    H = height;
    if (bgCanvas) {
      bgCanvas.width = W;
      bgCanvas.height = H;
      bgCtx = bgCanvas.getContext('2d');
      bgCtx.imageSmoothingEnabled = false;
    }
  }

  function setQuality(q) {
    quality = q;
  }

  // ─── Configure for a new round ──────────────────────────────────────────
  function configureForRound(biome, weather, timeOfDay, seed) {
    currentBiome = biome;
    currentWeather = weather;
    currentTime = timeOfDay;
    bgSeed = seed;
    activeEvents = [];
    eventQueue = [];
    roundStartTime = performance.now();

    // Create seeded RNG for deterministic background elements
    bgRng = mulberry32(seed + 55555);

    // Generate stars for night/dawn/dusk
    bgStars = [];
    if (timeOfDay === 'night' || timeOfDay === 'dusk' || timeOfDay === 'dawn') {
      const starCount = timeOfDay === 'night' ? 150 :
                        timeOfDay === 'dusk' ? 40 : 20;
      for (let i = 0; i < starCount; i++) {
        bgStars.push({
          x: bgRng() * W,
          y: bgRng() * (H * 0.45),
          brightness: 0.3 + bgRng() * 0.7,
          twinkleSpeed: 1 + bgRng() * 3,
          phase: bgRng() * Math.PI * 2,
          size: bgRng() < 0.1 ? 2 : 1,
        });
      }
    }

    // Pre-schedule ambient events for the round
    scheduleAmbientEvents(biome, weather, timeOfDay, seed);

    // Pre-render static background
    renderStaticBackground();
  }

  // ─── Schedule ambient events ────────────────────────────────────────────
  function scheduleAmbientEvents(biome, weather, timeOfDay, seed) {
    const rng = mulberry32(seed + 33333);
    const table = BIOME_EVENT_TABLES[biome]?.[timeOfDay] || {};
    const weatherOverlay = WEATHER_EVENT_OVERLAY[weather] || {};

    // Merge tables
    const merged = { ...table, ...weatherOverlay };
    const totalWeight = Object.values(merged).reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return;

    // Schedule events over ~5 minutes (300 seconds)
    let t = 1200 + rng() * 2200; // first event after ~1.2-3.4 seconds
    const maxTime = 300000;

    while (t < maxTime) {
      // Pick event type by weight
      let roll = rng() * totalWeight;
      let eventType = null;
      for (const [type, weight] of Object.entries(merged)) {
        roll -= weight;
        if (roll <= 0) {
          eventType = type;
          break;
        }
      }
      if (!eventType) eventType = Object.keys(merged)[0];

      const def = EVENT_TYPES[eventType];
      if (def) {
        eventQueue.push({
          type: eventType,
          time: t,
          params: generateEventParams(eventType, rng),
        });
      }

      // Next event interval based on type
      const minInterval = eventType === 'lightning' ? 1800 : 3500;
      const maxInterval = eventType === 'lightning' ? 5200 : 9500;
      t += minInterval + rng() * (maxInterval - minInterval);
    }
  }

  function generateEventParams(type, rng) {
    switch (type) {
      case 'lightning':
        return { x: rng() * W, branches: 3 + Math.floor(rng() * 3), intensity: 0.8 + rng() * 0.2 };
      case 'tornado':
        return { startX: rng() < 0.5 ? -50 : W + 50, speed: 1 + rng() * 2 };
      case 'meteor':
        return { x: rng() * W, y: rng() * H * 0.2, angle: 0.5 + rng() * 1, speed: 4 + rng() * 6 };
      case 'meteorShower':
        return { count: 10 + Math.floor(rng() * 10) };
      case 'aurora':
        return { ribbons: 3 + Math.floor(rng() * 3), intensity: 0.3 + rng() * 0.3 };
      case 'ufo':
        return { startX: rng() < 0.5 ? -30 : W + 30, height: 30 + rng() * 60 };
      case 'airplane':
        return { startX: rng() < 0.5 ? -20 : W + 20, height: 20 + rng() * 50 };
      case 'birds':
        return { startX: rng() < 0.5 ? -40 : W + 40, count: 5 + Math.floor(rng() * 8), height: 40 + rng() * 80 };
      case 'bats':
        return { startX: rng() * W, count: 3 + Math.floor(rng() * 3) };
      case 'volcanicEruption':
        return { x: rng() < 0.5 ? W * 0.1 : W * 0.9, intensity: 0.5 + rng() * 0.5 };
      case 'solarEclipse':
        return {};
      case 'earthquake':
        return { intensity: 3 + rng() * 6 };
      case 'whale':
        return { startX: rng() < 0.5 ? -80 : W + 80, depth: H * 0.4 + rng() * H * 0.3 };
      case 'fireworks':
        return { x: W * 0.2 + rng() * W * 0.6, count: 2 + Math.floor(rng() * 3) };
      case 'satellite':
        return { startX: 0, startY: rng() * H * 0.2 };
      case 'comet':
        return { startX: -20, startY: rng() * H * 0.15 };
      case 'dustDevil':
        return { startX: rng() < 0.5 ? -30 : W + 30 };
      case 'kaiju':
        return { x: W * 0.3 + rng() * W * 0.4 };
      default:
        return {};
    }
  }

  // ─── Process event from server ──────────────────────────────────────────
  function handleEffectEvent(msg) {
    const def = EVENT_TYPES[msg.event];
    if (!def) return;
    spawnEvent(msg.event, msg.params || {});
  }

  function spawnEvent(type, params) {
    const def = EVENT_TYPES[type];
    if (!def) return;
    // Limit simultaneous events by type, but allow busier scenes overall.
    const sameTypeCount = activeEvents.filter(e => e.type === type).length;
    const typeCap = EVENT_TYPE_CAPS[type] || EVENT_TYPE_CAPS.default;
    if (sameTypeCount >= typeCap) return;

    activeEvents.push({
      type,
      params: { ...params },
      age: 0,
      duration: def.duration,
      progress: 0,
      data: {}, // extra state for the event
    });
  }

  // ─── Seeded PRNG (must match server) ────────────────────────────────────
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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

  function alphaColor(hexColor, alpha) {
    const rgb = hexToRgb(hexColor);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
  }

  function getStagePalette(biome) {
    return STAGE_PALETTES[biome] || STAGE_PALETTES.city;
  }

  function drawOrb(target, x, y, radius, fill, stroke, shine) {
    target.fillStyle = fill;
    target.beginPath();
    target.arc(x, y, radius, 0, Math.PI * 2);
    target.fill();
    target.strokeStyle = stroke;
    target.lineWidth = 2;
    target.stroke();
    target.fillStyle = alphaColor(shine || '#FFFFFF', 0.28);
    target.fillRect(Math.round(x - radius * 0.55), Math.round(y - radius * 0.55), Math.max(3, Math.round(radius * 0.45)), Math.max(2, Math.round(radius * 0.16)));
  }

  function fillBandRows(target, colors) {
    const rowHeight = Math.ceil(H / colors.length);
    for (let i = 0; i < colors.length; i++) {
      target.fillStyle = colors[i];
      target.fillRect(0, i * rowHeight, W, rowHeight);
    }
    target.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < H * 0.65; y += 6) {
      target.fillRect(0, y, W, 1);
    }
  }

  function drawWaveLayer(target, color, baseY, amplitude, step, seedOffset, fillToBottom) {
    const rng = mulberry32(bgSeed + seedOffset);
    target.fillStyle = color;
    target.beginPath();
    target.moveTo(0, baseY);
    for (let x = 0; x <= W + step; x += step) {
      const height = baseY + Math.sin((x + seedOffset) * 0.018) * amplitude + (rng() - 0.5) * amplitude * 0.4;
      target.lineTo(x, height);
    }
    if (fillToBottom !== false) {
      target.lineTo(W, H);
      target.lineTo(0, H);
    }
    target.closePath();
    target.fill();
  }

  function drawJaggedLayer(target, color, baseY, amplitude, step, seedOffset) {
    const rng = mulberry32(bgSeed + seedOffset);
    target.fillStyle = color;
    target.beginPath();
    target.moveTo(0, H);
    target.lineTo(0, baseY);
    for (let x = 0; x <= W + step; x += step) {
      const y = baseY - amplitude * (0.25 + rng() * 0.75);
      target.lineTo(x, y);
    }
    target.lineTo(W, H);
    target.closePath();
    target.fill();
  }

  function drawSkylineLayer(target, color, baseY, minWidth, maxWidth, minHeight, maxHeight, seedOffset, windowColor) {
    const rng = mulberry32(bgSeed + seedOffset);
    let x = -6;
    target.fillStyle = color;
    while (x < W + 8) {
      const width = minWidth + Math.floor(rng() * Math.max(1, maxWidth - minWidth + 1));
      const height = minHeight + Math.floor(rng() * Math.max(1, maxHeight - minHeight + 1));
      const y = baseY - height;
      target.fillRect(x, y, width, height);
      if (windowColor) {
        target.fillStyle = windowColor;
        for (let wy = y + 8; wy < baseY - 6; wy += 10) {
          for (let wx = x + 4; wx < x + width - 4; wx += 8) {
            if (((wx + wy + seedOffset) % 3) === 0) {
              target.fillRect(wx, wy, 2, 3);
            }
          }
        }
        target.fillStyle = color;
      }
      x += width - 2;
    }
  }

  function drawKelpLayer(target, color, count, seedOffset) {
    const rng = mulberry32(bgSeed + seedOffset);
    target.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rng() * W);
      const height = H * (0.18 + rng() * 0.2);
      const segments = 5 + Math.floor(rng() * 4);
      for (let s = 0; s < segments; s++) {
        const y = H - (height / segments) * s;
        const sway = Math.sin((s + 1) * 0.8 + x * 0.03) * 6;
        target.fillRect(x + sway, y, 3, Math.max(8, height / segments));
      }
    }
  }

  // ─── Static background rendering ───────────────────────────────────────
  function renderStaticBackground() {
    if (!bgCtx) return;
    bgCtx.clearRect(0, 0, W, H);
    const palette = getStagePalette(currentBiome);

    switch (currentBiome) {
      case 'city':
        drawSkylineLayer(bgCtx, alphaColor(palette.far, 0.85), H * 0.72, 18, 42, 28, 90, 10, alphaColor(palette.glow, 0.35));
        drawSkylineLayer(bgCtx, alphaColor(palette.mid, 0.95), H * 0.79, 26, 56, 36, 120, 30, alphaColor(palette.accent, 0.55));
        break;
      case 'desert':
        drawWaveLayer(bgCtx, alphaColor(palette.far, 0.55), H * 0.62, 18, 44, 7);
        drawJaggedLayer(bgCtx, alphaColor(palette.mid, 0.55), H * 0.72, 42, 48, 12);
        drawWaveLayer(bgCtx, alphaColor(palette.near, 0.85), H * 0.84, 10, 32, 18);
        break;
      case 'arctic':
        drawJaggedLayer(bgCtx, alphaColor(palette.far, 0.55), H * 0.64, 72, 36, 21);
        bgCtx.fillStyle = alphaColor('#FFFFFF', 0.45);
        for (let x = 14; x < W; x += 60) {
          bgCtx.fillRect(x, H * 0.39 + ((x / 12) % 12), 14, 5);
        }
        drawJaggedLayer(bgCtx, alphaColor(palette.mid, 0.78), H * 0.77, 36, 24, 29);
        break;
      case 'jungle':
        drawWaveLayer(bgCtx, alphaColor(palette.far, 0.72), H * 0.48, 16, 22, 11);
        drawWaveLayer(bgCtx, alphaColor(palette.mid, 0.88), H * 0.62, 26, 18, 15);
        drawWaveLayer(bgCtx, alphaColor(palette.near, 0.92), H * 0.84, 10, 16, 19);
        break;
      case 'volcanic':
        drawJaggedLayer(bgCtx, alphaColor(palette.far, 0.55), H * 0.68, 84, 44, 31);
        drawJaggedLayer(bgCtx, alphaColor(palette.mid, 0.8), H * 0.8, 42, 28, 36);
        bgCtx.fillStyle = alphaColor(palette.accent, 0.35);
        bgCtx.fillRect(W * 0.68, H * 0.56, 4, H * 0.18);
        bgCtx.fillRect(W * 0.72, H * 0.6, 3, H * 0.14);
        break;
      case 'moon':
        drawWaveLayer(bgCtx, alphaColor(palette.far, 0.6), H * 0.7, 10, 32, 41);
        drawWaveLayer(bgCtx, alphaColor(palette.mid, 0.85), H * 0.82, 8, 28, 46);
        bgCtx.fillStyle = alphaColor(palette.glow, 0.2);
        for (let x = 40; x < W; x += 100) {
          bgCtx.beginPath();
          bgCtx.arc(x, H * 0.86, 10 + (x % 14), 0, Math.PI * 2);
          bgCtx.fill();
        }
        break;
      case 'underwater':
        drawWaveLayer(bgCtx, alphaColor(palette.far, 0.48), H * 0.72, 12, 34, 51);
        drawKelpLayer(bgCtx, alphaColor(palette.mid, 0.7), 14, 57);
        drawWaveLayer(bgCtx, alphaColor(palette.near, 0.92), H * 0.88, 8, 24, 59);
        break;
      case 'postapoc':
        drawSkylineLayer(bgCtx, alphaColor(palette.far, 0.76), H * 0.74, 18, 48, 22, 90, 61, null);
        drawJaggedLayer(bgCtx, alphaColor(palette.mid, 0.86), H * 0.84, 24, 24, 64);
        break;
      case 'cyberpunk':
        drawSkylineLayer(bgCtx, alphaColor(palette.far, 0.95), H * 0.74, 22, 44, 40, 160, 71, alphaColor(palette.glow, 0.4));
        drawSkylineLayer(bgCtx, alphaColor(palette.mid, 0.96), H * 0.82, 18, 36, 34, 120, 76, alphaColor(palette.accent, 0.7));
        bgCtx.fillStyle = alphaColor(palette.glow, 0.18);
        for (let y = Math.floor(H * 0.42); y < H * 0.88; y += 18) {
          bgCtx.fillRect(W * 0.55, y, W * 0.35, 1);
        }
        break;
    }
  }

  // ─── Update ─────────────────────────────────────────────────────────────
  function update(dt) {
    const now = performance.now();
    const elapsed = now - roundStartTime;

    // Check event queue
    for (let i = eventQueue.length - 1; i >= 0; i--) {
      if (elapsed >= eventQueue[i].time) {
        spawnEvent(eventQueue[i].type, eventQueue[i].params);
        eventQueue.splice(i, 1);
      }
    }

    // Update active events
    for (let i = activeEvents.length - 1; i >= 0; i--) {
      const ev = activeEvents[i];
      ev.age += dt * 1000;
      ev.progress = ev.age / ev.duration;

      const def = EVENT_TYPES[ev.type];
      if (def && def.update) {
        def.update(ev, dt);
      }

      if (ev.age >= ev.duration) {
        activeEvents.splice(i, 1);
      }
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  function renderSky(ctx, timeOfDay, biome) {
    const palette = getStagePalette(biome);
    const colors = palette[timeOfDay] || palette.day;
    fillBandRows(ctx, colors);

    ctx.fillStyle = alphaColor(palette.glow, 0.12);
    ctx.fillRect(0, H * 0.4, W, H * 0.16);

    // Stars
    if (bgStars.length > 0) {
      const t = performance.now() / 1000;
      // During dawn, fade out stars; during dusk, fade in
      let starAlphaMult = 1;
      if (timeOfDay === 'dawn') starAlphaMult = 0.3;
      if (timeOfDay === 'dusk') starAlphaMult = 0.5;

      for (const s of bgStars) {
        const flicker = 0.5 + 0.5 * Math.sin(t * s.twinkleSpeed + s.phase);
        const alpha = s.brightness * flicker * starAlphaMult;
        ctx.fillStyle = alphaColor(palette.glow, alpha);
        ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.size, s.size);
      }
    }
  }

  function wrap(value, span) {
    if (span <= 0) return 0;
    let out = value % span;
    if (out < 0) out += span;
    return out;
  }

  function getAmbientScale() {
    if (quality <= 0) return 0.6;
    if (quality === 1) return 0.85;
    if (quality >= 3) return 1.35;
    return 1;
  }

  function drawChunkCloud(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - 10, y + 2, 20, 6);
    ctx.fillRect(x - 6, y - 3, 14, 7);
    ctx.fillRect(x - 2, y - 6, 10, 5);
    ctx.fillRect(x - 14, y, 8, 5);
  }

  function drawHoverCar(ctx, x, y, bodyColor, glowColor, dir) {
    const nose = dir >= 0 ? 6 : -6;
    ctx.fillStyle = bodyColor;
    ctx.fillRect(x - 6, y - 1, 12, 3);
    ctx.fillRect(x - 2, y - 3, 6, 2);
    ctx.fillStyle = glowColor;
    ctx.fillRect(x + nose - (dir >= 0 ? 0 : 1), y, 2, 1);
    ctx.fillRect(x - 4, y + 2, 2, 1);
    ctx.fillRect(x + 2, y + 2, 2, 1);
  }

  function drawPixelBirdShape(ctx, x, y, color, flapUp) {
    ctx.fillStyle = color;
    if (flapUp) {
      ctx.fillRect(x - 3, y - 1, 2, 1);
      ctx.fillRect(x + 1, y - 1, 2, 1);
    } else {
      ctx.fillRect(x - 3, y, 2, 1);
      ctx.fillRect(x + 1, y, 2, 1);
    }
    ctx.fillRect(x - 1, y, 2, 1);
  }

  function drawPixelFish(ctx, x, y, color, dir) {
    ctx.fillStyle = color;
    ctx.fillRect(x - 4, y - 1, 7, 3);
    ctx.fillRect(x - 1, y - 2, 3, 1);
    if (dir >= 0) {
      ctx.fillRect(x - 6, y - 2, 2, 2);
      ctx.fillRect(x - 6, y + 1, 2, 2);
    } else {
      ctx.fillRect(x + 3, y - 2, 2, 2);
      ctx.fillRect(x + 3, y + 1, 2, 2);
    }
  }

  function drawBubbleColumn(ctx, x, topY, bottomY, t, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < 8; i++) {
      const p = wrap(t * 18 + i * 9, bottomY - topY);
      const y = bottomY - p;
      const sway = Math.sin(t * 2 + i * 0.7) * 3;
      const size = 1 + (i % 2);
      ctx.fillRect(Math.floor(x + sway), Math.floor(y), size, size);
    }
  }

  function drawSmokeColumn(ctx, x, baseY, t, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < 7; i++) {
      const age = wrap(t * 10 + i * 7, 60);
      const y = baseY - age;
      const w = 5 + (i % 3) * 2;
      const sway = Math.sin(t * 1.6 + i) * (2 + i * 0.4);
      ctx.fillRect(Math.floor(x + sway), Math.floor(y), w, 3);
      ctx.fillRect(Math.floor(x + sway + 1), Math.floor(y - 2), Math.max(2, w - 2), 2);
    }
  }

  function renderAmbientActivity(ctx) {
    const scale = getAmbientScale();
    const t = (performance.now() - roundStartTime) / 1000;
    const palette = getStagePalette(currentBiome);

    ctx.save();

    switch (currentBiome) {
      case 'city': {
        for (let i = 0; i < Math.round(6 * scale); i++) {
          const laneY = H * (0.18 + (i % 3) * 0.05);
          const dir = i % 2 === 0 ? 1 : -1;
          const span = W + 90;
          let x = wrap(t * (28 + i * 2) + i * 97, span) - 45;
          if (dir < 0) x = W - x;
          drawHoverCar(ctx, Math.floor(x), Math.floor(laneY + Math.sin(t * 2 + i) * 2), palette.glow, palette.accent, dir);
        }
        for (let i = 0; i < 4; i++) {
          const bx = W * (0.12 + i * 0.2);
          const blink = Math.sin(t * 4 + i * 1.7) > 0 ? palette.accent : palette.glow;
          ctx.fillStyle = blink;
          ctx.fillRect(Math.floor(bx), Math.floor(H * 0.33 + (i % 2) * 8), 2, 2);
        }
        ctx.globalAlpha = 0.22;
        drawChunkCloud(ctx, wrap(t * 8 + 40, W + 50) - 25, H * 0.23, alphaColor(palette.glow, 0.6));
        drawChunkCloud(ctx, wrap(t * 6 + 210, W + 60) - 30, H * 0.28, alphaColor('#FFFFFF', 0.25));
        break;
      }
      case 'desert': {
        ctx.fillStyle = alphaColor(palette.glow, 0.18);
        for (let i = 0; i < 4; i++) {
          const y = H * (0.58 + i * 0.05);
          for (let x = -20; x < W + 20; x += 26) {
            const drift = wrap(t * (14 + i * 4) + x + i * 20, W + 40) - 20;
            ctx.fillRect(Math.floor(drift), Math.floor(y + Math.sin((x + t * 20) * 0.03) * 2), 8, 1);
          }
        }
        for (let i = 0; i < Math.round(7 * scale); i++) {
          const vx = wrap(t * 12 + i * 53, W + 40) - 20;
          const vy = H * 0.24 + Math.sin(t * 1.8 + i) * 10 + (i % 3) * 12;
          drawPixelBirdShape(ctx, Math.floor(vx), Math.floor(vy), alphaColor('#2A1407', 0.85), Math.sin(t * 8 + i) > 0);
        }
        ctx.fillStyle = alphaColor('#3C1F0A', 0.8);
        for (let i = 0; i < 2; i++) {
          const x = wrap(t * (9 + i * 2) + i * 180, W + 80) - 40;
          const y = H * 0.73 + i * 10;
          ctx.fillRect(Math.floor(x), Math.floor(y), 18, 2);
          ctx.fillRect(Math.floor(x + 3), Math.floor(y - 4), 3, 4);
          ctx.fillRect(Math.floor(x + 9), Math.floor(y - 5), 3, 5);
          ctx.fillRect(Math.floor(x + 14), Math.floor(y - 3), 2, 3);
        }
        break;
      }
      case 'arctic': {
        ctx.globalAlpha = 0.28;
        drawChunkCloud(ctx, wrap(t * 5 + 70, W + 70) - 35, H * 0.18, alphaColor('#FFFFFF', 0.55));
        drawChunkCloud(ctx, wrap(t * 3 + 260, W + 70) - 35, H * 0.26, alphaColor(palette.glow, 0.45));
        ctx.globalAlpha = 1;
        ctx.fillStyle = alphaColor('#FFFFFF', 0.7);
        for (let i = 0; i < Math.round(40 * scale); i++) {
          const x = (i * 43 + Math.floor(t * 15)) % W;
          const y = (i * 27 + Math.floor(t * 9)) % Math.floor(H * 0.55);
          if ((i + Math.floor(t * 3)) % 3 === 0) ctx.fillRect(x, y, 1, 1);
        }
        if (currentTime !== 'day') {
          ctx.fillStyle = alphaColor('#7FFFD4', 0.12);
          for (let x = 0; x < W; x += 6) {
            const y = H * 0.08 + Math.sin(x * 0.012 + t * 0.9) * 12;
            ctx.fillRect(x, Math.floor(y), 4, 18 + (x % 7));
          }
        }
        break;
      }
      case 'jungle': {
        ctx.fillStyle = alphaColor('#0F2410', 0.65);
        for (let i = 0; i < 10; i++) {
          const x = W * (0.08 + i * 0.09);
          const sway = Math.sin(t * 1.7 + i) * 5;
          ctx.fillRect(Math.floor(x + sway), 0, 2, Math.floor(H * 0.28));
          ctx.fillRect(Math.floor(x + sway - 3), Math.floor(H * 0.12), 8, 2);
        }
        const bugColor = currentTime === 'night' ? alphaColor(palette.glow, 0.8) : alphaColor(palette.accent, 0.55);
        ctx.fillStyle = bugColor;
        for (let i = 0; i < Math.round(32 * scale); i++) {
          const x = wrap(t * (6 + (i % 4)) + i * 31, W + 20) - 10;
          const y = H * 0.28 + Math.sin(t * 2.6 + i * 0.6) * 26 + (i % 5) * 18;
          ctx.fillRect(Math.floor(x), Math.floor(y), 2, 2);
        }
        for (let i = 0; i < Math.round(6 * scale); i++) {
          const x = wrap(t * 16 + i * 83, W + 30) - 15;
          const y = H * 0.16 + Math.sin(t * 2 + i) * 12;
          drawPixelBirdShape(ctx, Math.floor(x), Math.floor(y), alphaColor('#0A0A0A', 0.85), Math.sin(t * 10 + i) > 0);
        }
        break;
      }
      case 'volcanic': {
        drawSmokeColumn(ctx, W * 0.15, H * 0.56, t, alphaColor('#5D3A32', 0.5));
        drawSmokeColumn(ctx, W * 0.82, H * 0.54, t + 1.2, alphaColor('#6A4941', 0.45));
        ctx.fillStyle = alphaColor(palette.accent, 0.65);
        for (let i = 0; i < Math.round(34 * scale); i++) {
          const x = W * (0.1 + ((i * 17) % 80) / 100);
          const y = H * 0.75 - wrap(t * (20 + (i % 4) * 4) + i * 11, 90);
          ctx.fillRect(Math.floor(x + Math.sin(t * 2 + i) * 6), Math.floor(y), 2, 2);
        }
        ctx.fillStyle = alphaColor('#FF4D22', 0.35);
        ctx.fillRect(Math.floor(W * 0.8), Math.floor(H * 0.56), 16, 4);
        break;
      }
      case 'moon': {
        for (let i = 0; i < Math.round(4 * scale); i++) {
          const x = wrap(t * (18 + i * 4) + i * 140, W + 60) - 30;
          const y = H * 0.12 + i * 18;
          ctx.fillStyle = alphaColor(palette.glow, 0.85);
          ctx.fillRect(Math.floor(x), Math.floor(y), 2, 2);
          ctx.fillRect(Math.floor(x - 5), Math.floor(y + 1), 4, 1);
        }
        ctx.fillStyle = alphaColor('#FFF2C7', 0.7);
        for (let i = 0; i < Math.round(5 * scale); i++) {
          const age = wrap(t * (28 + i * 5) + i * 20, W + 80);
          const x = W - age;
          const y = H * 0.14 + i * 16;
          ctx.fillRect(Math.floor(x), Math.floor(y), 2, 2);
          ctx.fillRect(Math.floor(x - 10), Math.floor(y - 1), 8, 1);
        }
        ctx.fillStyle = alphaColor(palette.accent, 0.5);
        for (let i = 0; i < 3; i++) {
          const bx = W * (0.2 + i * 0.28);
          if (Math.sin(t * 3 + i) > -0.2) ctx.fillRect(Math.floor(bx), Math.floor(H * 0.76), 2, 2);
        }
        break;
      }
      case 'underwater': {
        for (let i = 0; i < Math.round(10 * scale); i++) {
          const dir = i % 2 === 0 ? 1 : -1;
          const span = W + 30;
          let x = wrap(t * (10 + (i % 3) * 3) + i * 44, span) - 15;
          if (dir < 0) x = W - x;
          const y = H * 0.25 + (i % 5) * 18 + Math.sin(t * 2 + i) * 6;
          drawPixelFish(ctx, Math.floor(x), Math.floor(y), alphaColor(palette.glow, 0.7), dir);
        }
        for (let i = 0; i < 4; i++) {
          drawBubbleColumn(ctx, W * (0.12 + i * 0.22), H * 0.22, H * 0.9, t + i, alphaColor('#C8FFFF', 0.45));
        }
        ctx.fillStyle = alphaColor('#D7A6FF', 0.45);
        for (let i = 0; i < 3; i++) {
          const x = W * (0.25 + i * 0.24) + Math.sin(t * 1.4 + i) * 10;
          const y = H * 0.34 + Math.sin(t * 1.9 + i) * 12;
          ctx.fillRect(Math.floor(x), Math.floor(y), 8, 4);
          ctx.fillRect(Math.floor(x + 1), Math.floor(y + 4), 1, 5);
          ctx.fillRect(Math.floor(x + 3), Math.floor(y + 4), 1, 6);
          ctx.fillRect(Math.floor(x + 5), Math.floor(y + 4), 1, 5);
        }
        break;
      }
      case 'postapoc': {
        drawSmokeColumn(ctx, W * 0.18, H * 0.62, t, alphaColor('#4D433C', 0.42));
        drawSmokeColumn(ctx, W * 0.71, H * 0.58, t + 0.8, alphaColor('#4C453A', 0.38));
        ctx.fillStyle = alphaColor('#FF8A44', 0.55);
        for (let i = 0; i < Math.round(26 * scale); i++) {
          const x = wrap(t * (8 + (i % 3)) + i * 29, W + 20) - 10;
          const y = H * 0.46 + wrap(i * 11 - t * 12, H * 0.45);
          ctx.fillRect(Math.floor(x), Math.floor(y), 2, 2);
        }
        for (let i = 0; i < 3; i++) {
          const bx = W * (0.16 + i * 0.31);
          ctx.fillStyle = Math.sin(t * 5 + i) > 0 ? palette.accent : palette.glow;
          ctx.fillRect(Math.floor(bx), Math.floor(H * 0.42 + i * 6), 2, 2);
        }
        for (let i = 0; i < Math.round(5 * scale); i++) {
          const x = wrap(t * 13 + i * 71, W + 20) - 10;
          const y = H * 0.2 + (i % 3) * 14 + Math.sin(t * 2 + i) * 8;
          drawPixelBirdShape(ctx, Math.floor(x), Math.floor(y), alphaColor('#0C0908', 0.85), Math.sin(t * 9 + i) > 0);
        }
        break;
      }
      case 'cyberpunk': {
        for (let i = 0; i < Math.round(10 * scale); i++) {
          const laneY = H * (0.16 + (i % 4) * 0.06);
          const dir = i % 2 === 0 ? 1 : -1;
          const span = W + 110;
          let x = wrap(t * (36 + i * 3) + i * 88, span) - 55;
          if (dir < 0) x = W - x;
          drawHoverCar(ctx, Math.floor(x), Math.floor(laneY + Math.sin(t * 3 + i) * 3), palette.accent, palette.glow, dir);
        }
        ctx.fillStyle = alphaColor(palette.glow, 0.45);
        for (let i = 0; i < 8; i++) {
          const x = W * (0.1 + i * 0.1);
          const flicker = Math.sin(t * 6 + i * 2) > -0.15;
          if (flicker) ctx.fillRect(Math.floor(x), Math.floor(H * 0.42 + (i % 4) * 10), 14, 3);
        }
        ctx.fillStyle = alphaColor(palette.accent, 0.2);
        for (let y = 0; y < H * 0.55; y += 14) {
          const sweep = wrap(t * 60 + y * 2, W + 40) - 20;
          ctx.fillRect(Math.floor(sweep), y, 18, 1);
        }
        break;
      }
    }

    ctx.restore();
  }

  function eraseColumn(x, w) {
    if (!bgCtx) return;
    bgCtx.save();
    bgCtx.globalCompositeOperation = 'destination-out';
    bgCtx.fillRect(x, 0, w, H);
    bgCtx.restore();
  }

  function renderBackground(ctx) {
    // Draw static background layer
    if (bgCanvas) {
      ctx.drawImage(bgCanvas, 0, 0);
    }
    renderAmbientActivity(ctx);
  }

  function renderEvents(ctx) {
    for (const ev of activeEvents) {
      const def = EVENT_TYPES[ev.type];
      if (def && def.draw) {
        def.draw(ctx, ev);
      }
    }
  }

  // ─── Event draw functions ───────────────────────────────────────────────

  function buildLightningGeometry(ev) {
    const seed = (
      (Math.floor(ev.params.x || 0) * 73856093) ^
      (Math.floor((ev.params.branches || 0) * 31) * 19349663) ^
      0x9E3779B9
    ) >>> 0;
    const rng = mulberry32(seed);
    const mainPoints = [];
    const branches = [];
    const startX = ev.params.x;
    let x = startX;
    let y = 0;
    const segments = 8 + Math.floor(ev.params.branches * 2);
    const segH = H * 0.7 / segments;
    mainPoints.push({ x, y });

    for (let i = 0; i < segments; i++) {
      x += (rng() - 0.5) * 30;
      y += segH;
      mainPoints.push({ x, y });

      if (i > 2 && i < segments - 1 && rng() < 0.3 && ev.params.branches > 2) {
        const branch = [{ x, y }];
        let bx = x;
        let by = y;
        const branchLen = 3 + Math.floor(rng() * 3);
        for (let j = 0; j < branchLen; j++) {
          bx += (rng() - 0.5) * 20 + (rng() < 0.5 ? 10 : -10);
          by += segH * 0.7;
          branch.push({ x: bx, y: by });
        }
        branches.push(branch);
      }
    }

    return { mainPoints, branches };
  }

  function strokePolyline(ctx, points) {
    if (!points || points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  function drawLightning(ctx, ev) {
    const alpha = ev.progress < 0.3 ? 1 : Math.max(0, 1 - (ev.progress - 0.3) / 0.7);
    if (alpha < 0.01) return;
    if (!ev.data.geometry) ev.data.geometry = buildLightningGeometry(ev);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#8888FF';
    ctx.shadowBlur = quality >= 2 ? 8 : 0;
    strokePolyline(ctx, ev.data.geometry.mainPoints);
    for (const branch of ev.data.geometry.branches) {
      strokePolyline(ctx, branch);
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function updateLightning(ev, dt) {
    if (!ev.data.geometry) ev.data.geometry = buildLightningGeometry(ev);
    if (!ev.data.effectsTriggered) {
      ev.data.effectsTriggered = true;
      Lighting.triggerLightningFlash();
      const distance = Math.abs(ev.params.x - W / 2);
      const maxDistance = W / 2;
      const relativeDistance = Math.min(1, distance / maxDistance);
      const thunderDelay = 1000 + relativeDistance * 1500;
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.playThunderSound) {
          window.playThunderSound();
        }
      }, thunderDelay);
    }
  }

  function drawTornado(ctx, ev) {
    const x = ev.data.x || ev.params.startX;
    const baseY = H * 0.6;
    const tHeight = 100 + Math.random() * 50;
    const alpha = Math.min(1, ev.progress * 5) * Math.min(1, (1 - ev.progress) * 5);
    const now = performance.now() / 1000;

    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = '#666666';

    // Layered rotating ellipses
    for (let i = 0; i < 8; i++) {
      const frac = i / 8;
      const ey = baseY - frac * tHeight;
      const eWidth = 10 + frac * 30 + Math.sin(now * 4 + i) * 5;
      const eHeight = 4 + frac * 3;
      ctx.beginPath();
      ctx.ellipse(x + Math.sin(now * 3 + i * 0.5) * 8, ey, eWidth, eHeight, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Debris particles
    ctx.fillStyle = '#555555';
    for (let i = 0; i < 10; i++) {
      const angle = now * 5 + i * 0.628;
      const dist = 15 + Math.sin(now * 2 + i) * 10;
      const dy = baseY - (i / 10) * tHeight;
      ctx.fillRect(x + Math.cos(angle) * dist, dy + Math.sin(angle) * 5, 2, 2);
    }

    ctx.restore();
  }

  function updateTornado(ev, dt) {
    if (!ev.data.x) ev.data.x = ev.params.startX;
    const dir = ev.params.startX < 0 ? 1 : -1;
    ev.data.x += dir * ev.params.speed * dt * 60;
  }

  function drawMeteor(ctx, ev) {
    const alpha = Math.min(1, ev.progress * 4) * Math.max(0, 1 - ev.progress);
    const p = ev.params;
    const dist = ev.age * p.speed * 0.1;
    const x = p.x + Math.cos(p.angle) * dist;
    const y = p.y + Math.sin(p.angle) * dist;

    ctx.save();
    ctx.globalAlpha = alpha;
    // Tail
    ctx.strokeStyle = '#FFAA44';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(p.angle) * 20, y - Math.sin(p.angle) * 20);
    ctx.stroke();
    // Head
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(Math.floor(x) - 1, Math.floor(y) - 1, 3, 3);
    ctx.restore();
  }

  function updateMeteor(ev, dt) {}

  function drawMeteorShower(ctx, ev) {
    const count = ev.params.count || 15;
    const now = performance.now() / 1000;
    ctx.save();
    for (let i = 0; i < count; i++) {
      const startTime = (i / count) * 6;
      const age = ev.age / 1000 - startTime;
      if (age < 0 || age > 0.5) continue;
      const alpha = Math.min(1, age * 8) * Math.max(0, 1 - age * 2);
      const sx = (i * 97 + 13) % W;
      const sy = (i * 31 + 7) % (H * 0.3);
      const dx = sx + age * 200;
      const dy = sy + age * 100;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#FFCC44';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx - 15, dy - 8);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(Math.floor(dx), Math.floor(dy), 2, 2);
    }
    ctx.restore();
  }

  function updateMeteorShower(ev, dt) {}

  function drawAurora(ctx, ev) {
    const alpha = ev.params.intensity * Math.min(1, ev.progress * 3) * Math.min(1, (1 - ev.progress) * 3);
    const now = performance.now() / 1000;
    const ribbonColors = ['#00FF8844', '#FF44AA33', '#44FFFF33'];

    ctx.save();
    for (let r = 0; r < (ev.params.ribbons || 3); r++) {
      const color = ribbonColors[r % ribbonColors.length];
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * (0.5 + Math.sin(now * 0.5 + r) * 0.3);

      for (let x = 0; x < W; x += 4) {
        const wave = Math.sin(x * 0.01 + now * (0.5 + r * 0.3) + r * 2) * 20;
        const ribbonY = 20 + r * 30 + wave;
        const ribbonH = 40 + Math.sin(x * 0.02 + now + r) * 15;
        ctx.fillRect(x, ribbonY, 4, ribbonH);
      }
    }
    ctx.restore();
  }

  function updateAurora(ev, dt) {}

  function drawUFO(ctx, ev) {
    const progress = ev.progress;
    const dir = ev.params.startX < 0 ? 1 : -1;
    const x = ev.params.startX + dir * progress * (W + 60);
    const y = ev.params.height + Math.sin(progress * 10) * 5;

    ctx.save();
    ctx.globalAlpha = 0.8;

    // Saucer body
    ctx.fillStyle = '#888888';
    ctx.beginPath();
    ctx.ellipse(x, y, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dome
    ctx.fillStyle = '#AAAAAA';
    ctx.beginPath();
    ctx.ellipse(x, y - 3, 6, 5, 0, Math.PI, 0);
    ctx.fill();

    // Blinking lights
    const blink = Math.sin(performance.now() / 200) > 0;
    ctx.fillStyle = blink ? '#FF0000' : '#00FF00';
    ctx.fillRect(x - 8, y + 1, 2, 2);
    ctx.fillStyle = blink ? '#00FF00' : '#FF0000';
    ctx.fillRect(x + 6, y + 1, 2, 2);

    // Beam (occasionally)
    if (progress > 0.4 && progress < 0.6) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#00FFFF';
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 4);
      ctx.lineTo(x + 5, y + 4);
      ctx.lineTo(x + 15, y + 80);
      ctx.lineTo(x - 15, y + 80);
      ctx.fill();
    }

    ctx.restore();
  }

  function updateUFO(ev, dt) {}

  function drawAirplane(ctx, ev) {
    const dir = ev.params.startX < 0 ? 1 : -1;
    const x = ev.params.startX + dir * ev.progress * (W + 40);
    const y = ev.params.height;

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = currentTime === 'night' ? '#333333' : '#555555';

    // Fuselage
    ctx.fillRect(x - 6, y - 1, 12, 3);
    // Wings
    ctx.fillRect(x - 2, y - 4, 4, 8);
    // Tail
    ctx.fillRect(x + (dir > 0 ? -6 : 4), y - 3, 2, 5);

    // Navigation lights at night
    if (currentTime === 'night' || currentTime === 'dusk') {
      const blink = Math.sin(performance.now() / 500) > 0;
      if (blink) {
        ctx.fillStyle = '#FF0000';
        ctx.fillRect(x + (dir > 0 ? 6 : -7), y, 2, 1);
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x - (dir > 0 ? 7 : -6), y, 1, 1);
    }

    ctx.restore();
  }

  function updateAirplane(ev, dt) {}

  function drawBirds(ctx, ev) {
    const dir = ev.params.startX < 0 ? 1 : -1;
    const baseX = ev.params.startX + dir * ev.progress * (W + 80);
    const baseY = ev.params.height;
    const count = ev.params.count || 7;
    const now = performance.now() / 1000;
    const flapFrame = Math.floor(now * 4) % 2;

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = currentBiome === 'jungle' ? '#22AA22' : '#222222';

    for (let i = 0; i < count; i++) {
      // V-formation
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? -1 : 1;
      const bx = baseX - row * 8 * dir;
      const by = baseY + row * 5 * side;

      // Wing flap
      if (flapFrame === 0) {
        ctx.fillRect(bx - 3, by - 1, 2, 2);
        ctx.fillRect(bx + 1, by - 1, 2, 2);
      } else {
        ctx.fillRect(bx - 3, by, 2, 2);
        ctx.fillRect(bx + 1, by, 2, 2);
      }
      ctx.fillRect(bx - 1, by, 2, 1); // body
    }
    ctx.restore();
  }

  function updateBirds(ev, dt) {}

  function drawBats(ctx, ev) {
    const now = performance.now() / 1000;
    const count = ev.params.count || 4;

    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#111111';

    for (let i = 0; i < count; i++) {
      const bx = ev.params.startX + Math.sin(now * 3 + i * 2) * 60 + i * 20;
      const by = 50 + Math.sin(now * 5 + i * 3) * 30;
      const wingUp = Math.sin(now * 8 + i) > 0;

      if (wingUp) {
        ctx.fillRect(bx - 4, by - 2, 3, 1);
        ctx.fillRect(bx + 1, by - 2, 3, 1);
      } else {
        ctx.fillRect(bx - 4, by, 3, 1);
        ctx.fillRect(bx + 1, by, 3, 1);
      }
      ctx.fillRect(bx - 1, by - 1, 2, 2);
    }
    ctx.restore();
  }

  function updateBats(ev, dt) {}

  function drawVolcanicEruption(ctx, ev) {
    const alpha = Math.min(1, ev.progress * 3) * Math.min(1, (1 - ev.progress) * 3);
    const x = ev.params.x;
    const baseY = H * 0.3;
    const now = performance.now() / 1000;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Plume
    ctx.fillStyle = '#FF440088';
    for (let i = 0; i < 6; i++) {
      const py = baseY - i * 12 - Math.sin(now * 2 + i) * 5;
      const pw = 8 + i * 5;
      ctx.beginPath();
      ctx.arc(x + Math.sin(now * 3 + i) * 3, py, pw, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ash cloud
    ctx.fillStyle = '#55555566';
    ctx.beginPath();
    ctx.arc(x, baseY - 80, 40, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function updateVolcanicEruption(ev, dt) {}

  function drawSolarEclipse(ctx, ev) {
    const cx = W / 2;
    const cy = 40;
    const r = 18;
    const progress = ev.progress;

    // Moon overlaps sun: approach over 0-0.36, total 0.36-0.64, depart 0.64-1
    let moonOffset;
    if (progress < 0.36) {
      moonOffset = (1 - progress / 0.36) * r * 3;
    } else if (progress < 0.64) {
      moonOffset = 0;
    } else {
      moonOffset = ((progress - 0.64) / 0.36) * r * 3;
    }

    // Draw moon over sun position
    ctx.save();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(cx + moonOffset, cy, r + 1, 0, Math.PI * 2);
    ctx.fill();

    // During totality, dim everything
    if (progress > 0.3 && progress < 0.7) {
      const dimAlpha = progress < 0.36 ? (progress - 0.3) / 0.06 :
                       progress > 0.64 ? (0.7 - progress) / 0.06 : 1;
      ctx.globalAlpha = dimAlpha * 0.5;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  function updateSolarEclipse(ev, dt) {}

  function updateEarthquake(ev, dt) {
    // Set shake in game - need callback
    if (ev.data.shakeCallback) {
      const intensity = ev.params.intensity * Math.sin(ev.progress * Math.PI);
      ev.data.shakeCallback(intensity);
    }
  }

  function drawWhale(ctx, ev) {
    const dir = ev.params.startX < 0 ? 1 : -1;
    const x = ev.params.startX + dir * ev.progress * (W + 160);
    const y = ev.params.depth;
    const alpha = 0.3 * Math.min(1, ev.progress * 3) * Math.min(1, (1 - ev.progress) * 3);
    const now = performance.now() / 1000;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#223344';

    // Body
    ctx.beginPath();
    ctx.ellipse(x, y, 40, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail
    const tailAngle = Math.sin(now * 1.5) * 0.2;
    ctx.save();
    ctx.translate(x - dir * 38, y);
    ctx.rotate(tailAngle);
    ctx.fillRect(-15, -8, 15, 16);
    ctx.restore();

    // Fin
    ctx.fillRect(x + dir * 5, y - 14, 5, 6);

    ctx.restore();
  }

  function updateWhale(ev, dt) {}

  function drawFireworks(ctx, ev) {
    const now = performance.now() / 1000;
    const count = ev.params.count || 3;
    const colors = ['#FF0000', '#00FF00', '#FFFF00', '#FF00FF', '#00FFFF'];

    ctx.save();
    for (let i = 0; i < count; i++) {
      const burstTime = (i / count) * 2;
      const age = ev.age / 1000 - burstTime;
      if (age < 0 || age > 2) continue;

      const bx = ev.params.x + (i - count / 2) * 40;
      const by = 50 + i * 15;
      const alpha = Math.max(0, 1 - age);
      const color = colors[i % colors.length];

      // Rising trail
      if (age < 0.5) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, H);
        ctx.lineTo(bx, by + (0.5 - age) * 100);
        ctx.stroke();
      }

      // Burst
      if (age >= 0.3) {
        const burstAge = age - 0.3;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        for (let j = 0; j < 12; j++) {
          const angle = (j / 12) * Math.PI * 2;
          const dist = burstAge * 60;
          const px = bx + Math.cos(angle) * dist;
          const py = by + Math.sin(angle) * dist + burstAge * burstAge * 20;
          ctx.fillRect(Math.floor(px), Math.floor(py), 2, 2);
        }
      }
    }
    ctx.restore();
  }

  function updateFireworks(ev, dt) {}

  function drawSatellite(ctx, ev) {
    const x = ev.progress * (W + 40) - 20;
    const y = ev.params.startY + ev.progress * H * 0.15;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(Math.floor(x), Math.floor(y), 2, 2);
    ctx.restore();
  }

  function updateSatellite(ev, dt) {}

  function drawComet(ctx, ev) {
    const x = ev.params.startX + ev.progress * (W + 40);
    const y = ev.params.startY + ev.progress * 30;
    const alpha = Math.min(1, ev.progress * 5) * Math.min(1, (1 - ev.progress) * 5);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Tail
    ctx.strokeStyle = '#FFCC88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 50, y - 5);
    ctx.stroke();

    ctx.strokeStyle = '#FFAA4444';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 80, y - 3);
    ctx.stroke();

    // Head
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(Math.floor(x) - 1, Math.floor(y) - 1, 3, 3);
    ctx.fillStyle = '#FFFFAA';
    ctx.fillRect(Math.floor(x), Math.floor(y), 2, 2);

    ctx.restore();
  }

  function updateComet(ev, dt) {}

  function drawDustDevil(ctx, ev) {
    const dir = ev.params.startX < 0 ? 1 : -1;
    const x = ev.params.startX + dir * ev.progress * (W + 60);
    const baseY = H * 0.85;
    const now = performance.now() / 1000;
    const alpha = Math.min(1, ev.progress * 3) * Math.min(1, (1 - ev.progress) * 3);

    ctx.save();
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = '#C4A060';

    for (let i = 0; i < 6; i++) {
      const frac = i / 6;
      const dy = baseY - frac * 50;
      const radius = 5 + frac * 8;
      const angle = now * 6 + i;
      ctx.beginPath();
      ctx.arc(x + Math.sin(angle) * 3, dy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function updateDustDevil(ev, dt) {}

  function drawKaiju(ctx, ev) {
    const x = ev.params.x;
    const alpha = Math.sin(ev.progress * Math.PI) * 0.4;
    const baseY = H * 0.55;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#111111';

    // Giant silhouette
    ctx.beginPath();
    // Body
    ctx.moveTo(x - 30, baseY + 40);
    ctx.lineTo(x - 20, baseY - 10);
    ctx.lineTo(x - 15, baseY - 30);
    // Head
    ctx.lineTo(x - 10, baseY - 40);
    ctx.lineTo(x - 5, baseY - 45);
    ctx.lineTo(x + 5, baseY - 45);
    ctx.lineTo(x + 10, baseY - 40);
    // Spines
    ctx.lineTo(x + 15, baseY - 30);
    ctx.lineTo(x + 20, baseY - 10);
    ctx.lineTo(x + 30, baseY + 40);
    ctx.fill();

    // Glowing eyes
    ctx.fillStyle = '#FF0000';
    ctx.globalAlpha = alpha * 2;
    ctx.fillRect(x - 6, baseY - 42, 2, 2);
    ctx.fillRect(x + 4, baseY - 42, 2, 2);

    ctx.restore();
  }

  function updateKaiju(ev, dt) {}

  return {
    init,
    resize,
    setQuality,
    configureForRound,
    handleEffectEvent,
    spawnEvent,
    update,
    renderSky,
    renderBackground,
    renderEvents,
    eraseColumn,
  };
})();
