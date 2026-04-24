(function (root, factory) {
  const shared = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = shared;
  }

  root.MonkeyMaddnessShared = shared;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAP_SIZES = {
    normal: { w: 640, h: 480, minBuildings: 8, maxBuildings: 12 },
    large:  { w: 960, h: 540, minBuildings: 12, maxBuildings: 18 },
    xl:     { w: 1280, h: 600, minBuildings: 16, maxBuildings: 24 },
    huge:   { w: 1920, h: 720, minBuildings: 24, maxBuildings: 36 },
  };

  const MODE_CONFIGS = {
    classic: {
      label: 'Classic',
      requiredPlayers: 2,
      supportedPlayers: 2,
      controlledPlayers: 2,
      scoreMode: 'individual',
      soloTurn: false,
      targetCount: 0,
    },
    bestof: {
      label: 'Best Of',
      requiredPlayers: 2,
      supportedPlayers: 2,
      controlledPlayers: 2,
      scoreMode: 'individual',
      soloTurn: false,
      targetCount: 0,
    },
    suddendeath: {
      label: 'Sudden Death',
      requiredPlayers: 2,
      supportedPlayers: 2,
      controlledPlayers: 2,
      scoreMode: 'individual',
      soloTurn: false,
      targetCount: 0,
    },
    artillery: {
      label: 'Artillery',
      requiredPlayers: 2,
      supportedPlayers: 2,
      controlledPlayers: 2,
      scoreMode: 'individual',
      soloTurn: false,
      targetCount: 0,
    },
    targetpractice: {
      label: 'Target Practice',
      requiredPlayers: 1,
      supportedPlayers: 1,
      controlledPlayers: 1,
      scoreMode: 'individual',
      soloTurn: true,
      targetCount: 1,
    },
    koth: {
      label: 'King of the Hill',
      requiredPlayers: 2,
      supportedPlayers: 4,
      controlledPlayers: 4,
      scoreMode: 'individual',
      soloTurn: false,
      targetCount: 0,
    },
    gauntlet: {
      label: 'Gauntlet',
      requiredPlayers: 1,
      supportedPlayers: 1,
      controlledPlayers: 1,
      scoreMode: 'individual',
      soloTurn: true,
      targetCount: 1,
    },
    chaos: {
      label: 'Chaos',
      requiredPlayers: 2,
      supportedPlayers: 2,
      controlledPlayers: 2,
      scoreMode: 'individual',
      soloTurn: false,
      targetCount: 0,
    },
    team: {
      label: 'Team',
      requiredPlayers: 4,
      supportedPlayers: 4,
      controlledPlayers: 4,
      scoreMode: 'team',
      soloTurn: false,
      targetCount: 0,
    },
  };

  const DEFAULT_SETTINGS = {
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

  const PLAYER_COLOR_DEFAULTS = ['#9D52FF', '#FF8A4C', '#55E9FF', '#A6FF55'];

  function getDefaultPlayerColor(slotIdx = 0) {
    const idx = Math.abs(Math.floor(Number(slotIdx) || 0)) % PLAYER_COLOR_DEFAULTS.length;
    return PLAYER_COLOR_DEFAULTS[idx];
  }

  function sanitizePlayerColor(value, fallback = PLAYER_COLOR_DEFAULTS[0]) {
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
  }

  const SETTINGS_LIMITS = {
    roundsToWin: { min: 1, max: 20 },
    turnTimers: [0, 15, 30, 60],
    gravities: [0.25, 0.5, 1, 1.5, 2, 3],
    maxVelocities: [200, 500, 999],
    explosionRadii: [15, 30, 50, 80],
    windIntensities: ['calm', 'normal', 'gusty', 'storm'],
    shakeIntensities: ['off', 'light', 'normal', 'heavy'],
    trailStyles: ['dotted', 'smoke', 'fire', 'none'],
    timeOfDayOptions: ['day', 'night', 'dawn', 'dusk', 'cycle', 'random'],
    localOnlySettings: ['musicEnabled', 'musicOrder', 'effectsQuality'],
  };

  return {
    MAP_SIZES,
    MODE_CONFIGS,
    DEFAULT_SETTINGS,
    PLAYER_COLOR_DEFAULTS,
    getDefaultPlayerColor,
    sanitizePlayerColor,
    SETTINGS_LIMITS,
    VALID_GAME_MODES: Object.keys(MODE_CONFIGS),
  };
});
