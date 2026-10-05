// Scenario engine: treatment timeline, fault behaviour, escalation logic, hints, checklist and scoring.
import * as THREE from 'three';
import { B } from './dose.js';

export const SCENARIOS = {
  random: { name: 'Random fault', desc: 'One of the faults below, chosen at random. You will not know which until the source does (or does not) move.' },
  interrupt: { name: 'Retracts on INTERRUPT', level: 1, desc: 'The drive reports an obstruction. The source comes home when you interrupt from the console. A warm-up for the console steps.' },
  cestop: { name: 'Console emergency stop', level: 2, desc: 'INTERRUPT does nothing. The emergency retraction motor works when triggered from the console.' },
  uestop: { name: 'Unit emergency stop', level: 3, desc: 'Console commands are not reaching the unit. You have to go in and press the emergency stop on the afterloader.' },
  crank: { name: 'Manual hand crank', level: 4, desc: 'Both motors fail. Retract the source by hand with the crank on the side of the unit.' },
  stuck: { name: 'Stuck source', level: 5, desc: 'The source cable is jammed. Nothing retracts it. Remove the applicator and put it in the emergency container.' },
  silent: { name: 'Silent failure (Indiana, 1992)', level: 6, desc: 'The console reports a normal end. Watch the area monitor. Modeled on the 1992 Indiana, PA event in which a source stayed in a patient.' },
};
const ORDER = ['interrupt', 'cestop', 'uestop', 'crank', 'stuck', 'silent'];

const ENTRY = B(-0.30, 0.47, 0.935); // introitus (three coords)

export class Scenario {
  constructor(ctx) {
    Object.assign(this, ctx); // world, interact, field, dosim, devices, audio, ui, player
    this.phase = 'idle';
    this.events = [];
    this.opts = { scenario: 'random', mode: 'guided', activity: 10, unit: 'mR' };
    this.t = 0;
  }

  // ------------------------------------------------------------ setup
  start(opts) {
    Object.assign(this.opts, opts || {});
    let kind = this.opts.scenario;
    if (kind === 'random') {
      const w = { interrupt: 0.6, cestop: 1, uestop: 1.2, crank: 1.3, stuck: 1.5, silent: 1.0 };
      const tot = Object.values(w).reduce((a, b) => a + b, 0);
      let r = Math.random() * tot;
      for (const k of ORDER) { r -= w[k]; if (r <= 0) { kind = k; break; } }
    }
    this.kind = kind;
    this.level = SCENARIOS[kind].level;
    this.field.setActivity(this.opts.activity);
    this.dosim.reset();
    this.interact.reset();
    this.events = [];
    this.flags = {};
    this.attempts = [];
    this.t = 0;
    this.faultAt = this.opts.mode === 'guided' ? 16 : 14 + Math.random() * 18;
    this.faultT = null;
    this.securedT = null;
    this.phase = 'pre';
    this.retracted = false;
    this.consoleSaysSafe = false;
    this.source = { where: 'applicator', dwell: 2, moving: null };
    this.attemptBusy = 0;
    this.faultSrc = null;
    // dwell plan, seconds (scaled to activity: 7 Gy at 5 mm ≈ 4 min at 10 Ci)
    const scale = 10 / this.opts.activity;
    this.dwells = [34, 31, 30, 30, 30, 32, 37].map(x => x * scale);
    this.treatT = this.dwells.slice(0, 2).reduce((a, b) => a + b, 0) + 9;   // already 2 dwells in
    this.log('Treatment in progress. Channel 1, vaginal cylinder 3.0 cm.');
    this.interact.crank.maxRevs = Infinity;
    this.devices.setState({ mode: 'treating', consoleSafe: false });
    this.hintIdx = 0;
    this.lastHint = '';
    this.patientLines = { fault: false, enter: false, pull: false, after: false };
    this.resultShown = false;
    this.field.source.state = 'applicator';
    this.field.door.open = false;
    this.ui.hint(this.opts.mode === 'guided' ? 'Treatment is running. Watch the console, the CCTV and the area monitor.' : '');
  }

