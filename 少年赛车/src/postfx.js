// HDR post-processing pipeline for 少年赛车.
// THREE is injected by the caller (same pattern as src/light-show.js) so this
// module never imports the vendored build and stays addon-free. The chain is:
//   scene -> MSAA/HalfFloat HDR target -> bright pass (half res) -> mip bloom
//   -> single composite pass (ACES tone mapping + exposure + contrast +
//   saturation + temperature + vignette + grain + chromatic aberration +
//   speed-driven radial blur) -> screen.
// post=1 keeps the HDR target + composite only (no bloom); post=0 disables the
// pipeline and renders straight through the caller's renderer.
//
// Render budget: bloom adds `bloomMips + 1` full-screen draws (4 mips -> 5,
// 5 mips -> 6) plus the one scene draw into the HDR target. No allocation
// happens inside render()/update(); resize and dispose are idempotent.

const DEFAULT_STYLE = {
  exposure: 1.05,   // ACES exposure multiplier (matches renderer.toneMappingExposure semantics)
  bloom: 0.62,      // bloom mix
  threshold: 0.85,  // HDR luminance that starts blooming
  radius: 0.35,     // bloom spread (weights coarse mips more as radius grows)
  saturation: 1.05,
  contrast: 1.03,
  temperature: 0,   // -1 cool .. +1 warm
  vignette: 0.2,
  grain: 0.04,
  aberration: 0.35,
  speed: 0.5,       // radial-blur gain fed by update()'s speed01/boost01
};

const STYLE_RANGES = {
  exposure: [0.2, 3],
  bloom: [0, 2.5],
  threshold: [0, 4],
  radius: [0, 1],
  saturation: [0, 2],
  contrast: [0.5, 1.8],
  temperature: [-1, 1],
  vignette: [0, 1],
  grain: [0, 0.3],
  aberration: [0, 1],
  speed: [0, 1],
};

const STYLE_KEYS = Object.keys(STYLE_RANGES);

const clampNumber = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);
const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

// One quality profile -> the three knobs the pipeline cares about. Accepts a
// QUALITY_LEVELS entry, a bare {post,...} object, or nothing (direct render).
function normalizeQuality(quality) {
  const source = quality && typeof quality === 'object' ? quality : {};
  const post = Number.isFinite(source.post)
    ? clampNumber(Math.round(source.post), 0, 2)
    : Number.isFinite(source.level)
      ? (source.level >= 2 ? 2 : source.level >= 1 ? 1 : 0)
      : 0;
  const samples = [0, 2, 4].includes(source.postSamples)
    ? source.postSamples
    : [0, 2, 4].includes(source.samples)
      ? source.samples
      : 0;
  const bloomMips = post === 2
    ? clampNumber(Math.round(finiteOr(source.bloomMips, 4)), 1, 5)
    : 0;
  return {
    post,
    postSamples: post > 0 ? samples : 0,
    bloomMips,
    bloomStrength: clampNumber(finiteOr(source.bloomStrength, 0.62), 0, 2.5),
  };
}

const QUAD_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAGMENT = `
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;
varying vec2 vUv;

void main() {
  vec2 o = uTexel;
  vec3 c = texture2D(tScene, vUv + vec2(-0.5, -0.5) * o).rgb;
  c += texture2D(tScene, vUv + vec2(0.5, -0.5) * o).rgb;
  c += texture2D(tScene, vUv + vec2(-0.5, 0.5) * o).rgb;
  c += texture2D(tScene, vUv + vec2(0.5, 0.5) * o).rgb;
  c *= 0.25;

  // Soft-knee threshold: keeps mid-bright surfaces out of the glow and avoids
  // a hard popping edge around authored emissive strips.
  float luma = max(c.r, max(c.g, c.b));
  float soft = clamp(luma - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contribution = max(soft, luma - uThreshold) / max(luma, 1e-5);
  c = min(c * contribution, vec3(uClamp));
  gl_FragColor = vec4(c, 1.0);
}`;

const DOWN_FRAGMENT = `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;

void main() {
  vec2 t = uTexel;
  vec3 c = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * t).rgb;
  c += texture2D(tSrc, vUv + vec2(1.0, -1.0) * t).rgb;
  c += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * t).rgb;
  c += texture2D(tSrc, vUv + vec2(1.0, 1.0) * t).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const COMPOSITE_FRAGMENT = `
