// Interaction system: buttons, grabbables, crank, door, clamp knob, applicator extraction.
// Works for VR (controllers or tracked hands) and desktop (crosshair).
import * as THREE from 'three';
import { B } from './dose.js';

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _box = new THREE.Box3();
const ray = new THREE.Raycaster();
const _sweep = new THREE.Ray(), _sv = new THREE.Vector3();

// true if the straight path a -> b passes through box (catches fast pokes between frames)
function sweepHitsBox(a, b, box) {
  const len = a.distanceTo(b);
  if (len < 1e-4 || len > 0.5) return false;
  _sweep.origin.copy(a); _sweep.direction.subVectors(b, a).divideScalar(len);
  const p = _sweep.intersectBox(box, _sv);
  return !!p && p.distanceTo(a) <= len;
}

export class Interact {
  constructor(world, player, audio, events) {
    this.world = world; this.player = player; this.audio = audio; this.emit = events;
    this.items = [];
    this.held = new Map();      // hand key -> {item, offset}
    this.deskHeld = null;
    this.hover = null;
    this.locked = false;
    this.hint = null;           // callback(text)
    this.tipEl = document.getElementById('tip');
    this.crossEl = document.getElementById('cross');
    this.halo = new THREE.Mesh(new THREE.RingGeometry(0.028, 0.034, 32), new THREE.MeshBasicMaterial({ color: 0xf2c21b, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    this.halo.renderOrder = 10; this.halo.visible = false;
    world.scene.add(this.halo);
    this.falling = [];
    this.build();
  }

  node(n) { return this.world.nodes[n]; }

  center(item, out = new THREE.Vector3()) {
    if (item.point) return item.point(out);
    _box.setFromObject(item.obj);
    return _box.getCenter(out);
  }

  add(def) {
    const it = Object.assign({ enabled: () => true, reach: 0.07, label: '', kind: 'button' }, def);
    it.obj.traverse((o) => { o.userData.item = it; });
    it.home = { p: it.obj.position.clone(), q: it.obj.quaternion.clone() };
    this.items.push(it);
    return it;
  }

  build() {
    const W = this.world;
    const btn = (name, id, label, axis = new THREE.Vector3(0, -1, 0), latch = false) => {
      const obj = this.node(name);
      if (!obj) return null;
      return this.add({ kind: 'button', id, obj, label, axis, latch, base: obj.position.clone(), pressed: false, t: 0 });
    };
    this.btn = {
      start: btn('DYN_console_start', 'console_start', 'START treatment'),
      interrupt: btn('DYN_console_interrupt', 'console_interrupt', 'INTERRUPT'),
      cestop: btn('DYN_console_estop', 'console_estop', 'EMERGENCY STOP (console)', undefined, true),
      uestop: btn('DYN_unit_estop', 'unit_estop', 'EMERGENCY STOP (unit)', undefined, true),
      westop: btn('DYN_wall_estop', 'wall_estop', 'EMERGENCY OFF (wall)', new THREE.Vector3(-1, 0, 0), true),
      intercom: btn('DYN_intercom_talk', 'intercom', 'Intercom: talk to the patient'),
    };
    // key switch: click/poke toggles
    const key = this.node('DYN_console_key');
    if (key) this.key = this.add({ kind: 'key', id: 'key', obj: key, label: 'Treatment key', on: true, q0: key.quaternion.clone() });

    // grabbables
    const grab = (name, id, label, extra = {}) => {
      const obj = this.node(name);
      if (!obj) return null;
      return this.add(Object.assign({ kind: 'grab', id, obj, label, reach: 0.09 }, extra));
    };
    this.meter = grab('DYN_survey_meter', 'meter', 'Survey meter', {
      holdRot: new THREE.Euler(-0.35, 0, 0), holdPos: new THREE.Vector3(0.2, -0.2, -0.42),
      snap: () => ({ p: this.meter.home.p, q: this.meter.home.q, r: 0.22 }),
    });
    this.phone = grab('DYN_phone', 'phone', 'Phone', {
      holdRot: new THREE.Euler(0, Math.PI / 2, 1.2), holdPos: new THREE.Vector3(0.12, -0.05, -0.18),
      snap: () => ({ p: this.phone.home.p, q: this.phone.home.q, r: 0.2 }),
    });
    this.forceps = grab('DYN_forceps', 'forceps', 'Long forceps', { holdRot: new THREE.Euler(-0.2, 0.3, 0), holdPos: new THREE.Vector3(0.22, -0.2, -0.45) });
    this.cutters = grab('DYN_cutters', 'cutters', 'Cable cutters', { holdRot: new THREE.Euler(-0.2, 0.3, 0), holdPos: new THREE.Vector3(0.22, -0.2, -0.45) });
    this.lid = grab('DYN_container_lid', 'lid', 'Container lid', { on: true,
      holdRot: new THREE.Euler(0, 0, 0), holdPos: new THREE.Vector3(0.0, -0.25, -0.45),
      snap: () => ({ p: this.lid.home.p, q: this.lid.home.q, r: 0.16 }),
    });

    // crank (manual retraction)
    const cr = this.node('DYN_unit_crank');
    if (cr) {
      this.crank = this.add({ kind: 'crank', id: 'crank', obj: cr, label: 'Hand crank (turn clockwise)', reach: 0.08,
        angle: 0, revs: 0, maxRevs: Infinity, q0: cr.quaternion.clone(),
        point: (out) => out.set(-0.072, 0.09, 0).applyMatrix4(cr.matrixWorld) });
    }
    // door
    const door = this.node('DYN_door');
    if (door) {
      this.door = this.add({ kind: 'door', id: 'door', obj: door, label: 'Vault door', reach: 0.12, angle: 0, target: null,
        handles: [B(-1.69, -4.04, 1.02), B(-1.62, -3.86, 1.02)], q0: door.quaternion.clone(),
        point: (out) => {
          // nearest handle in current pose
          const head = this.player.headWorld(_v2);
          let best = null, bd = 1e9;
          for (const h of this.door.handles) {
            const p = this.doorLocal(h);
            const d = p.distanceTo(head);
            if (d < bd) { bd = d; best = p; }
          }
          return out.copy(best);
        } });
      door.updateMatrixWorld(true);
      this.door.inv0 = door.matrixWorld.clone().invert();
    }
    // applicator clamp knob
    const knob = this.node('DYN_clamp_knob');
    if (knob) this.knob = this.add({ kind: 'knob', id: 'knob', obj: knob, label: 'Applicator clamp (loosen)', reach: 0.07, turn: 0, loose: false, q0: knob.quaternion.clone() });
    // applicator
    const app = this.node('DYN_applicator');
    if (app) {
      this.app = this.add({ kind: 'applicator', id: 'applicator', obj: app, label: 'Applicator', reach: 0.06,
        out: 0, free: false, inContainer: false, p0: app.position.clone(), q0: app.quaternion.clone(),
        axis: new THREE.Vector3(0, 0, 1).applyQuaternion(app.quaternion).normalize(),
        point: (out) => out.set(0, 0, -0.06).applyMatrix4(app.matrixWorld),
        holdRot: new THREE.Euler(0.3, 0.2, 0), holdPos: new THREE.Vector3(0.18, -0.22, -0.5) });
    }
    this.containerMouth = (this.world.markers.container_mouth || { position: B(-1.12, -0.02, 0.81) }).position.clone();
  }

  doorLocal(pHome) {
    // transform a point defined on the closed door to the door's current pose
    const d = this.door.obj;
    d.updateMatrixWorld(true);
    return pHome.clone().applyMatrix4(this.door.inv0).applyMatrix4(d.matrixWorld);
  }

  setDoorAngle(a) {
    const d = this.door;
    d.angle = Math.max(-1.75, Math.min(0, a));
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.angle);
    d.obj.quaternion.copy(d.q0).premultiply(_q);
    const open = d.angle < -0.06;
    if (open !== d.wasOpen) {
      d.wasOpen = open;
      this.emit(open ? 'door:open' : 'door:close');
      this.audio.oneShot(open ? 'clunk' : 'clunk', B(-1.6, -3.9, 1.0), 0.7);
      if (open) this.audio.oneShot('whoosh', B(-2.1, -3.9, 1.2), 0.5);
    }
  }

  // ------------------------------------------------------------ helpers
  press(it, how = 'poke') {
    if (it.kind === 'key') {
      it.on = !it.on;
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.on ? 0 : -Math.PI / 2);
      it.obj.quaternion.copy(it.q0).multiply(_q);
      this.audio.oneShot('btn', it.obj.getWorldPosition(_v), 0.8);
      this.emit('key', it.on);
      return;
    }
    if (it.pressed && it.latch) return;
    it.pressed = true; it.t = 0;
    this.audio.oneShot('btn', it.obj.getWorldPosition(_v), 1.0);
    this.emit('press:' + it.id, how);
  }

  resetButtons() {
    for (const k of Object.values(this.btn)) if (k) { k.pressed = false; k.obj.position.copy(k.base); }
  }

  animateButtons(dt) {
    for (const k of Object.values(this.btn)) {
      if (!k) continue;
      const depth = k.pressed ? (k.latch ? 0.007 : 0.006 * Math.max(0, 1 - k.t / 0.25)) : 0;
      if (!k.latch && k.pressed) { k.t += dt; if (k.t > 0.3) k.pressed = false; }
      const ax = k.axis.clone().applyQuaternion(k.obj.quaternion);
      k.obj.position.copy(k.base).addScaledVector(ax, depth);
    }
  }

  pressables() {
    const out = [];
    for (const k of Object.values(this.btn)) if (k && k.enabled()) out.push(k);
    if (this.key && this.key.enabled()) out.push(this.key);
    return out;
  }

  // Controller ray against the buttons' boxes (padded so a small button is easy to hit).
  // The occlusion raycast against the room is the expensive part, so it runs when the
  // target changes, on a trigger pull, and a few times a second otherwise.
  aimButton(h) {
    ray.set(h.rayO, h.rayD);
    let best = null;
    for (const k of this.pressables()) {
      _box.setFromObject(k.obj).expandByScalar(0.012);
      const p = ray.ray.intersectBox(_box, _v);
      if (!p) continue;
      const dist = p.distanceTo(h.rayO);
      if (dist > 2.5 || (best && dist >= best.dist)) continue;
      best = { k, dist };
    }
    if (!best) { h._aim = null; return null; }
    const c = h._aim || (h._aim = { k: null, t: 0, blocked: false });
    c.t -= 1;
    if (c.k !== best.k || c.t <= 0 || h.triggerDown) {
      ray.far = best.dist;
      const occ = ray.intersectObjects(this.world.colliders, false)[0];
      ray.far = Infinity;
      c.blocked = !!(occ && occ.distance < best.dist - 0.03);
      c.k = best.k; c.t = 8;
    }
    return c.blocked ? null : best;
  }

  showButtonRing(i, k) {
    this._rings = this._rings || [];
    let r = this._rings[i];
    if (!r) {
      r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
      r.renderOrder = 10; r.visible = false;
      this.world.scene.add(r);
      this._rings[i] = r;
    }
    this._ringSeen = this._ringSeen || new Set();
    this._ringSeen.add(i);
    if (!k) { r.visible = false; return; }
    _box.setFromObject(k.obj);
    const s = _box.getSize(_v2);
    r.scale.setScalar(Math.max(s.x, s.y, s.z) * 0.5 + 0.01);
    r.position.copy(_box.getCenter(_v));
    r.lookAt(this.player.headWorld(_v2));
    r.visible = true;
  }

  hideUnusedRings() {
    for (const [i, r] of (this._rings || []).entries()) if (r && !(this._ringSeen && this._ringSeen.has(i))) r.visible = false;
    if (this._ringSeen) this._ringSeen.clear();
  }

  canGrab(it) { return it.enabled() && !(it.grabbedBy); }

  attach(it, handKey, handMatrix) {
    it.grabbedBy = handKey;
    const off = handMatrix.clone().invert().multiply(it.obj.matrixWorld);
    this.held.set(handKey, { item: it, offset: off });
    this.falling = this.falling.filter(f => f.it !== it);
    this.emit('grab:' + it.id);
    if (it.id === 'lid') { it.on = false; this.emit('lid:off'); }
  }

  release(handKey) {
    const h = this.held.get(handKey);
    if (!h) return;
    this.held.delete(handKey);
    const it = h.item;
    it.grabbedBy = null;
    this.drop(it);
  }

  // place on snap target, into the container, or let it fall to the nearest surface
  drop(it) {
    const p = it.obj.position;
    if (it.id === 'applicator' && it.free) {
      const m = this.containerMouth;
      const dh = Math.hypot(p.x - m.x, p.z - m.z);
      if (dh < 0.22 && p.y > m.y - 0.15 && p.y < m.y + 0.6) {
        if (this.lid && this.lid.on && !this.lid.grabbedBy) this.hint?.('The container lid is on. Take it off first (use your other hand).');
        else { this.putInContainer(); return; }
      }
    }
    if (it.snap) {
      const s = it.snap();
      if (p.distanceTo(s.p) < s.r) {
        if (it.id === 'lid' && this.app && this.app.inContainer === false && this.app.free) { /* allowed anyway */ }
        this.tween(it, s.p, s.q, 0.18, () => { this.emit('snap:' + it.id); if (it.id === 'lid') { it.on = true; this.emit('lid:on'); } });
        return;
      }
    }
    this.emit('release:' + it.id);
    // fall
    ray.set(p.clone().add(new THREE.Vector3(0, 0.02, 0)), new THREE.Vector3(0, -1, 0));
    ray.far = 3;
    const hits = ray.intersectObjects(this.world.colliders, false);
    const y = hits.length ? hits[0].point.y : 0;
    _box.setFromObject(it.obj);
    const below = p.y - _box.min.y;
    this.falling.push({ it, vy: 0, y: y + below + 0.002 });
  }

  tween(it, p, q, dur, done) {
    it.tw = { p0: it.obj.position.clone(), q0: it.obj.quaternion.clone(), p, q, t: 0, dur, done };
  }

  putInContainer() {
    const a = this.app;
    a.free = false; a.inContainer = true;
    const m = this.containerMouth;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); // tip pointing down
    const target = new THREE.Vector3(m.x, m.y - 0.015, m.z);   // tip rests on the well floor, connector just below the rim
    this.tween(a, target, q, 0.35, () => this.emit('applicator:container'));
    this.audio.oneShot('clunk', m, 0.5);
  }