  log(msg, kind = 'info') {
    const tt = this.faultT == null ? -1 : this.t - this.faultT;
    this.events.push({ t: this.t, tf: tt, msg, kind });
    this.devices.consoleLog(msg, kind);
  }
  mark(flag, msg) {
    if (this.flags[flag] != null) return false;
    this.flags[flag] = this.faultT == null ? 0 : this.t - this.faultT;
    if (msg) this.log(msg, 'action');
    return true;
  }

  // ------------------------------------------------------------ events from interaction
  on(ev, arg) {
    if (this.phase === 'idle' || this.phase === 'debrief') return;
    const pre = this.phase === 'pre';
    switch (ev) {
      case 'press:console_start':
        this.log(pre ? 'START ignored: treatment already running.' : 'START blocked: system in error state.', 'warn');
        break;
      case 'press:console_interrupt':
        if (pre) this.fault('INTERRUPT pressed');
        this.mark('interrupt', 'INTERRUPT pressed at the console.');
        this.attempt(1, 'console interrupt');
        break;
      case 'press:console_estop':
        if (pre) this.fault('EMERGENCY STOP pressed');
        this.mark('cestop', 'EMERGENCY STOP pressed at the console.');
        this.attempt(2, 'console emergency stop');
        break;
      case 'press:unit_estop':
        this.mark('uestop', 'EMERGENCY STOP pressed on the treatment unit.');
        this.attempt(3, 'unit emergency stop');
        break;
      case 'press:wall_estop':
        this.mark('westop', 'Room EMERGENCY OFF pressed.');
        this.attempt(3, 'room emergency off');
        break;
      case 'press:intercom':
        this.mark('intercom', 'Spoke to the patient over the intercom.');
        this.say(this.faultT == null ? 'Okay. I\'m fine.' : 'Okay... I\'ll stay still. Please hurry.');
        break;
      case 'door:open':
        this.field.door.open = true;
        if (this.faultT == null && !this.retracted) {
          this.log('Door interlock opened during treatment.', 'warn');
          this.fault('Door interlock');
        } else this.log('Vault door opened.');
        if (!this.flags.meterAtDoor && this.devices.meterOn && this.meterHeld()) this.mark('meterAtDoor');
        this.attempt(1, 'door interlock');
        break;
      case 'door:close':
        this.field.door.open = false;
        this.log('Vault door closed.');
        break;
      case 'grab:meter':
        this.mark('meterTaken', 'Survey meter taken.');
        break;
      case 'meter:power':
        this.devices.toggleMeter();
        break;
      case 'grab:crank':
        this.mark('crankTried', 'Hand crank engaged.');
        break;
      case 'crank:turn':
        if (!this.retracted && this.level <= 4 && this.faultT != null && this.source.where === 'applicator' && !this.source.moving) {
          const need = 4.0;
          this.devices.crankProgress = Math.min(1, arg / need);
          this.source.crankFrac = Math.min(1, arg / need);
          if (arg >= need) { this.log('Source retracted with the hand crank.', 'good'); this.retract('crank'); }
        }
        break;
      case 'crank:jam':
        if (!this.flags.crankJam) { this.mark('crankJam', 'Hand crank will not turn further: cable jammed.'); this.audio.setMotor('off'); }
        break;
      case 'knob:loose':
        this.mark('clampLoose', 'Applicator clamp released.');
        break;
      case 'grab:applicator':
        this.mark('appTouched');
        break;
      case 'applicator:pull':
        if (!this.patientLines.pull && arg > 0.03) { this.patientLines.pull = true; this.say('Oh! What are you doing?'); }
        break;
      case 'applicator:out':
        this.mark('appOut', 'Applicator withdrawn from the patient.');
        break;
      case 'applicator:container':
        this.mark('appInContainer', 'Applicator placed in the emergency container.');
        if (this.source.where === 'applicator') this.source.where = 'container';
        break;
      case 'lid:on':
        this.field.source.containerOpen = false;
        break;
      case 'lid:off':
        this.field.source.containerOpen = true;
        break;
      case 'phone:call':
        this.mark('notified_' + arg, `Called the ${arg}.`);
        this.mark('notified');
        break;
      case 'end':
        this.finish(arg || 'user');
        break;
    }
  }

