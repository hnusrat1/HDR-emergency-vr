"""Equipment & furnishings. Static items join into the baked mesh; DYN_* are interactive."""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from lib import *

DYN = 'DYNAMIC'


class Group:
    def __init__(self):
        self.objs = []

    def __call__(self, ob):
        if ob is not None:
            self.objs.append(ob)
        return ob

    def transform(self, rot_z_deg, loc):
        M = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot_z_deg * D2R, 4, 'Z')
        for o in self.objs:
            if o.parent is None:
                o.matrix_world = M @ o.matrix_world
        return self.objs


def rbox(name, size, c, m, r=0.01, segs=3, coll_='STATIC', **kw):
    return obj_from_bm(name, bm_box(*size, c=c), m, coll_, bevel=r, bevel_segs=segs, **kw)


def caster(g, x, y, z_axle=0.05, r=0.045, coll_='STATIC'):
    g(obj_from_bm('caster_w', bm_cyl(r, 0.028, 20, (x, y, r), 'X'), 'rubber_black', coll_, bevel=0.006))
    g(obj_from_bm('caster_hub', bm_cyl(r * 0.45, 0.032, 16, (x, y, r), 'X'), 'plastic_mid', coll_))
    g(rbox('caster_fork', (0.04, 0.03, 0.05), (x, y + 0.012, r + 0.03), 'steel_brushed', 0.004, 2, coll_))
    g(obj_from_bm('caster_stem', bm_cyl(0.008, 0.04, 12, (x, y + 0.015, r + 0.07)), 'steel_brushed', coll_))


def merge_dyn(name, objs, pivot, props=None):
    ob = join(objs, name)
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll(DYN).objects.link(ob)
    set_origin(ob, pivot)
    if props:
        for k, v in props.items():
            ob[k] = v
    return ob


# =================================================================== AFTERLOADER
def build_afterloader():
    g = Group()
    dyn = []
    # chassis
    g(rbox('al_base', (0.50, 0.62, 0.10), (0, 0, 0.14), 'plastic_dark', 0.02))
    for x in (-0.19, 0.19):
        for y in (-0.24, 0.24):
            caster(g, x, y)
    # body (rounded column)
    g(rbox('al_body', (0.44, 0.56, 0.62), (0, 0.0, 0.50), 'plastic_white', 0.045, 4))
    # front blue accent panel
    g(rbox('al_accent', (0.30, 0.012, 0.40), (0, -0.282, 0.48), 'plastic_blue', 0.006, 2))
    g(rbox('al_vent', (0.26, 0.006, 0.08), (0, -0.289, 0.30), 'plastic_dark', 0.003, 1))
    # head
    g(rbox('al_head', (0.48, 0.60, 0.20), (0, 0.0, 0.92), 'plastic_white', 0.05, 4))
    g(rbox('al_head_band', (0.485, 0.605, 0.025), (0, 0.0, 0.82), 'plastic_light', 0.006, 2))
    # turret (indexer) on the front, axis -Y
    tz = 0.93
    g(obj_from_bm('al_turret_base', bm_cyl(0.105, 0.04, 48, (0, -0.31, tz), 'Y'), 'plastic_light', bevel=0.006))
    g(obj_from_bm('al_turret', bm_cyl(0.085, 0.06, 48, (0, -0.35, tz), 'Y'), 'steel_satin', bevel=0.004))
    g(obj_from_bm('al_turret_face', bm_cyl(0.078, 0.004, 48, (0, -0.381, tz), 'Y'), 'plastic_dark'))
    # 24 channel ports in two rings
    for i in range(24):
        ring_r = 0.058 if i < 16 else 0.034
        n = 16 if i < 16 else 8
        k = i if i < 16 else i - 16
        a = 2 * math.pi * k / n + (0 if i < 16 else math.pi / 8)
        x, z = ring_r * math.cos(a), tz + ring_r * math.sin(a)
        g(obj_from_bm('al_port', bm_cyl(0.0065, 0.012, 12, (x, -0.386, z), 'Y'), 'steel_satin'))
        g(obj_from_bm('al_port_hole', bm_cyl(0.0032, 0.002, 10, (x, -0.3925, z), 'Y'), 'plastic_black', smooth_angle=None))
    # status LED ring (dynamic so it can glow)
    led = obj_from_bm('DYN_unit_ledring', bm_lathe([(0.093, -0.001), (0.099, -0.001), (0.099, 0.001), (0.093, 0.001)], 48, (0, -0.331, tz), 'Y'), 'led_green', DYN)
    dyn.append(led)
    # top display (screen) and housing
    g(rbox('al_disp_house', (0.24, 0.12, 0.05), (0, 0.18, 1.035), 'plastic_dark', 0.012, 3))
    disp = decal('SCREEN_unit', 0.20, 0.085, (0, 0.18, 1.0605), 'Z', 'screen', DYN)
    dyn.append(disp)
    # push handle at rear
    pts = [(-0.18, 0.30, 0.86), (-0.18, 0.36, 0.88), (-0.18, 0.38, 0.95), (0.18, 0.38, 0.95), (0.18, 0.36, 0.88), (0.18, 0.30, 0.86)]
    g(obj_from_bm('al_handle', bm_tube_path([Vector(p) for p in pts], 0.013, 16), 'chrome', smooth_angle=60))
    # emergency stop on head (top, front-right) - dynamic button
    g(obj_from_bm('al_estop_collar', bm_cyl(0.034, 0.012, 32, (0.14, -0.12, 1.025)), 'plastic_yellow', bevel=0.003))
    es = obj_from_bm('DYN_unit_estop', bm_lathe([(0.0, 0.0), (0.022, 0.0), (0.024, 0.006), (0.026, 0.016), (0.022, 0.024), (0.012, 0.028), (0.0, 0.029)], 32, (0.14, -0.12, 1.031)), 'plastic_red', DYN)
    dyn.append(es)
    # manual crank on left side of head (local -X side): recess + crank arm + handle
    cx, cy, cz = -0.242, 0.05, 0.92
    g(obj_from_bm('al_crank_well', bm_cyl(0.06, 0.006, 32, (cx - 0.001, cy, cz), 'X'), 'plastic_mid', bevel=0.002))
    crank_parts = [
        obj_from_bm('cr_hub', bm_cyl(0.022, 0.03, 24, (cx - 0.015, cy, cz), 'X'), 'steel_satin', DYN, bevel=0.003),
        obj_from_bm('cr_arm', bm_box(0.016, 0.022, 0.11, c=(cx - 0.032, cy, cz + 0.045)), 'steel_satin', DYN, bevel=0.004),
        obj_from_bm('cr_knob', bm_cyl(0.014, 0.07, 20, (cx - 0.072, cy, cz + 0.09), 'X'), 'plastic_black', DYN, bevel=0.004),
    ]
    crank = merge_dyn('DYN_unit_crank', crank_parts, (cx, cy, cz), {'interact': 'crank', 'axis': 'x'})
    dyn.append(crank)
    g(decal('al_crank_label', 0.12, 0.06, (-0.2405, -0.12, 0.93), '-X', 'sign_crank'))
    # labels
    g(decal('al_label', 0.27, 0.09, (0.2215, 0.0, 0.58), 'X', 'sign_unit_label'))
    g(decal('al_label2', 0.27, 0.09, (-0.2215, 0.0, 0.58), '-X', 'sign_unit_label'))
    g(decal('al_warn', 0.07, 0.07, (0.0, -0.2895, 0.74), '-Y', 'sign_unit_warning'))
    # power/data cable to wall
    g.objs += dyn
    return g, dyn


