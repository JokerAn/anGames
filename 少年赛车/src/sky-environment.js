// Procedural sky dome, stars, clouds and PMREM environment for 少年赛车.
// THREE is injected by the caller (same pattern as src/light-show.js); this
// module imports nothing and never touches '/vendor/three.module.js'.
//
// createSky() returns at most three draw calls:
//   daytime:  gradient dome + cloud layer + cloud layer
//   night:    gradient dome + cloud layer + star points
// The dome shader draws the sun/moon disc, halo, horizon band and city glow, so
// no extra billboards are needed. Cloud textures are module-cached across
// tracks and reported through `retainedTextures` (never dispose those).

const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

const SKY_RADIUS = 620;
const CLOUD_RADIUS = 600;

const DOME_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DOME_FRAGMENT = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uBandColor;
uniform vec3 uCityColor;
uniform vec3 uGroundColor;
uniform vec3 uLightColor;
uniform vec3 uLightDir;
uniform float uHazeStrength;
uniform float uHazeFalloff;
uniform float uBandStrength;
uniform float uCityStrength;
uniform float uGroundStrength;
uniform float uGradientPower;
uniform float uLightGain;
uniform float uHaloPower;
uniform float uHaloGain;
uniform float uDiscCos;
uniform float uDiscEdge;
uniform vec3 uAirglow;
varying vec3 vDirection;

