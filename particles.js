// Bananageddon — Particle system (particles.js)
// Generic pooled particle system with emitter presets for rain, snow, ash,
// embers, dust, bubbles, fireflies, pollen, sparks, smoke, confetti, leaves.

const Particles = (function () {
  'use strict';

  // ─── Particle pool ──────────────────────────────────────────────────────
  const MAX_PARTICLES = 600;
  const pool = [];
  const active = [];

  // ─── Emitter registry ───────────────────────────────────────────────────
  const emitters = [];

  // ─── World dimensions ───────────────────────────────────────────────────
  let W = 640, H = 480;
  let windForce = 0;

  // ─── Quality level (0-3) ────────────────────────────────────────────────
  let quality = 2;
  let particleCap = MAX_PARTICLES;

  // ─── Snow accumulation overlay ──────────────────────────────────────────
  let snowAccum = null; // Uint8Array per x-column, tracks accumulated height
  let ashAccum = null;

  function init(width, height) {
    W = width;
    H = height;
    clear();
    snowAccum = new Uint8Array(W);
    ashAccum = new Uint8Array(W);
  }

  function resize(width, height) {
    W = width;
    H = height;
    snowAccum = new Uint8Array(W);
    ashAccum = new Uint8Array(W);
  }

  function setQuality(q) {
    quality = q;
    particleCap = q === 0 ? 200 : q === 1 ? 400 : q === 3 ? 900 : MAX_PARTICLES;
  }

  function setWind(w) {
    windForce = w;
  }

  function clear() {
    for (const p of active) pool.push(p);
    active.length = 0;
    emitters.length = 0;
  }

  // ─── Particle creation ──────────────────────────────────────────────────
  function spawn(config) {
    if (active.length >= particleCap) return null;
    const p = pool.length > 0 ? pool.pop() : {};
    p.x = config.x || 0;
    p.y = config.y || 0;
    p.vx = config.vx || 0;
    p.vy = config.vy || 0;
    p.ax = config.ax || 0;
    p.ay = config.ay || 0;
    p.life = config.life || 1;
    p.maxLife = config.life || 1;
    p.size = config.size || 2;
    p.color = config.color || '#FFFFFF';
    p.type = config.type || 'square'; // 'square', 'line', 'circle', 'glow'
    p.alpha = config.alpha != null ? config.alpha : 1;
    p.fadeOut = config.fadeOut !== false;
    p.gravity = config.gravity || 0;
    p.windAffect = config.windAffect || 0;
    p.spin = config.spin || 0;
    p.angle = config.angle || 0;
    p.blinkRate = config.blinkRate || 0; // for fireflies
    p.active = true;
    active.push(p);
    return p;
  }

  // ─── Emitter presets ────────────────────────────────────────────────────
  const EMITTER_CONFIGS = {
    rain: {
      count: 200, spawnRate: 10, colors: ['#6696CC', '#5588BB'],
      spawn: function () {
        return {
          x: Math.random() * W, y: -5,
          vx: windForce * 0.1, vy: 8 + Math.random() * 6,
          life: 3, size: 1, type: 'line', alpha: 0.6,
          windAffect: 0.1, gravity: 0, fadeOut: false,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    acidrain: {
      count: 150, spawnRate: 8, colors: ['#66FF00', '#44CC00'],
      spawn: function () {
        return {
          x: Math.random() * W, y: -5,
          vx: windForce * 0.1, vy: 7 + Math.random() * 5,
          life: 3, size: 1, type: 'line', alpha: 0.5,
          windAffect: 0.1, gravity: 0, fadeOut: false,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    snow: {
      count: 150, spawnRate: 3, colors: ['#FFFFFF', '#EEEEFF'],
      spawn: function () {
        return {
          x: Math.random() * W, y: -5,
          vx: (Math.random() - 0.5) * 0.5, vy: 0.5 + Math.random() * 1.5,
          life: 15, size: 1 + Math.floor(Math.random() * 2), type: 'square',
          alpha: 0.7 + Math.random() * 0.3, windAffect: 0.05, gravity: 0,
          fadeOut: false, spin: (Math.random() - 0.5) * 0.02,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    fog: {
      count: 30, spawnRate: 0.5, colors: ['#AAAAAA'],
      spawn: function () {
        return {
          x: Math.random() * W, y: Math.random() * H,
          vx: 0.2 + Math.random() * 0.3, vy: (Math.random() - 0.5) * 0.1,
          life: 30, size: 20 + Math.random() * 30, type: 'circle',
          alpha: 0.08 + Math.random() * 0.06, windAffect: 0.01, gravity: 0,
          fadeOut: false,
          color: this.colors[0],
        };
      },
    },
    ash: {
      count: 100, spawnRate: 3, colors: ['#555555', '#444444', '#FF6600'],
      spawn: function () {
        const isEmber = Math.random() < 0.1;
        return {
          x: Math.random() * W, y: -5,
          vx: (Math.random() - 0.5) * 0.8, vy: 0.5 + Math.random() * 1.0,
          life: 8, size: isEmber ? 2 : 1, type: 'square',
          alpha: isEmber ? 0.9 : 0.5, windAffect: 0.03, gravity: 0.01,
          fadeOut: true, color: isEmber ? '#FF6600' : this.colors[Math.floor(Math.random() * 2)],
        };
      },
    },
    embers: {
      count: 30, spawnRate: 2, colors: ['#FF4400', '#FF6600', '#FFAA00'],
      spawn: function () {
        return {
          x: Math.random() * W, y: H,
          vx: (Math.random() - 0.5) * 1.5, vy: -1 - Math.random() * 2,
          life: 3, size: 2, type: 'square',
          alpha: 0.8, windAffect: 0.02, gravity: -0.02,
          fadeOut: true, blinkRate: 4 + Math.random() * 4,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    dust: {
      count: 40, spawnRate: 2, colors: ['#C4A060', '#D2B070'],
      spawn: function () {
        return {
          x: -10, y: H * 0.6 + Math.random() * H * 0.4,
          vx: 2 + Math.random() * 2, vy: (Math.random() - 0.5) * 0.5,
          life: 8, size: 2, type: 'square',
          alpha: 0.3, windAffect: 0.2, gravity: 0,
          fadeOut: true,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    moonDust: {
      count: 30, spawnRate: 1, colors: ['#808080', '#999999'],
      spawn: function () {
        return {
          x: Math.random() * W, y: H,
          vx: (Math.random() - 0.5) * 0.5, vy: -0.3 - Math.random() * 0.5,
          life: 6, size: 1, type: 'square',
          alpha: 0.3, windAffect: 0, gravity: -0.005,
          fadeOut: true,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    bubbles: {
      count: 80, spawnRate: 3, colors: ['#88DDFF', '#66CCEE'],
      spawn: function () {
        return {
          x: Math.random() * W, y: H + 5,
          vx: (Math.random() - 0.5) * 0.5, vy: -1 - Math.random() * 1.5,
          life: 10, size: 2 + Math.floor(Math.random() * 3), type: 'circle',
          alpha: 0.5, windAffect: 0, gravity: -0.01,
          fadeOut: false, spin: (Math.random() - 0.5) * 0.1,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    fireflies: {
      count: 40, spawnRate: 1, colors: ['#FFFF00', '#AAFF00'],
      spawn: function () {
        return {
          x: Math.random() * W, y: H * 0.3 + Math.random() * H * 0.6,
          vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
          life: 20, size: 2, type: 'glow',
          alpha: 0.8, windAffect: 0, gravity: 0,
          fadeOut: false, blinkRate: 1 + Math.random() * 2,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    pollen: {
      count: 60, spawnRate: 2, colors: ['#CCFF44', '#AADD22'],
      spawn: function () {
        return {
          x: Math.random() * W, y: Math.random() * H * 0.7,
          vx: 0.3 + Math.random() * 0.5, vy: (Math.random() - 0.5) * 0.2,
          life: 12, size: 1, type: 'square',
          alpha: 0.5, windAffect: 0.05, gravity: 0.002,
          fadeOut: false,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    leaves: {
      count: 30, spawnRate: 1, colors: ['#228B22', '#8B4513', '#556B2F'],
      spawn: function () {
        return {
          x: Math.random() * W, y: -10,
          vx: 1 + Math.random() * 2, vy: 0.5 + Math.random() * 1,
          life: 10, size: 3, type: 'square',
          alpha: 0.7, windAffect: 0.1, gravity: 0.03,
          fadeOut: false, spin: (Math.random() - 0.5) * 0.1,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
    sandstorm: {
      count: 120, spawnRate: 8, colors: ['#D2B470', '#C4A060'],
      spawn: function () {
        return {
          x: -10, y: Math.random() * H,
          vx: 4 + Math.random() * 4 + windForce * 0.3, vy: (Math.random() - 0.5) * 1,
          life: 5, size: 1 + Math.floor(Math.random() * 2), type: 'square',
          alpha: 0.3 + Math.random() * 0.2, windAffect: 0.3, gravity: 0,
          fadeOut: false,
          color: this.colors[Math.floor(Math.random() * this.colors.length)],
        };
      },
    },
  };

  // ─── Burst presets (one-shot emissions) ──────────────────────────────────
  function burstSparks(x, y, count) {
    count = Math.min(count || 20, 30);
    if (quality < 1) count = Math.floor(count / 2);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 0.5 + Math.random() * 0.5,
        size: 1 + Math.floor(Math.random() * 2),
        color: Math.random() > 0.3 ? '#FF8800' : '#FFFFFF',
        type: 'square', alpha: 1, fadeOut: true, gravity: 0.15,
      });
    }
  }

  function burstSmoke(x, y, count) {
    count = Math.min(count || 15, 20);
    if (quality < 1) count = Math.floor(count / 2);
    for (let i = 0; i < count; i++) {
      spawn({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.5 - Math.random() * 1,
        life: 2 + Math.random() * 1,
        size: 3 + Math.floor(Math.random() * 4),
        color: '#555555', type: 'circle',
        alpha: 0.5, fadeOut: true, gravity: -0.02,
      });
    }
  }

  function burstConfetti(x, y, count) {
    count = Math.min(count || 60, 80);
    const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FF8800', '#8800FF'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        life: 3 + Math.random() * 2,
        size: 2 + Math.floor(Math.random() * 3),
        color: colors[Math.floor(Math.random() * colors.length)],
        type: 'square', alpha: 1, fadeOut: false,
        gravity: 0.12, spin: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  function burstRainSplash(x, y) {
    for (let i = 0; i < 4; i++) {
      spawn({
        x, y,
        vx: (Math.random() - 0.5) * 2,
        vy: -1 - Math.random() * 1,
        life: 0.2, size: 1,
        color: '#6696CC', type: 'square',
        alpha: 0.5, fadeOut: true, gravity: 0.3,
      });
    }
  }

  // ─── Add continuous emitter ──────────────────────────────────────────────
  function addEmitter(type) {
    const config = EMITTER_CONFIGS[type];
    if (!config) return;
    const effectiveCount = quality < 2 ? Math.floor(config.count * 0.6) : config.count;
    emitters.push({
      type,
      config,
      timer: 0,
      maxCount: effectiveCount,
      spawnRate: config.spawnRate,
    });
    // Seed initial particles
    const initialCount = Math.floor(effectiveCount * 0.5);
    for (let i = 0; i < initialCount; i++) {
      const pConfig = config.spawn();
      // Randomize initial position
      pConfig.y = Math.random() * H;
      if (pConfig.vx > 1) pConfig.x = Math.random() * W;
      spawn(pConfig);
    }
  }

  // ─── Configure emitters for biome/weather/time ──────────────────────────
  function configureForRound(biome, weather, timeOfDay) {
    clear();

    // Weather particles
    switch (weather) {
      case 'rain': addEmitter('rain'); break;
      case 'acidrain': addEmitter('acidrain'); break;
      case 'snow': addEmitter('snow'); break;
      case 'fog': addEmitter('fog'); break;
      case 'storm': addEmitter('rain'); addEmitter('fog'); break;
      case 'sandstorm': addEmitter('sandstorm'); addEmitter('dust'); break;
    }

    // Biome-specific particles
    switch (biome) {
      case 'volcanic':
        addEmitter('ash');
        addEmitter('embers');
        break;
      case 'underwater':
        addEmitter('bubbles');
        break;
      case 'jungle':
        if (timeOfDay === 'night') {
          addEmitter('fireflies');
        } else {
          addEmitter('pollen');
        }
        if (weather === 'storm') addEmitter('leaves');
        break;
      case 'desert':
        if (weather !== 'sandstorm') addEmitter('dust');
        break;
      case 'moon':
        addEmitter('moonDust');
        break;
      case 'postapoc':
        addEmitter('ash');
        if (weather !== 'sandstorm') addEmitter('dust');
        break;
    }
  }

  // ─── Update all particles ───────────────────────────────────────────────
  function update(dt) {
    // Spawn from emitters
    for (const em of emitters) {
      em.timer += dt;
      const interval = 1 / em.spawnRate;
      while (em.timer >= interval && active.length < particleCap) {
        const pConfig = em.config.spawn();
        spawn(pConfig);
        em.timer -= interval;
      }
      if (em.timer > interval) em.timer = 0;
    }

    // Update active particles
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      p.life -= dt;
      if (p.life <= 0) {
        pool.push(p);
        active.splice(i, 1);
        continue;
      }

      // Physics
      p.vx += (p.ax + windForce * p.windAffect) * dt;
      p.vy += (p.ay + p.gravity) * dt;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;

      // Wrap around
      if (p.y > H + 10) {
        // Snow/ash accumulation
        if (p.type === 'square' && p.vy > 0) {
          const ix = Math.floor(p.x);
          if (ix >= 0 && ix < W) {
            if (p.color === '#FFFFFF' || p.color === '#EEEEFF') {
              if (snowAccum[ix] < 4) snowAccum[ix]++;
            } else if (p.color === '#555555' || p.color === '#444444') {
              if (ashAccum[ix] < 3) ashAccum[ix]++;
            }
          }
        }
        p.y = -5;
        p.x = Math.random() * W;
      }
      if (p.x > W + 20) p.x = -15;
      if (p.x < -20) p.x = W + 15;
      if (p.y < -20 && p.vy < 0) {
        pool.push(p);
        active.splice(i, 1);
      }
    }
  }

  // ─── Render all particles ───────────────────────────────────────────────
  function render(ctx) {
    const now = performance.now() / 1000;

    for (const p of active) {
      let alpha = p.alpha;
      if (p.fadeOut) {
        alpha *= p.life / p.maxLife;
      }
      if (p.blinkRate > 0) {
        const blink = Math.sin(now * p.blinkRate * Math.PI * 2);
        if (blink < 0) continue; // blink off
        alpha *= 0.5 + blink * 0.5;
      }
      if (alpha < 0.01) continue;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      switch (p.type) {
        case 'line': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * 0.3, p.y + p.vy * 0.3);
          ctx.stroke();
          break;
        }
        case 'circle': {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'glow': {
          // Tiny glow for fireflies
          ctx.fillRect(Math.floor(p.x) - 1, Math.floor(p.y) - 1, 2, 2);
          ctx.globalAlpha = alpha * 0.3;
          ctx.fillRect(Math.floor(p.x) - 2, Math.floor(p.y) - 2, 4, 4);
          break;
        }
        default: { // square
          if (p.spin !== 0) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
          } else {
            ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
          }
          break;
        }
      }
    }
    ctx.globalAlpha = 1;

    // Draw accumulation overlays
    drawAccumulation(ctx);
  }

  // ─── Split rendering: behind terrain vs in front ─────────────────────────
  function renderBehind(ctx) {
    // Render fog/large particles behind terrain
    const now = performance.now() / 1000;
    for (const p of active) {
      if (p.type !== 'circle' && p.type !== 'glow') continue;
      let alpha = p.alpha;
      if (p.fadeOut) alpha *= p.life / p.maxLife;
      if (p.blinkRate > 0) {
        const blink = Math.sin(now * p.blinkRate * Math.PI * 2);
        if (blink < 0) continue;
        alpha *= 0.5 + blink * 0.5;
      }
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.type === 'circle') {
        // Draw as fluffy cloud shape (multiple overlapping circles)
        const r = p.size;
        ctx.beginPath();
        ctx.arc(p.x - r * 0.6, p.y, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y - r * 0.3, r * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x + r * 0.6, p.y, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x - r * 0.3, p.y + r * 0.5, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x + r * 0.3, p.y + r * 0.5, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(Math.floor(p.x) - 1, Math.floor(p.y) - 1, 2, 2);
        ctx.globalAlpha = alpha * 0.3;
        ctx.fillRect(Math.floor(p.x) - 2, Math.floor(p.y) - 2, 4, 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  function renderFront(ctx) {
    // Render small/fast particles in front of terrain
    const now = performance.now() / 1000;
    for (const p of active) {
      if (p.type === 'circle' || p.type === 'glow') continue;
      let alpha = p.alpha;
      if (p.fadeOut) alpha *= p.life / p.maxLife;
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.type === 'line') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 0.3, p.y + p.vy * 0.3);
        ctx.stroke();
      } else {
        if (p.spin !== 0) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
        } else {
          ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
        }
      }
    }
    ctx.globalAlpha = 1;
    drawAccumulation(ctx);
  }

  // ─── Accumulation drawing ───────────────────────────────────────────────
  function drawAccumulation(ctx) {
    // Snow accumulation
    let hasSnow = false, hasAsh = false;
    for (let x = 0; x < W; x++) {
      if (snowAccum[x] > 0) { hasSnow = true; break; }
    }
    for (let x = 0; x < W; x++) {
      if (ashAccum[x] > 0) { hasAsh = true; break; }
    }

    if (hasSnow) {
      ctx.fillStyle = '#FFFFFF';
      for (let x = 0; x < W; x++) {
        if (snowAccum[x] > 0) {
          // Draw on top of terrain - just at bottom for now
          ctx.fillRect(x, H - snowAccum[x], 1, snowAccum[x]);
        }
      }
    }
    if (hasAsh) {
      ctx.fillStyle = '#555555';
      for (let x = 0; x < W; x++) {
        if (ashAccum[x] > 0) {
          ctx.fillRect(x, H - ashAccum[x], 1, ashAccum[x]);
        }
      }
    }
  }

  return {
    init,
    resize,
    setQuality,
    setWind,
    clear,
    spawn,
    addEmitter,
    configureForRound,
    burstSparks,
    burstSmoke,
    burstConfetti,
    burstRainSplash,
    update,
    render,
    renderBehind,
    renderFront,
  };
})();