  // ------------------------------------------------------------ per-frame
  update(dt, scenarioLocked) {
    this.locked = scenarioLocked;
    this.animateButtons(dt);
    // tweens and falling
    for (const it of this.items) {
      if (it.tw) {
        const w = it.tw; w.t += dt;
        const k = Math.min(1, w.t / w.dur), e = k * k * (3 - 2 * k);
        it.obj.position.lerpVectors(w.p0, w.p, e);
        it.obj.quaternion.slerpQuaternions(w.q0, w.q, e);
        if (k >= 1) { it.tw = null; w.done && w.done(); }
      }
    }
    this.falling = this.falling.filter((f) => {
      f.vy -= 9.8 * dt;
      f.it.obj.position.y += f.vy * dt;
      if (f.it.obj.position.y <= f.y) { f.it.obj.position.y = f.y; this.audio.oneShot('tick', f.it.obj.position, 0.6); return false; }
      return true;
    });
    if (this.player.mode === 'xr') this.updateXR(dt); else { this.hideUnusedRings(); this.updateDesktop(dt); }
    if (this.app) this.constrainTube();
  }

  // keep the applicator within transfer-tube reach of the turret
  constrainTube() {
    const port = this.world.markers.turret_port;
    if (!port || !this.app.free) return;
    const p = this.app.obj.position, pp = port.position;
    const L = 1.45, d = p.distanceTo(pp);
    if (d > L) p.sub(pp).multiplyScalar(L / d).add(pp);
  }

