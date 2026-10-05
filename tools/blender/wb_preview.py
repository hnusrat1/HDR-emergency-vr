import bpy, sys, math
from mathutils import Vector
sys.path.insert(0, '/home/claude/hdr/blender')
from render_preview import VIEWS
V = dict(VIEWS)
V.update({
    'boot': ((0.75, 0.55, 1.45), (-0.15, 0.25, 1.05), 50),
    'pt_top': ((-0.3, 0.2, 2.5), (-0.3, 0.9, 0.9), 60),
    'pt_side': ((1.1, 0.95, 1.25), (-0.3, 0.95, 1.0), 60),
    'face': ((0.05, 1.0, 1.32), (-0.3, 1.22, 0.98), 45),
    'feet': ((0.45, -0.35, 1.45), (-0.05, 0.15, 1.1), 45),
})
def go(names, blend='/home/claude/hdr/build/scene.blend', res=(800, 450)):
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_shadows = True
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = res
    cam_d = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
    for n in names:
        p, t, fov = V[n]
        cam.location = p; cam.rotation_euler = (Vector(t) - Vector(p)).to_track_quat('-Z', 'Y').to_euler()
        cam_d.angle = fov * math.pi / 180
        sc.render.filepath = f'/home/claude/hdr/build/preview/wb_{n}.png'
        bpy.ops.render.render(write_still=True)
if __name__ == '__main__':
    go(sys.argv[sys.argv.index('--') + 1:])
