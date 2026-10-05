"""Shared material registry. Blender uses flat albedo for the light bake;
the web app reads the same spec (materials.json) and builds PBR materials."""
import bpy, json

# color: sRGB hex, rough, metal, tex: texture set key (web), tile: meters per texture repeat
SPEC = {
    # ---------------- architecture
    'floor_vinyl':     dict(color='#c9c4b9', rough=0.30, metal=0.0, tex='vinyl', tile=2.0),
    'floor_cove':      dict(color='#55595c', rough=0.55, metal=0.0),
    'wall_paint':      dict(color='#e7e3da', rough=0.85, metal=0.0, tex='paint', tile=1.5),
    'wall_accent':     dict(color='#7fa6a3', rough=0.85, metal=0.0, tex='paint', tile=1.5),
    'wall_control':    dict(color='#d9d6cf', rough=0.85, metal=0.0, tex='paint', tile=1.5),
    'ceiling_tile':    dict(color='#efefec', rough=0.95, metal=0.0, tex='ceiling', tile=3.6),
    'tbar':            dict(color='#f4f4f2', rough=0.5, metal=0.0),
    'troffer_frame':   dict(color='#f1f1ef', rough=0.45, metal=0.0),
    'troffer_lens':    dict(color='#ffffff', rough=0.3, metal=0.0, emissive='#fff6ea', emissiveIntensity=3.0, nolm=True),
    'downlight_lens':  dict(color='#ffffff', rough=0.3, metal=0.0, emissive='#fff1df', emissiveIntensity=3.0, nolm=True),
    'bumper_rail':     dict(color='#8e9aa1', rough=0.45, metal=0.0),
    'rail_cap':        dict(color='#c7cbcf', rough=0.3, metal=0.9),
    'door_paint':      dict(color='#aeb8bf', rough=0.42, metal=0.0),
    'door_frame':      dict(color='#6f7a83', rough=0.4, metal=0.2),
    'kick_plate':      dict(color='#c9ccce', rough=0.28, metal=1.0),
    'wood_door':       dict(color='#b48a5a', rough=0.5, metal=0.0, tex='wood', tile=1.2),
    'concrete':        dict(color='#9a9893', rough=0.9, metal=0.0),
    # ---------------- furniture / casework
    'laminate_white':  dict(color='#ecebe6', rough=0.35, metal=0.0),
    'laminate_maple':  dict(color='#cfb48d', rough=0.4, metal=0.0, tex='wood', tile=1.0),
    'laminate_gray':   dict(color='#8f969c', rough=0.45, metal=0.0),
    'solid_surface':   dict(color='#e3e0d8', rough=0.25, metal=0.0, tex='speckle', tile=1.0),
    'desk_edge':       dict(color='#3a3d40', rough=0.5, metal=0.0),
    'glass':           dict(color='#dfe9ec', rough=0.05, metal=0.0, transparent=0.25),
    'glass_frosted':   dict(color='#f2f4f4', rough=0.6, metal=0.0, transparent=0.6, emissive='#f4f1ea', emissiveIntensity=0.6, nolm=True),
    'steel_brushed':   dict(color='#c4c8cb', rough=0.32, metal=1.0),
    'steel_satin':     dict(color='#d2d5d8', rough=0.22, metal=1.0),
    'chrome':          dict(color='#e4e6e8', rough=0.06, metal=1.0),
    'aluminum':        dict(color='#c9ccd0', rough=0.35, metal=1.0),
    'paint_white':     dict(color='#eeeeea', rough=0.4, metal=0.0),
    'plastic_white':   dict(color='#efefeb', rough=0.38, metal=0.0),
    'plastic_light':   dict(color='#d5d8da', rough=0.42, metal=0.0),
    'plastic_mid':     dict(color='#9ba1a6', rough=0.45, metal=0.0),
    'plastic_dark':    dict(color='#2c2f33', rough=0.5, metal=0.0),
    'plastic_black':   dict(color='#121314', rough=0.45, metal=0.0),
    'plastic_blue':    dict(color='#1f5f9e', rough=0.35, metal=0.0),
    'plastic_teal':    dict(color='#2f8f8a', rough=0.4, metal=0.0),
    'plastic_yellow':  dict(color='#f1c21b', rough=0.35, metal=0.0),
    'plastic_red':     dict(color='#c0151a', rough=0.3, metal=0.0),
    'plastic_orange':  dict(color='#e86a1a', rough=0.35, metal=0.0),
    'plastic_green':   dict(color='#2e8b3e', rough=0.4, metal=0.0),
    'rubber_black':    dict(color='#141414', rough=0.85, metal=0.0),
    'rubber_gray':     dict(color='#4a4d50', rough=0.8, metal=0.0),
    'mattress':        dict(color='#2d3d50', rough=0.55, metal=0.0, tex='leather', tile=0.5),
    'boot_pad':        dict(color='#26303a', rough=0.6, metal=0.0, tex='leather', tile=0.4),
    'fabric_white':    dict(color='#f1f1ee', rough=0.95, metal=0.0, tex='fabric', tile=0.25),
    'fabric_blanket':  dict(color='#ecebe4', rough=0.97, metal=0.0, tex='fabric', tile=0.3),
    'drape_blue':      dict(color='#6f9cc4', rough=0.92, metal=0.0, tex='fabric', tile=0.3),
    'fabric_chair':    dict(color='#33393f', rough=0.9, metal=0.0, tex='fabric', tile=0.2),
    'screen_off':      dict(color='#0b0c0d', rough=0.12, metal=0.0),
    'screen':          dict(color='#000000', rough=0.2, metal=0.0, nolm=True, screen=True),
    'led_green':       dict(color='#0a3', rough=0.3, metal=0.0, emissive='#2f2', emissiveIntensity=2.0, nolm=True),
    'led_red':         dict(color='#a00', rough=0.3, metal=0.0, emissive='#f22', emissiveIntensity=0.0, nolm=True),
    'beacon_red':      dict(color='#b3121a', rough=0.25, metal=0.0, transparent=0.15, emissive='#ff1a1a', emissiveIntensity=0.0, nolm=True),
    'sign_lit':        dict(color='#300', rough=0.3, metal=0.0, emissive='#ffffff', emissiveIntensity=0.0, nolm=True, decal='sign_radiation_on'),
    'skin':            dict(color='#c99a82', rough=0.55, metal=0.0),
    'hair':            dict(color='#5a4636', rough=0.6, metal=0.0),
    'pillow':          dict(color='#f3f3f0', rough=0.95, metal=0.0, tex='fabric', tile=0.25),
    'paper':           dict(color='#f4f2ec', rough=0.9, metal=0.0),
    'cardboard':       dict(color='#c9a67a', rough=0.9, metal=0.0),
    'biohazard_red':   dict(color='#b51c1c', rough=0.5, metal=0.0),
    'sharps_red':      dict(color='#c4161c', rough=0.4, metal=0.0),
    'cable_gray':      dict(color='#6c7480', rough=0.4, metal=0.0),
    'cable_black':     dict(color='#1c1d1f', rough=0.5, metal=0.0),
    'gas_green':       dict(color='#2e8b57', rough=0.4, metal=0.0),
    'gas_yellow':      dict(color='#e3b81f', rough=0.4, metal=0.0),
    'gas_white':       dict(color='#f2f2f2', rough=0.4, metal=0.0),
    'lead_gray':       dict(color='#5f6467', rough=0.6, metal=0.5),
    'wood_handle':     dict(color='#6a4a2f', rough=0.5, metal=0.0),
    'clock_face':      dict(color='#ffffff', rough=0.3, metal=0.0, decal='clock_face'),
}