# =================================================================== TABLE
def build_table(X=-0.3, Y0=0.45, Y1=1.50, head_y=1.22, head_z=0.92):
    g = Group()
    L = Y1 - Y0
    cy = (Y0 + Y1) / 2
    # floor plate & column (column offset toward the head end so the foot end is clear)
    g(rbox('tb_plate', (0.62, 0.95, 0.05), (X, cy + 0.12, 0.025), 'plastic_mid', 0.02))
    g(rbox('tb_col', (0.34, 0.42, 0.60), (X, cy + 0.12, 0.35), 'plastic_light', 0.03, 3))
    g(rbox('tb_col_band', (0.345, 0.425, 0.02), (X, cy + 0.12, 0.62), 'plastic_mid', 0.005))
    # top frame
    g(rbox('tb_frame', (0.56, L, 0.06), (X, cy, 0.75), 'plastic_light', 0.012))
    g(rbox('tb_frame_end', (0.56, 0.02, 0.06), (X, Y0 + 0.01, 0.75), 'plastic_mid', 0.006))
    # removed leg section stored hanging (realistic detail): plain panel under head end
    for s in (-1, 1):
        x = X + s * 0.305
        g(rbox('tb_rail', (0.010, L - 0.1, 0.03), (x, cy, 0.75), 'steel_satin', 0.003, 2))
        for yy in (Y0 + 0.08, cy, Y1 - 0.08):
            g(rbox('tb_rail_post', (0.03, 0.03, 0.02), (X + s * 0.29, yy, 0.75), 'steel_satin', 0.003, 1))
    g(rbox('tb_mattress', (0.56, L, 0.075), (X, cy, 0.8175), 'mattress', 0.025, 4))
    # pillow shaped to the head (dent where the head rests)
    top = head_z + 0.004
    th = max(0.05, top - 0.855 + 0.03)
    bmp = bm_box(0.44, 0.32, th, c=(X, head_y - 0.02, 0.855 + th / 2))
    pil = obj_from_bm('tb_pillow', bmp, 'pillow', bevel=min(0.04, th * 0.45), bevel_segs=5)
    me = pil.data
    for v in me.vertices:
        d = ((v.co.x - X) / 0.17) ** 2 + ((v.co.y - head_y) / 0.13) ** 2
        if v.co.z > 0.855 + th * 0.6:
            v.co.z -= 0.03 * max(0.0, 1 - d)
    g(pil)
    g(rbox('tb_pad', (0.5, 0.36, 0.012), (X, Y0 + 0.16, 0.861), 'fabric_white', 0.004))
    return g


def build_stirrups(X=-0.3, Y0=0.45):
    """Boot stirrups clamped to side rails near the foot end."""
    g = Group()
    for s in (-1, 1):
        rx = X + s * 0.315
        # rail clamp
        g(rbox('st_clamp', (0.05, 0.08, 0.07), (rx + s * 0.02, Y0 + 0.12, 0.75), 'plastic_dark', 0.008))
        g(obj_from_bm('st_knob', bm_cyl(0.02, 0.03, 16, (rx + s * 0.06, Y0 + 0.12, 0.75), 'X'), 'plastic_black', bevel=0.004))
        # post up and arm toward boot
        boot_c = Vector((X + s * 0.30, Y0 - 0.30, 1.04))
        p0 = Vector((rx + s * 0.03, Y0 + 0.12, 0.78))
        p1 = Vector((rx + s * 0.05, Y0 + 0.04, 0.92))
        p2 = boot_c + Vector((s * 0.03, 0.06, -0.10))
        g(obj_from_bm('st_bar', bm_tube_path([p0, p0.lerp(p1, 0.5), p1, p1.lerp(p2, 0.5), p2], 0.016, 16), 'aluminum', smooth_angle=60))
        g(obj_from_bm('st_ball', bm_sphere(0.026, p2, 16, 8), 'plastic_dark'))
        # boot: padded shell, open on top/inner side; tilt along calf
        bm = bm_box(0.15, 0.46, 0.13, c=(0, 0, 0))
        bt = obj_from_bm('st_boot', bm, 'plastic_mid', bevel=0.05, bevel_segs=4, uv='box', uv_scale=0.5)
        # hollow look: inner pad block
        pad = obj_from_bm('st_bootpad', bm_box(0.12, 0.42, 0.05, c=(0, 0.0, 0.05)), 'boot_pad', bevel=0.02, bevel_segs=3)
        strap1 = obj_from_bm('st_strap', bm_box(0.16, 0.05, 0.135, c=(0, -0.08, 0.01)), 'rubber_gray', bevel=0.01)
        strap2 = obj_from_bm('st_strap', bm_box(0.16, 0.05, 0.135, c=(0, 0.12, 0.01)), 'rubber_gray', bevel=0.01)
        for o in (bt, pad, strap1, strap2):
            o.matrix_world = Matrix.Translation(boot_c) @ Matrix.Rotation(-28 * D2R * 1, 4, 'X') @ Matrix.Rotation(s * 8 * D2R, 4, 'Z') @ o.matrix_world
            g(o)
    return g


# =================================================================== APPLICATOR (vaginal cylinder)
APP = dict(X=-0.30, Y_entry=0.47, Z=0.935, tilt=14.0)


def build_applicator():
    """Returns dynamic applicator object (origin at connector end), clamp stand (static) and knob (dyn).
    Local axis: applicator points +Y (into patient), tilted up by `tilt` deg toward +Z."""
    X, Ye, Z, tilt = APP['X'], APP['Y_entry'], APP['Z'], APP['tilt']
    parts = []
    # build along +Y from origin at the connector (y=0), then transform
    r_cyl = 0.015
    L_cyl = 0.10
    L_rod = 0.17
    y_flange = L_rod
    prof = [(0.0, 0.0)]
    # dome tip at far end
    parts.append(obj_from_bm('ap_cyl', bm_lathe([(0, y_flange + 0.004), (r_cyl, y_flange + 0.004), (r_cyl, y_flange + L_cyl - r_cyl)] +
                                                 [(r_cyl * math.cos(a), y_flange + L_cyl - r_cyl + r_cyl * math.sin(a)) for a in [i * math.pi / 2 / 8 for i in range(1, 9)]],
                                                 40, (0, 0, 0), 'Y'), 'plastic_white', DYN, smooth_angle=60))
    parts.append(obj_from_bm('ap_flange', bm_cyl(0.019, 0.006, 40, (0, y_flange, 0), 'Y'), 'plastic_light', DYN, bevel=0.0015))
    parts.append(obj_from_bm('ap_rod', bm_cyl(0.0045, L_rod, 20, (0, L_rod / 2, 0), 'Y'), 'plastic_light', DYN))
    # depth marks on rod
    for i in range(6):
        parts.append(obj_from_bm('ap_mark', bm_cyl(0.0047, 0.0012, 20, (0, 0.06 + i * 0.015, 0), 'Y'), 'plastic_dark', DYN, smooth_angle=None))
    # connector (metal) at origin end
    parts.append(obj_from_bm('ap_conn', bm_cyl(0.0075, 0.03, 24, (0, 0.015, 0), 'Y'), 'steel_satin', DYN, bevel=0.0015))
    parts.append(obj_from_bm('ap_conn_ring', bm_cyl(0.009, 0.008, 24, (0, 0.024, 0), 'Y'), 'plastic_blue', DYN, bevel=0.0015))
    app = join(parts, 'DYN_applicator')
    for c in list(app.users_collection):
        c.objects.unlink(app)
    coll(DYN).objects.link(app)
    # place: origin at connector; rod axis tilted
    y_conn = Ye - (L_rod)  # rod exits body at Ye
    M = Matrix.Translation((X, y_conn, Z - math.sin(tilt * D2R) * L_rod)) @ Matrix.Rotation(tilt * D2R, 4, 'X')
    app.matrix_world = M
    app['interact'] = 'applicator'
    # dwell positions (source travels in the central channel), in applicator local coords
    app['dwell_local_y'] = [y_flange + 0.02 + i * 0.01 for i in range(7)]

    # ---- clamp stand: bracket off table foot end + vertical post + clamp jaw around rod
    g = Group()
    rod_pt = M @ Vector((0, 0.07, 0))  # clamp location along rod
    base = Vector((X - 0.20, Ye - 0.02, 0.72))
    g(rbox('cl_bracket', (0.06, 0.04, 0.05), base + Vector((0, 0.02, 0)), 'steel_satin', 0.005))
    p0 = base + Vector((0, -0.01, -0.02))
    p1 = Vector((X - 0.20, rod_pt.y, 0.76))
    g(obj_from_bm('cl_arm', bm_tube_path([p0, p0.lerp(p1, 0.5), p1], 0.009, 14), 'steel_satin', smooth_angle=60))
    p2 = Vector((X - 0.20, rod_pt.y, rod_pt.z))
    g(obj_from_bm('cl_post', bm_tube_path([p1, p2], 0.009, 14), 'steel_satin'))
    g(obj_from_bm('cl_hbar', bm_tube_path([p2, Vector((X - 0.02, rod_pt.y, rod_pt.z))], 0.008, 14), 'steel_satin'))
    g(rbox('cl_jaw', (0.03, 0.03, 0.03), (X - 0.003, rod_pt.y, rod_pt.z), 'aluminum', 0.004))
    knob = obj_from_bm('DYN_clamp_knob', bm_lathe([(0, 0), (0.016, 0), (0.018, 0.01), (0.016, 0.022), (0, 0.024)], 24, (0, 0, 0), 'X'), 'plastic_black', DYN)
    knob.location = (X - 0.003 + 0.016, rod_pt.y, rod_pt.z)
    knob['interact'] = 'knob'
    return app, g, knob