  handMatrix(h) { return _m.compose(h.pos, h.quat, new THREE.Vector3(1, 1, 1)).clone(); }

  nearest(pos, kinds, maxD) {
    let best = null, bd = maxD;
    for (const it of this.items) {
      if (!kinds.includes(it.kind) || !it.enabled()) continue;
      if (it.kind === 'grab' && it.grabbedBy) continue;
      let d;
      if (it.kind === 'grab') {
        _box.setFromObject(it.obj);
        d = _box.distanceToPoint(pos) - 0.0;
        d = Math.max(d, 0) + 0.01;
        if (d > it.reach) continue;
      } else if (it.kind === 'applicator') {
        // distance to the exposed rod segment
        const a = _v.set(0, 0, 0).applyMatrix4(it.obj.matrixWorld);
        const b = _v2.set(0, 0, -0.17).applyMatrix4(it.obj.matrixWorld);
        d = new THREE.Line3(a, b).closestPointToPoint(pos, true, new THREE.Vector3()).distanceTo(pos);
        if (it.free) { _box.setFromObject(it.obj); d = Math.min(d, Math.max(_box.distanceToPoint(pos), 0)); }
        if (d > it.reach) continue;
      } else {
        d = this.center(it, _v).distanceTo(pos);
        if (d > it.reach) continue;
      }
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  updateXR(dt) {
    let haloAt = null;
    for (const h of this.player.hands) {
      if (!h.active) { h._lastTip = null; continue; }
      const key = 'h' + h.i;
      const held = this.held.get(key);
      // --- holding something
      if (held) {
        const it = held.item;
        if (h.squeezeUp || !h.squeeze) { this.release(key); continue; }
        if (it.kind === 'grab' || (it.kind === 'applicator' && it.free)) {
          const M = this.handMatrix(h).multiply(held.offset);
          M.decompose(it.obj.position, it.obj.quaternion, _v);
          if (it.id === 'meter' && (h.aDown || h.triggerDown)) this.emit('meter:power');
        } else if (it.kind === 'crank') this.crankFromHand(it, h);
        else if (it.kind === 'door') this.doorFromHand(it, h);
        else if (it.kind === 'knob') this.knobFromHand(it, h, dt);
        else if (it.kind === 'applicator') this.pullFromHand(it, h, held);
        continue;
      }
      // --- poke buttons: fingertip for hands; tip marker or controller nose for controllers.
      // Distance is measured to the button's box, not its center, so tall mushroom caps
      // register on contact, and the tip's path since last frame is swept so a quick jab counts.
      const pokeTol = h.isHand ? 0.008 : 0.012;
      if (!h._lastTip) h._lastTip = h.tip.clone();
      let near = null;
      for (const k of this.pressables()) {
        _box.setFromObject(k.obj);
        let d = _box.distanceToPoint(h.tip);
        if (!h.isHand) d = Math.min(d, _box.distanceToPoint(h.rayO));
        if (d > pokeTol && sweepHitsBox(h._lastTip, h.tip, _box)) d = 0;
        const arm = k._arm || (k._arm = {});
        if (d <= pokeTol && !arm[h.i]) { arm[h.i] = true; this.press(k, 'poke'); this.player.haptic(h, 0.7, 45); }
        if (d > 0.04) arm[h.i] = false;
        if (d < 0.06 && (!near || d < near.d)) near = { k, d };
      }
      h._lastTip.copy(h.tip);
      // --- point and pull the trigger (controllers): visible laser and a ring on the target
      let aim = null;
      if (!h.isHand) {
        aim = this.aimButton(h);
        if (aim && !(h.uiDist < aim.dist)) {
          h.ray.visible = true; h.ray.scale.z = aim.dist;
          if (h.triggerDown) { this.press(aim.k, 'ray'); this.player.haptic(h, 0.6, 35); }
        } else aim = null;
      }
      this.showButtonRing(h.i, aim ? aim.k : near ? near.k : null);
      // --- grab
      const cand = this.nearest(h.pos, ['grab', 'crank', 'door', 'knob', 'applicator'], 0.14);
      if (cand) haloAt = haloAt || this.center(cand, new THREE.Vector3());
      if (h.squeezeDown && cand) {
        if (cand.kind === 'applicator' && !cand.free) {
          if (!this.knob || !this.knob.loose) { this.player.haptic(h, 1, 120); this.hint?.('The applicator is clamped. Loosen the clamp knob first.'); continue; }
          if (cand.inContainer) continue;
          this.held.set(key, { item: cand, start: h.pos.clone(), out0: cand.out });
          cand.grabbedBy = key;
          this.emit('grab:applicator');
          continue;
        }
        if (cand.kind === 'grab' || (cand.kind === 'applicator' && cand.free)) { this.attach(cand, key, this.handMatrix(h)); this.player.haptic(h, 0.4, 30); }
        else {
          this.held.set(key, { item: cand, start: h.pos.clone() });
          cand.grabbedBy = key;
          if (cand.kind === 'crank') { cand._ref = null; this.emit('grab:crank'); }
          if (cand.kind === 'door') { cand._ref = null; }
          if (cand.kind === 'knob') { cand._ref = null; cand._hold = 0; }
          this.player.haptic(h, 0.3, 25);
        }
      }
    }
    // show reach halo
    if (haloAt) { this.halo.visible = true; this.halo.position.copy(haloAt); this.halo.lookAt(this.player.headWorld(_v)); }
    else this.halo.visible = false;
    this.hideUnusedRings();
  }

  // ---- crank: hand angle around crank axis
  crankFromHand(it, h) {
    const o = it.obj;
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(it.q0).normalize();
    const c = o.getWorldPosition(new THREE.Vector3());
    const r = h.pos.clone().sub(c); r.addScaledVector(axis, -r.dot(axis));
    if (r.length() < 0.015) return;
    r.normalize();
    if (!it._ref) { it._ref = r.clone(); return; }
    const cross = new THREE.Vector3().crossVectors(it._ref, r);
    let da = Math.atan2(cross.dot(axis), it._ref.dot(r));
    it._ref.copy(r);
    this.turnCrank(it, da, h);
  }
  turnCrank(it, da, h) {
    if (da > 0 && it.revs >= it.maxRevs) { da = 0; if (!it._jamT || performance.now() - it._jamT > 600) { it._jamT = performance.now(); this.emit('crank:jam'); if (h) this.player.haptic(h, 1, 90); } }
    if (da < 0) da = Math.max(da, -0.2);
    const before = Math.floor(it.angle / (Math.PI / 6));
    it.angle += da;
    it.revs = Math.max(0, it.angle / (2 * Math.PI));
    _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), it.angle);
    it.obj.quaternion.copy(it.q0).multiply(_q);
    const after = Math.floor(it.angle / (Math.PI / 6));
    if (after !== before) { this.audio.oneShot('tick', it.obj.getWorldPosition(_v), 0.9); if (h) this.player.haptic(h, 0.35, 15); }
    if (da !== 0) this.emit('crank:turn', it.revs);
  }

