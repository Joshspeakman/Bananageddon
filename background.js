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

  // ─── Biome event spawn tables (weight-based) ───────────────────────────
  const BIOME_EVENT_TABLES = {
    city: {
      day:   { airplane: 3, birds: 4 },
      dawn:  { birds: 5 },
      dusk:  { birds: 3, bats: 2 },
      night: { airplane: 2, satellite: 3, meteor: 2 },
    },
    desert: {
      day:   { birds: 2, dustDevil: 3 },
      dawn:  { birds: 2 },
      dusk:  { birds: 2 },
      night: { meteor: 5, meteorShower: 1, ufo: 2, satellite: 3 },
    },
    arctic: {
      day:   { birds: 2 },
      dawn:  {},
      dusk:  { aurora: 3 },
      night: { aurora: 8, meteor: 3, satellite: 2 },
    },
    jungle: {
      day:   { birds: 5 },
      dawn:  { birds: 6 },
      dusk:  { bats: 3, birds: 2 },
      night: { bats: 4, meteor: 1 },
    },
    volcanic: {
      day:   { volcanicEruption: 5 },
      dawn:  { volcanicEruption: 4 },
      dusk:  { volcanicEruption: 5 },
      night: { volcanicEruption: 6, meteor: 2 },
    },
    moon: {
      day:   { meteor: 6 },
      dawn:  { meteor: 5 },
      dusk:  { meteor: 5 },
      night: { meteor: 8, meteorShower: 2, satellite: 1 },
    },
    underwater: {
      day:   { whale: 4 },
      dawn:  { whale: 3 },
      dusk:  { whale: 3 },
      night: { whale: 2 },
    },
    postapoc: {
      day:   { dustDevil: 3, birds: 1 },
      dawn:  { birds: 1 },
      dusk:  { bats: 3 },
      night: { ufo: 3, kaiju: 1, meteor: 2, fireworks: 1 },
    },
    cyberpunk: {
      day:   { airplane: 2 },
      dawn:  { airplane: 1 },
      dusk:  { airplane: 2 },
      night: { ufo: 2, fireworks: 3, airplane: 2, satellite: 2 },
    },
  };

  // Storm weather adds lightning to any biome
  const WEATHER_EVENT_OVERLAY = {
    storm:     { lightning: 8 },
    sandstorm: { dustDevil: 2 },
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
    let t = 3000 + rng() * 5000; // first event after 3-8 seconds
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
      const minInterval = eventType === 'lightning' ? 4000 : 8000;
      const maxInterval = eventType === 'lightning' ? 12000 : 25000;
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
    // Limit simultaneous events of same type to 2
    const sameTypeCount = activeEvents.filter(e => e.type === type).length;
    if (sameTypeCount >= 2) return;

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

  // ─── Static background rendering ───────────────────────────────────────
  function renderStaticBackground() {
    if (!bgCtx) return;
    bgCtx.clearRect(0, 0, W, H);

    // Draw distant background elements based on biome
    switch (currentBiome) {
      case 'desert':
        // Distant dunes
        bgCtx.fillStyle = '#B8860B44';
        bgCtx.beginPath();
        bgCtx.moveTo(0, H * 0.6);
        for (let x = 0; x < W; x += 40) {
          bgCtx.lineTo(x + 20, H * 0.55 + Math.sin(x * 0.02) * 15);
        }
        bgCtx.lineTo(W, H);
        bgCtx.lineTo(0, H);
        bgCtx.fill();
        break;

      case 'arctic':
        // Distant snow-capped mountains
        bgCtx.fillStyle = '#B0C4DE44';
        bgCtx.beginPath();
        bgCtx.moveTo(0, H * 0.5);
        const mts = [0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85];
        for (const mx of mts) {
          bgCtx.lineTo(W * mx, H * 0.35 + Math.sin(mx * 20) * 20);
          bgCtx.lineTo(W * (mx + 0.05), H * 0.5);
        }
        bgCtx.lineTo(W, H);
        bgCtx.lineTo(0, H);
        bgCtx.fill();
        // Snow caps
        bgCtx.fillStyle = '#FFFFFF33';
        for (const mx of mts) {
          bgCtx.fillRect(W * mx - 5, H * 0.35 + Math.sin(mx * 20) * 20 - 3, 10, 6);
        }
        break;

      case 'volcanic':
        // Distant volcano silhouette
        bgCtx.fillStyle = '#33000088';
        bgCtx.beginPath();
        bgCtx.moveTo(W * 0.8, H * 0.6);
        bgCtx.lineTo(W * 0.85, H * 0.25);
        bgCtx.lineTo(W * 0.87, H * 0.22);
        bgCtx.lineTo(W * 0.89, H * 0.25);
        bgCtx.lineTo(W * 0.95, H * 0.6);
        bgCtx.lineTo(W, H);
        bgCtx.lineTo(0, H);
        bgCtx.fill();
        break;

      case 'underwater':
        // Distant seaweed and ocean floor undulation
        bgCtx.fillStyle = '#005555';
        bgCtx.beginPath();
        bgCtx.moveTo(0, H * 0.85);
        for (let x = 0; x < W; x += 30) {
          bgCtx.lineTo(x + 15, H * 0.83 + Math.sin(x * 0.05) * 5);
        }
        bgCtx.lineTo(W, H);
        bgCtx.lineTo(0, H);
        bgCtx.fill();
        break;

      case 'jungle':
        // Distant canopy layer
        bgCtx.fillStyle = '#0A3A0A66';
        bgCtx.beginPath();
        bgCtx.moveTo(0, H * 0.4);
        for (let x = 0; x < W; x += 25) {
          bgCtx.lineTo(x + 12, H * 0.35 + Math.sin(x * 0.08) * 10);
        }
        bgCtx.lineTo(W, H);
        bgCtx.lineTo(0, H);
        bgCtx.fill();
        break;

      case 'cyberpunk':
        // Distant mega-towers
        if (bgRng) {
          bgCtx.fillStyle = '#0A0A2E99';
          for (let i = 0; i < 6; i++) {
            const tx = W * 0.1 + i * W * 0.15;
            const th = H * 0.2 + bgRng() * H * 0.3;
            bgCtx.fillRect(tx, H * 0.4 - th * 0.3, 15, th);
          }
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
    // Draw sky gradient for dawn/dusk
    const grad = SKY_GRADIENTS[timeOfDay];
    if (grad) {
      const g = ctx.createLinearGradient(0, 0, 0, H * 0.6);
      for (const s of grad) {
        g.addColorStop(s.stop, s.color);
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

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
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
        ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.size, s.size);
      }
    }
  }

  function renderBackground(ctx) {
    // Draw static background layer
    if (bgCanvas) {
      ctx.drawImage(bgCanvas, 0, 0);
    }
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

  function drawLightning(ctx, ev) {
    const alpha = ev.progress < 0.3 ? 1 : Math.max(0, 1 - (ev.progress - 0.3) / 0.7);
    if (alpha < 0.01) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#8888FF';
    ctx.shadowBlur = quality >= 2 ? 8 : 0;

    // Main bolt
    const startX = ev.params.x;
    let x = startX, y = 0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 8 + Math.floor(ev.params.branches * 2);
    const segH = H * 0.7 / segments;
    for (let i = 0; i < segments; i++) {
      x += (Math.random() - 0.5) * 30;
      y += segH;
      ctx.lineTo(x, y);

      // Branch
      if (i > 2 && i < segments - 1 && Math.random() < 0.3 && ev.params.branches > 2) {
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        let bx = x, by = y;
        const branchLen = 3 + Math.floor(Math.random() * 3);
        for (let j = 0; j < branchLen; j++) {
          bx += (Math.random() - 0.5) * 20 + (Math.random() < 0.5 ? 10 : -10);
          by += segH * 0.7;
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.restore();

    // Trigger flash in lighting system
    if (ev.age < 50) {
      Lighting.triggerLightningFlash();
      // Trigger thunder after a delay (simulating speed of sound)
      // Delay varies based on distance (x position), 1-2.5 seconds
      const distance = Math.abs(ev.params.x - W / 2);
      const maxDistance = W / 2;
      const relativeDistance = Math.min(1, distance / maxDistance);
      const thunderDelay = 1000 + relativeDistance * 1500; // 1-2.5 seconds
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.playThunderSound) {
          window.playThunderSound();
        }
      }, thunderDelay);
    }
  }

  function updateLightning(ev, dt) {
    // Nothing extra needed
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
  };
})();