# =================================================================== EMERGENCY CONTAINER + TRAY
def build_container(cx=-1.12, cy=-0.02):
    g = Group()
    dyn = []
    # cart
    g(rbox('ec_cart_top', (0.36, 0.36, 0.03), (cx, cy, 0.48), 'steel_brushed', 0.008))
    g(rbox('ec_cart_shelf', (0.34, 0.34, 0.02), (cx, cy, 0.16), 'steel_brushed', 0.006))
    for x in (-0.16, 0.16):
        for y in (-0.16, 0.16):
            g(obj_from_bm('ec_leg', bm_cyl(0.011, 0.40, 12, (cx + x, cy + y, 0.29)), 'steel_brushed'))
            caster(g, cx + x, cy + y, r=0.035)
    # pot (lathed, thick walls), mouth at top
    prof = [(0.0, 0.495), (0.135, 0.495), (0.140, 0.505), (0.140, 0.80), (0.130, 0.81), (0.070, 0.81), (0.066, 0.80), (0.066, 0.52), (0.0, 0.52)]
    g(obj_from_bm('ec_pot', bm_lathe(prof, 48, (cx, cy, 0)), 'steel_satin', smooth_angle=40))
    g(obj_from_bm('ec_pot_inner', bm_cyl(0.064, 0.004, 32, (cx, cy, 0.523)), 'lead_gray'))
    # side handles
    for s in (-1, 1):
        pts = [Vector((cx + s * 0.14, cy - 0.05, 0.74)), Vector((cx + s * 0.175, cy - 0.05, 0.74)), Vector((cx + s * 0.175, cy + 0.05, 0.74)), Vector((cx + s * 0.14, cy + 0.05, 0.74))]
        g(obj_from_bm('ec_handle', bm_tube_path(pts, 0.007, 12), 'steel_satin', smooth_angle=60))
    g(decal('ec_label', 0.20, 0.12, (cx, cy - 0.1425, 0.67), '-Y', 'sign_container'))
    # lid (dynamic): plug + cap + knob; origin at center of lid bottom
    lid_parts = [
        obj_from_bm('lid_plug', bm_cyl(0.062, 0.05, 32, (cx, cy, 0.835 - 0.03)), 'lead_gray', DYN),
        obj_from_bm('lid_cap', bm_lathe([(0, 0.81), (0.125, 0.81), (0.128, 0.82), (0.11, 0.845), (0.03, 0.855), (0, 0.856)], 48, (cx, cy, 0)), 'steel_satin', DYN, smooth_angle=45),
        obj_from_bm('lid_knob', bm_lathe([(0, 0.85), (0.012, 0.85), (0.012, 0.88), (0.03, 0.885), (0.03, 0.905), (0, 0.908)], 24, (cx, cy, 0)), 'plastic_black', DYN, smooth_angle=45),
    ]
    lid = merge_dyn('DYN_container_lid', lid_parts, (cx, cy, 0.81), {'interact': 'grab', 'snap': 'container'})
    dyn.append(lid)
    return g, dyn


def build_tray(cx=-1.0, cy=-0.72):
    g = Group()
    dyn = []
    # mayo stand: U base + post + tray
    g(rbox('my_base', (0.06, 0.52, 0.03), (cx - 0.2, cy, 0.04), 'steel_brushed', 0.006))
    for y in (-0.24, 0.24):
        g(rbox('my_foot', (0.48, 0.05, 0.03), (cx + 0.02, cy + y, 0.04), 'steel_brushed', 0.006))
        caster(g, cx + 0.22, cy + y, r=0.03)
        caster(g, cx - 0.2, cy + y, r=0.03)
    g(obj_from_bm('my_post', bm_cyl(0.016, 0.86, 16, (cx - 0.2, cy, 0.48)), 'steel_brushed'))
    g(rbox('my_arm', (0.24, 0.03, 0.03), (cx - 0.09, cy, 0.9), 'steel_brushed', 0.005))
    tray_prof = [(0, 0.92), (0.0, 0.92)]
    g(rbox('my_tray', (0.36, 0.50, 0.012), (cx + 0.03, cy, 0.925), 'steel_satin', 0.004))
    for (sx, sy, x, y) in [(0.36, 0.008, 0, -0.246), (0.36, 0.008, 0, 0.246), (0.008, 0.5, -0.176, 0), (0.008, 0.5, 0.176, 0)]:
        g(rbox('my_lip', (sx, sy, 0.025), (cx + 0.03 + x, cy + y, 0.94), 'steel_satin', 0.002, 1))
    # blue towel
    g(rbox('my_towel', (0.30, 0.42, 0.006), (cx + 0.03, cy, 0.934), 'drape_blue', 0.002, 1))
    # long forceps (dynamic): two blades + ring handles, ~30 cm, lying along Y
    fz = 0.942
    fx = cx + 0.05
    fparts = []
    for s in (-1, 1):
        pts = [Vector((fx + s * 0.006, cy - 0.14, fz)), Vector((fx + s * 0.004, cy + 0.05, fz)), Vector((fx + s * 0.0015, cy + 0.17, fz))]
        fparts.append(obj_from_bm('fc_blade', bm_tube_path(pts, 0.0028, 8), 'steel_satin', DYN, smooth_angle=60))
        ring = bm_lathe([(0.011, -0.002), (0.016, -0.002), (0.016, 0.002), (0.011, 0.002)], 20, (fx + s * 0.018, cy - 0.155, fz))
        fparts.append(obj_from_bm('fc_ring', ring, 'steel_satin', DYN))
    fparts.append(obj_from_bm('fc_pivot', bm_cyl(0.005, 0.008, 12, (fx, cy + 0.0, fz)), 'steel_satin', DYN))
    forceps = merge_dyn('DYN_forceps', fparts, (fx, cy - 0.10, fz), {'interact': 'grab', 'tool': 'forceps'})
    dyn.append(forceps)
    # wire cutters
    cparts = [
        obj_from_bm('ct_jaw', bm_box(0.018, 0.05, 0.01, c=(cx - 0.06, cy + 0.10, 0.944)), 'steel_satin', DYN, bevel=0.003),
        obj_from_bm('ct_h1', bm_tube_path([Vector((cx - 0.066, cy + 0.075, 0.944)), Vector((cx - 0.075, cy - 0.06, 0.944))], 0.006, 10), 'plastic_red', DYN),
        obj_from_bm('ct_h2', bm_tube_path([Vector((cx - 0.054, cy + 0.075, 0.944)), Vector((cx - 0.045, cy - 0.06, 0.944))], 0.006, 10), 'plastic_red', DYN),
    ]
    cutters = merge_dyn('DYN_cutters', cparts, (cx - 0.06, cy + 0.03, 0.944), {'interact': 'grab', 'tool': 'cutters'})
    dyn.append(cutters)
    # gauze packs
    for i in range(3):
        g(rbox('gauze', (0.07, 0.09, 0.01), (cx + 0.12, cy - 0.15 + i * 0.1, 0.937), 'paper', 0.003))
    return g, dyn


