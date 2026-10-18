// Layered procedural world kit for the premium scenery pass.
// The caller owns the Three namespace and the race scene: this module never imports
// '/vendor/three.module.js' (same contract as light-show.js). Everything here is
// generated geometry + canvas textures, batched by (layer, material) or instanced.
//
// buildSceneryKit(track, THREE, {quality, reducedMotion}) returns
//   {group, detailGroup, update(dt, time, reducedMotion), retainedTextures, stats, dispose}
//
// Layers: far silhouettes > mid landmarks > near roadside kit, plus detailGroup for
// high-density micro detail (hidden by the renderer when quality.detail is false).
// No geometry enters the road/guardrail corridor; every anchor is measured against
// sampled track points and reported in stats.clearance.
import {GUARDRAIL_OFFSET} from './driving.js';
import {mod, clamp, shortDistance} from './tracks.js';
import {getSurfaceTextures} from './surface-textures.js';

const TAU = Math.PI * 2;
const CLEARANCE = 13.5; // hard guardrail limit: nothing inside this lateral band
const RAIL = GUARDRAIL_OFFSET; // 13.5
const NEAR_LATERAL = RAIL + 1.2;
const DETAIL_LATERAL = RAIL + 4.5;

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

// ---------------------------------------------------------------------------
// Authored geometry templates (all unit-scaled so a single template can be
// instanced with per-instance matrices).
// ---------------------------------------------------------------------------
function palmTrunkGeometry(THREE, variant = 0) {
  const rings = 13, sides = 8, positions = [], uvs = [], indices = [];
  const lean = [.24, .42, .62][variant % 3], bend = [1.05, 1.3, 1.55][variant % 3], twist = [0, .4, .9][variant % 3];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // Visible leaf-scar rings: the profile pulses so the silhouette shows a ribbed trunk.
    const ringPhase = Math.sin(t * 42 + twist) * .5 + .5;
    let radius = (.175 + .16 * (1 - t)) * (1 + ringPhase * .1 + (variant === 2 ? t * .05 : 0));
    if (i === rings) radius *= 1.5; // crown knuckle
    if (i === rings - 1) radius *= 1.25;
    const offset = Math.sin(t * bend) * lean;
    for (let k = 0; k < sides; k++) {
      const angle = k / sides * TAU;
      positions.push(Math.cos(angle) * radius + offset, t, Math.sin(angle) * radius);
      uvs.push(k / sides, t * 3.6);
    }
  }
  for (let i = 0; i < rings; i++) for (let k = 0; k < sides; k++) {
    const a = i * sides + k, b = i * sides + (k + 1) % sides, c = (i + 1) * sides + k, d = (i + 1) * sides + (k + 1) % sides;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
function palmCoconutGeometry(THREE) {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  return geometry;
}
function frondGeometry(THREE, droopScale = 1) {
  const columns = 6, positions = [], uvs = [], indices = [];
  for (let i = 0; i <= columns; i++) {
    const t = i / columns, droop = -Math.pow(t, 1.7) * .38 * droopScale, halfWidth = .5 * (1 - Math.pow(Math.abs(t - .42) * 1.1, 2));
    positions.push(t, .5 * Math.max(.18, halfWidth) + droop, 0);
    positions.push(t, -.5 * Math.max(.18, halfWidth) + droop, 0);
    uvs.push(t, 1); uvs.push(t, 0);
  }
  for (let i = 0; i < columns; i++) { const a = i * 2, b = i * 2 + 2, c = i * 2 + 1, d = i * 2 + 3; indices.push(a, b, c, b, d, c); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
function rockGeometry(THREE, seed, detail = 1) {
  const geometry = new THREE.IcosahedronGeometry(1, detail), positions = geometry.attributes.position;
  const random = mulberry32(seed), noise = (x, y, z) => Math.sin(x * 5.1 + seed) * Math.cos(y * 4.3 - seed) * Math.sin(z * 6.7 + seed * .5);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const scale = 1 + noise(x, y, z) * .26 + (random() - .5) * .12;
    positions.setXYZ(i, x * scale * 1.15, y * scale * .78, z * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
}
function latheGeometry(THREE, profile, segments = 14) {
  const geometry = new THREE.LatheGeometry(profile, segments);
  return geometry;
}
function mesaGeometry(THREE, seed) {
  const profile = [
    new THREE.Vector2(1.04, 0), new THREE.Vector2(.9, .05), new THREE.Vector2(.74, .12),
    new THREE.Vector2(.68, .3), new THREE.Vector2(.74, .32), new THREE.Vector2(.72, .34),
    new THREE.Vector2(.6, .52), new THREE.Vector2(.66, .54), new THREE.Vector2(.62, .56),
    new THREE.Vector2(.48, .74), new THREE.Vector2(.54, .76), new THREE.Vector2(.5, .78),
    new THREE.Vector2(.34, .95), new THREE.Vector2(.3, 1),
  ];
  const geometry = latheGeometry(THREE, profile, 18), positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const wobble = 1 + Math.sin(y * 23 + x * 9 + seed) * .1 + Math.sin(y * 7 + z * 5 + seed * .7) * .08;
    positions.setXYZ(i, x * wobble, y + Math.sin(x * 3 + z * 4 + seed) * .012, z * wobble);
  }
  geometry.computeVertexNormals();
  return geometry;
}
function hoodooGeometry(THREE, seed) {
  const random = mulberry32(seed), profile = [];
  const waist = .34 + random() * .16, cap = .5 + random() * .24;
  profile.push(new THREE.Vector2(.56, 0), new THREE.Vector2(.44, .18), new THREE.Vector2(waist, .45), new THREE.Vector2(waist * 1.16, .62), new THREE.Vector2(cap * .78, .86), new THREE.Vector2(cap, .94), new THREE.Vector2(cap * .74, 1));
  const geometry = latheGeometry(THREE, profile, 11), positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), wobble = 1 + Math.sin(y * 17 + x * 11 + seed * 2) * .1;
    positions.setXYZ(i, x * wobble, y, z * wobble);
  }
  geometry.computeVertexNormals();
  return geometry;
}
function tentGeometry(THREE) {
  const geometry = new THREE.ConeGeometry(1, 1, 12, 1, true);
  geometry.translate(0, .5, 0);
  return geometry;
}
function triangleGeometry(THREE) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -.34, 0, .48, -.17, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, .5], 2));
  geometry.computeVertexNormals();
  return geometry;
}
function scaleUv(geometry, su, sv) {
  const uv = geometry.getAttribute('uv');
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geometry;
}
function addSway(material, timeUniform, amount = .1, speed = 1.4, anchorUniform = true) {
  material.onBeforeCompile = shader => {
    shader.uniforms.kitTime = timeUniform;
    shader.vertexShader = 'uniform float kitTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 kitAnchor = instanceMatrix[3].xyz;
      #else
        vec3 kitAnchor = vec3(0.0);
      #endif
      float kitPhase = kitTime * ${speed.toFixed(2)} + kitAnchor.x * 0.17 + kitAnchor.z * 0.13;
      float kitWeight = clamp(uv.y, 0.0, 1.0);
      transformed.x += sin(kitPhase) * ${amount.toFixed(3)} * kitWeight;
      transformed.z += cos(kitPhase * 1.27) * ${(amount * .6).toFixed(3)} * kitWeight;
    `);
  };
  material.customProgramCacheKey = () => `scenery-sway-${amount}-${speed}-${anchorUniform}`;
  return material;
}

// Guaranteed sponsor boards near the start straight: the hero chase framing must
// always show the authored board type, not only whatever random sites survived.
function builderShowcaseBoards(track, builder) {
  const boards = [], entries = [[36, 1, 2], [58, -1, 3], [82, 1, 4], [108, -1, 5]];
  for (const [s, side, cell] of entries) {
    const lateral = side * (RAIL + 4.6), point = track.sample(s, lateral);
    if (builder.nearestDistance(point.x, point.z) < 17) continue;
    boards.push({x: point.x, z: point.z, base: builder.groundY(s, lateral), face: builder.faceYaw(point, side), cell});
    builder.anchor(point.x, point.z, 'showcase-board');
  }
  return boards;
}

// ---------------------------------------------------------------------------
// Builder: shared placement, material and batching plumbing.
// ---------------------------------------------------------------------------
class SceneryBuilder {
  constructor(track, THREE, options = {}) {
    this.track = track;
    this.THREE = THREE;
    this.options = options;
    this.detail = options.quality?.detail !== false;
    this.density = this.detail ? 1 : .6;
    this.reducedMotion = !!options.reducedMotion;
    this.theme = track.id;
    this.lib = getSurfaceTextures(THREE, {anisotropy: options.anisotropy || 8});
    this.random = mulberry32(hashString(`scenery:${track.id}`));
    this.time = 0;
    this.timeUniform = {value: 0};
    this.root = new THREE.Group(); this.root.name = `track-scenery-${track.id}`;
    this.groups = {far: new THREE.Group(), mid: new THREE.Group(), near: new THREE.Group(), detail: new THREE.Group()};
    for (const [name, group] of Object.entries(this.groups)) { group.name = `scenery-${name}`; group.userData.layer = name; this.root.add(group); }
    this.batches = new Map();
    this.partGeometries = new Set();
    this.geometries = new Set();
    this.instancedMeshes = [];
    this.materials = new Map();
    this.anchors = [];
    this.features = {palmVariants: 3, windowVariants: 3, boostShowcase: 0};
    this.boostShowcase = 0;
    this.animated = {water: null, beam: null, rings: null, pulse: [], dust: []};
    this.templates = {
      box: new THREE.BoxGeometry(1, 1, 1),
      plane: new THREE.PlaneGeometry(1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
      cylinder6: new THREE.CylinderGeometry(1, 1, 1, 6),
      sphere: new THREE.SphereGeometry(.5, 8, 6),
    };
    for (const template of Object.values(this.templates)) this.geometries.add(template);
    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.vector = new THREE.Vector3();
    this.scaleVector = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }
  // Ground height approximation matching the renderer's terrain: track elevation
  // near the rail, then a smooth fall to -18 in the distance.
  groundY(s, lateral) {
    const y = this.track.sample(s).y;
    const distance = Math.abs(lateral);
    if (distance <= 13) return y - 1.5;
    const blend = clamp((distance - 13) / 70, 0, 1), smooth = blend * blend * (3 - 2 * blend);
    return (y - 1.5) * (1 - smooth) - 18 * smooth;
  }
  anchor(x, z, kind = 'prop') { if (this.anchors.length < 900) this.anchors.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100, kind]); }
  // Distance to the nearest point of the whole lap, not just the local segment:
  // props placed 150 m sideways can still land on another part of a closed course.
  nearestDistance(x, z) {
    const points = this.track.points;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = x - points[i].x, dz = z - points[i].z, distance = dx * dx + dz * dz;
      if (distance < best) best = distance;
    }
    return Math.sqrt(best);
  }
  material(key, factory) {
    if (!this.materials.has(key)) {
      const material = factory();
      material.name = key;
      this.materials.set(key, material);
    }
    return this.materials.get(key);
  }
  batchFor(layer, material) {
    const key = `${layer}|${material.uuid}`;
    let batch = this.batches.get(key);
    if (!batch) { batch = {layer, material, parts: []}; this.batches.set(key, batch); }
    return batch;
  }
  // Add a static geometry to a merged batch. Transform is composed and baked, so
  // each (layer, material) pair becomes exactly one draw call.
  add(layer, material, geometry, transform = {}, color = null) {
    const THREE = this.THREE;
    let part = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    this.euler.set(transform.rx || 0, transform.ry || 0, transform.rz || 0, 'YXZ');
    this.quaternion.setFromEuler(this.euler);
    this.matrix.compose(
      this.vector.set(transform.x || 0, transform.y || 0, transform.z || 0),
      this.quaternion,
      this.scaleVector.set(transform.sx ?? 1, transform.sy ?? 1, transform.sz ?? 1));
    part.applyMatrix4(this.matrix);
    const uv = part.getAttribute('uv');
    if (uv && (transform.uvScale || transform.uvRect || transform.uvOffset)) {
      const [su, sv] = transform.uvScale || [1, 1], rect = transform.uvRect;
      const [ou, ov] = transform.uvOffset || [0, 0];
      for (let i = 0; i < uv.count; i++) {
        let u = uv.getX(i) * su + ou, v = uv.getY(i) * sv + ov;
        if (rect) {
          const rawU = uv.getX(i) * su, rawV = uv.getY(i) * sv;
          // Atlas cards must sample the whole cell: clamp instead of fract, otherwise
          // the 0/1 plane UV corners collapse onto one cell pixel (blank hoardings).
          u = rect.u0 + clamp(rawU, 0, 1) * (rect.u1 - rect.u0);
          v = rect.v0 + clamp(rawV, 0, 1) * (rect.v1 - rect.v0);
        }
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
    }
    let partColor = null;
    if (material.vertexColors) partColor = color ? this.color.set(color).clone() : new THREE.Color(1, 1, 1);
    this.partGeometries.add(part);
    this.batchFor(layer, material).parts.push({geometry: part, color: partColor});
  }
  instanced(layer, geometry, material, transforms, options = {}) {
    if (!transforms.length) return null;
    const THREE = this.THREE;
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    transforms.forEach((transform, index) => {
      this.euler.set(transform.rx || 0, transform.ry || 0, transform.rz || 0, 'YXZ');
      this.quaternion.setFromEuler(this.euler);
      const uniform = transform.s ?? 1;
      this.matrix.compose(
        this.vector.set(transform.x || 0, transform.y || 0, transform.z || 0),
        this.quaternion,
        this.scaleVector.set(transform.sx ?? uniform, transform.sy ?? uniform, transform.sz ?? uniform));
      mesh.setMatrixAt(index, this.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (options.colors) {
      const colors = options.colors;
      colors.forEach((value, index) => mesh.setColorAt(index, this.color.set(value)));
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.castShadow = options.castShadow !== false && !material.transparent;
    mesh.receiveShadow = options.receiveShadow !== false && !material.transparent;
    mesh.name = options.name || `scenery-instanced-${layer}`;
    mesh.userData.layer = layer;
    if (options.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.geometries.add(geometry);
    this.instancedMeshes.push(mesh);
    this.groups[layer].add(mesh);
    return mesh;
  }
  // Thin cylinder/box between two world points (guy lines, festoon wires).
  line(layer, material, from, to, thickness = .06, color = null) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-4) return;
    this.add(layer, material, this.templates.cylinder6, {
      x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2,
      ry: Math.atan2(dx, dz), rx: Math.acos(clamp(dy / length, -1, 1)),
      sx: thickness, sy: length, sz: thickness,
    }, color);
  }
  addPanel(layer, material, atlas, index, x, y, z, options = {}) {
    const cell = atlas.cells[index];
    if (!cell) return;
    const width = options.width || 5, height = options.height || 2.4;
    this.add(layer, material, this.templates.plane, {
      x, y, z, ry: options.ry || 0, rx: options.rx || 0, rz: options.rz || 0,
      sx: width, sy: height, sz: 1, uvRect: cell,
    });
  }
  // Sites are distributed around the lap. `tall` sites keep away from blind
  // corners and the boost straight so the next decision stays readable.
  sites(count, options = {}) {
    const track = this.track, span = options.span ?? track.length, offset = options.offset || 0;
    const sides = options.sides || [-1, 1], lateralMin = options.lateralMin ?? NEAR_LATERAL, lateralMax = options.lateralMax ?? lateralMin + 4;
    const out = [], attempts = Math.max(count * 12, 24);
    for (let attempt = 0; attempt < attempts && out.length < count; attempt++) {
      const index = out.length;
      const s = mod(offset + ((index + .5) / count) * span + (this.random() - .5) * (span / count) * (options.jitter ?? .5), track.length);
      if (options.skip && options.skip(s)) continue;
      if (options.tall && !this.isTallSiteSafe(s)) continue;
      const side = sides[out.length % sides.length];
      const lateral = side * (lateralMin + this.random() * (lateralMax - lateralMin));
      const p = track.sample(s, lateral), base = this.groundY(s, lateral);
      const clearance = options.globalClearance ?? 14.5;
      if (clearance > 0 && this.nearestDistance(p.x, p.z) < clearance) continue;
      out.push({s, side, lateral, p, base});
      this.anchor(p.x, p.z, options.kind || 'prop');
    }
    return out;
  }
  isTallSiteSafe(s) {
    const track = this.track;
    if (Math.abs(track.curvature(s)) > .02) return false;
    const straight = track.boostStraight;
    if (straight) {
      const delta = shortDistance(s, straight.s, track.length);
      if (delta > -55 && delta < straight.length + 20) return false;
    }
    return true;
  }
  faceYaw(p, side) { return p.yaw - side * Math.PI / 2; }

  // ---- shared materials ---------------------------------------------------
  buildMaterials() {
    const lib = this.lib, THREE = this.THREE;
    const standard = (key, spec) => this.material(key, () => new THREE.MeshStandardMaterial(spec));
    const basic = (key, spec) => this.material(key, () => new THREE.MeshBasicMaterial(spec));
    this.mats = {
      concrete: standard('concrete', {color: '#9c968a', roughness: .96, metalness: .02}),
      concreteDark: standard('concrete-dark', {color: '#5c5b56', roughness: .95, metalness: .04}),
      metal: standard('metal', {color: '#6d7578', roughness: .48, metalness: .72}),
      metalDark: standard('metal-dark', {color: '#2b3134', roughness: .6, metalness: .6}),
      wood: standard('wood', {color: '#7a5a3b', roughness: .9, metalness: .02}),
      tire: standard('tire', {map: lib.tire, color: '#8b8b8b', roughness: .92, metalness: .05}),
      bark: standard('bark', {map: lib.bark, color: '#9c8a72', roughness: 1, metalness: 0}),
      palmTrunk: standard('palm-trunk', {map: lib.palmBark, color: '#cbb28c', roughness: 1, metalness: 0}),
      palmCoconut: standard('palm-coconut', {color: '#5c5133', roughness: .9, metalness: 0}),
      crowd: standard('crowd', {map: lib.crowd, roughness: .93, metalness: 0}),
      grassCard: standard('grass-card', {map: lib.grassTuft, alphaTest: .38, side: THREE.DoubleSide, roughness: 1, metalness: 0, color: '#c9d29c'}),
      shrub: standard('shrub', {map: lib.dryShrub, alphaTest: .32, side: THREE.DoubleSide, roughness: 1, metalness: 0, color: '#b9a980'}),
      broadleaf: standard('broadleaf', {map: lib.leafBroad, alphaTest: .36, side: THREE.DoubleSide, roughness: .95, metalness: 0, color: '#a9c08a'}),
      pine: standard('pine', {map: lib.leafPine, alphaTest: .34, side: THREE.DoubleSide, roughness: .95, metalness: 0, color: '#93ab8a'}),
      palmFrond: standard('palm-frond', {map: lib.palmFrond, alphaTest: .34, side: THREE.DoubleSide, roughness: .9, metalness: 0, color: '#c9dCA6', emissive: '#22330f', emissiveIntensity: .42}),
      rock: standard('rock', {map: lib.rock, normalMap: lib.rockNormal, normalScale: new THREE.Vector2(.8, .8), roughness: 1, metalness: 0, color: '#d2bb95'}),
      rockDark: standard('rock-dark', {map: lib.rock, normalMap: lib.rockNormal, roughness: 1, metalness: 0, color: '#a2937f'}),
      sand: standard('sand', {map: lib.sand, roughness: 1, metalness: 0, color: '#d6c8a6'}),
      gravel: standard('gravel', {map: lib.gravel, roughness: 1, metalness: 0, color: '#a49d90'}),
      windows: standard('windows', {map: lib.windows, emissiveMap: lib.windowsEmissive, emissive: '#ffffff', emissiveIntensity: .95, roughness: .5, metalness: .16, color: '#dfe4ea'}),
      windowsB: standard('windows-b', {map: lib.windowsResidential, emissiveMap: lib.windowsResidentialEmissive, emissive: '#ffffff', emissiveIntensity: 1.05, roughness: .58, metalness: .1, color: '#d6dde6'}),
      windowsC: standard('windows-c', {map: lib.windowsGlass, emissiveMap: lib.windowsGlassEmissive, emissive: '#ffffff', emissiveIntensity: .82, roughness: .34, metalness: .42, color: '#d9dce2'}),
      windowsFar: standard('windows-far', {map: lib.windowsFar, emissiveMap: lib.windowsFarEmissive, emissive: '#ffffff', emissiveIntensity: .78, roughness: .5, metalness: .12, color: '#9fb0c4'}),
      tent: standard('tent', {map: lib.tentStripe, emissiveMap: lib.tentStripe, emissive: '#ffd6e6', emissiveIntensity: .3, roughness: .86, metalness: .02, side: THREE.DoubleSide}),
      water: standard('water', {map: null, normalMap: lib.waterNormal, normalScale: new THREE.Vector2(.9, .9), color: '#2f6270', roughness: .16, metalness: .3}),
      flag: standard('flag', {map: lib.checker, side: THREE.DoubleSide, roughness: .9, metalness: 0}),
      signDay: standard('sign-day', {map: lib.atlas('trackside', TRACKSIDE_ADS).texture, roughness: .58, metalness: .08, side: THREE.DoubleSide}),
      signGlow: standard('sign-glow', {map: lib.atlas('neon', NEON_ADS).texture, emissiveMap: lib.atlas('neon', NEON_ADS).texture, emissive: '#ffffff', emissiveIntensity: 1.65, roughness: .4, metalness: .06, side: THREE.DoubleSide}),
      billboardGlow: standard('billboard-glow', {map: lib.atlas('neon', NEON_ADS).texture, emissiveMap: lib.atlas('neon', NEON_ADS).texture, emissive: '#ffffff', emissiveIntensity: 2.3, roughness: .35, metalness: .05}),
      ridgeFar: basic('ridge-far', {map: lib.ridgeFar, transparent: true, depthWrite: false, side: THREE.BackSide, fog: true}),
      ridgeMid: basic('ridge-mid', {map: lib.ridgeMid, transparent: true, depthWrite: false, side: THREE.BackSide, fog: true}),
      ridgeNear: basic('ridge-near', {map: lib.ridgeNear, transparent: true, depthWrite: false, side: THREE.BackSide, fog: true}),
      skylineFar: basic('skyline-far', {map: lib.skyline, transparent: true, depthWrite: false, side: THREE.BackSide, fog: true, color: new THREE.Color(1.7, 1.9, 2.3)}),
      skylineNear: basic('skyline-near', {map: lib.skyline, transparent: true, depthWrite: false, side: THREE.BackSide, fog: true, color: new THREE.Color(2.2, 2.5, 2.9)}),
      dust: basic('dust', {map: lib.dust, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide, fog: true, color: '#e6cba0'}),
      glow: basic('glow', {vertexColors: true, toneMapped: false}),
      glowInstanced: basic('glow-instanced', {toneMapped: false, color: '#ffffff'}),
      signNight: standard('sign-night', {map: lib.atlas('trackside', TRACKSIDE_ADS).texture, emissiveMap: lib.atlas('trackside', TRACKSIDE_ADS).texture, emissive: '#ffffff', emissiveIntensity: .95, roughness: .55, metalness: .08, side: THREE.DoubleSide}),
      lighthouseRed: standard('lighthouse-red', {color: '#a53a32', roughness: .82, metalness: .04}),
      additive: (key, color, opacity, map) => basic(key, {map: map || null, color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false}),
    };
    this.mats.halo = this.mats.additive('glow-halo', '#ffffff', .5, lib.glowCard);
    this.mats.haloInstanced = basic('glow-halo-instanced', {map: lib.glowCard, transparent: true, opacity: .34, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, fog: false});
    this.mats.ringHalo = this.mats.additive('ring-halo', '#ff64d8', .16);
    this.mats.sunGlint = this.mats.additive('sun-glint', '#ffe6b0', .3, lib.dust);
    this.mats.lighthouseBeam = this.mats.additive('lighthouse-beam', '#ffeecc', .11);
    // Gradient alpha keeps additive cones from reading as hard cardboard wedges.
    for (const coneMaterial of [this.mats.lighthouseBeam]) {
      coneMaterial.onBeforeCompile = shader => {
        shader.vertexShader = 'varying float kitBeamV;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nkitBeamV = uv.y;');
        shader.fragmentShader = 'varying float kitBeamV;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float kitBeamFade = smoothstep(0.0, 0.22, kitBeamV) * (1.0 - smoothstep(0.62, 1.0, kitBeamV));
          diffuseColor.a *= kitBeamFade;`);
      };
      coneMaterial.customProgramCacheKey = () => 'scenery-beam-fade';
    }
    this.mats.dustGlow = this.mats.additive('dust-glow', '#ffd9a0', .1, lib.dust);
    // Wind-swayed surfaces share one shader clock; reduced motion simply stops it.
    addSway(this.mats.flag, this.timeUniform, .14, 2.2);
    addSway(this.mats.palmFrond, this.timeUniform, .07, 1.5);
  }
  // ---- shared roadside kit ------------------------------------------------
  buildCommon() {
    const t = this.track, THREE = this.THREE, mats = this.mats;
    const night = !!t.night || t.theme === 'arcade';
    const signMaterial = night ? mats.signNight : mats.signDay;
    const atlas = this.lib.atlas('trackside', TRACKSIDE_ADS);
    const boostStraight = t.boostStraight;
    // Evidence-shot section: active-play captures look down the boost straight, so a
    // few authored props there make the kit visible in normal gameplay.
    const boostSites = [];
    if (boostStraight) for (const [offset, side] of [[100, 1], [168, -1], [236, 1], [300, -1]]) {
      if (offset > boostStraight.length + 14) continue;
      boostSites.push({s: mod(boostStraight.s + offset, t.length), side});
    }
    // Grandstands: plinth, stepped seating, back wall, capped roof, crowd card,
    // sponsor ribbon and a lit canopy edge so they read in daylight and at night.
    const standSites = [{s: 96, side: -1}, {s: 40, side: 1}], crowdCards = [];
    for (const site of standSites) {
      const lateral = site.side * (RAIL + 8.2), base = this.groundY(site.s, lateral);
      const center = t.sample(site.s, lateral), yaw = center.yaw, face = this.faceYaw(center, site.side);
      const length = 22, stepDepth = 1.5;
      const alongYaw = yaw - Math.PI / 2;
      this.add('near', mats.concreteDark, this.templates.box, {x: center.x, y: base + .45, z: center.z, ry: alongYaw, sx: length, sy: .9, sz: 6.6});
      const front = t.sample(site.s, site.side * (RAIL + 4.55));
      this.add('near', mats.concrete, this.templates.box, {x: front.x, y: base + .95, z: front.z, ry: alongYaw, sx: length, sy: 1.1, sz: .55});
      for (let row = 0; row < 4; row++) {
        const point = t.sample(site.s, site.side * (RAIL + 5.5 + row * stepDepth));
        this.add('near', mats.concrete, this.templates.box, {x: point.x, y: base + 1.15 + row * .58, z: point.z, ry: alongYaw, sx: length, sy: .58, sz: stepDepth + .2});
      }
      const back = t.sample(site.s, site.side * (RAIL + 11.4));
      this.add('near', mats.concreteDark, this.templates.box, {x: back.x, y: base + 2.9, z: back.z, ry: alongYaw, sx: length, sy: 3.4, sz: .55});
      const roof = t.sample(site.s, site.side * (RAIL + 8.6));
      this.add('near', mats.metal, this.templates.box, {x: roof.x, y: base + 6, z: roof.z, ry: alongYaw, rx: .05, sx: length + 1.8, sy: .22, sz: 7.6});
      for (const along of [-length * .42, 0, length * .42]) for (const offset of [RAIL + 5.1, RAIL + 11.6]) {
        const point = t.sample(site.s + along, site.side * offset);
        this.add('near', mats.metal, this.templates.cylinder6, {x: point.x, y: base + 3.6, z: point.z, sx: .13, sy: 5.4, sz: .13});
      }
      const crowd = t.sample(site.s, site.side * (RAIL + 8.3));
      crowdCards.push({x: crowd.x, y: base + 3.35, z: crowd.z, ry: face, rx: -.34, sx: length - 1.2, sy: 3.6});
      const ribbon = t.sample(site.s, site.side * (RAIL + 4.9));
      this.addPanel('near', signMaterial, atlas, 0, ribbon.x, base + 1.5, ribbon.z, {width: length * .85, height: 1.15, ry: face});
      const canopy = t.sample(site.s, site.side * (RAIL + 5.15));
      this.add('near', mats.glow, this.templates.box, {x: canopy.x, y: base + 5.75, z: canopy.z, ry: alongYaw, sx: length * .86, sy: .13, sz: .18}, night ? '#ffe6b4' : '#fff6e0');
      this.add('near', mats.glow, this.templates.box, {x: canopy.x, y: base + 1.02, z: canopy.z, ry: alongYaw, sx: length * .86, sy: .07, sz: .08}, night ? '#8fe8ff' : '#e9f4ff');
    }
    for (const [index, site] of boostSites.entries()) {
      const lateral = site.side * (RAIL + 7.4), base = this.groundY(site.s, lateral);
      const center = t.sample(site.s, lateral), alongYaw = center.yaw - Math.PI / 2, face = this.faceYaw(center, site.side);
      const length = 12;
      this.add('near', mats.concreteDark, this.templates.box, {x: center.x, y: base + .4, z: center.z, ry: alongYaw, sx: length, sy: .8, sz: 5});
      for (let row = 0; row < 2; row++) {
        const point = t.sample(site.s, site.side * (RAIL + 5.4 + row * 1.35));
        this.add('near', mats.concrete, this.templates.box, {x: point.x, y: base + .85 + row * .52, z: point.z, ry: alongYaw, sx: length, sy: .52, sz: 1.45});
      }
      const back = t.sample(site.s, site.side * (RAIL + 10.2));
      this.add('near', mats.concreteDark, this.templates.box, {x: back.x, y: base + 2.1, z: back.z, ry: alongYaw, sx: length, sy: 2.4, sz: .5});
      this.add('near', mats.metal, this.templates.box, {x: center.x, y: base + 4.1, z: center.z, ry: alongYaw, rx: .04, sx: length + .8, sy: .18, sz: 5.6});
      const crowd = t.sample(site.s, site.side * (RAIL + 7.6));
      crowdCards.push({x: crowd.x, y: base + 2.3, z: crowd.z, ry: face, rx: -.28, sx: length - .8, sy: 2.4});
      const ribbon = t.sample(site.s, site.side * (RAIL + 4.9));
      this.addPanel('near', signMaterial, atlas, 1 + index, ribbon.x, base + 1.15, ribbon.z, {width: length * .8, height: .9, ry: face});
      this.add('near', mats.glow, this.templates.box, {x: crowd.x, y: base + 3.9, z: crowd.z, ry: alongYaw, sx: length * .7, sy: .1, sz: .14}, night ? '#ffe6b4' : '#fff6e0');
      this.boostShowcase++;
    }
    this.instanced('near', this.templates.plane, mats.crowd, crowdCards, {name: 'scenery-crowd', castShadow: false});
    // Sponsor boards + distance + warning markers share one atlas material.
    const showcase = builderShowcaseBoards(t, this);
    for (const entry of showcase) this.addPanel('near', signMaterial, atlas, entry.cell, entry.x, entry.base + 2.15, entry.z, {width: 5.6, height: 2.55, ry: entry.face});
    for (const [index, site] of boostSites.entries()) {
      const lateral = site.side * (RAIL + 4.4), point = t.sample(site.s + 10, lateral), base = this.groundY(site.s + 10, lateral);
      const face = this.faceYaw(point, site.side);
      this.addPanel('near', signMaterial, atlas, (index + 2) % TRACKSIDE_ADS.length, point.x, base + 2.05, point.z, {width: 5.2, height: 2.4, ry: face});
      for (const offset of [-1.8, 1.8]) {
        const post = t.sample(site.s + 10 + offset, lateral);
        this.add('near', mats.metalDark, this.templates.cylinder6, {x: post.x, y: base + 1.1, z: post.z, sx: .12, sy: 2.4, sz: .12});
      }
      // Small marshal hut behind the rail.
      const hut = t.sample(site.s + 4, site.side * (RAIL + 9.5)), hutBase = this.groundY(site.s + 4, site.side * (RAIL + 9.5));
      this.add('near', mats.concreteDark, this.templates.box, {x: hut.x, y: hutBase + 1.2, z: hut.z, ry: hut.yaw - Math.PI / 2, sx: 4.2, sy: 2.4, sz: 3.2});
      this.add('near', mats.metal, this.templates.box, {x: hut.x, y: hutBase + 2.55, z: hut.z, ry: hut.yaw - Math.PI / 2, sx: 4.8, sy: .18, sz: 3.8});
      this.addPanel('near', signMaterial, atlas, 11, hut.x, hutBase + 2.0, hut.z, {width: 2.2, height: .9, ry: this.faceYaw(hut, site.side)});
      this.boostShowcase++;
    }
    this.sites(10, {lateralMin: RAIL + 3.6, lateralMax: RAIL + 6, jitter: .7, kind: 'sign', globalClearance: 18}).forEach((site, index) => {
      const face = this.faceYaw(site.p, site.side), point = t.sample(site.s, site.lateral + site.side * .3);
      this.addPanel('near', signMaterial, atlas, index % 6, point.x, site.base + 2.15, point.z, {width: 5.6, height: 2.55, ry: face});
      for (const offset of [-1.9, 1.9]) {
        const post = t.sample(site.s + offset, site.lateral);
        this.add('near', mats.metalDark, this.templates.cylinder6, {x: post.x, y: site.base + 1.15, z: post.z, sx: .14, sy: 2.5, sz: .14});
      }
    });
    this.sites(8, {lateralMin: RAIL + 2.4, lateralMax: RAIL + 3.4, jitter: .8, kind: 'distance', globalClearance: 16}).forEach((site, index) => {
      const face = this.faceYaw(site.p, site.side), cell = 6 + (index % 5);
      this.addPanel('near', signMaterial, atlas, cell, site.p.x, site.base + 1.7, site.p.z, {width: 2.2, height: 1.15, ry: face});
      this.add('near', mats.metalDark, this.templates.cylinder6, {x: site.p.x, y: site.base + .8, z: site.p.z, sx: .09, sy: 1.6, sz: .09});
    });
    this.sites(6, {lateralMin: RAIL + 2.6, lateralMax: RAIL + 4.2, jitter: .85, kind: 'warning', globalClearance: 16}).forEach((site, index) => {
      const face = this.faceYaw(site.p, site.side), cell = 11 + (index % 4);
      this.addPanel('near', signMaterial, atlas, cell, site.p.x, site.base + 2, site.p.z, {width: 2.6, height: 1.3, ry: face});
      this.add('near', mats.metalDark, this.templates.cylinder6, {x: site.p.x, y: site.base + .95, z: site.p.z, sx: .1, sy: 1.9, sz: .1});
    });
    // Tire walls: one instanced batch for every site (plus boost-straight extras).
    const tireTransforms = [];
    const addTireWall = (s, lateral, length = 11) => {
      for (let row = 0; row < 3; row++) for (let index = 0; index < length - row; index++) {
        const along = (index + row * .5 - (length - row) / 2) * .92;
        const point = t.sample(s + along, lateral);
        tireTransforms.push({x: point.x, y: this.groundY(s + along, lateral) + .2 + row * .39, z: point.z, ry: point.yaw, sx: .55, sy: .4, sz: .55});
      }
    };
    for (const site of this.sites(6, {lateralMin: RAIL + 3.2, lateralMax: RAIL + 4.2, jitter: .9, kind: 'tirewall', globalClearance: 21})) addTireWall(site.s, site.lateral);
    for (const site of boostSites) addTireWall(site.s + 6, site.side * (RAIL + 3.4), 9);
    this.instanced('near', this.templates.cylinder, mats.tire, tireTransforms, {name: 'scenery-tire-wall'});
    // Rail-line marker posts.
    const markers = [];
    for (let s = 8; s < t.length; s += 9) for (const side of [-1, 1]) {
      const p = t.sample(s, side * (RAIL + 1.7));
      markers.push({x: p.x, y: this.groundY(s, side * (RAIL + 1.7)) + .45, z: p.z, ry: p.yaw, sx: .08, sy: .9, sz: .08});
    }
    this.instanced('near', this.templates.box, mats.metalDark, markers, {name: 'scenery-marker-posts'});
    // Wind flags: instanced cloth with a vertex-sway shader; frozen by reduced motion.
    const flagTransforms = [], poleTransforms = [], flagColors = [];
    this.sites(12, {lateralMin: RAIL + 2.8, lateralMax: RAIL + 4.4, jitter: .75, kind: 'flag', globalClearance: 16}).forEach((site, index) => {
      poleTransforms.push({x: site.p.x, y: site.base + 4, z: site.p.z, sx: .08, sy: 8, sz: .08});
      flagTransforms.push({
        x: site.p.x - Math.cos(site.p.yaw) * .05, y: site.base + 7.4, z: site.p.z + Math.sin(site.p.yaw) * .05,
        ry: site.p.yaw - site.side * Math.PI / 2, sx: 2, sy: 1.2,
      });
      flagColors.push(['#e05a3a', '#f2e9cf', '#3a86a8', '#c9a13a'][index % 4]);
    });
    for (const [index, site] of boostSites.entries()) {
      const lateral = site.side * (RAIL + 3.4), point = t.sample(site.s + 24, lateral), base = this.groundY(site.s + 24, lateral);
      if (this.nearestDistance(point.x, point.z) < 15.5) continue;
      poleTransforms.push({x: point.x, y: base + 4.2, z: point.z, sx: .08, sy: 8.4, sz: .08});
      flagTransforms.push({x: point.x - Math.cos(point.yaw) * .05, y: base + 7.8, z: point.z + Math.sin(point.yaw) * .05, ry: point.yaw - site.side * Math.PI / 2, sx: 2.2, sy: 1.3});
      flagColors.push(['#d9542f', '#f2e9cf', '#3a86a8'][index % 3]);
    }
    this.instanced('near', this.templates.cylinder6, mats.metal, poleTransforms, {name: 'scenery-flag-poles'});
    this.instanced('near', new THREE.PlaneGeometry(1, 1, 4, 2), mats.flag, flagTransforms, {name: 'scenery-flags', colors: flagColors});
    // Light towers with floodlight banks; lenses live in the merged glow batch.
    this.sites(6, {lateralMin: RAIL + 9, lateralMax: RAIL + 14, jitter: .8, tall: true, kind: 'lighttower', globalClearance: 18}).forEach(site => {
      const face = this.faceYaw(site.p, site.side), lightY = site.base + 16;
      this.add('mid', mats.metal, this.templates.cylinder6, {x: site.p.x, y: site.base + 8, z: site.p.z, sx: .26, sy: 16, sz: .26});
      this.add('mid', mats.metal, this.templates.box, {x: site.p.x, y: lightY, z: site.p.z, ry: site.p.yaw - Math.PI / 2, sx: 4, sy: .2, sz: .32});
      for (const offset of [-1.35, -.45, .45, 1.35]) {
        const point = t.sample(site.s + offset, site.lateral);
        this.add('mid', mats.metalDark, this.templates.box, {x: point.x, y: lightY - .4, z: point.z, ry: face, sx: .72, sy: .6, sz: .34});
        this.add('mid', mats.glow, this.templates.box, {x: point.x - Math.cos(face) * .18, y: lightY - .4, z: point.z + Math.sin(face) * .18, ry: face, sx: .6, sy: .42, sz: .06}, '#fff3cf');
      }
    });
    // Extra light masts in the evidence straight share the existing merged batches.
    for (const [index, site] of boostSites.entries()) {
      const lateral = site.side * (RAIL + 11), point = t.sample(site.s + 30, lateral), base = this.groundY(site.s + 30, lateral);
      const face = this.faceYaw(point, site.side), lightY = base + 15;
      this.add('mid', mats.metal, this.templates.cylinder6, {x: point.x, y: base + 7.5, z: point.z, sx: .24, sy: 15, sz: .24});
      this.add('mid', mats.metal, this.templates.box, {x: point.x, y: lightY, z: point.z, ry: point.yaw - Math.PI / 2, sx: 3.6, sy: .2, sz: .3});
      for (const offset of [-1.2, -.4, .4, 1.2]) {
        const q = t.sample(site.s + 30 + offset, lateral);
        this.add('mid', mats.metalDark, this.templates.box, {x: q.x, y: lightY - .38, z: q.z, ry: face, sx: .66, sy: .54, sz: .32});
        this.add('mid', mats.glow, this.templates.box, {x: q.x - Math.cos(face) * .17, y: lightY - .38, z: q.z + Math.sin(face) * .17, ry: face, sx: .54, sy: .38, sz: .06}, '#fff3cf');
      }
      this.boostShowcase++;
    }
    // Pit garages behind the grandstands, with lit garage bays.
    for (const [s, side] of [[10, 1], [t.length - 16, -1]]) {
      const lateral = side * (RAIL + 24), point = t.sample(s, lateral), base = this.groundY(s, lateral), face = this.faceYaw(point, side);
      this.add('mid', mats.concreteDark, this.templates.box, {x: point.x, y: base + 2.6, z: point.z, ry: point.yaw - Math.PI / 2, sx: 28, sy: 5.2, sz: 11});
      this.add('mid', mats.metal, this.templates.box, {x: point.x, y: base + 5.4, z: point.z, ry: point.yaw - Math.PI / 2, sx: 29, sy: .26, sz: 12});
      for (let bay = 0; bay < 5; bay++) {
        const q = t.sample(s + (bay - 2) * 5.4, lateral - side * 5.7);
        this.add('mid', mats.glow, this.templates.box, {x: q.x, y: base + 2.2, z: q.z, ry: face, sx: 3.4, sy: 2.2, sz: .1}, night ? '#ffe4ad' : '#a8ccd6');
      }
      const sign = t.sample(s, lateral - side * 5.85);
      this.addPanel('mid', signMaterial, atlas, 14, sign.x, base + 6.6, sign.z, {width: 14, height: 2.1, ry: face});
    }
    // Pit wall with sponsor boards along the start straight.
    for (const side of [-1, 1]) for (let s = 6; s < 96; s += 7) {
      const lateral = side * (RAIL + 2.6), point = t.sample(s, lateral), base = this.groundY(s, lateral), index = Math.round(s / 7);
      const alongYaw = point.yaw - Math.PI / 2;
      this.add('near', mats.concreteDark, this.templates.box, {x: point.x, y: base + .52, z: point.z, ry: alongYaw, sx: 6.4, sy: 1.05, sz: .42});
      if (index % 2 === 0) this.addPanel('near', signMaterial, atlas, 1 + (index % 5), point.x, base + .64, point.z, {width: 5, height: .92, ry: this.faceYaw(point, side)});
      this.add('near', mats.metalDark, this.templates.box, {x: point.x, y: base + 1.08, z: point.z, ry: alongYaw, sx: 6.4, sy: .1, sz: .46});
    }
    return {atlas, signMaterial, night};
  }
  // ---- far layer ----------------------------------------------------------
  // Rings are centred on the lap bounds and always sit outside every track point;
  // centring on a sampled track point used to push one ridge right up to the rail.
  buildBackdrop(theme) {
    const t = this.track, THREE = this.THREE;
    const center = t.bounds, ring = (radius, height, texture, material, bottom, repeat) => {
      texture.repeat.set(repeat, 1);
      const geometry = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(center.centerX, bottom + height / 2, center.centerZ);
      mesh.name = `scenery-backdrop-${radius}`;
      mesh.castShadow = mesh.receiveShadow = false;
      this.geometries.add(geometry);
      this.groups.far.add(mesh);
      return mesh;
    };
    let maxDistance = 0;
    for (const point of t.points) maxDistance = Math.max(maxDistance, Math.hypot(point.x - center.centerX, point.z - center.centerZ));
    const base = maxDistance + 260;
    if (theme === 'neon') {
      ring(base + 280, 260, this.lib.skyline, this.mats.skylineFar, -70, 5);
      ring(base + 120, 220, this.lib.skyline, this.mats.skylineNear, -70, 4);
    } else {
      ring(base + 380, 320, this.lib.ridgeFar, this.mats.ridgeFar, -80, 5);
      ring(base + 230, 280, this.lib.ridgeMid, this.mats.ridgeMid, -75, 4);
      if (theme !== 'coast') ring(base + 120, 240, this.lib.ridgeNear, this.mats.ridgeNear, -70, 3);
    }
  }
  // ---- finalise -----------------------------------------------------------
  finalizeBatches() {
    const THREE = this.THREE;
    for (const batch of this.batches.values()) {
      const parts = batch.parts;
      let vertexCount = 0;
      for (const part of parts) vertexCount += part.geometry.attributes.position.count;
      if (!vertexCount) continue;
      const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3), uvs = new Float32Array(vertexCount * 2);
      const useColor = !!batch.material.vertexColors, colors = useColor ? new Float32Array(vertexCount * 3) : null;
      let vertex = 0;
      for (const part of parts) {
        const geometry = part.geometry, count = geometry.attributes.position.count;
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        if (useColor) { const c = part.color || this.color.set('#ffffff'); for (let i = 0; i < count; i++) { colors[(vertex + i) * 3] = c.r; colors[(vertex + i) * 3 + 1] = c.g; colors[(vertex + i) * 3 + 2] = c.b; } }
        positions.set(geometry.attributes.position.array, vertex * 3);
        normals.set(geometry.attributes.normal.array, vertex * 3);
        if (geometry.attributes.uv) uvs.set(geometry.attributes.uv.array, vertex * 2);
        vertex += count;
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      if (colors) merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, batch.material);
      mesh.name = `scenery-${batch.layer}-${batch.material.name}`;
      mesh.userData.layer = batch.layer;
      mesh.castShadow = batch.layer !== 'far' && batch.layer !== 'detail' && !batch.material.transparent;
      mesh.receiveShadow = batch.layer !== 'far' && !batch.material.transparent;
      this.groups[batch.layer].add(mesh);
      this.geometries.add(merged);
    }
    for (const part of this.partGeometries) part.dispose();
    this.partGeometries.clear();
    this.batches.clear();
  }
  measureClearance() {
    const points = this.track.points;
    let minLateral = Infinity, violations = 0;
    for (const [x, z] of this.anchors) {
      let best = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dx = x - points[i].x, dz = z - points[i].z, distance = dx * dx + dz * dz;
        if (distance < best) best = distance;
      }
      const lateral = Math.sqrt(best);
      if (lateral < minLateral) minLateral = lateral;
      if (lateral < CLEARANCE - .05) violations++;
    }
    return {minLateral: Number.isFinite(minLateral) ? Math.round(minLateral * 100) / 100 : 0, violations, limit: CLEARANCE};
  }
  computeStats() {
    const stats = {draws: 0, triangles: 0, instances: 0, materials: this.materials.size, geometries: 0, textures: 0, detail: this.detail, layers: {}};
    for (const [layer, group] of Object.entries(this.groups)) {
      const layerStats = {draws: 0, triangles: 0, instances: 0};
      group.traverse(object => {
        if (!object.isMesh) return;
        const geometry = object.geometry, base = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
        const count = object.isInstancedMesh ? object.count : 1;
        layerStats.draws++; layerStats.triangles += base * count; layerStats.instances += object.isInstancedMesh ? count : 0;
      });
      stats.layers[layer] = layerStats;
      stats.triangles += layerStats.triangles; stats.instances += layerStats.instances;
      if (layer !== 'detail') stats.draws += layerStats.draws;
    }
    stats.draws += stats.layers.detail.draws;
    stats.detailDraws = stats.layers.detail.draws;
    stats.detailTriangles = stats.layers.detail.triangles;
    stats.geometries = this.geometries.size;
    stats.clearance = this.measureClearance();
    stats.anchors = this.anchors;
    stats.features = {...this.features, boostShowcase: this.boostShowcase};
    return stats;
  }
  build() {
    const theme = THEMES[this.theme] ? this.theme : 'coast';
    this.buildMaterials();
    this.buildBackdrop(theme);
    const shared = this.buildCommon();
    THEMES[theme](this, shared);
    this.finalizeBatches();
    const stats = this.computeStats();
    const retainedTextures = this.lib.retainedTextures();
    stats.textures = retainedTextures.length;
    const kit = {
      group: this.root,
      detailGroup: this.groups.detail,
      update: (dt, time, reducedMotion) => this.update(dt, time, reducedMotion),
      retainedTextures,
      stats,
      dispose: () => this.dispose(),
    };
    this.kit = kit;
    return kit;
  }
  update(dt = 0, time = 0, reducedMotion = this.reducedMotion) {
    if (this.disposed) return;
    if (reducedMotion) return;
    const next = Number.isFinite(time) ? time : this.time + clamp(dt, 0, .1);
    this.time = next;
    this.timeUniform.value = next;
    const animated = this.animated;
    if (animated.water) { animated.water.normalMap.offset.set(next * .014, next * .022); }
    if (animated.beam) { animated.beam.rotation.y = next * .9; }
    if (animated.rings) {
      const {mesh, halo, items} = animated.rings, dummy = this.dummy;
      items.forEach((item, index) => {
        dummy.position.set(item.x, item.y + Math.sin(next * item.speed + item.phase) * .45, item.z);
        dummy.rotation.set(.22 * Math.sin(next * .6 + item.phase), next * item.spin + item.phase, .16 * Math.cos(next * .5 + item.phase), 'YXZ');
        dummy.scale.setScalar(item.scale); dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        dummy.scale.setScalar(item.scale * 1.14); dummy.updateMatrix();
        halo.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true; halo.instanceMatrix.needsUpdate = true;
    }
    for (const entry of animated.pulse) entry.material.emissiveIntensity = entry.base + Math.sin(next * entry.speed + entry.phase) * entry.amount;
    for (const entry of animated.dust) entry.material.opacity = entry.base + Math.sin(next * .35 + entry.phase) * entry.amount;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.instancedMeshes) mesh.dispose();
    this.root.removeFromParent();
    this.root.clear();
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.clear();
    for (const material of this.materials.values()) material.dispose(); // textures are retained by the library
    this.materials.clear();
    this.batches.clear();
    this.anchors.length = 0;
    this.animated = {water: null, beam: null, rings: null, pulse: [], dust: []};
  }
}