void main() {
  vec3 direction = normalize(vDirection);
  float height = clamp(direction.y, -1.0, 1.0);
  // Horizon band transitions to the zenith over uGradientPower * 90 degrees.
  float gradient = smoothstep(0.0, max(uGradientPower, 0.001), height);
  vec3 color = mix(uHorizon, uTop, gradient);

  // Warm/cool haze hugging the horizon.
  float haze = exp(-abs(height) * uHazeFalloff);
  color = mix(color, uHaze, haze * uHazeStrength);

  // Thin atmospheric band right at the skyline.
  float band = exp(-abs(height) * 95.0);
  color = mix(color, uBandColor, band * uBandStrength);

  // City light pollution (night presets only; zero strength in daylight).
  float city = exp(-max(height, 0.0) * 10.0) * smoothstep(-0.02, 0.03, height);
  color += uCityColor * city * uCityStrength;

  // Sun or moon: crisp disc plus a wide halo.
  vec3 lightDir = normalize(uLightDir);
  float alignment = max(dot(direction, lightDir), 0.0);
  float disc = smoothstep(uDiscCos - uDiscEdge, uDiscCos + uDiscEdge, alignment);
  float halo = pow(alignment, uHaloPower);
  color += uLightColor * (disc * uLightGain + halo * uHaloGain);

  // Ground fallback below the horizon; terrain usually covers this.
  // Night airglow floor: keeps the zenith deep blue instead of crushed black.
  color = max(color, uAirglow);

  float below = smoothstep(0.02, -0.16, height);
  color = mix(color, uGroundColor, below * uGroundStrength);

  gl_FragColor = vec4(max(color, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VERTEX = `
attribute float aSize;
attribute float aPhase;
attribute float aBrightness;
uniform float uTime;
uniform float uPixelScale;
uniform float uIntensity;
uniform float uTwinkle;
uniform vec3 uColor;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float twinkle = 0.72 + 0.28 * sin(uTime * uTwinkle + aPhase);
  gl_PointSize = aSize * uPixelScale * (0.75 + 0.45 * twinkle);
  vColor = uColor * uIntensity;
  vAlpha = aBrightness * twinkle;
}`;

const STAR_FRAGMENT = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float distanceToCenter = length(centered);
  if (distanceToCenter > 0.5) discard;
  float falloff = smoothstep(0.5, 0.06, distanceToCenter);
  gl_FragColor = vec4(vColor, vAlpha * falloff);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Cloud layers project the cached 2D cloud field as a sky plane instead of
// wrapping it over sphere UVs: no pole pinching, no horizon stretching, and the
// drift is a uniform offset so reduced motion can freeze it.
const CLOUD_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CLOUD_FRAGMENT = `
uniform sampler2D tCloud;
uniform vec3 uLitColor;
uniform vec3 uShadeColor;
uniform vec3 uHazeColor;
uniform vec3 uSunTint;
uniform vec3 uSunDir;
uniform vec2 uDrift;
uniform vec2 uScale;
uniform float uCover;
uniform float uOpacity;
uniform float uSunStrength;
uniform float uEdge;
varying vec3 vDirection;

void main() {
  vec3 direction = normalize(vDirection);
  float height = direction.y;
  // Clouds dissolve into the warm haze band at the horizon.
  float fade = smoothstep(0.02, 0.2, height) * (1.0 - 0.3 * smoothstep(0.72, 1.0, height));
  // Spherical (azimuth/elevation) mapping keeps angular feature size stable.
  float azimuth = atan(direction.z, direction.x) * 0.15915494 + 0.5;
  float elevation = asin(clamp(height, -1.0, 1.0)) * 0.31830989 + 0.5;
  float verticalCoord = elevation * uScale.y + uDrift.y;
  vec2 uv = vec2(azimuth * uScale.x, verticalCoord) + vec2(uDrift.x, 0.0);
  vec4 texel = texture2D(tCloud, uv);

  // R = baked FBM density, GB = baked surface tilt (shape relief).
  float density = texel.r;
  float threshold = 1.0 - uCover;
  float alpha = smoothstep(threshold, threshold + uEdge, density) * fade * uOpacity * smoothstep(0.0, 0.05, verticalCoord);
  if (alpha < 0.004) discard;

  vec3 east = cross(vec3(0.0, 1.0, 0.0), direction);
  float eastLength = length(east);
  east = eastLength > 1e-4 ? east / eastLength : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(direction, east);
  vec2 tilt = texel.gb * 2.0 - 1.0;
  vec3 normal = normalize(direction + east * tilt.x + north * tilt.y);
  vec3 sunDir = normalize(uSunDir);

  // Top-lit cumulus: ambient sky dome + directional sun (moon/city at night).
  float diffuse = max(dot(normal, sunDir), 0.0);
  float topLight = max(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0);
  float light = clamp(0.12 + 0.5 * topLight + uSunStrength * diffuse, 0.0, 1.0);
  vec3 color = mix(uShadeColor, uLitColor, light);

  // Sun-facing rim (day) or faint city-glow wash (night).
  float sunNear = pow(max(dot(direction, sunDir), 0.0), 8.0);
  color = mix(color, uSunTint, sunNear * 0.45);

  // Horizon haze tint so distant clouds sit inside the sunset band.
  float horizon = 1.0 - smoothstep(0.0, 0.32, height);
  color = mix(color, uHazeColor, horizon * 0.5);

  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BASE_DAY = {
  night: false,
  theme: 'coast',
  top: '#1a548f',
  horizon: '#ead7ae',
  haze: '#f7e9cc',
  hazeStrength: 0.36,
  hazeFalloff: 7.5,
  gradientPower: 0.34,
  bandColor: '#ffd9a2',
  bandStrength: 0.4,
  sunColor: '#ffd08a',
  sunDir: { x: -0.6, y: 0.23, z: -0.77 },
  lightGain: 3.2,
  discCos: 0.99972,
  discEdge: 0.00006,
  haloPower: 9,
  haloGain: 0.7,
  airglow: '#000000',
  cityGlow: '#000000',
  cityGlowStrength: 0,
  groundColor: '#6f7a5e',
  groundStrength: 0.9,
  cloudColor: '#ece6d8',
  cloudShade: '#43597b',
  cloudSunStrength: 0.85,
  cloudEdge: 0.065,
  cloudOpacity: 1,
  cloudLayerOpacity: 0.22,
  cloudCover: 0.38,
  cloudLayers: 2,
  cloudSpeed: 0.004,
  starCount: 0,
  starColor: '#dfe9ff',
  starIntensity: 0,
  starTwinkle: 1.6,
  fog: { color: '#a7bdc5', near: 130, far: 650 },
  exposure: 1.05,
  envIntensity: 0.9,
};

const BASE_NIGHT = {
  night: true,
  theme: 'cyber',
  top: '#0a1526',
  horizon: '#1e3c58',
  haze: '#3a627c',
  hazeStrength: 0.58,
  hazeFalloff: 9,
  gradientPower: 0.55,
  bandColor: '#4d84ac',
  bandStrength: 0.42,
  sunColor: '#e6eef4',
  sunDir: { x: 0.42, y: 0.58, z: -0.7 },
  lightGain: 2.2,
  discCos: 0.99948,
  discEdge: 0.00006,
  haloPower: 70,
  haloGain: 0.14,
  airglow: '#16344f',
  cityGlow: '#6fc4ff',
  cityGlowStrength: 1.15,
  groundColor: '#0b111a',
  groundStrength: 0.9,
  cloudColor: '#223447',
  cloudShade: '#0a0f16',
  cloudSunStrength: 0.2,
  cloudEdge: 0.09,
  cloudOpacity: 0.3,
  cloudLayerOpacity: 0.14,
  cloudCover: 0.22,
  cloudLayers: 2,
  cloudSpeed: 0.006,
  starCount: 900,
  starColor: '#cfe2ff',
  starIntensity: 1.6,
  starTwinkle: 2.2,
  fog: { color: '#101824', near: 90, far: 500 },
  exposure: 1.16,
  envIntensity: 0.7,
};

const THEME_OVERRIDES = {
  coast: {
    ...BASE_DAY,
    theme: 'coast',
    fog: { color: '#a7bdc5', near: 130, far: 650 },
    exposure: 1.06,
    envIntensity: 0.9,
  },
  canyon: {
    ...BASE_DAY,
    theme: 'creek',
    top: '#2a5b88',
    horizon: '#efd3a6',
    gradientPower: 0.4,
    haze: '#f9e2b8',
    bandColor: '#ffc98c',
    bandStrength: 0.46,
    sunColor: '#ffbf78',
    sunDir: { x: 0.44, y: 0.27, z: -0.85 },
    lightGain: 3.0,
    haloPower: 8,
    haloGain: 0.65,
    cloudColor: '#f6ead6',
    cloudShade: '#5a4f40',
    cloudSunStrength: 0.8,
    cloudCover: 0.36,
    groundColor: '#6b7156',
    fog: { color: '#c5c1b3', near: 120, far: 600 },
    exposure: 1.04,
    envIntensity: 0.92,
  },
  neon: {
    ...BASE_NIGHT,
    theme: 'cyber',
    cityGlow: '#6fc4ff',
    cityGlowStrength: 0.9,
    fog: { color: '#101824', near: 90, far: 500 },
    exposure: 1.16,
    envIntensity: 0.7,
  },
  arcade: {
    ...BASE_NIGHT,
    theme: 'arcade',
    top: '#0b0518',
    horizon: '#3c1554',
    haze: '#6c2b7e',
    bandColor: '#ff79dc',
    bandStrength: 0.4,
    sunColor: '#ffd9f6',
    sunDir: { x: -0.35, y: 0.55, z: -0.76 },
    lightGain: 2.3,
    haloPower: 48,
    haloGain: 0.18,
    airglow: '#382059',
    cityGlow: '#ff5fd2',
    cityGlowStrength: 1.35,
    groundColor: '#100a1c',
    cloudColor: '#3d2a4c',
    cloudShade: '#120a1c',
    cloudSunStrength: 0.3,
    cloudCover: 0.2,
    cloudOpacity: 0.26,
    cloudSpeed: 0.0055,
    starCount: 1200,
    starColor: '#ffd9f7',
    starIntensity: 1.7,
    starTwinkle: 2.6,
    fog: { color: '#100722', near: 90, far: 500 },
    exposure: 1.2,
    envIntensity: 0.72,
  },
};

function isNightTrack(track) {
  if (!track || typeof track !== 'object') return false;
  return !!(track.night || track.id === 'neon' || track.id === 'arcade' || track.theme === 'arcade' || track.theme === 'cyber');
}

// Public: theme preset shared by the sky, the environment bake and the
// renderer's fog/lighting/exposure integration.
export function skyPreset(track) {
  const source = track && typeof track === 'object' ? track : {};
  const id = source.id || 'coast';
  const base = THEME_OVERRIDES[id] || (isNightTrack(source) ? BASE_NIGHT : BASE_DAY);
  const sunDir = base.sunDir;
  const length = Math.hypot(sunDir.x, sunDir.y, sunDir.z) || 1;
  return {
    id,
    theme: source.theme || base.theme,
    night: !!base.night,
    top: base.top,
    horizon: base.horizon,
    haze: base.haze,
    hazeStrength: base.hazeStrength,
    hazeFalloff: base.hazeFalloff,
    gradientPower: base.gradientPower,
    bandColor: base.bandColor,
    bandStrength: base.bandStrength,
    sunColor: base.sunColor,
    sunDir: { x: sunDir.x / length, y: sunDir.y / length, z: sunDir.z / length },
    lightGain: base.lightGain,
    discCos: base.discCos,
    discEdge: base.discEdge,
    haloPower: base.haloPower,
    haloGain: base.haloGain,
    airglow: base.airglow,
    cityGlow: base.cityGlow,
    cityGlowStrength: base.cityGlowStrength,
    groundColor: base.groundColor,
    groundStrength: base.groundStrength,
    cloudColor: base.cloudColor,
    cloudShade: base.cloudShade,
    cloudSunStrength: base.cloudSunStrength,
    cloudEdge: base.cloudEdge,
    cloudOpacity: base.cloudOpacity,
    cloudLayerOpacity: base.cloudLayerOpacity,
    cloudCover: base.cloudCover,
    cloudLayers: base.cloudLayers,
    cloudSpeed: base.cloudSpeed,
    starCount: base.starCount,
    starColor: base.starColor,
    starIntensity: base.starIntensity,
    starTwinkle: base.starTwinkle,
    fog: { color: base.fog.color, near: base.fog.near, far: base.fog.far },
    exposure: base.exposure,
    envIntensity: base.envIntensity,
  };
}

// --- deterministic randomness (stable screenshots across sessions) ----------

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hexToRgb(hex) {
  const value = String(hex || '#000000').replace('#', '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value.padEnd(6, '0');
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

function rgbToHex({ r, g, b }) {
  const to = value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp(t, 0, 1);
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k });
}

function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const k = 1 - clamp(amount, 0, 1);
  return rgbToHex({ r: r * k, g: g * k, b: b * k });
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1).toFixed(3)})`;
}

// --- cloud texture cache (shared across tracks, hence retainedTextures) ------

const CLOUD_TEXTURES = new Map();

function drawCloudBlob(ctx, x, y, radiusX, radiusY, alpha) {
  const scale = Math.max(0.05, radiusY / radiusX);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, scale);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
  gradient.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
  gradient.addColorStop(0.72, `rgba(255,255,255,${alpha.toFixed(3)})`);
  gradient.addColorStop(0.9, `rgba(255,255,255,${(alpha * 0.62).toFixed(3)})`);
  gradient.addColorStop(0.98, `rgba(255,255,255,${(alpha * 0.16).toFixed(3)})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Tileable value-noise lattice helpers: cloud fields are baked once per theme
// family on a canvas (density + shape-relief normals), so the shader cost stays
// at a couple of texture taps per pixel.
function makeNoiseGrid(random, cellsX, cellsY) {
  const data = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < data.length; i++) data[i] = random();
  return {cellsX, cellsY, data};
}

function sampleNoiseGrid(grid, u, v) {
  const fx = u * grid.cellsX;
  const fy = v * grid.cellsY;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  let tx = fx - x0;
  let ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const xa = ((x0 % grid.cellsX) + grid.cellsX) % grid.cellsX;
  const xb = xa + 1 >= grid.cellsX ? 0 : xa + 1;
  const ya = y0 < 0 ? 0 : y0 >= grid.cellsY ? grid.cellsY - 1 : y0;
  const yb = ya + 1 >= grid.cellsY ? grid.cellsY - 1 : ya + 1;
  const data = grid.data;
  const cellsX = grid.cellsX;
  const a = data[ya * cellsX + xa];
  const b = data[ya * cellsX + xb];
  const c = data[yb * cellsX + xa];
  const d = data[yb * cellsX + xb];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function makeFbm(random, baseCellsX, octaves, gain = 0.55, aspect = 1) {
  const baseCellsY = baseCellsX * aspect;
  const layers = [];
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const frequency = 2 ** octave;
    layers.push({
      grid: makeNoiseGrid(
        random,
        Math.max(4, Math.round(baseCellsX * frequency)),
        Math.max(3, Math.round(baseCellsY * frequency)),
      ),
      amplitude,
    });
    total += amplitude;
    amplitude *= gain;
  }
  return (u, v) => {
    let sum = 0;
    for (let i = 0; i < layers.length; i++) sum += layers[i].amplitude * sampleNoiseGrid(layers[i].grid, u, v);
    return sum / total;
  };
}

function boxBlurField(source, width, height, radius) {
  const horizontal = new Float32Array(width * height);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        let sx = x + k;
        sx = sx < 0 ? sx + width : sx >= width ? sx - width : sx;
        sum += source[row + sx];
      }
      horizontal[row + x] = sum / span;
    }
  }
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k < 0 ? 0 : y + k >= height ? height - 1 : y + k;
        sum += horizontal[sy * width + x];
      }
      result[y * width + x] = sum / span;
    }
  }
  return result;
}

const CLOUD_TEXTURE_WIDTH = 1280;
const CLOUD_TEXTURE_HEIGHT = 640;
const CLOUD_WARP_WIDTH = 192;
const CLOUD_WARP_HEIGHT = 96;

function buildCloudField(family) {
  const day = family === 'day';
  const width = CLOUD_TEXTURE_WIDTH;
  const height = CLOUD_TEXTURE_HEIGHT;
  const random = makeRandom(day ? 0x9e3779b1 : 0x85ebca6b);
  // Angular noise: x covers 360 deg, y covers 180 deg (half the cell count).
  const detail = makeFbm(random, day ? 10 : 7, day ? 4 : 4, 0.55, day ? 1.0 : 1.0);
  const warpX = makeFbm(random, 2.2, 3, 0.5, 1);
  const warpY = makeFbm(random, 2.2, 3, 0.5, 1);

  // Domain-warp field is low frequency, so bake it small and upsample.
  const warpWidth = CLOUD_WARP_WIDTH;
  const warpHeight = CLOUD_WARP_HEIGHT;
  const warpFieldX = new Float32Array(warpWidth * warpHeight);
  const warpFieldY = new Float32Array(warpWidth * warpHeight);
  for (let y = 0; y < warpHeight; y++) {
    const v = (y + 0.5) / warpHeight;
    for (let x = 0; x < warpWidth; x++) {
      const u = (x + 0.5) / warpWidth;
      warpFieldX[y * warpWidth + x] = warpX((u + 0.31) % 1, v);
      warpFieldY[y * warpWidth + x] = warpY((u + 0.73) % 1, v);
    }
  }
  const sampleWarp = (field, u, v) => {
    const fx = u * warpWidth - 0.5;
    const fy = v * warpHeight - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    let tx = fx - x0;
    let ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const xa = ((x0 % warpWidth) + warpWidth) % warpWidth;
    const xb = xa + 1 >= warpWidth ? 0 : xa + 1;
    const ya = y0 < 0 ? 0 : y0 >= warpHeight ? warpHeight - 1 : y0;
    const yb = ya + 1 >= warpHeight ? warpHeight - 1 : ya + 1;
    const a = field[ya * warpWidth + xa];
    const b = field[ya * warpWidth + xb];
    const c = field[yb * warpWidth + xa];
    const d = field[yb * warpWidth + xb];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };

  const warpStrength = day ? 0.06 : 0.05;
  const density = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const wx = sampleWarp(warpFieldX, u, v) - 0.5;
      const wy = sampleWarp(warpFieldY, u, v) - 0.5;
      let n = detail(u + wx * warpStrength, Math.min(0.999, Math.max(0.001, v + wy * warpStrength * 0.7)));
      // Contrast shaping: threshold in the shader then carves crisp cumulus
      // edges while keeping the interior density for the lighting relief.
      n = (n - 0.5) * 1.75 + 0.5;
      density[y * width + x] = n < 0 ? 0 : n > 1 ? 1 : n;
    }
  }

  // Empirical quantile normalization: with a uniform density distribution the
  // shader can treat uCover as the actual fraction of sky under cloud.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < density.length; i++) histogram[Math.min(255, (density[i] * 255) | 0)]++;
  const cdf = new Float32Array(257);
  let accumulated = 0;
  for (let i = 0; i < 256; i++) {
    accumulated += histogram[i];
    cdf[i + 1] = accumulated / density.length;
  }
  for (let i = 0; i < density.length; i++) {
    const bin = Math.min(255, (density[i] * 255) | 0);
    const within = density[i] * 255 - bin;
    density[i] = cdf[bin] + (cdf[bin + 1] - cdf[bin]) * within;
  }

  // Shape relief: cloud height = smoothed density, normals from its gradient.
  const heightField = boxBlurField(density, width, height, 3);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const pixels = image.data;
  const normalStrength = day ? 7.5 : 6;
  for (let y = 0; y < height; y++) {
    const rowNorth = y > 0 ? y - 1 : 0;
    const rowSouth = y < height - 1 ? y + 1 : height - 1;
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? x - 1 : width - 1;
      const right = x < width - 1 ? x + 1 : 0;
      const hWest = heightField[y * width + left];
      const hEast = heightField[y * width + right];
      const hNorth = heightField[rowNorth * width + x];
      const hSouth = heightField[rowSouth * width + x];
      let nx = (hWest - hEast) * normalStrength;
      let ny = (hSouth - hNorth) * normalStrength;
      const magnitude = Math.hypot(nx, ny);
      if (magnitude > 0.92) {
        const scale = 0.92 / magnitude;
        nx *= scale;
        ny *= scale;
      }
      const index = (y * width + x) * 4;
      pixels[index] = density[y * width + x] * 255;
      pixels[index + 1] = (nx * 0.5 + 0.5) * 255;
      pixels[index + 2] = (ny * 0.5 + 0.5) * 255;
      pixels[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cloudTexture(THREE, family) {
  const cached = CLOUD_TEXTURES.get(family);
  if (cached) return cached;
  const canvas = buildCloudField(family);
  const texture = new THREE.CanvasTexture(canvas);
  // The canvas stores data (density + tilt), not color: never sRGB-decode it.
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.name = `sky-clouds-${family}`;
  texture.needsUpdate = true;
  CLOUD_TEXTURES.set(family, texture);
  return texture;
}

// --- star field -------------------------------------------------------------

function createStars(THREE, preset) {
  const count = Math.max(0, Math.min(4000, Math.round(finite(preset.starCount, 0))));
  const random = makeRandom(0x27d4eb2f);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const brightness = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x;
    let y;
    let z;
    if (i % 4 === 0) {
      // A quarter of the stars sit in a tilted band: a cheap Milky Way hint.
      const angle = random() * Math.PI * 2;
      const wobble = (random() + random() + random() - 1.5) * 0.18;
      x = Math.cos(angle);
      z = Math.sin(angle);
      y = Math.sin(wobble) * 0.95 + Math.sin(angle) * 0.22;
    } else {
      const u = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - u * u));
      x = ring * Math.cos(angle);
      y = u;
      z = ring * Math.sin(angle);
    }
    if (y < 0.03) y = 0.03 + Math.abs(y) * 0.35;
    const length = Math.hypot(x, y, z) || 1;
    positions[i * 3] = (x / length) * (SKY_RADIUS - 10);
    positions[i * 3 + 1] = (y / length) * (SKY_RADIUS - 10);
    positions[i * 3 + 2] = (z / length) * (SKY_RADIUS - 10);
    sizes[i] = 0.9 + random() * 1.9;
    phases[i] = random() * Math.PI * 2;
    brightness[i] = 0.5 + random() * 0.5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aBrightness', new THREE.Float32BufferAttribute(brightness, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SKY_RADIUS + 20);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelScale: { value: typeof devicePixelRatio === 'number' ? clamp(devicePixelRatio, 1, 2.5) : 1 },
      uIntensity: { value: finite(preset.starIntensity, 1.4) },
      uTwinkle: { value: finite(preset.starTwinkle, 2) },
      uColor: { value: new THREE.Color(preset.starColor) },
    },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'sky-stars';
  points.frustumCulled = false;
  points.renderOrder = -52;
  return { points, geometry, material };
}

// --- public: sky dome -------------------------------------------------------

export function createSky(track, THREE) {
  if (!THREE || !THREE.Group) throw new Error('createSky(track, THREE) needs the THREE namespace');
  const preset = skyPreset(track);
  const group = new THREE.Group();
  group.name = 'sky-environment';
  const geometries = [];
  const materials = [];
  const retainedTextures = [];

  const domeGeometry = new THREE.SphereGeometry(SKY_RADIUS, 40, 22);
  geometries.push(domeGeometry);
  const lightDir = new THREE.Vector3(preset.sunDir.x, preset.sunDir.y, preset.sunDir.z).normalize();
  const domeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(preset.top) },
      uHorizon: { value: new THREE.Color(preset.horizon) },
      uHaze: { value: new THREE.Color(preset.haze) },
      uBandColor: { value: new THREE.Color(preset.bandColor) },
      uCityColor: { value: new THREE.Color(preset.cityGlow) },
      uGroundColor: { value: new THREE.Color(preset.groundColor) },
      uLightColor: { value: new THREE.Color(preset.sunColor) },
      uLightDir: { value: lightDir },
      uHazeStrength: { value: preset.hazeStrength },
      uHazeFalloff: { value: preset.hazeFalloff },
      uBandStrength: { value: preset.bandStrength },
      uCityStrength: { value: preset.cityGlowStrength },
      uGroundStrength: { value: preset.groundStrength },
      uGradientPower: { value: preset.gradientPower },
      uLightGain: { value: preset.lightGain },
      uHaloPower: { value: preset.haloPower },
      uHaloGain: { value: preset.haloGain },
      uDiscCos: { value: preset.discCos },
      uDiscEdge: { value: preset.discEdge },
      uAirglow: { value: new THREE.Color(preset.airglow) },
    },
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.name = 'sky-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -60;
  group.add(dome);
  materials.push(domeMaterial);

  // One FBM cloud field is shared by both layers per theme family (day/night);
  // the second layer is a thinner, larger-scale layer for parallax depth.
  const family = preset.night ? 'night' : 'day';
  const clouds = [];
  const layerCount = clamp(Math.round(finite(preset.cloudLayers, 2)), 1, 2);
  const cloudTextureMap = cloudTexture(THREE, family);
  if (!retainedTextures.includes(cloudTextureMap)) retainedTextures.push(cloudTextureMap);
  const sunTint = preset.night ? preset.cityGlow : preset.sunColor;
  const hazeTint = preset.night
    ? mixHex(preset.cityGlow, preset.haze, 0.5)
    : mixHex(preset.haze, preset.bandColor, 0.35);
  // Integer horizontal scales keep the equirect seam continuous when wrapping.
  const baseScaleX = 3;
  const baseScaleY = preset.night ? 1.7 : 2.2;
  for (let layer = 0; layer < layerCount; layer++) {
    const radius = CLOUD_RADIUS - layer * 26;
    const geometry = new THREE.SphereGeometry(radius, 48, 20, 0, Math.PI * 2, 0, Math.PI * (layer ? 0.52 : 0.54));
    geometries.push(geometry);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tCloud: { value: cloudTextureMap },
        uLitColor: { value: new THREE.Color(preset.cloudColor) },
        uShadeColor: { value: new THREE.Color(preset.cloudShade) },
        uHazeColor: { value: new THREE.Color(hazeTint) },
        uSunTint: { value: new THREE.Color(sunTint) },
        uSunDir: { value: lightDir },
        uDrift: { value: new THREE.Vector2(layer ? 0.42 : 0, -0.5 * (layer ? baseScaleY * 0.92 : baseScaleY) + (layer ? 0.1 : 0)) },
        uScale: { value: new THREE.Vector2(baseScaleX + layer, layer ? baseScaleY * 0.92 : baseScaleY) },
        uCover: { value: clamp(preset.cloudCover * (layer ? 0.55 : 1), 0, 0.92) },
        uOpacity: { value: clamp(layer ? preset.cloudLayerOpacity : preset.cloudOpacity, 0, 1) },
        uSunStrength: { value: clamp(preset.cloudSunStrength * (layer ? 0.8 : 1), 0, 2) },
        uEdge: { value: clamp(preset.cloudEdge * (layer ? 1.15 : 1), 0.02, 0.4) },
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `sky-clouds-${layer}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = -50 - layer;
    group.add(mesh);
    clouds.push(mesh);
  }

  let stars = null;
  let starTime = 0;
  if (preset.starCount > 0) {
    const built = createStars(THREE, preset);
    geometries.push(built.geometry);
    materials.push(built.material);
    stars = built.points;
    group.add(stars);
  }

  let disposed = false;
  const api = {
    group,
    preset,
    retainedTextures,
    drawCalls: 1 + clouds.length + (stars ? 1 : 0),
    update(dt, reducedMotion, camera) {
      if (disposed) return api;
      const step = clamp(finite(dt, 0), 0, 0.1);
      const reduced = !!reducedMotion;
      if (camera && camera.position) group.position.copy(camera.position);
      if (reduced) return api;
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].material.uniforms.uDrift.value.x += step * preset.cloudSpeed * (i ? 0.7 : 1.1);
      }
      if (stars) {
        starTime += step;
        stars.material.uniforms.uTime.value = starTime;
      }
      return api;
    },
    // Stars are point sprites measured in device pixels; call this once with
    // renderer.getPixelRatio() when the drawing buffer is not DPR=1.
    setPixelScale(scale) {
      if (stars && Number.isFinite(scale) && scale > 0) stars.material.uniforms.uPixelScale.value = clamp(scale, 0.5, 3);
      return api;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.removeFromParent();
      group.clear();
      // `retainedTextures` are module-cached across tracks: never disposed here.
    },
  };
  return api;
}

