// Procedural surface-texture library for the premium scenery pass.
// This module deliberately never imports the vendor Three build: every entry point
// receives the THREE namespace from its caller (same pattern as light-show.js), so
// the scene and these textures always share one Three instance.
//
// Textures are generated once per Three namespace, cached by name and handed back to
// callers as retained assets. A world rebuild reuses the exact same Texture objects;
// scene disposal must leave them alone (see retainedTextures()).
//
// All art is deterministic: a seeded PRNG per texture keeps every race identical.
// Albedo / card / sign maps use sRGB; roughness, normal and data maps stay linear.
const TAU = Math.PI * 2;
const stores = new WeakMap();

function hashString(value) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(random) {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) table[i] = random() * 2 - 1;
  const pick = (x, y) => table[((x & 255) + ((y & 255) * 61)) & 255];
  const smooth = t => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = pick(xi, yi), b = pick(xi + 1, yi), c = pick(xi, yi + 1), d = pick(xi + 1, yi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  noise.fbm = (x, y, octaves = 4, gain = .5) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) { sum += noise(x * freq, y * freq) * amp; norm += amp; amp *= gain; freq *= 2.03; }
    return sum / Math.max(1e-5, norm);
  };
  return noise;
}
function canvas2d(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return {canvas, ctx: canvas.getContext('2d')};
}
function createTexture(lib, canvas, name, options = {}) {
  const THREE = lib.THREE, texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = options.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = options.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.anisotropy = lib.anisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.userData.retained = true;
  texture.userData.generated = 'surface-textures';
  return texture;
}
function normalMap(lib, size, heightAt, name, strength = 2.6) {
  const {canvas, ctx} = canvas2d(size);
  const image = ctx.createImageData(size, size), data = image.data;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) heights[y * size + x] = heightAt(x / size, y / size, x, y);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const left = heights[y * size + ((x - 1 + size) % size)], right = heights[y * size + ((x + 1) % size)];
    const up = heights[((y - 1 + size) % size) * size + x], down = heights[((y + 1) % size) * size + x];
    let nx = (left - right) * strength, ny = (up - down) * strength, nz = 1;
    const length = Math.hypot(nx, ny, nz); nx /= length; ny /= length; nz /= length;
    data[i] = (nx * .5 + .5) * 255; data[i + 1] = (ny * .5 + .5) * 255; data[i + 2] = (nz * .5 + .5) * 255; data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return createTexture(lib, canvas, name, {srgb: false});
}

