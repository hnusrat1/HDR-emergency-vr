// Loads the baked HDR suite, builds PBR + lightmapped materials, captures reflection probes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { B } from './dose.js';

const FULL_COLOR_TEX = new Set(['vinyl', 'ceiling', 'wood', 'speckle']);
const NOLM_ZONE = 'unlit';

// zone boxes for box-projected reflections (three coords)
export const ZONES = {
  vault: { min: new THREE.Vector3(-3.0, 0.0, -3.4), max: new THREE.Vector3(3.0, 2.75, 3.4), probe: B(0.0, 0.6, 1.45) },
  control: { min: new THREE.Vector3(-3.5, 0.0, 3.9), max: new THREE.Vector3(3.5, 2.75, 6.6), probe: B(0.2, -5.25, 1.45) },
};
export const zoneAt = (p) => (p.z > 3.9 ? 'control' : 'vault');

export class World {
  constructor(renderer, scene, onProgress) {
    this.renderer = renderer;
    this.scene = scene;
    this.onProgress = onProgress || (() => {});
    this.texLoader = new THREE.TextureLoader();
    this.tex = new Map();
    this.mats = new Map();
    this.nodes = {};
    this.markers = {};
    this.dynamic = [];
    this.screens = {};
    this.env = {};
    this.staticMeshes = [];
    this.colliders = [];
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  loadTex(url) {
    this.pending = (this.pending || 0) + 1;
    const done = () => { this.pending--; if (this.pending === 0 && this._idle) this._idle(); };
    return this.texLoader.load(url, done, undefined, done);
  }
  idle() { return new Promise(res => { if (!this.pending) res(); else this._idle = res; setTimeout(res, 20000); }); }

  async load(base = './assets/') {
    const mgr = new THREE.LoadingManager();
    let loaded = 0, total = 1;
    mgr.onProgress = (url, l, t) => { loaded = l; total = t; this.onProgress(l / Math.max(t, 1), url); };
    this.texLoader = new THREE.TextureLoader(mgr);
    const [spec, lmMeta] = await Promise.all([
      fetch(base + 'materials.json').then(r => r.json()),
      fetch(base + 'lightmaps.json').then(r => r.json()),
    ]);
    this.spec = spec;
    this.lmMeta = lmMeta;
    this.base = base;
    // lightmaps
    this.lightmaps = {};
    for (const z of Object.keys(lmMeta)) {
      const t = this.loadTex(`${base}lm_${z}.png`);
      t.channel = 1;
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4;
      this.lightmaps[z] = t;
    }
    const draco = new DRACOLoader(mgr).setDecoderPath('./vendor/three/examples/jsm/libs/draco/gltf/');
    const gl = new GLTFLoader(mgr).setDRACOLoader(draco);
    const gltf = await gl.loadAsync(base + 'hdr_suite.glb');
    this.root = gltf.scene;
    this.scene.add(this.root);
    this.organize();
    await this.idle();
    // upload everything once so the probe capture sees final textures
    this.renderer.compile(this.scene, new THREE.PerspectiveCamera());
    this.captureProbes();
    return this;
  }

  texture(key, kind, tile) {
    const id = `${key}_${kind}_${tile}`;
    if (this.tex.has(id)) return this.tex.get(id);
    const srcId = `${key}_${kind}`;
    let src = this.tex.get(srcId);
    if (!src) {
      src = this.loadTex(`${this.base}tex/${key}_${kind}.jpg`);
      src.wrapS = src.wrapT = THREE.RepeatWrapping;
      src.anisotropy = Math.min(8, this.maxAniso);
      src.colorSpace = kind === 'c' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      this.tex.set(srcId, src);
    }
    const t = src.clone();
    t.repeat.set(1 / tile, 1 / tile);
    this.tex.set(id, t);
    return t;
  }

  decal(key) {
    const id = 'decal_' + key;
    if (this.tex.has(id)) return this.tex.get(id);
    const ext = ['sign_procedure_console', 'sign_procedure_room', 'sign_whiteboard'].includes(key) ? 'jpg' : 'png';
    const t = this.loadTex(`${this.base}tex/${key}.${ext}`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.maxAniso);
    t.flipY = false;
    this.tex.set(id, t);
    return t;
  }

  // Patch: baked surfaces take diffuse from the lightmap only; specular IBL is box-projected
  // and occluded by the lightmap so corners and under-table areas don't glow.
  patch(mat, zone, baked) {
    const z = ZONES[zone] || ZONES.vault;
    mat.userData.zone = zone;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uBoxMin = { value: z.min };
      sh.uniforms.uBoxMax = { value: z.max };
      sh.uniforms.uProbe = { value: z.probe };
      sh.uniforms.uSpecOcc = { value: 2.2 };
      mat.userData.shader = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBPWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBPWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBPWorld;\nuniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform vec3 uProbe; uniform float uSpecOcc;')
        .replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
          'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );',
          `reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
          {
            vec3 rd = normalize(reflectVec);
            vec3 t1 = (uBoxMax - vBPWorld) / rd;
            vec3 t2 = (uBoxMin - vBPWorld) / rd;
            vec3 tf = max(t1, t2);
            float d = min(min(tf.x, tf.y), tf.z);
            vec3 hit = vBPWorld + rd * max(d, 0.0);
            reflectVec = hit - uProbe;
          }`))
        .replace('#include <lights_fragment_maps>', baked ? `
          #if defined( RE_IndirectDiffuse )
            vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
            vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
            irradiance += lightMapIrradiance;
            float lmOcc = clamp( dot( lightMapTexel.rgb, vec3(0.3333) ) * uSpecOcc, 0.0, 1.0 );
          #endif
          #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
            radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * lmOcc;
            #ifdef USE_CLEARCOAT
              clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * lmOcc;
            #endif
          #endif` : '#include <lights_fragment_maps>');
    };
    mat.customProgramCacheKey = () => (baked ? 'bp_lm_' : 'bp_') + zone;
  }

  material(name, zone, opts = {}) {
    const s0 = this.spec[name] || {};
    // Cycles' diffuse bake is black for metals (no diffuse lobe), so metals use the probes instead
    const baked = !!opts.lightmap && !(s0.metal > 0.5);
    const id = `${name}|${zone}|${baked ? opts.lmZone : ''}|${opts.unique || ''}`;
    if (this.mats.has(id) && !opts.unique) return this.mats.get(id);
    const s = this.spec[name] || { color: '#cccccc', rough: 0.6, metal: 0 };
    let m;
    if (s.screen) {
      m = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    } else if (s.nolm && !s.decal) {
      // emissive / unlit surfaces
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(s.emissive || s.color) });
      m.color.multiplyScalar(s.emissiveIntensity != null ? Math.max(s.emissiveIntensity, 0.02) : 1);
      if (s.transparent) { m.transparent = true; m.opacity = 1 - s.transparent * 0.5; }
      m.userData.baseColor = new THREE.Color(s.color);
      m.userData.emissive = new THREE.Color(s.emissive || s.color);
    } else {
      const P = s.clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
      m = new P({ color: new THREE.Color(s.color), roughness: s.rough, metalness: s.metal });
      if (s.clearcoat) { m.clearcoat = s.clearcoat; m.clearcoatRoughness = 0.18; }
      if (s.tex) {
        const tile = s.tile || 1;
        if (FULL_COLOR_TEX.has(s.tex) || ['fabric', 'leather', 'paint'].includes(s.tex)) {
          m.map = this.texture(s.tex, 'c', tile);
          if (FULL_COLOR_TEX.has(s.tex)) m.color.set(0xffffff);
        }
        if (s.tex !== 'speckle') {
          m.normalMap = this.texture(s.tex, 'n', tile);
          m.normalScale.set(s.tex === 'paint' ? 0.35 : 0.8, s.tex === 'paint' ? 0.35 : 0.8);
        }
        if (['vinyl', 'ceiling', 'fabric', 'leather', 'wood'].includes(s.tex)) m.roughnessMap = this.texture(s.tex, 'r', tile);
      }
      if (s.decal) {
        m.map = this.decal(s.decal);
        m.color.set(0xffffff);
        m.roughness = 0.55;
        m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
      }
      if (s.emissive) {
        m.emissive = new THREE.Color(s.emissive);
        m.emissiveIntensity = s.emissiveIntensity || 0;
        if (s.decal) m.emissiveMap = m.map;
      }
      if (s.transparent) {
        m.transparent = true; m.opacity = s.transparent; m.depthWrite = false;
      }
      if (baked) {
        m.lightMap = this.lightmaps[opts.lmZone];
        m.lightMapIntensity = Math.PI * (this.lmMeta[opts.lmZone].scale || 1);
      }
      this.patch(m, zone, baked);
    }
    m.name = name;
    if (m.isMeshStandardMaterial && this.env[zone]) { m.envMap = this.env[zone]; m.envMapIntensity = m.metalness > 0.5 ? 1.0 : 0.85; }
    this.mats.set(id, m);
    return m;
  }

  patientMaterial(name, lmZone) {
    const id = 'pt|' + name;
    if (this.mats.has(id)) return this.mats.get(id);
    const files = { pt_skin: 'skin_c.jpg', pt_hair: 'hair_c.png', pt_eyebrows: 'eyebrows_c.png', pt_eyelashes: 'eyelashes_c.png', pt_eyes: 'eyes_c.jpg' };
    const t = this.loadTex(this.base + 'patient/' + files[name]);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = 4;
    const alpha = ['pt_hair', 'pt_eyebrows', 'pt_eyelashes'].includes(name);
    const m = new THREE.MeshStandardMaterial({
      map: t, roughness: name === 'pt_skin' ? 0.58 : name === 'pt_eyes' ? 0.15 : 0.7, metalness: 0,
      alphaTest: alpha ? 0.45 : 0, transparent: false, side: alpha ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (alpha) m.alphaToCoverage = true;
    if (name === 'pt_skin') { m.color.setRGB(1.0, 0.97, 0.95); }
    if (name === 'pt_hair') { m.color.setRGB(0.92, 0.86, 0.82); m.roughness = 0.62; }
    // thin alpha cards and the eyes read better lit by the room probe than by their own lightmap texels
    const baked = !(alpha || name === 'pt_eyes');
    if (baked) {
      m.lightMap = this.lightmaps[lmZone];
      m.lightMapIntensity = Math.PI * (this.lmMeta[lmZone].scale || 1);
    } else m.envMapIntensity = 0.7;
    this.patch(m, 'vault', baked);
    m.name = name;
    this.mats.set(id, m);
    return m;
  }

  organize() {
    const lmZoneOf = (n) => n.startsWith('LM_') ? n.slice(3) : null;
    this.root.traverse((o) => {
      if (o.name && o.name.startsWith('PT_')) this.markers[o.name.slice(3)] = o;
    });
    const top = [...this.root.children];
    for (const node of top) {
      const name = node.name;
      this.nodes[name] = node;
      const lmz = lmZoneOf(name);
      const zone = lmz ? (lmz === 'control' ? 'control' : 'vault') : zoneAt(node.getWorldPosition(new THREE.Vector3()));
      node.traverse((o) => {
        if (!o.isMesh) return;
        const mname = o.material && o.material.name;
        o.matrixAutoUpdate = !!(name.startsWith('DYN_') || name.startsWith('SCREEN_'));
        if (lmz) {
          o.material = (mname && mname.startsWith('pt_')) ? this.patientMaterial(mname, lmz) : this.material(mname, zone, { lightmap: true, lmZone: lmz });
          o.userData.lmZone = lmz; o.userData.zone = zone;
          this.staticMeshes.push(o);
          this.colliders.push(o);
        } else if (name === 'UNLIT') {
          o.material = this.material(mname, zoneAt(o.getWorldPosition(new THREE.Vector3())));
          this.staticMeshes.push(o);
        } else if (name === 'GLASS') {
          o.material = this.material(mname, zoneAt(o.getWorldPosition(new THREE.Vector3())));
          o.renderOrder = 2;
        } else {
          // dynamic objects: unique materials for movable things so env can switch zones
          const movable = /DYN_(survey_meter|phone|forceps|cutters|applicator|container_lid)/.test(name);
          o.material = this.material(mname, zone, { unique: movable ? name : '' });
          if (o.material.isMeshBasicMaterial && this.spec[mname] && this.spec[mname].screen) {
            this.screens[name] = o;
          }
        }
      });
      if (name.startsWith('DYN_')) this.dynamic.push(node);
      if (name.startsWith('SCREEN_')) this.screens[name] = node;
    }
    // nested screens (meter display parented to meter)
    this.root.traverse((o) => { if (o.name && o.name.startsWith('SCREEN_')) this.screens[o.name] = o; });
    for (const o of this.staticMeshes) { o.updateMatrixWorld(true); o.matrixAutoUpdate = false; }
    this.unburyDecals();
  }

  // Several control-room signs were built 1 mm on the wrong side of the wall face, and the
  // console button label 5 mm inside its panel. They baked black and only passed the depth test
  // at some viewing angles (polygon offset), so in a headset they flickered as black shards next
  // to the screens. Lift each buried decal triangle out of the surface it is stuck in and light
  // it with that surface's own lightmap texels, so it matches the wall around it.
  unburyDecals() {
    const ray = new THREE.Raycaster();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), w = new THREE.Vector3(), hn = new THREE.Vector3();
    const n3 = new THREE.Matrix3();
    const isDecal = (o) => o.material && o.material.polygonOffset && this.spec[o.material.name] && this.spec[o.material.name].decal;
    const decals = this.colliders.filter(isDecal);
    const solids = this.colliders.filter(o => !isDecal(o));
    const solidBoxes = solids.map(o => new THREE.Box3().setFromObject(o));
    for (const o of decals) {
      const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv, uv1 = g.attributes.uv1, nrm = g.attributes.normal;
      if (!uv1 || !uv || pos.count > 256) continue;
      const box = new THREE.Box3().setFromObject(o).expandByScalar(0.03);
      const near = solids.filter((s, i) => solidBoxes[i].intersectsBox(box));
      if (!near.length) continue;
      const M = o.matrixWorld, Minv = M.clone().invert();
      const idx = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
      const probe = (vi, n) => {
        w.fromBufferAttribute(pos, vi).applyMatrix4(M);
        ray.set(w.clone().addScaledVector(n, 0.02), n.clone().negate()); ray.far = 0.05;
        const h = ray.intersectObjects(near, false).find(h => h.face && h.uv1 &&
          hn.copy(h.face.normal).applyMatrix3(n3.getNormalMatrix(h.object.matrixWorld)).normalize().dot(n) > 0.9);
        return h ? { h, buried: h.distance < 0.02 - 0.0003 } : null;
      };
      const keep = [], lift = [];
      for (let t = 0; t < idx.length; t += 3) {
        const ids = [idx[t], idx[t + 1], idx[t + 2]];
        a.fromBufferAttribute(pos, ids[0]).applyMatrix4(M); b.fromBufferAttribute(pos, ids[1]).applyMatrix4(M); c.fromBufferAttribute(pos, ids[2]).applyMatrix4(M);
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
        const res = ids.map(i => probe(i, n));
        const zone0 = res[0] && res[0].h.object.userData.lmZone;
        const ok = res.every(r => r && r.h.object.userData.lmZone === zone0);
        if (ok && res.some(r => r.buried)) lift.push({ ids, res, n }); else keep.push(...ids);
      }
      if (!lift.length) continue;
      // new mesh for the lifted triangles, in the decal's own local space
      const P = [], N = [], U = [], U1 = [];
      for (const { ids, res, n } of lift) {
        ids.forEach((vi, k) => {
          const p = res[k].h.point.clone().addScaledVector(n, 0.0012).applyMatrix4(Minv);
          P.push(p.x, p.y, p.z);
          if (nrm) N.push(nrm.getX(vi), nrm.getY(vi), nrm.getZ(vi));
          U.push(uv.getX(vi), uv.getY(vi));
          U1.push(res[k].h.uv1.x, res[k].h.uv1.y);
        });
      }
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      if (N.length) ng.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); else ng.computeVertexNormals();
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      ng.setAttribute('uv1', new THREE.Float32BufferAttribute(U1, 2));
      const host = lift[0].res[0].h.object.userData;
      const mesh = new THREE.Mesh(ng, this.material(o.material.name, o.userData.zone, { lightmap: true, lmZone: host.lmZone }));
      mesh.name = o.name + '_lifted';
      mesh.matrix.copy(o.matrix); mesh.matrixAutoUpdate = false;
      o.parent.add(mesh);
      mesh.updateMatrixWorld(true);
      this.staticMeshes.push(mesh);
      if (keep.length) { g.setIndex(keep); g.computeBoundingSphere(); } else o.visible = false;
    }
  }

  captureProbes() {
    const r = this.renderer;
    const pmrem = new THREE.PMREMGenerator(r);
    for (const [zname, z] of Object.entries(ZONES)) {
      const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cam = new THREE.CubeCamera(0.05, 30, rt);
      cam.position.copy(z.probe);
      cam.updateMatrixWorld(true);
      this.scene.updateMatrixWorld(true);
      const xr = r.xr.enabled; r.xr.enabled = false;
      const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
      cam.update(r, this.scene);
      r.toneMapping = tm; r.xr.enabled = xr;
      this.env[zname] = pmrem.fromCubemap(rt.texture).texture;
      rt.dispose();
    }
    pmrem.dispose();
    for (const m of this.mats.values()) {
      if (m.isMeshStandardMaterial) {
        m.envMap = this.env[m.userData.zone || 'vault'];
        m.envMapIntensity = m.metalness > 0.5 ? 1.0 : 0.85;
        m.needsUpdate = true;
      }
    }
  }

  // swap env for movable objects when they cross zones
  updateMovableEnv(obj) {
    const p = obj.getWorldPosition(new THREE.Vector3());
    const z = zoneAt(p);
    if (obj.userData._zone === z) return;
    obj.userData._zone = z;
    const box = ZONES[z];
    obj.traverse((o) => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) {
        o.material.envMap = this.env[z];
        const sh = o.material.userData.shader;
        if (sh) { sh.uniforms.uBoxMin.value = box.min; sh.uniforms.uBoxMax.value = box.max; sh.uniforms.uProbe.value = box.probe; }
      }
    });
  }
}