// ---------------------------------------------------------------------------
// Trackside atlas content. Every board shares one texture so the whole set is a
// single draw call per theme (day and glow variants).
// ---------------------------------------------------------------------------
export const TRACKSIDE_ADS = [
  {text: 'JRC', sub: 'performance division', bg: '#e7dfcc', bg2: '#d8cfb8', ink: '#1b2024', accent: '#d9542f', motif: 'chevrons', code: 'EST. 2026'},
  {text: 'TURBO', sub: 'synthetic fuel', bg: '#e6efe9', bg2: '#cfdfd8', ink: '#1d2926', accent: '#2f8f83', motif: 'bolt', code: 'RON 102'},
  {text: 'APEX', sub: 'competition tyres', bg: '#f0e8d6', bg2: '#e2d8c2', ink: '#23282c', accent: '#c2412f', motif: 'rings', code: 'SLICK C3'},
  {text: 'SLIPSTREAM', sub: 'aero systems', accent: '#3b6fa8', motif: 'bars', code: 'CFD-09'},
  {text: 'NITRO', sub: 'energy drinks', accent: '#b8892f', motif: 'bolt', code: 'ICE COLD'},
  {text: 'HALO', sub: 'brake technology', accent: '#7b4fa3', motif: 'rings', code: 'CARBON'},
  {text: '100', sub: 'metres', bg: '#1c2a24', accent: '#e5dfc6', motif: 'bars', code: 'SECTOR 1'},
  {text: '200', sub: 'metres', bg: '#1c2a24', accent: '#e5dfc6', motif: 'bars', code: 'SECTOR 1'},
  {text: '300', sub: 'metres', bg: '#1c2a24', accent: '#e5dfc6', motif: 'bars', code: 'SECTOR 2'},
  {text: '400', sub: 'metres', bg: '#1c2a24', accent: '#e5dfc6', motif: 'bars', code: 'SECTOR 2'},
  {text: '500', sub: 'metres', bg: '#1c2a24', accent: '#e5dfc6', motif: 'bars', code: 'SECTOR 3'},
  {text: 'BRAKE', sub: 'next corner', bg: '#3a1f16', accent: '#e07b3c', motif: 'chevrons', code: 'CAUTION'},
  {text: 'CAUTION', sub: 'crest ahead', bg: '#31280f', accent: '#e0b73c', motif: 'bars', code: 'SLOW'},
  {text: 'CHECKPOINT', sub: 'timing loop', bg: '#182430', accent: '#6fb7c9', motif: 'grid', code: 'LIVE'},
  {text: 'START / FINISH', sub: 'junior racers cup', accent: '#d9542f', motif: 'grid', code: 'LAP 01'},
  {text: 'WELCOME', sub: 'race clean · drive fast', bg: '#e5ecdf', bg2: '#d3ddcc', ink: '#1d2a26', accent: '#3f7f78', motif: 'bars', code: 'JRC'},
];
export const NEON_ADS = [
  {text: 'VELOCITY', sub: 'night express', bg: '#070510', accent: '#ff3fa4', ink: '#ffe8fb', motif: 'bars', neon: true},
  {text: 'NIGHT RUN', sub: 'sector 9', bg: '#050912', accent: '#35e0ff', ink: '#e6fbff', motif: 'chevrons', neon: true},
  {text: 'PULSE', sub: 'holo network', bg: '#0a0612', accent: '#b06bff', ink: '#f3e8ff', motif: 'rings', neon: true},
  {text: 'SYNTH', sub: 'audio lab', bg: '#070512', accent: '#ff7a2f', ink: '#fff0e2', motif: 'bolt', neon: true},
  {text: 'DRIVE', sub: 'city motors', bg: '#06100f', accent: '#3dffc0', ink: '#e9fff7', motif: 'grid', neon: true},
  {text: 'ELECTRA', sub: 'power cell', bg: '#0b0713', accent: '#ffd23f', ink: '#fff8dc', motif: 'rings', neon: true},
  {text: 'ZERO-G', sub: 'hover club', bg: '#080611', accent: '#4d8dff', ink: '#e8f2ff', motif: 'chevrons', neon: true},
  {text: 'HOLO', sub: 'open channel', bg: '#0c0512', accent: '#ff4fd8', ink: '#ffe9fa', motif: 'grid', neon: true},
];

