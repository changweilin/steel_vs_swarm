import { writeFile } from 'node:fs/promises';
import { blenderMcp } from '../../tools/mech_authoring/mcp.mjs';
const root = process.cwd().replaceAll('\\', '/');
const code = `import bpy
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(root + '/out/combat_reference/t10/t10.blend')})
for node in bpy.data.objects:
    if node.animation_data:
        for track in node.animation_data.nla_tracks:
            track.mute = track.name != 'def'
scene = bpy.context.scene
scene.frame_set(13)
camera = scene.camera
target = Vector((0, -2, 3.2))
camera.location = Vector((10, -14, 8))
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.ortho_scale = 13
scene.render.filepath = ${JSON.stringify(root + '/out/combat_reference/t10-blender.png')}
bpy.ops.render.render(write_still=True)
scene.frame_set(12)
scene.frame_set(13)
bpy.context.view_layer.update()
for area in [area for window in bpy.context.window_manager.windows for area in window.screen.areas]:
    if area.type == 'VIEW_3D':
        space = area.spaces.active
        space.overlay.show_overlays = False
        space.shading.type = 'MATERIAL'
        space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
        space.region_3d.view_location = target
        space.region_3d.view_distance = 14
print('T10 defense source reopened, posed and rendered')
`;
const result = await blenderMcp('execute_blender_code', { code, user_prompt: 'Render the integrated defense action from the editable Blender source' });
for (const content of result.content || []) if (content.type === 'text') {
  if (/Error executing|Traceback/.test(content.text)) throw new Error(content.text);
  console.log(content.text.slice(-500));
}
const info = await blenderMcp('get_scene_info', { user_prompt: 'Inspect the reopened T10 combat scene' });
await writeFile(root + '/out/combat_reference/scene-info.json', JSON.stringify(info, null, 2));
const screenshot = await blenderMcp('get_viewport_screenshot', { max_size: 1200, user_prompt: 'Inspect the Blender viewport after posing the integrated defense action' });
for (const content of screenshot.content || []) {
  if (content.type === 'image') {
    await writeFile(root + '/out/combat_reference/t10-viewport.png', Buffer.from(content.data, 'base64'));
    console.log('Saved MCP viewport image');
  } else if (content.type === 'text') console.log(content.text.slice(0, 1200));
}