# =================================================================== SURVEY METER (dynamic) + cradle
def build_survey_meter(pos=(-1.15, -3.97, 1.18)):
    """Meter modeled pointing +Y (detector at front), handle on top. pos = cradle location (meter faces -Y wall side)."""
    parts = []
    x, y, z = 0, 0, 0
    parts.append(obj_from_bm('sm_body', bm_box(0.085, 0.20, 0.075, c=(0, 0.0, 0.0)), 'plastic_yellow', DYN, bevel=0.018, bevel_segs=4))
    parts.append(obj_from_bm('sm_band', bm_box(0.087, 0.05, 0.077, c=(0, -0.06, 0.0)), 'plastic_dark', DYN, bevel=0.016, bevel_segs=3))
    # detector window at front
    parts.append(obj_from_bm('sm_det', bm_cyl(0.026, 0.02, 24, (0, 0.105, 0.0), 'Y'), 'plastic_dark', DYN, bevel=0.004))
    parts.append(obj_from_bm('sm_det_grill', bm_cyl(0.019, 0.003, 24, (0, 0.116, 0.0), 'Y'), 'steel_satin', DYN))
    # handle
    pts = [Vector((0, -0.07, 0.035)), Vector((0, -0.065, 0.08)), Vector((0, 0.05, 0.08)), Vector((0, 0.06, 0.035))]
    parts.append(obj_from_bm('sm_handle', bm_tube_path(pts, 0.013, 16), 'plastic_dark', DYN, smooth_angle=70))
    # display bezel (rear top, angled)
    parts.append(obj_from_bm('sm_bezel', bm_box(0.07, 0.006, 0.05, c=(0, -0.1015, 0.004)), 'plastic_black', DYN, bevel=0.003))
    parts.append(obj_from_bm('sm_btn', bm_cyl(0.007, 0.006, 16, (0.026, -0.1035, -0.03), 'Y'), 'plastic_red', DYN))
    parts.append(obj_from_bm('sm_btn2', bm_cyl(0.007, 0.006, 16, (-0.026, -0.1035, -0.03), 'Y'), 'plastic_mid', DYN))
    meter = join(parts, 'DYN_survey_meter')
    for c in list(meter.users_collection):
        c.objects.unlink(meter)
    coll(DYN).objects.link(meter)
    set_origin(meter, (0, -0.005, 0.08))  # grip point on handle
    scr = decal('SCREEN_meter', 0.058, 0.038, (0, -0.105, 0.006), '-Y', 'screen', DYN)
    parent_keep(scr, meter)
    meter['interact'] = 'grab'
    meter['tool'] = 'meter'
    # cradle on control-area wall: shelf; meter sits handle-up, display (rear) facing the room (-Y)
    g = Group()
    cx, cy, cz = pos
    shelf_z = cz - 0.12
    g(rbox('sm_cradle_back', (0.16, 0.02, 0.20), (cx, -3.91, shelf_z + 0.09), 'plastic_dark', 0.008))
    g(rbox('sm_cradle_shelf', (0.14, 0.26, 0.02), (cx, -4.03, shelf_z - 0.01), 'plastic_dark', 0.006))
    g(rbox('sm_cradle_lip', (0.14, 0.015, 0.035), (cx, -4.155, shelf_z + 0.005), 'plastic_dark', 0.004))
    g(decal('sm_label', 0.14, 0.056, (cx, -3.901, shelf_z + 0.26), '-Y', 'sign_meter_label'))
    meter.matrix_world = Matrix.Translation((cx, -4.045, shelf_z + 0.0375 + 0.08))
    return meter, g


