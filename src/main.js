// HDR Emergency Simulator: bootstrap and main loop.
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Audio } from './audio.js';
import { DoseField, Dosimetry, B, IR192 } from './dose.js';
import { Interact } from './interact.js';
import { Devices } from './devices.js';
import { Scenario, SCENARIOS } from './scenario.js';
import { UI } from './ui.js';
import { TransferTube } from './tube.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = params.get('tm') === 'neutral' ? THREE.NeutralToneMapping : params.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
renderer.toneMappingExposure = parseFloat(params.get('exposure') || '0.85');
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// Fixed foveation renders the edge of view at reduced resolution, which made the text-heavy
// console screens shimmer. Keep it low by default; ?foveation=0.6 trades sharpness for GPU time.
renderer.xr.setFoveation(Math.min(1, Math.max(0, parseFloat(params.get('foveation') ?? '0.2'))));
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101214);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 40);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------------------------------------------------------------- state
const opts = { scenario: params.get('scenario') || 'random', mode: params.get('mode') || 'guided', activity: parseFloat(params.get('activity') || '10'), unit: 'mR', loco: params.get('loco') === 'teleport' ? 'teleport' : 'smooth' };
let world, player, audio, field, dosim, interact, devices, scenario, ui, tube;
let running = false;

// ---------------------------------------------------------------- menu
function setupMenu() {
  const sel = $('opt-scn');
  for (const [k, v] of Object.entries(SCENARIOS)) {
    const o = document.createElement('option'); o.value = k; o.textContent = v.name; sel.appendChild(o);
  }
  sel.value = opts.scenario;
  const desc = () => { $('scn-desc').textContent = SCENARIOS[sel.value].desc; };
  sel.onchange = () => { opts.scenario = sel.value; desc(); };
  desc();
  const seg = (id, key, conv = (x) => x) => {
    const el = $(id);
    el.querySelectorAll('button').forEach(b => {
      if (String(opts[key]) === b.dataset.v) { el.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); }
      b.onclick = (e) => { e.preventDefault(); el.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); opts[key] = conv(b.dataset.v); facts(); };
    });
  };
  seg('opt-mode', 'mode'); seg('opt-act', 'activity', parseFloat); seg('opt-unit', 'unit'); seg('opt-loco', 'loco');
  const facts = () => {
    const sk = opts.activity * 1000 * IR192.skPerMci;
    $('f-act').textContent = opts.activity.toFixed(1) + ' Ci';
    $('f-rate').textContent = (sk * IR192.lambda / 100 / 60).toFixed(1) + ' Gy/min';
    $('f-air').textContent = (sk / 1000).toFixed(0) + ' mGy/h';
  };
  facts();
  $('btn-desk').onclick = () => startDesktop();
  $('btn-vr').onclick = () => startVR();
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      $('btn-vr').dataset.xr = ok ? '1' : '';
      $('xrnote').textContent = ok ? 'Headset detected. Enter VR when loading finishes.' : 'No VR headset found in this browser. Open this page in the Meta Quest browser for VR.';
    }).catch(() => {});
  } else $('xrnote').textContent = 'WebXR is not available here. Desktop mode works in any modern browser; open the page on a Quest for VR.';
}

function progress(f) { $('bar').style.width = Math.round(f * 100) + '%'; }

