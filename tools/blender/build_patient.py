"""Patient (MakeHuman/MPFB CC0 assets) posed in lithotomy on the table, with leggings,
a cloth-simulated blanket and a modesty towel. Hidden body faces are culled."""
import bpy, bmesh, math, sys
import addon_utils
from mathutils import Vector, Matrix, Quaternion, noise
from mathutils.bvhtree import BVHTree
from lib import *

ENTRY = Vector((-0.30, 0.47, 0.935))  # introitus position (matches APP in build_equipment)
LEG_BONES = ('upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot', 'toe')
R_LAY = Matrix.Rotation(-math.pi / 2, 4, 'X')  # standing (x,y,z) -> lying (x, z, -y)


def make_human():
    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    hi = HumanService._create_default_human_info_dict()
    hi["phenotype"].update({"gender": 0.0, "age": 0.74, "muscle": 0.38, "weight": 0.64, "height": 0.5,
                            "proportions": 0.5, "cupsize": 0.5, "firmness": 0.35,
                            "race": {"asian": 0.1, "caucasian": 0.75, "african": 0.15}})
    hi["rig"] = "default"
    hi["eyes"] = "high-poly/high-poly.mhclo"
    hi["eyebrows"] = "eyebrow010/eyebrow010.mhclo"
    hi["eyelashes"] = "eyelashes02/eyelashes02.mhclo"
    hi["hair"] = "short02/short02.mhclo"
    hi["skin_mhmat"] = "middleage_caucasian_female/middleage_caucasian_female.mhmat"
    hi["skin_material_type"] = "MAKESKIN"
    hi["eyes_material_type"] = "MAKESKIN"
    s = HumanService.get_default_deserialization_settings()
    s["subdiv_levels"] = 0
    s["load_clothes"] = False
    base = HumanService.deserialize_from_dict(hi, s)
    rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    return base, rig


def aim(rig, bone, target_dir):
    bpy.context.view_layer.update()
    pb = rig.pose.bones[bone]
    M = pb.matrix.copy()
    head = M.to_translation()
    cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(Vector(target_dir).normalized())
    R = q.to_matrix() @ M.to_3x3()
    pb.matrix = Matrix.Translation(head) @ R.to_4x4()
    bpy.context.view_layer.update()


def rot_local(rig, bone, axis, deg):
    pb = rig.pose.bones[bone]
    pb.rotation_mode = 'XYZ'
    e = list(pb.rotation_euler)
    e['XYZ'.index(axis)] += deg * D2R
    pb.rotation_euler = e
    bpy.context.view_layer.update()


def L2S(v):
    """lying-frame direction -> standing-frame direction (inverse of R_LAY)."""
    x, y, z = v
    return Vector((x, -z, y)).normalized()


def pose_lithotomy(rig):
    for s, sx in (('L', 1), ('R', -1)):
        th = L2S((sx * 0.36, -0.30, 0.88))       # thighs up, slightly toward the foot end, abducted
        aim(rig, 'upperleg01.' + s, th)
        aim(rig, 'upperleg02.' + s, th)
        sh = L2S((sx * 0.16, -0.86, -0.48))      # shins toward foot end, down into the boots
        aim(rig, 'lowerleg01.' + s, sh)
        aim(rig, 'lowerleg02.' + s, sh)
        aim(rig, 'foot.' + s, L2S((sx * 0.08, -0.35, 0.93)))  # toes up
        ua = L2S((sx * 0.20, -0.97, 0.10))       # upper arms along the body
        aim(rig, 'upperarm01.' + s, ua)
        aim(rig, 'upperarm02.' + s, ua)
        fa = L2S((-sx * 0.85, 0.22, 0.40))      # forearms across the upper abdomen
        aim(rig, 'lowerarm01.' + s, fa)
        aim(rig, 'lowerarm02.' + s, fa)
    rot_local(rig, 'neck01', 'X', 6)
    rot_local(rig, 'head', 'Y', 9)
    for s in ('L', 'R'):
        rot_local(rig, 'orbicularis03.' + s, 'X', -30)   # upper lid down: eyes closed
        rot_local(rig, 'orbicularis04.' + s, 'X', 4)


