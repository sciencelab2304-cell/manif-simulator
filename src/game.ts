import * as THREE from 'three';
import { ctx, newStats, type Camp } from './core/context';
import { Physics } from './core/physics';
import type { Input } from './core/input';
import { profile, saveSettings, type Settings } from './core/settings';
import type { AudioEngine } from './audio/audio';
import { Particles } from './fx/particles';
import { Decals } from './fx/decals';
import { LightPool } from './fx/lights';
import { Post } from './fx/post';
import { City } from './world/city';
import { Sky } from './world/sky';
import { Destruction } from './destruction/destruction';
import { Crowd } from './npc/crowd';
import { Player } from './player/player';
import { Projectiles, type Projectile } from './weapons/projectiles';
import { GasSystem } from './weapons/gas';
import { Pickups } from './weapons/pickups';
import { Tension } from './tension/tension';
import { Hud, woundSvg } from './ui/hud';
import { HealthBars } from './ui/bars';
import { WaterCannon } from './vehicles/watercannon';
import * as L from './world/layout';
import { clamp } from './core/util';
import type { Net } from './net/net';
import { Avatar } from './net/avatar';
import { Sync } from './net/sync';
import { act } from './net/actions';

const $ = (id: string) => document.getElementById(id)!;

/** Where the k-th human of a camp starts (police players take slots in the front row of the line). */
const POLICE_SLOTS = [0.6, -0.6, 1.8, -1.8, 3, -3, 4.2, -4.2];
function spawnPoint(camp: Camp, k: number) {
  return camp === 'police' ? new THREE.Vector3(POLICE_SLOTS[k], 0, L.CRS_LINE_Z) : new THREE.Vector3(1.5 + (k % 4) * 1.3, 0, 30 + Math.floor(k / 4) * 1.6);
}