// ---------------------------------------------------------------- boot
async function boot() {
  setupMenu();
  world = new World(renderer, scene, progress);
  await world.load('./assets/');
  $('loadtxt').textContent = 'Ready.';
  progress(1);
  player = new Player(renderer, camera, scene, renderer.domElement);
  player.gloveMat.envMap = world.env.vault; player.gloveMat.envMapIntensity = 1.0;
  audio = new Audio(camera);
  field = new DoseField();
  field.shieldMobile = (() => { const a = B(1.95, -1.1, 0), b = B(2.55, -0.6, 1.65); return { min: a.clone().min(b), max: a.clone().max(b) }; })();
  dosim = new Dosimetry();
  const bus = (ev, arg) => onEvent(ev, arg);
  interact = new Interact(world, player, audio, bus);
  devices = new Devices(world, renderer, scene, field, audio, player);
  ui = new UI(world, player, scene, camera);
  scenario = new Scenario({ world, interact, field, dosim, devices, audio, ui, player });
  audio.subtitle = (t, who) => ui.subtitle(t, who);
  interact.hint = (t) => { ui.hint(t); setTimeout(() => scenario && scenario.lastHint !== t && ui.hint(scenario.lastHint || ''), 3500); };
  ui.onAction = onAction;
  player.doorOpen = () => interact.door && interact.door.angle < -0.9;
  player.keyDown = onKey;
  // transfer tube
  const tubeMat = world.material('cable_gray', 'vault', { unique: 'tube' });
  tube = new TransferTube(scene, tubeMat);
  // CCTV avatar (only the CCTV cameras see layer 3)
  buildAvatar();
  const spawn = world.markers.spawn ? world.markers.spawn.position.clone() : B(0.85, -5.0, 0);
  player.spawn(new THREE.Vector3(spawn.x, 0, spawn.z), 0);
  ui.drawWall('idle');
  devices.setState({ mode: 'treating', consoleSafe: false });
  $('btn-desk').disabled = false;
  $('btn-vr').disabled = !$('btn-vr').dataset.xr;
  player.onXRStart = () => { ui.drawHUD(); };
  player.onXREnd = () => { running = false; $('menu').classList.remove('hidden'); $('hud').classList.remove('on'); ui.hideFloat(); };
  renderer.setAnimationLoop(loop);
  window.__sim = { world, player, scenario, interact, devices, field, dosim, ui, audio, renderer, scene, camera, THREE,
    step: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) simStep(dt); } };
  if (params.get('autostart') === 'desktop') startDesktop(true);
}

function buildAvatar() {
  const g = new THREE.Group();
  const scrubs = new THREE.MeshStandardMaterial({ color: 0x3f6f8f, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc69c80, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 6, 12), scrubs); body.position.y = -0.62; g.add(body);
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.7, 6, 12), new THREE.MeshStandardMaterial({ color: 0x35607c, roughness: 0.9 })); legs.position.y = -1.18; g.add(legs);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), skin); g.add(head);
  g.traverse(o => o.layers.set(3));
  scene.add(g);
  buildAvatar.g = g;
}
function updateAvatar() {
  const g = buildAvatar.g; if (!g) return;
  const h = player.headWorld(new THREE.Vector3());
  g.position.copy(h);
  const d = player.headDir(new THREE.Vector3()); d.y = 0;
  if (d.lengthSq() > 1e-4) g.rotation.y = Math.atan2(d.x, d.z);
}

// ---------------------------------------------------------------- start / stop
function commonStart() {
  audio.start(scene);
  devices.startAudio();
  devices.unit = opts.unit;
  player.loco = opts.loco;
  player.vignetteOn = params.get('vignette') !== '0';
  $('menu').classList.add('hidden');
  $('debrief').classList.add('hidden');
}

function begin() {
  ui.hideFloat();
  const spawn = world.markers.spawn ? world.markers.spawn.position : B(0.85, -5.0, 0);
  if (player.mode === 'xr') {
    // face the console (north) wherever the user is standing in their play space
    const d = player.headDir(new THREE.Vector3());
    player.snapTurn(-Math.atan2(-d.x, -d.z));
    player.teleportTo(new THREE.Vector3(spawn.x, 0, spawn.z));
  }
  else player.spawn(new THREE.Vector3(spawn.x, 0, spawn.z), 0);
  devices.logLines = [];
  scenario.start({ scenario: opts.scenario, mode: opts.mode, activity: opts.activity, unit: opts.unit });
  ui.drawWall('running', { name: opts.scenario === 'random' ? 'Random fault' : SCENARIOS[opts.scenario].name, mode: opts.mode });
  running = true;
}

