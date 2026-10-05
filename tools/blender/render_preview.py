import bpy, sys, math, os
from mathutils import Vector

ROOT = '/home/claude/hdr'
VIEWS = {
    'entry': ((2.3, -1.9, 1.65), (-0.3, 0.6, 0.9), 70),
    'foot': ((-0.3, -0.75, 1.62), (-0.3, 0.6, 0.95), 65),
    'head': ((0.7, 2.6, 1.7), (-0.3, 0.6, 0.95), 65),
    'face': ((0.15, 1.45, 1.38), (-0.3, 1.98, 1.0), 40),
    'console': ((0.85, -5.6, 1.62), (0.6, -3.9, 1.3), 70),
    'corridor': ((-2.1, -4.6, 1.6), (-1.0, -2.6, 1.3), 75),
    'afterloader': ((1.4, 0.3, 1.4), (0.62, -0.18, 0.8), 55),
    'west': ((2.2, 2.6, 1.6), (-2.6, 0.5, 1.2), 72),
}


def render(names, samples=24, res=(960, 540), out='preview'):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 2
    sc.cycles.transparent_max_bounces = 4
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['look'].enum_items] else 'None'
    sc.view_settings.exposure = 0.0
    if sc.world is None:
        sc.world = bpy.data.worlds.new('W')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.02, 0.02, 0.02, 1)
    cam_d = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    os.makedirs(ROOT + '/build/' + out, exist_ok=True)
    for n in names:
        p, t, fov = VIEWS[n]
        cam.location = p
        d = Vector(t) - Vector(p)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam_d.angle = fov * math.pi / 180
        sc.render.filepath = f'{ROOT}/build/{out}/{n}.jpg'
        sc.render.image_settings.file_format = 'JPEG'
        bpy.ops.render.render(write_still=True)
        print('rendered', n)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['entry']
    bpy.ops.wm.open_mainfile(filepath=ROOT + '/build/scene.blend')
    render(args)