def leg_weight_attribute(base):
    me = base.data
    gidx = {g.index: g.name for g in base.vertex_groups}
    att = me.attributes.new('legw', 'FLOAT', 'POINT')
    fat = me.attributes.new('footw', 'FLOAT', 'POINT')
    vals = [0.0] * len(me.vertices)
    fvals = [0.0] * len(me.vertices)
    for v in me.vertices:
        w = 0.0; fw = 0.0
        for g in v.groups:
            n = gidx.get(g.group, '')
            if n.startswith(LEG_BONES):
                w += g.weight
            if n.startswith(('foot', 'toe')):
                fw += g.weight
        vals[v.index] = w
        fvals[v.index] = fw
    att.data.foreach_set('value', vals)
    fat.data.foreach_set('value', fvals)


def bake_pose_and_lay(base, rig):
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Human')]
    # leg landmarks (armature space == world, rig at origin)
    bpy.context.view_layer.update()
    legs = {}
    for s in ('L', 'R'):
        knee = rig.matrix_world @ rig.pose.bones['lowerleg01.' + s].head
        ankle = rig.matrix_world @ rig.pose.bones['lowerleg02.' + s].tail
        toe = rig.matrix_world @ rig.pose.bones['foot.' + s].tail
        legs[s] = [knee, ankle, toe]
    leg_weight_attribute(base)
    for o in meshes:
        apply_modifiers(o)
    bpy.data.objects.remove(rig, do_unlink=True)
    mw = base.matrix_world
    pel = [mw @ v.co for v in base.data.vertices if abs((mw @ v.co).x) < 0.012 and 0.55 < (mw @ v.co).z < 0.95]
    crotch = min(pel, key=lambda c: c.z + 0.5 * abs(c.y - (-0.02)))
    T = Matrix.Translation(ENTRY - (R_LAY @ crotch) + Vector((0, 0.012, 0.0)))
    M = T @ R_LAY
    for o in meshes:
        o.data.transform(M @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    for s in legs:
        legs[s] = [M @ p for p in legs[s]]
    return meshes, legs


def make_leggings(base):
    """Duplicate leg faces, push out along normals (cloth leggings), then delete legs from body."""
    me = base.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lw = bm.verts.layers.float.get('legw')
    leg_faces = [f for f in bm.faces if sum(v[lw] for v in f.verts) / len(f.verts) > 0.5]
    # new mesh with the leg faces
    lb = bmesh.new()
    fw_src = bm.verts.layers.float.get('footw')
    fw_dst = lb.verts.layers.float.new('footw')
    vmap = {}
    for f in leg_faces:
        for v in f.verts:
            if v not in vmap:
                vmap[v] = lb.verts.new(v.co)
                vmap[v][fw_dst] = v[fw_src] if fw_src else 0.0
        try:
            lb.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            pass
    lb.normal_update()
    # smooth a few iterations to lose toes/kneecap detail, then inflate
    for _ in range(6):
        bmesh.ops.smooth_vert(lb, verts=lb.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # feet: smooth hard so the toes disappear into a loose fabric bag
    feet = [v for v in lb.verts if v[fw_dst] > 0.25]
    for _ in range(140):
        bmesh.ops.smooth_vert(lb, verts=feet, factor=0.85, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    lb.normal_update()
    for v in lb.verts:
        n = v.normal
        wr = noise.noise(v.co * 18.0) * 0.004 + noise.noise(v.co * 45.0) * 0.0015
        v.co += n * (0.018 + 0.016 * min(1.0, v[fw_dst]) + wr)
    lb.normal_update()
    # delete legs from body
    bmesh.ops.delete(bm, geom=leg_faces, context='FACES')
    bm.to_mesh(me)
    bm.free()
    leg = obj_from_bm('pt_leggings', lb, 'drape_blue', 'PATIENT', smooth_angle=80, uv='box', uv_scale=1.0)
    return leg


def fit_calf(leggings, legpts):
    """PCA fit of the legging calf segment: returns (axis, center, bottom_offset) in world."""
    knee, ankle, toe = legpts
    a = (ankle - knee)
    L = a.length
    a = a.normalized()
    pts = []
    for v in leggings.data.vertices:
        p = v.co
        t = (p - knee).dot(a) / L
        if 0.15 < t < 0.95:
            r = ((p - knee) - a * (p - knee).dot(a)).length
            if r < 0.13:
                pts.append(p.copy())
    c = sum(pts, Vector()) / len(pts)
    import numpy as np
    P = np.array([[p.x - c.x, p.y - c.y, p.z - c.z] for p in pts])
    w, V = np.linalg.eigh(P.T @ P)
    ax = Vector(V[:, 2])
    if ax.dot(a) < 0:
        ax = -ax
    return ax, c, pts


def boot_for(legpts, side, leggings):
    knee, ankle, toe = legpts
    axis, center, pts = fit_calf(leggings, legpts)
    up = Vector((0, 0, 1))
    x = axis.cross(up).normalized()
    z = x.cross(axis).normalized()
    # lowest calf point along -z, and lateral extent
    zmin = min((p - center).dot(z) for p in pts)
    tmax = max((p - center).dot(axis) for p in pts)   # toward ankle
    Rb = 0.078
    Lb = 0.46
    # trough axis sits so the inner bottom (-Rb) touches the calf bottom (+6 mm pad)
    ctr = center + z * (zmin + Rb - 0.010) + axis * (tmax - Lb / 2 + 0.06)
    bm = bmesh.new()
    segs = 14
    rings = []
    for y in (-Lb / 2, Lb / 2):
        ring = []
        for i in range(segs + 1):
            ang = math.pi + math.pi * i / segs
            ring.append(bm.verts.new((Rb * math.cos(ang), y, Rb * math.sin(ang) * 1.0)))
        rings.append(ring)
    for i in range(segs):
        bm.faces.new((rings[0][i], rings[0][i + 1], rings[1][i + 1], rings[1][i]))
    # sole plate at the heel end (+Y), tall enough to cover the sole
    hb = bmesh.new()
    shell = obj_from_bm('st_boot_%s' % side, bm, 'plastic_mid', smooth_angle=50)
    md = shell.modifiers.new('sol', 'SOLIDIFY')
    md.thickness = 0.012
    md.offset = 1.0
    apply_modifiers(shell)
    sole = obj_from_bm('st_sole_%s' % side, bm_box(2 * Rb - 0.01, 0.014, 0.17, c=(0, Lb / 2 + 0.007, 0.0)), 'plastic_mid', bevel=0.02, bevel_segs=4)
    pad = obj_from_bm('st_bootpad_%s' % side, bm_box(0.10, Lb - 0.05, 0.014, c=(0, 0, -Rb + 0.018)), 'boot_pad', bevel=0.006)
    bpy.data.objects.remove(sole, do_unlink=True)
    objs = [shell, pad]
    for yy in (-0.12, 0.08):
        arc = [Vector((Rb * 1.12 * math.cos(ang), yy, Rb * 1.12 * math.sin(ang) + 0.012)) for ang in [math.pi * i / 16 for i in range(17)]]
        sb = bm_tube_path(arc, 0.005, 8)
        bmesh.ops.scale(sb, vec=(1, 5.0, 1), verts=sb.verts, space=Matrix.Translation((0, -yy, 0)))
        objs.append(obj_from_bm('st_strap_%s' % side, sb, 'rubber_gray', smooth_angle=60))
    R = Matrix((x, axis, z)).transposed().to_4x4()
    M = Matrix.Translation(ctr) @ R
    for o in objs:
        o.matrix_world = M @ o.matrix_world
    under = ctr - z * (Rb + 0.012)
    return objs, under, M


def build_stirrups_from_legs(legs, leggings, X=-0.30, Y0=0.45):
    g = []
    for s in ('L', 'R'):
        sx = 1 if s == 'L' else -1
        objs, under, M = boot_for(legs[s], s, leggings)
        g += objs
        rx = X + sx * 0.315
        g.append(obj_from_bm('st_clamp', bm_box(0.05, 0.08, 0.07, c=(rx + sx * 0.02, Y0 + 0.14, 0.75)), 'plastic_dark', bevel=0.008, bevel_segs=3))
        g.append(obj_from_bm('st_knob', bm_cyl(0.02, 0.03, 16, (rx + sx * 0.06, Y0 + 0.14, 0.75), 'X'), 'plastic_black', bevel=0.004))
        p0 = Vector((rx + sx * 0.03, Y0 + 0.14, 0.78))
        p2 = under - Vector((0, 0, 0.03))
        p1 = Vector((p0.x + (p2.x - p0.x) * 0.3, p0.y + (p2.y - p0.y) * 0.5, p0.z + (p2.z - p0.z) * 0.85))
        pts = []
        for i in range(13):
            t = i / 12
            pts.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2)
        g.append(obj_from_bm('st_bar', bm_tube_path(pts, 0.016, 16), 'aluminum', smooth_angle=60))
        g.append(obj_from_bm('st_ball', bm_sphere(0.028, p2, 16, 8), 'plastic_dark'))
        g.append(obj_from_bm('st_mount', bm_box(0.06, 0.12, 0.03, c=under - Vector((0, 0, 0.005))), 'plastic_dark', bevel=0.008))
    return g


def cloth_sheet(name, sx, sy, center, res, material, mass=0.25):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=res[0], y_segments=res[1], size=0.5)
    bmesh.ops.scale(bm, vec=(sx, sy, 1), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    ob = obj_from_bm(name, bm, material, 'PATIENT', smooth_angle=None, uv='keep')
    for p in ob.data.polygons:
        p.use_smooth = True
    cl = ob.modifiers.new('cloth', 'CLOTH')
    st = cl.settings
    st.quality = 6
    st.mass = mass
    st.tension_stiffness = 12
    st.compression_stiffness = 12
    st.shear_stiffness = 6
    st.bending_stiffness = 2.5
    st.air_damping = 1.2
    cs = cl.collision_settings
    cs.distance_min = 0.006
    cs.use_self_collision = False
    return ob


def run_cloth(objs, frames):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    for o in objs:
        for m in o.modifiers:
            if m.type == 'CLOTH':
                m.point_cache.frame_start = 1
                m.point_cache.frame_end = frames
    for f in range(1, frames + 1):
        sc.frame_set(f)
    for o in objs:
        apply_modifiers(o)


def add_collision(o, outer=0.004):
    m = o.modifiers.new('col', 'COLLISION')
    o.collision.thickness_outer = outer
    o.collision.cloth_friction = 8
    o.collision.damping = 0.6


def cull_hidden(body, covers, dist=0.09):
    dg = bpy.context.evaluated_depsgraph_get()
    trees = []
    for c in covers:
        bm = bmesh.new()
        bm.from_object(c, dg)
        bm.transform(c.matrix_world)
        trees.append(BVHTree.FromBMesh(bm))
        bm.free()
    bm = bmesh.new()
    bm.from_mesh(body.data)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        hit = 0
        for d in (n, (n + Vector((0, 0, 0.6))).normalized(), (n + Vector((0, -0.6, 0))).normalized()):
            for t in trees:
                loc, nn, idx, dd = t.ray_cast(c + d * 0.001, d, dist)
                if loc is not None:
                    hit += 1
                    break
        if hit == 3:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(body.data)
    bm.free()
    print('culled faces', len(kill))


def build_patient_body():
    base, rig = make_human()
    pose_lithotomy(rig)
    bpy.context.view_layer.update()
    marks = {}
    for b in ('wrist.L', 'wrist.R', 'lowerarm01.L', 'lowerarm01.R', 'upperarm01.L', 'head'):
        marks[b] = R_LAY @ (rig.matrix_world @ rig.pose.bones[b].head)
    meshes, legs = bake_pose_and_lay(base, rig)
    for o in meshes:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll('PATIENT').objects.link(o)
    leggings = make_leggings(base)
    vs = [v.co for v in base.data.vertices]
    ytop = max(v.y for v in vs)
    head = [v for v in vs if v.y > ytop - 0.22]
    info = dict(head_top_y=ytop, head_center_y=sum(v.y for v in head) / len(head),
                head_zmin=min(v.z for v in head), legs=legs)
    return base, meshes, leggings, info


def make_towel(base, leggings):
    """Folded towel conformed to the pubis/perineum (modesty), via shrinkwrap."""
    bm = bmesh.new()
    nx, ny = 30, 34
    W = 0.40
    verts = []
    # path in the YZ plane: flat over the pubis then bending down in front of the perineum
    prof = []
    for j in range(ny + 1):
        t = j / ny
        if t < 0.55:
            y = 0.95 - t / 0.55 * 0.39
            z = 1.12
        else:
            u = (t - 0.55) / 0.45
            y = 0.56 - 0.07 * math.sin(u * math.pi / 2)
            z = 1.12 - 0.16 * u
        prof.append((y, z))
    grid = []
    for j, (y, z) in enumerate(prof):
        row = []
        for i in range(nx + 1):
            x = -0.30 - W / 2 + W * i / nx
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    ob = obj_from_bm('pt_towel', bm, 'fabric_white', 'PATIENT', smooth_angle=None, uv='keep')
    sw = ob.modifiers.new('sw', 'SHRINKWRAP')
    sw.target = base
    sw.wrap_method = 'NEAREST_SURFACEPOINT'
    sw.wrap_mode = 'OUTSIDE_SURFACE'
    sw.offset = 0.007
    apply_modifiers(ob)
    sm = ob.modifiers.new('sm', 'SMOOTH')
    sm.iterations = 6
    sm.factor = 0.6
    apply_modifiers(ob)
    for v in ob.data.vertices:
        v.co.z += noise.noise(v.co * 25.0) * 0.003
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def make_gauze(base):
    """Folded gauze around the applicator where it enters, conformed to the body."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=20, y_segments=18, size=0.5)
    bmesh.ops.scale(bm, vec=(0.15, 0.13, 1), verts=bm.verts)
    # stand it up facing the operator (-Y), centred on the entry point
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, vec=ENTRY + Vector((0, -0.03, 0.02)), verts=bm.verts)
    # hole for the applicator rod
    hole = [f for f in bm.faces if (Vector((f.calc_center_median().x, 0, f.calc_center_median().z)) - Vector((ENTRY.x, 0, ENTRY.z))).length < 0.011]
    bmesh.ops.delete(bm, geom=hole, context='FACES')
    ob = obj_from_bm('pt_gauze', bm, 'paper', 'PATIENT', smooth_angle=None, uv='keep')
    sw = ob.modifiers.new('sw', 'SHRINKWRAP')
    sw.target = base
    sw.wrap_method = 'NEAREST_SURFACEPOINT'
    sw.wrap_mode = 'OUTSIDE_SURFACE'
    sw.offset = 0.004
    apply_modifiers(ob)
    for v in ob.data.vertices:
        v.co += Vector((0, -1, 0)) * (0.002 + abs(noise.noise(v.co * 60.0)) * 0.003)
    for p in ob.data.polygons:
        p.use_smooth = True
    md = ob.modifiers.new('sol', 'SOLIDIFY'); md.thickness = 0.003; md.offset = -1.0
    apply_modifiers(ob)
    box_uv(ob, 0.3)
    return ob


def finish_patient(base, meshes, leggings, stirrups, table_colliders, frames=80):
    blanket = cloth_sheet('pt_blanket', 1.34, 0.78, (-0.30, 0.76, 1.40), (60, 36), 'fabric_blanket', mass=0.3)
    towel = make_towel(base, leggings)
    colliders = [base, leggings] + [o for o in stirrups if o.name.startswith(('st_boot', 'st_bootpad'))] + list(table_colliders)
    for o in colliders:
        add_collision(o)
    run_cloth([blanket], frames)
    for o in colliders:
        for m in list(o.modifiers):
            if m.type == 'COLLISION':
                o.modifiers.remove(m)
    for o in (blanket, towel):
        md = o.modifiers.new('sol', 'SOLIDIFY')
        md.thickness = 0.004
        md.offset = 1.0
        apply_modifiers(o)
        box_uv(o, 1.0)
    gauze = make_gauze(base)
    cull_hidden(base, [blanket, towel, leggings, gauze])
    rename = {'Human': 'skin', 'Human.short02': 'hair', 'Human.eyebrow010': 'eyebrows', 'Human.eyelashes02': 'eyelashes', 'Human.high-poly': 'eyes'}
    for o in meshes:
        newm = rename.get(o.name)
        if newm:
            if o.data.materials and o.data.materials[0] is not None:
                o.data.materials[0].name = 'pt_' + newm
            o.name = 'pt_' + newm
    return [blanket, towel, gauze]
