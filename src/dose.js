// Radiation field model for a single Ir-192 HDR source.
// Point source, inverse square, broad-beam TVL attenuation through barriers,
// a two-bend maze scatter term, and dedicated shielding for the safe and the emergency container.
import * as THREE from 'three';

export const IR192 = {
  skPerMci: 4.08,          // air-kerma strength per mCi, U (µGy m² h⁻¹)
  lambda: 1.109,           // dose-rate constant, cGy h⁻¹ U⁻¹
  hStarPerKa: 1.27,        // H*(10)/Ka for the Ir-192 spectrum, Sv/Gy
  effPerKa: 1.05,          // effective dose / Ka, AP geometry
  skinPerKa: 1.2,          // Hp(0.07)/Ka for hands
  uGyPerMr: 8.76,          // air kerma per exposure
  tvl: { concrete: 0.14, lead: 0.016, steel: 0.043 }, // m, broad beam
  backgroundUSvH: 0.10,
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

// three.js coordinates: x east, y up, z south.  B(x,y,z) converts Blender coordinates.
export const B = (x, y, z) => new THREE.Vector3(x, z, -y);

function box(bmin, bmax, mat, thickness) {
  // Blender-coordinate min/max -> three AABB
  const a = B(...bmin), b = B(...bmax);
  return { min: new THREE.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)),
           max: new THREE.Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)), mat, thickness };
}

export class DoseField {
  constructor() {
    this.activityCi = 10;
    this.sk = this.activityCi * 1000 * IR192.skPerMci;
    // shielding barriers (Blender coordinates, metres). Effective concrete thickness is taken from geometry.
    this.barriers = [
      box([-3.5, -3.9, 0], [-3.0, 3.9, 3], 'concrete'),       // W
      box([3.0, -3.9, 0], [3.5, 3.9, 3], 'concrete'),         // E
      box([-3.0, 3.4, 0], [3.0, 3.9, 3], 'concrete'),         // N
      box([-3.0, -3.9, 0], [-2.75, -3.4, 3], 'concrete'),     // S pieces (door gap X -2.75..-1.45)
      box([-1.45, -3.9, 0], [3.0, -3.4, 3], 'concrete'),
      box([-2.75, -3.9, 2.13], [-1.45, -3.4, 3], 'concrete'),
      box([-3.0, -2.1, 0], [1.0, -1.6, 3], 'concrete'),       // maze wall
    ];
    this.extraConcrete = 0.12; // walls are thicker than drawn (added density / lead lining)
    this.door = { closedT: Math.pow(10, -0.013 / IR192.tvl.lead), open: false };
    this.shieldMobile = null; // set by world (box with 10 mm Pb)
    this.mazeMouth = B(2.0, -1.85, 1.2);
    this.doorInner = B(-2.1, -3.2, 1.1);
    this.doorOuter = B(-2.1, -4.15, 1.1);
    this.source = { state: 'safe', pos: new THREE.Vector3(), containerOpen: true, containerAxis: new THREE.Vector3(0, 1, 0) };
  }

  setActivity(ci) { this.activityCi = ci; this.sk = ci * 1000 * IR192.skPerMci; }

  inVault(p) { return p.z > -3.4 - 0.001 && p.z < 3.4 && p.x > -3.0 && p.x < 3.0 && p.z < 3.4 && p.z > -3.4; }
  inControl(p) { return p.z > 3.9; }
  inCorridor(p) { return p.z >= 2.1 && p.z <= 3.4 && p.x <= 1.0; }