const CONTROLS: Record<Camp, [string, string][]> = {
  protest: [
    ['Z Q S D / W A S D', 'se déplacer'], ['Maj', 'courir'], ['Espace', 'sauter'], ['C', 's\'accroupir'],
    ['Clic gauche (maintenir)', 'lancer tendu'], ['Clic droit (maintenir)', 'lancer en cloche'], ['Molette / 1-8', 'choisir l\'objet'],
    ['E', 'ramasser / dépaver / renvoyer une lacrymo'], ['F', 'barricade / mettre le feu'], ['X', 'bouclier de fortune'],
    ['M', 'masque'], ['K', 'sérum physiologique'], ['H', 'appeler un street medic'], ['I', 'slogan / insulte (+ tension)'], ['Échap', 'pause'],
  ],
  police: [
    ['Z Q S D / W A S D', 'se déplacer'], ['Maj', 'courir'], ['1 2 3 4', 'LBD · lacrymo · désencerclement · matraque'],
    ['Clic gauche', 'tirer / lancer / frapper'], ['Clic droit', 'viser (LBD) / lever le bouclier'], ['R', 'recharger le LBD'],
    ['P', 'vue 1re / 3e personne'], ['G', 'CHARGE de la ligne'], ['T', 'la ligne avance'], ['V', 'tenir la ligne'], ['F', 'menotter un manifestant affaibli (2 s)'],
    ['E', 'canon à eau (monter / descendre)'], ['M', 'masque à gaz'], ['H', 'trousse de secours'], ['Échap', 'pause'],
  ],
};

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  last = performance.now();
  paused = false;
  running = false;
  heli = new THREE.Group();
  heliRotor = new THREE.Mesh();
  heliSpot: THREE.SpotLight;
  private sirenIds: number[] = [];
  /** adaptive resolution: fraction of the profile's pixel ratio, tuned from the measured frame rate */
  resScale = 1;
  adaptive = true;
  private fpsAcc = 0; private fpsN = 0;
  private spawn: THREE.Vector3;
  private sync: Sync;
  private bars: HealthBars;
  /** police win by handcuffing this many protesters (more with more CRS players) */
  arrestGoal: number;

  constructor(public camp: Camp, settings: Settings, input: Input, audio: AudioEngine, net: Net) {
    const q = profile(settings.quality);
    this.renderer = new THREE.WebGLRenderer({ antialias: !q.post, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('app').appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 2500);
    this.scene.add(this.camera);

    Object.assign(ctx, {
      scene: this.scene, camera: this.camera, renderer: this.renderer, settings, q, input, audio, camp,
      stats: newStats(), time: 0, night: 0, over: false, wind: new THREE.Vector3(1.1, 0, 0.5), game: this, net,
    });
    ctx.physics = new Physics();
    ctx.particles = new Particles(this.scene, q.particleScale);
    ctx.particles.blood = settings.blood;
    ctx.particles.resize(window.innerHeight * this.renderer.getPixelRatio(), settings.fov);
    ctx.decals = new Decals(this.scene);
    ctx.decals.blood = settings.blood;
    ctx.lights = new LightPool(this.scene, q.pointLights);
    ctx.post = new Post(this.renderer, this.scene, this.camera, q);
    ctx.post.setSize(window.innerWidth, window.innerHeight);
    ctx.sky = new Sky(this.scene, this.renderer, q);
    ctx.tension = new Tension();
    ctx.hud = new Hud();
    $('wounds').innerHTML = woundSvg();
    ctx.gas = new GasSystem();
    ctx.destruction = new Destruction();
    ctx.city = new City();
    ctx.city.build();
    ctx.destruction.finalizeWindows();
    ctx.projectiles = new Projectiles();
    ctx.pickups = new Pickups();
    ctx.pickups.build();
    ctx.truck = new WaterCannon();
    ctx.crowd = new Crowd();
    // human players: everyone in the lobby, or just you
    const members = net.multi ? net.members : [{ id: net.me, name: 'Vous', camp }];
    const spawns = members.map((m) => spawnPoint(m.camp, members.filter((o) => o.camp === m.camp).indexOf(m)));
    this.spawn = spawns[members.findIndex((m) => m.id === net.me)];
    this.arrestGoal = 6 + 4 * Math.max(1, members.filter((m) => m.camp === 'police').length);
    ctx.player = new Player(this.spawn);
    if (!net.isClient) {
      // the host (or solo game) owns the world; clients receive it from the host
      ctx.crowd.init(members.flatMap((m, i) => m.camp === 'police' ? [spawns[i].x] : []));
      members.forEach((m, i) => ctx.crowd.add(new Avatar(m.id, m.name, m.camp, spawns[i])));
      ctx.crowd.me = ctx.crowd.humans.find((h) => h.local)!;
    }
    this.bars = new HealthBars();
    this.sync = new Sync((winner, reason, stats) => this.showEnd(winner, reason, stats));
    ctx.physics.onCollision = (a, b, oa, ob) => {
      if (oa?.kind === 'proj') ctx.projectiles.onCollision(oa.ref as Projectile, b, ob);
      if (ob?.kind === 'proj') ctx.projectiles.onCollision(ob.ref as Projectile, a, oa);
    };
    for (const v of ctx.city.vans) this.sirenIds.push(audio.addSiren(v));
    this.buildHeli();
    this.heliSpot = new THREE.SpotLight(0xe8f0ff, 0, 180, 0.12, 0.5, 1.2);
    this.scene.add(this.heliSpot, this.heliSpot.target);

    window.addEventListener('resize', () => this.resize());
    $('keys').innerHTML = (camp === 'police'
      ? ['[G] Charge', '[T] Avancer', '[V] Tenir', '[F] Menotter', '[E] Canon à eau']
      : ['[I] Slogan', '[E] Ramasser', '[F] Barricade / feu', '[H] Medic', '[M] Masque']).join('<br>');
    $('controls').innerHTML = CONTROLS[camp].map(([k, v]) => `<div><kbd>${k}</kbd> ${v}</div>`).join('');
    // warm-up: compile shaders before the first frame
    ctx.sky.update(0, ctx.player.pos);
    this.renderer.compile(this.scene, this.camera);
  }

  private buildHeli() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.5, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12).scale(1, 0.8, 1.8), dark);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 6, 8).rotateX(Math.PI / 2), dark); tail.position.z = -4.5;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.8), dark); fin.position.set(0, 0.6, -7.2);
    this.heliRotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.05, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.55 }));
    this.heliRotor.position.y = 1.5;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0xff2020 })); beacon.position.y = -1.2;
    this.heli.add(body, tail, fin, this.heliRotor, beacon);
    this.heli.visible = false;
    this.scene.add(this.heli);
  }

  private adaptResolution(raw: number) {
    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc < 1.5) return;
    const fps = this.fpsN / this.fpsAcc;
    this.fpsAcc = this.fpsN = 0;
    if (!this.adaptive) return;
    const s = fps < 45 ? Math.max(0.5, this.resScale - 0.1) : fps > 57 ? Math.min(1, this.resScale + 0.05) : this.resScale;
    if (s === this.resScale) return;
    this.resScale = s;
    this.renderer.setPixelRatio(ctx.q.pixelRatio * s);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    ctx.post.setSize(w, h);
    ctx.particles.resize(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  start() {
    this.running = true;
    if (ctx.net.isClient) ctx.net.toHost(['loaded']);
    ctx.hud.show();
    ctx.hud.banner('CALME', this.camp === 'protest' ? 'Le cortège est pacifique. Chantez, marchez… pour l\'instant.' : 'Tenez la ligne. Aucun usage de la force tant que tout reste calme.');
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      const raw = (now - this.last) / 1000;
      this.last = now;
      this.frame(Math.min(0.05, raw));
      if (!this.paused) this.adaptResolution(raw);
    };
    requestAnimationFrame(loop);
  }

  setPaused(p: boolean) {
    this.paused = p;
  }

  private frame(dt: number) {
    const inp = ctx.input;
    if (this.paused) {
      // a multiplayer match never stops: the menu only takes the controls away
      if (!ctx.net.multi) { ctx.post.render(0); return; }
      inp.reset(); inp.endFrame();
    }
    ctx.time += dt;
    this.sync.update(dt);
    // water cannon (police): get in / out
    const p = ctx.player;
    if (ctx.camp === 'police' && p.alive && inp.hit('KeyE') && (p.inVehicle || ctx.truck.canEnter(p.feet))) {
      inp.pressed.delete('KeyE');
      if (p.inVehicle) ctx.truck.leave(); else ctx.truck.board();
      act('truck', p.inVehicle);
    }

    if (inp.hit('KeyP')) {
      ctx.settings.thirdPerson = !ctx.settings.thirdPerson;
      saveSettings(ctx.settings);
      ctx.hud.feed(ctx.settings.thirdPerson ? 'Vue à la 3e personne' : 'Vue à la 1re personne', '#cfcfcf');
    }
    ctx.physics.step(dt);
    ctx.player.update(dt);
    ctx.truck.update(dt);
    ctx.crowd.update(dt);
    this.bars.update();
    ctx.projectiles.update(dt);
    ctx.gas.update(dt);
    ctx.destruction.update(dt);
    ctx.pickups.update(dt);
    if (!ctx.net.isClient) ctx.tension.update(dt);

    // wind slowly turns
    ctx.wind.set(Math.cos(ctx.time * 0.01) * 1.2, 0, 0.5 + Math.sin(ctx.time * 0.013) * 0.6);
    const progress = ctx.time / L.MATCH_SECONDS;
    ctx.sky.update(progress, ctx.player.pos);
    ctx.night = ctx.sky.night;
    ctx.city.update(ctx.night, ctx.time);
    ctx.particles.setFog(ctx.sky.fogColor, ctx.sky.fog.density);
    const alarm = ctx.tension.phase >= 1;
    ctx.city.setGyros(alarm, ctx.time);
    if (alarm) ctx.city.vans.forEach((v, i) => { if (Math.sin(ctx.time * 9 + i * Math.PI) > 0.2) ctx.lights.request({ pos: v, color: new THREE.Color(0.15, 0.3, 1), intensity: 12, distance: 16, priority: 1.1 }); });
    this.updateHeli(dt);
    ctx.particles.update(dt, ctx.wind);
    ctx.lights.tick(dt);
    ctx.lights.update(this.camera);

    const fire = this.nearestFire();
    ctx.audio.update(dt, this.camera, {
      crowdPos: ctx.crowd.center, crowdLevel: ctx.crowd.level, phase: ctx.tension.phase, tension: ctx.tension.value,
      heliPos: this.heli.visible ? this.heli.position : null, water: ctx.truck.spraying ? ctx.truck.pos : null,
      fire, sirens: ctx.city.vans, sirensOn: ctx.tension.phase === 2, lowHp: clamp(1 - ctx.player.hp / (ctx.player.maxHp * 0.4), 0, 1),
    });
    ctx.hud.update(dt);
    if (!ctx.net.isClient) this.objectives();
    ctx.post.render(dt);
    inp.endFrame();
  }

  private nearestFire() {
    let best: { pos: THREE.Vector3; level: number } | null = null, bd = 40;
    for (const f of ctx.destruction.fires) {
      const d = f.pos.distanceTo(this.camera.position);
      if (d < bd) { bd = d; best = { pos: f.pos, level: f.size * f.intensity }; }
    }
    return best;
  }

  private updateHeli(dt: number) {
    const on = ctx.tension.phase >= 1;
    this.heli.visible = on;
    if (!on) { this.heliSpot.intensity = 0; return; }
    const t = ctx.time * 0.05;
    const c = ctx.crowd.center;
    this.heli.position.set(c.x + Math.cos(t) * 60, 75, c.z + Math.sin(t) * 60);
    this.heli.rotation.y = -t;
    this.heliRotor.rotation.y += dt * 40;
    this.heliSpot.position.copy(this.heli.position).y -= 1.5;
    this.heliSpot.target.position.set(c.x + Math.sin(ctx.time * 0.3) * 8, 0, c.z + Math.cos(ctx.time * 0.23) * 8);
    this.heliSpot.intensity = ctx.night * 60000;
  }

  /** Host / solo: win conditions. */
  private objectives() {
    if (ctx.over) return;
    const P = ctx.crowd.police;
    for (const h of ctx.crowd.alive('protest') as Avatar[]) {
      if (Math.hypot(h.feet.x - L.OBJECTIVE.x, h.feet.z - L.OBJECTIVE.z) < L.OBJECTIVE.r) {
        this.finish('protest', `${h.local ? 'Vous avez' : h.name + ' a'} percé la ligne et atteint la place de la Concorde-Neuve.`);
        return;
      }
      // sneaking behind the police line: the closest officers try to catch the intruder
      if (h.feet.z < P.lineZ - 1 && ctx.crowd.all.filter((n) => n.role === 'crs' && n.data.hunt && n.standing).length < 3) {
        const n = ctx.crowd.nearest(h.feet, 30, (o) => o.role === 'crs' && o.standing && !o.data.hunt && o.state === 'line');
        if (n) { n.setState('charge'); n.data.hunt = h; }
      }
    }
    if (ctx.crowd.humanArrests >= this.arrestGoal) { this.finish('police', `${ctx.crowd.humanArrests} manifestants interpellés : le cortège se disperse.`); return; }
    if (ctx.time >= L.MATCH_SECONDS) { this.finish('police', 'La nuit est tombée : la police a tenu la place et le cortège s\'est dispersé.'); return; }
    let onPlace = 0;
    for (const n of ctx.crowd.all) if (n.camp === 'protest' && n.standing && n.pos.z < L.PLACE_Z0 + 10) onPlace++;
    if (onPlace >= 12) this.finish('protest', 'La ligne a cédé : les manifestants ont envahi la place.');
  }

  /** The local player is down or arrested: game over in solo, back in the game a bit later in multiplayer. */
  humanDown(arrested: boolean) {
    if (ctx.net.multi) {
      setTimeout(() => {
        if (ctx.over) return;
        ctx.player.respawn(this.spawn);
        ctx.hud.feed(arrested ? 'Relâché après une vérification d\'identité : retour dans la manif.' : 'Soigné et de retour.', '#9fd29b');
      }, arrested ? 8000 : 6000);
      return;
    }
    const other: Camp = ctx.camp === 'police' ? 'protest' : 'police';
    const reason = arrested ? 'Vous avez été interpellé et placé en garde à vue.'
      : ctx.camp === 'protest' ? 'Blessé, vous avez été évacué par les street medics.' : 'Blessé, vous avez été évacué par les pompiers.';
    setTimeout(() => this.finish(other, reason), arrested ? 3500 : 4500);
  }

  /** Host / solo decide the end of the match; clients learn it from the host. */
  finish(winner: Camp, reason: string) {
    if (ctx.over || ctx.net.isClient) return;
    this.sync.end(winner, reason);
    this.showEnd(winner, reason);
  }

  /** End screen; no winner when the match was cut short (the host left). */
  showEnd(winner: Camp | null, reason: string, hostStats?: Record<string, number>) {
    if (ctx.over) return;
    ctx.over = true;
    // world-wide counters come from the host, personal ones stay ours
    if (hostStats) for (const k of ['npcInjured', 'npcSevere', 'arrests', 'windows', 'vehiclesBurnt', 'fires', 'barricades', 'damageEuros', 'evacuated'] as const) ctx.stats[k] = hostStats[k];
    const win = winner === ctx.camp;
    setTimeout(() => {
      this.paused = true;
      ctx.input.unlock();
      ctx.hud.hide();
      $('pause').classList.add('hidden');
      const s = ctx.stats;
      $('end-kicker').textContent = ctx.camp === 'protest' ? 'Manifestant' : 'CRS';
      $('end-title').textContent = !winner ? 'Partie terminée' : win ? 'Objectif atteint' : 'Échec';
      $('end-reason').textContent = reason;
      const mm = Math.floor(ctx.time / 60), ss = Math.floor(ctx.time % 60).toString().padStart(2, '0');
      const cells: [string, string | number][] = [
        ['Durée', `${mm}:${ss}`], ['Tension finale', `${Math.round(ctx.tension.value)} %`], ['Blessés (PNJ)', s.npcInjured],
        ['Blessés graves', s.npcSevere], ['Interpellations', s.arrests], ['Personnes évacuées', s.evacuated],
        ['Personnes touchées (vous)', s.peopleHit], ['Coups au but (vous)', `${s.hits} (${s.headHits} à la tête)`],
        ctx.camp === 'police' ? ['Interpellations (vous)', s.myArrests] : ['Objets lancés (vous)', s.thrown],
        ctx.camp === 'police' ? ['Tirs LBD (vous)', `${s.lbdShots} (${s.lbdHits} touchés)`] : ['Barricades', s.barricades],
        ['Vitrines brisées', s.windows], ['Véhicules incendiés', s.vehiclesBurnt], ['Dégâts estimés', `${Math.round(s.damageEuros / 1000)} k€`],
        ['Incendies', s.fires], ['Vos blessures', s.playerWounds],
      ];
      $('end-stats').innerHTML = cells.map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
      $('end').classList.remove('hidden');
    }, 1200);
  }
}