// ---------------------------------------------------------------------------
// Coast: palm avenue, broadleaf trees, beach grass, sea cliffs, islands + lighthouse.
// ---------------------------------------------------------------------------
function buildCoast(builder) {
  const t = builder.track, THREE = builder.THREE, mats = builder.mats, R = builder.random;
  const density = builder.density;
  // Palm avenue: dense near the start straight, then scattered around the lap.
  const palmSites = [];
  const target = Math.round(72 * density);
  for (let attempt = 0; attempt < target * 16 && palmSites.length < target; attempt++) {
    const s = R() * t.length;
    if (Math.abs(shortDistance(s, 0, t.length)) < 55) continue;
    if (Math.abs(t.curvature(s)) > .022) continue;
    const side = attempt % 2 ? -1 : 1, lateral = side * (RAIL + 4.8 + R() * 15);
    const p = t.sample(s, lateral), base = builder.groundY(s, lateral);
    if (builder.nearestDistance(p.x, p.z) < 16) continue;
    palmSites.push({s, side, lateral, p, base}); builder.anchor(p.x, p.z, 'palm');
  }
  for (let i = 0; i < 14; i++) {
    const s = 32 + i * 13, side = i % 2 ? -1 : 1, lateral = side * (RAIL + 4.8 + (i % 3) * 2.6);
    const p = t.sample(s, lateral), base = builder.groundY(s, lateral);
    if (builder.nearestDistance(p.x, p.z) < 16) continue;
    palmSites.push({s, side, lateral, p, base}); builder.anchor(p.x, p.z, 'palm');
  }
  // Three authored palm variants (tall straight / medium lean / short strong lean),
  // each with 14-18 curved tapered fronds in three tiers plus a coconut cluster.
  const trunkVariants = [[], [], []], frondVariants = [[], []], frondColors = [], coconuts = [], coconutColors = [];
  for (const site of palmSites) {
    const height = 6.2 + R() * 5.4;
    const variant = height > 9.4 ? 0 : height > 7.7 ? 1 : 2;
    const thickness = (variant === 2 ? .92 : 1.02) + R() * .42;
    const lean = R() * TAU;
    trunkVariants[variant].push({x: site.p.x, y: site.base, z: site.p.z, ry: lean, sx: thickness, sy: height, sz: thickness});
    const geometryLean = [.24, .42, .62][variant];
    const topOffset = Math.sin([1.05, 1.3, 1.55][variant]) * geometryLean * thickness * .95;
    const topX = site.p.x + Math.cos(lean) * topOffset, topZ = site.p.z - Math.sin(lean) * topOffset, topY = site.base + height - .02;
    const coconutCount = 3 + ((R() * 4) | 0);
    for (let c = 0; c < coconutCount; c++) {
      const angle = R() * TAU, radius = .18 + R() * .3;
      coconuts.push({x: topX + Math.cos(angle) * radius, y: topY - .16 - R() * .28, z: topZ + Math.sin(angle) * radius, s: .17 + R() * .12});
      coconutColors.push(['#5b4c2c', '#6b5836', '#4a3f26', '#72603c'][c % 4]);
    }
    const frondCount = variant === 0 ? 18 : variant === 1 ? 16 : 14;
    for (let i = 0; i < frondCount; i++) {
      const t = i / frondCount;
      const tier = i % 3; // upper crown, mid fan, drooping skirt
      const direction = lean + i * 2.399963 + (R() - .5) * .22; // golden-angle fan
      const droopy = tier === 2 || R() < .18;
      const frond = {
        x: topX, y: topY - .04, z: topZ,
        ry: direction,
        rx: tier === 0 ? -.22 - R() * .22 : tier === 1 ? -.5 - R() * .24 : -.84 - R() * .3,
        rz: (R() - .5) * .7,
        sx: tier === 0 ? 3.1 + R() * 1 : 3.8 + R() * 1.5,
        sy: 1.85 + R() * .7,
        sz: 1,
      };
      frondVariants[droopy ? 1 : 0].push(frond);
      frondColors.push(['#8fb16a', '#a7c77a', '#7d9f5c', '#b9cc85', '#96b470', '#c2d294'][i % 6]);
    }
  }
  for (let variant = 0; variant < 3; variant++) {
    builder.instanced('near', palmTrunkGeometry(THREE, variant), mats.palmTrunk, trunkVariants[variant], {name: `scenery-palm-trunks-${variant}`});
  }
  for (let variant = 0; variant < 2; variant++) {
    builder.instanced('mid', frondGeometry(THREE, variant ? 1.7 : 1), mats.palmFrond, frondVariants[variant], {
      name: `scenery-palm-fronds-${variant}`, colors: frondColors, castShadow: false,
    });
  }
  builder.instanced('mid', palmCoconutGeometry(THREE), mats.palmCoconut, coconuts, {name: 'scenery-palm-coconuts', colors: coconutColors, castShadow: false});
  // Broadleaf trees inland.
  const treeSites = builder.sites(Math.round(36 * density), {lateralMin: RAIL + 7, lateralMax: RAIL + 42, sides: [1], jitter: .9, kind: 'tree', globalClearance: 20});
  const treeTrunks = [], leafCards = [], leafColors = [];
  for (const site of treeSites) {
    const height = 4.2 + R() * 4.4, crownY = site.base + height * .9;
    treeTrunks.push({x: site.p.x, y: site.base, z: site.p.z, sx: .22 + R() * .12, sy: height, sz: .22 + R() * .12});
    for (let card = 0; card < 5; card++) {
      leafCards.push({
        x: site.p.x + (R() - .5) * 1.8, y: crownY + (card - 2) * 1.05 + R() * .7, z: site.p.z + (R() - .5) * 1.8,
        ry: R() * TAU, rx: -.22 + R() * .45, rz: R() * .6,
        sx: 2.6 + R() * 2, sy: 2.4 + R() * 1.6,
      });
      leafColors.push(['#93af70', '#a7bd82', '#7c975f', '#b7c692', '#86a267'][card % 5]);
    }
  }
  builder.instanced('mid', builder.templates.cylinder6, mats.bark, treeTrunks, {name: 'scenery-tree-trunks'});
  builder.instanced('mid', builder.templates.plane, mats.broadleaf, leafCards, {name: 'scenery-tree-leaves', colors: leafColors, castShadow: false});
  // Boulders use the lighter stratified sandstone.
  builder.instanced('mid', rockGeometry(THREE, 47, 1), mats.rockDark, builder.sites(Math.round(28 * density), {lateralMin: RAIL + 3, lateralMax: RAIL + 28, jitter: .9, kind: 'boulder', globalClearance: 18}).map(site => ({
    x: site.p.x, y: site.base, z: site.p.z, ry: R() * TAU, rx: R() * .5, rz: R() * .5,
    sx: 1.2 + R() * 3.4, sy: .8 + R() * 2.2, sz: 1 + R() * 2.8,
  })), {name: 'scenery-boulders'});
  // Pale beach-sand patches soften the grass shoulder.
  for (let i = 0; i < 14; i++) {
    const s = R() * t.length, side = i % 2 ? -1 : 1, lateral = side * (RAIL + 5 + R() * 9);
    const p = t.sample(s, lateral), base = builder.groundY(s, lateral);
    builder.add('mid', mats.sand, builder.templates.plane, {x: p.x, y: base + .1, z: p.z, ry: p.yaw, rx: -Math.PI / 2, sx: 3 + R() * 3.4, sy: 3 + R() * 3.4});
  }
  if (builder.detail) {
    builder.instanced('detail', builder.templates.plane, mats.grassCard, builder.sites(Math.round(330 * density), {lateralMin: RAIL + 2.2, lateralMax: RAIL + 18, jitter: 1, kind: 'grass', globalClearance: 15}).map(site => ({
      x: site.p.x, y: site.base + .45, z: site.p.z, ry: R() * TAU, rx: -.12 + R() * .24,
      sx: .8 + R() * 1.1, sy: .6 + R() * .85,
    })), {name: 'scenery-beach-grass', colors: undefined, castShadow: false});
    builder.instanced('detail', rockGeometry(THREE, 13, 0), mats.rockDark, builder.sites(70, {lateralMin: RAIL + 2, lateralMax: RAIL + 8, jitter: 1, kind: 'pebble', globalClearance: 15}).map(site => ({
      x: site.p.x, y: site.base + .1, z: site.p.z, ry: R() * TAU, sx: .2 + R() * .5, sy: .16 + R() * .35, sz: .2 + R() * .5,
    })), {name: 'scenery-beach-pebbles', castShadow: false});
  }
  // Sea: one plane + a subtle sun glint; the normal map scrolls in update.
  const bounds = t.bounds;
  let maxDistance = 0;
  for (const point of t.points) maxDistance = Math.max(maxDistance, Math.hypot(point.x - bounds.centerX, point.z - bounds.centerZ));
  const seaX = bounds.centerX - maxDistance - 620, seaZ = bounds.centerZ;
  const waterGeometry = new THREE.PlaneGeometry(3400, 3400, 1, 1);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterUv = waterGeometry.attributes.uv;
  for (let i = 0; i < waterUv.count; i++) waterUv.setXY(i, waterUv.getX(i) * 120, waterUv.getY(i) * 120);
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: '#16607a', roughness: .42, metalness: .05, envMapIntensity: .18,
    normalMap: builder.lib.waterNormal, normalScale: new THREE.Vector2(.75, .75),
  });
  waterMaterial.name = 'scenery-water';
  builder.materials.set('water', waterMaterial);
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.set(seaX, -22, seaZ); water.name = 'scenery-sea';
  builder.geometries.add(waterGeometry); builder.groups.far.add(water);
  builder.animated.water = waterMaterial;
  const glintGeometry = new THREE.PlaneGeometry(1100, 300);
  const glint = new THREE.Mesh(glintGeometry, mats.sunGlint);
  glint.rotation.x = -Math.PI / 2; glint.rotation.z = -.1;
  glint.position.set(seaX - 120, -21.5, seaZ - 80); glint.name = 'scenery-sun-glint';
  builder.geometries.add(glintGeometry); builder.groups.far.add(glint);

  // Visible coastal shelf on the outside of the lap: ocean ring, breakwater and
  // headland rocks sitting below road level so chase views actually read as coast.
  const outwardAt = point => {
    const dx = point.x - bounds.centerX, dz = point.z - bounds.centerZ, length = Math.hypot(dx, dz) || 1;
    return {x: dx / length, z: dz / length};
  };
  const SEA_Y = -15.4, seaSegments = Math.ceil(t.length / 7);
  const ringPositions = [], ringUvs = [], ringIndices = [];
  for (let i = 0; i <= seaSegments; i++) {
    const s = i / seaSegments * t.length, p = t.sample(s), out = outwardAt(p);
    for (const distance of [122, 1500]) {
      ringPositions.push(p.x + out.x * distance, SEA_Y, p.z + out.z * distance);
    }
    ringUvs.push(i / seaSegments * 42, 0, i / seaSegments * 42, 1);
    if (i < seaSegments) { const n = i * 2; ringIndices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
  }
  const seaGeometry = new THREE.BufferGeometry();
  seaGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ringPositions, 3));
  seaGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(ringUvs, 2));
  seaGeometry.setIndex(ringIndices); seaGeometry.computeVertexNormals();
  const seaMesh = new THREE.Mesh(seaGeometry, waterMaterial);
  seaMesh.name = 'scenery-coast-sea'; seaMesh.receiveShadow = false;
  builder.geometries.add(seaGeometry); builder.groups.far.add(seaMesh);
  builder.features.sea = true;
  // Breakwater: weathered concrete blocks along the shoreline.
  const breakwater = [];
  for (let s = 4; s < t.length; s += 13) {
    const p = t.sample(s), out = outwardAt(p), distance = 118 + R() * 12;
    breakwater.push({
      x: p.x + out.x * distance, y: SEA_Y + .9, z: p.z + out.z * distance,
      ry: Math.atan2(-out.x, -out.z) + (R() - .5) * .12, sx: 8 + R() * 6, sy: 1.6 + R() * .9, sz: 3.2 + R() * 1.8,
    });
  }
  builder.instanced('far', builder.templates.box, mats.concreteDark, breakwater, {name: 'scenery-coast-breakwater', castShadow: false});
  // Headland rocks and offshore sea stacks: tops stay under the road sightline.
  const headland = [], headlandColors = [];
  const pushStack = (x, z, baseY, scale, kind) => {
    if (builder.nearestDistance(x, z) < 22) return;
    headland.push({x, y: baseY, z, ry: R() * TAU, rx: R() * .2, rz: R() * .2, sx: scale * (.8 + R() * .4), sy: scale * (.8 + R() * .5), sz: scale * (.8 + R() * .4)});
    headlandColors.push(['#e8d7b4', '#d3bd96', '#dfcaa4', '#c9b189'][(R() * 4) | 0]);
    builder.anchor(x, z, kind);
  };
  // Continuous rocky headland band between the shoulder and the water, plus surf.
  for (let s = 0; s < t.length; s += 9) {
    const p = t.sample(s), out = outwardAt(p), distance = RAIL + 20 + R() * 44;
    const x = p.x + out.x * distance, z = p.z + out.z * distance;
    const blend = clamp((distance - 13) / 70, 0, 1), smooth = blend * blend * (3 - 2 * blend);
    const baseY = (p.y - 1.5) * (1 - smooth) - 18 * smooth;
    const topLimit = t.sample(s).y - .4;
    const sy = clamp(topLimit - baseY - 1, 5, 22);
    if (builder.nearestDistance(x, z) < 26) continue;
    headland.push({x, y: baseY - sy * .18, z, ry: R() * TAU, rx: R() * .16, rz: R() * .16, sx: 10 + R() * 16, sy, sz: 9 + R() * 14});
    headlandColors.push(['#e8d7b4', '#d3bd96', '#dfcaa4', '#c9b189'][(R() * 4) | 0]);
    builder.anchor(x, z, 'coast-cliff');
  }
  for (let s = 0; s < t.length; s += 15) {
    const p = t.sample(s), out = outwardAt(p), distance = RAIL + 22 + R() * 58;
    const x = p.x + out.x * distance, z = p.z + out.z * distance;
    const blend = clamp((distance - 13) / 70, 0, 1), smooth = blend * blend * (3 - 2 * blend);
    const baseY = (p.y - 1.5) * (1 - smooth) - 18 * smooth;
    const topLimit = t.sample(s).y + .6; // never poke above the road eye-line
    const sy = clamp(topLimit - baseY - 1.5, 3, 17);
    if (builder.nearestDistance(x, z) < 26) continue;
    headland.push({x, y: baseY - sy * .22, z, ry: R() * TAU, rx: R() * .16, rz: R() * .16, sx: 12 + R() * 20, sy, sz: 11 + R() * 18});
    headlandColors.push(['#e8d7b4', '#d3bd96', '#dfcaa4', '#c9b189'][(R() * 4) | 0]);
    builder.anchor(x, z, 'coast-cliff');
  }
  for (let i = 0; i < 14; i++) {
    const p = t.sample(R() * t.length), out = outwardAt(p), distance = 190 + R() * 260;
    pushStack(p.x + out.x * distance, p.z + out.z * distance, SEA_Y - 3 - R() * 3, 9 + R() * 14, 'sea-stack');
  }
  // Whitewater line where the ocean meets the rocky shore.
  const foamPositions = [], foamIndices = [];
  const foamSegments = Math.ceil(t.length / 10);
  for (let i = 0; i <= foamSegments; i++) {
    const p = t.sample(i / foamSegments * t.length), out = outwardAt(p);
    for (const distance of [114, 128]) {
      foamPositions.push(p.x + out.x * distance, SEA_Y + .12, p.z + out.z * distance);
    }
    if (i < foamSegments) { const n = i * 2; foamIndices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
  }
  const foamGeometry = new THREE.BufferGeometry();
  foamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(foamPositions, 3));
  foamGeometry.setIndex(foamIndices); foamGeometry.computeVertexNormals();
  const foamMaterial = builder.material('sea-foam', () => new THREE.MeshBasicMaterial({color: '#e9f4f2', transparent: true, opacity: .42, depthWrite: false}));
  const foam = new THREE.Mesh(foamGeometry, foamMaterial);
  foam.name = 'scenery-coast-surf'; foam.renderOrder = 1;
  builder.geometries.add(foamGeometry); builder.groups.far.add(foam);
  const headlandGeometry = scaleUv(rockGeometry(THREE, 91, 1), 2.2, 1.4);
  builder.instanced('far', headlandGeometry, mats.rock, headland, {name: 'scenery-coast-headland', colors: headlandColors, castShadow: false});
  builder.features.coastShelf = headland.length;
  // Off-shore islands toward -X (the renderer's sea direction) with a lighthouse.
  for (const [index, angle] of [Math.PI - .55, Math.PI, Math.PI + .55].entries()) {
    const distance = maxDistance + 380 + index * 80;
    const x = bounds.centerX + Math.cos(angle) * distance, z = bounds.centerZ + Math.sin(angle) * distance;
    const geometry = rockGeometry(THREE, 300 + index, 1);
    const island = new THREE.Mesh(geometry, mats.rockDark);
    island.position.set(x, -16 + index * 2, z); island.scale.set(58 + index * 16, 30 + index * 10, 52 + index * 14);
    island.name = `scenery-island-${index}`; island.castShadow = island.receiveShadow = false;
    builder.geometries.add(geometry); builder.groups.far.add(island);
  }
  const islandX = bounds.centerX + Math.cos(Math.PI) * (maxDistance + 460), islandZ = bounds.centerZ + Math.sin(Math.PI) * (maxDistance + 460);
  const lighthouse = new THREE.Group(); lighthouse.name = 'scenery-lighthouse';
  const towerGeometry = new THREE.CylinderGeometry(.78, 1.15, 9, 10);
  const tower = new THREE.Mesh(towerGeometry, builder.material('lighthouse-tower', () => new THREE.MeshStandardMaterial({color: '#ece4d2', roughness: .82, metalness: .04})));
  tower.position.set(islandX, 2.5, islandZ); lighthouse.add(tower); builder.geometries.add(towerGeometry);
  for (const [bandY, bandHeight] of [[2.4, 1.5], [5.1, 1.5]]) {
    const bandGeometry = new THREE.CylinderGeometry(1.02 + (bandY - 2.4) * -.035, 1.06 + (bandY - 2.4) * -.035, bandHeight, 10, 1, true);
    const band = new THREE.Mesh(bandGeometry, mats.lighthouseRed);
    band.position.set(islandX, bandY, islandZ); lighthouse.add(band); builder.geometries.add(bandGeometry);
  }
  const lanternGeometry = new THREE.CylinderGeometry(.92, .92, 1.4, 8);
  const lantern = new THREE.Mesh(lanternGeometry, builder.material('lantern-glow', () => new THREE.MeshBasicMaterial({color: '#ffe9b0', toneMapped: false})));
  lantern.position.set(islandX, 7.9, islandZ); lighthouse.add(lantern); builder.geometries.add(lanternGeometry);
  const roofGeometry = new THREE.ConeGeometry(1.1, 1.2, 8);
  const roof = new THREE.Mesh(roofGeometry, mats.metalDark);
  roof.position.set(islandX, 9.2, islandZ); lighthouse.add(roof); builder.geometries.add(roofGeometry);
  const beamGeometry = new THREE.ConeGeometry(2.6, 22, 10, 1, true);
  beamGeometry.rotateZ(Math.PI / 2); beamGeometry.translate(11, 0, 0);
  const beam = new THREE.Mesh(beamGeometry, mats.lighthouseBeam);
  beam.position.set(islandX, 7.9, islandZ); beam.name = 'scenery-lighthouse-beam';
  builder.geometries.add(beamGeometry); lighthouse.add(beam);
  builder.animated.beam = beam;
  for (const mesh of [tower, lantern, roof, beam]) { mesh.castShadow = false; mesh.receiveShadow = false; }
  builder.groups.far.add(lighthouse);
  // Lifeguard huts and beach parasols sell the resort coast at chase distance.
  for (const [s, side] of [[68, -1], [110, -1]]) {
    const lateral = side * (RAIL + 16), point = t.sample(s, lateral), base = builder.groundY(s, lateral), face = builder.faceYaw(point, side);
    if (builder.nearestDistance(point.x, point.z) < 22) continue;
    for (const offset of [-1.1, 1.1]) {
      builder.add('mid', mats.wood, builder.templates.cylinder6, {x: point.x + Math.cos(face) * offset, y: base + 1.5, z: point.z - Math.sin(face) * offset, sx: .14, sy: 3, sz: .14});
    }
    builder.add('mid', mats.wood, builder.templates.box, {x: point.x, y: base + 3.1, z: point.z, ry: face, sx: 3, sy: 2.1, sz: 2.6});
    builder.add('mid', mats.metal, builder.templates.box, {x: point.x, y: base + 4.3, z: point.z, ry: face, sx: 3.6, sy: .16, sz: 3.2});
    builder.addPanel('mid', mats.signDay, builder.lib.atlas('trackside', TRACKSIDE_ADS), 5, point.x, base + 3.3, point.z + 0, {width: 2.2, height: .9, ry: face});
    builder.add('mid', mats.glow, builder.templates.box, {x: point.x, y: base + 4.55, z: point.z, ry: face, sx: .3, sy: .3, sz: .3}, '#ffd9a0');
    builder.anchor(point.x, point.z, 'lifeguard');
  }
  const parasolGeometry = new THREE.ConeGeometry(1, 1, 10, 1, true);
  builder.geometries.add(parasolGeometry);
  for (let i = 0; i < 9; i++) {
    const s = 42 + i * 11, side = i % 2 ? -1 : 1, lateral = side * (RAIL + 4.5 + R() * 4);
    const point = t.sample(s, lateral), base = builder.groundY(s, lateral);
    if (builder.nearestDistance(point.x, point.z) < 16) continue;
    builder.add('mid', mats.metal, builder.templates.cylinder6, {x: point.x, y: base + 1.2, z: point.z, sx: .06, sy: 2.4, sz: .06});
    builder.add('mid', mats.tent, parasolGeometry, {x: point.x, y: base + 2.4, z: point.z, ry: R() * TAU, sx: 1.5 + R() * .7, sy: .9, sz: 1.5 + R() * .7});
    builder.anchor(point.x, point.z, 'parasol');
  }
  // Driftwood beach decks on the sea shoulder.
  for (const site of builder.sites(8, {lateralMin: RAIL + 7, lateralMax: RAIL + 14, jitter: .9, kind: 'deck', globalClearance: 17})) {
    builder.add('mid', mats.wood, builder.templates.box, {x: site.p.x, y: site.base + .22, z: site.p.z, ry: site.p.yaw, sx: 2.4, sy: .22, sz: 5.6});
    builder.add('mid', mats.wood, builder.templates.cylinder6, {x: site.p.x, y: site.base + .5, z: site.p.z, sx: .09, sy: 1, sz: .09});
  }
}