  meterHeld() {
    const m = this.interact.meter;
    return !!(m && m.grabbedBy);
  }

  // escalation step n was attempted
  attempt(n, label) {
    if (this.retracted || this.faultT == null) return;
    if (this.kind === 'silent') {
      // console thinks the source is home; the drive does nothing
      this.log(`${label}: no action, system reports the source is in the safe.`, 'warn');
      return;
    }
    if (this.source.where !== 'applicator') return;
    if (n >= this.level) {
      this.retract(label);
    } else if (this.attemptBusy <= 0) {
      this.attemptBusy = 2.2;
      this.audio.setMotor('strain');
      setTimeout(() => this.audio.setMotor('off'), 2000);
      this.log(`${label}: retraction attempted. Source position sensor still reads OUT.`, 'bad');
      this.devices.flashError('RETRACT FAIL');
    }
  }

  fault(reason) {
    if (this.faultT != null) return;
    this.faultT = this.t;
    this.phase = 'fault';
    if (this.kind === 'silent') {
      // normal completion message, but the source capsule has broken free in the applicator
      this.consoleSaysSafe = true;
      this.audio.setMotor('run');
      setTimeout(() => this.audio.setMotor('off'), 1600);
      this.devices.setState({ mode: 'complete', consoleSafe: true });
      this.log(reason ? `${reason}: treatment interrupted. Source retracted to safe.` : 'Treatment complete. Source retracted to safe. Total time delivered.', 'good');
      this.source.where = 'applicator';
      this.source.dwell = 3;
      return;
    }
    this.audio.setMotor('strain');
    setTimeout(() => this.audio.setMotor('off'), 2500);
    this.devices.setState({ mode: 'error', consoleSafe: false });
    this.audio.setAlarm('console', true);
    const msg = {
      interrupt: 'E-2041 Source drive obstruction. Automatic retraction incomplete.',
      cestop: 'E-2107 Primary drive stalled. Source not at safe. Press EMERGENCY STOP to use the backup motor.',
      uestop: 'E-3302 Communication lost with treatment unit. Source position unknown (sensor: OUT).',
      crank: 'E-2113 Primary and emergency drive failure. Source not at safe.',
      stuck: 'E-2113 Primary and emergency drive failure. Source not at safe.',
    }[this.kind];
    this.log(reason ? `${reason}: ${msg}` : msg, 'bad');
    if (this.kind === 'crank' || this.kind === 'stuck') { this.interact.crank.maxRevs = this.kind === 'stuck' ? 0.6 : Infinity; }
  }

  retract(how) {
    if (this.retracted) return;
    const cur = new THREE.Vector3();
    this.sourcePosition(cur);
    this.retracted = true;
    this.audio.setMotor('run');
    setTimeout(() => this.audio.setMotor('off'), 1400);
    this.source.moving = { t: 0, dur: 1.3, from: cur };
    this.log(`Source retracted to the safe (${how}).`, 'good');
  }

  secured(how) {
    if (this.securedT != null) return;
    this.securedT = this.t;
    this.phase = 'secured';
    this.audio.setAlarm('console', false);
    this.devices.setState({ mode: how === 'safe' ? 'safe' : 'container', consoleSafe: true });
    this.mark('secured', how === 'safe' ? 'Source confirmed in the afterloader safe.' : 'Source shielded in the emergency container.');
    if (!this.patientLines.after) { this.patientLines.after = true; setTimeout(() => this.say('Is it over? Am I okay?'), 2500); }
  }

  say(text) { this.audio.say(text, 'patient'); }

