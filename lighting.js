// Bananageddon — Lighting system (lighting.js)
// Handles ambient tint, dynamic light sources, shadows, flash overlays,
// and screen-space effects (heat shimmer, caustics, chromatic aberration).

const Lighting = (function () {
  'use strict';

  // ─── Lighting buffer (offscreen canvas) ──────────────────────────────────
  let lightCanvas = null;
  let lightCtx = null;
  let W = 640, H = 480;

  // ─── Active light sources ────────────────────────────────────────────────
  const MAX_LIGHTS = 30;
  let lights = [];
  let lightPool = [];

  // ─── Flash overlay state ─────────────────────────────────────────────────
  let flashAlpha = 0;
  let flashColor = '#FFFFFF';
  let flashDecay = 0;

  // ─── Ambient tint ────────────────────────────────────────────────────────
  let ambientColor = 'rgba(0,0,0,0)';
  let ambientAlpha = 0;

  // ─── Heat shimmer state ──────────────────────────────────────────────────
  let shimmerEnabled = false;
  let shimmerTime = 0;

  // ─── Caustics state ──────────────────────────────────────────────────────
  let causticsEnabled = false;
  let causticsTime = 0;

  // ─── Quality level (0=low, 1=medium, 2=high, 3=insane) ──────────────────
  let quality = 2;

  // ─── Time-of-day + biome + weather ambient tint tables ───────────────────
  // Tint is {r, g, b, a} applied as multiply over the whole frame
  const TIME_TINTS = {
    dawn:  { r: 255, g: 180, b: 120, a: 0.15 },
    day:   { r: 0,   g: 0,   b: 0,   a: 0 },
    dusk:  { r: 200, g: 100, b: 180, a: 0.18 },
    night: { r: 20,  g: 30,  b: 80,  a: 0.35 },
  };

  const WEATHER_TINT_MODS = {
    clear:     { r: 0,   g: 0,   b: 0,   aMult: 1.0 },
    rain:      { r: -20, g: -10, b: 20,  aMult: 1.2 },
    snow:      { r: 10,  g: 10,  b: 15,  aMult: 0.95 },
    fog:       { r: -30, g: -30, b: -20, aMult: 1.5 },
    storm:     { r: -40, g: -30, b: 10,  aMult: 1.8 },
    windshear: { r: 0,   g: 0,   b: 0,   aMult: 1.0 },
    acidrain:  { r: -10, g: 30,  b: -10, aMult: 1.15 },
    sandstorm: { r: 40,  g: 20,  b: -20, aMult: 1.3 },
  };

  // ─── Initialization ─────────────────────────────────────────────────────
  function init(width, height) {
    W = width;
    H = height;
    lightCanvas = document.createElement('canvas');
    lightCanvas.width = W;
    lightCanvas.height = H;
    lightCtx = lightCanvas.getContext('2d');
    lightCtx.imageSmoothingEnabled = false;
    lights = [];
    flashAlpha = 0;
  }

  function resize(width, height) {
    W = width;
    H = height;
    if (lightCanvas) {
      lightCanvas.width = W;
      lightCanvas.height = H;
      lightCtx = lightCanvas.getContext('2d');
      lightCtx.imageSmoothingEnabled = false;
    }
  }

  function setQuality(q) {
    quality = q;
  }

  // ─── Compute ambient tint for current conditions ─────────────────────────
  function computeAmbientTint(timeOfDay, weather) {
    const base = TIME_TINTS[timeOfDay] || TIME_TINTS.day;
    const wmod = WEATHER_TINT_MODS[weather] || WEATHER_TINT_MODS.clear;

    const r = Math.max(0, Math.min(255, base.r + wmod.r));
    const g = Math.max(0, Math.min(255, base.g + wmod.g));
    const b = Math.max(0, Math.min(255, base.b + wmod.b));
    const a = Math.min(0.7, base.a * wmod.aMult);

    ambientColor = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    ambientAlpha = a;
  }

  function setAmbient(timeOfDay, weather, biome) {
    computeAmbientTint(timeOfDay, weather);

    // Enable shimmer for hot biomes during day
    shimmerEnabled = (biome === 'desert' || biome === 'volcanic') &&
                     (timeOfDay === 'day' || timeOfDay === 'dawn' || timeOfDay === 'dusk');

    // Enable caustics for underwater
    causticsEnabled = biome === 'underwater' && (timeOfDay === 'day' || timeOfDay === 'dawn' || timeOfDay === 'dusk');
  }

  // ─── Light source management ─────────────────────────────────────────────
  function addLight(x, y, radius, color, intensity, duration, flicker) {
    const light = lightPool.length > 0 ? lightPool.pop() : {};
    light.x = x;
    light.y = y;
    light.radius = radius;
    light.color = color;
    light.intensity = intensity;
    light.maxLife = duration || 0; // 0 = permanent
    light.life = duration || 0;
    light.flicker = flicker || 0;
    light.active = true;

    if (lights.length >= MAX_LIGHTS) {
      // Remove oldest non-permanent light
      for (let i = 0; i < lights.length; i++) {
        if (lights[i].maxLife > 0) {
          lightPool.push(lights[i]);
          lights.splice(i, 1);
          break;
        }
      }
    }
    lights.push(light);
    return light;
  }

  function addExplosionLight(x, y, radius) {
    return addLight(x, y, Math.max(80, radius * 4), '#FFFF55', 1.0, 400, 0);
  }

  function addBananaGlow(x, y) {
    return addLight(x, y, 20, '#FFFF55', 0.4, 0, 0);
  }

  function clearLights() {
    for (const l of lights) lightPool.push(l);
    lights = [];
  }

  // ─── Flash overlay ───────────────────────────────────────────────────────
  function triggerFlash(color, intensity, decayMs) {
    flashColor = color || '#FFFFFF';
    flashAlpha = intensity || 1.0;
    flashDecay = (intensity || 1.0) / ((decayMs || 200) / 16.67);
  }

  function triggerLightningFlash() {
    triggerFlash('#FFFFFF', 0.9, 250);
  }

  function triggerExplosionFlash(isMatchWinning) {
    triggerFlash('#FFFF55', isMatchWinning ? 0.3 : 0.15, 100);
  }

  // ─── Shadow drawing ──────────────────────────────────────────────────────
  function drawShadows(ctx, buildings, gorillas, gorillaVisible, timeOfDay, GORILLA_W, GORILLA_H, LOGICAL_H) {
    if (quality < 1) return; // skip on low quality

    let shadowAngle, shadowLen, shadowAlpha;
    switch (timeOfDay) {
      case 'dawn':
        shadowAngle = -0.6; // westward (left)
        shadowLen = 3.0;
        shadowAlpha = 0.25;
        break;
      case 'dusk':
        shadowAngle = 0.6; // eastward (right)
        shadowLen = 3.0;
        shadowAlpha = 0.25;
        break;
      case 'night':
        shadowAngle = 0.2;
        shadowLen = 1.5;
        shadowAlpha = 0.1;
        break;
      default: // day
        shadowAngle = 0;
        shadowLen = 0.5;
        shadowAlpha = 0.15;
        break;
    }

    ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;

    // Building shadows
    for (const b of buildings) {
      const bh = LOGICAL_H - b.y;
      const shLen = bh * shadowLen;
      const shX = shadowAngle * shLen;
      ctx.beginPath();
      ctx.moveTo(b.x, LOGICAL_H);
      ctx.lineTo(b.x + b.w, LOGICAL_H);
      ctx.lineTo(b.x + b.w + shX, LOGICAL_H);
      ctx.lineTo(b.x + shX, LOGICAL_H);
      ctx.fill();
    }

    // Gorilla shadows
    for (let gi = 0; gi < gorillas.length; gi++) {
      if (!gorillaVisible[gi]) continue;
      const g = gorillas[gi];
      const gh = GORILLA_H;
      const shLen = gh * shadowLen * 0.5;
      const shX = shadowAngle * shLen;
      ctx.fillRect(g.x + shX, g.y + gh, GORILLA_W + Math.abs(shX), 3);
    }
  }

  // ─── Update (called each frame) ─────────────────────────────────────────
  function update(dt) {
    // Update light lifetimes
    for (let i = lights.length - 1; i >= 0; i--) {
      const l = lights[i];
      if (l.maxLife > 0) {
        l.life -= dt * 1000;
        if (l.life <= 0) {
          l.active = false;
          lightPool.push(l);
          lights.splice(i, 1);
        }
      }
    }

    // Update flash
    if (flashAlpha > 0) {
      flashAlpha -= flashDecay;
      if (flashAlpha < 0) flashAlpha = 0;
    }

    // Update shimmer/caustics time
    shimmerTime += dt;
    causticsTime += dt;
  }

  // ─── Render the lighting pass onto the main canvas ───────────────────────
  function render(mainCtx) {
    if (!lightCanvas) return;

    // 1. Ambient tint overlay
    if (ambientAlpha > 0.001) {
      mainCtx.fillStyle = ambientColor;
      mainCtx.fillRect(0, 0, W, H);
    }

    // 2. Dynamic light sources (additive blend)
    if (lights.length > 0 && quality >= 1) {
      lightCtx.clearRect(0, 0, W, H);
      lightCtx.globalCompositeOperation = 'source-over';

      for (const l of lights) {
        if (!l.active) continue;
        let intensity = l.intensity;

        // Flicker
        if (l.flicker > 0) {
          intensity *= 1 + (Math.random() - 0.5) * l.flicker;
        }

        // Fade out as life decreases
        if (l.maxLife > 0) {
          intensity *= l.life / l.maxLife;
        }

        const alpha = Math.min(1, intensity);
        const grad = lightCtx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.radius);
        grad.addColorStop(0, withAlpha(l.color, alpha));
        grad.addColorStop(0.5, withAlpha(l.color, alpha * 0.4));
        grad.addColorStop(1, withAlpha(l.color, 0));
        lightCtx.fillStyle = grad;
        lightCtx.fillRect(l.x - l.radius, l.y - l.radius, l.radius * 2, l.radius * 2);
      }

      // Composite light buffer onto main canvas with 'lighter' (additive)
      mainCtx.save();
      mainCtx.globalCompositeOperation = 'lighter';
      mainCtx.drawImage(lightCanvas, 0, 0);
      mainCtx.restore();
    }

    // 3. Flash overlay
    if (flashAlpha > 0.001) {
      mainCtx.fillStyle = withAlpha(flashColor, flashAlpha);
      mainCtx.fillRect(0, 0, W, H);
    }

    // 4. Heat shimmer (simplified pixel displacement effect)
    if (shimmerEnabled && quality >= 2) {
      const shimmerH = Math.floor(H * 0.3);
      const yStart = H - shimmerH;
      // Draw subtle wavy distortion lines
      mainCtx.save();
      mainCtx.globalAlpha = 0.03;
      for (let y = yStart; y < H; y += 4) {
        const offset = Math.sin(shimmerTime * 3 + y * 0.1) * 2;
        mainCtx.drawImage(mainCtx.canvas, 0, y, W, 2, offset, y, W, 2);
      }
      mainCtx.globalAlpha = 1;
      mainCtx.restore();
    }

    // 5. Underwater caustics
    if (causticsEnabled && quality >= 2) {
      mainCtx.save();
      mainCtx.globalAlpha = 0.06;
      mainCtx.strokeStyle = 'rgba(150, 220, 255, 0.4)';
      mainCtx.lineWidth = 1;
      for (let x = 0; x < W; x += 20) {
        const y1 = Math.sin(causticsTime * 2 + x * 0.08) * 8 + H * 0.3;
        const y2 = Math.sin(causticsTime * 2.5 + x * 0.06) * 10 + H * 0.5;
        mainCtx.beginPath();
        mainCtx.moveTo(x, y1);
        mainCtx.quadraticCurveTo(x + 10, (y1 + y2) / 2, x + 20, y2);
        mainCtx.stroke();
      }
      mainCtx.globalAlpha = 1;
      mainCtx.restore();
    }
  }

  // ─── Helper ──────────────────────────────────────────────────────────────
  function withAlpha(hexColor, alpha) {
    // Parse hex color and return rgba
    let r = 0, g = 0, b = 0;
    if (hexColor.startsWith('#')) {
      const hex = hexColor.slice(1);
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
      }
    }
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
  }

  return {
    init,
    resize,
    setQuality,
    setAmbient,
    addLight,
    addExplosionLight,
    addBananaGlow,
    clearLights,
    triggerFlash,
    triggerLightningFlash,
    triggerExplosionFlash,
    drawShadows,
    update,
    render,
  };
})();