# =================================================================== CONSOLE AREA
def build_console():
    g = Group()
    dyn = []
    # desk along vault outer wall
    x0, x1 = -0.75, 2.95
    yb, yf = -3.9, -4.65
    g(rbox('desk_top', (x1 - x0, yb - yf, 0.03), ((x0 + x1) / 2, (yb + yf) / 2, 0.735), 'laminate_gray', 0.004))
    g(rbox('desk_edge', (x1 - x0, 0.006, 0.032), ((x0 + x1) / 2, yf - 0.002, 0.735), 'desk_edge', 0.002))
    for xx in (x0 + 0.02, 1.2, x1 - 0.02):
        g(rbox('desk_panel', (0.025, 0.70, 0.72), (xx, -4.27, 0.36), 'laminate_gray', 0.003))
    g(rbox('desk_modesty', (x1 - x0, 0.02, 0.45), ((x0 + x1) / 2, -3.93, 0.45), 'laminate_gray', 0.003))
    # monitors (24")
    for i, (mx, ang) in enumerate([(0.30, 8), (0.92, -8)]):
        mg = Group()
        mg(rbox('mon_foot', (0.22, 0.17, 0.012), (0, 0.03, 0.756), 'plastic_dark', 0.006))
        mg(rbox('mon_neck', (0.05, 0.03, 0.30), (0, 0.06, 0.90), 'plastic_dark', 0.008))
        mg(rbox('mon_body', (0.56, 0.035, 0.34), (0, 0.035, 1.07), 'plastic_black', 0.006))
        scr = decal('SCREEN_console_%s' % ('main' if i == 0 else 'aux'), 0.53, 0.30, (0, 0.0165, 1.075), '-Y', 'screen', DYN)
        mg(scr)
        mg.transform(ang, (mx, -4.08, 0))
        g.objs += [o for o in mg.objs if not o.name.startswith('SCREEN')]
        dyn.append(scr)
    # keyboard + mouse
    g(rbox('kbd', (0.44, 0.14, 0.02), (0.6, -4.42, 0.76), 'plastic_dark', 0.005))
    g(rbox('kbd_keys', (0.42, 0.12, 0.006), (0.6, -4.42, 0.772), 'plastic_black', 0.002))
    g(rbox('mouse', (0.06, 0.10, 0.03), (0.95, -4.45, 0.762), 'plastic_dark', 0.014, 3))
    # treatment control panel (angled box) with dynamic buttons
    px, py = 1.62, -4.33
    pan = Group()
    pan(rbox('cp_box', (0.46, 0.24, 0.06), (0, 0, 0.03), 'plastic_dark', 0.01))
    face = decal('cp_face', 0.44, 0.22, (0, 0, 0.0605), 'Z', 'sign_panel_console')
    pan(face)
    btns = {}
    # key switch, start, interrupt, estop; positions on face (x from -0.22..0.22, y)
    def bpos(u, v):
        return (-0.22 + u * 0.44, -0.11 + (1 - v) * 0.22)
    for key, (u, v), kind in [('key', (0.11, 0.45), 'key'), ('start', (0.30, 0.45), 'btn'), ('interrupt', (0.50, 0.45), 'btn'), ('estop', (0.78, 0.45), 'estop')]:
        bx, by = bpos(u, v)
        if kind == 'btn':
            col = 'plastic_green' if key == 'start' else 'plastic_yellow'
            pan(obj_from_bm('cp_bezel', bm_cyl(0.026, 0.006, 32, (bx, by, 0.063)), 'chrome'))
            b = obj_from_bm('DYN_console_' + key, bm_lathe([(0, 0), (0.02, 0), (0.02, 0.008), (0.018, 0.012), (0, 0.012)], 32, (bx, by, 0.064)), col, DYN)
        elif kind == 'estop':
            pan(obj_from_bm('cp_ecollar', bm_cyl(0.042, 0.01, 32, (bx, by, 0.065)), 'plastic_yellow', bevel=0.003))
            b = obj_from_bm('DYN_console_estop', bm_lathe([(0.0, 0.0), (0.028, 0.0), (0.03, 0.008), (0.033, 0.02), (0.028, 0.03), (0.015, 0.035), (0.0, 0.036)], 32, (bx, by, 0.07)), 'plastic_red', DYN)
        else:
            pan(obj_from_bm('cp_keycyl', bm_cyl(0.022, 0.012, 32, (bx, by, 0.066)), 'chrome', bevel=0.002))
            b = obj_from_bm('DYN_console_key', bm_box(0.012, 0.034, 0.03, c=(bx, by, 0.085)), 'steel_satin', DYN, bevel=0.003)
        btns[key] = b
    # status LEDs
    leds = []
    for key, (u, v) in [('led_door', (0.68, 0.17)), ('led_source', (0.83, 0.17)), ('led_ready', (0.30, 0.17))]:
        bx, by = bpos(u, v)
        l = obj_from_bm('DYN_console_' + key, bm_cyl(0.011, 0.008, 20, (bx, by, 0.064)), 'led_red', DYN)
        leds.append(l)
    allp = pan.objs + list(btns.values()) + leds
    M = Matrix.Translation((px, py, 0.75)) @ Matrix.Rotation(18 * D2R, 4, 'X')
    for o in allp:
        o.matrix_world = M @ o.matrix_world
    g.objs += pan.objs
    for b in list(btns.values()) + leds:
        set_origin(b, sum((b.matrix_world @ v.co for v in b.data.vertices), Vector()) / len(b.data.vertices))
        b['interact'] = 'button'
        dyn.append(b)
    # intercom with gooseneck mic
    g(rbox('ic_base', (0.14, 0.12, 0.04), (2.12, -4.25, 0.77), 'plastic_dark', 0.01))
    g(obj_from_bm('ic_neck', bm_tube_path([Vector((2.12, -4.22, 0.79)), Vector((2.12, -4.24, 0.9)), Vector((2.09, -4.32, 0.97))], 0.005, 10), 'plastic_black', smooth_angle=60))
    g(obj_from_bm('ic_mic', bm_sphere(0.012, (2.09, -4.33, 0.975), 12, 6), 'plastic_black'))
    talk = obj_from_bm('DYN_intercom_talk', bm_box(0.05, 0.03, 0.012, c=(2.12, -4.29, 0.795)), 'plastic_blue', DYN, bevel=0.003)
    talk['interact'] = 'button'
    dyn.append(talk)
    # desk phone: base + handset (dynamic)
    g(rbox('ph_base', (0.20, 0.22, 0.05), (2.45, -4.25, 0.775), 'plastic_dark', 0.015, 3))
    g(rbox('ph_keys', (0.09, 0.10, 0.004), (2.47, -4.29, 0.80), 'plastic_mid', 0.002))
    hs = [obj_from_bm('hs_body', bm_box(0.05, 0.21, 0.035, c=(2.39, -4.24, 0.817)), 'plastic_dark', DYN, bevel=0.014, bevel_segs=3)]
    handset = merge_dyn('DYN_phone', hs, (2.39, -4.24, 0.817), {'interact': 'grab', 'tool': 'phone'})
    dyn.append(handset)
    g(decal('ph_list', 0.15, 0.20, (2.95, -3.901, 1.10), '-Y', 'sign_phone_list'))
    # binder / chart
    g(rbox('chart', (0.24, 0.31, 0.03), (-0.35, -4.3, 0.765), 'plastic_blue', 0.004))
    g(rbox('chart_pages', (0.225, 0.30, 0.024), (-0.343, -4.3, 0.765), 'paper', 0.002))
    # chair
    cx, cy = 0.85, -5.05
    g(obj_from_bm('ch_base', bm_cyl(0.30, 0.03, 5, (cx, cy, 0.07)), 'plastic_black', bevel=0.01))
    for i in range(5):
        a = i * 2 * math.pi / 5
        g(obj_from_bm('ch_wheel', bm_cyl(0.025, 0.02, 12, (cx + 0.29 * math.cos(a), cy + 0.29 * math.sin(a), 0.025), 'X'), 'plastic_black'))
    g(obj_from_bm('ch_gas', bm_cyl(0.025, 0.36, 16, (cx, cy, 0.26)), 'chrome'))
    g(rbox('ch_seat', (0.50, 0.48, 0.08), (cx, cy, 0.48), 'fabric_chair', 0.03, 3))
    g(rbox('ch_back', (0.46, 0.07, 0.52), (cx, cy - 0.27, 0.86), 'fabric_chair', 0.03, 3))
    g(rbox('ch_spine', (0.06, 0.03, 0.3), (cx, cy - 0.29, 0.6), 'plastic_black', 0.01))
    # CCTV monitor (wall) + area monitor remote display + RAD ON sign + clock + poster
    g(rbox('cctv_body', (0.74, 0.04, 0.44), (1.60, -3.925, 1.64), 'plastic_black', 0.006))
    scr = decal('SCREEN_cctv', 0.71, 0.40, (1.60, -3.9455, 1.64), '-Y', 'screen', DYN)
    dyn.append(scr)
    g(rbox('arm_box', (0.24, 0.05, 0.16), (-0.98, -3.925, 1.62), 'plastic_light', 0.01))
    scr = decal('SCREEN_arm_remote', 0.17, 0.08, (-0.98, -3.9505, 1.625), '-Y', 'screen', DYN)
    dyn.append(scr)
    g(decal('arm_lbl', 0.20, 0.053, (-0.98, -3.901, 1.76), '-Y', 'sign_area_monitor'))
    bcn = obj_from_bm('DYN_beacon_control', bm_lathe([(0, 0), (0.03, 0), (0.03, 0.03), (0.022, 0.05), (0, 0.055)], 24, (-0.98, -3.95, 1.70)), 'beacon_red', DYN)
    dyn.append(bcn)
    g(rbox('radon_box', (0.48, 0.07, 0.14), (-2.1, -3.935, 2.40), 'plastic_dark', 0.01))
    sign = decal('DYN_radon_sign', 0.44, 0.115, (-2.1, -3.9705, 2.40), '-Y', 'sign_lit', DYN)
    dyn.append(sign)
    g(decal('poster_console', 0.42, 0.656, (2.48, -3.901, 1.48), '-Y', 'sign_procedure_console'))
    g(decal('room_sign', 0.30, 0.0975, (-3.2, -3.901, 1.58), '-Y', 'sign_room'))
    g(decal('noentry', 0.30, 0.1125, (-0.95, -3.901, 2.05), '-Y', 'sign_no_entry'))
    # wall clock (control)
    g(obj_from_bm('clk_rim', bm_lathe([(0.0, 0.0), (0.16, 0.0), (0.165, 0.02), (0.155, 0.04), (0.0, 0.04)], 48, (0.62, -3.94, 2.25), 'Y'), 'plastic_black'))
    g(obj_from_bm('clk_face', bm_plane(0.30, 0.30, (0.62, -3.941, 2.25), '-Y'), 'clock_face', uv='keep', smooth_angle=None))
    for nm, L, w in [('DYN_clock_c_h', 0.08, 0.008), ('DYN_clock_c_m', 0.12, 0.006), ('DYN_clock_c_s', 0.13, 0.002)]:
        h = obj_from_bm(nm, bm_box(w, 0.002, L, c=(0.62, -3.944 - (0.002 if 's' in nm[-1] else 0.0), 2.25 + L / 2 - 0.015)), 'plastic_black' if 's' not in nm[-1] else 'plastic_red', DYN, smooth_angle=None)
        set_origin(h, (0.62, -3.944, 2.25))
        h['clock'] = nm[-1]
        dyn.append(h)
    # big wall display on west wall (menus/debrief)
    g(rbox('tv_body', (0.05, 1.26, 0.74), (-3.47, -5.25, 1.62), 'plastic_black', 0.008))
    scr = decal('SCREEN_wall', 1.22, 0.69, (-3.4445, -5.25, 1.62), 'X', 'screen', DYN)
    dyn.append(scr)
    # whiteboard (east wall)
    g(rbox('wb_frame', (0.02, 1.22, 0.82), (3.49, -5.2, 1.45), 'aluminum', 0.004))
    g(decal('wb', 1.18, 0.786, (3.479, -5.2, 1.45), '-X', 'sign_whiteboard'))
    g(rbox('wb_tray', (0.06, 0.6, 0.02), (3.46, -5.2, 1.03), 'aluminum', 0.004))
    # trash can + sanitizer
    g(obj_from_bm('trash', bm_lathe([(0, 0), (0.15, 0), (0.17, 0.42), (0.165, 0.43), (0, 0.43)], 32, (2.95, -6.35, 0)), 'plastic_mid'))
    g(rbox('sanit', (0.10, 0.06, 0.20), (-1.6, -6.57, 1.25), 'plastic_white', 0.01))
    g(decal('fire', 0.15, 0.2, (-0.2, -6.599, 1.95), 'Y', 'sign_fire'))
    g(decal('exit', 0.3, 0.12, (2.3, -6.599, 2.42), 'Y', 'sign_exit'))
    # extinguisher
    g(obj_from_bm('ext', bm_lathe([(0, 0), (0.075, 0), (0.08, 0.05), (0.08, 0.45), (0.05, 0.52), (0.02, 0.55), (0, 0.55)], 24, (-0.2, -6.5, 0.85)), 'plastic_red'))
    return g, dyn


