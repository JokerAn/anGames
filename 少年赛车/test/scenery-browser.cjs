// Premium scenery harness: builds the procedural world kit in a real WebGL scene
// (ground + road + lighting), captures each theme in a near and a wide view, and
// asserts render budgets, road clearance, console health and build→dispose→build
// stability. Run with:
//   PLAYWRIGHT_MODULE=/path/to/playwright node test/scenery-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.RACER_URL || 'http://127.0.0.1:3210';
const output = path.join(__dirname, 'artifacts', 'premium');
fs.mkdirSync(output, {recursive: true});
const THEMES = ['coast', 'canyon', 'neon', 'arcade'];
const HIGH_BUDGET = {draws: 90, triangles: 300000};
const LOW_BUDGET = {draws: 50, triangles: 120000};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const THEME_POSES = {
  coast: {s: 14, back: 12, height: 4.4, ahead: 88, lookHeight: 1.9, wideBack: 62, wideHeight: 30, wideAhead: 150, wideLook: 2, wideLookOffset: [-360, 10, -30]},
  canyon: {s: 46, back: 12, height: 4.6, ahead: 92, lookHeight: 2.2, wideBack: 66, wideHeight: 28, wideAhead: 190, wideLook: 1.2},
  neon: {s: 18, back: 12, height: 4.2, ahead: 92, lookHeight: 1.8, wideBack: 78, wideHeight: 44, wideAhead: 160, wideLook: 6},
  arcade: {s: 12, back: 11, height: 4.2, ahead: 86, lookHeight: 1.8, wideBack: 66, wideHeight: 30, wideAhead: 150, wideLook: 5},
};

