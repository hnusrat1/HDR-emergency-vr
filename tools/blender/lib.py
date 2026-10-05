"""Geometry helpers for the HDR suite builder (Blender 5.x, Z-up, meters)."""
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

D2R = math.pi / 180.0


def coll(name):
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def mat(name):
    from mats import get_mat
    return get_mat(name)


# ---------------------------------------------------------------- bmesh prims
def bm_box(sx, sy, sz, c=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def bm_cyl(r, h, segs=32, c=(0, 0, 0), axis='Z', r2=None, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs,
                          radius1=r, radius2=r if r2 is None else r2, depth=h)
    if axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    elif axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def bm_sphere(r, c=(0, 0, 0), segs=24, rings=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def bm_lathe(profile, segs=32, c=(0, 0, 0), axis='Z', close_top=False, close_bottom=False):
    """profile: list of (r, z). Revolved around Z, then oriented to axis."""
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ring = []
        for (r, z) in profile:
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    n = len(profile)
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        for j in range(n - 1):
            if profile[j][0] < 1e-6 and profile[j + 1][0] < 1e-6:
                continue
            try:
                bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if close_bottom:
        e = [v for v in bm.verts if abs(v.co.z - profile[0][1]) < 1e-6 and v.co.length > 1e-6]
    if axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    elif axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    bm.normal_update()
    return bm


def bm_prism(outline, z0, z1):
    """Extrude a closed 2D outline [(x,y),...] (CCW) between z0 and z1."""
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for (x, y) in outline]
    top = [bm.verts.new((x, y, z1)) for (x, y) in outline]
    n = len(outline)
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bm.normal_update()
    return bm


def bm_plane(sx, sy, c=(0, 0, 0), normal='Z'):
    """Plane with 0..1 UVs. normal: +Z,-Z,+X,-X,+Y,-Y"""
    bm = bmesh.new()
    hx, hy = sx / 2, sy / 2
    pts = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    vs = [bm.verts.new((x, y, 0)) for x, y in pts]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new('UVMap')
    for loop, uv in zip(f.loops, uvs):
        loop[uvl].uv = uv
    rot = {
        'Z': Matrix.Identity(3),
        '-Z': Matrix.Rotation(math.pi, 3, 'X'),
        # wall planes: +Y normal means facing north; texture upright (local y -> world z)
        'Y': Matrix.Rotation(-math.pi / 2, 3, 'X') @ Matrix.Rotation(math.pi, 3, 'Z'),
        '-Y': Matrix.Rotation(math.pi / 2, 3, 'X'),
        'X': Matrix.Rotation(math.pi / 2, 3, 'Z') @ Matrix.Rotation(math.pi / 2, 3, 'X'),
        '-X': Matrix.Rotation(-math.pi / 2, 3, 'Z') @ Matrix.Rotation(math.pi / 2, 3, 'X'),
    }[normal]
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def bm_tube_path(points, r, segs=12, closed=False):
    """Sweep a circle along a polyline (list of Vector). Returns bmesh."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        if prev_n is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(up).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        b = t.cross(n).normalized()
        prev_n = n
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ring.append(bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * r))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bm.normal_update()
    return bm


def bm_merge(*bms):
    out = bmesh.new()
    me = bpy.data.meshes.new('_tmp')
    for b in bms:
        b.to_mesh(me)
        out.from_mesh(me)
        b.free()
    bpy.data.meshes.remove(me)
    return out


# ---------------------------------------------------------------- objects
def obj_from_bm(name, bm, material=None, collection='STATIC', origin=None, smooth_angle=35,
                bevel=0.0, bevel_segs=2, uv='box', uv_scale=1.0, props=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll(collection).objects.link(ob)
    if material is not None:
        mats = material if isinstance(material, (list, tuple)) else [material]
        for m in mats:
            me.materials.append(mat(m) if isinstance(m, str) else m)
    if bevel > 0:
        md = ob.modifiers.new('bevel', 'BEVEL')
        md.width = bevel
        md.segments = bevel_segs
        md.limit_method = 'ANGLE'
        md.angle_limit = 50 * D2R
        md.harden_normals = False
        apply_modifiers(ob)
        me = ob.data
    if smooth_angle is not None:
        for p in me.polygons:
            p.use_smooth = True
        try:
            me.set_sharp_from_angle(angle=smooth_angle * D2R)
        except Exception:
            pass
    if uv == 'box':
        box_uv(ob, uv_scale)
    elif uv == 'keep':
        pass
    if origin is not None:
        set_origin(ob, origin)
    if props:
        for k, v in props.items():
            ob[k] = v
    return ob


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def set_origin(ob, origin):
    """Move object origin to world point `origin` keeping geometry in place."""
    o = Vector(origin)
    mw = ob.matrix_world.copy()
    local = mw.inverted() @ o
    ob.data.transform(Matrix.Translation(-local))
    ob.matrix_world = mw @ Matrix.Translation(local)


def box_uv(ob, scale=1.0, layer='UVMap'):
    """World-space box projection, 1 UV unit = `scale` meters."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.get(layer) or bm.loops.layers.uv.new(layer)
    mw = ob.matrix_world
    rot = mw.to_3x3()
    for f in bm.faces:
        n = (rot @ f.normal)
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            w = mw @ l.vert.co
            if ax == 0:
                u, v = (w.y if n.x > 0 else -w.y), w.z
            elif ax == 1:
                u, v = (-w.x if n.y > 0 else w.x), w.z
            else:
                u, v = w.x, (w.y if n.z > 0 else -w.y)
            l[uvl].uv = (u / scale, v / scale)
    bm.to_mesh(me)
    bm.free()


def add(name, bm, material, collection='STATIC', **kw):
    return obj_from_bm(name, bm, material, collection, **kw)


def box(name, size, center, material, collection='STATIC', bevel=0.004, **kw):
    return obj_from_bm(name, bm_box(*size, c=center), material, collection, bevel=bevel, **kw)


def box_minmax(name, mn, mx, material, collection='STATIC', bevel=0.0, **kw):
    size = [mx[i] - mn[i] for i in range(3)]
    c = [(mx[i] + mn[i]) / 2 for i in range(3)]
    return box(name, size, c, material, collection, bevel=bevel, **kw)


def cyl(name, r, h, center, material, axis='Z', segs=32, collection='STATIC', bevel=0.0, r2=None, **kw):
    return obj_from_bm(name, bm_cyl(r, h, segs, center, axis, r2=r2), material, collection, bevel=bevel, **kw)


def decal(name, w, h, center, normal, material, collection='STATIC', **kw):
    return obj_from_bm(name, bm_plane(w, h, center, normal), material, collection, uv='keep', smooth_angle=None, **kw)


def parent_keep(child, parent):
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def empty(name, loc, collection='DYNAMIC', props=None):
    ob = bpy.data.objects.new(name, None)
    ob.location = loc
    ob.empty_display_size = 0.05
    coll(collection).objects.link(ob)
    if props:
        for k, v in props.items():
            ob[k] = v
    return ob


def rotate_obj(ob, axis, angle_deg, pivot):
    """Rotate object (world) about axis through pivot."""
    R = Matrix.Translation(Vector(pivot)) @ Matrix.Rotation(angle_deg * D2R, 4, axis) @ Matrix.Translation(-Vector(pivot))
    ob.matrix_world = R @ ob.matrix_world


def transform_bm(bm, rot_deg=(0, 0, 0), loc=(0, 0, 0), pivot=(0, 0, 0)):
    R = Euler([a * D2R for a in rot_deg], 'XYZ').to_matrix()
    bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(pivot), matrix=R)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return bm
