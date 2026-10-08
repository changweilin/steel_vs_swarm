// Reuse the installed Blender MCP process seam; only authoring artifacts and baked members are written.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { ROOT } from '../audit_src.mjs';
import { blenderMcp } from '../mech_authoring/mcp.mjs';
import { SHORELINE, SHORE_FACILITIES } from '../../public/js/shorelineCatalog.js';

const directory = path.join(ROOT,'out/shoreline_review');
await mkdir(directory,{recursive:true});
await writeFile(path.join(directory,'catalog.json'),JSON.stringify({facilities:SHORE_FACILITIES,variants:SHORELINE.VARIANTS}));
const user_prompt = 'Author the bounded shoreline facility library and verify its isolated Blender scene';
for(const name of ['get_addon_status','get_scene_info']) {
  const result=await blenderMcp(name,{user_prompt},45000);
  const text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(name==='get_addon_status')assert(JSON.parse(text).blender_version,'Blender is unavailable');
}
const source=path.join(ROOT,'tools/shoreline_authoring/author.py').replaceAll('\\','/');
const result=await blenderMcp('execute_blender_code',{code:`import runpy\nrunpy.run_path(${JSON.stringify(source)}, run_name='__main__')`,user_prompt});
for(const name of ['get_viewport_screenshot','get_scene_info'])await blenderMcp(name,{user_prompt},45000);
console.log(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