function startDesktop(auto = false) {
  commonStart();
  $('hud').classList.add('on');
  player.enabled = true;
  if (auto) { begin(); return; }
  // briefing card
  const el = $('debrief-body');
  el.innerHTML = `<h2>Briefing</h2>
    <div class="teach">
      <p>Patient: 61-year-old woman, endometrial cancer, post-operative vaginal cuff. Fraction 3 of 3, 7 Gy at 5 mm depth. Vaginal cylinder 3.0 cm, single channel.</p>
      <p>Source: Ir-192, ${opts.activity} Ci. Treatment is running. You are the physicist at the console.</p>
      <p>The survey meter sits in the cradle left of the console, beside the vault door. The emergency container, long forceps and cutters are in the room at the foot of the table.</p>
      <p>${opts.mode === 'guided' ? 'Guided mode: prompts appear at the bottom of the screen.' : 'Assessment mode: no prompts. You are scored on sequence, time and dose.'}</p>
    </div>
    <div class="actions"><button class="btn vr" id="br-go">Begin (click to capture the mouse)</button><button class="btn desk" id="br-back">Back</button></div>`;
  $('debrief').classList.remove('hidden');
  $('br-go').onclick = () => { $('debrief').classList.add('hidden'); renderer.domElement.requestPointerLock?.(); begin(); };
  $('br-back').onclick = () => { $('debrief').classList.add('hidden'); $('menu').classList.remove('hidden'); $('hud').classList.remove('on'); };
}

async function startVR() {
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await renderer.xr.setSession(session);
    commonStart();
    ui.briefing(opts, () => begin());
  } catch (e) {
    $('xrnote').textContent = 'Could not start VR: ' + e.message;
  }
}

function onAction(a, arg) {
  if (a === 'start') { if (!running) begin(); return; }
  if (a === 'end') { scenario.on('end', 'user'); return; }
  if (a === 'restart') { restart(); return; }
  if (a === 'next') {
    const order = Object.keys(SCENARIOS).filter(k => k !== 'random');
    const cur = scenario.kind || 'interrupt';
    opts.scenario = order[(order.indexOf(cur) + 1) % order.length];
    $('opt-scn').value = opts.scenario;
    restart();
    return;
  }
  if (a === 'menu') { $('debrief').classList.add('hidden'); $('menu').classList.remove('hidden'); $('hud').classList.remove('on'); running = false; scenario.phase = 'idle'; return; }
  if (a === 'exitvr') { renderer.xr.getSession()?.end(); return; }
  if (a === 'call') { phoneCall(arg); return; }
  if (a === 'hangup') { ui.closePhone(); audio.hush(); if (interact.phone) { const s = interact.phone.snap(); interact.phone.grabbedBy = null; interact.held.forEach((v, k) => { if (v.item === interact.phone) interact.held.delete(k); }); if (interact.deskHeld === interact.phone) interact.deskHeld = null; interact.tween(interact.phone, s.p, s.q, 0.25); } return; }
}

function restart() {
  $('debrief').classList.add('hidden');
  ui.hideFloat();
  if (player.mode !== 'xr') { $('hud').classList.add('on'); renderer.domElement.requestPointerLock?.(); }
  begin();
}

const CALLS = {
  RSO: ['Radiation safety. Understood. Keep the room closed and post the door. Write down the times and where everyone was standing. I am on my way.',
    'Radiation safety. The source is still out? Go back and get it shielded first. I am on my way.'],
  physicist: ['Physics. Got it. Nobody goes back in until I get there. Keep the patient monitored and write down the meter readings.',
    'Physics. If the crank will not move it, get the applicator out and into the container. I am coming down.'],
  'radiation oncologist': ['Okay. I will come and see the patient now. How long was the source out, and where was it sitting?',
    'Get the source out of her first. I am coming.'],
};
function phoneCall(who) {
  ui.phoneState = 'calling'; ui.phoneMsg = 'Ringing ' + who + '…'; ui.drawPhone();
  audio.oneShot('beep_lo', interact.phone.obj.position, 0.4);
  setTimeout(() => audio.oneShot('beep_lo', interact.phone.obj.position, 0.4), 1200);
  setTimeout(() => {
    ui.phoneMsg = 'Connected: ' + who; ui.drawPhone();
    const secured = scenario.securedT != null;
    audio.say(CALLS[who][secured ? 0 : 1], who === 'RSO' ? 'RSO' : who === 'physicist' ? 'Physicist' : 'Rad onc');
    scenario.on('phone:call', who);
  }, 2600);
}

function onEvent(ev, arg) {
  if (ev === 'grab:phone') ui.openPhone();
  if (ev === 'snap:phone' || ev === 'release:phone') ui.closePhone();
  scenario.on(ev, arg);
}

