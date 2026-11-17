import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { QualityProfile } from '../core/settings';

const FX = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    res: { value: new THREE.Vector2(1, 1) },
    grain: { value: 0.06 },
    aberration: { value: 0.0015 },
    vignette: { value: 0.35 },
    damage: { value: 0 }, // red pulse
    lowHp: { value: 0 },
    blur: { value: 0 }, // 0..1
    tears: { value: 0 }, // 0..1 gas
    motion: { value: new THREE.Vector2() },
    flash: { value: 0 },
    eyeLoss: { value: 0 },
    wet: { value: 0 },
    blackout: { value: 0 },
    visor: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, grain, aberration, vignette, damage, lowHp, blur, tears, flash, eyeLoss, wet, blackout, visor;
    uniform vec2 res, motion;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 sampleAb(vec2 uv, float ab) {
      vec2 d = (uv - 0.5) * ab;
      return vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
    }
    void main() {
      vec2 uv = vUv;
      // gas tears: wobbly refraction
      if (tears > 0.0) {
        uv += vec2(sin(uv.y * 30.0 + time * 3.0), cos(uv.x * 24.0 + time * 2.3)) * 0.004 * tears;
      }
      // water on the lens
      if (wet > 0.0) {
        vec2 cell = floor(uv * vec2(18.0, 10.0));
        float h = hash(cell);
        vec2 f = fract(uv * vec2(18.0, 10.0)) - 0.5;
        float drop = smoothstep(0.35, 0.0, length(f)) * step(0.55, h);
        uv += f * drop * 0.03 * wet;
      }
      float ab = aberration + damage * 0.012 + tears * 0.006 + flash * 0.01;
      vec3 col = sampleAb(uv, ab * 1.5);
      // motion blur along camera rotation + generic blur
      float mb = length(motion);
      if (mb > 0.0005 || blur > 0.01) {
        vec3 acc = col; float wsum = 1.0;
        for (int i = 1; i <= 6; i++) {
          float t = float(i) / 6.0;
          vec2 o = motion * (t - 0.5) * 2.0;
          vec2 r = vec2(cos(float(i) * 2.4), sin(float(i) * 2.4)) * blur * 0.012 * t;
          acc += texture2D(tDiffuse, uv + o + r).rgb; wsum += 1.0;
        }
        col = acc / wsum;
      }
      // tears: milky white veil
      col = mix(col, vec3(0.92, 0.94, 0.9), tears * 0.35 * (0.6 + 0.4 * sin(time * 1.7)));
      // damage tint
      float edge = length(uv - 0.5) * 1.4;
      col = mix(col, vec3(0.55, 0.0, 0.0), clamp(damage * 0.55 + lowHp * edge * edge * (0.65 + 0.35 * sin(time * 6.0)), 0.0, 0.85));
      // desaturate when low hp
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), lowHp * 0.6);
      // eye injury: one eye closed/blurry
      if (eyeLoss > 0.0) {
        float m = smoothstep(0.32, 0.5, 1.0 - uv.x);
        col = mix(col, col * 0.06 + vec3(0.06, 0.0, 0.0), m * eyeLoss);
      }
      // vignette
      col *= 1.0 - vignette * smoothstep(0.35, 0.95, length((uv - 0.5) * vec2(res.x / res.y, 1.0)) * 0.9);
      // visor (CRS helmet): slight tint, edges and scratches
      if (visor > 0.0) {
        vec2 c = (uv - 0.5) * vec2(res.x / res.y, 1.0);
        float frame = smoothstep(0.78, 0.92, length(c * vec2(0.85, 1.25)));
        col = mix(col * vec3(0.93, 0.97, 1.0), vec3(0.02), frame * visor);
        float scratch = step(0.9985, hash(floor(uv * vec2(300.0, 2.0)))) * 0.05;
        col += scratch * visor;
        col += vec3(0.02, 0.025, 0.03) * visor * (1.0 - uv.y);
      }
      // flash bang
      col = mix(col, vec3(1.0, 0.98, 0.92), clamp(flash, 0.0, 1.0));
      // film grain
      col += (hash(uv * res + fract(time) * 100.0) - 0.5) * grain;
      col *= 1.0 - blackout;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  composer: EffectComposer;
  bloom?: UnrealBloomPass;
  fx: ShaderPass;
  u: typeof FX.uniforms;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, q: QualityProfile) {
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: q.post ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.6, 0.9);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.fx = new ShaderPass(FX);
    this.u = this.fx.uniforms as any;
    this.u.grain.value = q.post ? 0.05 : 0.03;
    this.u.aberration.value = q.post ? 0.0012 : 0;
    this.composer.addPass(this.fx);
    this.motionEnabled = q.motionBlur;
  }
  motionEnabled = false;

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.u.res.value.set(w, h);
  }

  render(dt: number) {
    this.u.time.value += dt;
    if (!this.motionEnabled) this.u.motion.value.set(0, 0);
    this.composer.render(dt);
  }
}