# =================================================================== VAULT FURNISHINGS
def build_vault_furnishings():
    g = Group()
    dyn = []
    # --- west wall casework: base cabinets + counter + upper glass cabinets
    y0, y1 = -0.9, 2.7
    n = 6
    w = (y1 - y0) / n
    g(rbox('cab_kick', (0.52, y1 - y0, 0.1), (-2.72, (y0 + y1) / 2, 0.05), 'floor_cove', 0.002))
    for i in range(n):
        yc = y0 + w * (i + 0.5)
        g(rbox('cab_base', (0.56, w - 0.006, 0.78), (-2.72, yc, 0.49), 'laminate_white', 0.003))
        g(rbox('cab_drawer_gap', (0.005, w - 0.03, 0.004), (-2.437, yc, 0.73), 'plastic_dark', 0.0))
        g(rbox('cab_pull', (0.02, 0.12, 0.012), (-2.425, yc, 0.76), 'steel_satin', 0.004))
        g(rbox('cab_pull2', (0.02, 0.012, 0.12), (-2.425, yc + (w / 2 - 0.06) * (1 if i % 2 else -1), 0.55), 'steel_satin', 0.004))
        # uppers
        g(rbox('cab_up', (0.34, w - 0.006, 0.76), (-2.83, yc, 1.84), 'laminate_white', 0.003))
        g(rbox('cab_up_glass', (0.006, w - 0.08, 0.66), (-2.657, yc, 1.84), 'glass', 0.0))
        # supplies visible behind glass
        for k in range(3):
            g(rbox('supply', (0.2, w * 0.25, 0.12), (-2.85, yc - w * 0.25 + k * w * 0.25, 1.56 + (k % 2) * 0.33), ['cardboard', 'paper', 'plastic_white'][k], 0.004))
        g(rbox('cab_shelf', (0.3, w - 0.03, 0.012), (-2.83, yc, 1.84), 'laminate_white', 0.002))
    g(rbox('counter', (0.62, y1 - y0 + 0.02, 0.035), (-2.69, (y0 + y1) / 2, 0.9), 'solid_surface', 0.004))
    g(rbox('backsplash', (0.015, y1 - y0, 0.10), (-2.993, (y0 + y1) / 2, 0.966), 'solid_surface', 0.003))
    # items on counter
    g(rbox('glove_box1', (0.12, 0.24, 0.08), (-2.5, 0.2, 0.958), 'plastic_blue', 0.004))
    g(rbox('glove_box2', (0.12, 0.24, 0.08), (-2.5, 0.48, 0.958), 'plastic_white', 0.004))
    g(rbox('kit_box', (0.30, 0.40, 0.10), (-2.62, 1.6, 0.968), 'plastic_orange', 0.01))
    # --- east wall: sink counter
    g(rbox('sk_base', (0.56, 1.5, 0.78), (2.72, 2.45, 0.49), 'laminate_white', 0.003))
    g(rbox('sk_counter', (0.62, 1.52, 0.035), (2.69, 2.45, 0.9), 'solid_surface', 0.004))
    g(obj_from_bm('sk_basin', bm_lathe([(0.0, 0.76), (0.15, 0.78), (0.20, 0.90), (0.205, 0.918)], 32, (2.68, 2.45, 0)), 'steel_satin'))
    g(obj_from_bm('sk_drain', bm_cyl(0.025, 0.003, 16, (2.68, 2.45, 0.763)), 'chrome'))
    g(obj_from_bm('faucet', bm_tube_path([Vector((2.93, 2.45, 0.92)), Vector((2.93, 2.45, 1.18)), Vector((2.88, 2.45, 1.24)), Vector((2.78, 2.45, 1.20)), Vector((2.76, 2.45, 1.12))], 0.012, 16), 'chrome', smooth_angle=60))
    g(rbox('towel_disp', (0.12, 0.30, 0.36), (2.94, 3.0, 1.45), 'plastic_white', 0.015))
    g(rbox('soap', (0.08, 0.1, 0.18), (2.96, 2.1, 1.25), 'plastic_white', 0.01))
    g(decal('hh', 0.25, 0.35, (2.999, 1.75, 1.45), '-X', 'sign_handhygiene'))
    for i, c in enumerate(['plastic_blue', 'plastic_teal', 'plastic_white']):
        g(rbox('glovebox_wall', (0.09, 0.25, 0.13), (2.955, 3.25, 1.2 + i * 0.15), c, 0.004))
    g(obj_from_bm('bin_bio', bm_lathe([(0, 0), (0.14, 0), (0.16, 0.5), (0, 0.5)], 24, (2.70, 1.35, 0)), 'biohazard_red'))
    g(obj_from_bm('bin_gen', bm_lathe([(0, 0), (0.14, 0), (0.16, 0.5), (0, 0.5)], 24, (2.70, 0.95, 0)), 'plastic_mid'))
    g(rbox('sharps', (0.12, 0.25, 0.30), (2.94, 1.15, 1.30), 'sharps_red', 0.02))
    # --- north wall: gas panel, vitals monitor arm, clock, room procedure poster
    g(rbox('gas_panel', (0.6, 0.03, 0.22), (-0.3, 3.385, 1.45), 'paint_white', 0.006))
    g(decal('gas_lbl', 0.5, 0.167, (-0.3, 3.369, 1.45), '-Y', 'sign_gases'))
    for i, cm in enumerate(['gas_green', 'gas_yellow', 'gas_white']):
        g(obj_from_bm('gas_out', bm_cyl(0.025, 0.03, 20, (-0.46 + i * 0.16, 3.36, 1.40), 'Y'), cm, bevel=0.004))
    g(obj_from_bm('o2_flow', bm_cyl(0.022, 0.12, 16, (-0.46, 3.32, 1.32)), 'glass'))
    # vitals monitor on wall arm
    g(rbox('vm_mount', (0.08, 0.03, 0.12), (0.55, 3.385, 1.78), 'plastic_light', 0.006))
    g(obj_from_bm('vm_arm', bm_tube_path([Vector((0.55, 3.37, 1.78)), Vector((0.55, 3.1, 1.78)), Vector((0.45, 2.95, 1.76))], 0.018, 14), 'plastic_light', smooth_angle=50))
    vm = Group()
    vm(rbox('vm_body', (0.36, 0.09, 0.28), (0, 0, 0), 'plastic_light', 0.02, 3))
    vscr = decal('SCREEN_vitals', 0.30, 0.20, (0, -0.0455, 0.012), '-Y', 'screen', DYN)
    vm(vscr)
    vm(rbox('vm_handle', (0.30, 0.03, 0.02), (0, 0.0, 0.15), 'plastic_dark', 0.008))
    vm.transform(28, (0.40, 2.90, 1.76))
    g.objs += [o for o in vm.objs if o is not vscr]
    dyn.append(vscr)
    # clock (vault)
    g(obj_from_bm('clk_rim', bm_lathe([(0.0, 0.0), (0.16, 0.0), (0.165, 0.02), (0.155, 0.04), (0.0, 0.04)], 48, (-1.5, 3.4, 2.2), 'Y'), 'plastic_black'))
    # place rim so that it protrudes into room (-Y)
    g.objs[-1].matrix_world = Matrix.Translation((0, -0.04, 0)) @ g.objs[-1].matrix_world
    g(obj_from_bm('clk_face', bm_plane(0.30, 0.30, (-1.5, 3.359, 2.2), '-Y'), 'clock_face', uv='keep', smooth_angle=None))
    for nm, L, w in [('DYN_clock_v_h', 0.08, 0.008), ('DYN_clock_v_m', 0.12, 0.006), ('DYN_clock_v_s', 0.13, 0.002)]:
        h = obj_from_bm(nm, bm_box(w, 0.002, L, c=(-1.5, 3.356 - (0.002 if nm[-1] == 's' else 0), 2.2 + L / 2 - 0.015)), 'plastic_black' if nm[-1] != 's' else 'plastic_red', DYN, smooth_angle=None)
        set_origin(h, (-1.5, 3.356, 2.2))
        h['clock'] = nm[-1]
        dyn.append(h)
    # in-room procedure poster near the entry (maze wall north face)
    g(decal('poster_room', 0.42, 0.42, (-0.15, -1.599, 1.45), 'Y', 'sign_procedure_room'))
    g(decal('caution_in', 0.25, 0.25, (0.55, -1.599, 1.55), 'Y', 'sign_caution_ram'))
    # --- area radiation monitor detector (east wall) + beacon
    g(rbox('arm_det', (0.08, 0.16, 0.22), (2.955, 0.6, 2.15), 'plastic_light', 0.012))
    g(obj_from_bm('arm_det_win', bm_cyl(0.035, 0.004, 24, (2.913, 0.6, 2.12), 'X'), 'plastic_dark'))
    g(decal('arm_lbl_v', 0.15, 0.04, (2.9145, 0.6, 2.235), '-X', 'sign_area_monitor'))
    bcn = obj_from_bm('DYN_beacon_room', bm_lathe([(0, 0), (0.035, 0), (0.035, 0.035), (0.026, 0.06), (0, 0.066)], 24, (2.955, 0.6, 2.26)), 'beacon_red', DYN)
    dyn.append(bcn)
    scr = decal('SCREEN_arm_room', 0.06, 0.03, (2.9145, 0.6, 2.06), '-X', 'screen', DYN)
    dyn.append(scr)
    # --- in-room emergency off (east wall near entry)
    g(rbox('wes_box', (0.06, 0.14, 0.14), (2.97, -1.30, 1.35), 'plastic_yellow', 0.012))
    wes = obj_from_bm('DYN_wall_estop', bm_lathe([(0.0, 0.0), (0.028, 0.0), (0.03, 0.008), (0.033, 0.02), (0.028, 0.03), (0.015, 0.035), (0.0, 0.036)], 32, (0, 0, 0), 'X'), 'plastic_red', DYN)
    wes.matrix_world = Matrix.Translation((2.94, -1.30, 1.35)) @ Matrix.Rotation(math.pi, 4, 'Z')
    wes['interact'] = 'button'
    dyn.append(wes)
    g(decal('wes_lbl', 0.16, 0.083, (2.9995, -1.30, 1.53), '-X', 'sign_estop'))
    # --- CCTV cameras + intercom speaker
    for (x, y, rz) in [(2.86, -1.45, 50), (-2.86, 3.26, -134)]:
        cg = Group()
        cg(rbox('cam_mount', (0.06, 0.06, 0.1), (0, 0, 2.70), 'plastic_white', 0.008))
        cg(rbox('cam_body', (0.08, 0.20, 0.08), (0, 0.05, 2.62), 'plastic_white', 0.02, 3))
        cg(obj_from_bm('cam_lens', bm_cyl(0.025, 0.02, 20, (0, 0.155, 2.62), 'Y'), 'plastic_black'))
        cg(rbox('cam_hood', (0.09, 0.22, 0.01), (0, 0.06, 2.665), 'plastic_white', 0.004))
        cg.transform(rz, (x, y, 0))
        g.objs += cg.objs
    g(obj_from_bm('spk', bm_cyl(0.10, 0.012, 32, (0.3, 1.5, 2.745)), 'paint_white', bevel=0.003))
    g(obj_from_bm('spk_grill', bm_cyl(0.085, 0.002, 32, (0.3, 1.5, 2.738)), 'plastic_mid'))
    # --- OR light (ceiling)
    g(obj_from_bm('orl_mount', bm_cyl(0.12, 0.05, 32, (0.4, 1.0, 2.725)), 'paint_white', bevel=0.01))
    g(obj_from_bm('orl_tube', bm_cyl(0.03, 0.42, 16, (0.4, 1.0, 2.49)), 'paint_white'))
    g(obj_from_bm('orl_arm', bm_tube_path([Vector((0.4, 1.0, 2.29)), Vector((0.5, 0.75, 2.27)), Vector((0.62, 0.45, 2.22))], 0.03, 16), 'paint_white', smooth_angle=50))
    og = Group()
    og(obj_from_bm('orl_head', bm_lathe([(0, 0), (0.27, 0.0), (0.28, 0.03), (0.26, 0.07), (0.12, 0.10), (0, 0.10)], 48, (0, 0, 0)), 'paint_white', smooth_angle=40))
    og(obj_from_bm('orl_lens', bm_cyl(0.24, 0.004, 48, (0, 0, -0.001)), 'glass_frosted'))
    og(obj_from_bm('orl_handle', bm_cyl(0.025, 0.12, 16, (0, 0, -0.06)), 'plastic_light', bevel=0.006))
    for o in og.objs:
        o.matrix_world = Matrix.Translation((0.62, 0.38, 2.08)) @ Matrix.Rotation(-25 * D2R, 4, 'X') @ Matrix.Rotation(-20 * D2R, 4, 'Y') @ o.matrix_world
    g.objs += og.objs
    # --- IV pole near head
    g(obj_from_bm('iv_base', bm_cyl(0.28, 0.03, 5, (-1.05, 2.75, 0.07)), 'aluminum', bevel=0.01))
    g(obj_from_bm('iv_pole', bm_cyl(0.012, 1.95, 12, (-1.05, 2.75, 1.05)), 'steel_satin'))
    g(obj_from_bm('iv_hooks', bm_tube_path([Vector((-1.17, 2.75, 2.0)), Vector((-1.05, 2.75, 2.02)), Vector((-0.93, 2.75, 2.0))], 0.005, 8), 'steel_satin'))
    g(rbox('iv_bag', (0.11, 0.03, 0.2), (-0.95, 2.75, 1.86), 'glass', 0.015))
    # --- rolling stool
    g(obj_from_bm('st_base', bm_cyl(0.24, 0.03, 5, (-1.55, -0.95, 0.07)), 'plastic_black', bevel=0.01))
    g(obj_from_bm('st_gas', bm_cyl(0.022, 0.4, 12, (-1.55, -0.95, 0.3)), 'chrome'))
    g(obj_from_bm('st_seat', bm_cyl(0.19, 0.08, 32, (-1.55, -0.95, 0.54)), 'mattress', bevel=0.03, bevel_segs=3))
    # --- mobile lead shield (static) near entry
    sg = Group()
    sg(rbox('ms_base', (0.7, 0.35, 0.08), (0, 0, 0.08), 'plastic_mid', 0.02))
    sg(rbox('ms_panel', (0.7, 0.06, 1.1), (0, 0, 0.7), 'paint_white', 0.015))
    sg(rbox('ms_window', (0.42, 0.065, 0.3), (0, 0, 1.45), 'glass', 0.01))
    sg(rbox('ms_topbar', (0.7, 0.07, 0.06), (0, 0, 1.63), 'paint_white', 0.01))
    for x in (-0.29, 0.29):
        sg(rbox('ms_side', (0.12, 0.07, 0.36), (x, 0, 1.43), 'paint_white', 0.01))
        caster(sg, x, -0.12, r=0.035)
        caster(sg, x, 0.12, r=0.035)
    sg(decal('ms_lbl', 0.15, 0.15, (0, -0.0305, 0.9), '-Y', 'sign_trefoil_small'))
    sg.transform(-35, (2.25, -0.85, 0))
    g.objs += sg.objs
    # --- linen hamper
    g(obj_from_bm('hamper_ring', bm_lathe([(0.2, 0.8), (0.22, 0.8), (0.22, 0.82), (0.2, 0.82)], 24, (-2.2, 3.0, 0)), 'steel_satin'))
    g(obj_from_bm('hamper_bag', bm_lathe([(0, 0.25), (0.19, 0.27), (0.21, 0.8), (0, 0.8)], 24, (-2.2, 3.0, 0)), 'plastic_blue'))
    for i in range(3):
        a = i * 2 * math.pi / 3
        g(obj_from_bm('hamper_leg', bm_cyl(0.01, 0.8, 8, (-2.2 + 0.21 * math.cos(a), 3.0 + 0.21 * math.sin(a), 0.4)), 'steel_satin'))
    return g, dyn


