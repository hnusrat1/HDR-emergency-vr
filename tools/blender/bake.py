"""Join static geometry into zones, unwrap lightmap UVs, bake Cycles diffuse lighting,
denoise with OIDN, and export the GLB + lightmaps for the web app."""
import bpy, bmesh, sys, os, json, math, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from mathutils import Vector
import mats
from lib import coll, join

ROOT = '/home/claude/hdr'
OUT = ROOT + '/site/assets'
SAMPLES = int(os.environ.get('BAKE_SAMPLES', '96'))
NOLM = {k for k, v in mats.SPEC.items() if v.get('nolm')}
GLASS = {'glass'}

ZONES = {
    'vault_arch': 2048,
    'vault_props': 2048,
    'control': 2048,
    'patient': 1024,
}
ARCH_PREFIX = ('floor_', 'ceil_', 'wall_', 'cove', 'rail', 'cg', 'dframe', 'threshold', 'hall_', 'trof_frame', 'dl_trim')


def zone_of(o):
    if o.name.startswith('pt_') or o.name.startswith('st_') and o.users_collection[0].name == 'PATIENT':
        return 'patient'
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    cy = sum(v.y for v in bb) / 8
    if cy < -3.9:
        return 'control'
    if o.name.startswith(ARCH_PREFIX):
        return 'vault_arch'
    return 'vault_props'


def split_by_material(objs, matset):
    """Separate faces using materials in matset into new objects; returns list of separated objects."""
    out = []
    for o in objs:
        idx = [i for i, m in enumerate(o.data.materials) if m and m.name in matset]
        if not idx:
            continue
        if len(idx) == len(o.data.materials):
            out.append(o)
            continue
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        for i in idx:
            o.active_material_index = i
            bpy.ops.object.material_slot_select()
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        new = [x for x in bpy.context.selected_objects if x is not o]
        out += new
    return out


def ensure_uv0(o):
    me = o.data
    if len(me.uv_layers) == 0:
        me.uv_layers.new(name='UVMap')
    me.uv_layers[0].name = 'UVMap'
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])


def lightmap_uv(o, margin):
    me = o.data
    lm = me.uv_layers.new(name='lm')
    me.uv_layers.active = lm
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['UVMap']


def setup_bake_nodes(o, img):
    for m in o.data.materials:
        if m is None:
            continue
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.name in ('LM_IMG', 'LM_UV'):
                nt.nodes.remove(n)
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.name = 'LM_UV'
        uvn.uv_map = 'lm'
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.name = 'LM_IMG'
        tn.image = img
        nt.links.new(uvn.outputs['UV'], tn.inputs['Vector'])
        nt.nodes.active = tn


def denoise(arr):
    try:
        import oidn
        h, w, _ = arr.shape
        dev = oidn.NewDevice(oidn.DEVICE_TYPE_CPU)
        oidn.CommitDevice(dev)
        flt = oidn.NewFilter(dev, 'RT')
        src = np.ascontiguousarray(arr[..., :3].astype(np.float32))
        dst = np.zeros_like(src)
        oidn.SetSharedFilterImage(flt, 'color', src, oidn.FORMAT_FLOAT3, w, h)
        oidn.SetSharedFilterImage(flt, 'output', dst, oidn.FORMAT_FLOAT3, w, h)
        oidn.CommitFilter(flt)
        oidn.ExecuteFilter(flt)
        oidn.ReleaseFilter(flt)
        oidn.ReleaseDevice(dev)
        return dst
    except Exception as e:
        print('denoise failed', e)
        return arr[..., :3]


def dilate(rgb, mask, iters=16):
    import cv2
    rgb = rgb.copy()
    m = mask.astype(np.uint8)
    k = np.ones((3, 3), np.uint8)
    for _ in range(iters):
        grown = cv2.dilate(m, k)
        ring = (grown > 0) & (m == 0)
        if not ring.any():
            break
        s = cv2.blur(rgb * m[..., None], (3, 3))
        c = cv2.blur(m.astype(np.float32), (3, 3))[..., None]
        fill = s / np.maximum(c, 1e-6)
        rgb[ring] = fill[ring]
        m = grown
    return rgb


