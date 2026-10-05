"""Architecture: shielded HDR vault with maze, control area, ceilings, lights."""
import bpy, bmesh, math
from mathutils import Vector
from lib import *

H_CEIL = 2.75


def wall(name, mn, mx, mats, default='wall_paint', coll_='STATIC'):
    """Box with per-face material by outward normal. mats: {'+X': m, '-Y': m, ...}"""
    bm = bm_box(*(mx[i] - mn[i] for i in range(3)), c=[(mx[i] + mn[i]) / 2 for i in range(3)])
    order = []
    keys = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']
    names = [mats.get(k, default) for k in keys]
    uniq = []
    for n in names:
        if n not in uniq:
            uniq.append(n)
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        k = ('+' if n[ax] > 0 else '-') + 'XYZ'[ax]
        f.material_index = uniq.index(mats.get(k, default))
    return obj_from_bm(name, bm, uniq, coll_, smooth_angle=None)


def build_room():
    objs = []
    # ---------------- floors
    objs.append(box_minmax('floor_vault', (-3.0, -3.4, -0.1), (3.0, 3.4, 0.0), 'floor_vinyl', bevel=0))
    objs.append(box_minmax('floor_control', (-3.5, -6.6, -0.1), (3.5, -3.9, 0.0), 'floor_vinyl', bevel=0))
    objs.append(box_minmax('floor_doorway', (-2.7, -3.9, -0.1), (-1.5, -3.4, 0.0), 'floor_vinyl', bevel=0))
    # ---------------- ceilings (drop ceiling, tile texture world-aligned)
    objs.append(box_minmax('ceil_vault', (-3.0, -3.4, H_CEIL), (3.0, 3.4, H_CEIL + 0.05), 'ceiling_tile', bevel=0))
    objs.append(box_minmax('ceil_control', (-3.5, -6.6, H_CEIL), (3.5, -3.9, H_CEIL + 0.05), 'ceiling_tile', bevel=0))
    # ---------------- vault shell (0.5 m concrete, painted)
    W = 'wall_paint'
    objs.append(wall('wall_W', (-3.5, -3.9, 0), (-3.0, 3.9, 2.8), {'-X': 'wall_control'}))
    objs.append(wall('wall_E', (3.0, -3.9, 0), (3.5, 3.9, 2.8), {'+X': 'wall_control'}))
    objs.append(wall('wall_N', (-3.0, 3.4, 0), (3.0, 3.9, 2.8), {'-Y': 'wall_accent'}))
    # south wall with door opening X[-2.7,-1.5] Z[0,2.13]
    objs.append(wall('wall_S1', (-3.0, -3.9, 0), (-2.7, -3.4, 2.8), {'-Y': 'wall_control'}))
    objs.append(wall('wall_S2', (-1.5, -3.9, 0), (3.0, -3.9 + 0.5, 2.8), {'-Y': 'wall_control'}))
    objs.append(wall('wall_S3', (-2.7, -3.9, 2.13), (-1.5, -3.4, 2.8), {'-Y': 'wall_control'}))
    # maze wall
    objs.append(wall('wall_maze', (-3.0, -2.1, 0), (1.0, -1.6, 2.8), {}))
    # ---------------- control area shell
    objs.append(wall('wall_cS1', (-3.65, -6.75, 0), (1.4, -6.6, 2.8), {}, default='wall_control'))
    objs.append(wall('wall_cS2', (3.2, -6.75, 0), (3.65, -6.6, 2.8), {}, default='wall_control'))
    objs.append(wall('wall_cS3', (1.4, -6.75, 2.13), (3.2, -6.6, 2.8), {}, default='wall_control'))
    objs.append(wall('wall_cW', (-3.65, -6.75, 0), (-3.5, -3.9, 2.8), {}, default='wall_control'))
    objs.append(wall('wall_cE', (3.5, -6.75, 0), (3.65, -3.9, 2.8), {}, default='wall_control'))

    # ---------------- cove base (vinyl, 10 cm) along walls
    cove = []
    def cove_seg(a, b, nrm):
        # thin strip 1 cm proud of wall
        (x0, y0), (x1, y1) = a, b
        if nrm in ('+X', '-X'):
            x = x0 + (0.006 if nrm == '+X' else -0.006)
            cove.append(box_minmax('cove', (min(x, x0), min(y0, y1), 0), (max(x, x0), max(y0, y1), 0.1), 'floor_cove'))
        else:
            y = y0 + (0.006 if nrm == '+Y' else -0.006)
            cove.append(box_minmax('cove', (min(x0, x1), min(y, y0), 0), (max(x0, x1), max(y, y0), 0.1), 'floor_cove'))
    # vault interior
    cove_seg((-3.0, -3.4), (-3.0, 3.4), '+X')
    cove_seg((3.0, -3.4), (3.0, 3.4), '-X')
    cove_seg((-3.0, 3.4), (3.0, 3.4), '-Y')
    cove_seg((-3.0, -3.4), (-2.7, -3.4), '+Y')
    cove_seg((-1.5, -3.4), (3.0, -3.4), '+Y')
    cove_seg((-3.0, -2.1), (1.0, -2.1), '-Y')
    cove_seg((-3.0, -1.6), (1.0, -1.6), '+Y')
    cove_seg((1.0, -2.1), (1.0, -1.6), '+X')
    # control area
    cove_seg((-3.5, -6.6), (1.4, -6.6), '+Y')
    cove_seg((3.2, -6.6), (3.5, -6.6), '+Y')
    cove_seg((-3.5, -6.6), (-3.5, -3.9), '+X')
    cove_seg((3.5, -6.6), (3.5, -3.9), '-X')
    cove_seg((-3.5, -3.9), (-2.75, -3.9), '-Y')
    cove_seg((-1.45, -3.9), (3.5, -3.9), '-Y')
    objs += cove

    # ---------------- wall protection (bumper rails) at 0.82-0.97 m
    rails = []
    def rail(a, b, nrm, z=0.86):
        (x0, y0), (x1, y1) = a, b
        d = 0.03
        if nrm in ('+X', '-X'):
            x2 = x0 + (d if nrm == '+X' else -d)
            rails.append(box_minmax('rail', (min(x0, x2), min(y0, y1), z), (max(x0, x2), max(y0, y1), z + 0.14), 'bumper_rail', bevel=0.008))
        else:
            y2 = y0 + (d if nrm == '+Y' else -d)
            rails.append(box_minmax('rail', (min(x0, x1), min(y0, y2), z), (max(x0, x1), max(y0, y2), z + 0.14), 'bumper_rail', bevel=0.008))
    rail((3.0, -3.3), (3.0, 1.0), '-X')
    rail((-3.0, -1.5), (-3.0, -1.25), '+X')
    rail((-2.95, -2.1), (0.95, -2.1), '-Y')
    rail((-1.45, -3.4), (2.95, -3.4), '+Y')
    rail((-0.4, -1.6), (0.95, -1.6), '+Y')
    rail((-3.5, -6.5), (-3.5, -4.0), '+X')
    rail((3.5, -6.5), (3.5, -4.0), '-X')
    objs += rails

    # stainless corner guards on maze wall end
    # end face plates (normal +X), 6 cm wide, and side plates
    objs.append(box_minmax('cg', (1.0, -2.104, 0.1), (1.003, -2.04, 1.5), 'steel_satin'))
    objs.append(box_minmax('cg', (0.94, -2.104, 0.1), (1.003, -2.101, 1.5), 'steel_satin'))
    objs.append(box_minmax('cg', (1.0, -1.66, 0.1), (1.003, -1.596, 1.5), 'steel_satin'))
    objs.append(box_minmax('cg', (0.94, -1.599, 0.1), (1.003, -1.596, 1.5), 'steel_satin'))

    # ---------------- vault door frame (outside face) + inner reveal trim
    fr = 'door_frame'
    objs.append(box_minmax('dframe_l', (-2.83, -3.95, 0.0), (-2.73, -3.88, 2.24), fr, bevel=0.004))
    objs.append(box_minmax('dframe_r', (-1.47, -3.95, 0.0), (-1.37, -3.88, 2.24), fr, bevel=0.004))
    objs.append(box_minmax('dframe_t', (-2.83, -3.95, 2.20), (-1.37, -3.88, 2.30), fr, bevel=0.004))
    # threshold
    objs.append(box_minmax('threshold', (-2.7, -3.9, 0.0), (-1.5, -3.4, 0.008), 'aluminum', bevel=0.002))

    # ---------------- control area hallway double doors (closed, static)
    for i, (x0, x1) in enumerate([(1.42, 2.29), (2.31, 3.18)]):
        objs.append(box_minmax('hall_door', (x0, -6.66, 0.01), (x1, -6.62, 2.12), 'wood_door', bevel=0.003))
        # vision panel
        objs.append(box_minmax('hall_vision', (x0 + 0.3, -6.67, 1.25), (x1 - 0.3, -6.61, 1.85), 'glass_frosted', bevel=0))
        # push plate / handle
        objs.append(box_minmax('hall_plate', (x1 - 0.17 if i == 0 else x0 + 0.05, -6.6205, 0.95), (x1 - 0.05 if i == 0 else x0 + 0.17, -6.616, 1.25), 'steel_satin', bevel=0.002))
        objs.append(box_minmax('hall_kick', (x0 + 0.02, -6.6205, 0.02), (x1 - 0.02, -6.617, 0.27), 'kick_plate', bevel=0.001))
    objs.append(box_minmax('hall_frame_l', (1.36, -6.68, 0), (1.42, -6.58, 2.16), fr))
    objs.append(box_minmax('hall_frame_r', (3.18, -6.68, 0), (3.24, -6.58, 2.16), fr))
    objs.append(box_minmax('hall_frame_t', (1.36, -6.68, 2.12), (3.24, -6.58, 2.18), fr))
    objs.append(box_minmax('hall_mull', (2.29, -6.66, 0.01), (2.31, -6.6, 2.12), fr))

    # ---------------- light fixtures
    lights = []
    def troffer(cx, cy, along='Y', power=55.0, temp=(1.0, 0.96, 0.9), name='trof'):
        lx, ly = (0.6, 1.2) if along == 'Y' else (1.2, 0.6)
        z = H_CEIL
        # frame (flush with a 6 mm lip)
        b = 0.025
        x0, x1, y0, y1 = cx - lx / 2, cx + lx / 2, cy - ly / 2, cy + ly / 2
        for mn, mx in [((x0, y0, z - 0.012), (x1, y0 + b, z)), ((x0, y1 - b, z - 0.012), (x1, y1, z)),
                       ((x0, y0 + b, z - 0.012), (x0 + b, y1 - b, z)), ((x1 - b, y0 + b, z - 0.012), (x1, y1 - b, z))]:
            objs.append(box_minmax('trof_frame', mn, mx, 'troffer_frame', bevel=0.002))
        # recessed diffuser lens (6 mm above frame lip)
        objs.append(obj_from_bm('trof_lens', bm_box(lx - 2 * b, ly - 2 * b, 0.004, c=(cx, cy, z - 0.004)), 'troffer_lens', smooth_angle=None))
        L = bpy.data.lights.new(name, 'AREA')
        L.shape = 'RECTANGLE'
        L.size, L.size_y = lx - 0.05, ly - 0.05
        L.energy = power
        L.color = temp
        lo = bpy.data.objects.new(name, L)
        lo.location = (cx, cy, z - 0.0125)
        coll('LIGHTS').objects.link(lo)
        lights.append(lo)

    for (x, y) in [(-1.5, 0.6), (1.5, 0.6), (-1.5, 2.4), (1.5, 2.4), (0.3, -0.6)]:
        troffer(x, y, 'Y', power=70.0)
    troffer(-1.2, -2.7, 'X', power=55.0)
    troffer(2.1, -2.4, 'Y', power=60.0)
    for x in (-2.1, 0.3, 2.1):
        troffer(x, -5.4, 'Y', power=48.0, temp=(1.0, 0.93, 0.84))

    # downlights (control area over desk, vault over sink)
    def downlight(cx, cy, power=8.0):
        objs.append(obj_from_bm('dl_trim', bm_cyl(0.085, 0.01, 32, (cx, cy, H_CEIL - 0.005)), 'paint_white'))
        objs.append(obj_from_bm('dl_lens', bm_cyl(0.06, 0.004, 32, (cx, cy, H_CEIL - 0.011)), 'downlight_lens', smooth_angle=None))
        L = bpy.data.lights.new('dl', 'SPOT')
        L.energy = power * 10
        L.spot_size = 100 * D2R
        L.spot_blend = 0.6
        L.shadow_soft_size = 0.05
        L.color = (1.0, 0.92, 0.82)
        lo = bpy.data.objects.new('dl', L)
        lo.location = (cx, cy, H_CEIL - 0.02)
        coll('LIGHTS').objects.link(lo)
    downlight(0.9, -4.35, 9)
    downlight(2.1, -4.35, 9)
    downlight(2.75, 2.4, 6)
    downlight(-2.1, -2.75, 4)

    return objs