// ---------------------------------------------------------------------------
// World surfaces
// ---------------------------------------------------------------------------
function asphalt(lib) {
  const size = 512, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('asphalt')), noise = makeNoise(random);
  const image = ctx.createImageData(size, size), data = image.data;
  const wear = u => Math.exp(-(((u - .18) / .07) ** 2)) * 18 + Math.exp(-(((u - .33) / .065) ** 2)) * 13
    + Math.exp(-(((u - .67) / .065) ** 2)) * 13 + Math.exp(-(((u - .82) / .07) ** 2)) * 18;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, u = x / size;
    const grain = noise(x * .9, y * .9) * 24 + noise(x * 3.4, y * 3.4) * 11 + (random() - .5) * 22;
    const blotch = noise.fbm(x * .026, y * .026, 3) * 13;
    let v = 57 + grain * .72 + blotch - wear(u);
    if (random() < .0035) v += 46; else if (random() < .0045) v -= 26;
    data[i] = Math.max(0, v * .93); data[i + 1] = Math.max(0, v * .99); data[i + 2] = Math.min(255, v * 1.07 + 3); data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  // Repair patches read as scale and maintenance history.
  for (let p = 0; p < 6; p++) {
    const x = random() * size * .72, y = random() * size * .7, w = 52 + random() * 128, h = 64 + random() * 168;
    ctx.save();
    ctx.globalAlpha = .55; ctx.fillStyle = p % 2 ? '#4a5053' : '#34393c'; ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = .85; ctx.strokeStyle = '#23272a'; ctx.lineWidth = 2.2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.globalAlpha = .2;
    for (let k = 0; k < 110; k++) { ctx.fillStyle = k % 2 ? '#8e9394' : '#1e2224'; ctx.fillRect(x + random() * w, y + random() * h, 1 + random() * 3, 1 + random() * 2); }
    ctx.restore();
  }
  // Cracks and tar snakes break the tiling grid.
  for (let c = 0; c < 15; c++) {
    let x = random() * size, y = random() * size, angle = random() * TAU;
    ctx.strokeStyle = c % 3 ? 'rgba(20,23,25,.85)' : 'rgba(13,15,16,.7)';
    ctx.lineWidth = .8 + random() * 1.6; ctx.beginPath(); ctx.moveTo(x, y);
    for (let step = 0; step < 18; step++) {
      angle += (random() - .5) * .8; x += Math.cos(angle) * (3 + random() * 9); y += Math.sin(angle) * (3 + random() * 9);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let s = 0; s < 5; s++) {
    ctx.strokeStyle = 'rgba(16,17,18,.55)'; ctx.lineWidth = 2 + random() * 3; ctx.beginPath();
    const y = random() * size; ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * .03 + s) * 5 + (random() - .5) * 3);
    ctx.stroke();
  }
  return createTexture(lib, canvas, 'asphalt');
}
function asphaltRoughness(lib) {
  const size = 256, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('asphalt-roughness')), noise = makeNoise(random);
  const image = ctx.createImageData(size, size), data = image.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, u = x / size;
    const wear = Math.exp(-(((u - .18) / .08) ** 2)) * 55 + Math.exp(-(((u - .33) / .075) ** 2)) * 44
      + Math.exp(-(((u - .67) / .075) ** 2)) * 44 + Math.exp(-(((u - .82) / .08) ** 2)) * 55;
    const patch = Math.max(0, Math.sin(x * .09 + noise(y * .06, 2) * 3) * Math.sin(y * .07)) * 22;
    const value = 206 + noise(x * 1.1, y * 1.1) * 34 + (random() - .5) * 16 - wear + patch * .4;
    data[i] = data[i + 1] = data[i + 2] = Math.max(30, Math.min(255, value)); data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return createTexture(lib, canvas, 'asphaltRoughness', {srgb: false});
}
function asphaltNormal(lib) {
  const noise = makeNoise(mulberry32(hashString('asphalt-normal')));
  return normalMap(lib, 256, (u, v, x, y) => {
    const grain = noise(x * 1.6, y * 1.6) * .5 + noise(x * 4.2, y * 4.2) * .22;
    const crack = Math.abs(noise.fbm(x * .035, y * .035, 2)) < .02 ? -.5 : 0;
    const patch = Math.sin(u * 19 + v * 3) * Math.sin(v * 17) * .08;
    return grain + crack + patch;
  }, 'asphaltNormal', 2.4);
}
function shoulder(lib) {
  const size = 256, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('shoulder')), noise = makeNoise(random);
  const image = ctx.createImageData(size, size), data = image.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const grain = noise(x * 1.5, y * 1.5) * 22 + (random() - .5) * 26 + noise.fbm(x * .03, y * .03, 3) * 16;
    const v = 92 + grain * .8;
    data[i] = v * 1.03; data[i + 1] = v * .99; data[i + 2] = v * .9; data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  for (let k = 0; k < 260; k++) {
    ctx.fillStyle = random() < .5 ? 'rgba(58,55,48,.55)' : 'rgba(151,144,126,.45)';
    ctx.beginPath(); ctx.ellipse(random() * size, random() * size, 1 + random() * 2.6, 1 + random() * 2, random() * TAU, 0, TAU); ctx.fill();
  }
  return createTexture(lib, canvas, 'shoulder');
}
function curb(lib) {
  const {canvas, ctx} = canvas2d(256, 64);
  const random = mulberry32(hashString('curb'));
  for (let i = 0; i < 4; i++) {
    const x = i * 64, red = i % 2 === 0;
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, red ? '#c3483a' : '#d8d3c2'); gradient.addColorStop(.55, red ? '#a5362a' : '#c6c0ad'); gradient.addColorStop(1, red ? '#7e2820' : '#a8a290');
    ctx.fillStyle = gradient; ctx.fillRect(x, 0, 64, 64);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x, 0, 2, 64);
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(x + 2, 0, 2, 64);
    for (let k = 0; k < 70; k++) { ctx.fillStyle = random() < .5 ? 'rgba(40,35,30,.28)' : 'rgba(240,235,220,.18)'; ctx.fillRect(x + random() * 62, random() * 64, 1 + random() * 3, 1 + random() * 2); }
    ctx.fillStyle = 'rgba(25,22,20,.5)'; ctx.fillRect(x, 0, 64, 3); ctx.fillRect(x, 61, 64, 3);
  }
  return createTexture(lib, canvas, 'curb');
}
function gravel(lib) {
  const size = 256, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('gravel')), noise = makeNoise(random);
  ctx.fillStyle = '#5a564c'; ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < 950; k++) {
    const x = random() * size, y = random() * size, r = 1.3 + random() * 4.6, tone = .45 + random() * .8;
    ctx.fillStyle = `rgb(${(120 * tone) | 0},${(112 * tone) | 0},${(98 * tone) | 0})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (.55 + random() * .35), random() * TAU, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(25,23,20,${.25 + random() * .3})`;
    ctx.beginPath(); ctx.ellipse(x + r * .28, y + r * .34, r * .72, r * .4, random() * TAU, 0, TAU); ctx.fill();
  }
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = noise(i * .013, 5) * 10;
    image.data[i] += n; image.data[i + 1] += n; image.data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
  return createTexture(lib, canvas, 'gravel');
}
function sand(lib) {
  const size = 256, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('sand')), noise = makeNoise(random);
  const image = ctx.createImageData(size, size), data = image.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const ripple = Math.sin((y + noise(x * .02, y * .02) * 12) * .21) * 11 + Math.sin(x * .05 + y * .12) * 5;
    const grain = noise(x * 2.4, y * 2.4) * 14 + (random() - .5) * 18;
    data[i] = 196 + ripple * .7 + grain; data[i + 1] = 176 + ripple * .6 + grain * .95; data[i + 2] = 137 + ripple * .45 + grain * .8; data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  for (let k = 0; k < 220; k++) {
    ctx.fillStyle = random() < .6 ? 'rgba(120,100,72,.4)' : 'rgba(245,238,220,.5)';
    ctx.fillRect(random() * size, random() * size, 1, 1);
  }
  return createTexture(lib, canvas, 'sand');
}
function grass(lib) {
  const size = 512, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('grass')), noise = makeNoise(random);
  ctx.fillStyle = '#55663a'; ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) {
    const patch = noise.fbm(x * .014, y * .014, 3) * .5 + .5;
    const tone = .7 + patch * .55 + noise(x * .12, y * .12) * .1;
    ctx.fillStyle = `rgb(${(74 * tone) | 0},${(88 * tone) | 0},${(49 * tone) | 0})`;
    ctx.fillRect(x, y, 2, 2);
  }
  for (let k = 0; k < 5200; k++) {
    const x = random() * size, y = random() * size, h = 2 + random() * 5, bend = (random() - .5) * 3;
    ctx.strokeStyle = random() < .22 ? 'rgba(150,152,82,.5)' : `rgba(${56 + random() * 32 | 0},${78 + random() * 38 | 0},${34 + random() * 22 | 0},.62)`;
    ctx.lineWidth = .8 + random(); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + bend, y - h * .5, x + bend * 2, y - h); ctx.stroke();
  }
  for (let k = 0; k < 90; k++) { ctx.fillStyle = random() < .5 ? '#cfc27a' : '#d8d3aa'; ctx.fillRect(random() * size, random() * size, 1.6, 1.6); }
  return createTexture(lib, canvas, 'grass');
}
function grassTuft(lib) {
  const size = 128, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('grass-tuft'));
  for (let k = 0; k < 30; k++) {
    const baseX = 64 + (random() - .5) * 26, height = 42 + random() * 78, bend = (random() - .5) * 42;
    const gradient = ctx.createLinearGradient(baseX, size, baseX + bend, size - height);
    gradient.addColorStop(0, `rgba(${48 + random() * 18 | 0},${68 + random() * 22 | 0},${30 + random() * 14 | 0},1)`);
    gradient.addColorStop(1, `rgba(${116 + random() * 40 | 0},${138 + random() * 34 | 0},${62 + random() * 26 | 0},.92)`);
    ctx.strokeStyle = gradient; ctx.lineWidth = 1.6 + random() * 2.2; ctx.beginPath();
    ctx.moveTo(baseX, size); ctx.quadraticCurveTo(baseX + bend * .3, size - height * .55, baseX + bend, size - height); ctx.stroke();
  }
  for (let k = 0; k < 8; k++) {
    ctx.fillStyle = 'rgba(196,184,120,.92)'; ctx.beginPath();
    ctx.ellipse(64 + (random() - .5) * 78, 18 + random() * 36, 1.6, 4 + random() * 4, (random() - .5) * .7, 0, TAU); ctx.fill();
  }
  return createTexture(lib, canvas, 'grassTuft', {clamp: true});
}
function dryShrub(lib) {
  const size = 128, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('dry-shrub'));
  for (let k = 0; k < 34; k++) {
    const angle = -Math.PI / 2 + (random() - .5) * 2.1, length = 24 + random() * 52;
    const x = 64 + (random() - .5) * 14, y = size - 2;
    ctx.strokeStyle = `rgba(${92 + random() * 40 | 0},${72 + random() * 30 | 0},${42 + random() * 20 | 0},.95)`;
    ctx.lineWidth = 1 + random() * 1.7; ctx.beginPath(); ctx.moveTo(x, y);
    const tipX = x + Math.cos(angle) * length, tipY = y + Math.sin(angle) * length;
    ctx.quadraticCurveTo(x + Math.cos(angle) * length * .45, y + Math.sin(angle) * length * .45 - 5, tipX, tipY); ctx.stroke();
    for (let leaf = 0; leaf < 4; leaf++) {
      const t = .45 + leaf * .14;
      ctx.fillStyle = `rgba(${104 + random() * 42 | 0},${104 + random() * 36 | 0},${58 + random() * 26 | 0},.9)`;
      ctx.beginPath(); ctx.ellipse(x + (tipX - x) * t, y + (tipY - y) * t, 2.2 + random() * 2, 1.1, angle, 0, TAU); ctx.fill();
    }
  }
  return createTexture(lib, canvas, 'dryShrub', {clamp: true});
}
function bark(lib) {
  const {canvas, ctx} = canvas2d(128, 256);
  const random = mulberry32(hashString('bark')), noise = makeNoise(random);
  for (let x = 0; x < 128; x++) {
    const tone = noise(x * .06, 2) * 26 + noise(x * .18, 6) * 12;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, `rgb(${86 + tone | 0},${72 + tone * .8 | 0},${55 + tone * .6 | 0})`);
    gradient.addColorStop(1, `rgb(${62 + tone | 0},${52 + tone * .8 | 0},${40 + tone * .6 | 0})`);
    ctx.fillStyle = gradient; ctx.fillRect(x, 0, 1, 256);
  }
  for (let k = 0; k < 70; k++) {
    let x = random() * 128, y = random() * 256;
    ctx.strokeStyle = random() < .55 ? 'rgba(38,30,22,.75)' : 'rgba(126,106,80,.5)';
    ctx.lineWidth = .8 + random() * 2.4; ctx.beginPath(); ctx.moveTo(x, y);
    for (let step = 0; step < 9; step++) { x += (random() - .5) * 4; y += 8 + random() * 14; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  for (let k = 0; k < 6; k++) {
    const x = random() * 128, y = random() * 256, r = 3 + random() * 5;
    ctx.fillStyle = 'rgba(30,24,18,.8)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(120,100,74,.45)'; ctx.beginPath(); ctx.ellipse(x, y - r, r * 1.1, r * .6, 0, 0, TAU); ctx.fill();
  }
  return createTexture(lib, canvas, 'bark');
}
function leafBroad(lib) {
  const size = 128, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('leaf-broad'));
  const leaves = 11;
  for (let i = 0; i < leaves; i++) {
    const angle = random() * TAU, distance = 12 + random() * 34, x = 64 + Math.cos(angle) * distance, y = 64 + Math.sin(angle) * distance * .8;
    const w = 10 + random() * 12, h = 5 + random() * 6;
    const gradient = ctx.createLinearGradient(x - w, y, x + w, y);
    gradient.addColorStop(0, `rgb(${38 + random() * 16 | 0},${64 + random() * 22 | 0},${32 + random() * 16 | 0})`);
    gradient.addColorStop(1, `rgb(${80 + random() * 34 | 0},${112 + random() * 34 | 0},${48 + random() * 22 | 0})`);
    ctx.fillStyle = gradient; ctx.save(); ctx.translate(x, y); ctx.rotate(angle + .4);
    ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(26,42,20,.6)'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(-w * .9, 0); ctx.lineTo(w * .9, 0); ctx.stroke();
    ctx.restore();
  }
  return createTexture(lib, canvas, 'leafBroad', {clamp: true});
}
function leafPine(lib) {
  const size = 128, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('leaf-pine'));
  for (let branch = 0; branch < 6; branch++) {
    const angle = -Math.PI / 2 + (branch - 2.5) * .34, length = 34 + random() * 26;
    const x0 = 64, y0 = 116, x1 = x0 + Math.cos(angle) * length, y1 = y0 + Math.sin(angle) * length;
    ctx.strokeStyle = `rgba(${42 + random() * 20 | 0},${62 + random() * 22 | 0},${36 + random() * 16 | 0},.95)`;
    ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    for (let n = 0; n < 17; n++) {
      const t = n / 17, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t, side = n % 2 ? 1 : -1;
      const needle = 5 + random() * 8;
      ctx.strokeStyle = `rgba(${52 + random() * 26 | 0},${88 + random() * 30 | 0},${44 + random() * 22 | 0},.92)`;
      ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(px + side * needle * .8 + Math.cos(angle) * needle * .3, py + needle * .55 + Math.sin(angle) * needle * .2); ctx.stroke();
    }
  }
  return createTexture(lib, canvas, 'leafPine', {clamp: true});
}
function palmFrond(lib) {
  const {canvas, ctx} = canvas2d(256, 128);
  const random = mulberry32(hashString('palm-frond'));
  // Broad curved rachis from the left, leaflets fanning and tapering toward the tip.
  const rachis = t => ({x: 8 + t * 240, y: 66 - Math.pow(t, .8) * 22 - t * t * 6});
  ctx.strokeStyle = '#5c7434'; ctx.lineWidth = 4.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(8, 66);
  for (let i = 1; i <= 16; i++) { const p = rachis(i / 16); ctx.lineTo(p.x, p.y); }
  ctx.stroke();
  for (let i = 0; i < 44; i++) {
    const t = i / 44, root = rachis(t), length = (40 - t * 22) * (1 + random() * .18);
    for (const side of [-1, 1]) {
      const angle = side * (1.12 - t * .3) + (random() - .5) * .12;
      const tipX = root.x + Math.cos(angle) * length * .34, tipY = root.y + Math.sin(angle) * length;
      const gradient = ctx.createLinearGradient(root.x, root.y, tipX, tipY);
      gradient.addColorStop(0, `rgb(${52 + random() * 14 | 0},${86 + random() * 20 | 0},${40 + random() * 14 | 0})`);
      gradient.addColorStop(.6, `rgb(${94 + random() * 26 | 0},${128 + random() * 26 | 0},${56 + random() * 18 | 0})`);
      gradient.addColorStop(1, `rgb(${126 + random() * 34 | 0},${156 + random() * 26 | 0},${72 + random() * 22 | 0})`);
      ctx.strokeStyle = gradient; ctx.lineWidth = 1.7 + random() * 1.9;
      ctx.beginPath(); ctx.moveTo(root.x, root.y);
      ctx.quadraticCurveTo(root.x + Math.cos(angle) * length * .2, root.y + Math.sin(angle) * length * .62, tipX, tipY);
      ctx.stroke();
    }
  }
  // A few dead/brown leaflets add age to the crown.
  for (let i = 0; i < 9; i++) {
    const t = .25 + random() * .6, root = rachis(t), length = 22 + random() * 16;
    const angle = (random() < .5 ? -1 : 1) * (1.08 - t * .26);
    ctx.strokeStyle = `rgba(${128 + random() * 26 | 0},${104 + random() * 20 | 0},${58 + random() * 16 | 0},.9)`;
    ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(root.x, root.y); ctx.lineTo(root.x + Math.cos(angle) * length * .3, root.y + Math.sin(angle) * length); ctx.stroke();
  }
  return createTexture(lib, canvas, 'palmFrond', {clamp: true});
}
function palmBark(lib) {
  const {canvas, ctx} = canvas2d(128, 256);
  const random = mulberry32(hashString('palm-bark')), noise = makeNoise(random);
  ctx.fillStyle = '#8a7458'; ctx.fillRect(0, 0, 128, 256);
  // Fibrous vertical grain.
  for (let x = 0; x < 128; x += 1) {
    const tone = noise(x * .06, 3) * 26 + noise(x * .2, 8) * 12 + (random() - .5) * 14;
    ctx.fillStyle = `rgb(${132 + tone | 0},${112 + tone * .8 | 0},${84 + tone * .6 | 0})`;
    ctx.fillRect(x, 0, 1, 256);
  }
  // Horizontal leaf-scar rings of a palm trunk.
  let y = 6;
  while (y < 256) {
    const thickness = 2 + random() * 3.4;
    ctx.fillStyle = `rgba(48,38,26,${.45 + random() * .25})`; ctx.fillRect(0, y, 128, thickness);
    ctx.fillStyle = 'rgba(210,190,158,.28)'; ctx.fillRect(0, y + thickness, 128, 1.6);
    ctx.fillStyle = 'rgba(28,22,16,.28)'; ctx.fillRect(0, y - 1.5, 128, 1.2);
    // Slight chevron break under each ring.
    ctx.strokeStyle = 'rgba(40,32,22,.4)'; ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) { const x = random() * 128; ctx.beginPath(); ctx.moveTo(x, y + thickness); ctx.lineTo(x + 3, y + thickness + 5); ctx.stroke(); }
    y += 11 + random() * 15;
  }
  for (let k = 0; k < 90; k++) {
    ctx.fillStyle = random() < .5 ? 'rgba(0,0,0,.18)' : 'rgba(230,214,184,.14)';
    ctx.fillRect(random() * 128, random() * 256, 1 + random() * 2, 1 + random() * 5);
  }
  return createTexture(lib, canvas, 'palmBark');
}
function rock(lib) {
  const size = 512, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('rock')), noise = makeNoise(random);
  const palette = [[186, 156, 116], [166, 137, 100], [204, 176, 134], [158, 128, 94], [192, 164, 124], [174, 146, 108]];
  let y = 0, band = 0;
  while (y < size) {
    const height = 14 + random() * 46, color = palette[band % palette.length];
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, `rgb(${color[0] * 1.14 | 0},${color[1] * 1.14 | 0},${color[2] * 1.14 | 0})`);
    gradient.addColorStop(1, `rgb(${color[0] * .82 | 0},${color[1] * .82 | 0},${color[2] * .82 | 0})`);
    ctx.fillStyle = gradient; ctx.fillRect(0, y, size, height + 1);
    ctx.fillStyle = 'rgba(48,36,26,.55)'; ctx.fillRect(0, y, size, 1.6);
    ctx.fillStyle = 'rgba(236,218,186,.16)'; ctx.fillRect(0, y + 2, size, 1);
    y += height; band++;
  }
  const image = ctx.getImageData(0, 0, size, size), data = image.data;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = (py * size + px) * 4;
    const grain = noise(px * .7, py * .7) * 17 + noise(px * 2.6, py * 2.6) * 9 + (random() - .5) * 14;
    const streak = noise(px * .022, py * .09) * 13;
    data[i] = Math.max(0, Math.min(255, data[i] + grain + streak));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grain + streak));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grain * .9 + streak));
  }
  ctx.putImageData(image, 0, 0);
  // Erosion gullies + cracks carve the strata.
  for (let k = 0; k < 26; k++) {
    let x = random() * size, y2 = random() * size;
    ctx.strokeStyle = `rgba(${40 + random() * 24 | 0},${31 + random() * 18 | 0},${23 + random() * 14 | 0},${.28 + random() * .3})`;
    ctx.lineWidth = .8 + random() * 2.1; ctx.beginPath(); ctx.moveTo(x, y2);
    for (let step = 0; step < 22; step++) { x += (random() - .5) * 7; y2 += 4 + random() * 11; ctx.lineTo(x, y2); }
    ctx.stroke();
  }
  return createTexture(lib, canvas, 'rock');
}
function rockNormal(lib) {
  const noise = makeNoise(mulberry32(hashString('rock-normal')));
  return normalMap(lib, 256, (u, v, x, y) => {
    const bands = Math.sin(v * 52 + noise(x * .03, y * .02) * 9) * .22;
    return noise(x * .9, y * .9) * .5 + noise(x * 3.1, y * 3.1) * .2 + bands;
  }, 'rockNormal', 2.8);
}
function ridgeTexture(name, {height = .62, rough = .5, base = '#5f7472', top = '#7d8f8a', haze = 0, seed}) {
  return lib => {
    const {canvas, ctx} = canvas2d(1024, 256);
    const random = mulberry32(hashString(name)), noise = makeNoise(random);
    const profile = x => {
      let sum = 0, amp = 1, freq = .004 + rough * .004;
      for (let o = 0; o < 5; o++) { sum += noise(x * freq + seed, o * 13.7) * amp; amp *= .52; freq *= 2.1; }
      return 256 - (86 + sum * 74) * height;
    };
    const gradient = ctx.createLinearGradient(0, 80, 0, 256);
    gradient.addColorStop(0, top); gradient.addColorStop(1, base);
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(0, 256);
    for (let x = 0; x <= 1024; x += 4) ctx.lineTo(x, profile(x));
    ctx.lineTo(1024, 256); ctx.closePath(); ctx.fill();
    // Secondary closer ridge for silhouette layering inside the card.
    ctx.fillStyle = base; ctx.beginPath(); ctx.moveTo(0, 256);
    for (let x = 0; x <= 1024; x += 4) ctx.lineTo(x, profile(x) + 26 + noise(x * .01, 44) * 18);
    ctx.lineTo(1024, 256); ctx.closePath(); ctx.fill();
    if (haze > 0) {
      const hazeGradient = ctx.createLinearGradient(0, 190, 0, 256);
      hazeGradient.addColorStop(0, `rgba(${haze},${haze},${haze},0)`); hazeGradient.addColorStop(1, `rgba(${haze},${haze},${haze},.9)`);
      ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = hazeGradient; ctx.fillRect(0, 120, 1024, 136); ctx.globalCompositeOperation = 'source-over';
    }
    const texture = createTexture(lib, canvas, name, {clamp: true});
    texture.wrapS = lib.THREE.RepeatWrapping;
    return texture;
  };
}
const WINDOW_STYLES = {
  windows: {name: 'windows', columns: 20, rows: 30, lit: .3, frame: '#0c1014', glass: '#1b2732', warm: ['#e6cfa2', '#f0dfba', '#d9c49a'], cool: ['#bcd4e8', '#cfe0ee', '#a8c2da'], mullionEvery: 1, floorBand: true, balcony: false, grime: .5},
  windowsResidential: {name: 'windowsResidential', columns: 16, rows: 26, lit: .36, frame: '#141414', glass: '#202a30', warm: ['#f0d9ac', '#eacf9c', '#ffe7c2'], cool: ['#c6dcea', '#d8e6ef'], mullionEvery: 2, floorBand: true, balcony: true, grime: .65},
  windowsGlass: {name: 'windowsGlass', columns: 14, rows: 22, lit: .22, frame: '#0a1016', glass: '#273842', warm: ['#d8c9a6', '#c9d9e6'], cool: ['#a9c7dd', '#c2d8e8', '#8fb4cc'], mullionEvery: 2, floorBand: false, balcony: false, spandrel: true, grime: .3},
  windowsFar: {name: 'windowsFar', columns: 26, rows: 34, lit: .18, frame: '#0b0e12', glass: '#161d26', warm: ['#c8b28a', '#d6c39c'], cool: ['#a9bfd2', '#bccfdf'], mullionEvery: 2, floorBand: true, balcony: false, grime: .4, dim: .55},
};
// One generator per style: the albedo and its emissive mask are produced as a pair
// so lit windows line up exactly.
function windowsGenerate(lib, style) {
  if (lib.textures.has(style.name)) return;
  const size = 512, random = mulberry32(hashString(style.name));
  const albedo = canvas2d(size), emissive = canvas2d(size);
  const base = albedo.ctx.createLinearGradient(0, 0, 0, size);
  base.addColorStop(0, '#1a232b'); base.addColorStop(.55, '#151d24'); base.addColorStop(1, '#111820');
  albedo.ctx.fillStyle = base; albedo.ctx.fillRect(0, 0, size, size);
  emissive.ctx.fillStyle = '#000000'; emissive.ctx.fillRect(0, 0, size, size);
  const cw = size / style.columns, ch = size / style.rows;
  for (let row = 0; row < style.rows; row++) for (let column = 0; column < style.columns; column++) {
    const x = column * cw, y = row * ch;
    const insetX = cw * .18, insetY = ch * .24;
    const wx = x + insetX, wy = y + insetY, ww = cw - insetX * 2, wh = ch - insetY * 1.9;
    // Frame / reveal.
    albedo.ctx.fillStyle = style.frame; albedo.ctx.fillRect(wx - 1.6, wy - 1.6, ww + 3.2, wh + 3.2);
    if (style.spandrel) {
      albedo.ctx.fillStyle = '#202b33'; albedo.ctx.fillRect(x, y + ch - ch * .2, cw, ch * .2);
    }
    const lit = random() < style.lit;
    if (lit) {
      const warm = random() < .58, palette = warm ? style.warm : style.cool;
      const color = palette[(random() * palette.length) | 0];
      const brightness = .55 + random() * .45;
      albedo.ctx.fillStyle = color; albedo.ctx.globalAlpha = .55 + brightness * .35; albedo.ctx.fillRect(wx, wy, ww, wh); albedo.ctx.globalAlpha = 1;
      // Curtains / blinds break the flat block.
      if (random() < .5) { albedo.ctx.fillStyle = 'rgba(40,44,50,.35)'; albedo.ctx.fillRect(wx, wy, ww, wh * (.15 + random() * .4)); }
      emissive.ctx.fillStyle = color; emissive.ctx.globalAlpha = (style.dim || 1) * (.35 + brightness * .5); emissive.ctx.fillRect(wx, wy, ww, wh); emissive.ctx.globalAlpha = 1;
      if (random() < .4) { emissive.ctx.fillStyle = 'rgba(0,0,0,.62)'; emissive.ctx.fillRect(wx, wy + wh * (.35 + random() * .3), ww, wh * .12); }
    } else {
      const glass = albedo.ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      glass.addColorStop(0, style.glass); glass.addColorStop(.55, '#0f161d'); glass.addColorStop(1, '#233039');
      albedo.ctx.fillStyle = glass; albedo.ctx.fillRect(wx, wy, ww, wh);
      albedo.ctx.fillStyle = 'rgba(180,205,225,.09)'; albedo.ctx.fillRect(wx, wy, ww, Math.max(1, wh * .16));
      if (random() < .18) { albedo.ctx.fillStyle = 'rgba(220,210,180,.18)'; albedo.ctx.fillRect(wx, wy, ww * (.3 + random() * .4), wh); }
    }
    // Window cross-bars.
    albedo.ctx.fillStyle = 'rgba(10,13,16,.75)';
    albedo.ctx.fillRect(wx + ww * .5 - .7, wy, 1.4, wh);
    albedo.ctx.fillRect(wx, wy + wh * .5 - .7, ww, 1.4);
  }
  // Floor bands and vertical mullions give the facade real structure.
  for (let row = 0; row <= style.rows; row++) if (style.floorBand) {
    const y = row * ch;
    albedo.ctx.fillStyle = 'rgba(8,11,14,.92)'; albedo.ctx.fillRect(0, y - ch * .1, size, ch * .12);
    albedo.ctx.fillStyle = 'rgba(130,142,152,.16)'; albedo.ctx.fillRect(0, y - ch * .1, size, 1.2);
  }
  for (let column = 0; column <= style.columns; column += style.mullionEvery) {
    const x = column * cw;
    albedo.ctx.fillStyle = 'rgba(9,12,15,.9)'; albedo.ctx.fillRect(x - 1.4, 0, 2.8, size);
    albedo.ctx.fillStyle = 'rgba(150,160,170,.14)'; albedo.ctx.fillRect(x - 1.4, 0, 1, size);
  }
  if (style.balcony) for (let row = 2; row < style.rows; row += 3) {
    const y = row * ch;
    albedo.ctx.fillStyle = 'rgba(14,16,18,.9)'; albedo.ctx.fillRect(0, y + ch * .74, size, ch * .16);
    albedo.ctx.fillStyle = 'rgba(170,170,160,.22)'; albedo.ctx.fillRect(0, y + ch * .74, size, 2);
    for (let x = 0; x < size; x += 6) { albedo.ctx.fillStyle = 'rgba(200,198,186,.14)'; albedo.ctx.fillRect(x, y + ch * .62, 1, ch * .12); }
  }
  for (let k = 0; k < 420 * style.grime; k++) {
    albedo.ctx.fillStyle = random() < .5 ? 'rgba(0,0,0,.13)' : 'rgba(190,200,206,.05)';
    albedo.ctx.fillRect(random() * size, random() * size, 1 + random() * 4, 1 + random() * 9);
  }
  lib._store(style.name, createTexture(lib, albedo.canvas, style.name));
  lib._store(`${style.name}Emissive`, createTexture(lib, emissive.canvas, `${style.name}Emissive`));
}
const windowsPair = {};
for (const key of Object.keys(WINDOW_STYLES)) {
  const style = WINDOW_STYLES[key];
  windowsPair[key] = lib => windowsGenerate(lib, style);
  windowsPair[`${key}Emissive`] = lib => windowsGenerate(lib, style);
}
function skyline(lib) {
  const {canvas, ctx} = canvas2d(1024, 256);
  const random = mulberry32(hashString('skyline'));
  ctx.fillStyle = '#0b1420';
  let x = 0;
  while (x < 1024) {
    const width = 26 + random() * 64, height = 54 + random() * 150;
    const top = 256 - height;
    ctx.fillStyle = `rgba(${8 + random() * 10 | 0},${15 + random() * 12 | 0},${26 + random() * 16 | 0},1)`;
    ctx.fillRect(x, top, width, height);
    if (random() < .5) { ctx.fillRect(x + width * .42, top - 14 - random() * 22, 2, 14 + random() * 22); }
    if (random() < .35) { ctx.fillStyle = 'rgba(120,160,220,.5)'; ctx.fillRect(x + width * .42, top - 22, 2, 4); }
    for (let row = 0; row < 12; row++) for (let column = 0; column < 5; column++) {
      if (random() < .7) continue;
      const color = random() < .5 ? 'rgba(255,214,150,.75)' : 'rgba(150,216,255,.7)';
      ctx.fillStyle = color; ctx.fillRect(x + 4 + column * (width - 8) / 5, top + 6 + row * (height - 10) / 12, 2.2, 2.2);
    }
    x += width + 2 + random() * 24;
  }
  return createTexture(lib, canvas, 'skyline', {clamp: true});
}
function crowd(lib) {
  const {canvas, ctx} = canvas2d(512, 256);
  const random = mulberry32(hashString('crowd'));
  const stand = ctx.createLinearGradient(0, 0, 0, 256);
  stand.addColorStop(0, '#6d6a62'); stand.addColorStop(.55, '#7c786c'); stand.addColorStop(1, '#8e897a');
  ctx.fillStyle = stand; ctx.fillRect(0, 0, 512, 256);
  // Concrete step shadows separate the seating rows.
  const rowCount = 8;
  for (let row = 0; row < rowCount; row++) {
    const rowY = 6 + row * 31, scale = .52 + row * .062;
    ctx.fillStyle = 'rgba(44,43,39,.42)'; ctx.fillRect(0, rowY + 20 * scale + 9, 512, 4);
    ctx.fillStyle = 'rgba(215,208,190,.2)'; ctx.fillRect(0, rowY + 20 * scale + 13, 512, 1.5);
    const shirts = ['#b5473a', '#3f6d8f', '#c9b576', '#5c5f63', '#8e6a9e', '#4d7b64', '#d1cfc4', '#c47a3f', '#3f7f86', '#a63f6d', '#d8d2b8'];
    const skins = ['#c99a72', '#a8754f', '#e0b58c', '#8a5a3c', '#6d4630'];
    for (let i = 0; i < 44; i++) {
      const baseX = (i + random() * .8) * 11.7, shirt = shirts[(random() * shirts.length) | 0], skin = skins[(random() * skins.length) | 0];
      const width = (5.2 + random() * 2.2) * scale, height = (8 + random() * 3.4) * scale, headR = (3.4 + random() * 1.1) * scale;
      const raise = random() < .12, lean = (random() - .5) * 2.4 * scale;
      for (const offset of [0, -512, 512]) {
        const x = baseX + offset + lean, y = rowY;
        // Shoulders + torso, then a head that reads as a spectator silhouette.
        ctx.fillStyle = shirt; ctx.beginPath(); ctx.ellipse(x, y + 12 * scale, width, height * .54, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x - width, y + 15 * scale, width * 2, 2.4 * scale);
        ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(x, y + 2.4 * scale, headR, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.arc(x + headR * .35, y + 3.4 * scale, headR * .72, 0, TAU); ctx.fill();
        if (raise) {
          ctx.strokeStyle = skin; ctx.lineWidth = 1.8 * scale; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x + width * .6, y + 11 * scale); ctx.lineTo(x + width * .95, y - 6 * scale); ctx.stroke();
          ctx.fillStyle = '#f2e8c0'; ctx.fillRect(x + width * .95 - 1.4 * scale, y - 8 * scale, 2.8 * scale, 4.2 * scale);
        }
      }
    }
    // Railing between rows.
    ctx.fillStyle = 'rgba(58,57,52,.55)'; ctx.fillRect(0, rowY + 25 * scale + 12, 512, 1.6);
  }
  // A few flags / banners in the crowd.
  for (let k = 0; k < 7; k++) {
    const x = random() * 512, y = 20 + random() * 170;
    ctx.strokeStyle = '#4b4a44'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = ['#d85a3c', '#e8dfc2', '#4f8fb0', '#d8b64a'][k % 4]; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10, y + 3); ctx.lineTo(x, y + 7); ctx.fill();
  }
  return createTexture(lib, canvas, 'crowd');
}
function tire(lib) {
  const size = 256, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('tire'));
  ctx.fillStyle = '#141516'; ctx.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  // Tread blocks around the rim.
  for (let i = 0; i < 30; i++) {
    const angle = i / 30 * TAU, length = 26;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.fillStyle = i % 2 ? '#1c1e20' : '#101112';
    ctx.fillRect(-4, -128, 8, length);
    ctx.fillStyle = 'rgba(120,126,130,.12)'; ctx.fillRect(-4, -128, 2, length);
    ctx.restore();
  }
  const gradient = ctx.createRadialGradient(cx, cy, 20, cx, cy, 118);
  gradient.addColorStop(0, '#242628'); gradient.addColorStop(.55, '#17191b'); gradient.addColorStop(.9, '#0d0e0f'); gradient.addColorStop(1, '#08090a');
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(cx, cy, 118, 0, TAU); ctx.fill();
  for (const radius of [44, 52, 92, 100]) {
    ctx.strokeStyle = radius > 90 ? 'rgba(4,5,6,.9)' : 'rgba(120,126,130,.1)';
    ctx.lineWidth = radius > 90 ? 3 : 1.4; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.stroke();
  }
  // Raised sidewall lettering, drawn along the arc.
  ctx.fillStyle = 'rgba(214,212,198,.72)'; ctx.font = '700 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [label, radius, start, end] of [['JRC MOTORSPORT', 74, -1.2, 1.2], ['RACING TYRE', 74, 1.9, 4.3]]) {
    const chars = label.split('');
    chars.forEach((char, i) => {
      const angle = start + (end - start) * (i / Math.max(1, chars.length - 1));
      ctx.save(); ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius); ctx.rotate(angle + Math.PI / 2);
      ctx.fillText(char, 0, 0); ctx.restore();
    });
  }
  for (let k = 0; k < 260; k++) {
    ctx.fillStyle = random() < .5 ? 'rgba(0,0,0,.3)' : 'rgba(180,185,188,.07)';
    ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3);
  }
  return createTexture(lib, canvas, 'tire');
}
function tentStripe(lib) {
  const {canvas, ctx} = canvas2d(256, 256);
  const random = mulberry32(hashString('tent-stripe'));
  for (let i = 0; i < 8; i++) {
    const red = i % 2 === 0;
    const gradient = ctx.createLinearGradient(i * 32, 0, i * 32 + 32, 0);
    gradient.addColorStop(0, red ? '#b8335e' : '#e8ddc2');
    gradient.addColorStop(.5, red ? '#e0507c' : '#f6efd9');
    gradient.addColorStop(1, red ? '#9b294f' : '#d8cbaa');
    ctx.fillStyle = gradient; ctx.fillRect(i * 32, 0, 32, 256);
  }
  for (let k = 0; k < 500; k++) {
    ctx.fillStyle = random() < .5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.08)';
    ctx.fillRect(random() * 256, random() * 256, 1 + random() * 3, 1 + random() * 6);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, 256);
  shade.addColorStop(0, 'rgba(255,255,255,.12)'); shade.addColorStop(.7, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.22)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, 256, 256);
  return createTexture(lib, canvas, 'tentStripe');
}
function dust(lib) {
  const size = 128, {canvas, ctx} = canvas2d(size);
  const random = mulberry32(hashString('dust'));
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255,255,255,.85)'); gradient.addColorStop(.45, 'rgba(255,255,255,.3)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 130; k++) {
    ctx.fillStyle = `rgba(0,0,0,${random() * .16})`;
    ctx.beginPath(); ctx.arc(random() * size, random() * size, 1 + random() * 7, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return createTexture(lib, canvas, 'dust', {clamp: true});
}
function waterNormal(lib) {
  const noise = makeNoise(mulberry32(hashString('water-normal')));
  return normalMap(lib, 256, (u, v, x, y) => {
    const swell = Math.sin(u * 44 + noise(x * .02, y * .02) * 5) * .26 + Math.sin(v * 31 + u * 9) * .18;
    const chop = noise.fbm(x * 1.7, y * 1.7, 3) * .42;
    return swell + chop;
  }, 'waterNormal', 1.7);
}
function glowCard(lib) {
  const size = 128, {canvas, ctx} = canvas2d(size);
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,.95)');
  gradient.addColorStop(.35, 'rgba(255,255,255,.5)');
  gradient.addColorStop(.7, 'rgba(255,255,255,.16)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.save(); ctx.translate(64, 64); ctx.scale(1.45, .8); ctx.translate(-64, -64);
  ctx.fillRect(-20, -20, 168, 168); ctx.restore();
  return createTexture(lib, canvas, 'glowCard', {clamp: true});
}
function checker(lib) {
  const size = 128, {canvas, ctx} = canvas2d(size);
  ctx.fillStyle = '#efeee6'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#191b1d';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * 16, y * 16, 16, 16);
  return createTexture(lib, canvas, 'checker');
}

const GENERATORS = {
  asphalt, asphaltRoughness, asphaltNormal, shoulder, curb, gravel, sand, grass, grassTuft, dryShrub,
  bark, leafBroad, leafPine, palmFrond, rock, rockNormal,
  ridgeFar: ridgeTexture('ridgeFar', {height: .5, rough: .34, base: '#8f9fa3', top: '#aebbc0', haze: 214, seed: 3.1}),
  ridgeMid: ridgeTexture('ridgeMid', {height: .72, rough: .55, base: '#5f7472', top: '#7c8e89', haze: 120, seed: 8.4}),
  ridgeNear: ridgeTexture('ridgeNear', {height: .92, rough: .7, base: '#33433d', top: '#4c5d52', haze: 40, seed: 13.7}),
  ...windowsPair, palmBark, skyline, crowd, tire, tentStripe, dust, waterNormal, checker, glowCard,
};
export const SURFACE_TEXTURE_NAMES = Object.keys(GENERATORS);

// ---------------------------------------------------------------------------
// Sign / billboard panels (canvas type + graphics), cached by content key.
// ---------------------------------------------------------------------------
function drawMotif(ctx, x, y, w, h, color, neon, random, motif = 'bars') {
  ctx.save();
  if (neon) { ctx.shadowColor = color; ctx.shadowBlur = Math.min(w, h) * .16; }
  ctx.strokeStyle = color; ctx.fillStyle = color;
  if (motif === 'rings') {
    for (let i = 0; i < 3; i++) { ctx.lineWidth = Math.max(2, w * .035); ctx.beginPath(); ctx.arc(x + w * .5, y + h * .5, w * (.2 + i * .13), 0, TAU); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(x + w * .5, y + h * .5, w * .07, 0, TAU); ctx.fill();
  } else if (motif === 'chevrons') {
    ctx.lineWidth = Math.max(3, w * .07); ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) { const offset = i * w * .22; ctx.beginPath(); ctx.moveTo(x + offset, y + h * .82); ctx.lineTo(x + offset + w * .17, y + h * .5); ctx.lineTo(x + offset, y + h * .18); ctx.stroke(); }
  } else if (motif === 'bolt') {
    ctx.beginPath(); ctx.moveTo(x + w * .52, y + h * .06); ctx.lineTo(x + w * .18, y + h * .55); ctx.lineTo(x + w * .46, y + h * .55); ctx.lineTo(x + w * .3, y + h * .96); ctx.lineTo(x + w * .88, y + h * .38); ctx.lineTo(x + w * .56, y + h * .38); ctx.closePath(); ctx.fill();
  } else if (motif === 'grid') {
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) { ctx.globalAlpha = .25 + (row * 4 + column) / 18; ctx.fillRect(x + w * column / 4, y + h * row / 4, w * .16, h * .16); }
  } else {
    for (let i = 0; i < 4; i++) { ctx.globalAlpha = .9 - i * .16; ctx.fillRect(x + w * .06, y + h * (.18 + i * .2), w * (.9 - i * .12), h * .1); }
  }
  ctx.restore();
}
function drawSignPanel(ctx, x, y, w, h, spec = {}) {
  const neon = !!spec.neon;
  const random = mulberry32(hashString(JSON.stringify(spec)));
  const bg = spec.bg || (neon ? '#080611' : '#171d21');
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, bg); gradient.addColorStop(1, spec.bg2 || bg);
  ctx.fillStyle = gradient; ctx.fillRect(x, y, w, h);
  const accent = spec.accent || '#d9542f';
  ctx.fillStyle = accent; ctx.fillRect(x, y, w, Math.max(5, h * .045));
  if (neon) { ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = h * .2; ctx.fillStyle = accent; ctx.fillRect(x, y, w, Math.max(3, h * .02)); ctx.restore(); }
  drawMotif(ctx, x + w * .6, y + h * .16, w * .34, h * .68, spec.accent2 || accent, neon, random, spec.motif);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const ink = spec.ink || '#f4efdf';
  ctx.fillStyle = ink; ctx.font = `900 ${Math.round(h * .33)}px system-ui, -apple-system, "PingFang SC", sans-serif`;
  if (neon) { ctx.save(); ctx.shadowColor = ink; ctx.shadowBlur = h * .14; }
  ctx.fillText(spec.text || 'JRC', x + w * .06, y + h * .43);
  if (neon) ctx.restore();
  if (spec.sub) {
    ctx.fillStyle = neon ? ink : 'rgba(240,236,223,.74)';
    ctx.font = `600 ${Math.round(h * .105)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(spec.sub.toUpperCase(), x + w * .062, y + h * .69);
  }
  ctx.fillStyle = accent; ctx.fillRect(x + w * .062, y + h * .8, w * .2, Math.max(2, h * .022));
  if (spec.code) {
    ctx.fillStyle = neon ? 'rgba(255,255,255,.5)' : 'rgba(240,236,223,.4)';
    ctx.font = `600 ${Math.round(h * .085)}px ui-monospace, monospace`;
    ctx.fillText(spec.code, x + w * .07, y + h * .9);
  }
  // Canvas texture + grime so panels never look like flat UI fills.
  for (let k = 0; k < 240; k++) {
    ctx.fillStyle = random() < .5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.045)';
    ctx.fillRect(x + random() * w, y + random() * h, 1 + random() * 3, 1 + random() * 2);
  }
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

class SurfaceTextureLibrary {
  constructor(THREE, options = {}) {
    this.THREE = THREE;
    this.anisotropy = Math.max(1, Math.min(16, options.anisotropy || 8));
    this.textures = new Map();
    this.atlases = new Map();
    this.signHeaders = 0;
    for (const name of SURFACE_TEXTURE_NAMES) {
      if (Object.prototype.hasOwnProperty.call(this, name)) continue;
      Object.defineProperty(this, name, {get: () => this.texture(name), enumerable: false});
    }
  }
  _store(name, texture) { this.textures.set(name, texture); return texture; }
  get(name) { return this.texture(name); }
  texture(name) {
    if (this.textures.has(name)) return this.textures.get(name);
    const generator = GENERATORS[name];
    if (!generator) throw new Error(`surface-textures: unknown texture "${name}"`);
    const made = generator(this);
    if (made) this._store(name, made);
    const texture = this.textures.get(name);
    if (!texture) throw new Error(`surface-textures: generator for "${name}" produced no texture`);
    return texture;
  }
  setAnisotropy(value) {
    const anisotropy = Math.max(1, Math.min(16, Number(value) || 0));
    if (anisotropy <= this.anisotropy) return;
    this.anisotropy = anisotropy;
    for (const texture of this.textures.values()) texture.anisotropy = anisotropy;
  }
  sign(spec = {}) {
    const key = `sign:${hashString(JSON.stringify(spec))}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const {canvas, ctx} = canvas2d(512, 256);
    drawSignPanel(ctx, 0, 0, 512, 256, spec);
    return this._store(key, createTexture(this, canvas, spec.text ? `sign-${spec.text}` : key));
  }
  atlas(name, specs = []) {
    if (this.atlases.has(name)) return this.atlases.get(name);
    const columns = 4, cellWidth = 512, cellHeight = 256, rows = Math.max(1, Math.ceil(specs.length / columns));
    const {canvas, ctx} = canvas2d(columns * cellWidth, rows * cellHeight);
    specs.forEach((spec, index) => drawSignPanel(ctx, (index % columns) * cellWidth, Math.floor(index / columns) * cellHeight, cellWidth, cellHeight, spec));
    const texture = createTexture(this, canvas, `atlas-${name}`);
    const cells = specs.map((_, index) => {
      const column = index % columns, row = Math.floor(index / columns);
      return {u0: column / columns, u1: (column + 1) / columns, v0: 1 - (row + 1) / rows, v1: 1 - row / rows};
    });
    const atlas = {name, texture, cells, columns, rows};
    this.textures.set(`atlas:${name}`, texture);
    this.atlases.set(name, atlas);
    return atlas;
  }
  retainedTextures() { return [...this.textures.values()]; }
  get stats() {
    let bytes = 0;
    for (const texture of this.textures.values()) {
      const image = texture.image;
      if (image?.width && image?.height) bytes += image.width * image.height * 4;
    }
    return {count: this.textures.size, estimatedBytes: bytes, atlases: this.atlases.size};
  }
}
export function getSurfaceTextures(THREE, options = {}) {
  let library = stores.get(THREE);
  if (!library) { library = new SurfaceTextureLibrary(THREE, options); stores.set(THREE, library); }
  else if (options.anisotropy) library.setAnisotropy(options.anisotropy);
  return library;
}
// Context-loss recovery: the cached Texture objects keep their canvas source. After
// the renderer disposed GPU handles the caller marks every retained map for re-upload.
export function refreshSurfaceTextures(THREE) {
  const library = stores.get(THREE);
  if (!library) return 0;
  let count = 0;
  for (const texture of library.textures.values()) { texture.needsUpdate = true; count++; }
  return count;
}
export function disposeSurfaceTextures(THREE) {
  const library = stores.get(THREE);
  if (!library) return;
  for (const texture of library.textures.values()) texture.dispose();
  library.textures.clear(); library.atlases.clear(); stores.delete(THREE);
}