// ---------------------------------------------------------------------------
// Browser-side harness, installed once per page.
// ---------------------------------------------------------------------------
async function installHarness(page) {
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const {getTrack, mod, clamp, ROAD_HALF} = await import('/src/tracks.js');
    const {buildSceneryKit, SCENERY_CLEARANCE} = await import('/src/track-scenery.js');
    const {getSurfaceTextures, refreshSurfaceTextures, disposeSurfaceTextures} = await import('/src/surface-textures.js');
    const {GUARDRAIL_OFFSET} = await import('/src/driving.js');
    const harness = window.__sceneryHarness = {
      THREE, getTrack, mod, clamp, ROAD_HALF, GUARDRAIL_OFFSET, SCENERY_CLEARANCE,
      buildSceneryKit, getSurfaceTextures, refreshSurfaceTextures, disposeSurfaceTextures,
    };
    const container = document.createElement('div');
    container.id = 'scenery-harness-overlay';
    container.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#05080a;';
    document.body.append(container);
    const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: true});
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight);
    container.append(renderer.domElement);
    harness.container = container;
    harness.renderer = renderer;
    harness.lib = getSurfaceTextures(THREE, {anisotropy: renderer.capabilities.getMaxAnisotropy()});
    harness.scene = null;
    harness.camera = null;
    harness.kit = null;
    harness.track = null;
    harness.theme = null;
    harness.owned = {geometries: [], materials: []};
    harness.snapshot = () => ({geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length || 0});
    harness.measureKit = () => {
      const kit = harness.kit;
      if (!kit) return null;
      harness.testGroup.visible = false;
      renderer.render(harness.scene, harness.camera);
      const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles, points = renderer.info.render.points;
      harness.testGroup.visible = true;
      renderer.render(harness.scene, harness.camera);
      return {calls, triangles, points};
    };
    harness.setPose = (pose, wide = false) => {
      const track = harness.track, camera = harness.camera;
      const s = pose.s + (wide ? 40 : 0);
      const back = wide ? pose.wideBack : pose.back, height = wide ? pose.wideHeight : pose.height;
      const ahead = wide ? pose.wideAhead : pose.ahead, lookHeight = wide ? pose.wideLook : pose.lookHeight;
      const start = track.sample(harness.mod(s - back, track.length));
      const look = track.sample(harness.mod(s + ahead, track.length));
      camera.position.set(start.x, start.y + height, start.z);
      const offset = wide ? pose.wideLookOffset : null;
      camera.lookAt(look.x + (offset ? offset[0] : 0), look.y + lookHeight + (offset ? offset[1] : 0), look.z + (offset ? offset[2] : 0));
      camera.updateMatrixWorld();
      renderer.render(harness.scene, camera);
    };
    harness.addOwned = (geometry, material) => {
      if (geometry) harness.owned.geometries.push(geometry);
      if (material) harness.owned.materials.push(material);
    };
    harness.buildSky = (palette) => {
      const scene = harness.scene;
      scene.background = new THREE.Color(palette.sky);
      scene.fog = new THREE.Fog(palette.fog, palette.fogNear, palette.fogFar);
      const geometry = new THREE.SphereGeometry(760, 32, 16), colors = [], position = geometry.attributes.position;
      const horizon = new THREE.Color(palette.horizon), zenith = new THREE.Color(palette.zenith);
      for (let i = 0; i < position.count; i++) {
        const f = harness.clamp(position.getY(i) / 760, 0, 1), color = horizon.clone().lerp(zenith, Math.pow(f, .55));
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const material = new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false});
      harness.addOwned(geometry, material);
      harness.testGroup.add(new THREE.Mesh(geometry, material));
      if (palette.sun) {
        const sunGeometry = new THREE.SphereGeometry(palette.sun.size, 16, 8);
        const sunMaterial = new THREE.MeshBasicMaterial({color: palette.sun.color, fog: false});
        const sun = new THREE.Mesh(sunGeometry, sunMaterial);
        sun.position.set(palette.sun.x, palette.sun.y, palette.sun.z);
        harness.addOwned(sunGeometry, sunMaterial);
        harness.testGroup.add(sun);
      }
      if (palette.moon) {
        const moonGeometry = new THREE.SphereGeometry(palette.moon.size, 20, 12);
        const moonMaterial = new THREE.MeshBasicMaterial({color: palette.moon.color || '#e6edf5', fog: false});
        const moon = new THREE.Mesh(moonGeometry, moonMaterial);
        moon.position.set(palette.moon.x, palette.moon.y, palette.moon.z);
        harness.addOwned(moonGeometry, moonMaterial);
        harness.testGroup.add(moon);
      }
      if (palette.stars) {
        const count = 620, positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2, elevation = .08 + Math.random() * 1.1, radius = 700;
          positions[i * 3] = Math.cos(angle) * Math.cos(elevation) * radius;
          positions[i * 3 + 1] = 80 + Math.sin(elevation) * radius;
          positions[i * 3 + 2] = Math.sin(angle) * Math.cos(elevation) * radius;
        }
        const starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const starMaterial = new THREE.PointsMaterial({color: '#cfe0ff', size: 1.8, sizeAttenuation: false, fog: false, transparent: true, opacity: .85});
        harness.addOwned(starGeometry, starMaterial);
        harness.testGroup.add(new THREE.Points(starGeometry, starMaterial));
      }
    };
    harness.buildEnvironment = (palette) => {
      const THREE = harness.THREE, renderer = harness.renderer;
      const envScene = new THREE.Scene();
      const geometry = new THREE.SphereGeometry(60, 20, 10), colors = [], position = geometry.attributes.position;
      const horizon = new THREE.Color(palette.horizon), zenith = new THREE.Color(palette.zenith), ground = new THREE.Color(palette.groundColor || '#5a5346');
      for (let i = 0; i < position.count; i++) {
        const f = position.getY(i) / 60;
        const color = f >= 0 ? horizon.clone().lerp(zenith, Math.pow(Math.min(1, f), .6)) : horizon.clone().lerp(ground, Math.min(1, -f * 3));
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const material = new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide});
      envScene.add(new THREE.Mesh(geometry, material));
      const sunGeometry = new THREE.SphereGeometry(palette.sun ? palette.sun.size * .5 : 4, 12, 8);
      const sunMaterial = new THREE.MeshBasicMaterial({color: palette.sun ? palette.sun.color : '#dfe8f2'});
      const sun = new THREE.Mesh(sunGeometry, sunMaterial);
      sun.position.set(-30, palette.sun ? 18 : 28, -40);
      envScene.add(sun);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const target = pmrem.fromScene(envScene, .02, .1, 200);
      pmrem.dispose();
      geometry.dispose(); material.dispose(); sunGeometry.dispose(); sunMaterial.dispose();
      harness.environmentTarget?.dispose();
      harness.environmentTarget = target;
      harness.scene.environment = target.texture;
      harness.scene.environmentIntensity = palette.environmentIntensity ?? .55;
    };
    harness.buildLighting = (palette) => {
      const scene = harness.scene;
      const hemisphere = new THREE.HemisphereLight(palette.hemisphere.sky, palette.hemisphere.ground, palette.hemisphere.intensity);
      scene.add(hemisphere);
      const key = new THREE.DirectionalLight(palette.key.color, palette.key.intensity);
      key.position.set(palette.key.x || -120, palette.key.y || 160, palette.key.z || -100);
      key.castShadow = !!palette.shadows;
      if (palette.shadows) {
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 1; key.shadow.camera.far = 420;
        Object.assign(key.shadow.camera, {left: -120, right: 120, top: 120, bottom: -120});
        key.shadow.bias = -0.0005; key.shadow.normalBias = .06;
      }
      const target = new THREE.Object3D();
      key.target = target;
      scene.add(key, target);
      key.target.position.set(0, 0, 0);
      const fill = new THREE.DirectionalLight(palette.fill.color, palette.fill.intensity);
      fill.position.set(160, 120, 180);
      scene.add(fill);
      harness.renderer.shadowMap.enabled = !!palette.shadows;
      harness.keyLight = key;
      harness.targetLight = target;
    };
    harness.buildGround = (palette) => {
      const scene = harness.scene, track = harness.track, THREE = harness.THREE;
      const size = 1250, segments = 110;
      const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes.position;
      const samples = [];
      for (let s = 0; s < track.length; s += 7) samples.push(track.sample(s));
      const bounds = track.bounds;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i) + bounds.centerX, z = positions.getZ(i) + bounds.centerZ;
        let nearest = Infinity, height = -18;
        for (const sample of samples) {
          const dx = x - sample.x, dz = z - sample.z, distance = dx * dx + dz * dz;
          if (distance < nearest) { nearest = distance; height = sample.y; }
        }
        const blend = harness.clamp((Math.sqrt(nearest) - 13) / 70, 0, 1), smooth = blend * blend * (3 - 2 * blend);
        positions.setY(i, (height - 1.5) * (1 - smooth) - 18 * smooth);
      }
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, positions.getX(i) / 12, positions.getZ(i) / 12);
      geometry.computeVertexNormals();
      positions.needsUpdate = true;
      const material = new THREE.MeshStandardMaterial({map: harness.lib.get(palette.groundTexture), color: palette.groundColor, roughness: 1, metalness: 0});
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(bounds.centerX, 0, bounds.centerZ);
      mesh.receiveShadow = true; mesh.name = 'harness-ground';
      harness.addOwned(geometry, material);
      harness.testGroup.add(mesh);
    };
    harness.ribbon = (left, right, y1, y2, material, options = {}) => {
      const track = harness.track, THREE = harness.THREE;
      const positions = [], uvs = [], indices = [];
      const count = Math.ceil(track.length / 2.5);
      const uScale = options.uScale || 1, vScale = options.vScale || .06;
      for (let i = 0; i <= count; i++) {
        const distance = i / count * track.length;
        for (const [lane, height] of [[left, y1], [right, y2]]) {
          const p = track.sample(distance, lane);
          positions.push(p.x, p.y + height, p.z);
          uvs.push((options.absoluteU ? lane : (i % 2)) * uScale, distance * vScale);
        }
        if (i < count) { const n = i * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      harness.addOwned(geometry, null);
      return mesh;
    };
    harness.buildRoad = (palette) => {
      const scene = harness.scene, THREE = harness.THREE, lib = harness.lib, half = harness.ROAD_HALF, rail = harness.GUARDRAIL_OFFSET;
      // Asphalt: one texture tile across the full road width, 16 m along the lap.
      const asphaltMaterial = new THREE.MeshStandardMaterial({
        map: lib.get('asphalt'), roughnessMap: lib.get('asphaltRoughness'), normalMap: lib.get('asphaltNormal'),
        normalScale: new THREE.Vector2(.55, .55), color: palette.asphaltColor || '#7a7f82', roughness: .96, metalness: .04,
      });
      const road = harness.ribbon(-half, half, .015, .015, asphaltMaterial);
      // Baked world UV across the road width and along the lap.
      const geometry = road.geometry, uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const lane = i % 2 === 0 ? -half : half;
        uv.setXY(i, (lane + half) / (2 * half), uv.getY(i) * 16);
      }
      uv.needsUpdate = true;
      harness.addOwned(null, asphaltMaterial);
      harness.testGroup.add(road);
      const shoulderMaterial = new THREE.MeshStandardMaterial({map: lib.get('shoulder'), color: palette.shoulderColor || '#9a9384', roughness: 1});
      harness.addOwned(null, shoulderMaterial);
      for (const side of [-1, 1]) {
        const shoulder = harness.ribbon(side * (half + .8), side * rail, -.15, -.15, shoulderMaterial);
        const uv2 = shoulder.geometry.attributes.uv;
        for (let i = 0; i < uv2.count; i++) uv2.setXY(i, uv2.getX(i) * 1.4, uv2.getY(i) * 3);
        uv2.needsUpdate = true;
        harness.testGroup.add(shoulder);
      }
      const curbMaterial = new THREE.MeshStandardMaterial({map: lib.get('curb'), roughness: .92, metalness: .02});
      harness.addOwned(null, curbMaterial);
      for (const side of [-1, 1]) {
        const curb = harness.ribbon(side * half, side * (half + .75), .04, .04, curbMaterial);
        const uv3 = curb.geometry.attributes.uv;
        for (let i = 0; i < uv3.count; i++) uv3.setXY(i, i % 2, curb.geometry.attributes.uv.getY(i) * 2.2);
        uv3.needsUpdate = true;
        harness.testGroup.add(curb);
      }
      const railMaterial = new THREE.MeshStandardMaterial({color: '#9aa4a6', roughness: .42, metalness: .72, side: THREE.DoubleSide});
      harness.addOwned(null, railMaterial);
      for (const side of [-1, 1]) for (const y of [.56, 1.02]) {
        const band = harness.ribbon(side * rail, side * rail, y, y + .22, railMaterial);
        harness.testGroup.add(band);
      }
      const dashMaterial = new THREE.MeshBasicMaterial({color: '#cfcdbf'});
      const dashGeometry = new THREE.BoxGeometry(.1, .016, 4);
      const dashCount = Math.floor(harness.track.length / 14);
      const dashes = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashCount);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < dashCount; i++) {
        const p = harness.track.sample(i * 14);
        dummy.position.set(p.x, p.y + .035, p.z); dummy.rotation.set(0, p.yaw, 0); dummy.updateMatrix();
        dashes.setMatrixAt(i, dummy.matrix);
      }
      dashes.instanceMatrix.needsUpdate = true;
      harness.addOwned(dashGeometry, dashMaterial);
      harness.testGroup.add(dashes);
    };
    harness.buildStartGate = () => {
      const THREE = harness.THREE, track = harness.track, group = harness.testGroup;
      const start = track.sample(0), yaw = start.yaw;
      const banner = new THREE.MeshStandardMaterial({
        map: harness.lib.sign({text: 'JRC', sub: 'start / finish', accent: '#d9542f', motif: 'chevrons', code: 'LAP 01'}),
        roughness: .6, metalness: .05, side: THREE.DoubleSide,
      });
      const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(22, 2.6), banner);
      bannerMesh.position.set(start.x, start.y + 6.4, start.z);
      bannerMesh.rotation.y = yaw + Math.PI;
      harness.addOwned(bannerMesh.geometry, banner);
      group.add(bannerMesh);
      const postMaterial = new THREE.MeshStandardMaterial({color: '#6d7578', roughness: .45, metalness: .7});
      const beamMaterial = new THREE.MeshStandardMaterial({color: '#2b3134', roughness: .6, metalness: .5});
      harness.addOwned(null, postMaterial); harness.addOwned(null, beamMaterial);
      for (const side of [-1, 1]) {
        const p = track.sample(0, side * 11);
        const postGeometry = new THREE.CylinderGeometry(.24, .3, 7.6, 8);
        const post = new THREE.Mesh(postGeometry, postMaterial);
        post.position.set(p.x, p.y + 3.8, p.z); post.castShadow = true;
        harness.addOwned(postGeometry, null); group.add(post);
      }
      const beamGeometry = new THREE.BoxGeometry(23, .7, .5);
      const beam = new THREE.Mesh(beamGeometry, beamMaterial);
      beam.position.set(start.x, start.y + 7.5, start.z); beam.rotation.y = yaw + Math.PI / 2;
      harness.addOwned(beamGeometry, null); group.add(beam);
    };
    harness.build = (theme, options = {}) => {
      harness.disposeScene(false);
      const THREE = harness.THREE, detail = options.detail !== false;
      const palettes = {
        coast: {
          sky: '#c3d3d6', horizon: '#f0e2c4', zenith: '#7d9db2', fog: '#c9d2cc', fogNear: 190, fogFar: 980,
          groundTexture: 'grass', groundColor: '#cfc69a', asphaltColor: '#b4babd', exposure: 1.08, environmentIntensity: .65,
          sun: {color: '#ffe3ae', size: 16, x: -520, y: 120, z: -380},
          hemisphere: {sky: '#dfe6df', ground: '#6d654e', intensity: 1.55},
          key: {color: '#ffd9a2', intensity: 3.4, x: -220, y: 190, z: -160}, fill: {color: '#b6cfd8', intensity: .6}, shadows: true,
        },
        canyon: {
          sky: '#cdb894', horizon: '#f0d8ae', zenith: '#8a9bb0', fog: '#d5c0a0', fogNear: 190, fogFar: 1000,
          groundTexture: 'gravel', groundColor: '#d9bb8d', asphaltColor: '#a8a49c', exposure: 1.02, environmentIntensity: .6,
          sun: {color: '#ffdc9c', size: 18, x: -460, y: 150, z: -420},
          hemisphere: {sky: '#e8d6b4', ground: '#5c4630', intensity: 1.5},
          key: {color: '#ffcd8c', intensity: 3.6, x: -240, y: 220, z: -180}, fill: {color: '#c0a98b', intensity: .55}, shadows: true,
        },
        neon: {
          sky: '#0a1524', horizon: '#243b5a', zenith: '#04070d', fog: '#0b1522', fogNear: 120, fogFar: 760,
          groundTexture: 'shoulder', groundColor: '#5d6a7c', asphaltColor: '#7c8ca3', exposure: 1.28, environmentIntensity: .85,
          hemisphere: {sky: '#5d88b8', ground: '#10151d', intensity: 2.1},
          key: {color: '#a8c6e8', intensity: 1.7, x: -180, y: 220, z: -140}, fill: {color: '#8fa0cf', intensity: .8}, shadows: false,
          stars: true, moon: {size: 24, x: 420, y: 360, z: -560},
        },
        arcade: {
          sky: '#12071f', horizon: '#3d1c63', zenith: '#07020f', fog: '#1a0b2c', fogNear: 110, fogFar: 700,
          groundTexture: 'shoulder', groundColor: '#5c4875', asphaltColor: '#6b6482', exposure: 1.3, environmentIntensity: .9,
          hemisphere: {sky: '#8f68cc', ground: '#1a1028', intensity: 2.2},
          key: {color: '#c2a8ff', intensity: 2, x: -160, y: 200, z: -120}, fill: {color: '#a486ea', intensity: .85}, shadows: false,
          stars: true, moon: {size: 30, x: -360, y: 380, z: -520, color: '#f2e8ff'},
        },
      };
      const palette = palettes[theme];
      const pose = options.pose;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .2, 1400);
      harness.scene = scene; harness.camera = camera; harness.theme = theme;
      harness.track = harness.getTrack(theme);
      harness.pose = pose;
      harness.testGroup = new THREE.Group(); harness.testGroup.name = 'harness-scene-owned';
      scene.add(harness.testGroup);
      harness.renderer.toneMappingExposure = palette.exposure ?? 1.06;
      harness.buildSky(palette);
      harness.buildLighting(palette);
      harness.buildEnvironment(palette);
      harness.buildGround(palette);
      harness.buildRoad(palette);
      const track = harness.track;
      // Shadow camera follows the hero camera area.
      if (harness.keyLight) {
        const center = track.sample(pose.s + 40);
        harness.keyLight.position.set(center.x - 180, center.y + 190, center.z - 140);
        harness.keyLight.target.position.set(center.x, center.y, center.z);
      }
      pose.straightS = track.boostStraight ? track.boostStraight.s + 200 : pose.s + 200;
      harness.setPose(pose, false);
      const kit = harness.buildSceneryKit(track, THREE, {quality: {detail, particles: detail ? 64 : 18}, reducedMotion: false});
      scene.add(kit.group);
      harness.kit = kit;
      // Warm the pipeline (shader compile + shadow map) before measuring.
      harness.setPose(pose, false);
      harness.setPose(pose, true);
      harness.setPose(pose, false);
      const stats = kit.stats;
      const kitOnly = harness.measureKit();
      // Inventory used by the assertions: authored feature meshes, atlas rect health,
      // and whether the coast ocean actually sits below road level.
      const meshNames = [];
      kit.group.traverse(object => { if (object.isMesh) meshNames.push(object.name); });
      let signUv = null;
      kit.group.traverse(object => {
        if (!object.isMesh || !/^sign-/.test(object.material?.name || '')) return;
        const uv = object.geometry.getAttribute('uv');
        if (!uv || uv.count < 60) return;
        let uMin = 9, uMax = -9, vMin = 9, vMax = -9;
        const unique = new Set();
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i), v = uv.getY(i);
          uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
          unique.add(`${u.toFixed(3)},${v.toFixed(3)}`);
        }
        if (!signUv || uv.count > signUv.count) signUv = {count: uv.count, uMin, uMax, vMin, vMax, unique: unique.size};
      });
      let sea = null;
      kit.group.traverse(object => {
        if (object.name !== 'scenery-coast-sea') return;
        object.geometry.computeBoundingSphere();
        sea = {y: object.geometry.boundingSphere.center.y, visible: object.visible};
      });
      return {
        theme,
        stats: {
          draws: stats.draws, triangles: stats.triangles, instances: stats.instances, materials: stats.materials,
          geometries: stats.geometries, textures: stats.textures, detailDraws: stats.detailDraws, detailTriangles: stats.detailTriangles,
          layers: stats.layers, clearance: stats.clearance, features: stats.features,
        },
        anchorCount: (stats.anchors || []).length,
        anchorsMin: (() => {
          const anchors = stats.anchors || [], points = track.points;
          let min = Infinity;
          for (const [x, z] of anchors) {
            let best = Infinity;
            for (let i = 0; i < points.length; i++) {
              const dx = x - points[i].x, dz = z - points[i].z, distance = dx * dx + dz * dz;
              if (distance < best) best = distance;
            }
            if (best < min) min = best;
          }
          return Number.isFinite(min) ? Math.round(Math.sqrt(min) * 100) / 100 : 0;
        })(),
        detailChildren: kit.detailGroup.children.length,
        meshNames, signUv, sea,
        kitOnly,
        memory: harness.snapshot(),
        sceneCalls: harness.renderer.info.render.calls,
        sceneTriangles: harness.renderer.info.render.triangles,
      };
    };
    // Capture straight from the WebGL canvas right after rendering; page.screenshot
    // can return the previously presented frame and duplicate the near/wide views.
    harness.shot = (kind) => {
      if (kind === 'straight') harness.setPose({...harness.pose, s: harness.pose.straightS}, false);
      else harness.setPose(harness.pose, kind === 'wide');
      return {
        calls: harness.renderer.info.render.calls,
        triangles: harness.renderer.info.render.triangles,
        camera: harness.camera.position.toArray().map(value => Math.round(value * 10) / 10),
        data: harness.renderer.domElement.toDataURL('image/png'),
      };
    };
    harness.stability = () => {
      const kit = harness.kit, track = harness.track, THREE = harness.THREE;
      const first = {stats: kit.stats, retained: kit.retainedTextures.slice(), memory: harness.snapshot()};
      harness.kit = null;
      kit.dispose();
      kit.group.removeFromParent();
      harness.renderer.render(harness.scene, harness.camera);
      const afterDispose = harness.snapshot();
      const second = harness.buildSceneryKit(track, THREE, {quality: {detail: true, particles: 64}, reducedMotion: false});
      harness.scene.add(second.group);
      harness.kit = second;
      harness.renderer.render(harness.scene, harness.camera);
      const secondMemory = harness.snapshot();
      const retainedIdentity = second.retainedTextures.length === first.retained.length
        && second.retainedTextures.every((texture, index) => texture === first.retained[index] && texture.name === first.retained[index].name);
      const stableStats = {draws: second.stats.draws, triangles: second.stats.triangles, clearance: second.stats.clearance};
      const sameStats = second.stats.draws === first.stats.draws && second.stats.triangles === first.stats.triangles;
      // Low-detail build: the renderer hides detailGroup on low quality, so this
      // build must stay inside the low-tier budget all by itself.
      harness.kit = null;
      second.dispose();
      second.group.removeFromParent();
      harness.renderer.render(harness.scene, harness.camera);
      const low = harness.buildSceneryKit(track, THREE, {quality: {detail: false, particles: 18}, reducedMotion: false});
      harness.scene.add(low.group);
      harness.kit = low;
      harness.setPose(harness.pose, false);
      const lowOnly = harness.measureKit();
      const lowMemory = harness.snapshot();
      const lowResult = {
        draws: low.stats.draws, triangles: low.stats.triangles, instances: low.stats.instances,
        detailDraws: low.stats.detailDraws, detailChildren: low.detailGroup.children.length,
        clearance: low.stats.clearance, kitOnly: lowOnly,
      };
      low.dispose();
      low.group.removeFromParent();
      harness.kit = null;
      harness.renderer.render(harness.scene, harness.camera);
      const finalMemory = harness.snapshot();
      return {
        first: {draws: first.stats.draws, triangles: first.stats.triangles, memory: first.memory},
        afterDispose, secondMemory, finalMemory,
        sameStats, retainedIdentity, secondStats: stableStats, low: lowResult, lowMemory,
      };
    };
    harness.disposeScene = (disposeTextures = false) => {
      if (harness.kit) { harness.kit.dispose(); harness.kit = null; }
      for (const geometry of harness.owned.geometries) geometry.dispose();
      for (const material of harness.owned.materials) material.dispose();
      harness.owned = {geometries: [], materials: []};
      if (harness.scene) {
        harness.scene.traverse(object => { if (object.isMesh) object.geometry?.dispose?.(); });
        harness.scene.clear();
      }
      harness.scene = null;
      harness.environmentTarget?.dispose();
      harness.environmentTarget = null;
      if (disposeTextures) harness.disposeSurfaceTextures(harness.THREE);
    };
    harness.update = (frames = 90, reduced = false) => {
      let time = 0;
      for (let i = 0; i < frames; i++) { time += 1 / 60; harness.kit?.update(1 / 60, time, reduced); }
      return harness.snapshot();
    };
    // The scene content was attached to the test group before the kit was built;
    // make sure every visual root used by measureKit is inside it.
    harness.hasRenderer = true;
  });
}