# decal materials (image on plane, UV 0..1). name -> image key
DECALS = [
    'sign_hra_door', 'sign_caution_ram', 'sign_room', 'sign_estop', 'sign_procedure_console',
    'sign_procedure_room', 'sign_container', 'sign_unit_label', 'sign_unit_warning', 'sign_handhygiene',
    'sign_exit', 'sign_rad_on_label', 'sign_crank', 'sign_area_monitor', 'sign_no_entry', 'sign_whiteboard',
    'sign_gases', 'sign_sharps', 'sign_biohazard', 'sign_fire', 'sign_trefoil_small', 'sign_meter_label',
    'sign_phone_list', 'sign_keyswitch', 'sign_panel_console',
]
for d in DECALS:
    SPEC[d] = dict(color='#dddddd', rough=0.55, metal=0.0, decal=d)


def hex2lin(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


DECAL_ALBEDO = {}  # filled by build (average color of the generated image)


def get_mat(name):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    s = SPEC[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    col = hex2lin(s['color'])
    if name in DECAL_ALBEDO:
        col = DECAL_ALBEDO[name]
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Roughness'].default_value = s['rough']
    bsdf.inputs['Metallic'].default_value = s['metal']
    if s.get('emissive') and s.get('emissiveIntensity', 0) > 0:
        bsdf.inputs['Emission Color'].default_value = hex2lin(s['emissive'])
        bsdf.inputs['Emission Strength'].default_value = 0.0  # bake uses real lights
    if s.get('transparent'):
        bsdf.inputs['Alpha'].default_value = max(0.15, s['transparent'])
    m.diffuse_color = col
    return m


def write_json(path):
    with open(path, 'w') as f:
        json.dump(SPEC, f, indent=1)
