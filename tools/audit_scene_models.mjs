// Shipped scene builders: finite deterministic geometry, bounded batching, ownership,
// colour preservation and multi-angle visual inspection. No gameplay values are rewritten.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const chromium = await chromiumOrNull();
const snapshots = !process.argv.includes('--no-shots');
if (!chromium) skipNoPlaywright('場景模型瀏覽器量測');
const server = await serve();
const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.THREE_MODULE) {
    const source = await readFile(process.env.THREE_MODULE, 'utf8');
    await page.route('**/three@0.160.0/build/three.module.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    await page.route('**/three@0.160.0/examples/jsm/**', async route => {
      const suffix = route.request().url().split('/examples/jsm/')[1].replaceAll('/', '_');
      try {
        const body = await readFile(path.join(path.dirname(process.env.THREE_MODULE), suffix), 'utf8');
        await route.fulfill({ contentType: 'text/javascript', body });
      } catch { await route.continue(); }
    });
  }
  await page.route('**/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async ({ snapshots }) => {
    const THREE = await import('three');
    const { buildHazard, buildLoot, buildAirdrop, buildMineBump } = await import('/public/js/hazards.js');
    const { HAZARDS } = await import('/public/js/data.js');
    const { buildVegMeshes, buildBldBucket, buildLandmark, LEGACY_LANDMARK_TYPES, roadPropMeshes } = await import('/public/js/biomes.js');
    const { osmAreaGeometry } = await import('/public/js/osmAreaObjects.js');
    const { LEGACY_PLANT_SPECIES, GROUND_PLANTS } = await import('/public/js/scenePlantParts.js');
    const { forestSceneGeometry, addSceneGeometry, furnitureSceneBatches, scenePartGeometry } = await import('/public/js/scenePropModels.js');
    const { disposeTree, updateCelLight, setCelSun } = await import('/public/js/toon.js');
    const { TREE_ATTACHMENTS } = await import('/public/js/sceneAttachmentParts.js');
    const { buildCivic } = await import('/public/js/siteplan.js');
    const { mulberry32 } = await import('/public/js/rng.js');
    const { Pipeline } = await import('/public/js/postfx.js');
    const { createForestTree } = await import('/public/js/forest.js');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    // Weld coincident vertices only for inspection, then test surface-component support.
    // This catches detached assemblies after baking; forest branch probes remain in audit_object_joints.
    const supported = (root, label, bark = false) => {
      root.updateMatrixWorld(true);
      const boxes = [];
      root.traverse(node => {
        if (!node.isMesh || node.userData.isOutline || node.material.transparent) return;
        const geometry=node.geometry, p=geometry.attributes.position, index=geometry.index;
        const parents=Array.from({length:p.count},(_,i)=>i), keys=new Map(), v=new THREE.Vector3();
        const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
        const join=(a,b)=>{parents[find(a)]=find(b);};
        for(let i=0;i<p.count;i++) {
          const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*10000)).join(',');
          if(keys.has(key))join(i,keys.get(key));else keys.set(key,i);
        }
        for(let i=0;i<(index?.count||p.count);i+=3) {
          const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;
          join(a,b);join(a,c);
        }
        const components=new Map();
        for(let i=0;i<p.count;i++) {
          const key=find(i);
          if(!components.has(key))components.set(key,new THREE.Box3());
          components.get(key).expandByPoint(v.fromBufferAttribute(p,i).applyMatrix4(node.matrixWorld));
        }
        boxes.push(...components.values());
      });
      const reached=new Set(boxes.flatMap((b,i)=>(bark?b.min.x<=.05:b.min.y<=.05)?[i]:[]));
      let changed=true;
      while(changed) {
        changed=false;
        for(let i=0;i<boxes.length;i++) {
          if(reached.has(i))continue;
          const expanded=boxes[i].clone().expandByScalar(.06);
          if([...reached].some(j=>expanded.intersectsBox(boxes[j]))) {reached.add(i);changed=true;}
        }
      }
      check(reached.size===boxes.length,label+': detached surface components '+JSON.stringify(boxes.filter((_,i)=>!reached.has(i)).map(b=>[b.min.toArray(),b.max.toArray()])));
    };
    const signature = root => {
      const parts = [];
      root.updateMatrixWorld(true);
      root.traverse(node => {
        if (!node.isMesh || node.userData.isOutline) return;
        const attrs = node.geometry.attributes;
        for (const attr of Object.values(attrs)) check([...attr.array].every(Number.isFinite), 'Non-finite geometry');
        check(node.matrixWorld.elements.every(Number.isFinite), 'Non-finite transform');
        if(node.instanceMatrix)check([...node.instanceMatrix.array].every(Number.isFinite),'Non-finite instance transform');
        parts.push([[...attrs.position.array],node.matrixWorld.elements,attrs.color?[...attrs.color.array]:null,
          node.instanceMatrix?[...node.instanceMatrix.array]:null]);
      });
      check(parts.length, 'Empty model');
      return JSON.stringify(parts);
    };
    const hazards = Object.keys(HAZARDS).filter(kind => !HAZARDS[kind].noModel).concat(['aasite', 'relay']);
    const assemblies = ['sacredtree','fallentree','boulder','rockfall','landslide','ship','construction','aasite','relay'];
    let checked = 0;
    for (const kind of hazards) for (const seed of [0, 1, 42, 4294967295]) for (const scale of [.6, 1, 1.5]) {
      const radius = (HAZARDS[kind]?.r || 8) * scale;
      const a = buildHazard(kind, seed, radius), b = buildHazard(kind, seed, radius);
      check(signature(a) === signature(b), kind + ': non-deterministic');
      const bounds = new THREE.Box3().setFromObject(a);
      check(bounds.max.y > 0, kind + ': empty height');
      if (assemblies.includes(kind)) check(bounds.min.y >= -.001, kind + ': ground contact');
      const meshes = []; a.traverse(n => { if (n.isMesh && !n.userData.isOutline) meshes.push(n); });
      if (assemblies.includes(kind)) {
        check(meshes.length <= 4, kind + ': unbounded draw calls');
        const colored = meshes.filter(n => n.material.vertexColors);
        check(colored.length && colored.every(n => n.geometry.attributes.color), kind + ': lost palette');
        check(colored.some(n => new Set(n.geometry.attributes.color.array).size > 4), kind + ': palette collapsed');
        supported(a,kind+'/'+seed+'/'+scale);
        const v=new THREE.Vector3();a.updateMatrixWorld(true);
        for(const mesh of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++) {
          v.fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld);
          check(Math.hypot(v.x,v.z)<=radius+.001,kind+': visual exceeds collision radius');
        }
      }
      const pristine = signature(b);
      if(kind==='flood')a.traverse(mesh=>{
        if(mesh.name!=='water-ripple')return;
        const normal=new THREE.Vector3(0,0,1).transformDirection(mesh.matrixWorld);
        check(Math.abs(normal.y)> .99999,'Water ripple tilted away from surface');
      });
      meshes[0].geometry.attributes.position.setX(0, 999);
      check(signature(b) === pristine, kind + ': shared mutable damage geometry');
      disposeTree(a); disposeTree(b); checked++;
    }
    const plants = [...Object.keys(LEGACY_PLANT_SPECIES), ...GROUND_PLANTS, ...TREE_ATTACHMENTS];
    for(const type of new Set(Object.values(LEGACY_PLANT_SPECIES))) {
      const tree=createForestTree(type,42), first=tree.parts[0];
      check(first.role!=='leaf','Seasonal reference must be structural');
      const summer=forestSceneGeometry(type,42,[3,8,3],'summer'),winter=forestSceneGeometry(type,42,[3,8,3],'winter');
      const p=first.g.parameters;
      const reference=scenePartGeometry({g:p.height?['cyl',p.radiusTop,p.radiusBottom,p.height,p.radialSegments]:['ico',p.radius]});
      const count=reference.attributes.position.count*3;
      reference.dispose();
      const a=summer.attributes.position.array,b=winter.attributes.position.array;
      check([...a.slice(0,count)].every((v,i)=>Math.abs(v-b[i])<.00001),type+': seasonal trunk transform drift');
      summer.dispose();winter.dispose();checked++;
    }
    for (const kind of plants) for (const season of ['summer', 'winter']) {
      const items = Array.from({ length: 12 }, (_, i) => ({ x: i * 7, y: 0, z: i * 3, s: 1, ry: .2, dj: 0 }));
      const group = new THREE.Group(); group.add(...buildVegMeshes(kind, items, season));
      signature(group);
      supported(group,kind,TREE_ATTACHMENTS.includes(kind));
      check(group.children.length <= 3, kind + ': prototype batching lost');
      check(group.children.reduce((n, mesh) => n + mesh.count, 0) === items.length, kind + ': instances lost');
      disposeTree(group); checked++;
    }
    const shapes = ['tank','crop','tree','bench','goal','car','motorcycle','solar','facility','spire','marker','barrier','signal','buoy','reed','rock','transformer',
      'trough','logpile','fishcage','sluice','greenhouse','windturbine','pylon','conveyor','planter'];
    for (const kind of shapes) {
      const group = new THREE.Group(); addSceneGeometry(group, osmAreaGeometry(kind, 42, 3), kind);
      signature(group); disposeTree(group); checked++;
    }
    for (const kind of LEGACY_LANDMARK_TYPES) for (const seed of [1,42,1234]) {
      const a=buildLandmark(kind,mulberry32(seed),'TW',{seed}), b=buildLandmark(kind,mulberry32(seed),'TW',{seed});
      check(signature(a)===signature(b),kind+': deterministic landmark');
      const bounds=new THREE.Box3().setFromObject(a), old=a.userData.layoutBounds;
      for(let axis=0;axis<3;axis++) {
        check(Math.abs(bounds.min.getComponent(axis)-old.min[axis])<.0001,kind+': landmark minimum moved');
        check(Math.abs(bounds.max.getComponent(axis)-old.max[axis])<.0001,kind+': landmark maximum moved');
      }
      disposeTree(a);disposeTree(b);checked++;
    }
    const extras = [
      ...['streetlamp','marketlamp','signal'].map(kind=>['road/'+kind,()=>{
        const group=new THREE.Group();roadPropMeshes(group,furnitureSceneBatches(kind,5.4),[{x:0,y:0,z:0,ry:.7,s:1}]);return group;
      }]),
      ...LEGACY_LANDMARK_TYPES.map(kind => ['landmark/'+kind,()=>buildLandmark(kind,mulberry32(42),'TW',{seed:42})]),
      ...['park','pitch','lot'].map(kind => ['civic/'+kind, () => buildCivic(kind,42)]),
      ...['tank','acbox'].map(kind => ['roof/'+kind, () => buildBldBucket[kind](1)]),
      ...['S','M','L'].map(size => ['airdrop/'+size, () => buildAirdrop(size)]),
      ['loot/cash',()=>buildLoot(false,false)],['loot/ammo',()=>buildLoot(true,false)],['loot/affix',()=>buildLoot(false,true)],
      ['mine',()=>buildMineBump()],
    ];
    for(const [label, make] of extras) {
      const a=make(),b=make(); check(signature(a)===signature(b),label+': deterministic');
      if(label.startsWith('road/'))check(a.children.some(mesh=>mesh.material.emissive?.getHex()>0),label+': lost emitter');
      disposeTree(a);disposeTree(b);checked++;
    }
    for (const size of [[0,1,1], [1,NaN,1], [-1,1,1]]) {
      let rejected = false;
      try { forestSceneGeometry('banyan', 42, size); } catch { rejected = true; }
      check(rejected, 'Invalid fit accepted');
    }
    if (!snapshots) return { checked, hazards: hazards.length, plants: plants.length, areaShapes: shapes.length, views: 0 };
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#dce2d5;color:#26382e;font:16px sans-serif';
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(390, 285); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    setCelSun(new THREE.Vector3(.4,.8,.4));
    const shots = [...hazards.map(kind => [kind, () => buildHazard(kind,42,(HAZARDS[kind]?.r || 8))]),
      ...extras, ...TREE_ATTACHMENTS.map(kind => [kind, () => { const g=new THREE.Group();g.add(...buildVegMeshes(kind,[{x:0,y:0,z:0,s:1,ry:0,dj:0}],'summer'));return g; }]),
      ...shapes.map(kind=>['area/'+kind,()=>{const g=new THREE.Group();addSceneGeometry(g,osmAreaGeometry(kind,42,3),kind);return g;}]),
      ...extras.filter(([kind])=>kind.startsWith('road/')).map(([kind,make])=>[kind+'/night',make]),
      ...['birch','silvergrass','broadleaf'].map(kind=>[kind+'/winter',()=>{
        const g=new THREE.Group();g.add(...buildVegMeshes(kind,[{x:0,y:0,z:0,s:1,ry:0,dj:0}],'winter'));return g;
      }]),
      ...['broadleaf','reed','redcap'].map(kind => [kind, () => {
        const group = new THREE.Group(); group.add(...buildVegMeshes(kind,[{x:0,y:0,z:0,s:1,ry:0,dj:0}],'summer')); return group;
      }])];
    for (const [kind, make] of shots) {
      const row = document.createElement('div'); row.style.cssText='display:flex;gap:8px;padding:4px'; document.body.append(row);
      for (const angle of [0, Math.PI / 2, Math.PI]) {
        const night=kind.endsWith('/night'),model = make(), scene = new THREE.Scene();
        scene.background = new THREE.Color(night?0x15222e:0xdce2d5);
        scene.add(model, new THREE.HemisphereLight(0xffffff,0x69755c,night?.12:1));
        const sun = new THREE.DirectionalLight(0xffffff,night?.05:1.5);sun.position.set(30,50,40);scene.add(sun);
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
        const extent = Math.max(size.x,size.y,size.z), target = box.getCenter(new THREE.Vector3());
        const camera = new THREE.PerspectiveCamera(36,390/285,.02,2000);
        camera.position.set(Math.sin(angle+.6)*extent*2, target.y+extent*.4, Math.cos(angle+.6)*extent*2);
        camera.lookAt(target);camera.updateMatrixWorld();updateCelLight(camera);
        const pipeline = new Pipeline(renderer,scene,camera,{dof:false,wipe:false}); pipeline.render();
        const cell = document.createElement('div'), img = document.createElement('img');
        cell.textContent=kind;img.src=renderer.domElement.toDataURL();cell.append(img);row.append(cell);
        pipeline.dispose(); disposeTree(model);
      }
    }
    renderer.dispose();
    return { checked, hazards: hazards.length, plants: plants.length, areaShapes: shapes.length, views: shots.length*3 };
  }, { snapshots });
  if (snapshots) {
    await mkdir('tools/.shots', { recursive: true });
    await page.screenshot({ path: 'tools/.shots/scene-models.png', fullPage: true });
    const rows = page.locator('body > div');
    for (let i = 0; i < await rows.count(); i++) {
      await rows.nth(i).screenshot({ path: `tools/.shots/scene-model-${i}.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
} finally {
  await browser.close(); await server.close();
}
