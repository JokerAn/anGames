// Browser smoke test for the premium render pipeline (src/postfx.js +
// src/sky-environment.js). Runs real WebGL2 in headless Chrome against the
// already-running game server, captures post 0/1/2 screenshots, four sky
// themes, resize/dispose/recreate checks and reports measured draw calls.
// Usage:
//   PLAYWRIGHT_MODULE=/Users/anshunli/gitHub/anGames/少年枪王/node_modules/playwright \
//     node test/postfx-browser.cjs
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, 'artifacts', 'premium');
fs.mkdirSync(output, {recursive: true});
const URL = process.env.RACER_URL || 'http://127.0.0.1:3210';
const DESKTOP = {width: 1280, height: 800};
const MOBILE = {width: 390, height: 844};
const REPORT_PATH = path.join(output, 'postfx-report.json');

const round = value => Math.round(value * 100) / 100;

function assertScreenshot(name) {
  const file = path.join(output, name);
  assert.ok(fs.existsSync(file), `missing screenshot ${file}`);
  const size = fs.statSync(file).size;
  assert.ok(size > 15000, `screenshot ${name} looks empty (${size} bytes)`);
  return {name, bytes: size};
}

function assertPixels(label, pixels) {
  assert.ok(pixels.mean > 6, `${label}: frame too dark (mean ${pixels.mean})`);
  assert.ok(pixels.nonBlackShare > 0.5, `${label}: ${(pixels.nonBlackShare * 100).toFixed(1)}% non-black pixels`);
  assert.ok(pixels.distinct > 40, `${label}: only ${pixels.distinct} distinct sampled colors`);
  assert.ok(pixels.max > 40, `${label}: max luminance ${pixels.max}`);
}

