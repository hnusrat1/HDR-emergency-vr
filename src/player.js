// Player rig: desktop first-person controls and WebXR (controllers + hand tracking), locomotion.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { B } from './dose.js';

const EYE = 1.65;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

// 2D blocking boxes in three plan coords (x, z). Built from Blender min/max.
function pb(x0, y0, x1, y1) {
  const a = B(x0, y0, 0), b = B(x1, y1, 0);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
}
export const BLOCKERS = [
  // walls
  pb(-3.6, -6.8, -3.5, 3.9), pb(3.5, -6.8, 3.65, 3.9), pb(-3.5, -6.8, 3.5, -6.6), pb(-3.5, 3.4, 3.5, 3.95),
  pb(-3.5, 3.4, -3.0, 3.9), pb(-3.5, -3.9, -3.0, 3.9), pb(3.0, -3.9, 3.5, 3.9),
  pb(-3.0, -3.9, -2.72, -3.4), pb(-1.48, -3.9, 3.0, -3.4), pb(-3.0, -2.1, 1.0, -1.6),
  // furniture
  pb(-3.0, -0.92, -2.38, 2.72), pb(2.38, 1.68, 3.0, 3.22), pb(-0.6, 0.38, 0.0, 1.55),
  pb(-0.70, -0.20, 0.10, 0.45),   // stirrups / foot of table (boots)
  pb(0.25, -0.62, 1.0, 0.28),     // afterloader
  pb(-1.32, -0.22, -0.92, 0.18),  // container cart
  pb(-1.25, -0.98, -0.75, -0.46), // mayo tray
  pb(-0.78, -4.68, 2.98, -3.9),   // console desk
  pb(1.88, -1.12, 2.62, -0.58),   // mobile shield
  pb(-1.3, 2.5, -0.8, 3.0),       // IV pole
  pb(-2.45, 2.78, -1.95, 3.22),   // hamper
  pb(2.5, 0.75, 2.9, 1.55),       // bins
  pb(-3.5, -5.9, -3.3, -4.6),     // TV wall (thin)
];
export const DOOR_GAP = pb(-2.75, -3.95, -1.45, -3.35);

