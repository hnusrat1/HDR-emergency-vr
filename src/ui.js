// UI: in-world canvas panels (VR + desktop crosshair), hint/subtitle HUD, debrief rendering.
import * as THREE from 'three';
import { SCENARIOS } from './scenario.js';
import { B } from './dose.js';

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const ray = new THREE.Raycaster();

export class Panel {
  constructor(mesh, w, h, opts = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = opts.flipY ?? false;
    this.tex.anisotropy = 8;
    this.w = w; this.h = h;
    this.buttons = [];
    if (!mesh) {
      const geo = new THREE.PlaneGeometry(opts.width || 1, (opts.width || 1) * h / w);
      mesh = new THREE.Mesh(geo, null);
      this.tex.flipY = true;
    }
    this.mesh = mesh;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, transparent: !!opts.transparent, side: THREE.DoubleSide });
    mesh.traverse(o => { if (o.isMesh) { o.material = mat; o.userData.panel = this; } });
    this.hover = -1;
  }
  clear(bg = '#0e141a') { const g = this.g; g.clearRect(0, 0, this.w, this.h); g.fillStyle = bg; g.fillRect(0, 0, this.w, this.h); this.buttons = []; }
  button(x, y, w, h, label, onClick, style = 'primary') {
    const g = this.g;
    const i = this.buttons.length;
    const hov = this.hover === i;
    const col = { primary: '#f2c21b', ghost: '#263240', danger: '#c0262b', ok: '#2e8b57' }[style] || style;
    g.fillStyle = hov ? shade(col, 1.15) : col;
    rr(g, x, y, w, h, 12); g.fill();
    g.fillStyle = style === 'primary' ? '#1a1400' : '#f2f5f8';
    g.font = `700 ${Math.round(h * 0.38)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 + 1);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    this.buttons.push({ x, y, w, h, onClick });
  }
  flush() { this.tex.needsUpdate = true; }
  hit(uv) {
    const x = uv.x * this.w, y = (this.tex.flipY ? 1 - uv.y : uv.y) * this.h;
    return this.buttons.findIndex(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }
}

function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
function shade(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }
function wrap(g, text, maxW) {
  const words = String(text).split(' '); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
const fmtT = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const fmtmSv = (x) => (x >= 1 ? x.toFixed(2) + ' mSv' : (x * 1000).toFixed(x * 1000 >= 100 ? 0 : 1) + ' µSv');

export const TEACH = {
  interrupt: ['Most retraction faults clear at the console. Note the time on the clock the moment the fault appears; the reconstruction of every dose starts from it.'],
  cestop: ['The console emergency stop drives the battery-backed retraction motor. It costs no dose to try, so it comes before anyone opens the door.'],
  uestop: ['When the console has lost the unit, the emergency stop on the afterloader acts locally. Go in with the meter on and watch it as you approach; it tells you where the source is.'],
  crank: ['Manual retraction is the last mechanical option. You are within a metre of the patient while you crank, so turn steadily, stand to the side of the source, and leave as soon as the meter drops.'],
  stuck: ['With a jammed cable, every minute adds roughly 1.7 Gy at the prescription depth for a 10 Ci source. The priority is to get the source out of the patient: release the clamp, withdraw along the applicator axis, drop it into the container, close the lid. Your hands are close to the source for those seconds; keep them on the connector end.'],
  silent: ['In November 1992, at the Indiana Regional Cancer Center in Pennsylvania, an Ir-192 source broke from its drive wire and stayed in a patient\'s catheter. The console showed the source as retracted. The area monitor alarmed, staff treated it as a false alarm, and no handheld survey was done. The patient returned to her nursing home with the source in place and died days later (NRC, NUREG-1480).',
    'The lesson: an independent radiation measurement outranks the console. Survey the patient after every HDR treatment.'],
};

export class UI {
  constructor(world, player, scene, camera) {
    this.world = world; this.player = player; this.scene = scene; this.camera = camera;
    this.panels = [];
    this.hintEl = document.getElementById('hint');
    this.subEl = document.getElementById('sub');
    this.hintText = ''; this.subText = ''; this.subT = 0;
    // VR heads-up strip (hint + subtitle)
    this.hud = new Panel(null, 1024, 200, { width: 0.8, transparent: true });
    this.hud.mesh.position.set(0, -0.3, -1.0);
    this.hud.mesh.rotation.x = -0.18;
    this.hud.mesh.renderOrder = 20;
    this.hud.mesh.material.depthTest = false;
    this.hud.mesh.visible = false;
    camera.add(this.hud.mesh);
    // wall TV panel
    const wall = world.screens['SCREEN_wall'];
    this.wall = wall ? new Panel(wall, 1280, 724) : null;
    if (this.wall) this.panels.push(this.wall);
    // floating panel for VR (briefing/debrief), placed in front of the player on demand
    this.float = new Panel(null, 1280, 900, { width: 1.1 });
    this.float.mesh.visible = false;
    scene.add(this.float.mesh);
    this.panels.push(this.float);
    // phone dial panel
    this.phone = new Panel(null, 640, 520, { width: 0.32 });
    this.phone.mesh.visible = false;
    this.phone.mesh.position.copy(B(2.45, -4.15, 1.12));
    this.phone.mesh.rotation.x = -0.35;
    scene.add(this.phone.mesh);
    this.panels.push(this.phone);
    this.wallState = 'idle';
    this.onAction = null; // (name, arg)
  }

  // ------------------------------------------------------------ HUD
  hint(t) {
    this.hintText = t || '';
    this.hintEl.style.display = this.hintText ? 'block' : 'none';
    this.hintEl.textContent = this.hintText;
    this.drawHUD();
  }
  subtitle(t, who) {
    this.subText = t ? (who === 'patient' ? `Patient: “${t}”` : `${who}: “${t}”`) : '';
    this.subT = t ? 6 + t.length * 0.04 : 0;
    this.subEl.style.display = this.subText ? 'block' : 'none';
    this.subEl.textContent = this.subText;
    this.drawHUD();
  }
  drawHUD() {
    const p = this.hud, g = p.g;
    g.clearRect(0, 0, p.w, p.h);
    let y = 10;
    if (this.subText) {
      g.font = `600 30px ${FONT}`;
      const lines = wrap(g, this.subText, 960);
      g.fillStyle = 'rgba(0,0,0,0.55)'; rr(g, 20, y, 984, 16 + lines.length * 38, 14); g.fill();
      g.fillStyle = '#fff'; lines.forEach((l, i) => g.fillText(l, 40, y + 42 + i * 38));
      y += 26 + lines.length * 38;
    }
    if (this.hintText) {
      g.font = `600 28px ${FONT}`;
      const lines = wrap(g, this.hintText, 940);
      g.fillStyle = 'rgba(12,15,19,0.78)'; rr(g, 20, y, 984, 20 + lines.length * 36, 14); g.fill();
      g.strokeStyle = 'rgba(242,194,27,0.7)'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#f6e7a8'; lines.forEach((l, i) => g.fillText(l, 44, y + 42 + i * 36));
    }
    p.flush();
    p.mesh.visible = this.player.mode === 'xr' && !!(this.hintText || this.subText);
  }
  update(dt) {
    if (this.floatNeedsPlace && this.floatDraw) this.placeFloat();
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.subtitle(''); }
    if (this.player.mode === 'xr') this.hud.mesh.visible = !!(this.hintText || this.subText);
  }

  // ------------------------------------------------------------ panels
  showFloat(drawFn) {
    this.floatDraw = drawFn;
    drawFn(this.float);
    this.floatNeedsPlace = true;
    this.placeFloat();
  }
  placeFloat() {
    const head = this.player.headWorld(new THREE.Vector3());
    if (this.player.mode === 'xr' && head.y - this.player.dolly.position.y < 0.6) { this.float.mesh.visible = false; return; } // XR pose not ready yet
    const dir = this.player.headDir(new THREE.Vector3()); dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    // keep the panel in front of the nearest wall
    ray.set(head, dir); ray.far = 1.4;
    const hit = ray.intersectObjects(this.world.colliders, false)[0];
    const dist = Math.max(0.55, Math.min(1.25, hit ? hit.distance - 0.1 : 1.25));
    this.float.mesh.scale.setScalar(dist / 1.25);
    this.float.mesh.position.copy(head).addScaledVector(dir, dist); this.float.mesh.position.y = head.y - 0.12 * dist / 1.25;
    this.float.mesh.lookAt(head.x, this.float.mesh.position.y, head.z);
    this.float.mesh.visible = true;
    this.floatNeedsPlace = false;
  }
  hideFloat() { this.float.mesh.visible = false; this.floatDraw = null; this.floatNeedsPlace = false; }

  // raycast all visible panels
  pickPanel(o, d) {
    ray.set(o, d); ray.far = 4;
    const meshes = this.panels.filter(p => p.mesh.visible !== false && isVisible(p.mesh)).map(p => p.mesh);
    const hit = ray.intersectObjects(meshes, true)[0];
    if (!hit || !hit.uv) return null;
    const panel = hit.object.userData.panel;
    return { panel, idx: panel.hit(hit.uv), dist: hit.distance };
  }

  handlePointer(o, d, click) {
    const r = this.pickPanel(o, d);
    for (const p of this.panels) if (p.hover !== -1 && (!r || r.panel !== p)) { p.hover = -1; this.redraw(p); }
    if (!r) return false;
    if (r.panel.hover !== r.idx) { r.panel.hover = r.idx; this.redraw(r.panel); }
    if (click && r.idx >= 0) { const b = r.panel.buttons[r.idx]; b && b.onClick && b.onClick(); return true; }
    return r.idx >= 0;
  }
  redraw(p) {
    if (p === this.float && this.floatDraw) this.floatDraw(p);
    else if (p === this.wall) this.drawWall(this.wallState, this._wallArg);
    else if (p === this.phone) this.drawPhone();
  }

  // ------------------------------------------------------------ wall display
  drawWall(state, arg) {
    if (!this.wall) return;
    this.wallState = state; this._wallArg = arg;
    const p = this.wall, g = p.g;
    p.clear('#0d141b');
    g.fillStyle = '#f2c21b'; g.fillRect(0, 0, p.w, 8);
    g.fillStyle = '#e8edf2'; g.font = `700 44px ${FONT}`;
    if (state === 'running') {
      g.fillText('Drill in progress', 50, 90);
      g.font = `500 30px ${FONT}`; g.fillStyle = '#93a1b0';
      g.fillText(arg ? `${arg.name}  ·  ${arg.mode === 'guided' ? 'guided' : 'assessment'}` : '', 50, 140);
      wrap(g, 'When the source is secured, the patient surveyed and the room closed, end the drill here.', 1100).forEach((l, i) => g.fillText(l, 50, 220 + i * 40));
      p.button(50, 560, 360, 96, 'End drill', () => this.onAction?.('end'), 'danger');
      p.button(440, 560, 360, 96, 'Restart', () => this.onAction?.('restart'), 'ghost');
    } else if (state === 'debrief' && arg) {
      this.drawDebriefCanvas(p, arg, true);
    } else {
      g.fillText('HDR Suite B-112', 50, 90);
      g.font = `500 30px ${FONT}`; g.fillStyle = '#93a1b0';
      g.fillText('Emergency drill station', 50, 140);
      p.button(50, 560, 420, 96, 'Start drill', () => this.onAction?.('start'), 'primary');
    }
    p.flush();
  }

  // ------------------------------------------------------------ phone
  openPhone() { this.phone.mesh.visible = true; this.phoneState = 'menu'; this.drawPhone(); }
  closePhone() { this.phone.mesh.visible = false; }
  drawPhone() {
    const p = this.phone, g = p.g;
    p.clear('#11181f');
    g.fillStyle = '#e8edf2'; g.font = `700 34px ${FONT}`; g.fillText('Speed dial', 30, 56);
    if (this.phoneState === 'calling') {
      g.font = `500 30px ${FONT}`; g.fillStyle = '#93a1b0'; g.fillText(this.phoneMsg || 'Calling…', 30, 120);
      p.button(30, 420, 580, 80, 'Hang up', () => { this.onAction?.('hangup'); }, 'ghost');
    } else {
      const who = [['RSO', 'Radiation Safety Officer  x4417'], ['physicist', 'Physicist on call  x5520'], ['radiation oncologist', 'Radiation oncologist  x5531']];
      who.forEach(([k, label], i) => p.button(30, 90 + i * 100, 580, 84, label, () => this.onAction?.('call', k), 'ghost'));
      p.button(30, 400, 580, 84, 'Hang up', () => this.onAction?.('hangup'), 'ghost');
    }
    p.flush();
  }

  // ------------------------------------------------------------ debrief (canvas, VR)
  drawDebriefCanvas(p, R, wall = false) {
    const g = p.g, W = p.w, H = p.h;
    if (!wall) p.clear('#0e141a');
    const sc = R.score;
    const col = sc >= 80 ? '#3fb67a' : sc >= 55 ? '#f2c21b' : '#e5484d';
    g.fillStyle = '#e8edf2'; g.font = `700 40px ${FONT}`; g.fillText('Debrief', 40, 64);
    g.font = `500 24px ${FONT}`; g.fillStyle = '#93a1b0'; g.fillText(`${R.name} · ${R.mode === 'guided' ? 'guided' : 'assessment'} · ${R.activity} Ci`, 40, 100);
    g.fillStyle = col; g.font = `800 92px ${FONT}`; g.textAlign = 'right'; g.fillText(String(sc), W - 40, 100); g.textAlign = 'left';
    const y0 = 130;
    const stat = (x, y, k, v, c = '#e8edf2') => { g.fillStyle = '#93a1b0'; g.font = `500 22px ${FONT}`; g.fillText(k, x, y); g.fillStyle = c; g.font = `700 28px ${FONT}`; g.fillText(v, x, y + 32); };
    stat(40, y0 + 20, 'Source secured', R.secured ? fmtT(R.secT) + ' after fault' : 'NO', R.secured ? '#e8edf2' : '#e5484d');
    stat(330, y0 + 20, 'Your whole body', fmtmSv(R.dose.body));
    stat(570, y0 + 20, 'Your hands (max)', fmtmSv(R.dose.hand));
    stat(830, y0 + 20, 'Patient, 5 mm depth', `+${R.patient.px.toFixed(2)} Gy`, R.patient.medEvent ? '#e5484d' : '#e8edf2');
    // checklist
    let y = y0 + 100;
    g.font = `600 22px ${FONT}`;
    const rows = R.items.slice(0, wall ? 11 : 14);
    for (const it of rows) {
      const ok = it.pts >= it.max * 0.99, part = it.pts > 0 && !ok;
      g.fillStyle = ok ? '#3fb67a' : part ? '#f2c21b' : '#e5484d';
      g.fillText(ok ? '✓' : part ? '◐' : '✗', 40, y);
      g.fillStyle = '#e8edf2'; g.font = `500 22px ${FONT}`; g.fillText(it.text, 74, y);
      g.fillStyle = '#93a1b0'; g.font = `500 20px ${MONO}`; g.fillText(it.t != null ? fmtT(it.t) : '', 600, y);
      g.font = `600 22px ${FONT}`;
      y += 34;
    }
    // notes
    let ny = y0 + 100;
    g.font = `500 21px ${FONT}`;
    const notes = R.notes.slice(0, 4).map(n => n[1]).concat(TEACH[R.kind] ? [TEACH[R.kind][0]] : []);
    for (const n of notes) {
      const lines = wrap(g, n, W - 740);
      g.fillStyle = '#c9d3dc';
      for (const l of lines) { if (ny > H - 140) break; g.fillText(l, 700, ny); ny += 28; }
      ny += 12;
    }
    if (R.patient.medEvent) {
      g.fillStyle = '#ffb4b4'; g.font = `600 20px ${FONT}`;
      wrap(g, `Unplanned ${R.patient.px.toFixed(1)} Gy is more than half the ${R.patient.fx} Gy fraction: likely a reportable medical event (10 CFR 35.3045).`, W - 740).forEach((l) => { if (ny < H - 130) { g.fillText(l, 700, ny); ny += 26; } });
    }
    p.button(40, H - 110, 300, 80, 'Run again', () => this.onAction?.('restart'), 'primary');
    p.button(360, H - 110, 340, 80, 'Different fault', () => this.onAction?.('next'), 'ghost');
    if (!wall && this.player.mode === 'xr') p.button(720, H - 110, 260, 80, 'Exit VR', () => this.onAction?.('exitvr'), 'ghost');
    p.flush();
  }

  briefing(opts, onBegin) {
    const draw = (p) => {
      const g = p.g; p.clear('#0e141a');
      g.fillStyle = '#f2c21b'; g.fillRect(0, 0, p.w, 10);
      g.fillStyle = '#e8edf2'; g.font = `700 50px ${FONT}`; g.fillText('Briefing', 50, 90);
      g.font = `500 30px ${FONT}`; g.fillStyle = '#c9d3dc';
      const t = [
        'Patient: 61-year-old woman, endometrial cancer, post-op vaginal cuff. Fraction 3 of 3, 7 Gy at 5 mm. Vaginal cylinder 3.0 cm, single channel.',
        `Source: Ir-192, ${opts.activity} Ci. Treatment is running. You are the physicist at the console.`,
        'The survey meter is in the cradle left of the console, by the vault door. The emergency container, long forceps and cutters are in the room at the foot of the table.',
        opts.mode === 'guided' ? 'Guided mode: prompts appear at the bottom of your view.' : 'Assessment mode: no prompts. You are scored on the sequence, time and dose.',
      ];
      let y = 160;
      for (const para of t) { for (const l of wrap(g, para, p.w - 100)) { g.fillText(l, 50, y); y += 42; } y += 16; }
      p.button(50, p.h - 140, 380, 100, 'Begin', onBegin, 'primary');
      g.font = `500 24px ${FONT}`; g.fillStyle = '#93a1b0';
      g.fillText('Point and pull the trigger, or touch the button.', 460, p.h - 82);
      p.flush();
    };
    this.showFloat(draw);
  }

  // ------------------------------------------------------------ debrief (DOM, desktop)
  debrief(R) {
    this.lastResult = R;
    this.drawWall('debrief', R);
    if (this.player.mode === 'xr') {
      this.showFloat((p) => this.drawDebriefCanvas(p, R));
      return;
    }
    document.exitPointerLock?.();
    const el = document.getElementById('debrief-body');
    const sc = R.score;
    const col = sc >= 80 ? 'ok' : sc >= 55 ? 'warn' : 'bad';
    const items = R.items.map(it => {
      const ok = it.pts >= it.max * 0.99, part = it.pts > 0 && !ok;
      return `<div class="chk"><span class="${ok ? 'ok' : part ? 'warn' : 'bad'}">${ok ? '✓' : part ? '◐' : '✗'}</span><span>${it.text}</span><span class="t">${it.t != null ? fmtT(it.t) : ''}</span></div>`;
    }).join('');
    const notes = R.notes.map(([k, n]) => `<p class="${k}">${n}</p>`).join('');
    const teach = (TEACH[R.kind] || []).map(t => `<p>${t}</p>`).join('');
    const med = R.patient.medEvent ? `<p class="bad">Unplanned ${R.patient.px.toFixed(2)} Gy is more than half the ${R.patient.fx} Gy fraction and above 0.5 Sv to tissue: likely a reportable medical event under 10 CFR 35.3045 (NRC notified by the next calendar day).</p>` : '';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">
        <div><h2>Debrief</h2><div style="color:var(--muted)">${R.name} · ${R.mode === 'guided' ? 'guided practice' : 'assessment'} · Ir-192 ${R.activity} Ci</div></div>
        <div style="text-align:right"><div class="score ${col}">${sc}</div><div style="color:var(--muted);font-size:12px">out of 100</div></div>
      </div>
      <div class="grid2">
        <div class="box"><h3>Outcome</h3>
          <div class="stat"><span>Source</span><b class="${R.secured ? 'ok' : 'bad'}">${R.secured ? 'secured ' + fmtT(R.secT) + ' after the fault' : (R.sourceInPatient ? 'still in the patient' : 'not secured')}</b></div>
          <div class="stat"><span>Your whole-body dose</span><b>${fmtmSv(R.dose.body)}</b></div>
          <div class="stat"><span>Your lens of eye</span><b>${fmtmSv(R.dose.lens)}</b></div>
          <div class="stat"><span>Your hands (L / R)</span><b>${fmtmSv(R.dose.handL)} / ${fmtmSv(R.dose.handR)}</b></div>
          <div class="stat"><span>Peak dose rate at your body</span><b>${(R.dose.peakBody / 1000).toFixed(1)} mSv/h</b></div>
          <div class="stat"><span>Patient, unplanned at 5 mm</span><b class="${R.patient.medEvent ? 'bad' : ''}">${R.patient.px.toFixed(2)} Gy</b></div>
          <div class="stat"><span>Patient, unplanned at the mucosa</span><b>${R.patient.mucosa.toFixed(2)} Gy</b></div>
          <canvas class="chart" id="dchart" width="900" height="280"></canvas>
          <canvas class="chart" id="dplan" width="900" height="760" style="height:auto;aspect-ratio:900/760;margin-top:10px"></canvas>
          <div style="font-size:12px;color:var(--muted);margin-top:6px">Your path after the fault over the air-kerma rate map at 1.2 m with the source where it stuck. Dots are coloured by the dose rate at your body.</div>
          <div style="font-size:12px;color:var(--muted);margin-top:6px">Dose rate after the fault: <span style="color:#4c8dff">your body</span>, <span style="color:#f2c21b">your hands</span>, <span style="color:#e5484d">patient at 5 mm (Gy/h ÷ 100)</span>. Log scale.</div>
        </div>
        <div class="box"><h3>Checklist</h3>${items}</div>
      </div>
      <div class="teach">${med}${notes}${teach}</div>
      <div class="box" style="margin-top:12px"><h3>Event log</h3><div style="font:12px/1.5 ui-monospace,monospace;color:#c9d3dc;max-height:160px;overflow:auto">${R.log.map(e => `${e.tf >= 0 ? '+' + fmtT(e.tf) : 'pre '}  ${e.msg}`).join('<br>')}</div></div>
      <div class="actions" style="grid-template-columns:repeat(4,1fr)">
        <button class="btn vr" id="db-again">Run again</button>
        <button class="btn desk" id="db-next">Different fault</button>
        <button class="btn desk" id="db-menu">Main menu</button>
        <button class="btn desk" id="db-save">Save report</button>
      </div>`;
    document.getElementById('debrief').classList.remove('hidden');
    document.getElementById('db-again').onclick = () => this.onAction?.('restart');
    document.getElementById('db-next').onclick = () => this.onAction?.('next');
    document.getElementById('db-menu').onclick = () => this.onAction?.('menu');
    document.getElementById('db-save').onclick = () => saveReport(R);
    drawChart(document.getElementById('dchart'), R);
    drawPlan(document.getElementById('dplan'), R);
  }
}

