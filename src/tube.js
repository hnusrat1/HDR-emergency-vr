// Transfer tube from the afterloader turret to the applicator connector, rebuilt every frame.
import * as THREE from 'three';

const SEG = 64, RAD = 10;

export class TransferTube {
  constructor(scene, material, length = 1.45, radius = 0.0045) {
    this.length = length; this.radius = radius;
    const n = (SEG + 1) * (RAD + 1);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i <= SEG; i++) for (let j = 0; j <= RAD; j++) {
      const k = i * (RAD + 1) + j;
      uv[k * 2] = i / SEG; uv[k * 2 + 1] = j / RAD;
      if (i < SEG && j < RAD) { const a = k, b = k + RAD + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'transfer_tube';
    scene.add(this.mesh);
    this.pts = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());
    this.p0 = new THREE.Vector3(); this.p1 = new THREE.Vector3(); this.p2 = new THREE.Vector3(); this.p3 = new THREE.Vector3();
  }

  // a: port position, da: direction out of the port; b: connector position, db: direction out of the connector
  update(a, da, b, db) {
    const d = a.distanceTo(b);
    const slack = Math.max(0, this.length - d);
    const h = 0.18 + slack * 0.35;
    this.p0.copy(a); this.p1.copy(a).addScaledVector(da, h);
    this.p2.copy(b).addScaledVector(db, h); this.p3.copy(b);
    // gravity sag on the middle controls
    const sag = Math.min(0.45, slack * 0.55);
    this.p1.y -= sag * 0.6; this.p2.y -= sag * 0.6;
    const P = this.pts;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, u = 1 - t;
      P[i].set(0, 0, 0)
        .addScaledVector(this.p0, u * u * u).addScaledVector(this.p1, 3 * u * u * t)
        .addScaledVector(this.p2, 3 * u * t * t).addScaledVector(this.p3, t * t * t);
      P[i].y -= Math.sin(Math.PI * t) * sag * 0.25;
      if (P[i].y < 0.006) P[i].y = 0.006;
    }
    // parallel-transport frames
    const T = new THREE.Vector3(), N = new THREE.Vector3(), Bn = new THREE.Vector3(), prevT = new THREE.Vector3();
    for (let i = 0; i <= SEG; i++) {
      if (i < SEG) T.subVectors(P[i + 1], P[i]); else T.subVectors(P[i], P[i - 1]);
      T.normalize();
      if (i === 0) { N.set(0, 1, 0); if (Math.abs(T.dot(N)) > 0.9) N.set(1, 0, 0); N.sub(T.clone().multiplyScalar(T.dot(N))).normalize(); }
      else { const ax = new THREE.Vector3().crossVectors(prevT, T); const s = ax.length(); if (s > 1e-6) { ax.divideScalar(s); N.applyAxisAngle(ax, Math.asin(Math.min(1, s))); } }
      prevT.copy(T);
      Bn.crossVectors(T, N).normalize();
      for (let j = 0; j <= RAD; j++) {
        const ang = j / RAD * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
        const k = (i * (RAD + 1) + j) * 3;
        const nx = N.x * c + Bn.x * s, ny = N.y * c + Bn.y * s, nz = N.z * c + Bn.z * s;
        this.nrm[k] = nx; this.nrm[k + 1] = ny; this.nrm[k + 2] = nz;
        this.pos[k] = P[i].x + nx * this.radius; this.pos[k + 1] = P[i].y + ny * this.radius; this.pos[k + 2] = P[i].z + nz * this.radius;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}
