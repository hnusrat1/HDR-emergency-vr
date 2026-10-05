// Instruments and displays: survey meter, area monitors, treatment console, unit display,
// CCTV, vitals monitor, clocks, warning lights, wrist dosimeter (EPD).
import * as THREE from 'three';
import { fmtDoseRate, fmtDose, B, IR192 } from './dose.js';

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

class Screen {
  constructor(mesh, w, h, opts = {}) {
    this.mesh = mesh;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = false;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    if (opts.dim) mat.color.setScalar(opts.dim);
    mesh.traverse(o => { if (o.isMesh) o.material = mat; });
    this.mat = mat;
    this.w = w; this.h = h;
    this.every = opts.every || 0; this.acc = 0;
  }
  due(dt) { this.acc += dt; if (this.acc >= this.every) { this.acc = 0; return true; } return false; }
  flush() { this.tex.needsUpdate = true; }
}

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

export class Devices {
  constructor(world, renderer, scene, field, audio, player) {
    this.world = world; this.renderer = renderer; this.scene = scene; this.field = field; this.audio = audio; this.player = player;
    this.unit = 'mR';
    this.meterOn = false;
    this.meterBoot = 0;
    this.meterReading = 0;       // smoothed µSv/h (H*10)
    this.armRoom = 0; this.armCtl = 0;
    this.state = { mode: 'idle', consoleSafe: true };
    this.logLines = [];
    this.errFlash = 0;
    this.crankProgress = 0;
    this.t = 0;
    const S = world.screens;
    const mk = (n, w, h, o) => (S[n] ? new Screen(S[n], w, h, o) : null);
    this.scr = {
      main: mk('SCREEN_console_main', 1024, 580, { every: 0.2 }),
      aux: mk('SCREEN_console_aux', 1024, 580, { every: 0.5 }),
      armR: mk('SCREEN_arm_remote', 340, 160, { every: 0.1 }),
      armV: mk('SCREEN_arm_room', 240, 120, { every: 0.1 }),
      unit: mk('SCREEN_unit', 470, 200, { every: 0.15 }),
      vitals: mk('SCREEN_vitals', 600, 400, { every: 1 / 15 }),
      meter: mk('SCREEN_meter', 290, 190, { every: 1 / 10 }),
    };
    this.vitals = { hr: 82, spo2: 98, sys: 136, dia: 84, rr: 16, phase: 0, trace: new Float32Array(600).fill(0.5), x: 0 };
    // lights
    this.beacons = ['DYN_beacon_control', 'DYN_beacon_room'].map(n => world.nodes[n]).filter(Boolean);
    this.beaconLight = new THREE.PointLight(0xff2a1a, 0, 7, 1.6);
    this.beaconLight.position.copy(B(2.6, 0.6, 2.25));
    scene.add(this.beaconLight);
    this.radon = world.nodes['DYN_radon_sign'];
    this.leds = {
      door: world.nodes['DYN_console_led_door'], source: world.nodes['DYN_console_led_source'],
      ready: world.nodes['DYN_console_led_ready'], ring: world.nodes['DYN_unit_ledring'],
    };
    for (const k in this.leds) {
      const n = this.leds[k];
      if (n) n.traverse(o => { if (o.isMesh) { o.material = new THREE.MeshBasicMaterial({ color: 0x220000 }); } });
    }
    for (const b of this.beacons) b.traverse(o => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x3a0606, transparent: true, opacity: 0.92 }); });
    if (this.radon) this.radon.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); this.radonMat = o.material; } });
    this.clocks = [];
    world.root.traverse(o => { if (o.name && o.name.startsWith('DYN_clock_')) this.clocks.push({ o, kind: o.name.slice(-1), q0: o.quaternion.clone() }); });
    this.meter = world.nodes['DYN_survey_meter'];
    this.setupCCTV();
    this.setupEPD();
    // audio emitters
    this.audioReady = false;
  }

  startAudio() {
    if (this.audioReady) return;
    this.audioReady = true;
    const A = this.audio;
    A.alarm('console', B(1.6, -4.3, 0.9), [[880, 0.16, 0.08], [660, 0.16, 0.6]], 0.16, { ref: 1.5 });
    A.alarm('arm_ctl', B(-0.98, -3.95, 1.7), [[2900, 0.07, 0.07], [2900, 0.07, 0.35]], 0.12, { ref: 1.2 });
    A.alarm('arm_room', B(2.9, 0.6, 2.2), [[2900, 0.07, 0.07], [2900, 0.07, 0.35]], 0.16, { ref: 2.0 });
    A.alarm('epd_alarm', null, [[3600, 0.05, 0.05]], 0.08, { parent: this.epdAudioParent, ref: 0.4 });
    A.motor(this.world.markers.turret_center ? this.world.markers.turret_center.position : B(0.3, 0, 0.9));
    A.geiger(this.meter);
    A.epd(this.epdAudioParent);
    A.roomTone('room_v', B(0, 0.8, 2.4), 0.03);
    A.roomTone('room_c', B(0.5, -5.3, 2.4), 0.025);
  }

  setState(s) { Object.assign(this.state, s); }
  consoleLog(msg, kind) {
    const d = new Date();
    const ts = d.toTimeString().slice(0, 8);
    this.logLines.push({ ts, msg, kind });
    if (this.logLines.length > 40) this.logLines.shift();
  }
  flashError(txt) { this.errFlash = 2.5; this.errTxt = txt; }

  toggleMeter() {
    this.meterOn = !this.meterOn;
    this.meterBoot = this.meterOn ? 1.6 : 0;
    this.audio.oneShot('beep_hi', this.meter.getWorldPosition(new THREE.Vector3()), 0.5);
  }
  meterDetector(out) { return out.set(0, -0.08, -0.12).applyMatrix4(this.meter.matrixWorld); }

  // ------------------------------------------------------------ CCTV
  setupCCTV() {
    const scr = this.world.screens['SCREEN_cctv'];
    if (!scr) return;
    this.cctvRT = new THREE.WebGLRenderTarget(640, 360, { samples: 0, colorSpace: THREE.SRGBColorSpace });
    this.cctvCams = [];
    for (const n of ['cam_cctv1', 'cam_cctv2']) {
      const m = this.world.markers[n];
      if (!m) continue;
      const c = new THREE.PerspectiveCamera(n === 'cam_cctv1' ? 62 : 52, 640 / 360, 0.22, 20);
      c.position.copy(m.position);
      const look = m.userData && Array.isArray(m.userData.look) ? m.userData.look : null;
      const target = look ? B(look[0], look[1], look[2]) : B(-0.3, 0.8, 0.9);
      c.lookAt(target);
      c.layers.enable(3);
      this.cctvCams.push(c);
    }
    this.cctvOverlay = new Screen(new THREE.Object3D(), 640, 360);
    const mat = new THREE.ShaderMaterial({
      uniforms: { tMain: { value: this.cctvRT.texture }, tOver: { value: this.cctvOverlay.tex }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tMain; uniform sampler2D tOver; uniform float uTime; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        void main(){
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
          vec3 c = texture2D(tMain, uv).rgb;
          float l = dot(c, vec3(0.299,0.587,0.114));
          c = mix(vec3(l), c, 0.35);
          c = pow(c, vec3(0.9)) * 1.12;
          c += (hash(uv*vec2(640.,360.) + uTime) - 0.5) * 0.06;
          c *= 0.92 + 0.08 * sin(uv.y * 900.0 + uTime * 8.0);
          vec2 d = uv - 0.5; c *= 1.0 - dot(d,d)*0.9;
          vec4 o = texture2D(tOver, vUv);
          c = mix(c, o.rgb, o.a);
          gl_FragColor = vec4(c, 1.0);
        }`,
      toneMapped: false,
    });
    scr.traverse(o => { if (o.isMesh) o.material = mat; });
    this.cctvMat = mat;
    this.cctvAcc = 0;
  }

  renderCCTV(dt) {
    if (!this.cctvCams || !this.cctvCams.length) return;
    this.cctvAcc += dt;
    this.cctvMat.uniforms.uTime.value += dt;
    if (this.cctvAcc < 1 / 10) return;
    this.cctvAcc = 0;
    // only when someone could see it (player in control area or near the door)
    const head = this.player.headWorld(new THREE.Vector3());
    if (head.z < 2.0) return;
    const r = this.renderer;
    const xr = r.xr.enabled; r.xr.enabled = false;
    const prevRT = r.getRenderTarget();
    const tm = r.toneMapping;
    const rt = this.cctvRT;
    const [c1, c2] = this.cctvCams;
    const scrMesh = this.world.screens['SCREEN_cctv'];
    if (scrMesh) scrMesh.visible = false;
    rt.scissorTest = true;
    rt.viewport.set(0, 0, 640, 360); rt.scissor.set(0, 0, 640, 360);
    r.setRenderTarget(rt);
    c1.aspect = 640 / 360; c1.updateProjectionMatrix();
    r.render(this.scene, c1);
    if (c2) {
      rt.viewport.set(440, 230, 192, 122); rt.scissor.set(440, 230, 192, 122);
      r.setRenderTarget(rt);
      c2.aspect = 192 / 122; c2.updateProjectionMatrix();
      r.render(this.scene, c2);
    }
    rt.scissorTest = false;
    if (scrMesh) scrMesh.visible = true;
    r.setRenderTarget(prevRT);
    r.xr.enabled = xr;
    r.toneMapping = tm;
    // overlay text
    const s = this.cctvOverlay, g = s.g;
    g.clearRect(0, 0, 640, 360);
    g.font = `600 16px ${MONO}`;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillText('CAM 1  HDR B-112', 14, 26);
    g.fillText(new Date().toLocaleTimeString(), 14, 346);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2; g.strokeRect(440, 8, 192, 122);
    g.font = `600 12px ${MONO}`; g.fillText('CAM 2', 446, 144);
    if (Math.floor(this.t * 2) % 2 === 0) { g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(612, 22 + 140, 6, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillText('REC', 572, 26 + 140); }
    s.flush();
  }

  // ------------------------------------------------------------ EPD
  setupEPD() {
    // small device on the left wrist in VR
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.014, 0.036), new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, envMap: this.world.env.vault }));
    grp.add(body);
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.026), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    sc.rotation.x = -Math.PI / 2; sc.position.y = 0.0075;
    grp.add(sc);
    this.epdScreen = new Screen(sc, 220, 130);
    this.epdScreen.tex.flipY = true;
    this.epd = grp;
    this.epd.visible = false;
    this.epdAudioParent = grp;
    this.scene.add(grp);
    this.epdEl = document.getElementById('epd');
    this.epdLast = 0;
  }

  attachEPD() {
    const P = this.player;
    if (P.mode !== 'xr') { this.epd.visible = false; return; }
    const L = P.hands.find(h => h.handedness === 'left' && h.active);
    if (!L) { this.epd.visible = false; return; }
    this.epd.visible = true;
    if (L.isHand) {
      const wr = L.hand.joints['wrist'];
      if (wr) { wr.getWorldPosition(this.epd.position); wr.getWorldQuaternion(this.epd.quaternion); this.epd.translateY(0.03); }
    } else {
      L.grip.getWorldPosition(this.epd.position);
      L.grip.getWorldQuaternion(this.epd.quaternion);
      this.epd.translateZ(0.075); this.epd.translateY(0.02);
      this.epd.rotateX(-0.5);
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt, dosim, scenario) {
    this.t += dt;
    const F = this.field;
    // area monitors read at their detectors
    const det = B(2.913, 0.6, 2.12);
    const target = F.mRh(det);
    this.armRoom += (target - this.armRoom) * Math.min(1, dt * 3);
    const alarm = this.armRoom > 2.0;
    this.alarmOn = alarm;
    if (this.audioReady) {
      this.audio.setAlarm('arm_ctl', alarm && (F.door.open || this.state.mode !== 'treating'));
      this.audio.setAlarm('arm_room', alarm);
    }
    // beacons pulse when alarming (rotating beacon look)
    const pulse = alarm ? (0.5 + 0.5 * Math.sin(this.t * 9)) : 0;
    for (const b of this.beacons) b.traverse(o => { if (o.isMesh) o.material.color.setRGB(0.25 + pulse * 3.2, 0.03 + pulse * 0.15, 0.02 + pulse * 0.1); });
    this.beaconLight.intensity = alarm ? pulse * 1.6 : 0;
    // RAD ON sign follows the console's belief, not reality
    const radOn = (this.state.mode === 'treating' || this.state.mode === 'error');
    if (this.radonMat) this.radonMat.emissiveIntensity = radOn ? 2.4 : 0.0;
    // LEDs
    const setLed = (n, r, g, b) => { if (n) n.traverse(o => { if (o.isMesh) o.material.color.setRGB(r, g, b); }); };
    setLed(this.leds.door, F.door.open ? 3 : 0.15, F.door.open ? 0.4 : 0.02, 0.02);
    const srcOut = !this.state.consoleSafe;
    const blink = Math.floor(this.t * 3) % 2 === 0;
    setLed(this.leds.source, srcOut ? (blink ? 3 : 0.4) : 0.1, srcOut ? 0.2 : 0.02, 0.02);
    setLed(this.leds.ready, 0.02, this.state.mode === 'idle' || this.state.mode === 'safe' ? 2.5 : 0.15, 0.04);
    const ringCol = { treating: [0.2, 0.7, 3], error: blink ? [3, 0.2, 0.1] : [0.5, 0.05, 0.02], complete: [0.2, 2.5, 0.4], safe: [0.2, 2.5, 0.4], container: [2.5, 1.6, 0.1], idle: [0.2, 1.5, 0.4] }[this.state.mode] || [0.2, 1.5, 0.4];
    setLed(this.leds.ring, ...ringCol);
    // survey meter
    if (this.meterBoot > 0) this.meterBoot -= dt;
    const mdet = this.meterDetector(new THREE.Vector3());
    const trueH = F.hStar(mdet);
    const tau = trueH > 2000 ? 0.35 : trueH > 50 ? 0.8 : 2.0;
    this.meterReading += (trueH - this.meterReading) * Math.min(1, dt / tau);
    if (this.audioReady) {
      const cps = this.meterOn && this.meterBoot <= 0 ? Math.min(2000, (this.meterReading / 1.27 / 8.76) * 3.0 + 0.6) : 0;
      this.audio.setGeiger(cps, this.meterOn && this.meterBoot <= 0);
    }
    this.world.updateMovableEnv(this.meter);
    // EPD
    this.attachEPD();
    this.updateEPD(dt, dosim);
    // clocks
    const now = new Date();
    const s = now.getSeconds() + now.getMilliseconds() / 1000, m = now.getMinutes() + s / 60, h = (now.getHours() % 12) + m / 60;
    for (const c of this.clocks) {
      const ang = c.kind === 's' ? s / 60 : c.kind === 'm' ? m / 60 : h / 12;
      // faces look toward +Z (three); clockwise seen from the front = negative rotation about +Z
      c.o.quaternion.copy(c.q0).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang * Math.PI * 2));
    }
    // screens
    if (this.errFlash > 0) this.errFlash -= dt;
    const S = this.scr;
    if (S.main && S.main.due(dt)) this.drawMain(S.main, scenario);
    if (S.aux && S.aux.due(dt)) this.drawAux(S.aux, scenario, dosim);
    if (S.armR && S.armR.due(dt)) this.drawARM(S.armR, true);
    if (S.armV && S.armV.due(dt)) this.drawARM(S.armV, false);
    if (S.unit && S.unit.due(dt)) this.drawUnit(S.unit, scenario);
    if (S.vitals && S.vitals.due(dt)) this.drawVitals(S.vitals, scenario, S.vitals.every);
    if (S.meter && S.meter.due(dt)) this.drawMeter(S.meter);
    this.renderCCTV(dt);
  }

  updateEPD(dt, dosim) {
    const uSv = dosim.body * 1000;
    if (Math.floor(uSv) > Math.floor(this.epdLast)) { this.audio.epdChirp(); }
    this.epdLast = uSv;
    const rate = dosim.bodyRate;
    if (this.audioReady) this.audio.setAlarm('epd_alarm', rate > 1000);
    const [rv, ru] = fmtDoseRate(rate, 'uSv');
    const dose = fmtDose(dosim.body);
    // desktop HUD
    if (this.epdEl) {
      this.epdEl.innerHTML = `<div class="row"><span class="lbl">EPD  Hp(10)</span><span class="${rate > 1000 ? 'bad' : rate > 20 ? 'warn' : 'ok'}">●</span></div>
        <div class="big">${dose}</div>
        <div class="row"><span class="lbl">rate</span><span>${rv} ${ru}</span></div>
        <div class="row"><span class="lbl">hands</span><span>${fmtDose(dosim.handMax)}</span></div>`;
    }
    if (this.epd.visible) {
      const g = this.epdScreen.g;
      g.fillStyle = '#a9b8a0'; g.fillRect(0, 0, 220, 130);
      g.fillStyle = '#1b2116';
      g.font = `700 44px ${MONO}`;
      g.fillText(uSv >= 1000 ? (uSv / 1000).toFixed(2) : uSv.toFixed(uSv >= 100 ? 0 : 1), 10, 56);
      g.font = `600 20px ${MONO}`; g.fillText(uSv >= 1000 ? 'mSv' : 'µSv', 165, 56);
      g.font = `500 20px ${MONO}`; g.fillText(`${rv} ${ru}`, 10, 100);
      if (rate > 1000 && Math.floor(this.t * 4) % 2) { g.fillStyle = '#7a1010'; g.fillRect(150, 82, 60, 30); g.fillStyle = '#fff'; g.font = '700 16px ' + MONO; g.fillText('ALRM', 156, 104); }
      this.epdScreen.flush();
    }
  }

  // ------------------------------------------------------------ drawing
  drawMain(s, sc) {
    const g = s.g, W = s.w, H = s.h;
    const st = this.state.mode;
    g.fillStyle = '#0d1a26'; g.fillRect(0, 0, W, H);
    // header
    g.fillStyle = '#16314a'; g.fillRect(0, 0, W, 54);
    g.fillStyle = '#e8f1f8'; g.font = `600 22px ${FONT}`;
    g.fillText('HDR Treatment Control', 18, 34);
    g.font = `500 17px ${FONT}`; g.fillStyle = '#9fb7cc';
    g.fillText('Pt: DOE, JANE  MRN 0047812   Plan: GYN CYL 3.0 / 7.0 Gy @ 5 mm   Fx 3 of 3', 280, 34);
    // status banner
    const banner = {
      idle: ['#22313f', 'READY', '#cfe3f3'], treating: ['#14507a', 'TREATING', '#e7f4ff'], error: [Math.floor(this.t * 2) % 2 ? '#8a1111' : '#b31515', 'SOURCE RETRACTION FAILURE', '#fff'],
      complete: ['#1e5a33', 'TREATMENT COMPLETE', '#eafff0'], safe: ['#1e5a33', 'SOURCE IN SAFE', '#eafff0'], container: ['#6b5200', 'SOURCE NOT IN SAFE (removed)', '#fff4cc'],
    }[st] || ['#22313f', st.toUpperCase(), '#fff'];
    g.fillStyle = banner[0]; g.fillRect(18, 70, W - 36, 64);
    g.fillStyle = banner[2]; g.font = `700 34px ${FONT}`; g.fillText(banner[1], 34, 115);
    // channel diagram
    g.fillStyle = '#9fb7cc'; g.font = `600 16px ${FONT}`;
    g.fillText('CHANNEL 1  ·  dwell positions', 18, 166);
    const x0 = 40, y0 = 186, cw = 560;
    g.strokeStyle = '#3d6a8f'; g.lineWidth = 10; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0 + 20); g.lineTo(x0 + cw, y0 + 20); g.stroke();
    const n = sc && sc.dwells ? sc.dwells.length : 7;
    const di = sc && sc.source ? sc.source.dwell : 0;
    for (let i = 0; i < n; i++) {
      const x = x0 + cw - 30 - i * 60;
      g.fillStyle = i < di ? '#3fb67a' : '#28455e';
      g.beginPath(); g.arc(x, y0 + 20, 11, 0, 7); g.fill();
      g.fillStyle = '#cfe3f3'; g.font = `500 13px ${FONT}`; g.fillText(String(i + 1), x - 4, y0 + 52);
    }
    // source marker (what the console believes)
    const believeOut = !this.state.consoleSafe;
    if (believeOut) {
      const x = x0 + cw - 30 - di * 60;
      g.fillStyle = Math.floor(this.t * 4) % 2 ? '#ffd23f' : '#ff7a1a';
      g.beginPath(); g.arc(x, y0 + 20, 8, 0, 7); g.fill();
    }
    g.fillStyle = '#9fb7cc'; g.font = `600 15px ${FONT}`; g.fillText('SAFE', x0 + cw + 18, y0 + 26);
    g.fillStyle = believeOut ? '#2a3c4c' : '#3fb67a'; g.fillRect(x0 + cw + 64, y0 + 8, 24, 24);
    // timer block
    const total = sc && sc.dwells ? sc.dwells.reduce((a, b) => a + b, 0) : 0;
    const done = sc ? Math.min(total, sc.treatT || 0) : 0;
    const remain = Math.max(0, total - done);
    g.fillStyle = '#9fb7cc'; g.font = `600 16px ${FONT}`;
    g.fillText('TIME REMAINING', 690, 166);
    g.fillStyle = '#e8f1f8'; g.font = `700 54px ${MONO}`;
    const mm = Math.floor(remain / 60), ss = Math.floor(remain % 60);
    g.fillText(st === 'treating' || st === 'error' ? `${mm}:${String(ss).padStart(2, '0')}` : '0:00', 690, 228);
    g.font = `500 15px ${FONT}`; g.fillStyle = '#9fb7cc';
    g.fillText(`Source Ir-192  ${(sc ? sc.opts.activity : 10).toFixed(1)} Ci`, 690, 258);
    // event log
    g.fillStyle = '#0a131c'; g.fillRect(18, 290, W - 36, H - 308);
    g.font = `500 16px ${MONO}`;
    const lines = this.logLines.slice(-11);
    lines.forEach((l, i) => {
      g.fillStyle = { bad: '#ff8080', warn: '#ffd166', good: '#7be0a6', action: '#9fd0ff' }[l.kind] || '#c7d6e3';
      const txt = `${l.ts}  ${l.msg}`;
      g.fillText(txt.length > 96 ? txt.slice(0, 95) + '…' : txt, 30, 316 + i * 23);
    });
    if (this.errFlash > 0 && Math.floor(this.t * 6) % 2) {
      g.fillStyle = 'rgba(180,20,20,0.85)'; g.fillRect(W - 300, 70, 282, 64);
      g.fillStyle = '#fff'; g.font = `700 26px ${FONT}`; g.fillText(this.errTxt || 'FAULT', W - 284, 112);
    }
    s.flush();
  }

  drawAux(s, sc, dosim) {
    const g = s.g, W = s.w, H = s.h;
    g.fillStyle = '#101418'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1d2630'; g.fillRect(0, 0, W, 54);
    g.fillStyle = '#e8edf2'; g.font = `600 22px ${FONT}`; g.fillText('Interlocks & room status', 18, 34);
    const row = (y, label, val, col) => {
      g.fillStyle = '#93a1b0'; g.font = `500 20px ${FONT}`; g.fillText(label, 24, y);
      g.fillStyle = col; g.beginPath(); g.arc(400, y - 7, 10, 0, 7); g.fill();
      g.fillStyle = '#e8edf2'; g.font = `600 20px ${FONT}`; g.fillText(val, 420, y);
    };
    const F = this.field;
    row(96, 'Vault door', F.door.open ? 'OPEN' : 'CLOSED', F.door.open ? '#e5484d' : '#3fb67a');
    row(134, 'Source (console)', this.state.consoleSafe ? 'SAFE' : 'OUT', this.state.consoleSafe ? '#3fb67a' : '#e5484d');
    const [v, u] = fmtDoseRate(this.armRoom * 8.76 * 1.27, this.unit);
    row(172, 'Area monitor', `${v} ${u}${this.alarmOn ? '  ALARM' : ''}`, this.alarmOn ? '#e5484d' : '#3fb67a');
    row(210, 'Treatment key', sc && sc.interact && sc.interact.key && sc.interact.key.on ? 'ON' : 'OFF', '#4c8dff');
    row(248, 'Emergency stop', sc && (sc.flags?.cestop != null || sc.flags?.uestop != null || sc.flags?.westop != null) ? 'ACTIVATED' : 'armed', sc && sc.flags && (sc.flags.cestop != null || sc.flags.uestop != null) ? '#ffd166' : '#3fb67a');
    // dwell table
    g.fillStyle = '#93a1b0'; g.font = `600 16px ${FONT}`; g.fillText('DWELL  POS(mm)  TIME(s)', 620, 96);
    g.font = `500 17px ${MONO}`;
    if (sc && sc.dwells) sc.dwells.forEach((d, i) => {
      g.fillStyle = sc.source && i === sc.source.dwell && !this.state.consoleSafe ? '#ffd166' : '#c7d6e3';
      g.fillText(`${String(i + 1).padStart(3)}    ${String(1200 - i * 10).padStart(5)}    ${d.toFixed(1).padStart(5)}`, 620, 126 + i * 26);
    });
    // camera / patient note
    g.fillStyle = '#93a1b0'; g.font = `500 16px ${FONT}`;
    g.fillText('Emergency kit: container, long forceps, cutters, survey meter at the door.', 24, H - 60);
    g.fillText('Physicist on call x5520  ·  RSO x4417', 24, H - 30);
    s.flush();
  }

  drawARM(s, big) {
    const g = s.g, W = s.w, H = s.h;
    const alarm = this.alarmOn;
    g.fillStyle = alarm && Math.floor(this.t * 3) % 2 ? '#3a0000' : '#04120a'; g.fillRect(0, 0, W, H);
    const [v, u] = fmtDoseRate(this.armRoom * 8.76 * 1.27, this.unit);
    const over = this.armRoom > 9999;
    g.fillStyle = alarm ? '#ff4d3a' : '#5dff9a';
    g.font = `700 ${big ? 74 : 52}px ${MONO}`;
    g.fillText(over ? 'HIGH' : v, 14, big ? 92 : 66);
    g.font = `600 ${big ? 26 : 18}px ${MONO}`;
    g.fillText(over ? '' : u, big ? 230 : 160, big ? 92 : 66);
    g.font = `600 ${big ? 22 : 16}px ${FONT}`;
    g.fillText(alarm ? 'ALARM' : 'NORMAL', 14, big ? 140 : 104);
    s.flush();
  }

  drawUnit(s, sc) {
    const g = s.g, W = s.w, H = s.h;
    g.setTransform(-1, 0, 0, -1, W, H);   // display is read from behind the unit
    g.fillStyle = '#071017'; g.fillRect(0, 0, W, H);
    const st = this.state.mode;
    const txt = { idle: 'READY', treating: `TREATING  CH01  D${(sc?.source?.dwell ?? 0) + 1}/7`, error: 'ERROR  E-2113', complete: 'COMPLETE', safe: 'SOURCE IN SAFE', container: 'SOURCE NOT IN SAFE' }[st] || st;
    g.fillStyle = st === 'error' ? (Math.floor(this.t * 3) % 2 ? '#ff4d3a' : '#9a2a20') : '#7cd2ff';
    g.font = `700 40px ${MONO}`; g.fillText(txt, 16, 70);
    g.font = `500 26px ${MONO}`; g.fillStyle = '#89a4b6';
    g.fillText(`Ir-192 ${(sc ? sc.opts.activity : 10).toFixed(1)}Ci  CRANK ${Math.round((this.crankProgress || 0) * 100)}%`, 16, 130);
    g.setTransform(1, 0, 0, 1, 0, 0);
    s.flush();
  }

  drawVitals(s, sc, dt) {
    const g = s.g, W = s.w, H = s.h, V = this.vitals;
    const stress = sc && sc.faultT != null && sc.securedT == null ? Math.min(1, (sc.t - sc.faultT) / 40) : 0;
    V.hr += ((82 + stress * 26) - V.hr) * dt * 0.2;
    V.phase += dt * V.hr / 60;
    // ECG synthetic waveform
    const ph = V.phase % 1;
    const ecg = (p) => {
      const gs = (x, m, w) => Math.exp(-((x - m) ** 2) / (2 * w * w));
      return 0.12 * gs(p, 0.18, 0.025) - 0.08 * gs(p, 0.36, 0.01) + 1.0 * gs(p, 0.4, 0.012) - 0.25 * gs(p, 0.43, 0.012) + 0.25 * gs(p, 0.68, 0.045);
    };
    const step = 4;
    for (let k = 0; k < step; k++) {
      V.x = (V.x + 1) % 600;
      V.trace[V.x] = ecg((ph + k / step * dt * V.hr / 60) % 1);
    }
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#33ff66'; g.lineWidth = 2.5; g.beginPath();
    for (let x = 0; x < 400; x++) {
      const i = Math.floor(x * 1.5);
      if (Math.abs(i - V.x) < 6) { g.stroke(); g.beginPath(); continue; }
      const y = 110 - V.trace[i] * 70;
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    // pleth
    g.strokeStyle = '#36c8ff'; g.lineWidth = 2; g.beginPath();
    for (let x = 0; x < 400; x++) { const p = (V.phase - (400 - x) / 160) % 1; const y = 250 - Math.max(0, Math.sin(p * Math.PI * 2)) * 40 - Math.max(0, Math.sin(p * Math.PI * 4 - 1)) * 8; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = '#33ff66'; g.font = `700 64px ${MONO}`; g.fillText(String(Math.round(V.hr)), 420, 90);
    g.font = `600 18px ${FONT}`; g.fillText('HR', 420, 26);
    g.fillStyle = '#36c8ff'; g.font = `700 54px ${MONO}`; g.fillText(String(V.spo2), 420, 230);
    g.font = `600 18px ${FONT}`; g.fillText('SpO2 %', 420, 172);
    g.fillStyle = '#e8e8e8'; g.font = `600 30px ${MONO}`; g.fillText(`${V.sys}/${V.dia}`, 20, 350);
    g.font = `500 16px ${FONT}`; g.fillText('NIBP  08:52', 20, 380);
    g.fillStyle = '#ffd166'; g.font = `600 30px ${MONO}`; g.fillText(`RR ${V.rr}`, 420, 350);
    s.flush();
  }

  drawMeter(s) {
    const g = s.g, W = s.w, H = s.h;
    const on = this.meterOn;
    g.fillStyle = on ? '#b9c9a7' : '#4a5146'; g.fillRect(0, 0, W, H);
    if (!on) { s.flush(); return; }
    g.fillStyle = '#18200f';
    if (this.meterBoot > 0.8) { g.font = `700 76px ${MONO}`; g.fillText('8.8.8.8', 8, 100); g.font = `600 22px ${MONO}`; g.fillText('mR/h  µSv/h  BAT', 10, 160); s.flush(); return; }
    if (this.meterBoot > 0) { g.font = `700 40px ${MONO}`; g.fillText('BAT OK', 30, 90); g.font = `600 22px ${MONO}`; g.fillText('CHK SRC PASS', 30, 140); s.flush(); return; }
    const uSv = this.meterReading;
    const mR = uSv / 1.27 / 8.76;
    const over = mR > 10000; // 10 R/h ceiling
    let [v, u] = fmtDoseRate(uSv, this.unit);
    if (over) {
      if (Math.floor(this.t * 4) % 2) { g.font = `700 92px ${MONO}`; g.fillText('OL', 70, 112); }
      g.font = `600 22px ${MONO}`; g.fillText('OVER RANGE', 60, 150);
    } else {
      g.font = `700 78px ${MONO}`; g.textAlign = 'right'; g.fillText(v, 210, 98); g.textAlign = 'left';
      g.font = `600 26px ${MONO}`; g.fillText(u, 212, 98);
    }
    // log bargraph 0.01 mR/h .. 10 R/h
    const frac = Math.max(0, Math.min(1, (Math.log10(Math.max(mR, 0.01)) + 2) / 6));
    g.fillStyle = 'rgba(24,32,15,0.25)'; g.fillRect(10, 160, 270, 16);
    g.fillStyle = '#18200f'; g.fillRect(10, 160, 270 * frac, 16);
    g.font = `600 14px ${MONO}`; g.fillText('■ BAT', 220, 24);
    if (mR > 2) g.fillText('◆ ALARM', 10, 24);
    s.flush();
  }
}