  // ------------------------------------------------------------ source position
  sourcePosition(out) {
    const s = this.source, I = this.interact, W = this.world;
    const safe = W.markers.source_safe ? W.markers.source_safe.position : B(0.6, -0.1, 0.55);
    const dwellLocal = (i) => new THREE.Vector3(0, 0, -(0.19 + 0.01 * i));
    if (s.moving) {
      // travel from the applicator through the tube into the safe
      const a = s.moving.from;
      const port = W.markers.turret_port ? W.markers.turret_port.position : safe;
      const k = Math.min(1, s.moving.t / s.moving.dur);
      if (k < 0.75) out.lerpVectors(a, port, k / 0.75); else out.lerpVectors(port, safe, (k - 0.75) / 0.25);
      return 'moving';
    }
    if (this.retracted) { out.copy(safe); return 'safe'; }
    if (s.where === 'applicator' || s.where === 'container') {
      let d = s.dwell;
      if (s.crankFrac) {
        // being cranked back along the channel
        const a = dwellLocal(d).applyMatrix4(I.app.obj.matrixWorld);
        const port = W.markers.turret_port.position;
        out.lerpVectors(a, port, s.crankFrac * 0.9);
        return 'applicator';
      }
      dwellLocal(d).applyMatrix4(I.app.obj.matrixWorld);
      out.copy(dwellLocal(d).applyMatrix4(I.app.obj.matrixWorld));
      return I.app.inContainer ? 'container' : 'applicator';
    }
    out.copy(safe);
    return 'safe';
  }