function onKey(code) {
  if (!running && code !== 'Tab') return;
  if (code === 'KeyF') { if (interact.deskHeld === interact.meter) onEvent('meter:power'); }
  if (code === 'KeyG') interact.deskDrop();
  if (code === 'Enter' && scenario.phase !== 'debrief' && scenario.faultT != null) scenario.on('end', 'user');
  if (code === 'Tab') toggleCard();
  if (code === 'KeyM') { audio.listener.setMasterVolume(audio.listener.getMasterVolume() > 0 ? 0 : 1); }
}

function toggleCard() {
  let el = document.getElementById('card');
  if (!el) {
    el = document.createElement('div'); el.id = 'card';
    el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);z-index:20;pointer-events:none';
    el.innerHTML = '<img src="./assets/tex/sign_procedure_console.jpg" style="max-height:92vh;max-width:92vw;border-radius:8px;box-shadow:0 20px 60px #000">';
    document.body.appendChild(el); return;
  }
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
let frames = 0, fpsT = 0;

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  simStep(dt);
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 1) { window.__fps = frames / fpsT; frames = 0; fpsT = 0; }
}

function simStep(dt) {
  player.update(dt);
  // UI pointers first
  let uiConsumed = false;
  if (player.mode === 'xr') {
    for (const h of player.hands) {
      if (!h.active) { h.ray.visible = false; continue; }
      const r = ui.pickPanel(h.rayO, h.rayD);
      h.uiDist = r ? r.dist : Infinity;   // lets console buttons behind a panel ignore this ray
      const over = !!(r && r.idx >= 0);
      h.ray.visible = !!r;
      if (r) h.ray.scale.z = r.dist;
      if (r) ui.handlePointer(h.rayO, h.rayD, h.triggerDown);
      // fingertip touch on panels
      if (!h.isHand || true) {
        const tr = ui.pickPanel(h.tip.clone().addScaledVector(h.rayD, -0.03), h.rayD);
        if (tr && tr.dist < 0.05 && tr.idx >= 0 && !h._panelTouch) { h._panelTouch = true; ui.handlePointer(h.tip.clone().addScaledVector(h.rayD, -0.03), h.rayD, true); }
        if (!tr || tr.dist > 0.09) h._panelTouch = false;
      }
      if (over && h.triggerDown) uiConsumed = true;
      if (h.btn && h.btn.b && !h.prev.b && running) {
        ui.showFloat((p) => { const g = p.g; p.clear('#0e141a'); g.fillStyle = '#e8edf2'; g.font = '700 48px Inter, sans-serif'; g.fillText('Paused menu', 50, 90);
          p.button(50, 160, 520, 100, 'Resume', () => ui.hideFloat(), 'primary');
          p.button(50, 290, 520, 100, 'End drill and debrief', () => { ui.hideFloat(); scenario.on('end', 'user'); }, 'danger');
          p.button(50, 420, 520, 100, 'Restart', () => restart(), 'ghost');
          p.button(50, 550, 520, 100, 'Exit VR', () => renderer.xr.getSession()?.end(), 'ghost'); p.flush(); });
      }
    }
  } else if (player.locked) {
    camera.getWorldPosition(_o); camera.getWorldDirection(_d);
    const hitUI = ui.handlePointer(_o, _d, player.mouse.clicked);
    if (hitUI && player.mouse.clicked) { uiConsumed = true; player.mouse.clicked = false; }
  }
  if (running) {
    interact.update(dt, false);
    interact.stepDoorAnim(dt);
    scenario.update(dt);
  }
  devices.update(dt, dosim, scenario);
  // transfer tube
  const port = world.markers.turret_port, center = world.markers.turret_center;
  if (port && interact.app) {
    const da = port.position.clone().sub(center.position).normalize();
    const conn = interact.app.obj.position;
    const db = new THREE.Vector3(0, 0, 1).applyQuaternion(interact.app.obj.quaternion);
    tube.update(port.position, da, conn, db);
  }
  for (const it of [interact.app, interact.forceps, interact.cutters, interact.lid, interact.phone]) if (it) world.updateMovableEnv(it.obj);
  updateAvatar();
  audio.update();
  ui.update(dt);
  player.endFrame();
}

boot().catch((e) => { console.error(e); $('loadtxt').textContent = 'Failed to load: ' + e.message; });