  // path length (m) of segment a->b inside AABB
  static segBox(a, b, bx) {
    let t0 = 0, t1 = 1;
    for (const k of ['x', 'y', 'z']) {
      const d = b[k] - a[k];
      if (Math.abs(d) < 1e-9) {
        if (a[k] < bx.min[k] || a[k] > bx.max[k]) return 0;
      } else {
        let ta = (bx.min[k] - a[k]) / d, tb = (bx.max[k] - a[k]) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 >= t1) return 0;
      }
    }
    return (t1 - t0) * a.distanceTo(b);
  }

  transmission(a, b) {
    let T = 1;
    for (const bx of this.barriers) {
      const L = DoseField.segBox(a, b, bx);
      if (L > 0) T *= Math.pow(10, -(L + this.extraConcrete) / IR192.tvl.concrete);
    }
    if (this.shieldMobile) {
      const L = DoseField.segBox(a, b, this.shieldMobile);
      if (L > 0) T *= Math.pow(10, -0.010 / IR192.tvl.lead);
    }
    return T;
  }

  // source-housing factor in the direction of p
  housing(p) {
    const s = this.source;
    if (s.state === 'safe') return 3e-5;
    if (s.state === 'container') {
      if (!s.containerOpen) return 1.5e-4;
      _d.copy(p).sub(s.pos).normalize();
      const c = _d.dot(s.containerAxis);       // cos of angle from the container's open axis
      if (c > 0.93) return 0.04;               // straight up the open mouth (collimated by 15 cm of plug well)
      if (c > 0.8) return 0.004;
      return 1.5e-4;
    }
    return 1;
  }

  // air kerma rate at p, µGy/h
  airKerma(p) {
    const s = this.source;
    const r2 = Math.max(p.distanceToSquared(s.pos), 0.0004);
    const H = this.housing(p);
    let k = this.sk / r2 * H * this.transmission(s.pos, p);
    // in-room scatter (walls/floor/patient), roughly 4% of the 1 m primary, diluted by distance
    if (this.inVault(p) || this.inCorridor(p)) {
      k += this.sk * H * 0.04 / (r2 + 2.0);
    }
    // maze scatter toward the door and control area
    if (!this.inVault(p) || this.inCorridor(p) || p.z > 3.0) {
      const d1 = Math.max(s.pos.distanceToSquared(this.mazeMouth), 0.25);
      const kMouth = this.sk * H * 0.02 / d1 * this.transmission(s.pos, this.mazeMouth);
      if (this.inCorridor(p) || (p.z > 2.1 && p.z <= 3.9)) {
        k += kMouth / Math.max(this.mazeMouth.distanceToSquared(p), 0.25);
      } else if (this.inControl(p)) {
        const kDoor = kMouth / Math.max(this.mazeMouth.distanceToSquared(this.doorInner), 0.25);
        const T = this.door.open ? 1 : this.door.closedT;
        k += kDoor * T * 0.3 / Math.max(this.doorOuter.distanceToSquared(p), 0.25);
      }
    }
    return k;
  }

  // ambient dose equivalent rate (µSv/h) including background
  hStar(p) { return this.airKerma(p) * IR192.hStarPerKa + IR192.backgroundUSvH; }
  mRh(p) { return this.airKerma(p) / IR192.uGyPerMr + IR192.backgroundUSvH / 10; }

  // tissue dose rate at r (m) from the source, Gy/h (TG-43 point-source, g(r)~1 close in)
  tissueRate(rM) {
    const rcm = Math.max(rM * 100, 0.5);
    return this.sk * IR192.lambda / (rcm * rcm) / 100; // cGy/h -> Gy/h
  }
}

// Personal dose tracker for the trainee
export class Dosimetry {
  constructor() { this.reset(); }
  reset() {
    this.body = 0; this.lens = 0; this.handL = 0; this.handR = 0; // mSv
    this.bodyRate = 0; this.handRateMax = 0;
    this.patientPx = 0; this.patientMucosa = 0; this.patientRate = 0; // Gy, Gy/h
    this.peakBodyRate = 0;
    this.log = []; this._t = 0;
  }
  // dt in seconds, rates in µSv/h (air kerma scaled inside)
  step(dt, field, pts, patientR) {
    const h = dt / 3600;
    const kb = field.airKerma(pts.body), kl = field.airKerma(pts.head);
    const kL = field.airKerma(pts.handL), kR = field.airKerma(pts.handR);
    this.bodyRate = kb * IR192.effPerKa;         // µSv/h
    this.body += this.bodyRate * h / 1000;      // mSv
    this.lens += kl * IR192.hStarPerKa * h / 1000;
    this.handL += kL * IR192.skinPerKa * h / 1000;
    this.handR += kR * IR192.skinPerKa * h / 1000;
    this.handRateMax = Math.max(kL, kR) * IR192.skinPerKa;
    this.peakBodyRate = Math.max(this.peakBodyRate, this.bodyRate);
    if (patientR != null) {
      this.patientRate = field.tissueRate(patientR.px);
      this.patientPx += this.patientRate * h;
      this.patientMucosa += field.tissueRate(patientR.mucosa) * h;
    } else this.patientRate = 0;
    this._t += dt;
  }
  get handMax() { return Math.max(this.handL, this.handR); }
}

export function fmtDoseRate(uSvh, unit) {
  if (unit === 'uSv') {
    if (uSvh >= 1e6) return [(uSvh / 1e6).toFixed(uSvh >= 1e7 ? 0 : 1), 'Sv/h'];
    if (uSvh >= 1000) return [(uSvh / 1000).toFixed(uSvh >= 1e4 ? 0 : 1), 'mSv/h'];
    return [uSvh >= 100 ? uSvh.toFixed(0) : uSvh >= 10 ? uSvh.toFixed(1) : uSvh.toFixed(2), 'µSv/h'];
  }
  const mr = uSvh / 1.27 / 8.76 * 1; // approx conversion back to exposure for display
  if (mr >= 1000) return [(mr / 1000).toFixed(mr >= 1e4 ? 1 : 2), 'R/h'];
  return [mr >= 100 ? mr.toFixed(0) : mr >= 10 ? mr.toFixed(1) : mr.toFixed(2), 'mR/h'];
}

export function fmtDose(mSv) {
  if (mSv >= 1) return mSv.toFixed(2) + ' mSv';
  return (mSv * 1000).toFixed(mSv * 1000 >= 100 ? 0 : 1) + ' µSv';
}