function isVisible(o) { while (o) { if (o.visible === false) return false; o = o.parent; } return true; }

function drawChart(cv, R) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#0f1419'; g.fillRect(0, 0, W, H);
  const data = R.chart;
  if (!data.length) return;
  const tmax = Math.max(10, data[data.length - 1].t);
  const lo = -1, hi = 7; // log10 µSv/h
  const X = (t) => 40 + (W - 60) * t / tmax, Y = (v) => H - 30 - (H - 50) * (Math.log10(Math.max(v, 0.1)) - lo) / (hi - lo);
  g.strokeStyle = '#26313c'; g.fillStyle = '#93a1b0'; g.font = '16px ui-monospace,monospace';
  for (let d = lo; d <= hi; d += 2) { g.beginPath(); g.moveTo(40, Y(10 ** d)); g.lineTo(W - 20, Y(10 ** d)); g.stroke(); g.fillText(d >= 3 ? `${10 ** (d - 3)} mSv/h` : `${10 ** d} µSv/h`, 44, Y(10 ** d) - 4); }
  const line = (key, col, k = 1) => { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); data.forEach((p, i) => { const x = X(p.t), y = Y(p[key] * k); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
  line('pt', '#e5484d', 1e6 / 100);   // Gy/h -> µGy/h scaled down by 100 for display
  line('hand', '#f2c21b');
  line('body', '#4c8dff');
  g.fillStyle = '#93a1b0'; g.fillText(`${Math.round(tmax)} s`, W - 70, H - 8); g.fillText('0', 36, H - 8);
}

function drawPlan(cv, R) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  // plan extents (three coords): x -3.6..3.6, z -3.5..6.7  (north at top)
  const x0 = -3.7, x1 = 3.7, z0 = -3.5, z1 = 6.8;
  const sx = W / (x1 - x0), sz = H / (z1 - z0), s = Math.min(sx, sz);
  const ox = (W - (x1 - x0) * s) / 2, oz = (H - (z1 - z0) * s) / 2;
  const P = (x, z) => [ox + (x - x0) * s, oz + (z - z0) * s];
  g.fillStyle = '#0b0f13'; g.fillRect(0, 0, W, H);
  // dose-rate heat map (source at fault position)
  if (R.faultSrc && R.field) {
    const F = R.field, saveS = F.source.state, saveP = F.source.pos.clone();
    F.source.state = 'applicator'; F.source.pos.fromArray(R.faultSrc);
    const p = new THREE.Vector3();
    const step = 0.08;
    for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
      p.set(x + step / 2, 1.2, z + step / 2);
      const k = F.airKerma(p) * 1.05; // µSv/h
      const l = Math.log10(Math.max(k, 0.1));
      const t = Math.max(0, Math.min(1, (l + 0.5) / 6.5));
      const [a, b] = P(x, z);
      g.fillStyle = heat(t);
      g.fillRect(a, b, step * s + 1, step * s + 1);
    }
    F.source.state = saveS; F.source.pos.copy(saveP);
  }
  // walls & furniture outlines (Blender coords -> plan)
  const rect = (bx0, by0, bx1, by1, col, fill) => { const [a, b] = P(bx0, -by1), [c, d] = P(bx1, -by0); g.strokeStyle = col; g.lineWidth = 2; if (fill) { g.fillStyle = fill; g.fillRect(a, b, c - a, d - b); } g.strokeRect(a, b, c - a, d - b); };
  const wall = 'rgba(230,236,242,0.9)', solid = 'rgba(20,24,28,0.85)';
  [[-3.5, -3.9, -3.0, 3.9], [3.0, -3.9, 3.5, 3.9], [-3.0, 3.4, 3.0, 3.9], [-3.0, -3.9, -2.75, -3.4], [-1.45, -3.9, 3.0, -3.4], [-3.0, -2.1, 1.0, -1.6], [-3.65, -6.75, 3.65, -6.6], [-3.65, -6.75, -3.5, -3.9], [3.5, -6.75, 3.65, -3.9]].forEach(r => rect(...r, wall, solid));
  rect(-0.58, 0.45, -0.02, 1.5, 'rgba(255,255,255,0.6)');       // table
  rect(0.38, -0.5, 0.86, 0.14, 'rgba(255,255,255,0.6)');        // afterloader
  rect(-1.3, -0.2, -0.94, 0.16, 'rgba(255,214,102,0.9)');       // container
  rect(-0.75, -4.65, 2.95, -3.9, 'rgba(255,255,255,0.5)');      // console desk
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '600 18px Inter, sans-serif';
  const lab = (t, bx, by) => { const [a, b] = P(bx, -by); g.fillText(t, a, b); };
  lab('table', -0.55, 1.0); lab('unit', 0.95, -0.2); lab('container', -2.2, 0.0); lab('console', 0.4, -4.3); lab('door', -2.5, -4.25); lab('maze', -1.6, -2.75);
  // path
  const data = R.chart.filter(d => d.x != null);
  for (let i = 0; i < data.length; i++) {
    const d = data[i], [a, b] = P(d.x, d.z);
    const t = Math.max(0, Math.min(1, (Math.log10(Math.max(d.body, 0.1)) + 0.5) / 6.5));
    if (i) { const [pa, pb] = P(data[i - 1].x, data[i - 1].z); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(pa, pb); g.lineTo(a, b); g.stroke(); }
    g.fillStyle = heat(t); g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(a, b, 6, 0, 7); g.fill(); g.stroke();
  }
  if (R.faultSrc) { const [a, b] = P(R.faultSrc[0], R.faultSrc[2]); g.fillStyle = '#fff'; g.beginPath(); g.arc(a, b, 7, 0, 7); g.fill(); g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(a, b, 4, 0, 7); g.fill(); }
  // legend
  const lx = W - 260, ly = H - 40;
  for (let i = 0; i < 200; i++) { g.fillStyle = heat(i / 200); g.fillRect(lx + i, ly, 1, 14); }
  g.fillStyle = '#c9d3dc'; g.font = '14px ui-monospace, monospace';
  g.fillText('0.3 µSv/h', lx - 4, ly - 6); g.fillText('1 Sv/h', lx + 160, ly - 6);
}
function heat(t) {
  const stops = [[0, [20, 30, 60]], [0.3, [30, 90, 160]], [0.5, [40, 170, 120]], [0.68, [240, 200, 60]], [0.84, [240, 110, 40]], [1, [210, 30, 40]]];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i]; const k = (t - a) / (b - a);
    return `rgba(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',')},0.85)`;
  }
  return 'rgba(210,30,40,0.85)';
}