(async () => {
  const browser = await chromium.launch({channel: process.env.CHROME_CHANNEL || 'chrome', headless: true});
  const errors = [], warnings = [], report = [];
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1});
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.goto(BASE, {waitUntil: 'load'});
    await page.waitForFunction(() => !!window.__racerDebug, {timeout: 15000}).catch(() => {});
    await installHarness(page);
    await page.evaluate(() => {
      for (const element of document.querySelectorAll('body > *')) {
        if (element.id !== 'scenery-harness-overlay' && !element.classList?.contains('keep')) element.style.visibility = 'hidden';
      }
    });
    await wait(200);

    for (const theme of THEMES) {
      const built = await page.evaluate(({theme, pose}) => window.__sceneryHarness.build(theme, {detail: true, pose}), {theme, pose: THEME_POSES[theme]});
      // Render budgets for the high-quality kit (worst case: whole kit, all layers).
      assert.ok(built.stats.draws <= HIGH_BUDGET.draws, `${theme}: high draws ${built.stats.draws} > ${HIGH_BUDGET.draws}`);
      assert.ok(built.stats.triangles <= HIGH_BUDGET.triangles, `${theme}: high triangles ${built.stats.triangles} > ${HIGH_BUDGET.triangles}`);
      assert.ok(built.kitOnly.calls <= HIGH_BUDGET.draws, `${theme}: measured kit calls ${built.kitOnly.calls} > ${HIGH_BUDGET.draws}`);
      assert.ok(built.kitOnly.triangles <= HIGH_BUDGET.triangles, `${theme}: measured kit triangles ${built.kitOnly.triangles}`);
      // Road / guardrail clearance, measured from independent track samples.
      assert.ok(built.stats.clearance.violations === 0, `${theme}: ${built.stats.clearance.violations} anchors inside the guardrail`);
      assert.ok(built.anchorsMin >= 13.5, `${theme}: nearest anchor ${built.anchorsMin}m < 13.5m`);
      assert.ok(built.detailChildren > 0, `${theme}: detailGroup is empty at high quality`);
      assert.ok(built.stats.features.boostShowcase > 0, `${theme}: no showcase props in the boost-straight evidence section`);
      assert.ok(built.signUv && built.signUv.unique >= 24, `${theme}: sign atlas cards sample too few UV corners (blank hoarding regression)`);
      assert.ok(built.signUv.uMax - built.signUv.uMin > .2 && built.signUv.vMax - built.signUv.vMin > .2, `${theme}: sign atlas cards do not cover their cell`);
      if (theme === 'coast') {
        assert.equal(built.stats.features.sea, true, 'coast: ocean ring missing');
        assert.ok(built.stats.features.coastShelf > 0, 'coast: no visible cliffs/headland');
        assert.ok(built.sea && built.sea.y < -10, `coast: ocean is not below road level (${JSON.stringify(built.sea)})`);
        assert.ok(['scenery-palm-trunks-0', 'scenery-palm-trunks-1', 'scenery-palm-trunks-2'].every(name => built.meshNames.includes(name)), 'coast: palm variants missing');
        assert.equal(built.stats.features.palmVariants, 3);
      }
      if (theme === 'canyon') {
        assert.ok(built.stats.features.canyonWalls > 0, 'canyon: corridor walls missing');
        assert.ok(built.stats.features.canyonTalus > 0, 'canyon: talus skirt missing');
      }
      if (theme === 'neon') {
        assert.equal(built.stats.features.windowVariants, 3);
        assert.equal(built.stats.features.farWindowGrid, true, 'neon: fine-grid distant windows missing');
      }
      if (theme === 'arcade') {
        assert.ok(built.stats.features.arcadeGateTowers >= 4, 'arcade: authored gate towers missing');
        assert.equal(built.stats.features.lightRigs, 8, 'arcade: suspended light rigs missing');
        assert.ok(built.stats.features.tentRigs > 0, 'arcade: tent poles/guy lines missing');
      }
      // Animate + reduced motion must not throw or leak.
      const afterFrames = await page.evaluate(() => {
        const harness = window.__sceneryHarness, before = harness.snapshot();
        harness.update(120, false);
        const moving = harness.snapshot();
        harness.update(60, true);
        const quiet = harness.snapshot();
        return {before, moving, quiet};
      });
      assert.equal(afterFrames.moving.geometries, afterFrames.before.geometries, `${theme}: animate leaked geometries`);
      assert.equal(afterFrames.quiet.geometries, afterFrames.before.geometries, `${theme}: reduced motion leaked geometries`);
      const saveCanvas = (data, file) => fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      const near = await page.evaluate(() => window.__sceneryHarness.shot(false));
      saveCanvas(near.data, path.join(output, `scenery-${theme}.png`));
      const wide = await page.evaluate(() => window.__sceneryHarness.shot('wide'));
      saveCanvas(wide.data, path.join(output, `scenery-${theme}-wide.png`));
      // Evidence-shot framing: the boost straight is where active-play captures look.
      const straight = await page.evaluate(() => window.__sceneryHarness.shot('straight'));
      saveCanvas(straight.data, path.join(output, `scenery-${theme}-straight.png`));
      const stability = await page.evaluate(() => window.__sceneryHarness.stability());
      assert.ok(stability.sameStats, `${theme}: rebuild changed kit stats`);
      assert.ok(stability.retainedIdentity, `${theme}: retained textures were recreated across rebuild`);
      assert.ok(stability.secondMemory.geometries <= stability.first.memory.geometries + 3, `${theme}: rebuild leaked geometries`);
      assert.ok(stability.secondMemory.textures <= stability.first.memory.textures + 1, `${theme}: rebuild leaked textures`);
      assert.ok(stability.low.draws <= LOW_BUDGET.draws, `${theme}: low draws ${stability.low.draws} > ${LOW_BUDGET.draws}`);
      assert.ok(stability.low.triangles <= LOW_BUDGET.triangles, `${theme}: low triangles ${stability.low.triangles}`);
      assert.ok(stability.low.kitOnly.triangles <= LOW_BUDGET.triangles, `${theme}: measured low triangles`);
      assert.equal(stability.low.detailChildren, 0, `${theme}: low quality still built detail geometry`);
      assert.ok(stability.low.draws < built.stats.draws, `${theme}: low quality did not reduce draw calls`);
      assert.ok(stability.low.clearance.violations === 0, `${theme}: low quality cleared the guardrail check`);
      const shotPath = path.join(output, `scenery-${theme}.png`);
      const widePath = path.join(output, `scenery-${theme}-wide.png`);
      const straightPath = path.join(output, `scenery-${theme}-straight.png`);
      assert.ok(fs.statSync(shotPath).size > 20000, `${theme}: near screenshot looks empty`);
      assert.ok(fs.statSync(widePath).size > 20000, `${theme}: wide screenshot looks empty`);
      assert.ok(fs.statSync(straightPath).size > 20000, `${theme}: straight screenshot looks empty`);
      report.push({
        theme,
        near: {path: shotPath, calls: near.calls, triangles: near.triangles},
        wide: {path: widePath},
        straight: {path: straightPath},
        high: {
          draws: built.stats.draws, triangles: built.stats.triangles, instances: built.stats.instances,
          materials: built.stats.materials, geometries: built.stats.geometries, textures: built.stats.textures,
          detailDraws: built.stats.detailDraws, detailTriangles: built.stats.detailTriangles,
          layers: built.stats.layers, clearance: built.stats.clearance, anchorsMin: built.anchorsMin,
          features: built.stats.features, signUv: built.signUv, sea: built.sea,
          kitOnly: built.kitOnly, memory: built.memory,
        },
        low: stability.low,
        stability: {
          sameStats: stability.sameStats, retainedIdentity: stability.retainedIdentity,
          firstMemory: stability.first.memory, afterDispose: stability.afterDispose,
          secondMemory: stability.secondMemory, finalMemory: stability.finalMemory, lowMemory: stability.lowMemory,
        },
      });
      // Reset the scene for the next theme without destroying retained textures.
      await page.evaluate(() => window.__sceneryHarness.disposeScene(false));
      await wait(60);
    }
    // Texture library must be shared: growing textures across theme switches is a leak.
    const textures = await page.evaluate(() => {
      const harness = window.__sceneryHarness;
      return {count: harness.lib.retainedTextures().length, stats: harness.lib.stats, refresh: harness.refreshSurfaceTextures(harness.THREE)};
    });
    assert.ok(textures.refresh >= textures.count, 'refreshSurfaceTextures did not mark every retained texture');
    assert.deepEqual(errors, [], `console/page errors: ${errors.join('\n')}`);
    const reportPath = path.join(output, 'scenery-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({passed: true, budgets: {high: HIGH_BUDGET, low: LOW_BUDGET}, textures, warnings, report}, null, 2));
    console.log(JSON.stringify({
      passed: true,
      budgets: {high: HIGH_BUDGET, low: LOW_BUDGET},
      textures: {count: textures.count, estimatedBytes: textures.stats.estimatedBytes, atlases: textures.stats.atlases},
      themes: report.map(entry => ({
        theme: entry.theme,
        draws: entry.high.draws, triangles: entry.high.triangles, lowDraws: entry.low.draws, lowTriangles: entry.low.triangles,
        instances: entry.high.instances, textures: entry.high.textures, clearance: entry.high.clearance,
        anchorsMin: entry.high.anchorsMin, kitCalls: entry.high.kitOnly.calls, memory: entry.stability,
        screenshots: [path.basename(entry.near.path), path.basename(entry.wide.path), path.basename(entry.straight.path)],
      })),
      warnings,
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
