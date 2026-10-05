import bpy, sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from mathutils import Vector, Matrix
import importlib
import lib, mats
importlib.reload(lib); importlib.reload(mats)
from lib import *

ROOT = '/home/claude/hdr'
FRAMES = 80


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for n in ['STATIC', 'DYNAMIC', 'LIGHTS', 'PATIENT', 'MARKERS']:
        coll(n)


def load_decal_albedo():
    p = ROOT + '/site/assets/decal_albedo.json'
    if os.path.exists(p):
        d = json.load(open(p))
        for k, v in d.items():
            mats.DECAL_ALBEDO[k] = tuple(v)


def markers(app, dyn_all):
    """Named empties the web app uses."""
    E = lambda n, p, **kw: empty('PT_' + n, p, 'MARKERS', kw or None)
    E('spawn', (0.85, -5.0, 0.0), yaw=0.0)
    E('cam_cctv1', (2.84, -1.42, 2.60), look=[-0.3, 0.9, 0.9])
    E('cam_cctv2', (-2.82, 3.22, 2.60), look=[-0.3, 0.6, 1.0])
    E('vault_center', (0.0, 0.8, 1.5))
    E('control_center', (0.0, -5.2, 1.5))


def main(with_patient=True):
    reset()
    load_decal_albedo()
    import build_room, build_equipment, build_patient
    for m in (build_room, build_equipment, build_patient):
        importlib.reload(m)
    from build_equipment import (build_afterloader, build_table, build_stirrups, build_applicator, build_container,
                                 build_tray, build_survey_meter, build_console, build_vault_furnishings, build_door,
                                 build_power_cable)
    build_room.build_room()
    # afterloader: base center and rotation so its turret faces the applicator connector
    al, al_dyn = build_afterloader()
    AL_POS, AL_ROT = (0.62, -0.18, 0.0), -122.0
    al.transform(AL_ROT, AL_POS)
    M_al = Matrix.Translation(AL_POS) @ Matrix.Rotation(AL_ROT * D2R, 4, 'Z')
    empty('PT_turret_port', M_al @ Vector((0.058, -0.392, 0.93)), 'MARKERS')
    empty('PT_source_safe', M_al @ Vector((0.0, 0.05, 0.55)), 'MARKERS')
    empty('PT_turret_center', M_al @ Vector((0.0, -0.39, 0.93)), 'MARKERS')
    # cable from rear of unit to wall outlet (east wall)
    build_power_cable(M_al @ Vector((0.0, 0.30, 0.30)), (2.99, -0.4, 0.3))
    if with_patient:
        base, pmeshes, leggings, pinfo = build_patient.build_patient_body()
        Y1 = pinfo['head_top_y'] + 0.16
    else:
        Y1 = 1.5
    build_table(Y1=Y1, head_y=(pinfo['head_center_y'] if with_patient else Y1 - 0.25), head_z=(pinfo['head_zmin'] if with_patient else 0.92))
    app, clamp_g, knob = build_applicator()
    build_container()
    build_tray()
    meter, cradle = build_survey_meter()
    build_console()
    build_vault_furnishings()
    build_door()
    markers(app, None)
    empty('PT_container_mouth', (-1.12, -0.02, 0.81), 'MARKERS')
    if with_patient:
        stir = build_patient.build_stirrups_from_legs(pinfo['legs'], leggings)
        cols = [bpy.data.objects[n] for n in ('tb_mattress', 'tb_pillow', 'tb_pad', 'DYN_applicator')]
        build_patient.finish_patient(base, pmeshes, leggings, stir, cols, frames=FRAMES)
    mats.write_json(ROOT + '/site/assets/materials.json')
    bpy.ops.wm.save_as_mainfile(filepath=ROOT + '/build/scene.blend')
    print('objects:', len(bpy.data.objects))


if __name__ == '__main__':
    main(with_patient='--nopatient' not in sys.argv)
