import * as THREE from 'three';
import { Sky as SkyShader } from 'three/examples/jsm/objects/Sky.js';
import { clamp, lerp, smooth } from '../core/util';
import type { QualityProfile } from '../core/settings';

const DAY_FOG = new THREE.Color(0.62, 0.6, 0.58);
const DUSK_FOG = new THREE.Color(0.55, 0.38, 0.28);
const NIGHT_FOG = new THREE.Color(0.025, 0.03, 0.05);

/** Late-afternoon sun that sets during the match, then night with moonlight. */
export class Sky {
  sky: SkyShader;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  sunDir = new THREE.Vector3();
  elevation = 14;
  night = 0;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky: SkyShader;
  private lastEnvElev = 999;
  private envRT?: THREE.WebGLRenderTarget;
  stars: THREE.Points;
  fogColor = new THREE.Color();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, q: QualityProfile) {
    this.sky = new SkyShader();
    this.sky.scale.setScalar(4000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.86;
    scene.add(this.sky);

    this.envSky = new SkyShader();
    this.envSky.scale.setScalar(1000);
    Object.assign(this.envSky.material.uniforms.turbidity, { value: 6 });
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a3f35, 0.8);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(DAY_FOG.getHex(), 0.0045);
    scene.fog = this.fog;

    // stars
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.9 + 0.1; v.normalize().multiplyScalar(1500);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
  }

  /** progress: 0 (start of match, ~16h30) -> 1 (end of match, night) */
  update(progress: number, focus: THREE.Vector3) {
    this.elevation = lerp(13, -11, clamp(progress, 0, 1));
    const azimuth = 238; // sun in the south-west
    const phi = THREE.MathUtils.degToRad(90 - this.elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.night = smooth(clamp((3 - this.elevation) / 10, 0, 1));
    const dusk = smooth(clamp(1 - Math.abs(this.elevation - 2) / 10, 0, 1));

    // sun -> moon
    const moon = this.night > 0.7;
    const lightDir = moon ? new THREE.Vector3(0.3, 0.8, 0.4).normalize() : this.sunDir.clone().setY(Math.max(this.sunDir.y, 0.06)).normalize();
    this.sun.position.copy(focus).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(focus);
    const sunCol = new THREE.Color(1, 0.93, 0.82).lerp(new THREE.Color(1, 0.55, 0.3), dusk);
    if (moon) { this.sun.color.setRGB(0.55, 0.65, 0.95); this.sun.intensity = 0.25; }
    else { this.sun.color.copy(sunCol); this.sun.intensity = lerp(2.8, 0.15, this.night) * (1 - dusk * 0.25); }
    this.hemi.intensity = lerp(0.9, 0.12, this.night);
    this.hemi.color.setRGB(lerp(0.75, 0.25, this.night), lerp(0.82, 0.3, this.night), lerp(1, 0.55, this.night));
    this.hemi.groundColor.setRGB(lerp(0.3, 0.05, this.night), lerp(0.25, 0.04, this.night), lerp(0.2, 0.04, this.night));

    this.fogColor.copy(DAY_FOG).lerp(DUSK_FOG, dusk * (1 - this.night)).lerp(NIGHT_FOG, this.night);
    this.fog.color.copy(this.fogColor);
    this.fog.density = lerp(0.0045, 0.0065, this.night);
    (this.stars.material as THREE.PointsMaterial).opacity = this.night * 0.8;
    this.renderer.toneMappingExposure = lerp(0.62, 0.9, this.night);

    if (Math.abs(this.elevation - this.lastEnvElev) > 1.2) {
      this.lastEnvElev = this.elevation;
      this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
      const prev = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene as any, 0, 0.1, 2000);
      this.scene.environment = this.envRT.texture;
      prev?.dispose();
    }
    this.scene.environmentIntensity = lerp(0.85, 0.15, this.night);
  }
}