uniform sampler2D uScene;
uniform sampler2D uMips[5];
uniform float uBloomW[5];
uniform float uBloomMix;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uThreshold;
uniform float uSaturation;
uniform float uContrast;
uniform float uTemperature;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
uniform float uSpeed;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;

vec3 pfxRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

// Same fitted ACES curve three uses for ACESFilmicToneMapping, so switching
// post on/off does not shift the overall exposure response.
vec3 pfxACESFilmic(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 ACESOutputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  );
  color = ACESInputMat * color;
  color = pfxRRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}

float pfxHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 dir = uv - 0.5;
  float radius2 = dot(dir, dir);

  // Slight radial chromatic aberration (sorted per channel, cheap 3 taps).
  vec2 ab = dir * (uAberration * 0.006) * (0.35 + radius2 * 2.0);
  vec3 color = vec3(
    texture2D(uScene, uv + ab).r,
    texture2D(uScene, uv).g,
    texture2D(uScene, uv - ab).b
  );

  // Speed radial blur: 4 taps toward the frame center, zeroed by reduced
  // motion or low speed so the edges stay crisp while cruising.
  if (uSpeed > 0.001) {
    vec3 blur = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      float t = (float(i) + 0.5) * 0.25;
      vec2 offset = dir * radius2 * uSpeed * 0.09 * t;
      blur += texture2D(uScene, uv - offset).rgb;
    }
    blur *= 0.25;
    color = mix(color, blur, clamp(uSpeed * 1.25, 0.0, 0.9));
  }

  if (uBloomMix > 0.0001) {
    vec3 bloom = texture2D(uMips[0], uv).rgb * uBloomW[0];
    bloom += texture2D(uMips[1], uv).rgb * uBloomW[1];
    bloom += texture2D(uMips[2], uv).rgb * uBloomW[2];
    bloom += texture2D(uMips[3], uv).rgb * uBloomW[3];
    bloom += texture2D(uMips[4], uv).rgb * uBloomW[4];
    color += bloom * uBloomMix;
  }

  color *= uExposure / 0.6;
  color = pfxACESFilmic(color);

  // Grade in a perceptual (sqrt) space: a 0.5 contrast pivot in linear light
  // crushes dark night scenes, while display-referred grading behaves like a
  // LUT and keeps shadows readable.
  vec3 graded = sqrt(clamp(color, 0.0, 1.0));
  graded *= mix(vec3(0.94, 0.98, 1.07), vec3(1.07, 1.0, 0.92), uTemperature * 0.5 + 0.5);
  graded = (graded - 0.5) * uContrast + 0.5;
  float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
  graded = mix(vec3(luma), graded, uSaturation);

  // Vignette (aspect-corrected, outer frame only).
  vec2 vd = (uv - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(1.25, 0.45, length(vd) * 1.35);
  graded *= mix(1.0, vig, uVignette);

  // Fine grain, luminance-weighted so highlights stay clean.
  float noise = pfxHash12(uv * uResolution + uTime * 97.0) - 0.5;
  graded += noise * uGrain * (0.35 + 0.65 * max(luma, 0.0));

  color = graded * abs(graded);
  gl_FragColor = vec4(max(color, 0.0), 1.0);
  #include <colorspace_fragment>
}`;

export class PostPipeline {
  constructor(renderer, quality, THREE) {
    if (!renderer || !renderer.render) throw new Error('PostPipeline(renderer, quality, THREE) needs a WebGLRenderer');
    if (!THREE || !THREE.WebGLRenderTarget) throw new Error('PostPipeline(renderer, quality, THREE) needs the THREE namespace');
    this.renderer = renderer;
    this.THREE = THREE;

    this._quality = normalizeQuality(quality);
    this._mode = this._quality.post;
    this._samples = this._quality.postSamples;
    this._bloomMips = this._quality.bloomMips;
    this._bloomStrength = this._quality.bloomStrength;

    // HDR scene target when the GPU can render to half-float; otherwise the
    // whole chain still works on an 8-bit target with a slightly earlier
    // bright-pass threshold (bloom just has less headroom).
    let hdr = false;
    try {
      const extensions = renderer.extensions;
      const capabilities = renderer.capabilities || {};
      hdr = capabilities.isWebGL2 !== false && !!extensions
        && (extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float'));
    } catch {
      hdr = false;
    }
    this._hdr = hdr;
    this._hdrType = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.disposed = false;
    this._width = 0;
    this._height = 0;
    this._pixelRatio = 1;
    this._targetsReady = false;
    this._sceneTarget = null;
    this._mipTargets = [];
    this._mipCount = 0;

    this._style = { ...DEFAULT_STYLE };
    this._bloomWeights = [0, 0, 0, 0, 0];
    this._speed = 0;
    this._time = 0;
    this._reduced = false;
    this._drawingSize = new THREE.Vector2();

    // Full-screen triangle shared by every pass. One scene, one mesh, one
    // material swap per pass: exactly one draw call per pass and no per-frame
    // object churn.
    this._quadGeometry = new THREE.BufferGeometry();
    this._quadGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._passScene = new THREE.Scene();
    this._passScene.matrixWorldAutoUpdate = false;
    this._quad = new THREE.Mesh(this._quadGeometry, null);
    this._quad.frustumCulled = false;
    this._quad.matrixAutoUpdate = false;
    this._quad.matrixWorldAutoUpdate = false;
    this._passScene.add(this._quad);

    const basePass = {
      vertexShader: QUAD_VERTEX,
      // These passes do their own tone mapping (or write linear HDR), so three
      // must not inject the tonemapping shader chunks here.
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      transparent: false,
    };
    this._brightMaterial = new THREE.ShaderMaterial({
      ...basePass,
      uniforms: {
        tScene: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: this._style.threshold },
        uKnee: { value: 0.35 },
        uClamp: { value: 24 },
      },
      fragmentShader: BRIGHT_FRAGMENT,
    });
    this._downMaterial = new THREE.ShaderMaterial({
      ...basePass,
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
      },
      fragmentShader: DOWN_FRAGMENT,
    });
    this._compositeMaterial = new THREE.ShaderMaterial({
      ...basePass,
      uniforms: {
        uScene: { value: null },
        uMips: { value: [null, null, null, null, null] },
        uBloomW: { value: this._bloomWeights },
        uBloomMix: { value: 1 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uExposure: { value: this._style.exposure },
        uThreshold: { value: this._style.threshold },
        uSaturation: { value: this._style.saturation },
        uContrast: { value: this._style.contrast },
        uTemperature: { value: this._style.temperature },
        uVignette: { value: this._style.vignette },
        uGrain: { value: this._style.grain },
        uAberration: { value: this._style.aberration },
        uSpeed: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
      },
      fragmentShader: COMPOSITE_FRAGMENT,
    });

    // 1x1 black stand-in keeps all five sampler slots valid when bloom is off.
    const black = new Uint8Array([0, 0, 0, 255]);
    this._blackTexture = new THREE.DataTexture(black, 1, 1, THREE.RGBAFormat);
    this._blackTexture.needsUpdate = true;

    this._applyStyle();
  }

  get enabled() {
    return !this.disposed && this._mode > 0;
  }

  get mode() {
    return this._mode;
  }

  get quality() {
    return this._quality;
  }

  configure(quality) {
    if (this.disposed) return this;
    const next = normalizeQuality(quality);
    const rebuild = next.post !== this._mode
      || next.postSamples !== this._samples
      || next.bloomMips !== this._bloomMips;
    this._quality = next;
    this._mode = next.post;
    this._samples = next.postSamples;
    this._bloomMips = next.bloomMips;
    this._bloomStrength = next.bloomStrength;
    if (rebuild) {
      if (this._mode === 0) this._disposeTargets();
      else if (this._width > 0 && this._height > 0) {
        try {
          this._buildTargets();
        } catch {
          this._disposeTargets();
        }
      }
    }
    this._applyStyle();
    return this;
  }

  setSize(cssWidth, cssHeight, pixelRatio) {
    if (this.disposed) return this;
    const ratio = finiteOr(pixelRatio, 1) > 0 ? finiteOr(pixelRatio, 1) : 1;
    const width = Math.max(1, Math.round(finiteOr(cssWidth, 1) * ratio));
    const height = Math.max(1, Math.round(finiteOr(cssHeight, 1) * ratio));
    if (width === this._width && height === this._height) {
      this._pixelRatio = ratio;
      return this;
    }
    // Respect the GPU limit without silently changing the caller's canvas.
    let scale = 1;
    try {
      const max = (this.renderer.capabilities && this.renderer.capabilities.maxTextureSize) || 4096;
      scale = Math.min(1, max / Math.max(width, height));
    } catch {
      scale = 1;
    }
    this._width = Math.max(1, Math.floor(width * scale));
    this._height = Math.max(1, Math.floor(height * scale));
    this._pixelRatio = ratio;
    if (this._mode > 0) {
      try {
        this._buildTargets();
      } catch {
        this._disposeTargets();
      }
    }
    return this;
  }

  setStyle(style) {
    if (this.disposed || !style || typeof style !== 'object') return this;
    for (let i = 0; i < STYLE_KEYS.length; i++) {
      const key = STYLE_KEYS[i];
      const value = Number(style[key]);
      if (!Number.isFinite(value)) continue;
      const range = STYLE_RANGES[key];
      this._style[key] = clampNumber(value, range[0], range[1]);
    }
    this._applyStyle();
    return this;
  }

  // dt in seconds; frame = {speed01, boost01, reducedMotion}. All smoothing is
  // exponential and allocation-free.
  update(dt, frame) {
    if (this.disposed) return this;
    const step = clampNumber(finiteOr(dt, 0), 0, 0.1);
    const data = frame && typeof frame === 'object' ? frame : null;
    this._reduced = !!(data && data.reducedMotion);
    const speed01 = clampNumber(finiteOr(data && data.speed01, 0), 0, 1);
    const boost01 = clampNumber(finiteOr(data && data.boost01, 0), 0, 1);
    const target = this._reduced
      ? 0
      : Math.min(1, this._style.speed * Math.max(speed01 * 0.85, boost01));
    const rate = 1 - Math.exp(-step * (target > this._speed ? 7 : 9));
    this._speed += (target - this._speed) * rate;
    if (this._speed < 0.0005) this._speed = 0;
    if (!this._reduced) this._time += step;

    const uniforms = this._compositeMaterial.uniforms;
    uniforms.uSpeed.value = this._speed;
    uniforms.uTime.value = this._time;
    uniforms.uGrain.value = this._reduced ? this._style.grain * 0.6 : this._style.grain;
    return this;
  }

  render(scene, camera) {
    const renderer = this.renderer;
    if (!renderer) return;
    if (this.disposed || this._mode === 0 || !scene || !camera) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    if (!this._ensureTargets()) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const info = renderer.info;
    const previousAutoReset = info ? info.autoReset : undefined;
    // Accumulate every pass of this frame into info.render.calls so the game's
    // renderer diagnostics report the true frame cost.
    if (info) {
      info.autoReset = false;
      info.reset();
    }
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(this._sceneTarget);
      renderer.render(scene, camera);

      if (this._mode === 2) {
        this._brightMaterial.uniforms.tScene.value = this._sceneTarget.texture;
        this._draw(this._brightMaterial, this._mipTargets[0]);
        for (let i = 1; i < this._mipCount; i++) {
          const source = this._mipTargets[i - 1];
          this._downMaterial.uniforms.tSrc.value = source.texture;
          this._downMaterial.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
          this._draw(this._downMaterial, this._mipTargets[i]);
        }
      }

      this._draw(this._compositeMaterial, null);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
      if (info) info.autoReset = previousAutoReset;
    }
  }

  get diagnostics() {
    const mode = this._mode;
    return {
      enabled: !this.disposed && mode > 0,
      mode,
      passes: this.disposed || mode === 0 ? 0 : mode === 1 ? 1 : this._mipCount + 1,
      samples: mode > 0 ? this._samples : 0,
      bloomMips: mode === 2 ? this._mipCount : 0,
      width: this._width,
      height: this._height,
      style: { ...this._style },
      hdr: this._hdr ? 'half-float' : 'unsigned-byte',
      pixelRatio: this._pixelRatio,
      speed: Math.round(this._speed * 1000) / 1000,
      reducedMotion: this._reduced,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._disposeTargets();
    if (this._blackTexture) {
      this._blackTexture.dispose();
      this._blackTexture = null;
    }
    if (this._brightMaterial) this._brightMaterial.dispose();
    if (this._downMaterial) this._downMaterial.dispose();
    if (this._compositeMaterial) this._compositeMaterial.dispose();
    if (this._quadGeometry) this._quadGeometry.dispose();
    if (this._passScene) {
      this._passScene.remove(this._quad);
      this._passScene.clear();
    }
    this._passScene = null;
    this._quad = null;
  }

  // --- internals -----------------------------------------------------------

  _applyStyle() {
    const style = this._style;
    const uniforms = this._compositeMaterial.uniforms;
    uniforms.uExposure.value = style.exposure;
    uniforms.uSaturation.value = style.saturation;
    uniforms.uContrast.value = style.contrast;
    uniforms.uTemperature.value = style.temperature;
    uniforms.uVignette.value = style.vignette;
    uniforms.uGrain.value = this._reduced ? style.grain * 0.6 : style.grain;
    uniforms.uAberration.value = style.aberration;
    this._brightMaterial.uniforms.uThreshold.value = style.threshold;
    this._refreshBloomWeights();
    this._updateBloomMix();
  }

  _refreshBloomWeights() {
    const falloff = 1 - 0.45 * this._style.radius;
    const weights = this._bloomWeights;
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      const weight = i < this._mipCount ? Math.pow(falloff, i) : 0;
      weights[i] = weight;
      sum += weight;
    }
    if (sum > 0) {
      for (let i = 0; i < 5; i++) weights[i] /= sum;
    }
  }

  _updateBloomMix() {
    const mix = this._mode === 2 ? this._style.bloom * this._bloomStrength : 0;
    this._compositeMaterial.uniforms.uBloomMix.value = clampNumber(mix, 0, 2.5);
  }

  _ensureTargets() {
    if (this._targetsReady) return true;
    if (this._mode === 0) return false;
    if (this._width < 1 || this._height < 1) {
      try {
        this.renderer.getDrawingBufferSize(this._drawingSize);
        this._width = Math.max(1, Math.floor(this._drawingSize.x));
        this._height = Math.max(1, Math.floor(this._drawingSize.y));
        this._pixelRatio = this.renderer.getPixelRatio();
      } catch {
        this._width = 1;
        this._height = 1;
      }
    }
    try {
      this._buildTargets();
    } catch {
      this._disposeTargets();
    }
    return this._targetsReady;
  }

  _buildTargets() {
    const THREE = this.THREE;
    this._disposeTargets();
    if (this._mode === 0) return;
    try {
      this._sceneTarget = this._createTarget(this._width, this._height, true, this._samples, 'postfx-scene');
      if (this._mode === 2) {
        const count = this._bloomMips;
        let width = Math.max(1, Math.floor(this._width / 2));
        let height = Math.max(1, Math.floor(this._height / 2));
        for (let i = 0; i < count; i++) {
          this._mipTargets.push(this._createTarget(width, height, false, 0, `postfx-bloom-${i}`));
          width = Math.max(1, Math.floor(width / 2));
          height = Math.max(1, Math.floor(height / 2));
        }
        this._mipCount = this._mipTargets.length;
      } else {
        this._mipCount = 0;
      }

      const composite = this._compositeMaterial.uniforms;
      composite.uScene.value = this._sceneTarget.texture;
      composite.uResolution.value.set(this._width, this._height);
      composite.uAspect.value = this._width / this._height;
      for (let i = 0; i < 5; i++) {
        composite.uMips.value[i] = i < this._mipCount ? this._mipTargets[i].texture : this._blackTexture;
      }
      this._brightMaterial.uniforms.tScene.value = this._sceneTarget.texture;
      this._brightMaterial.uniforms.uTexel.value.set(1 / this._width, 1 / this._height);
      this._refreshBloomWeights();
      this._targetsReady = true;
    } catch (error) {
      this._disposeTargets();
      throw error;
    }
  }

  _createTarget(width, height, depth, samples, name) {
    const THREE = this.THREE;
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: this._hdrType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: depth,
      stencilBuffer: false,
      samples: depth ? samples : 0,
      generateMipmaps: false,
    });
    target.texture.generateMipmaps = false;
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
    target.texture.name = name;
    return target;
  }

  _disposeTargets() {
    if (this._sceneTarget) {
      this._sceneTarget.dispose();
      this._sceneTarget = null;
    }
    for (let i = 0; i < this._mipTargets.length; i++) this._mipTargets[i].dispose();
    this._mipTargets.length = 0;
    this._mipCount = 0;
    this._targetsReady = false;
  }

  _draw(material, target) {
    const renderer = this.renderer;
    this._quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this._passScene, this._quadCamera);
  }
}

export { DEFAULT_STYLE as POSTFX_STYLE_DEFAULTS };