export class Player {
  constructor(renderer, camera, scene, dom) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.dom = dom;
    this.dolly = new THREE.Group();
    this.dolly.name = 'dolly';
    scene.add(this.dolly);
    this.dolly.add(camera);
    camera.position.set(0, EYE, 0);
    this.yaw = 0; this.pitch = 0;
    this.keys = new Set();
    this.mouse = { down: false, clicked: false, released: false, right: false };
    this.locked = false;
    this.mode = 'desktop';
    this.loco = 'teleport';
    this.doorOpen = () => false;
    this.hands = [];
    this.onXRStart = null; this.onXREnd = null;
    this.extraBlockers = [];
    this.setupDesktop();
    this.setupXR();
  }

  spawn(pos, yaw = 0) {
    this.dolly.position.copy(pos);
    this.yaw = yaw; this.pitch = 0;
    this.dolly.rotation.set(0, yaw, 0);
    this.camera.rotation.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- desktop
  setupDesktop() {
    const el = this.dom;
    el.addEventListener('click', () => {
      if (this.mode === 'desktop' && !this.locked && this.enabled) el.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.down = false; this.mouse.released = true; }
    });
    document.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
      this.keyDown?.(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  blocked(x, z, r = 0.22) {
    const all = BLOCKERS.concat(this.extraBlockers);
    for (const b of all) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return b;
    if (!this.doorOpen()) {
      const b = DOOR_GAP;
      if (x > b.x0 - r && x < b.x1 + r && z > b.z0 && z < b.z1) return b;
    }
    return null;
  }

  moveDesktop(dt) {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.4 : 1.35) * dt;
    if (f || s) {
      const len = Math.hypot(f, s);
      const dx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s) / len * speed;
      const dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) / len * speed;
      const p = this.dolly.position;
      if (!this.blocked(p.x + dx, p.z)) p.x += dx;
      if (!this.blocked(p.x, p.z + dz)) p.z += dz;
      this.bob = (this.bob || 0) + dt * 9 * (speed / dt / 1.35);
    }
    this.dolly.rotation.set(0, this.yaw, 0);
    const bob = (f || s) ? Math.sin(this.bob) * 0.012 : 0;
    this.camera.position.set(0, EYE + bob, 0);
    this.camera.rotation.set(this.pitch, 0, 0, 'YXZ');
  }

  // ---------------------------------------------------------------- XR
  setupXR() {
    const r = this.renderer;
    const cmf = new XRControllerModelFactory();
    const hmf = new XRHandModelFactory().setPath('./assets/hands/');
    for (let i = 0; i < 2; i++) {
      const ctrl = r.xr.getController(i);
      const grip = r.xr.getControllerGrip(i);
      const hand = r.xr.getHand(i);
      this.dolly.add(ctrl, grip, hand);
      const h = { i, ctrl, grip, hand, source: null, handedness: 'none', isHand: false, model: null, handModel: null,
        prev: {}, btn: {}, tip: new THREE.Vector3(), pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
        rayO: new THREE.Vector3(), rayD: new THREE.Vector3(), squeeze: false, trigger: false };
      // controller model
      h.model = cmf.createControllerModel(grip);
      grip.add(h.model);
      // fingertip marker for poking buttons with a controller
      const tipM = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xf2c21b }));
      tipM.position.set(0, -0.012, -0.055);
      ctrl.add(tipM);
      h.tipMarker = tipM;
      // gloved hand for hand tracking
      h.handModel = hmf.createHandModel(hand, 'mesh');
      hand.add(h.handModel);
      const glove = this.gloveMat || (this.gloveMat = new THREE.MeshStandardMaterial({ color: 0x5b8fe0, roughness: 0.42, metalness: 0.0 }));
      const tint = () => h.handModel.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) { o.material = glove; o.frustumCulled = false; } });
      h.tint = tint;
      // pointer ray
      const rg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const ray = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
      ray.scale.z = 1; ray.visible = false;
      ctrl.add(ray);
      h.ray = ray;
      ctrl.addEventListener('connected', (e) => {
        h.source = e.data; h.handedness = e.data.handedness; h.isHand = !!e.data.hand;
        h.tipMarker.visible = !h.isHand;
      });
      ctrl.addEventListener('disconnected', () => { h.source = null; });
      this.hands.push(h);
    }
    // teleport arc
    const arcG = new THREE.BufferGeometry();
    arcG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.arc = new THREE.Line(arcG, new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.9 }));
    this.arc.frustumCulled = false; this.arc.visible = false;
    this.scene.add(this.arc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.85 }));
    ring.visible = false;
    this.scene.add(ring);
    this.ring = ring;
    r.xr.addEventListener('sessionstart', () => {
      this.mode = 'xr';
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      this.dolly.rotation.set(0, this.yaw, 0);
      this.onXRStart?.();
    });
    r.xr.addEventListener('sessionend', () => { this.mode = 'desktop'; this.camera.position.set(0, EYE, 0); this.onXREnd?.(); });
  }

  readXR() {
    for (const h of this.hands) {
      const s = h.source;
      h.prev = { ...h.btn };
      if (!s) { h.btn = {}; h.active = false; continue; }
      h.active = true;
      if (h.isHand && !h._tinted && h.handModel.children.length && h.handModel.children[0].children.length) { h.tint(); h._tinted = true; }
      if (h.isHand) {
        // pinch / grab from joint distances
        const j = (n) => h.hand.joints[n];
        const it = j('index-finger-tip'), tt = j('thumb-tip'), mt = j('middle-finger-tip'), wr = j('wrist'), mm = j('middle-finger-metacarpal');
        if (it && tt && wr && it.visible !== false) {
          const pinch = it.position.distanceTo(tt.position);
          const curl = mt && mm ? mt.position.distanceTo(wr.position) : 1;
          h.btn = { squeeze: curl < 0.11 || pinch < 0.022, trigger: pinch < 0.02, a: false };
          it.getWorldPosition(h.tip);
          // grab point: between thumb and index tip, or palm
          const pi = it.getWorldPosition(new THREE.Vector3()), pt = tt.getWorldPosition(new THREE.Vector3());
          h.pos.copy(pi).add(pt).multiplyScalar(0.5);
          if (curl < 0.11 && mm) mm.getWorldPosition(h.pos);
          wr.getWorldQuaternion(h.quat);
        }
        h.ctrl.getWorldPosition(h.rayO);
        h.rayD.set(0, 0, -1).applyQuaternion(h.ctrl.getWorldQuaternion(_q));
      } else {
        const gp = s.gamepad;
        const b = gp ? gp.buttons : [];
        h.btn = {
          trigger: !!(b[0] && b[0].value > 0.6), squeeze: !!(b[1] && b[1].value > 0.55),
          a: !!(b[4] && b[4].pressed), b: !!(b[5] && b[5].pressed), stick: !!(b[3] && b[3].pressed),
        };
        h.axes = gp ? gp.axes : [];
        h.grip.getWorldPosition(h.pos);
        h.grip.getWorldQuaternion(h.quat);
        h.tipMarker.getWorldPosition(h.tip);
        h.ctrl.getWorldPosition(h.rayO);
        h.rayD.set(0, 0, -1).applyQuaternion(h.ctrl.getWorldQuaternion(_q));
      }
      h.squeeze = !!h.btn.squeeze; h.trigger = !!h.btn.trigger;
      h.squeezeDown = h.squeeze && !h.prev.squeeze; h.squeezeUp = !h.squeeze && h.prev.squeeze;
      h.triggerDown = h.trigger && !h.prev.trigger; h.triggerUp = !h.trigger && h.prev.trigger;
      h.aDown = !!h.btn.a && !h.prev.a;
    }
  }

  haptic(h, intensity = 0.5, ms = 30) {
    const act = h && h.source && h.source.gamepad && h.source.gamepad.hapticActuators;
    if (act && act[0] && act[0].pulse) act[0].pulse(intensity, ms);
  }

  headWorld(out = new THREE.Vector3()) { return this.camera.getWorldPosition(out); }
  headDir(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }

  locomotionXR(dt) {
    const L = this.hands.find(h => h.handedness === 'left' && h.active && !h.isHand);
    const R = this.hands.find(h => h.handedness === 'right' && h.active && !h.isHand);
    // snap turn on right stick
    if (R && R.axes && R.axes.length >= 4) {
      const x = R.axes[2];
      if (Math.abs(x) > 0.7 && !this._snap) { this.snapTurn(x > 0 ? -Math.PI / 6 : Math.PI / 6); this._snap = true; }
      if (Math.abs(x) < 0.3) this._snap = false;
    }
    if (!L || !L.axes || L.axes.length < 4) { this.arc.visible = this.ring.visible = false; return; }
    const ax = L.axes[2], ay = L.axes[3];
    if (this.loco === 'smooth') {
      if (Math.hypot(ax, ay) > 0.15) {
        const hd = this.headDir(_v); hd.y = 0; hd.normalize();
        const right = new THREE.Vector3(-hd.z, 0, hd.x);
        const sp = 1.4 * dt;
        const dx = (hd.x * -ay + right.x * ax) * sp, dz = (hd.z * -ay + right.z * ax) * sp;
        const head = this.headWorld(new THREE.Vector3());
        if (!this.blocked(head.x + dx, head.z)) this.dolly.position.x += dx;
        if (!this.blocked(head.x, head.z + dz)) this.dolly.position.z += dz;
      }
      return;
    }
    // teleport: push stick forward to aim, release to go
    if (ay < -0.6) {
      this.aiming = true;
      this.computeArc(L);
    } else if (this.aiming && Math.abs(ay) < 0.3) {
      this.aiming = false;
      if (this.teleTarget) this.teleportTo(this.teleTarget);
      this.arc.visible = this.ring.visible = false;
    } else if (!this.aiming) { this.arc.visible = this.ring.visible = false; }
  }

  computeArc(h) {
    const pos = this.arc.geometry.attributes.position;
    const o = h.rayO.clone(), v = h.rayD.clone().multiplyScalar(6.5);
    let n = 0, hit = null;
    const p = o.clone();
    for (; n < 64; n++) {
      pos.setXYZ(n, p.x, p.y, p.z);
      const np = p.clone().addScaledVector(v, 0.025);
      v.y -= 9.8 * 0.025;
      if (np.y <= 0.0) { const t = p.y / (p.y - np.y); hit = p.clone().lerp(np, t); hit.y = 0; n++; pos.setXYZ(n, hit.x, 0, hit.z); n++; break; }
      // stop at walls
      if (this.blocked(np.x, np.z, 0.0) && np.y < 2.8) { const b = this.blocked(np.x, np.z, 0); if (b && (b.x1 - b.x0 < 0.7 || b.z1 - b.z0 < 0.7 || true)) { n++; break; } }
      p.copy(np);
    }
    for (let k = n; k < 64; k++) pos.setXYZ(k, p.x, p.y, p.z);
    pos.needsUpdate = true;
    this.arc.geometry.setDrawRange(0, n);
    this.arc.visible = true;
    const valid = hit && !this.blocked(hit.x, hit.z, 0.18);
    this.teleTarget = valid ? hit : null;
    this.arc.material.color.set(valid ? 0x9fd0ff : 0xff6b6b);
    this.ring.visible = !!valid;
    if (valid) this.ring.position.set(hit.x, 0.01, hit.z);
  }

  teleportTo(p) {
    // move the dolly so the head ends up above p
    const head = this.headWorld(new THREE.Vector3());
    this.dolly.position.x += p.x - head.x;
    this.dolly.position.z += p.z - head.z;
    this.onTeleport?.();
  }

  snapTurn(a) {
    const head = this.headWorld(new THREE.Vector3());
    this.dolly.position.sub(head);
    this.dolly.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    this.dolly.position.add(head);
    this.dolly.rotation.y += a;
    this.yaw = this.dolly.rotation.y;
  }

  update(dt) {
    if (this.mode === 'xr') { this.readXR(); this.locomotionXR(dt); }
    else if (this.enabled) this.moveDesktop(dt);
  }

  endFrame() {
    this.mouse.clicked = false; this.mouse.released = false; this.mouse.right = false;
  }
}