  doorFromHand(it, h) {
    const hinge = it.obj.position;
    const ang = Math.atan2(-(h.pos.z - hinge.z), h.pos.x - hinge.x);  // angle of hand around hinge (three yaw)
    if (it._ref == null) { it._ref = ang - it.angle; return; }
    this.setDoorAngle(ang - it._ref);
  }

  knobFromHand(it, h, dt) {
    if (it.loose) return;
    // wrist roll around the knob axis, or hold for 2 s
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(it.q0).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(h.quat);
    up.addScaledVector(axis, -up.dot(axis));
    if (up.lengthSq() > 1e-4) {
      up.normalize();
      if (it._ref) {
        const cr = new THREE.Vector3().crossVectors(it._ref, up);
        const da = Math.atan2(cr.dot(axis), it._ref.dot(up));
        it.turn += Math.abs(da);
      }
      it._ref = up.clone();
    }
    it._hold = (it._hold || 0) + dt;
    this.spinKnob(it, it.turn + it._hold * 1.6, h);
  }
  spinKnob(it, amount, h) {
    _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -amount);
    it.obj.quaternion.copy(it.q0).multiply(_q);
    const step = Math.floor(amount / 0.5);
    if (step !== it._step) { it._step = step; this.audio.oneShot('tick', it.obj.getWorldPosition(_v), 0.4); if (h) this.player.haptic(h, 0.25, 12); }
    if (amount > 3.4 && !it.loose) {
      it.loose = true;
      this.audio.oneShot('btn', it.obj.getWorldPosition(_v), 0.8);
      this.emit('knob:loose');
    }
  }

  pullFromHand(it, h, held) {
    const d = h.pos.clone().sub(held.start).dot(it.axis);
    this.setPull(it, held.out0 + d);
  }
  setPull(it, out) {
    if (it.free || it.inContainer) return;
    const before = it.out;
    it.out = Math.max(0, Math.min(0.16, out));
    it.obj.position.copy(it.p0).addScaledVector(it.axis, it.out);
    if (Math.abs(it.out - before) > 1e-4) this.emit('applicator:pull', it.out);
    if (it.out >= 0.145) {
      it.free = true;
      this.emit('applicator:out');
      // convert the held state to a free grab
      for (const [k, v] of this.held) if (v.item === it) {
        if (k === 'desk') { this.deskHeld = it; this.held.delete(k); }
        else {
          const h = this.player.hands[+k.slice(1)];
          this.held.delete(k);
          it.grabbedBy = null;
          this.attach(it, k, this.handMatrix(h));
        }
      }
    }
  }

  // ------------------------------------------------------------ desktop
  deskPick() {
    const cam = this.player.camera;
    ray.setFromCamera(new THREE.Vector2(0, 0), cam);
    ray.far = 2.2;
    const objs = this.items.filter(i => i.enabled() && !(i.kind === 'grab' && this.deskHeld === i) && i !== this.deskHeld).map(i => i.obj);
    const hits = ray.intersectObjects(objs, true);
    if (!hits.length) return null;
    // occlusion against static scenery
    const occ = ray.intersectObjects(this.world.colliders, false)[0];
    const h = hits[0];
    if (occ && occ.distance < h.distance - 0.03) return null;
    return { it: h.object.userData.item, point: h.point, dist: h.distance };
  }

  updateDesktop(dt) {
    const P = this.player, cam = P.camera, mouse = P.mouse;
    const pick = P.locked ? this.deskPick() : null;
    this.hover = pick;
    let label = '';
    if (pick && pick.it) {
      const it = pick.it;
      label = it.label;
      if (it.kind === 'grab' && this.deskHeld) label = '';
      if (it.kind === 'door') label = this.door.angle < -0.3 ? 'Close the door' : 'Open the door';
      if (it.kind === 'applicator' && !it.free) label = (this.knob && !this.knob.loose) ? 'Applicator (clamped)' : 'Hold to withdraw the applicator';
      if (it.kind === 'crank') label = 'Hold to turn the hand crank';
      if (it.kind === 'knob') label = this.knob.loose ? 'Clamp loosened' : 'Hold to loosen the clamp';
    }
    // targets while holding
    if (this.deskHeld && pick && pick.it === this.lid && this.deskHeld.id === 'applicator') label = 'Place in the emergency container';
    this.crossEl.classList.toggle('hot', !!label);
    this.tipEl.style.display = label ? 'block' : 'none';
    this.tipEl.textContent = label;

    // held object follows the camera
    if (this.deskHeld) {
      const it = this.deskHeld;
      const hp = it.holdPos || new THREE.Vector3(0.2, -0.2, -0.45);
      const hr = it.holdRot || new THREE.Euler();
      const tq = cam.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(hr));
      const tp = hp.clone().applyMatrix4(cam.matrixWorld);
      it.obj.position.lerp(tp, Math.min(1, dt * 14));
      it.obj.quaternion.slerp(tq, Math.min(1, dt * 14));
    }

    const ongoing = this.deskAction;
    if (ongoing) {
      if (!mouse.down) { this.deskAction = null; if (ongoing.it.kind === 'applicator' && !ongoing.it.free) this.emit('applicator:stop'); }
      else {
        const it = ongoing.it;
        if (it.kind === 'crank') this.turnCrank(it, dt * 2 * Math.PI * 0.9, null);
        if (it.kind === 'knob') { ongoing.t += dt; this.spinKnob(it, ongoing.t * 3.0, null); }
        if (it.kind === 'applicator') this.setPull(it, it.out + dt * 0.11);
      }
    }
    if (mouse.clicked && P.locked) {
      if (pick && pick.it) this.deskUse(pick.it, pick);
      else if (this.deskHeld && (this.deskHeld.id === 'applicator' || this.deskHeld.id === 'lid')) {
        ray.setFromCamera(new THREE.Vector2(0, 0), cam); ray.far = 2.2;
        const hit = ray.intersectObjects(this.world.colliders, false)[0];
        if (hit && this.isContainer({ point: hit.point })) this.deskUse(this.lid, { point: hit.point });
      }
    }
  }

  deskUse(it, pick) {
    const held = this.deskHeld;
    if (it.kind === 'button' || it.kind === 'key') { this.press(it, 'click'); return; }
    if (held && held.id === 'lid' && (this.isContainer(pick) || it === this.app)) {
      this.deskHeld = null; held.grabbedBy = null; const s = held.snap();
      this.tween(held, s.p, s.q, 0.25, () => { held.on = true; this.emit('lid:on'); }); return;
    }
    if (it.kind === 'door') {
      const target = this.door.angle < -0.3 ? 0 : -1.6;
      this.doorAnim = { from: this.door.angle, to: target, t: 0 };
      return;
    }
    if (it.kind === 'crank') { this.deskAction = { it, t: 0 }; this.emit('grab:crank'); return; }
    if (it.kind === 'knob') { if (!it.loose) this.deskAction = { it, t: 0 }; return; }
    if (it.kind === 'applicator') {
      if (it.inContainer) return;
      if (!it.free) {
        if (!this.knob || !this.knob.loose) { this.hint?.('The applicator is clamped. Loosen the clamp knob first.'); return; }
        if (held) { this.hint?.('Put down what you are holding first (G).'); return; }
        this.held.set('desk', { item: it });
        this.deskAction = { it, t: 0 };
        this.emit('grab:applicator');
        return;
      }
    }
    // placing held things on targets
    if (held) {
      if (held.id === 'applicator' && (it === this.lid || this.isContainer(pick))) {
        this.deskHeld = null; held.grabbedBy = null;
        if (this.lid && this.lid.on) {   // one-handed desktop: set the lid aside on the cart
          this.lid.on = false; this.emit('lid:off');
          const side = B(-0.92, -0.80, 0.936);   // onto the mayo tray
          this.tween(this.lid, side, this.lid.home.q, 0.25);
        }
        this.putInContainer(); return;
      }
      if (held.id === 'lid' && (this.isContainer(pick) || it === this.app)) { this.deskHeld = null; held.grabbedBy = null; const s = held.snap(); this.tween(held, s.p, s.q, 0.25, () => { held.on = true; this.emit('lid:on'); }); return; }
      this.hint?.('Your hands are full. Press G to put it down.');
      return;
    }
    if (it.kind === 'grab' || (it.kind === 'applicator' && it.free)) {
      this.deskHeld = it; it.grabbedBy = 'desk';
      this.falling = this.falling.filter(f => f.it !== it);
      this.emit('grab:' + it.id);
      if (it.id === 'lid') { it.on = false; this.emit('lid:off'); }
    }
  }

  isContainer(pick) {
    if (!pick) return false;
    const m = this.containerMouth;
    return Math.hypot(pick.point.x - m.x, pick.point.z - m.z) < 0.25 && Math.abs(pick.point.y - m.y) < 0.4;
  }

  deskDrop() {
    const it = this.deskHeld;
    if (!it) return;
    this.deskHeld = null; it.grabbedBy = null;
    // near the container with the applicator -> in it; meter near cradle -> cradle
    const cam = this.player.camera;
    ray.setFromCamera(new THREE.Vector2(0, 0), cam); ray.far = 2.0;
    const hit = ray.intersectObjects(this.world.colliders, false)[0];
    if (it.id === 'applicator') {
      const m = this.containerMouth, hp = this.player.headWorld(_v);
      if (Math.hypot(hp.x - m.x, hp.z - m.z) < 1.4 && hit && Math.hypot(hit.point.x - m.x, hit.point.z - m.z) < 0.35) { this.putInContainer(); return; }
    }
    if (it.snap) {
      const s = it.snap();
      const hp = this.player.headWorld(_v);
      if (hp.distanceTo(s.p) < 1.4 && hit && hit.point.distanceTo(s.p) < 0.45) { this.tween(it, s.p, s.q, 0.25, () => { this.emit('snap:' + it.id); if (it.id === 'lid') { it.on = true; this.emit('lid:on'); } }); return; }
    }
    if (hit) {
      const up = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.player.yaw, 0));
      _box.setFromObject(it.obj);
      const half = (_box.max.y - _box.min.y) / 2;
      this.tween(it, hit.point.clone().add(new THREE.Vector3(0, half + 0.01, 0)), it.home.q.clone().premultiply(up), 0.25, () => this.emit('release:' + it.id));
    } else this.drop(it);
  }

  stepDoorAnim(dt) {
    const a = this.doorAnim;
    if (!a) return;
    a.t += dt / 1.1;
    const k = Math.min(1, a.t), e = k * k * (3 - 2 * k);
    this.setDoorAngle(a.from + (a.to - a.from) * e);
    if (k >= 1) this.doorAnim = null;
  }

  // hand positions for dosimetry (world)
  handPositions(out) {
    const P = this.player;
    if (P.mode === 'xr') {
      const L = P.hands.find(h => h.handedness === 'left' && h.active), R = P.hands.find(h => h.handedness === 'right' && h.active);
      const head = P.headWorld(new THREE.Vector3());
      out.handL.copy(L ? L.pos : head.clone().add(new THREE.Vector3(-0.2, -0.7, 0)));
      out.handR.copy(R ? R.pos : head.clone().add(new THREE.Vector3(0.2, -0.7, 0)));
      return;
    }
    const cam = P.camera;
    const busy = this.deskHeld || this.deskAction;
    if (busy) {
      const it = this.deskHeld || this.deskAction.it;
      let p;
      if (it.kind === 'applicator') p = new THREE.Vector3(0, 0, -0.02).applyMatrix4(it.obj.matrixWorld);
      else if (it.kind === 'crank') p = this.center(it, new THREE.Vector3());
      else p = it.obj.getWorldPosition(new THREE.Vector3());
      out.handR.copy(p);
      out.handL.copy(p).add(new THREE.Vector3(0.0, 0.0, 0.0).set(-0.15, 0, 0).applyQuaternion(cam.getWorldQuaternion(_q)));
      if (it.kind !== 'applicator' && it.kind !== 'crank') out.handL.copy(new THREE.Vector3(-0.22, -0.75, -0.05).applyMatrix4(cam.matrixWorld));
    } else {
      out.handR.copy(new THREE.Vector3(0.22, -0.78, -0.05).applyMatrix4(cam.matrixWorld));
      out.handL.copy(new THREE.Vector3(-0.22, -0.78, -0.05).applyMatrix4(cam.matrixWorld));
    }
  }

  // reset everything for a new run
  reset() {
    for (const it of this.items) {
      it.obj.position.copy(it.home.p); it.obj.quaternion.copy(it.home.q);
      it.grabbedBy = null; it.tw = null;
    }
    this.held.clear(); this.deskHeld = null; this.deskAction = null; this.falling = []; this.doorAnim = null;
    this.resetButtons();
    if (this.crank) { this.crank.angle = 0; this.crank.revs = 0; this.crank.maxRevs = Infinity; }
    if (this.door) { this.door.angle = 0; this.door.wasOpen = false; }
    if (this.knob) { this.knob.turn = 0; this.knob.loose = false; this.knob._hold = 0; }
    if (this.app) { this.app.out = 0; this.app.free = false; this.app.inContainer = false; }
    if (this.key) { this.key.on = true; }
    if (this.lid) this.lid.on = true;
  }
}