// ---------------------------------------------------------------------------
// Canyon: layered mesas and hoodoos, dry shrubs, dust haze, natural arch.
// ---------------------------------------------------------------------------
function buildCanyon(builder) {
  const t = builder.track, THREE = builder.THREE, mats = builder.mats, R = builder.random;
  const density = builder.density;
  const mesas = [
    scaleUv(mesaGeometry(THREE, 71), 6, 2.6),
    scaleUv(mesaGeometry(THREE, 143), 7, 2.2),
    scaleUv(mesaGeometry(THREE, 217), 5, 3),
  ];
  const mesaSites = builder.sites(Math.round(15 * density), {lateralMin: RAIL + 34, lateralMax: RAIL + 190, jitter: 1, kind: 'mesa', globalClearance: 95});
  for (let variant = 0; variant < mesas.length; variant++) {
    const sites = mesaSites.filter((_, index) => index % mesas.length === variant);
    if (!sites.length) continue;
    const transforms = sites.map(site => ({
      x: site.p.x, y: site.base - 3, z: site.p.z, ry: R() * TAU,
      sx: 14 + R() * 20, sy: 26 + R() * 34, sz: 13 + R() * 18,
    }));
    builder.instanced('far', mesas[variant], mats.rock, transforms, {
      name: `scenery-mesas-${variant}`, castShadow: false,
      colors: transforms.map(() => ['#dcc49e', '#cbae86', '#e4cea6', '#bfa27c', '#d5b992'][(R() * 5) | 0]),
    });
  }
  // Talus cones ground the mesa silhouettes.
  builder.instanced('far', new THREE.ConeGeometry(1, 1, 8), mats.rockDark, mesaSites.map(site => ({
    x: site.p.x, y: site.base, z: site.p.z, ry: R() * TAU,
    sx: 9 + R() * 14, sy: 2.5 + R() * 4, sz: 9 + R() * 12,
  })), {name: 'scenery-talus', castShadow: false});
  // Far buttes fill the second depth layer.
  const buttes = [
    scaleUv(mesaGeometry(THREE, 311), 8, 2.4),
    scaleUv(mesaGeometry(THREE, 419), 9, 3.2),
  ];
  const butteSites = builder.sites(Math.round(8 * density), {lateralMin: RAIL + 150, lateralMax: RAIL + 330, jitter: 1, kind: 'butte', globalClearance: 175});
  for (let variant = 0; variant < buttes.length; variant++) {
    const sites = butteSites.filter((_, index) => index % buttes.length === variant);
    if (!sites.length) continue;
    builder.instanced('far', buttes[variant], mats.rock, sites.map(site => ({
      x: site.p.x, y: -18, z: site.p.z, ry: R() * TAU,
      sx: 55 + R() * 65, sy: 44 + R() * 60, sz: 48 + R() * 55,
    })), {name: `scenery-buttes-${variant}`, castShadow: false});
  }
  // Guaranteed landmark mesas + hoodoos inside the hero camera's field of view.
  const heroMesaSites = builder.sites(4, {lateralMin: RAIL + 44, lateralMax: RAIL + 82, jitter: .2, kind: 'hero-mesa', globalClearance: 62, offset: 30, span: 150});
  builder.instanced('far', mesas[1], mats.rock, heroMesaSites.map(site => ({
    x: site.p.x, y: site.base - 3, z: site.p.z, ry: R() * TAU, sx: 15 + R() * 9, sy: 24 + R() * 14, sz: 14 + R() * 9,
  })), {name: 'scenery-hero-mesas', castShadow: false, colors: heroMesaSites.map(() => ['#e0c9a2', '#c9ad86', '#d8bd95'][(R() * 3) | 0])});
  const heroHoodooSites = builder.sites(7, {lateralMin: RAIL + 6, lateralMax: RAIL + 26, jitter: .3, kind: 'hero-hoodoo', globalClearance: 18, offset: 28, span: 130});
  const hoodooGeometryTemplate = scaleUv(hoodooGeometry(THREE, 29), 5, 2.5);
  const hoodooTransforms = builder.sites(Math.round(28 * density), {lateralMin: RAIL + 8, lateralMax: RAIL + 46, jitter: .95, kind: 'hoodoo', globalClearance: 20}).map(site => ({
    x: site.p.x, y: site.base, z: site.p.z, ry: R() * TAU,
    sx: 1.1 + R() * 1.5, sy: 3.5 + R() * 7.5, sz: 1.1 + R() * 1.4,
  }));
  for (const site of heroHoodooSites) hoodooTransforms.push({
    x: site.p.x, y: site.base, z: site.p.z, ry: R() * TAU, sx: 1.2 + R() * 1.1, sy: 4.5 + R() * 5.5, sz: 1.1 + R() * 1,
  });
  builder.instanced('mid', hoodooGeometryTemplate, mats.rock, hoodooTransforms, {
    name: 'scenery-hoodoos', colors: hoodooTransforms.map(() => ['#dcc49e', '#cbae86', '#e0c8a0'][(R() * 3) | 0]),
  });
  builder.instanced('mid', rockGeometry(THREE, 57, 1), mats.rockDark, builder.sites(Math.round(36 * density), {lateralMin: RAIL + 2.6, lateralMax: RAIL + 28, jitter: .95, kind: 'canyon-rock', globalClearance: 17}).map(site => ({
    x: site.p.x, y: site.base, z: site.p.z, ry: R() * TAU, rx: R() * .3, rz: R() * .3,
    sx: 1 + R() * 3.2, sy: .7 + R() * 2.1, sz: 1 + R() * 2.6,
  })), {name: 'scenery-canyon-rocks'});
  const shrubTransforms = builder.sites(Math.round(300 * density), {lateralMin: RAIL + 1.8, lateralMax: RAIL + 26, jitter: 1, kind: 'shrub', globalClearance: 15}).map(site => ({
    x: site.p.x, y: site.base + .5, z: site.p.z, ry: R() * TAU, rx: -.1 + R() * .2,
    sx: 1.2 + R() * 1.9, sy: .95 + R() * 1.5,
  }));
  builder.instanced('mid', builder.templates.plane, mats.shrub, shrubTransforms, {name: 'scenery-dry-shrubs', colors: shrubTransforms.map(() => ['#c2b183', '#b09a6c', '#cec08f', '#a89063', '#d4c79b'][(R() * 5) | 0]), castShadow: false});
  // Natural sandstone arch: a far landmark that is not a light-show arch.
  const archSites = builder.sites(2, {lateralMin: RAIL + 55, lateralMax: RAIL + 105, jitter: 1, kind: 'arch', globalClearance: 70});
  for (const site of archSites) {
    const geometry = new THREE.TorusGeometry(1, .16, 10, 26, Math.PI);
    geometry.rotateZ(Math.PI);
    const arch = new THREE.Mesh(geometry, mats.rock);
    arch.position.set(site.p.x, site.base, site.p.z);
    arch.rotation.y = site.p.yaw;
    arch.scale.set(24 + R() * 14, 18 + R() * 10, 14 + R() * 6);
    arch.name = 'scenery-natural-arch'; arch.castShadow = arch.receiveShadow = false;
    builder.geometries.add(geometry); builder.groups.far.add(arch);
  }
  // ---- canyon corridor: stratified rock walls on corner outsides -----------
  // Large fractured rock masses (instanced) read as layered cliff walls; a box stack
  // looked like crates, so the corridor is built from rock geometry + talus skirts.
  const wallChunks = [], wallChunkColors = [];
  const pushWallChunk = (s, lateral, lift, scale) => {
    const point = t.sample(s, lateral);
    if (builder.nearestDistance(point.x, point.z) < 46) return;
    const height = (16 + R() * 22) * scale;
    wallChunks.push({
      x: point.x + (R() - .5) * 8, y: -18 + height * .34, z: point.z + (R() - .5) * 8,
      ry: R() * TAU, rx: R() * .16, rz: R() * .16,
      sx: (15 + R() * 16) * scale, sy: height, sz: (13 + R() * 14) * scale,
    });
    wallChunkColors.push(['#dcc49e', '#cbae86', '#e4cea6', '#bfa27c', '#d5b992'][(R() * 5) | 0]);
    builder.anchor(point.x, point.z, 'canyon-wall');
    void lift;
  };
  const corners = [];
  for (let s = 0; s < t.length; s += 5) {
    const curvature = Math.abs(t.curvature(s));
    if (curvature < .013) continue;
    if (curvature >= Math.abs(t.curvature(s - 6)) && curvature >= Math.abs(t.curvature(s + 6))) corners.push({s, curvature});
  }
  const wallCorners = [];
  for (const corner of corners.sort((a, b) => b.curvature - a.curvature)) {
    if (wallCorners.some(other => Math.abs(shortDistance(corner.s, other.s, t.length)) < 95)) continue;
    wallCorners.push(corner);
    if (wallCorners.length >= 7) break;
  }
  for (const corner of wallCorners) {
    const side = t.curvature(corner.s) > 0 ? -1 : 1;
    for (let ds = -54; ds <= 54; ds += 12) {
      pushWallChunk(mod(corner.s + ds, t.length), side * (80 + R() * 34 + Math.sin(ds * .1) * 8), 0, 1.15);
      // Lower shoulder mass on the inside of the corner keeps the corridor asymmetric.
      if (Math.abs(ds) > 18 && R() < .5) pushWallChunk(mod(corner.s + ds, t.length), -side * (96 + R() * 40), 0, .7);
    }
  }
  const canyonStraight = t.boostStraight;
  if (canyonStraight) for (let ds = -12; ds <= canyonStraight.length + 12; ds += 20) {
    for (const side of [-1, 1]) pushWallChunk(mod(canyonStraight.s + ds, t.length), side * (84 + R() * 26), 0, .95);
  }
  // Distant canyon rim both sides around the whole lap so the horizon stays enclosed.
  for (let s = 0; s < t.length; s += 26) for (const side of [-1, 1]) {
    if (R() < .35) continue;
    pushWallChunk(s, side * (128 + R() * 70), 0, .8);
  }
  if (wallChunks.length) {
    builder.instanced('far', scaleUv(rockGeometry(THREE, 71, 1), 2.4, 1.5), mats.rock, wallChunks, {
      name: 'scenery-canyon-walls', colors: wallChunkColors, castShadow: false,
    });
  }
  builder.features.canyonWalls = wallChunks.length;
  // Talus skirt under the wall bases.
  const talus = [], talusColors = [];
  for (const corner of wallCorners) {
    const side = t.curvature(corner.s) > 0 ? -1 : 1;
    for (let i = 0; i < 10; i++) {
      const s = mod(corner.s + (R() - .5) * 110, t.length), lateral = side * (56 + R() * 22);
      const point = t.sample(s, lateral);
      if (builder.nearestDistance(point.x, point.z) < 26) continue;
      talus.push({x: point.x, y: -17.4, z: point.z, ry: R() * TAU, rx: R() * .3, rz: R() * .3, sx: 4 + R() * 8, sy: 2.2 + R() * 5, sz: 4 + R() * 7});
      talusColors.push(['#c2a67e', '#b0906a', '#d2b78d'][(R() * 3) | 0]);
      builder.anchor(point.x, point.z, 'talus');
    }
  }
  if (canyonStraight) for (let ds = 0; ds <= canyonStraight.length; ds += 22) {
    for (const side of [-1, 1]) {
      const lateral = side * (62 + R() * 14), s = mod(canyonStraight.s + ds, t.length), point = t.sample(s, lateral);
      if (builder.nearestDistance(point.x, point.z) < 24) continue;
      talus.push({x: point.x, y: -17.4, z: point.z, ry: R() * TAU, sx: 4 + R() * 6, sy: 2 + R() * 3.5, sz: 4 + R() * 6});
      talusColors.push(['#c2a67e', '#b0906a'][(R() * 2) | 0]);
      builder.anchor(point.x, point.z, 'talus');
    }
  }
  if (talus.length) builder.instanced('far', rockGeometry(THREE, 61, 1), mats.rockDark, talus, {name: 'scenery-canyon-talus', colors: talusColors, castShadow: false});
  builder.features.canyonTalus = talus.length;
  // Dust haze: large, very transparent cards far behind the playable corridor.
  const dustGeometry = new THREE.PlaneGeometry(520, 130);
  builder.instanced('far', dustGeometry, mats.dust, builder.sites(4, {lateralMin: RAIL + 160, lateralMax: RAIL + 380, jitter: 1, kind: 'dust', globalClearance: 180}).map((site, index) => ({
    x: site.p.x, y: site.base + 38 + index * 8, z: site.p.z, ry: builder.faceYaw(site.p, site.side),
  })), {name: 'scenery-dust-haze', castShadow: false});
  builder.animated.dust.push({material: mats.dust, base: .14, amount: .035, phase: 0});
  if (builder.detail) {
    builder.instanced('detail', rockGeometry(THREE, 23, 0), mats.rock, builder.sites(44, {lateralMin: RAIL + 2, lateralMax: RAIL + 9, jitter: 1, kind: 'slab', globalClearance: 15}).map(site => ({
      x: site.p.x, y: site.base + .18, z: site.p.z, ry: R() * TAU, rx: R() * .4, rz: R() * .4,
      sx: .5 + R() * 1.4, sy: .2 + R() * .5, sz: .5 + R() * 1.3,
    })), {name: 'scenery-rockfall', castShadow: false});
    builder.instanced('detail', builder.templates.plane, mats.grassCard, builder.sites(190, {lateralMin: RAIL + 1.8, lateralMax: RAIL + 14, jitter: 1, kind: 'dry-grass', globalClearance: 15}).map(site => ({
      x: site.p.x, y: site.base + .35, z: site.p.z, ry: R() * TAU, rx: -.1 + R() * .2,
      sx: .7 + R() * .9, sy: .5 + R() * .7,
    })), {name: 'scenery-dry-grass', colors: Array.from({length: 190}, () => ['#cbb87e', '#bda76c', '#d7cb96'][(R() * 3) | 0]), castShadow: false});
  }
}