def build_door():
    """Lead-lined vault door, hinge at X=-2.75, outward swing. Origin at hinge."""
    parts = []
    hx, hy = -2.75, -3.94
    parts.append(obj_from_bm('dr_leaf', bm_box(1.30, 0.07, 2.19, c=(-2.10, -3.945, 1.105)), 'door_paint', DYN, bevel=0.006))
    parts.append(obj_from_bm('dr_kick', bm_box(1.20, 0.004, 0.25, c=(-2.10, -3.9815, 0.15)), 'kick_plate', DYN))
    parts.append(obj_from_bm('dr_kick_in', bm_box(1.20, 0.004, 0.25, c=(-2.10, -3.9085, 0.15)), 'kick_plate', DYN))
    # lever handle outside (-Y face) at free edge
    hxx = -1.62
    parts.append(obj_from_bm('dr_rose', bm_cyl(0.03, 0.012, 24, (hxx, -3.986, 1.02), 'Y'), 'steel_satin', DYN))
    parts.append(obj_from_bm('dr_lever_n', bm_cyl(0.011, 0.06, 16, (hxx, -4.01, 1.02), 'Y'), 'steel_satin', DYN))
    parts.append(obj_from_bm('dr_lever', bm_box(0.15, 0.022, 0.022, c=(hxx - 0.065, -4.04, 1.02)), 'steel_satin', DYN, bevel=0.008))
    # inside pull handle (+Y face)
    parts.append(obj_from_bm('dr_pull', bm_tube_path([Vector((hxx, -3.91, 0.85)), Vector((hxx, -3.86, 0.87)), Vector((hxx, -3.86, 1.17)), Vector((hxx, -3.91, 1.19))], 0.013, 12), 'steel_satin', DYN, smooth_angle=60))
    # hinges
    for z in (0.3, 1.1, 1.9):
        parts.append(obj_from_bm('dr_hinge', bm_cyl(0.018, 0.14, 16, (hx, -3.985, z)), 'steel_satin', DYN))
    # sign
    parts.append(decal('dr_sign', 0.36, 0.48, (-2.10, -3.9815, 1.52), '-Y', 'sign_hra_door', DYN))
    parts.append(decal('dr_sign2', 0.30, 0.1125, (-2.10, -3.9815, 1.14), '-Y', 'sign_no_entry', DYN))
    door = merge_dyn('DYN_door', parts, (hx, hy, 0.0), {'interact': 'door'})
    return door


def build_power_cable(start, end):
    pts = [Vector(start), Vector(start) + Vector((0, 0, -0.5)), Vector((start[0] + 0.1, start[1] + 0.2, 0.012)),
           Vector((end[0] - 0.3, end[1] - 0.1, 0.012)), Vector((end[0] - 0.02, end[1], 0.012)), Vector(end)]
    # smooth via catmull-rom sampling
    out = []
    for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[min(i + 2, len(pts) - 1)]
        for t in [k / 8 for k in range(8)]:
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return obj_from_bm('al_cable', bm_tube_path(out, 0.007, 10), 'cable_black', smooth_angle=70)
