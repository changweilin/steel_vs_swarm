import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath } from '../pw.mjs';
import { serve, page as generatorPage } from '../../test/architecturePreview.mjs';
import { readSrc } from '../audit_src.mjs';

const joinsOnly=process.argv.includes('--joins');
const directory=new URL('../../out/boundary_review/'+(joinsOnly?'joins/':''),import.meta.url);
await mkdir(directory,{recursive:true});
const chromium=await chromiumOrNull();
assert(chromium,'Boundary review requires an existing Playwright runtime');
const server=serve(0);
await new Promise(resolve=>server.once('listening',resolve));
const url='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await chromium.launch({executablePath:chromePath(),headless:true,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(url+'/three.mjs',route=>route.fulfill({contentType:'text/javascript',
    body:readSrc('out','forest_review','three.module.js')}));
  await page.route(url+'/public/js/**',route=>route.fulfill({contentType:'text/javascript',
    body:readSrc('public','js',new URL(route.request().url()).pathname.slice(11))}));
  await page.route(url+'/review',route=>route.fulfill({contentType:'text/html',body:
    '<html><head><style>body{margin:20px;background:#e4e9ec;font:17px sans-serif;color:#263540}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}figure{margin:0;padding:12px;background:white;border-radius:8px}img{width:100%}figcaption{padding-top:8px}</style></head><body><main></main></body></html>'}));
  await page.goto(url+'/review');
  const result=await page.evaluate(async(joinsOnly)=>{
    const THREE=await import('/three.mjs');
    const {wallParts,WALL_KINDS,buildBoundaryRunParts,boundaryJoinParts}=await import('/public/js/edgewall.js');
    const {buildSlopeBoundary}=await import('/public/js/edgeSlope.js');
    const models=[],report=[];
    const fixtures=joinsOnly ? [['citywall+cliff','城牆／懸崖'],['levee+debris-corner','河堤／崩塌地轉角'],
      ['cliff+basaltspine-corner','懸崖／玄武岩轉角'],['solarfield+windland','太陽能板／風機陣列'],
      ['solarfield+iceberg','陣列／隨機冰山'],['tetrapod+cliff','消波塊／懸崖'],
      ['solarfield+gianttree-corner','陣列／巨木轉角'],['seawall+reefchain','海堤／礁岩'],
      ['rollinghills+cliff','草丘／懸崖'],['landslide+basaltspine','山崩／玄武岩'],
      ['giantforest+solarfield','林地／陣列'],['boulder+warehousebelt','巨岩／倉儲'],
      ['rowhouse+ranch','民房／牧場'],['skyfall+giantforest','廢墟／林地'],
      ['icefloe+seaice','浮冰／碎冰帶'],['floatsolar+reefchain-corner','浮動陣列／礁岩轉角']] :
      [['citywall','城牆'],['levee','河堤與閘門'],['seawall','海堤'],
      ['tetrapod','四腳消波塊'],['cliff','懸崖峭壁'],['landslide','山崩地'],
      ['barricade','混凝土路障'],['canalbank','運河護岸'],['citywall-slope','貼坡城牆']];
    for(const [key,label] of fixtures) {
      const kind=joinsOnly?key.replace('-corner','').split('+')[0]:key.replace('-slope',''),def=WALL_KINDS[kind];
      const input={len:30,depth:def.depth,h:def.h,seed:42};
      let rows=joinsOnly?[]:key.endsWith('-slope')
        ?buildSlopeBoundary(kind,{...input,x:0,z:0,heightAt:(x,z)=>x*.28+z*.1}).parts
        :wallParts(kind,input);
      if(joinsOnly) {
        const corner=key.endsWith('-corner'),kinds=key.replace('-corner','').split('+'),len=48;
        rows=kinds.flatMap((kind,i)=>{
          const def=WALL_KINDS[kind],ry=corner&&i?Math.PI/2:0,ca=Math.round(Math.cos(ry)),sa=Math.round(Math.sin(ry));
          const fx=corner?(i?0:len/2):(i?len/2:-len/2),fz=corner&&i?len/2:0;
          const other=kinds[1-i],joins=[null,null];
          joins[corner?i:1-i]={kind:other,h:WALL_KINDS[other].h,depth:WALL_KINDS[other].depth,corner};
          const input={len,depth:def.depth,bufferDepth:32,h:def.h,seed:42+i,x:fx-sa*def.depth/2,z:fz-ca*def.depth/2,
            ry,heightAt:()=>0,bufferHeightAt:()=>0,joins};
          const batch=buildBoundaryRunParts(kind,input);
          const body=def.terrainFit&&!batch.terrainJoined
            ? [...buildSlopeBoundary(kind,input).parts,...boundaryJoinParts(kind,input)] : batch.parts;
          return [...body,...batch.bufferParts].map(p=>({...p,reviewFrame:{x:input.x,z:input.z,ry}}));
        });
      }
      const root=new THREE.Group(),parts=[];
      let triangles=0;
      for(const p of rows) {
        const [type,a,b,c,n]=p.g;
        let geometry;
        if(type==='mesh') {
          geometry=new THREE.BufferGeometry();
          geometry.setAttribute('position',new THREE.Float32BufferAttribute(a.vertices,3));
          geometry.setIndex(a.faces);
          if(a.normals)geometry.setAttribute('normal',new THREE.Float32BufferAttribute(a.normals,3));
          else geometry.computeVertexNormals();
          if(a.colors)geometry.setAttribute('color',new THREE.Float32BufferAttribute(a.colors,3));
        } else if(type==='box')geometry=new THREE.BoxGeometry(a,b,c);
        else if(type==='cyl')geometry=new THREE.CylinderGeometry(a,b,c,n||6);
        else if(type==='cone')geometry=new THREE.ConeGeometry(a,b,c||6);
        else geometry=new THREE.IcosahedronGeometry(a,0);
        const material=new THREE.MeshStandardMaterial({color:p.c??0xffffff,roughness:.88,
          vertexColors:!!geometry.attributes.color});
        const mesh=new THREE.Mesh(geometry,material);
        mesh.position.fromArray(p.p||[0,0,0]);
        mesh.rotation.set(...(p.r||[0,0,0]));mesh.scale.fromArray(p.s||[1,1,1]);
        if(p.reviewFrame) {
          const f=p.reviewFrame,m=new THREE.Matrix4().makeRotationY(f.ry);
          m.setPosition(f.x,0,f.z);mesh.applyMatrix4(m);
        }
        root.add(mesh);root.updateMatrixWorld(true);
        const data=geometry.clone().applyMatrix4(mesh.matrixWorld);
        const faces=data.index?Array.from(data.index.array):Array.from({length:data.attributes.position.count},(_,i)=>i);
        triangles+=faces.length/3;
        parts.push({vertices:Array.from(data.attributes.position.array),faces,
          normals:Array.from(data.attributes.normal.array),
          colors:data.attributes.color?Array.from(data.attributes.color.array):null,color:material.color.toArray()});
        data.dispose();
      }
      models.push({key,parts});report.push({key,triangles});
      const scene=new THREE.Scene();scene.background=new THREE.Color(0xd8e1e6);scene.add(root);
      scene.add(new THREE.HemisphereLight(0xffffff,0x8794a0,2));
      const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-18,40,30);scene.add(light);
      const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),target=box.getCenter(new THREE.Vector3());
      const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0xa1adb2,roughness:1}));
      floor.rotation.x=-Math.PI/2;floor.position.y=joinsOnly?0:box.min.y-.06;scene.add(floor);
      const camera=new THREE.PerspectiveCamera(35,1.4,.1,1000);
      camera.position.copy(target).add(new THREE.Vector3(size.x*.78,size.y*.8+12,size.x*1.25+size.z));
      camera.lookAt(target);
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
      renderer.setSize(560,400);renderer.setPixelRatio(1);
      renderer.render(scene,camera);
      const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');
      img.src=renderer.domElement.toDataURL();caption.textContent=label+' · '+triangles.toLocaleString()+' triangles';
      figure.append(img,caption);document.querySelector('main').append(figure);
      scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();
    }
    return {models,report};
  },joinsOnly);
  assert.deepEqual(errors,[]);
  await writeFile(new URL('review.json',directory),JSON.stringify({models:result.models}));
  await page.screenshot({path:fileURLToPath(new URL('game-models.png',directory)),fullPage:true});
  if(!joinsOnly) {
    await page.route(url+'/',route=>route.fulfill({contentType:'text/html',body:generatorPage}));
    await page.route(url+'/preview/geographicPreview.js',route=>route.fulfill({contentType:'text/javascript',
      body:readSrc('test','geographicPreview.js')}));
    for(const [routeName,file] of [['utils.mjs','utils_BufferGeometryUtils.js'],['pass.mjs','postprocessing_Pass.js']])
      await page.route(url+'/'+routeName,route=>route.fulfill({contentType:'text/javascript',body:readSrc('out','forest_review',file)}));
    await page.goto(url+'/');
    await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:30000});
    await page.locator('#tab-btn-env').click();
    await page.locator('#env-view-mode').selectOption('single');
    for(const kind of ['citywall','levee','tetrapod','cliff']) {
      await page.locator('#env-kind').selectOption(kind);
      const status=await page.locator('#nav-status').textContent();
      assert(!status.includes('NaN'));
      await page.screenshot({path:fileURLToPath(new URL('generator-'+kind+'.png',directory))});
    }
    assert.deepEqual(errors,[]);
  }
  console.log(JSON.stringify(result.report));
} finally {await browser?.close();server.close();}