// --- public: PMREM environment ---------------------------------------------

export function createOutdoorEnvironment(renderer, track, THREE) {
  if (!renderer || !THREE || !THREE.PMREMGenerator) throw new Error('createOutdoorEnvironment(renderer, track, THREE) needs a WebGLRenderer and the THREE namespace');
  const preset = skyPreset(track);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const random = makeRandom(preset.night ? 0x5bd1e995 : 0x1b873593);

  // Sky gradient: canvas top row is the zenith, y=256 is the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, preset.top);
  sky.addColorStop(0.28, mixHex(preset.top, preset.horizon, 0.5));
  sky.addColorStop(0.44, preset.horizon);
  sky.addColorStop(0.5, preset.haze);
  sky.addColorStop(0.55, mixHex(preset.haze, preset.groundColor, 0.55));
  sky.addColorStop(0.64, preset.groundColor);
  sky.addColorStop(1, darken(preset.groundColor, 0.55));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 512);

  // Equirect position of the sun/moon.
  const dir = preset.sunDir;
  const dirLength = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const u = (Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5) * 1024;
  const v = Math.asin(clamp(dir.y / dirLength, -1, 1)) / Math.PI + 0.5;
  const sunX = u;
  const sunY = (1 - v) * 512;
  const glowRadius = preset.night ? 74 : 170;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, glowRadius);
  glow.addColorStop(0, rgba(preset.sunColor, preset.night ? 0.6 : 0.85));
  glow.addColorStop(0.2, rgba(preset.sunColor, preset.night ? 0.22 : 0.4));
  glow.addColorStop(0.55, rgba(preset.sunColor, preset.night ? 0.07 : 0.14));
  glow.addColorStop(1, rgba(preset.sunColor, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sunX, sunY, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = preset.night ? '#f4f6f2' : '#fff6d8';
  ctx.beginPath();
  ctx.arc(sunX, sunY, preset.night ? 7 : 16, 0, Math.PI * 2);
  ctx.fill();
  if (preset.night) {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(190,198,210,${0.1 + random() * 0.14})`;
      ctx.beginPath();
      ctx.arc(sunX + (random() - 0.5) * 10, sunY + (random() - 0.5) * 10, 1 + random() * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Stars above the horizon (equirect row < 256), kept away from the moon.
  if (preset.night) {
    for (let i = 0; i < 460; i++) {
      const x = random() * 1024;
      const y = random() * 244;
      if (Math.hypot(x - sunX, y - sunY) < 66) continue;
      const size = random() < 0.12 ? 2 : 1;
      ctx.fillStyle = `rgba(${210 + Math.floor(random() * 40)},${218 + Math.floor(random() * 30)},255,${(0.16 + random() * 0.72).toFixed(3)})`;
      ctx.fillRect(x, y, size, size);
    }
  }

  // Clouds: the same soft blob language as the sky dome, with seam repeats.
  const day = !preset.night;
  for (let i = 0; i < (day ? 92 : 46); i++) {
    const x = random() * 1024;
    const y = day ? 58 + random() * 170 : 150 + random() * 96;
    const radiusX = (day ? 34 : 46) + random() * (day ? 130 : 150);
    const radiusY = radiusX * (day ? 0.26 : 0.16) * (0.55 + random() * 0.85);
    const alpha = (day ? 0.1 : 0.08) + random() * (day ? 0.2 : 0.16);
    drawCloudBlob(ctx, x, y, radiusX, radiusY, alpha);
    if (x < radiusX) drawCloudBlob(ctx, x + 1024, y, radiusX, radiusY, alpha);
    if (x > 1024 - radiusX) drawCloudBlob(ctx, x - 1024, y, radiusX, radiusY, alpha);
  }

  if (preset.night) {
    // Light pollution hugging the skyline.
    for (let i = 0; i < 7; i++) {
      const x = (i / 7) * 1024 + random() * 70;
      const radius = 90 + random() * 150;
      const pollution = ctx.createRadialGradient(x, 250, 0, x, 250, radius);
      pollution.addColorStop(0, rgba(preset.cityGlow, 0.3));
      pollution.addColorStop(0.5, rgba(preset.cityGlow, 0.1));
      pollution.addColorStop(1, rgba(preset.cityGlow, 0));
      ctx.fillStyle = pollution;
      ctx.fillRect(x - radius, 160, radius * 2, 180);
    }
    // Skyline silhouette with lit windows (also feeds night reflections).
    let x = 0;
    while (x < 1024) {
      const width = 8 + random() * 26;
      const height = 6 + random() * 26;
      ctx.fillStyle = `rgba(6,10,18,${(0.55 + random() * 0.3).toFixed(3)})`;
      ctx.fillRect(x, 258 - height, width, height);
      for (let windowY = 258 - height + 3; windowY < 254; windowY += 4) {
        for (let windowX = x + 2; windowX < x + width - 2; windowX += 3) {
          if (random() < 0.26) {
            ctx.fillStyle = random() < 0.5 ? rgba(preset.cityGlow, 0.9) : 'rgba(255,214,150,0.75)';
            ctx.fillRect(windowX, windowY, 1, 1);
          }
        }
      }
      x += width + 2 + random() * 10;
    }
    const horizonGlow = ctx.createLinearGradient(0, 236, 0, 270);
    horizonGlow.addColorStop(0, rgba(preset.cityGlow, 0));
    horizonGlow.addColorStop(0.5, rgba(preset.cityGlow, 0.34));
    horizonGlow.addColorStop(1, rgba(preset.cityGlow, 0));
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, 236, 1024, 34);
  } else {
    // Warm haze band plus a low-contrast distant landmass so the reflections
    // have a horizon instead of a flat gradient.
    const hazeBand = ctx.createLinearGradient(0, 210, 0, 268);
    hazeBand.addColorStop(0, rgba(preset.sunColor, 0));
    hazeBand.addColorStop(0.62, rgba(preset.sunColor, 0.26));
    hazeBand.addColorStop(1, rgba(preset.sunColor, 0));
    ctx.fillStyle = hazeBand;
    ctx.fillRect(0, 210, 1024, 58);
    let x = 0;
    while (x < 1024) {
      const width = 46 + random() * 150;
      const height = 3 + random() * 11;
      ctx.fillStyle = `rgba(62,74,66,${(0.12 + random() * 0.14).toFixed(3)})`;
      ctx.fillRect(x, 252 - height, width, height + 4);
      x += width + random() * 36;
    }
  }

  // Ground band: dark, matte, slightly warmer near the horizon for bounce.
  const ground = ctx.createLinearGradient(0, 256, 0, 512);
  ground.addColorStop(0, mixHex(preset.groundColor, '#000000', 0.08));
  ground.addColorStop(0.35, mixHex(preset.groundColor, '#000000', 0.3));
  ground.addColorStop(1, '#05070a');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = ground;
  ctx.globalAlpha = preset.night ? 0.55 : 0.4;
  ctx.fillRect(0, 256, 1024, 256);
  ctx.globalAlpha = 1;

  const equirect = new THREE.CanvasTexture(canvas);
  equirect.colorSpace = THREE.SRGBColorSpace;
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.minFilter = THREE.LinearFilter;
  equirect.magFilter = THREE.LinearFilter;
  equirect.generateMipmaps = false;
  equirect.name = `sky-equirect-${preset.id}`;
  equirect.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  let target;
  try {
    target = pmrem.fromEquirectangular(equirect);
  } finally {
    pmrem.dispose();
    equirect.dispose();
  }
  let disposed = false;
  return {
    texture: target.texture,
    dispose() {
      if (disposed) return;
      disposed = true;
      target.dispose();
    },
  };
}