// ---------------------------------------------------------------------------
// Neon: windowed towers, rooftop equipment, billboards, skyline, street furniture.
// ---------------------------------------------------------------------------
function buildNeon(builder) {
  const t = builder.track, THREE = builder.THREE, mats = builder.mats, R = builder.random;
  const density = builder.density;
  // Each facade style uses its own physical tile size so window rows stay ~1.1 m.
  const windowStyles = [
    {material: mats.windows, tileWidth: 22, tileHeight: 33},
    {material: mats.windowsB, tileWidth: 19, tileHeight: 29},
    {material: mats.windowsC, tileWidth: 20, tileHeight: 31},
  ];
  const buildingSites = [
    ...builder.sites(Math.round(28 * density), {lateralMin: RAIL + 14, lateralMax: RAIL + 120, jitter: .95, kind: 'building', globalClearance: 42}),
    ...builder.sites(3, {lateralMin: RAIL + 20, lateralMax: RAIL + 40, jitter: .2, kind: 'hero-building', globalClearance: 42, offset: 34, span: 120}),
  ];
  const roofs = [], rooftop = [], antennas = [], beacons = [], neonEdges = [], plinths = [], shopfronts = [];
  const facades = [];
  for (const [index, site] of buildingSites.entries()) {
    const height = 20 + R() * 72, width = 11 + R() * 21, depth = 9 + R() * 17;
    const base = builder.groundY(site.s, site.lateral), face = builder.faceYaw(site.p, site.side), yaw = site.p.yaw;
    const x = site.p.x, z = site.p.z, style = windowStyles[index % windowStyles.length], material = style.material;
    const uvOffset = [R(), R() * .4];
    for (const [offset, rot, panelWidth] of [[0, face, width], [Math.PI, face + Math.PI, width], [Math.PI / 2, face + Math.PI / 2, depth], [-Math.PI / 2, face - Math.PI / 2, depth]]) {
      const halfExtent = Math.abs(offset) === Math.PI / 2 ? width / 2 : depth / 2;
      builder.add('mid', material, builder.templates.plane, {
        x: x + Math.sin(rot) * halfExtent, y: base + height / 2, z: z + Math.cos(rot) * halfExtent, ry: rot,
        sx: panelWidth, sy: height, uvScale: [panelWidth / style.tileWidth, height / style.tileHeight], uvOffset,
      });
    }
    plinths.push({x, y: base + 1.4, z, ry: yaw - Math.PI / 2, sx: width + 1.2, sy: 2.8, sz: depth + 1.2});
    shopfronts.push({x: x + Math.sin(face) * (depth / 2 + .35), y: base + 1.7, z: z + Math.cos(face) * (depth / 2 + .35), ry: face, sx: width * .78, sy: .55, sz: .12});
    // Roof slab, rooftop equipment, antenna and red aircraft beacon.
    roofs.push({x, y: base + height + .15, z, ry: yaw - Math.PI / 2, sx: width + .7, sy: .35, sz: depth + .7});
    const units = 2 + ((R() * 3) | 0);
    for (let unit = 0; unit < units; unit++) rooftop.push({
      x: x + (R() - .5) * width * .66, y: base + height + .8 + R() * 2.4, z: z + (R() - .5) * depth * .66,
      ry: R() * TAU, sx: 1.4 + R() * 3.6, sy: 1 + R() * 2.6, sz: 1.2 + R() * 2.8,
    });
    if (R() < .7) {
      const antennaHeight = 5 + R() * 11;
      antennas.push({x, y: base + height + antennaHeight / 2, z, sx: .1, sy: antennaHeight, sz: .1});
      beacons.push({x, y: base + height + antennaHeight + .25, z, s: .55});
    }
    if (R() < .75) {
      const edgeHeight = height * .92;
      for (const sideOffset of [-.5, .5]) {
        const edge = {
          x: x + Math.sin(face) * depth / 2 + Math.cos(face) * width * sideOffset,
          y: base + edgeHeight / 2,
          z: z + Math.cos(face) * depth / 2 - Math.sin(face) * width * sideOffset,
          ry: face, sx: .16, sy: edgeHeight, sz: .16,
        };
        neonEdges.push(edge);
      }
    }
    if (index % 3 === 0) facades.push({x, z, base, face, width, depth, height});
  }
  builder.instanced('mid', builder.templates.box, mats.metalDark, roofs, {name: 'scenery-roofs'});
  builder.instanced('mid', builder.templates.box, mats.metalDark, rooftop, {name: 'scenery-rooftop-units'});
  builder.instanced('mid', builder.templates.box, mats.metalDark, plinths, {name: 'scenery-building-plinths'});
  builder.instanced('mid', builder.templates.cylinder6, mats.metal, antennas, {name: 'scenery-antennas'});
  builder.instanced('mid', builder.templates.sphere, mats.glowInstanced, beacons, {name: 'scenery-antenna-beacons', colors: beacons.map(() => '#ff3b30'), castShadow: false});
  builder.instanced('mid', builder.templates.box, mats.glowInstanced, shopfronts, {name: 'scenery-shopfronts', colors: shopfronts.map((_, index) => ['#ffd9a0', '#ff7ad8', '#64e8ff', '#ffe07a'][index % 4]), castShadow: false});
  for (const [index, edge] of neonEdges.entries()) builder.add('mid', mats.glow, builder.templates.box, edge, index % 2 ? '#35e0ff' : '#ff4fd8');
  // Far skyline towers behind the playable row.
  // Distant towers use a much finer window texture (UV-scaled box faces) so they read
  // as city fabric instead of a handful of giant coloured blocks.
  for (let index = 0; index < Math.round(12 * density); index++) {
    const s = R() * t.length, side = index % 2 ? -1 : 1, lateral = side * (RAIL + 150 + R() * 190);
    const p = t.sample(s, lateral), height = 55 + R() * 95, width = 18 + R() * 26, depth = width * (.8 + R() * .5);
    if (builder.nearestDistance(p.x, p.z) < 70) continue;
    builder.add('far', mats.windowsFar, builder.templates.box, {
      x: p.x, y: -18 + height / 2, z: p.z, ry: p.yaw - Math.PI / 2,
      sx: width, sy: height, sz: depth, uvScale: [width / 30, height / 40],
    });
  }
  builder.features.farWindowGrid = true;
  // Neon billboards on steel frames, angled toward the road.
  const neonAtlas = builder.lib.atlas('neon', NEON_ADS);
  const billboardSites = [
    ...builder.sites(8, {lateralMin: RAIL + 8, lateralMax: RAIL + 24, jitter: .95, tall: true, kind: 'billboard', globalClearance: 22}),
    ...builder.sites(3, {lateralMin: RAIL + 8, lateralMax: RAIL + 16, jitter: .2, tall: true, kind: 'hero-billboard', globalClearance: 22, offset: 30, span: 130}),
  ];
  const halos = [], haloColors = [];
  billboardSites.forEach((site, index) => {
    const face = builder.faceYaw(site.p, site.side), base = builder.groundY(site.s, site.lateral);
    const height = 7 + R() * 7, width = 9 + R() * 5, centerY = base + height + 3, spec = NEON_ADS[index % NEON_ADS.length];
    builder.addPanel('mid', mats.billboardGlow, neonAtlas, index % NEON_ADS.length, site.p.x, centerY, site.p.z, {width, height: width / 2, ry: face});
    for (const offset of [-width * .34, width * .34]) {
      builder.add('mid', mats.metalDark, builder.templates.cylinder6, {
        x: site.p.x + Math.cos(face) * offset, y: base + centerY / 2, z: site.p.z - Math.sin(face) * offset, sx: .2, sy: centerY, sz: .2,
      });
    }
    builder.add('mid', mats.metalDark, builder.templates.box, {x: site.p.x, y: centerY + (width / 2) / 2 + .1, z: site.p.z, ry: face, sx: width + .5, sy: .26, sz: .26});
    builder.add('mid', mats.glow, builder.templates.box, {x: site.p.x, y: base + .3, z: site.p.z, ry: face, sx: width * .8, sy: .25, sz: .2}, index % 2 ? '#ff4fd8' : '#35e0ff');
    halos.push({x: site.p.x - Math.sin(face) * .3, y: centerY, z: site.p.z - Math.cos(face) * .3, ry: face, sx: width * 1.3, sy: width * .8});
    haloColors.push(spec.neon ? spec.accent : '#35e0ff');
  });
  // Vertical neon totems just behind the rail.
  const totemSites = [
    ...builder.sites(9, {lateralMin: RAIL + 2.6, lateralMax: RAIL + 5.2, jitter: .9, kind: 'totem', globalClearance: 16}),
    ...builder.sites(3, {lateralMin: RAIL + 3, lateralMax: RAIL + 5, jitter: .2, kind: 'hero-totem', globalClearance: 16, offset: 26, span: 120}),
  ];
  totemSites.forEach((site, index) => {
    const face = builder.faceYaw(site.p, site.side), spec = NEON_ADS[index % NEON_ADS.length];
    builder.add('near', mats.metalDark, builder.templates.box, {x: site.p.x, y: site.base + 2.4, z: site.p.z, sx: .3, sy: 4.8, sz: .3});
    builder.addPanel('near', mats.signGlow, neonAtlas, index % NEON_ADS.length, site.p.x, site.base + 3.8, site.p.z, {width: 2.6, height: 1.4, ry: face});
    builder.add('near', mats.glow, builder.templates.box, {x: site.p.x, y: site.base + .18, z: site.p.z, sx: .9, sy: .22, sz: .9}, index % 2 ? '#35e0ff' : '#ff4fd8');
    halos.push({x: site.p.x, y: site.base + 3.8, z: site.p.z, ry: face, sx: 3.4, sy: 2});
    haloColors.push(spec.accent);
  });
  builder.instanced('mid', builder.templates.plane, mats.haloInstanced, halos, {name: 'scenery-glow-halos', colors: haloColors, castShadow: false});
  // Street furniture: lamp masts with glowing heads + low light bases behind the rail.
  const lampMasts = [], lampHeads = [], lightBases = [];
  for (let s = 10; s < t.length; s += 26) for (const side of [-1, 1]) {
    const p = t.sample(s, side * (RAIL + 1.4)), base = builder.groundY(s, side * (RAIL + 1.4)), face = builder.faceYaw(p, side);
    if (builder.nearestDistance(p.x, p.z) < 15.5) continue;
    lampMasts.push({x: p.x, y: base + 3.6, z: p.z, sx: .1, sy: 7.2, sz: .1});
    lampHeads.push({x: p.x - Math.cos(face) * .8, y: base + 7, z: p.z + Math.sin(face) * .8, ry: face, sx: 1.9, sy: .12, sz: .5});
    builder.anchor(p.x, p.z, 'lamp');
  }
  builder.instanced('mid', builder.templates.cylinder6, mats.metal, lampMasts, {name: 'scenery-lamp-masts'});
  builder.instanced('mid', builder.templates.box, mats.glowInstanced, lampHeads, {name: 'scenery-lamp-heads', colors: lampHeads.map((_, index) => index % 5 === 0 ? '#ffd9a0' : '#bfe4ff'), castShadow: false});
  for (let s = 12; s < t.length; s += 11) for (const side of [-1, 1]) {
    const p = t.sample(s, side * (RAIL + 1.1));
    lightBases.push({x: p.x, y: builder.groundY(s, side * (RAIL + 1.1)) + .22, z: p.z, ry: p.yaw, sx: .7, sy: .44, sz: .42});
  }
  builder.instanced('near', builder.templates.box, mats.glowInstanced, lightBases, {name: 'scenery-light-bases', colors: lightBases.map((_, index) => index % 2 ? '#35e0ff' : '#ff4fd8'), castShadow: false});
  if (builder.detail) {
    // Holo ad panels on the lower facades + street-level neon debris along the rail.
    const holo = [];
    for (const facade of facades) {
      for (let panel = 0; panel < 2; panel++) {
        const height = 5 + R() * 9, offset = (panel ? 1 : -1) * facade.width * .28;
        holo.push({
          x: facade.x + Math.sin(facade.face) * (facade.depth / 2 + .4) + Math.cos(facade.face) * offset,
          y: facade.base + height, z: facade.z + Math.cos(facade.face) * (facade.depth / 2 + .4) - Math.sin(facade.face) * offset,
          ry: facade.face, sx: 1.8 + R() * 1.6, sy: .55 + R() * .5, sz: .1,
        });
      }
    }
    builder.instanced('detail', builder.templates.box, mats.glowInstanced, holo, {name: 'scenery-holo-panels', colors: holo.map((_, index) => ['#35e0ff', '#ffffff', '#ff4fd8', '#ffd23f'][index % 4]), castShadow: false});
    const debris = builder.sites(46, {lateralMin: RAIL + 1.6, lateralMax: RAIL + 4, jitter: 1, kind: 'neon-debris', globalClearance: 15}).map(site => ({
      x: site.p.x, y: site.base + .3 + R() * .8, z: site.p.z, ry: site.p.yaw, sx: .35 + R() * .5, sy: .3 + R() * .9, sz: .35 + R() * .5,
    }));
    builder.instanced('detail', builder.templates.box, mats.glowInstanced, debris, {name: 'scenery-neon-debris', colors: debris.map((_, index) => index % 2 ? '#ffd9a0' : '#64e8ff'), castShadow: false});
  }
  builder.animated.pulse.push({material: mats.billboardGlow, base: 2.3, amount: .35, speed: 1.3, phase: 0});
  builder.animated.pulse.push({material: mats.signGlow, base: 1.65, amount: .2, speed: 1.1, phase: 1.7});
}