(async () => {
  const browser = await chromium.launch({channel: process.env.CHROME_CHANNEL || 'chrome', headless: true});
  const errors = [];
  const warnings = [];
  const report = {url: URL, generated: new Date().toISOString(), post: [], sky: [], budget: {}, errors, warnings};
  let page = null;
  try {
    page = await browser.newPage({viewport: DESKTOP});
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      const type = message.type();
      if (type === 'error') errors.push(`console.error: ${message.text()}`);
      if (type === 'warning') warnings.push(`console.warn: ${message.text()}`);
    });
    await page.goto(URL, {waitUntil: 'load'});
    await page.waitForFunction(() => window.__racerDebug !== undefined);

    // ---------------------------------------------------------------- stage
    const stage = await page.evaluate(async () => {
      const [THREE, postModule, skyModule] = await Promise.all([
        import('/vendor/three.module.js'),
        import('/src/postfx.js'),
        import('/src/sky-environment.js'),
      ]);
      const {PostPipeline} = postModule;
      const {skyPreset, createSky, createOutdoorEnvironment} = skyModule;

      const container = document.createElement('div');
      container.id = 'postfx-stage';
      container.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#05070a;overflow:hidden';
      document.body.append(container);

      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(1);
      renderer.setSize(container.clientWidth || 1280, container.clientHeight || 800);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
      container.append(renderer.domElement);

      const width = container.clientWidth || 1280;
      const height = container.clientHeight || 800;

      // ---- synthetic premium scene: metal plates, glowing bars, colored
      // spheres, reflective ground. Arcade night sky feeds the reflections.
      const preset = skyPreset({id: 'arcade'});
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(preset.top);
      scene.fog = new THREE.Fog(preset.fog.color, 16, 78);
      const envStartedAt = performance.now();
      const environment = createOutdoorEnvironment(renderer, {id: 'arcade'}, THREE);
      const envBakeMs = Math.round((performance.now() - envStartedAt) * 100) / 100;
      scene.environment = environment.texture;
      scene.environmentIntensity = 1.0;
      const skyStartedAt = performance.now();
      const sky = createSky({id: 'arcade'}, THREE);
      const skyBakeMs = Math.round((performance.now() - skyStartedAt) * 100) / 100;
      scene.add(sky.group);

      scene.add(new THREE.HemisphereLight('#a48cff', '#170d22', 0.9));
      const key = new THREE.DirectionalLight('#fff0d8', 3.2);
      key.position.set(-7, 11, 5);
      scene.add(key, key.target);
      const rim = new THREE.PointLight('#2ee6ff', 140, 30, 2);
      rim.position.set(6.5, 3.6, -4.5);
      scene.add(rim);
      const magenta = new THREE.PointLight('#ff3d9a', 110, 26, 2);
      magenta.position.set(-6.5, 3.2, 2.5);
      scene.add(magenta);
      const amber = new THREE.PointLight('#ffb347', 60, 18, 2);
      amber.position.set(0, 6.2, 1.5);
      scene.add(amber);

      const groundMaterial = new THREE.MeshStandardMaterial({color: '#12141c', metalness: 0.85, roughness: 0.28, envMapIntensity: 1.25});
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      const laneMaterial = new THREE.MeshStandardMaterial({color: '#08090c', emissive: '#22e6ff', emissiveIntensity: 3, roughness: 0.4, metalness: 0.1});
      for (const x of [-4.6, 4.6]) {
        const lane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 30), laneMaterial);
        lane.position.set(x, 0.015, -4);
        scene.add(lane);
      }

      const plateLight = new THREE.MeshStandardMaterial({color: '#cfd6dd', metalness: 1, roughness: 0.24, envMapIntensity: 1.35});
      const plateDark = new THREE.MeshStandardMaterial({color: '#838b96', metalness: 1, roughness: 0.42, envMapIntensity: 1.15});
      const trimLight = new THREE.MeshStandardMaterial({color: '#e8edf2', metalness: 1, roughness: 0.12, envMapIntensity: 1.5});
      const addPlate = (x, z, width, depth, rotation, material) => {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(width, 0.35, depth), material);
        plate.position.set(x, 0.175, z);
        plate.rotation.y = rotation;
        scene.add(plate);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(width * 0.94, 0.03, depth * 0.94), trimLight);
        trim.position.set(x, 0.37, z);
        trim.rotation.y = rotation;
        scene.add(trim);
      };
      addPlate(-6.4, 1.6, 3.4, 2.4, 0.18, plateLight);
      addPlate(6.4, 1.4, 3.4, 2.4, -0.18, plateDark);
      addPlate(-7.6, -6.2, 3.8, 2.8, -0.3, plateDark);
      addPlate(7.6, -6.4, 3.8, 2.8, 0.3, plateLight);
      addPlate(-3.4, 3.4, 2.2, 1.6, 0.4, plateDark);
      addPlate(3.6, 3.6, 2.2, 1.6, -0.4, plateDark);
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), plateLight);
      cube.position.set(-4.2, 1.1, -1.4);
      cube.rotation.y = 0.42;
      scene.add(cube);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.6), plateDark);
      crate.position.set(4.9, 0.45, 2.6);
      crate.rotation.y = -0.25;
      scene.add(crate);

      const glowColors = ['#22e6ff', '#ff3d9a', '#ffd23f'];
      for (let i = 0; i < 7; i++) {
        const color = glowColors[i % glowColors.length];
        const material = new THREE.MeshStandardMaterial({color: '#050608', emissive: color, emissiveIntensity: 2.6, roughness: 0.35, metalness: 0.2});
        const height = 3.2 + (i % 3) * 0.6;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, height, 10), material);
        bar.position.set(-8.4 + i * 2.8, height / 2 + 0.1, -9.5 + (i % 2) * 2.4);
        scene.add(bar);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.18, 12), plateDark);
        base.position.set(bar.position.x, 0.09, bar.position.z);
        scene.add(base);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.035, 0.1), material);
        strip.position.set(bar.position.x, 0.03, bar.position.z + 1.5);
        scene.add(strip);
      }

      // Hero portal ring: a large authored glow shape for bloom to halo.
      const ringMaterial = new THREE.MeshStandardMaterial({color: '#0a0b10', emissive: '#22e6ff', emissiveIntensity: 3.4, roughness: 0.35, metalness: 0.5});
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.07, 10, 64), ringMaterial);
      ring.position.set(0, 4.4, -13);
      scene.add(ring);
      const innerRingMaterial = new THREE.MeshStandardMaterial({color: '#0a0b10', emissive: '#ff3d9a', emissiveIntensity: 2.6, roughness: 0.4, metalness: 0.4});
      const innerRing = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.05, 8, 56), innerRingMaterial);
      innerRing.position.copy(ring.position);
      scene.add(innerRing);
      const portalCore = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 20), new THREE.MeshStandardMaterial({color: '#0a0b10', emissive: '#bd7dff', emissiveIntensity: 4, roughness: 0.3, metalness: 0.5}));
      portalCore.position.copy(ring.position);
      scene.add(portalCore);
      for (const x of [-9.4, 9.4]) {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.4, 0.5), plateDark);
        pylon.position.set(x, 2.7, -2.4);
        scene.add(pylon);
        const pylonGlow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.6, 0.14), new THREE.MeshStandardMaterial({color: '#050608', emissive: x < 0 ? '#ff3d9a' : '#22e6ff', emissiveIntensity: 2.8, roughness: 0.4}));
        pylonGlow.position.set(x + (x < 0 ? 0.28 : -0.28), 2.7, -2.4);
        scene.add(pylonGlow);
      }

      const sphereColors = ['#ff3b6b', '#28e0ff', '#ffd23f', '#a35bff', '#3bff9e', '#ff7a3b'];
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(12, 0.24, 2.6), plateDark);
      plinth.position.set(0, 0.12, -3.8);
      scene.add(plinth);
      sphereColors.forEach((color, i) => {
        const material = new THREE.MeshPhysicalMaterial({color, metalness: 0.35, roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: 1.5});
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 20), material);
        sphere.position.set(-4.7 + i * 1.88, 0.86, -3.8);
        scene.add(sphere);
      });

      const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 2000);
      camera.position.set(0, 3.4, 12.2);
      camera.lookAt(0, 2.6, -6);

      // Sample canvas into a 2D canvas: mean luminance, non-black share and
      // distinct-color count make "canvas is not empty" measurable.
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 160;
      sampleCanvas.height = 120;
      const sampleContext = sampleCanvas.getContext('2d', {willReadFrequently: true});
      const measure = () => {
        sampleContext.clearRect(0, 0, 160, 120);
        sampleContext.drawImage(renderer.domElement, 0, 0, renderer.domElement.width, renderer.domElement.height, 0, 0, 160, 120);
        const data = sampleContext.getImageData(0, 0, 160, 120).data;
        let sum = 0;
        let nonBlack = 0;
        let min = 255;
        let max = 0;
        const colors = new Set();
        const pixelCount = data.length / 4;
        const histogram = new Uint32Array(256);
        const skyHistogram = new Uint32Array(256);
        let skyCount = 0;
        let skySum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
          sum += luminance;
          if (r + g + b > 24) nonBlack++;
          if (luminance < min) min = luminance;
          if (luminance > max) max = luminance;
          if (colors.size < 600) colors.add((r >> 2) << 12 | (g >> 2) << 6 | (b >> 2));
          const bin = luminance >= 255 ? 255 : luminance | 0;
          histogram[bin]++;
          if (i / 4 < 160 * 40) {
            skyHistogram[bin]++;
            skyCount++;
            skySum += luminance;
          }
        }
        const percentile = (bins, count, fraction) => {
          const target = count * fraction;
          let accumulated = 0;
          for (let i = 0; i < 256; i++) {
            accumulated += bins[i];
            if (accumulated >= target) return i;
          }
          return 255;
        };
        return {
          mean: Math.round(sum / pixelCount * 100) / 100,
          nonBlackShare: Math.round(nonBlack / pixelCount * 1000) / 1000,
          min: Math.round(min),
          max: Math.round(max),
          distinct: colors.size,
          p5: percentile(histogram, pixelCount, 0.05),
          p50: percentile(histogram, pixelCount, 0.5),
          p95: percentile(histogram, pixelCount, 0.95),
          skyMean: skyCount > 0 ? Math.round(skySum / skyCount * 100) / 100 : 0,
          skyP5: skyCount > 0 ? percentile(skyHistogram, skyCount, 0.05) : 0,
        };
      };

      const state = {
        THREE, PostPipeline, skyPreset, createSky, createOutdoorEnvironment,
        renderer, container, scene, camera, sky, environment, measure,
        width, height, pixelRatio: 1, pipeline: null,
      };

      state.buildPipeline = (mode, style) => {
        if (state.pipeline) state.pipeline.dispose();
        const quality = {post: mode, postSamples: mode === 2 ? 2 : 0, bloomMips: mode === 2 ? 4 : 0, bloomStrength: 0.62};
        const pipeline = new PostPipeline(renderer, quality, THREE);
        state.pipeline = pipeline;
        pipeline.setSize(state.width, state.height, state.pixelRatio);
        if (style) pipeline.setStyle(style);
        return pipeline.diagnostics;
      };

      state.renderScene = (scene, camera, count = 4, frame = {speed01: 0.65, boost01: 0, reducedMotion: false}, onFrame) => {
        const pipeline = state.pipeline;
        pipeline.setSize(state.width, state.height, state.pixelRatio);
        let stats = null;
        let cpuTotal = 0;
        let cpuFrames = 0;
        for (let i = 0; i < count; i++) {
          if (onFrame) onFrame(i);
          pipeline.update(1 / 60, frame);
          // Measure the whole frame (scene + post passes) in one info bucket.
          renderer.info.autoReset = false;
          renderer.info.reset();
          const startedAt = performance.now();
          pipeline.render(scene, camera);
          // Frame 0 includes shader compilation; report steady-state submission.
          if (i > 0) {
            cpuTotal += performance.now() - startedAt;
            cpuFrames++;
          }
          stats = {
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            textures: renderer.info.memory.textures,
            geometries: renderer.info.memory.geometries,
            programs: renderer.info.programs ? renderer.info.programs.length : 0,
          };
          renderer.info.autoReset = true;
        }
        stats.cpuMs = cpuFrames > 0 ? Math.round(cpuTotal / cpuFrames * 100) / 100 : 0;
        return {stats, diagnostics: pipeline.diagnostics, pixels: measure()};
      };

      state.renderFrames = (count = 4, frame = {speed01: 0.65, boost01: 0, reducedMotion: false}) => state.renderScene(
        state.scene,
        state.camera,
        count,
        frame,
        () => state.sky.update(1 / 60, false, state.camera),
      );

      state.resize = (nextWidth, nextHeight, pixelRatio) => {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(nextWidth, nextHeight);
        state.width = nextWidth;
        state.height = nextHeight;
        state.pixelRatio = pixelRatio;
        state.camera.aspect = nextWidth / nextHeight;
        state.camera.updateProjectionMatrix();
        state.pipeline.setSize(nextWidth, nextHeight, pixelRatio);
        return state.renderFrames(2);
      };

      state.styleCheck = () => {
        const pipeline = state.pipeline;
        pipeline.setStyle({exposure: 99, bloom: -5, vignette: 9, temperature: -9, threshold: 1.2});
        const clamped = {...pipeline.diagnostics.style};
        for (let i = 0; i < 90; i++) pipeline.update(1 / 30, {speed01: 1, boost01: 0, reducedMotion: false});
        const movingSpeed = pipeline.diagnostics.speed;
        for (let i = 0; i < 90; i++) pipeline.update(1 / 30, {speed01: 1, boost01: 1, reducedMotion: true});
        const frozenSpeed = pipeline.diagnostics.speed;
        pipeline.setStyle({exposure: 1.05, bloom: 0.62, threshold: 0.85, vignette: 0.2, temperature: 0, saturation: 1.05, contrast: 1.03, grain: 0.04, aberration: 0.35, speed: 0.5});
        return {clamped, movingSpeed, frozenSpeed};
      };

      state.timingCheck = () => {
        const sample = mode => {
          state.buildPipeline(mode);
          for (let i = 0; i < 6; i++) {
            state.sky.update(1 / 60, false, state.camera);
            state.pipeline.update(1 / 60, {speed01: 0.7, boost01: 0.2, reducedMotion: false});
            state.pipeline.render(state.scene, state.camera);
          }
          const frames = 30;
          const startedAt = performance.now();
          for (let i = 0; i < frames; i++) {
            state.sky.update(1 / 60, false, state.camera);
            state.pipeline.update(1 / 60, {speed01: 0.7, boost01: 0.2, reducedMotion: false});
            state.pipeline.render(state.scene, state.camera);
          }
          const total = performance.now() - startedAt;
          return {
            mode,
            frames,
            cpuMsPerFrame: Math.round(total / frames * 100) / 100,
            calls: renderer.info.render.calls,
            textures: renderer.info.memory.textures,
          };
        };
        return {direct: sample(0), bloom: sample(2)};
      };

      state.allocationCheck = () => {
        state.buildPipeline(2);
        const warm = state.renderFrames(8, {speed01: 0.8, boost01: 0.4, reducedMotion: false});
        const before = {
          textures: renderer.info.memory.textures,
          geometries: renderer.info.memory.geometries,
          calls: warm.stats.calls,
          triangles: warm.stats.triangles,
        };
        state.renderFrames(90, {speed01: 0.9, boost01: 0.5, reducedMotion: false});
        const after = {
          textures: renderer.info.memory.textures,
          geometries: renderer.info.memory.geometries,
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        };
        return {before, after, frames: 90};
      };

      state.disposeCheck = () => {
        const before = renderer.info.memory.textures;
        state.pipeline.dispose();
        state.pipeline.dispose();
        const after = renderer.info.memory.textures;
        return {texturesBefore: before, texturesAfter: after, enabled: state.pipeline.enabled, diagnostics: state.pipeline.diagnostics};
      };

      state.recreate = () => {
        state.buildPipeline(2);
        const rendered = state.renderFrames(3);
        return {diagnostics: rendered.diagnostics, pixels: rendered.pixels, stats: rendered.stats};
      };

      // ---- sky theme stage ------------------------------------------------
      state.skyState = null;
      state.showSky = id => {
        const previous = state.skyState;
        const baselineBefore = renderer.info.memory.textures;
        if (previous) {
          previous.sky.dispose();
          previous.environment.dispose();
        }
        const preset = skyPreset({id});
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(preset.top);
        scene.fog = new THREE.Fog(preset.fog.color, preset.fog.near, preset.fog.far);
        const environment = createOutdoorEnvironment(renderer, {id}, THREE);
        scene.environment = environment.texture;
        scene.environmentIntensity = preset.envIntensity;
        const createSkyStartedAt = performance.now();
        const sky = createSky({id}, THREE);
        const createSkyMs = Math.round((performance.now() - createSkyStartedAt) * 100) / 100;
        scene.add(sky.group);

        const groundColor = new THREE.Color(preset.groundColor).multiplyScalar(preset.night ? 0.28 : 0.42);
        const groundMaterial = new THREE.MeshStandardMaterial({color: groundColor, roughness: 0.95, metalness: 0.05});
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        scene.add(ground);

        const silhouette = new THREE.MeshStandardMaterial({color: preset.night ? '#101724' : '#39413a', roughness: 0.9, metalness: 0.1});
        const random = (() => {
          let seed = id === 'coast' ? 11 : id === 'canyon' ? 23 : id === 'neon' ? 37 : 51;
          return () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
          };
        })();
        const towers = [];
        for (let i = 0; i < 14; i++) {
          const angle = -0.9 + i * 0.14 + (random() - 0.5) * 0.06;
          const distance = 90 + random() * 90;
          const width = 6 + random() * 10;
          const depth = 6 + random() * 10;
          const height = preset.night ? 10 + random() * 34 : 4 + random() * 16;
          const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), silhouette);
          box.position.set(Math.sin(angle) * distance, height / 2, -Math.cos(angle) * distance);
          scene.add(box);
          towers.push({x: box.position.x, z: box.position.z, width, depth, height});
        }
        if (preset.night) {
          // Lit windows: one instanced draw call, the way a shipped city would do it.
          const windowGeometry = new THREE.BoxGeometry(0.18, 0.5, 0.12);
          const windowMaterial = new THREE.MeshStandardMaterial({color: '#05070a', emissive: preset.cityGlow, emissiveIntensity: 2.6, roughness: 0.6});
          const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, towers.length * 12);
          const dummy = new THREE.Object3D();
          let index = 0;
          for (const tower of towers) {
            const columns = 3;
            const rows = 4;
            for (let row = 0; row < rows; row++) {
              for (let column = 0; column < columns; column++) {
                dummy.position.set(
                  tower.x + (column - (columns - 1) / 2) * tower.width * 0.26,
                  1.6 + row * Math.max(1.2, (tower.height - 3) / rows),
                  tower.z + tower.depth / 2 + 0.08,
                );
                dummy.updateMatrix();
                windows.setMatrixAt(index++, dummy.matrix);
              }
            }
          }
          windows.count = index;
          windows.instanceMatrix.needsUpdate = true;
          scene.add(windows);
        }
        const sun = new THREE.DirectionalLight(preset.sunColor, preset.night ? 1.7 : 3.4);
        sun.position.set(preset.sunDir.x * 80, preset.sunDir.y * 80 + 6, preset.sunDir.z * 80);
        scene.add(sun, sun.target);
        scene.add(new THREE.HemisphereLight(preset.top, preset.groundColor, preset.night ? 0.9 : 1.7));

        const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 2000);
        camera.position.set(0, 2.6, 8);
        const lookDistance = 120;
        camera.lookAt(preset.sunDir.x * lookDistance, 3 + preset.sunDir.y * lookDistance * 0.55, preset.sunDir.z * lookDistance);
        camera.aspect = state.width / state.height;
        camera.updateProjectionMatrix();

        // Sky-only draw call count, measured with a throw-away scene.
        const probe = createSky({id}, THREE);
        const probeScene = new THREE.Scene();
        probeScene.add(probe.group);
        renderer.info.autoReset = false;
        renderer.info.reset();
        renderer.setRenderTarget(null);
        renderer.render(probeScene, camera);
        const skyDrawCalls = renderer.info.render.calls;
        renderer.info.autoReset = true;
        const probeRetained = probe.retainedTextures.slice();
        probe.dispose();
        // A second instance must reuse the module-cached cloud texture.
        const second = createSky({id}, THREE);
        const textureReused = second.retainedTextures.length > 0
          && sky.retainedTextures.length > 0
          && second.retainedTextures[0] === sky.retainedTextures[0]
          && probeRetained[0] === sky.retainedTextures[0];
        second.dispose();

        state.skyState = {scene, camera, sky, environment, preset};
        state.pipeline.setSize(state.width, state.height, state.pixelRatio);
        // Theme-aware grade: day skies get a light bloom so the horizon does not
        // haze over, night skies get a stronger glow for the moon and city.
        state.pipeline.setStyle(preset.night
          ? {exposure: preset.exposure, bloom: 0.72, threshold: 0.78, vignette: 0.1}
          : {exposure: preset.exposure, bloom: 0.24, threshold: 1.05, vignette: 0.1});
        const frames = state.renderScene(scene, camera, 4, {speed01: 0.4, boost01: 0, reducedMotion: false}, () => sky.update(1 / 60, false, camera));
        const textureCounts = {
          before: baselineBefore,
          afterRender: renderer.info.memory.textures,
        };
        return {
          preset: {
            id: preset.id,
            theme: preset.theme,
            night: preset.night,
            top: preset.top,
            horizon: preset.horizon,
            sunColor: preset.sunColor,
            cloudCover: preset.cloudCover,
            starCount: preset.starCount,
            fog: preset.fog,
            exposure: preset.exposure,
            envIntensity: preset.envIntensity,
          },
          skyDrawCalls,
          drawCallsDeclared: sky.drawCalls,
          createSkyMs,
          retainedTextures: sky.retainedTextures.length,
          textureReused,
          envTexture: !!environment.texture,
          stats: frames.stats,
          diagnostics: frames.diagnostics,
          pixels: frames.pixels,
          textureCounts,
        };
      };

      state.mobileBudget = (nextWidth, nextHeight, pixelRatio) => {
        state.width = nextWidth;
        state.height = nextHeight;
        state.pixelRatio = pixelRatio;
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(nextWidth, nextHeight);
        state.camera.aspect = nextWidth / nextHeight;
        state.camera.updateProjectionMatrix();
        const direct = state.buildPipeline(0);
        const directFrames = state.renderFrames(2);
        const bloom = state.buildPipeline(2);
        const bloomFrames = state.renderFrames(2);
        return {
          mode0: {diagnostics: direct, stats: directFrames.stats, pixels: directFrames.pixels},
          mode2: {diagnostics: bloom, stats: bloomFrames.stats, pixels: bloomFrames.pixels},
          drawDelta: bloomFrames.stats.calls - directFrames.stats.calls,
        };
      };

      state.cleanup = () => {
        if (state.skyState) {
          state.skyState.sky.dispose();
          state.skyState.environment.dispose();
          state.skyState = null;
        }
        if (state.pipeline) {
          state.pipeline.dispose();
          state.pipeline = null;
        }
        state.sky.dispose();
        state.environment.dispose();
        renderer.dispose();
        container.remove();
      };

      window.__pfx = state;
      return {
        width,
        height,
        isWebGL2: !!renderer.capabilities.isWebGL2,
        maxTextureSize: renderer.capabilities.maxTextureSize,
        hdr: state.buildPipeline(0).hdr,
        firstSkyBakeMs: skyBakeMs,
        firstEnvBakeMs: envBakeMs,
        cloudTexturesCached: 1,
      };
    });

    report.webgl = stage;
    report.viewport = DESKTOP;

    // ------------------------------------------------- post 0 / 1 / 2 shots
    const postResults = {};
    for (const mode of [0, 1, 2]) {
      const setup = await page.evaluate(mode => {
        const diagnostics = window.__pfx.buildPipeline(mode);
        const rendered = window.__pfx.renderFrames(5, {speed01: 0.7, boost01: 0, reducedMotion: false});
        return {diagnostics, ...rendered};
      }, mode);
      const screenshotName = `postfx-post${mode}.png`;
      await page.screenshot({path: path.join(output, screenshotName)});
      const screenshot = assertScreenshot(screenshotName);
      assertPixels(`post=${mode}`, setup.pixels);
      if (mode === 0) {
        assert.equal(setup.diagnostics.enabled, false, 'post=0 must disable the pipeline');
        assert.equal(setup.diagnostics.mode, 0);
        assert.equal(setup.diagnostics.passes, 0);
        assert.equal(setup.diagnostics.bloomMips, 0);
      }
      if (mode === 1) {
        assert.equal(setup.diagnostics.enabled, true);
        assert.equal(setup.diagnostics.mode, 1);
        assert.equal(setup.diagnostics.passes, 1, 'post=1 is a single graded composite pass');
        assert.equal(setup.diagnostics.bloomMips, 0);
        assert.equal(setup.stats.calls - postResults[0].stats.calls, 1, 'post=1 adds exactly one draw call');
      }
      if (mode === 2) {
        assert.equal(setup.diagnostics.enabled, true);
        assert.equal(setup.diagnostics.mode, 2);
        assert.equal(setup.diagnostics.samples, 2, '高清 profile requests 2x MSAA');
        assert.equal(setup.diagnostics.bloomMips, 4);
        assert.equal(setup.diagnostics.passes, 5, '4 bloom mips + composite = 5 passes');
        assert.ok(setup.stats.textures > postResults[0].stats.textures, 'bloom chain allocates render targets');
      }
      postResults[mode] = {...setup, screenshot};
      report.post.push({
        mode,
        diagnostics: setup.diagnostics,
        stats: setup.stats,
        pixels: setup.pixels,
        screenshot: screenshotName,
        bytes: screenshot.bytes,
      });
    }
    // Bloom budget: the whole post chain above the direct path must stay small.
    const desktopExtraDraws = postResults[2].stats.calls - postResults[0].stats.calls;
    report.budget.desktop = {extraDraws: desktopExtraDraws, limit: 14, quality: postResults[2].diagnostics};
    assert.ok(desktopExtraDraws > 0, 'post=2 must add draw calls');
    assert.ok(desktopExtraDraws <= 14, `高清 bloom chain added ${desktopExtraDraws} draw calls (limit 14)`);
    const relativeExposureDrift = Math.abs(postResults[1].pixels.mean - postResults[0].pixels.mean) / postResults[0].pixels.mean;
    assert.ok(relativeExposureDrift < 0.2, `post=1 grading changed mean luminance by ${(relativeExposureDrift * 100).toFixed(1)}%`);
    assert.ok(postResults[2].pixels.mean > postResults[1].pixels.mean, 'bloom must add light on top of the graded composite');
    assert.ok(Math.abs(postResults[1].pixels.mean - postResults[0].pixels.mean) > 0.2, 'post=1 grading must visibly change the frame');

    // --------------------------------------------------- resize / dispose
    const resized = await page.evaluate(() => {
      const before = window.__pfx.renderFrames(1).stats;
      const texturesBefore = before.textures;
      const first = window.__pfx.resize(960, 600, 1);
      const texturesAfterResize = first.stats.textures;
      // Same-size resize must be a no-op on render targets.
      const second = window.__pfx.resize(960, 600, 1);
      const texturesAfterSame = second.stats.textures;
      window.__pfx.resize(1280, 800, 1);
      return {
        before: first.stats,
        sameSize: second.stats,
        diagnostics: second.diagnostics,
        texturesBefore,
        texturesAfterResize,
        texturesAfterSame,
      };
    });
    assert.equal(resized.diagnostics.width, 960);
    assert.equal(resized.diagnostics.height, 600);
    assert.equal(resized.texturesAfterResize, resized.texturesBefore, 'resize must not leak render-target textures');
    assert.equal(resized.texturesAfterSame, resized.texturesAfterResize, 'same-size resize must be idempotent');
    assertPixels('resized', await page.evaluate(() => window.__pfx.measure()));
    report.resize = resized;

    const disposed = await page.evaluate(() => window.__pfx.disposeCheck());
    assert.equal(disposed.enabled, false);
    assert.ok(disposed.texturesAfter < disposed.texturesBefore, 'dispose must release render-target textures');
    assert.equal(disposed.diagnostics.passes, 0);
    report.dispose = disposed;

    const recreated = await page.evaluate(() => window.__pfx.recreate());
    const recreatedShot = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(resolve));
      return window.__pfx.measure();
    });
    assert.equal(recreated.diagnostics.enabled, true, 'a disposed pipeline can be replaced by a new one');
    assert.equal(recreated.diagnostics.mode, 2);
    assertPixels('recreated pipeline', recreated.pixels);
    assertPixels('recreated pipeline next frame', recreatedShot);
    await page.screenshot({path: path.join(output, 'postfx-recreated.png')});
    report.recreate = {
      diagnostics: recreated.diagnostics,
      stats: recreated.stats,
      pixels: recreated.pixels,
      screenshot: assertScreenshot('postfx-recreated.png'),
    };

    const timing = await page.evaluate(() => window.__pfx.timingCheck());
    assert.ok(timing.direct.cpuMsPerFrame > 0);
    assert.ok(timing.bloom.cpuMsPerFrame > 0);
    report.timing = timing;

    const allocation = await page.evaluate(() => window.__pfx.allocationCheck());
    assert.equal(allocation.after.textures, allocation.before.textures, 'textures must stay constant across 90 rendered frames');
    assert.equal(allocation.after.geometries, allocation.before.geometries, 'geometries must stay constant across 90 rendered frames');
    assert.equal(allocation.after.calls, allocation.before.calls, 'draw calls must stay constant across 90 rendered frames');
    assert.equal(allocation.after.triangles, allocation.before.triangles, 'triangles must stay constant across 90 rendered frames');
    report.allocation = allocation;

    const style = await page.evaluate(() => window.__pfx.styleCheck());
    assert.equal(style.clamped.exposure, 3, 'exposure clamps to 3');
    assert.equal(style.clamped.bloom, 0, 'bloom clamps to 0');
    assert.equal(style.clamped.vignette, 1, 'vignette clamps to 1');
    assert.equal(style.clamped.temperature, -1, 'temperature clamps to -1');
    assert.ok(style.movingSpeed > 0.05, 'speed blur ramps up while moving');
    assert.equal(style.frozenSpeed, 0, 'reduced motion disables the speed effect');
    report.style = style;

    // --------------------------------------------------------- sky themes
    for (const id of ['coast', 'canyon', 'neon', 'arcade']) {
      const result = await page.evaluate(skyId => window.__pfx.showSky(skyId), id);
      const screenshotName = `sky-${id}.png`;
      await page.screenshot({path: path.join(output, screenshotName)});
      const screenshot = assertScreenshot(screenshotName);
      assertPixels(`sky ${id}`, result.pixels);
      assert.ok(result.skyDrawCalls >= 2 && result.skyDrawCalls <= 4, `sky ${id} rendered ${result.skyDrawCalls} draw calls (limit 4)`);
      assert.equal(result.drawCallsDeclared, result.skyDrawCalls, `sky ${id} declared draw calls match`);
      assert.ok(result.retainedTextures >= 1, `sky ${id} reports retained cloud textures`);
      assert.ok(result.textureReused, `sky ${id} reuses the cached cloud texture across instances`);
      assert.ok(result.envTexture, `sky ${id} produced a PMREM environment texture`);
      result.screenshot = screenshotName;
      report.sky.push(result);
    }
    const skies = report.sky;
    const daySky = skies.filter(sky => !sky.preset.night);
    const nightSky = skies.filter(sky => sky.preset.night);
    assert.equal(daySky.length, 2, 'coast/canyon are day themes');
    assert.equal(nightSky.length, 2, 'neon/arcade are night themes');
    for (const day of daySky) {
      for (const night of nightSky) {
        assert.ok(night.pixels.mean < day.pixels.mean, `${night.preset.id} sky must be darker than ${day.preset.id} sky`);
      }
    }
    for (const night of nightSky) {
      assert.ok(night.pixels.skyP5 >= 3, `${night.preset.id} night sky is crushed (sky-region p5=${night.pixels.skyP5})`);
      assert.ok(night.pixels.skyMean >= 12, `${night.preset.id} night sky too dark (sky-region mean=${night.pixels.skyMean})`);
    }
    // PMREM bakes are one-per-track and released when the theme changes.
    const textureCounts = skies.map(sky => sky.textureCounts.afterRender);
    assert.ok(Math.max(...textureCounts) - Math.min(...textureCounts) <= 4, `environment bake texture count drifted: ${textureCounts.join(',')}`);
    report.budget.mobile = {pending: true};

    // ------------------------------------------------------------ mobile
    await page.setViewportSize(MOBILE);
    const mobile = await page.evaluate(() => window.__pfx.mobileBudget(390, 844, 2));
    assert.equal(mobile.mode2.diagnostics.width, 780);
    assert.equal(mobile.mode2.diagnostics.height, 1688);
    assert.ok(mobile.drawDelta <= 10, `mobile bloom chain added ${mobile.drawDelta} draw calls (limit 10)`);
    assertPixels('mobile post=2', mobile.mode2.pixels);
    await page.screenshot({path: path.join(output, 'postfx-mobile-post2.png')});
    const mobileShot = assertScreenshot('postfx-mobile-post2.png');
    report.budget.mobile = {
      extraDraws: mobile.drawDelta,
      limit: 10,
      mode0: mobile.mode0.stats,
      mode2: mobile.mode2.stats,
      diagnostics: mobile.mode2.diagnostics,
      pixels: mobile.mode2.pixels,
      screenshot: mobileShot,
    };
    await page.setViewportSize(DESKTOP);

    // ------------------------------------------------------------ cleanup
    await page.evaluate(() => window.__pfx.cleanup());
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
    assert.deepEqual(warnings, [], `console warnings: ${warnings.join(' | ')}`);
    report.ok = true;
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      ok: true,
      webgl: report.webgl,
      post: report.post.map(entry => ({
        mode: entry.mode,
        passes: entry.diagnostics.passes,
        samples: entry.diagnostics.samples,
        bloomMips: entry.diagnostics.bloomMips,
        hdr: entry.diagnostics.hdr,
        calls: entry.stats.calls,
        cpuMs: entry.stats.cpuMs,
        textures: entry.stats.textures,
        mean: entry.pixels.mean,
        screenshot: entry.screenshot,
      })),
      budget: {
        desktopExtraDraws,
        mobileExtraDraws: report.budget.mobile.extraDraws,
      },
      timing: report.timing,
      allocation: report.allocation,
      sky: report.sky.map(entry => ({
        id: entry.preset.id,
        night: entry.preset.night,
        drawCalls: entry.skyDrawCalls,
        retainedTextures: entry.retainedTextures,
        mean: entry.pixels.mean,
        screenshot: entry.screenshot,
      })),
      style: report.style,
      resize: {width: resized.diagnostics.width, height: resized.diagnostics.height, textures: resized.texturesAfterResize},
      dispose: {texturesBefore: disposed.texturesBefore, texturesAfter: disposed.texturesAfter},
      errors,
      warnings,
      report: REPORT_PATH,
    }, null, 2));
  } finally {
    if (!report.ok) {
      report.errors = errors;
      report.warnings = warnings;
      try {
        fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
      } catch {}
    }
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