  // ------------------------------------------------------------ frame update
  update(dt) {
    if (this.phase === 'idle' || this.phase === 'debrief') return;
    this.t += dt;
    this.attemptBusy -= dt;
    // treatment progress (before the fault the source steps through dwells)
    if (this.phase === 'pre') {
      this.treatT += dt;
      let acc = 0, idx = 0;
      for (; idx < this.dwells.length; idx++) { acc += this.dwells[idx]; if (this.treatT < acc) break; }
      this.source.dwell = Math.min(idx, this.dwells.length - 1);
      if (this.t >= this.faultAt) this.fault();
    }
    // source motion
    if (this.source.moving) {
      this.source.moving.t += dt;
      if (this.source.moving.t >= this.source.moving.dur) { this.source.moving = null; this.secured('safe'); }
    }
    const f = this.field, I0 = this.interact;
    const st = this.sourcePosition(f.source.pos);
    f.source.state = st === 'moving' ? 'applicator' : st;
    const lidOn = I0.lid && I0.lid.on && !I0.lid.grabbedBy;
    f.source.containerOpen = !lidOn;
    if (st === 'container' && lidOn) {
      this.mark('lidOn', 'Emergency container lid closed.');
      if (this.securedT == null) this.secured('container');
    }
    // patient dose geometry
    const I = this.interact;
    let pr = null;
    if (!this.retracted && st === 'applicator' && I.app.out < 0.11 && !I.app.free) {
      pr = { px: 0.020 + I.app.out * 0.4, mucosa: 0.015 + I.app.out * 0.4 };
    } else if (st === 'applicator' || st === 'moving') {
      const d = f.source.pos.distanceTo(ENTRY);
      pr = { px: Math.max(0.05, d), mucosa: Math.max(0.05, d) };
    }
    // staff points
    const head = this.player.headWorld(new THREE.Vector3());
    const pts = this._pts || (this._pts = { head: new THREE.Vector3(), body: new THREE.Vector3(), handL: new THREE.Vector3(), handR: new THREE.Vector3() });
    pts.head.copy(head);
    const fwd = this.player.headDir(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
    pts.body.copy(head).add(new THREE.Vector3(0, -0.45, 0)).addScaledVector(fwd, -0.08);
    I.handPositions(pts);
    const counting = this.faultT != null;
    if (counting) this.dosim.step(dt, f, pts, this.faultT != null && this.securedT == null ? pr : (st === 'applicator' ? pr : null));
    else this.dosim.step(dt, f, pts, null);
    // record chart samples
    if (counting && (!this._lastS || this.t - this._lastS > 0.5)) {
      this._lastS = this.t;
      this.dosim.log.push({ t: this.t - this.faultT, body: this.dosim.bodyRate, hand: this.dosim.handRateMax, pt: this.dosim.patientRate, x: head.x, z: head.z, src: st });
      if (!this.faultSrc) this.faultSrc = f.source.pos.clone();
    }
    // where is the trainee
    const inVault = f.inVault(head) && head.z < 3.4;
    if (inVault && !this.wasInVault) {
      this.wasInVault = true;
      if (this.faultT != null) {
        const meterOK = this.meterHeld() && this.devices.meterOn;
        this.mark('entered', meterOK ? 'Entered the vault with the survey meter on.' : (this.meterHeld() ? 'Entered the vault, survey meter OFF.' : 'Entered the vault without the survey meter.'));
        if (this.flags.enteredMeter == null) this.flags.enteredMeter = meterOK ? 1 : this.meterHeld() ? 0.5 : 0;
        if (!this.patientLines.enter && this.securedT == null) { this.patientLines.enter = true; setTimeout(() => this.say('What\'s going on? Is something wrong?'), 800); }
      }
    }
    if (!inVault && this.wasInVault) {
      this.wasInVault = false;
      if (this.securedT != null) this.mark('exitedAfter', 'Left the vault after securing the source.');
    }
    // surveys after securing
    if (this.securedT != null && this.devices.meterOn) {
      const det = this.devices.meterDetector(new THREE.Vector3());
      if (det.distanceTo(ENTRY) < 0.5) this.mark('surveyPatient', 'Surveyed the patient: background.');
      const cm = I.containerMouth;
      const safe = this.world.markers.source_safe.position;
      if (det.distanceTo(cm) < 0.5 || det.distanceTo(safe) < 0.6) this.mark('surveyDevice', 'Surveyed the container / unit.');
    }
    if (this.flags.exitedAfter != null && !f.door.open && this.flags.doorClosedAfter == null && this.securedT != null) this.mark('doorClosedAfter', 'Vault door closed and secured.');
    // patient line on fault
    if (this.faultT != null && !this.patientLines.fault && this.t - this.faultT > 9 && this.securedT == null && this.kind !== 'silent') {
      this.patientLines.fault = true; this.say('Hello? Is everything okay in there? Something is beeping.');
    }
    if (this.kind === 'silent' && this.faultT != null && !this.patientLines.fault && this.t - this.faultT > 14 && this.securedT == null) {
      this.patientLines.fault = true; this.say('Are we finished? Can I go now?');
    }
    // area monitor drives alarms
    this.hints();
    // auto-end after 12 minutes
    if (this.faultT != null && this.t - this.faultT > 720) this.finish('timeout');
  }

  // ------------------------------------------------------------ guided hints
  hints() {
    if (this.opts.mode !== 'guided' || this.faultT == null) { if (this.opts.mode !== 'guided') this.ui.hint(''); return; }
    const F0 = this.flags, I = this.interact, D = this.devices;
    const F = new Proxy(F0, { get: (o, k) => (o[k] != null ? true : undefined) });
    const inVault = this.wasInVault;
    let h = '';
    const sourceOut = !this.retracted && this.securedT == null;
    if (this.kind === 'silent' && sourceOut) {
      if (!F.entered) h = this.t - this.faultT < 10 ? 'Treatment complete. Before you go in, check the area monitor by the door.' : 'The area monitor is still alarming. Take the survey meter, switch it on, and confirm before entering.';
      else if (!F.clampLoose) h = 'The meter says the source is still in the patient. Loosen the applicator clamp knob.';
      else if (!F.appOut && I.lid && I.lid.on && this.player.mode === 'xr') h = 'Take the lid off the emergency container so it is ready.';
      else if (!F.appOut) h = 'Withdraw the applicator straight out, along its axis.';
      else if (!F.appInContainer) h = 'Put the applicator in the emergency container.';
      else if (!F.lidOn) h = 'Close the container lid.';
    } else if (sourceOut) {
      if (F.interrupt == null) h = 'Retraction failure. Press INTERRUPT on the console.';
      else if (F.cestop == null && this.level >= 2) h = 'Source still out. Press the console EMERGENCY STOP.';
      else if (!F.meterTaken && this.level >= 3) h = 'Take the survey meter from the cradle by the door.';
      else if (!D.meterOn && this.level >= 3 && !inVault) h = 'Switch the meter on (A/X button in VR, F on desktop).';
      else if (!inVault && this.level >= 3) h = 'Open the door and go in. Keep an eye on the meter.';
      else if (F.uestop == null && F.westop == null && this.level >= 3) h = 'Press the EMERGENCY STOP on top of the afterloader.';
      else if (F.crankTried == null && this.level >= 4) h = 'Turn the hand crank on the side of the unit, clockwise.';
      else if (this.level === 4) h = 'Keep cranking until the source is home.';
      else if (!F.clampLoose) h = 'The crank is jammed. Loosen the applicator clamp knob.';
      else if (!F.appOut && I.lid && I.lid.on && this.player.mode === 'xr') h = 'Take the lid off the emergency container so it is ready.';
      else if (!F.appOut) h = 'Withdraw the applicator straight out, along its axis.';
      else if (!F.appInContainer) h = 'Place the applicator in the emergency container. Keep your hands on the handle end.';
      else if (!F.lidOn) h = 'Close the container lid.';
    } else {
      if (!F.surveyPatient) h = 'Source secured. Survey the patient at the treatment site to confirm background.';
      else if (!F.surveyDevice) h = 'Survey the container or the unit.';
      else if (!F.exitedAfter) h = 'Leave the vault.';
      else if (!F.doorClosedAfter) h = 'Close the door.';
      else if (!F.notified) h = 'Call the RSO or the physicist on the console phone.';
      else h = 'Done. End the drill at the wall display (or press Enter).';
    }
    if (h !== this.lastHint) { this.lastHint = h; this.ui.hint(h); }
  }

  // ------------------------------------------------------------ scoring
  finish(reason) {
    if (this.phase === 'debrief') return;
    this.phase = 'debrief';
    this.audio.setAlarm('console', false);
    this.audio.hush();
    this.endReason = reason;
    this.result = this.score();
    this.ui.debrief(this.result);
  }

  score() {
    const F = this.flags, D = this.dosim, k = this.kind;
    const tf = (x) => (x == null ? null : x);
    const items = [];
    const add = (ok, text, t, pts, max, note) => items.push({ ok, text, t, pts: ok === true ? max : (typeof ok === 'number' ? Math.round(max * ok) : 0), max, note });
    const secured = this.securedT != null;
    const secT = secured ? this.securedT - this.faultT : null;
    const sourceInPatient = !secured && this.source.where === 'applicator' && !this.interact.app.free;
    // console steps
    if (k !== 'silent') {
      add(F.interrupt != null, 'Pressed INTERRUPT', F.interrupt, 0, 8);
      if (this.level >= 2) add(F.cestop != null, 'Pressed console EMERGENCY STOP', F.cestop, 0, 8);
    } else {
      add(F.meterTaken != null && F.entered != null && F.enteredMeter >= 1, 'Acted on the area monitor alarm despite a normal console', F.entered, 0, 16);
    }
    // entry
    if (this.level >= 3 || k === 'silent') {
      add(F.enteredMeter === 1 ? true : F.enteredMeter === 0.5 ? 0.4 : false, 'Entered with the survey meter switched on', F.entered, 0, 12);
    }
    if (this.level >= 3 && k !== 'silent') add(F.uestop != null || F.westop != null, 'Used the unit / room emergency stop', F.uestop ?? F.westop, 0, 6);
    if (this.level >= 4 && k !== 'silent') add(F.crankTried != null, 'Tried the hand crank', F.crankTried, 0, 6);
    if (this.level >= 5) {
      add(F.appInContainer != null, 'Applicator into the emergency container', F.appInContainer, 0, 10);
      add(F.lidOn != null, 'Closed the container', F.lidOn, 0, 4);
    }
    // the big one
    add(secured, secured ? 'Source secured' : (sourceInPatient ? 'Source left in the patient' : 'Source not secured'), secT, 0, 20);
    // time
    const timeScore = secured ? Math.max(0, Math.min(1, 1 - (secT - (this.level >= 5 ? 120 : 60)) / 240)) : 0;
    add(secured ? timeScore : false, 'Time to secure', secT, 0, 8, secured ? '' : '');
    // ALARA
    const body = D.body, hand = D.handMax;
    const bodyScore = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(body, 0.05) / 0.05) / 2));
    const handScore = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(hand, 2) / 2) / 2));
    add(bodyScore, `Whole-body dose ${fmtmSv(body)}`, null, 0, 8);
    add(handScore, `Extremity dose ${fmtmSv(hand)}`, null, 0, 4);
    // after
    add(F.surveyPatient != null, 'Surveyed the patient afterwards', F.surveyPatient, 0, 8);
    add(F.surveyDevice != null, 'Surveyed the container or unit', F.surveyDevice, 0, 3);
    add(F.exitedAfter != null && F.doorClosedAfter != null, 'Left and closed the vault', F.doorClosedAfter, 0, 3);
    add(F.notified != null, 'Notified the RSO / physicist', F.notified, 0, 6);
    const max = items.reduce((a, b) => a + b.max, 0);
    let pts = items.reduce((a, b) => a + b.pts, 0);
    let score = Math.round(100 * pts / max);
    if (!secured) score = Math.min(score, 35);
    const notes = [];
    if (F.entered != null && F.enteredMeter === 0) notes.push(['bad', 'You entered without the survey meter. In a real event you would not know where the source is.']);
    if (F.entered != null && F.enteredMeter === 0.5) notes.push(['warn', 'Your meter was off when you entered. Switch it on and check it responds before opening the door.']);
    if (hand > 20) notes.push(['warn', `Your hands received ${fmtmSv(hand)}. Hold the applicator by the connector end, keep the active end pointed away, and move it in one motion.`]);
    if (body > 2) notes.push(['warn', `Whole-body ${fmtmSv(body)}. Distance and time: stand to the side of the source, not over it, and leave as soon as it is shielded.`]);
    if (k !== 'silent' && this.level >= 3 && F.entered != null && F.cestop == null) notes.push(['warn', 'You went in before using the console EMERGENCY STOP. Exhaust the console options first; they cost no dose.']);
    if (this.level === 5 && F.appInContainer != null && F.crankTried == null && F.uestop == null) notes.push(['warn', 'You removed the applicator without trying the unit stop or the crank. In a real event you would not know the cable was jammed.']);
    if (!secured && sourceInPatient) notes.push(['bad', 'The drill ended with the source still in the patient.']);
    else if (!secured) notes.push(['bad', 'The drill ended before the source was shielded (in the safe, or in the closed emergency container).']);
    if (secured && F.surveyPatient == null) notes.push(['warn', 'You did not survey the patient. A detached source can stay behind even when the console says it is home.']);
    if (F.notified == null) notes.push(['warn', 'Nobody was notified. The RSO and the physicist need the times, readings and positions to reconstruct doses.']);
    // unplanned patient dose
    const ptPx = D.patientPx, ptMu = D.patientMucosa;
    const fx = 7.0;
    const medEvent = ptPx >= 0.5 * fx;
    return {
      kind: k, name: SCENARIOS[k].name, level: this.level, mode: this.opts.mode, activity: this.opts.activity,
      score, items, notes, secured, secT, faultT: this.faultT, total: this.t - (this.faultT ?? this.t),
      dose: { body, lens: D.lens, hand, handL: D.handL, handR: D.handR, peakBody: D.peakBodyRate },
      patient: { px: ptPx, mucosa: ptMu, medEvent, fx },
      log: this.events.slice(), chart: D.log.slice(), reason: this.endReason, sourceInPatient,
      faultSrc: this.faultSrc ? this.faultSrc.toArray() : null, field: this.field,
    };
  }
}

function fmtmSv(x) { return x >= 1 ? x.toFixed(2) + ' mSv' : (x * 1000).toFixed(x * 1000 >= 100 ? 0 : 1) + ' µSv'; }
