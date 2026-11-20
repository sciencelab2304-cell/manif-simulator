import * as THREE from 'three';
import type { Camp } from '../core/context';
import { withSeed } from '../core/util';
import { BodyRenderer, applyPose, neutralPose, NPARTS, ACC } from '../npc/body';
import { makeLook } from '../npc/npc';
import { dress, type LookSpec, type Gear } from '../meta/shop';

/**
 * The player's character turning slowly beside the shop, wearing the equipped (or tried) skins.
 * It has its own small renderer and only draws while its canvas is on screen.
 */
let view: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; bodies: BodyRenderer } | null = null;
let look = makeLook('pacifist', 'none');
let yaw = 0.5, drag: number | null = null, running = false;

function setup(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3040, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.set(0, 1.15, 4.6); camera.lookAt(0, 0.92, 0);
  canvas.onpointerdown = (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = (e) => { if (drag === null) return; yaw += (e.clientX - drag) * 0.012; drag = e.clientX; };
  canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };
  return { renderer, scene, camera, bodies: new BodyRenderer(scene, 1, false) };
}

/** Shows `camp`'s character dressed with `spec` (and the weapon colour of `gear` for the police). */
export function showPreview(canvas: HTMLCanvasElement, camp: Camp, spec: LookSpec, gear: Gear) {
  view ??= setup(canvas);
  look = withSeed(camp === 'police' ? 7 : 3, () => makeLook(camp === 'police' ? 'crs' : 'pacifist', camp === 'police' ? 'lbd' : 'none'));
  if (camp === 'protest') { look.acc_on[ACC.pack] = look.acc_on[ACC.flag] = false; look.acc_on[ACC.hair] = true; look.size = 1; }
  dress(look, spec);
  if (gear.metal !== undefined) look.acc[ACC.gun].setHex(gear.metal);
  if (!running) { running = true; requestAnimationFrame(frame); }
}

const mats = Array.from({ length: NPARTS }, () => new THREE.Matrix4());
const base = new THREE.Matrix4(), pose = neutralPose();
let last = 0;
function frame(t: number) {
  const v = view!, canvas = v.renderer.domElement;
  if (!canvas.offsetParent) { running = false; return; } // shop closed
  const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
  if (drag === null) yaw += dt * 0.5;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * v.renderer.getPixelRatio()) || canvas.height !== Math.round(h * v.renderer.getPixelRatio())) {
    v.renderer.setSize(w, h, false); v.camera.aspect = w / h; v.camera.updateProjectionMatrix();
  }
  base.makeRotationY(yaw).scale(new THREE.Vector3(look.size, look.size, look.size));
  applyPose(base, pose, mats);
  v.bodies.begin(); v.bodies.add(mats, look, 0); v.bodies.end();
  v.renderer.render(v.scene, v.camera);
  requestAnimationFrame(frame);
}