// ---------------------------------------------------------------------------
// Arcade: carnival tents, glowing gate pillars, floating rings, light strings.
// ---------------------------------------------------------------------------
function buildArcade(builder) {
  const t = builder.track, THREE = builder.THREE, mats = builder.mats, R = builder.random;
  const density = builder.density;
  // Festival tents with striped canvas + emissive valance rings.
  const tentSites = [
    ...builder.sites(Math.round(16 * density), {lateralMin: RAIL + 5, lateralMax: RAIL + 34, jitter: .95, kind: 'tent', globalClearance: 23}),
    ...builder.sites(3, {lateralMin: RAIL + 7, lateralMax: RAIL + 14, jitter: .2, kind: 'hero-tent', globalClearance: 23, offset: 30, span: 120}),
  ];
  const tentShapes = [], tentSkirts = [], tentPoles = [], tentColors = [], tentValances = [];
  for (const site of tentSites) {
    const radius = 4.4 + R() * 3.4, height = 5.6 + R() * 4;
    tentShapes.push({x: site.p.x, y: site.base, z: site.p.z, ry: R() * TAU, sx: radius, sy: height, sz: radius});
    tentSkirts.push({x: site.p.x, y: site.base + .6, z: site.p.z, sx: radius, sy: 1.2, sz: radius});
    tentPoles.push({x: site.p.x, y: site.base + height + 1, z: site.p.z, sx: .07, sy: 2, sz: .07});
    tentValances.push({x: site.p.x, y: site.base + 1.25, z: site.p.z, sx: radius + .06, sy: .16, sz: radius + .06});
    tentColors.push(['#ffffff', '#ffe9f0', '#f2ddff', '#fff4d6'][(R() * 4) | 0]);
  }
  builder.instanced('mid', tentGeometry(THREE), mats.tent, tentShapes, {name: 'scenery-tents', colors: tentColors});
  builder.instanced('mid', new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), mats.tent, tentSkirts, {name: 'scenery-tent-skirts', colors: tentColors, castShadow: false});
  // Support poles and guy lines make the tents read as erected structures.
  for (const [index, site] of tentSites.entries()) {
    const shape = tentShapes[index], radius = shape.sx, height = shape.sy, base = site.base;
    for (let pole = 0; pole < 4; pole++) {
      const angle = pole / 4 * TAU + .4;
      builder.line('mid', mats.metal, {x: site.p.x, y: base + .2, z: site.p.z}, {x: site.p.x + Math.cos(angle) * radius * .88, y: base + 2.3, z: site.p.z + Math.sin(angle) * radius * .88}, .1);
      builder.line('mid', mats.metal, {x: site.p.x, y: base + height, z: site.p.z}, {x: site.p.x + Math.cos(angle) * radius * 1.7, y: base + .05, z: site.p.z + Math.sin(angle) * radius * 1.7}, .035);
    }
    builder.add('mid', mats.metal, builder.templates.cylinder6, {x: site.p.x, y: base + height + .5, z: site.p.z, sx: .12, sy: 1, sz: .12});
    builder.add('mid', mats.glow, builder.templates.sphere, {x: site.p.x, y: base + height + 1.1, z: site.p.z, s: .18}, '#ffe9a8');
  }
  builder.features.tentRigs = tentSites.length;
  builder.instanced('mid', builder.templates.cylinder6, mats.metal, tentPoles, {name: 'scenery-tent-poles'});
  builder.instanced('mid', new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), mats.glowInstanced, tentValances, {
    name: 'scenery-tent-valances', colors: tentValances.map((_, index) => index % 2 ? '#ff7ad8' : '#ffd9a0'), castShadow: false,
  });
  // Prize booths with striped canopies near the tents.
  const boothSites = builder.sites(7, {lateralMin: RAIL + 12, lateralMax: RAIL + 30, jitter: .95, kind: 'booth', globalClearance: 19});
  for (const [index, site] of boothSites.entries()) {
    const base = builder.groundY(site.s, site.lateral), yaw = site.p.yaw, face = builder.faceYaw(site.p, site.side);
    const alongYaw = yaw - Math.PI / 2;
    builder.add('mid', mats.concreteDark, builder.templates.box, {x: site.p.x, y: base + 1.2, z: site.p.z, ry: alongYaw, sx: 4.2, sy: 2.4, sz: 3.4});
    builder.add('mid', mats.tent, builder.templates.box, {x: site.p.x, y: base + 2.55, z: site.p.z, ry: alongYaw, sx: 4.6, sy: .3, sz: 3.8});
    builder.add('mid', mats.glow, builder.templates.box, {
      x: site.p.x + Math.sin(face) * 1.95, y: base + 2.1, z: site.p.z + Math.cos(face) * 1.95,
      ry: face, sx: 3, sy: .8, sz: .12,
    }, ['#ff7ad8', '#64e8ff', '#ffd9a0'][index % 3]);
  }
  // Authored entrance pylons: tapered shaft, lit window bands, corner trim,
  // neon sign crown and a beacon ring instead of a grey slab + flat colour block.
  const entranceAtlas = builder.lib.atlas('neon', NEON_ADS);
  for (const [s, side] of [[8, -1], [8, 1], [t.length - 10, -1], [t.length - 10, 1]]) {
    const lateral = side * (RAIL + 6.6), p = t.sample(s, lateral), base = builder.groundY(s, lateral);
    if (builder.nearestDistance(p.x, p.z) < 17) continue;
    const face = builder.faceYaw(p, side), alongYaw = p.yaw - Math.PI / 2;
    const accent = side > 0 ? '#ff4fd8' : '#35e0ff';
    let stageY = 0;
    for (const [width, height] of [[2.5, 4.4], [2, 3.2], [1.5, 2.8]]) {
      builder.add('near', mats.concreteDark, builder.templates.box, {x: p.x, y: base + stageY + height / 2, z: p.z, ry: alongYaw, sx: width, sy: height, sz: width});
      builder.add('near', mats.glow, builder.templates.box, {x: p.x + Math.sin(face) * (width / 2 + .02), y: base + stageY + height * .58, z: p.z + Math.cos(face) * (width / 2 + .02), ry: face, sx: width * .72, sy: height * .14, sz: .08}, accent);
      for (const cx of [-.5, .5]) for (const cz of [-.5, .5]) {
        builder.add('near', mats.metal, builder.templates.box, {
          x: p.x + Math.cos(face) * width * cx + Math.sin(face) * width * cz,
          y: base + stageY + height / 2,
          z: p.z - Math.sin(face) * width * cx + Math.cos(face) * width * cz,
          ry: face, sx: .1, sy: height, sz: .1,
        });
      }
      stageY += height;
    }
    builder.addPanel('near', mats.signGlow, entranceAtlas, 0, p.x + Math.sin(face) * .85, base + stageY + 1.2, p.z + Math.cos(face) * .85, {width: 3.2, height: 1.7, ry: face});
    builder.add('near', mats.metal, builder.templates.box, {x: p.x, y: base + stageY + 2.3, z: p.z, ry: p.yaw, sx: .9, sy: .5, sz: .9});
    builder.add('near', mats.glow, builder.templates.sphere, {x: p.x, y: base + stageY + 2.8, z: p.z, s: .26}, '#ffe9a8');
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * TAU;
      builder.add('near', mats.glow, builder.templates.box, {x: p.x + Math.cos(angle) * .6, y: base + stageY + 2.5, z: p.z + Math.sin(angle) * .6, ry: angle, sx: .15, sy: .15, sz: .15}, i % 2 ? '#ff4fd8' : '#35e0ff');
    }
    builder.anchor(p.x, p.z, 'gate');
  }
  builder.features.arcadeGateTowers = 4;
  // Floating neon rings beside the road, animated in update.
  const ringItems = [
    ...builder.sites(11, {lateralMin: RAIL + 2.6, lateralMax: RAIL + 13, jitter: .95, kind: 'ring', globalClearance: 16}),
    ...builder.sites(3, {lateralMin: RAIL + 3, lateralMax: RAIL + 8, jitter: .2, kind: 'hero-ring', globalClearance: 16, offset: 24, span: 110}),
  ].map(site => ({
    x: site.p.x, y: site.base + 3.2 + R() * 3.6, z: site.p.z,
    scale: 2 + R() * 2.4, spin: .3 + R() * .7, speed: .6 + R() * .8, phase: R() * TAU,
  }));
  if (ringItems.length) {
    const ringGeometry = new THREE.TorusGeometry(1, .05, 8, 34);
    builder.geometries.add(ringGeometry);
    const ringMaterial = builder.material('ring-glow', () => new THREE.MeshBasicMaterial({color: '#ff58d0', toneMapped: false}));
    const haloMaterial = builder.material('ring-halo', () => new THREE.MeshBasicMaterial({color: '#ff58d0', transparent: true, opacity: .16, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide}));
    const haloGeometry = new THREE.TorusGeometry(1, .1, 8, 34);
    const ringEuler = new THREE.Euler(0, 0, 0, 'YXZ'), ringMatrix = new THREE.Matrix4(), ringQuat = new THREE.Quaternion(), ringPos = new THREE.Vector3(), ringScale = new THREE.Vector3();
    const ringMesh = new THREE.InstancedMesh(ringGeometry, ringMaterial, ringItems.length);
    const haloMesh = new THREE.InstancedMesh(haloGeometry, haloMaterial, ringItems.length);
    ringItems.forEach((item, index) => {
      ringEuler.set(.2, item.phase, 0, 'YXZ'); ringQuat.setFromEuler(ringEuler);
      ringMatrix.compose(ringPos.set(item.x, item.y, item.z), ringQuat, ringScale.setScalar(item.scale));
      ringMesh.setMatrixAt(index, ringMatrix); haloMesh.setMatrixAt(index, ringMatrix);
    });
    ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ringMesh.name = 'scenery-neon-rings'; haloMesh.name = 'scenery-neon-ring-halos';
    ringMesh.castShadow = haloMesh.castShadow = false;
    builder.groups.mid.add(ringMesh, haloMesh);
    builder.instancedMeshes.push(ringMesh, haloMesh);
    builder.geometries.add(haloGeometry);
    builder.animated.rings = {mesh: ringMesh, halo: haloMesh, items: ringItems};
  }
  // Fence line + hanging carnival light strings with bulbs and pennants.
  const poles = [], bulbs = [], bulbsColors = [], pennants = [], pennantColors = [];
  for (const side of [-1, 1]) {
    let previous = null;
    for (let s = 4; s < t.length; s += 11) {
      const lateral = side * (RAIL + 2), p = t.sample(s, lateral), base = builder.groundY(s, lateral);
      poles.push({x: p.x, y: base + 1.5, z: p.z, ry: p.yaw, sx: .09, sy: 3, sz: .09});
      bulbs.push({x: p.x, y: base + 3.05, z: p.z, s: .16});
      bulbsColors.push(['#ffd9a0', '#ff7ad8', '#64e8ff'][Math.round(s) % 3]);
      if (previous) {
        for (let step = 1; step <= 5; step++) {
          const mix = step / 6;
          bulbs.push({
            x: previous.x + (p.x - previous.x) * mix,
            y: previous.y + (p.y - previous.y) * mix - Math.sin(mix * Math.PI) * .5,
            z: previous.z + (p.z - previous.z) * mix, s: .14,
          });
          bulbsColors.push(['#ffd9a0', '#ff7ad8', '#64e8ff', '#ffe07a'][(step + side) % 4]);
        }
        for (let step = 1; step < 4; step++) {
          const mix = step / 4;
          pennants.push({
            x: previous.x + (p.x - previous.x) * mix, y: previous.y + (p.y - previous.y) * mix - Math.sin(mix * Math.PI) * .3,
            z: previous.z + (p.z - previous.z) * mix,
            ry: Math.atan2(p.x - previous.x, p.z - previous.z) + Math.PI / 2, rx: .15,
            sx: .55, sy: .46,
          });
          pennantColors.push(['#ff4fd8', '#35e0ff', '#ffd23f', '#b06bff'][(step + s) % 4]);
        }
      }
      previous = {x: p.x, y: base + 3.05, z: p.z};
    }
  }
  // Suspended light rigs over the fairground: masts, catenary wires and bulbs.
  for (const [index, s] of [96, 176, 256, 336].entries()) {
    for (const side of [-1, 1]) {
      const lateralA = side * (RAIL + 8), lateralB = side * (RAIL + 20);
      const a = t.sample(s, lateralA), b = t.sample(s + 16, lateralB);
      const baseA = builder.groundY(s, lateralA), baseB = builder.groundY(s + 16, lateralB);
      const topA = {x: a.x, y: baseA + 9.4, z: a.z}, topB = {x: b.x, y: baseB + 9, z: b.z};
      if (builder.nearestDistance(a.x, a.z) < 15 || builder.nearestDistance(b.x, b.z) < 15) continue;
      builder.add('near', mats.metal, builder.templates.cylinder6, {x: a.x, y: baseA + 4.7, z: a.z, sx: .13, sy: 9.4, sz: .13});
      builder.add('near', mats.metal, builder.templates.cylinder6, {x: b.x, y: baseB + 4.5, z: b.z, sx: .13, sy: 9, sz: .13});
      builder.add('near', mats.glow, builder.templates.sphere, {x: a.x, y: baseA + 9.5, z: a.z, s: .2}, '#ffd9a0');
      builder.add('near', mats.glow, builder.templates.sphere, {x: b.x, y: baseB + 9.1, z: b.z, s: .2}, '#ffd9a0');
      // Four straight wire segments approximate the catenary; bulbs hang from them.
      const wireSteps = 4;
      for (let step = 0; step < wireSteps; step++) {
        const t0 = step / wireSteps, t1 = (step + 1) / wireSteps;
        const pointAt = mix => ({
          x: topA.x + (topB.x - topA.x) * mix,
          y: topA.y + (topB.y - topA.y) * mix - Math.sin(mix * Math.PI) * .7,
          z: topA.z + (topB.z - topA.z) * mix,
        });
        builder.line('near', mats.metalDark, pointAt(t0), pointAt(t1), .022);
        const bulb = pointAt((t0 + t1) / 2);
        bulbs.push({x: bulb.x, y: bulb.y - .14, z: bulb.z, s: .15});
        bulbsColors.push(['#ffd9a0', '#ff7ad8', '#64e8ff'][(index + step) % 3]);
      }
      builder.boostShowcase += 0;
    }
  }
  builder.features.lightRigs = 8;
  builder.instanced('near', builder.templates.cylinder6, mats.metal, poles, {name: 'scenery-fence-posts'});
  builder.instanced('near', new THREE.OctahedronGeometry(1, 0), mats.glowInstanced, bulbs, {name: 'scenery-fence-bulbs', colors: bulbsColors, castShadow: false});
  const pennantMaterial = builder.material('pennant', () => new THREE.MeshStandardMaterial({side: THREE.DoubleSide, roughness: .85, metalness: .05, color: '#ffffff'}));
  builder.instanced('near', triangleGeometry(THREE), pennantMaterial, pennants, {name: 'scenery-pennants', colors: pennantColors, castShadow: false});
  // Big arcade LED boards on frames around the fairground.
  const signSites = [
    ...builder.sites(8, {lateralMin: RAIL + 7, lateralMax: RAIL + 22, jitter: .95, tall: true, kind: 'arcade-sign', globalClearance: 20}),
    ...builder.sites(2, {lateralMin: RAIL + 8, lateralMax: RAIL + 16, jitter: .2, tall: true, kind: 'hero-sign', globalClearance: 20, offset: 34, span: 120}),
  ];
  const halos = [], haloColors = [];
  signSites.forEach((site, index) => {
    const face = builder.faceYaw(site.p, site.side), base = builder.groundY(site.s, site.lateral), width = 9 + R() * 4, height = width / 2;
    const centerY = base + 6.5 + R() * 2.5, spec = NEON_ADS[index % NEON_ADS.length];
    builder.addPanel('mid', mats.signGlow, entranceAtlas, index % NEON_ADS.length, site.p.x, centerY, site.p.z, {width, height, ry: face});
    builder.add('mid', mats.metalDark, builder.templates.cylinder6, {x: site.p.x, y: base + 3.4, z: site.p.z, sx: .22, sy: 6.8, sz: .22});
    halos.push({x: site.p.x - Math.sin(face) * .3, y: centerY, z: site.p.z - Math.cos(face) * .3, ry: face, sx: width * 1.3, sy: height * 1.7});
    haloColors.push(spec.accent);
  });
  builder.instanced('mid', builder.templates.plane, mats.haloInstanced, halos, {name: 'scenery-glow-halos', colors: haloColors, castShadow: false});
  // Balloon / lamp clusters floating above the tents.
  const balloons = [];
  for (const site of tentSites) for (let i = 0; i < 4; i++) {
    balloons.push({x: site.p.x + (R() - .5) * 12, y: site.base + 8 + R() * 7, z: site.p.z + (R() - .5) * 12, s: .28 + R() * .26});
  }
  builder.instanced('mid', builder.templates.sphere, mats.glowInstanced, balloons, {name: 'scenery-balloons', colors: balloons.map((_, index) => ['#ff7ad8', '#ffd9a0', '#64e8ff', '#b68bff'][index % 4]), castShadow: false});
  if (builder.detail) {
    const sparkle = [];
    for (let s = 2; s < t.length; s += 8) for (const side of [-1, 1]) {
      const lateral = side * (RAIL + 2.4), p = t.sample(s, lateral);
      sparkle.push({x: p.x, y: builder.groundY(s, lateral) + .3 + R() * .5, z: p.z, s: .09 + R() * .12});
    }
    builder.instanced('detail', new THREE.OctahedronGeometry(1, 0), mats.glowInstanced, sparkle, {name: 'scenery-ground-sparkles', colors: sparkle.map((_, index) => index % 2 ? '#ffd9a0' : '#ff7ad8'), castShadow: false});
  }
  builder.animated.pulse.push({material: mats.signGlow, base: 1.65, amount: .3, speed: 1.6, phase: .4});
}

const THEMES = {coast: buildCoast, canyon: buildCanyon, neon: buildNeon, arcade: buildArcade};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------
export function buildSceneryKit(track, THREE, options = {}) {
  if (!track || typeof track.sample !== 'function') throw new Error('buildSceneryKit: track is required');
  if (!THREE || !THREE.Group) throw new Error('buildSceneryKit: THREE namespace is required');
  const builder = new SceneryBuilder(track, THREE, options);
  return builder.build();
}
export function sceneryTextureLibrary(THREE, options = {}) { return getSurfaceTextures(THREE, options); }
export const SCENERY_CLEARANCE = CLEARANCE;