function saveReport(R) {
  const lines = [
    `HDR emergency drill report`, `Date: ${new Date().toLocaleString()}`, `Scenario: ${R.name} (${R.mode}), Ir-192 ${R.activity} Ci`, `Score: ${R.score}/100`, '',
    `Source secured: ${R.secured ? fmtT(R.secT) + ' after fault' : 'NO'}`,
    `Whole body: ${fmtmSv(R.dose.body)}   Lens: ${fmtmSv(R.dose.lens)}   Hands L/R: ${fmtmSv(R.dose.handL)} / ${fmtmSv(R.dose.handR)}`,
    `Patient unplanned dose: ${R.patient.px.toFixed(2)} Gy at 5 mm, ${R.patient.mucosa.toFixed(2)} Gy at mucosa`, '',
    'Checklist:', ...R.items.map(i => `  [${i.pts >= i.max * 0.99 ? 'x' : i.pts > 0 ? '~' : ' '}] ${i.text}${i.t != null ? '  (' + fmtT(i.t) + ')' : ''}`), '',
    'Notes:', ...R.notes.map(n => '  - ' + n[1]), '',
    'Event log (time after fault):', ...R.log.map(e => `  ${e.tf >= 0 ? '+' + fmtT(e.tf) : 'pre  '}  ${e.msg}`),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hdr-drill-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.txt`;
  a.click();
}