def main():
    t0 = time.time()
    bpy.ops.wm.open_mainfile(filepath=ROOT + '/build/scene.blend')
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    sc.cycles.glossy_bounces = 1
    sc.cycles.transmission_bounces = 2
    sc.cycles.transparent_max_bounces = 4
    sc.cycles.use_denoising = False
    if sc.world is None:
        sc.world = bpy.data.worlds.new('W')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0, 0, 0, 1)

    static = [o for o in bpy.data.collections['STATIC'].objects if o.type == 'MESH']
    patient = [o for o in bpy.data.collections['PATIENT'].objects if o.type == 'MESH']
    for o in static + patient:
        ensure_uv0(o)
    # pull out unlit (emissive/screens) and glass faces
    unlit = split_by_material(static + patient, NOLM)
    glass = split_by_material([o for o in static if o.name not in {u.name for u in unlit}], GLASS)
    skip = {o.name for o in unlit + glass}
    zones = {k: [] for k in ZONES}
    for o in static + patient:
        if o.name in skip or o.name not in bpy.data.objects:
            continue
        zones['patient' if o in patient else zone_of(o)].append(o)
    joined = {}
    for z, objs in zones.items():
        if not objs:
            continue
        ob = join(objs, 'LM_' + z)
        joined[z] = ob
        print('zone', z, len(ob.data.polygons), 'faces', round(time.time() - t0), 's')
    U = join(unlit, 'UNLIT') if unlit else None
    G = join(glass, 'GLASS') if glass else None

    for z, ob in joined.items():
        lightmap_uv(ob, 4.0 / ZONES[z])
        print('uv', z, round(time.time() - t0), 's')

    # bake each zone (BAKE_ZONES=patient bakes only that zone and keeps the existing PNGs for the rest)
    only = [x for x in os.environ.get('BAKE_ZONES', '').split(',') if x]
    meta = json.load(open(OUT + '/lightmaps.json')) if only and os.path.exists(OUT + '/lightmaps.json') else {}
    for z, ob in joined.items():
        if only and z not in only:
            continue
        size = ZONES[z]
        img = bpy.data.images.new('lm_' + z, size, size, alpha=True, float_buffer=True)
        img.generated_color = (0, 0, 0, 0)
        setup_bake_nodes(ob, img)
        ob.data.uv_layers.active = ob.data.uv_layers['lm']   # Cycles bakes into the active UV map
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, margin_type='EXTEND',
                            use_clear=True, target='IMAGE_TEXTURES')
        a = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
        np.save(ROOT + f'/build/lm_{z}_raw.npy', a)
        mask = a[..., 3] > 0.5
        lum = a[..., :3][mask].max(-1) if mask.any() else a[..., :3].max(-1).ravel()
        scale = float(np.percentile(lum, 99.7)) if lum.size else 1.0
        rgb = np.clip(a[..., :3] / scale, 0, 1)
        rgb = denoise(np.concatenate([rgb, a[..., 3:]], -1))
        rgb = dilate(rgb, mask, 24)
        meta[z] = dict(size=size, scale=scale)
        enc = np.clip(rgb, 0, 1)
        enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
        enc = enc + (np.random.default_rng(1).random(enc.shape) - 0.5) / 255.0  # dither
        from PIL import Image
        Image.fromarray((np.clip(enc, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]).save(OUT + f'/lm_{z}.png', optimize=True)
        print('baked', z, 'scale', scale, round(time.time() - t0), 's')
        bpy.data.images.remove(img)

    for ob in joined.values():
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
    json.dump(meta, open(OUT + '/lightmaps.json', 'w'), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=ROOT + '/build/scene_baked.blend')
    export()
    print('done', round(time.time() - t0), 's')


def simplify_materials():
    for m in bpy.data.materials:
        m.use_nodes = True
        nt = m.node_tree
        col = tuple(m.diffuse_color)
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        b.inputs['Base Color'].default_value = col
        nt.links.new(b.outputs[0], out.inputs[0])


def export():
    # drop lights, simplify materials, export everything except lights
    for o in list(bpy.data.collections['LIGHTS'].objects):
        bpy.data.objects.remove(o, do_unlink=True)
    simplify_materials()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=OUT + '/hdr_suite.glb', export_format='GLB', use_selection=False,
                              export_extras=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_apply=True, export_yup=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=16, export_draco_normal_quantization=10,
                              export_draco_texcoord_quantization=14, export_cameras=False, export_lights=False)
    print('exported', os.path.getsize(OUT + '/hdr_suite.glb') / 1e6, 'MB')


if __name__ == '__main__':
    if '--export-only' in sys.argv:
        bpy.ops.wm.open_mainfile(filepath=ROOT + '/build/scene_baked.blend')
        export()
    else:
        main()
