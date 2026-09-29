import * as THREE from 'three';
import { chooseArchitecture } from './buildingDiversity.js';
import { BUILDING_FUNCTIONS } from './buildingFunctions.js';
import { architecturalFacadeParts } from './architectureFacadeParts.js';
import { functionalBuildingParts } from './functionalBuildingParts.js';
import { compileSceneParts, fitSceneGeometry, scenePartGeometry } from './scenePropModels.js';
import { sceneRod } from './sceneAttachmentParts.js';
import { envMat } from './toon.js';

const FACADES = new Set(['hospital','school','station','temple','church','mosque','museum','factory','castle','shrine','mandir','synagogue','gurdwara']);

function facadeGeometry(kind, seed, size, color) {
  const [w,h,d] = size, type = kind;
  const spec = BUILDING_FUNCTIONS[type];
  const style = chooseArchitecture(seed, `landmark/${kind}`, {
    functionInfo: { type, key: spec.range, category: spec.category, locked: true },
    building: { tags: { height: h } },
  });
  // The established silhouette supplies the mass; windows and cultural details share the map-building seam.
  style.wall = color;
  const points = [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
  const edges = points.map((a,i) => {
    const b=points[(i+1)%4], dx=b[0]-a[0], dz=b[1]-a[1];
    return {x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,y:0,h,hw2:Math.hypot(dx,dz)/2,hd2:.06,ry:Math.atan2(dz,dx)};
  });
  return compileSceneParts([{g:['box',w,h,d],p:[0,h/2,0],c:color},
    ...architecturalFacadeParts(edges,style,.1),...functionalBuildingParts(edges,0,h,style).parts]);
}

function masonryGeometry(size, color) {
  const [w,h,d]=size, rows=[{g:['box',w*.985,h,d*.985],c:color}], course=Math.max(.22,Math.min(.65,h/7));
  for(const sign of [-1,1])rows.push({g:['box',w,.02,d],p:[0,sign*(h/2-.01),0],c:color});
  const shade = new THREE.Color(color).multiplyScalar(.88).getHex();
  for(let y=-h/2+course;y<h/2;y+=course) {
    for(const side of [-1,1]) {
      rows.push({g:['box',w,.025,.025],p:[0,y,side*(d/2-.0125)],c:shade},
        {g:['box',.025,.025,d],p:[side*(w/2-.0125),y,0],c:shade});
    }
  }
  return compileSceneParts(rows);
}

function boxFrame(geometry) {
  const {width:w,height:h,depth:d}=geometry.parameters, p=geometry.attributes.position;
  // BoxGeometry retains face UV ordering after rotate/translate; the first face is +X.
  const frame = new THREE.BoxGeometry(w,h,d), raw=frame.attributes.position;
  const corner=(x,y,z)=>{
    for(let i=0;i<raw.count;i++)if(Math.abs(raw.getX(i)-x)<1e-5&&Math.abs(raw.getY(i)-y)<1e-5&&Math.abs(raw.getZ(i)-z)<1e-5)
      return new THREE.Vector3().fromBufferAttribute(p,i);
    throw new Error('Missing box corner');
  };
  const c=corner(w/2,h/2,d/2), x=c.clone().sub(corner(-w/2,h/2,d/2)).divideScalar(w),
    y=c.clone().sub(corner(w/2,-h/2,d/2)).divideScalar(h),z=c.clone().sub(corner(w/2,h/2,-d/2)).divideScalar(d);
  frame.dispose();
  return new THREE.Matrix4().makeBasis(x,y,z).setPosition(c.addScaledVector(x,-w/2).addScaledVector(y,-h/2).addScaledVector(z,-d/2));
}

function curvedRoof(radius, height, sides) {
  const points = [[0,-height/2],[radius,-height/2],[radius*.84,-height*.42],
    [radius*.54,-height*.18],[radius*.27,height*.16],[0,height/2]];
  // Lathe and ConeGeometry share the angular origin, preserving the original roof corners.
  return scenePartGeometry({g:['lathe',points,sides]});
}

function saddleRoof(width, length, rise) {
  const vertices=[], faces=[], along=20, across=12;
  for(let layer=0;layer<2;layer++)for(let j=0;j<=along;j++)for(let i=0;i<=across;i++) {
    const u=i/across*2-1, t=j/along*2-1;
    vertices.push(u*width/2,t*length/2,rise*(Math.abs(u)**1.4-t*t)+layer*.14);
  }
  const stride=across+1, surface=(along+1)*stride;
  for(let j=0;j<along;j++)for(let i=0;i<across;i++) {
    const a=j*stride+i,b=a+1,c=a+stride,d=c+1;
    faces.push(a,c,b,b,c,d,a+surface,b+surface,c+surface,b+surface,d+surface,c+surface);
  }
  const rim=[];
  for(let i=0;i<=across;i++)rim.push(i);
  for(let j=1;j<=along;j++)rim.push(j*stride+across);
  for(let i=across-1;i>=0;i--)rim.push(along*stride+i);
  for(let j=along-1;j>0;j--)rim.push(j*stride);
  for(let i=0;i<rim.length;i++) {
    const a=rim[i],b=rim[(i+1)%rim.length];
    faces.push(a,b,a+surface,b,b+surface,a+surface);
  }
  return scenePartGeometry({g:['mesh',{vertices,faces}]});
}

/** Replace visual surfaces inside each existing local envelope. Placement RNG and collision measurement stay stable. */
export function rebuildLandmarkGeometry(group, kind, seed) {
  let index=0;
  const retired = new Set();
  group.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.isOutline || Array.isArray(mesh.material)) return;
    const old=mesh.geometry, p=old.parameters, material=mesh.material;
    if (!p || material.userData?.celOpts?.soft) return;
    old.computeBoundingBox();
    const bounds=old.boundingBox.clone(), size=bounds.getSize(new THREE.Vector3()), center=bounds.getCenter(new THREE.Vector3());
    const bakedBox=old.type==='BoxGeometry' ? boxFrame(old) : null;
    const dims=bakedBox ? [p.width,p.height,p.depth] : size.toArray(), color=material.color.getHex();
    let geometry=null, colored=false;
    if (old.type==='BoxGeometry' && Math.min(p.width,p.depth)>3 && p.height>3 && FACADES.has(kind)) {
      geometry=facadeGeometry(kind,seed+index,dims,color);colored=true;
    } else if (old.type==='BoxGeometry' && Math.min(p.width,p.depth)>1.5 && p.height>1.2) {
      geometry=masonryGeometry(dims,color);colored=true;
    } else if (old.type==='ConeGeometry' && p.radius>1 && p.height>1) {
      geometry=curvedRoof(p.radius,p.height,p.radialSegments);
    } else if (kind==='tongkonan' && old.type==='CylinderGeometry' && p.radiusTop>4 && p.height>20) {
      geometry=saddleRoof(p.radiusTop*2,p.height,p.radiusTop);
    } else if (old.type==='CylinderGeometry' && material.wireframe) {
      const rows=[], n=p.radialSegments, h=p.height;
      for(let y=-h/2;y<h/2-.01;y+=h/10) for(let i=0;i<n;i++) {
        const top=Math.min(h/2,y+h/10), a=i*Math.PI*2/n, b=(i+1)*Math.PI*2/n;
        const r=p.radiusBottom+(p.radiusTop-p.radiusBottom)*(y/h+.5), rt=p.radiusBottom+(p.radiusTop-p.radiusBottom)*(top/h+.5);
        const at=(angle,radius,level)=>[Math.sin(angle)*radius,level,Math.cos(angle)*radius];
        rows.push(sceneRod(at(a,r,y),at(a,rt,top),.055,color),sceneRod(at(a,r,y),at(b,r,y),.04,color),
          sceneRod(at(a,r,y),at(b,rt,top),.03,color));
      }
      geometry=compileSceneParts(rows);colored=true;
    } else if (old.type==='CylinderGeometry' && p.thetaLength===Math.PI*2 && Math.max(p.radiusTop,p.radiusBottom)>.6 && p.height>1) {
      const r=(t)=>p.radiusBottom+(p.radiusTop-p.radiusBottom)*t;
      geometry=scenePartGeometry({g:['lathe',[[0,-p.height/2],[r(0),-p.height/2],[r(.05),-p.height*.45],
        [r(.07)*.95,-p.height*.43],[r(.92)*.95,p.height*.42],[r(.94),p.height*.44],[r(1),p.height/2],[0,p.height/2]],p.radialSegments]});
    } else if (old.type==='SphereGeometry') {
      geometry=new THREE.SphereGeometry(p.radius,24,16,p.phiStart,p.phiLength,p.thetaStart,p.thetaLength);
    }
    index++;
    if (!geometry) return;
    fitSceneGeometry(geometry,dims);
    if(bakedBox)geometry.translate(0,-p.height/2,0).applyMatrix4(bakedBox);
    else geometry.translate(center.x,bounds.min.y,center.z);
    mesh.geometry=geometry;old.dispose();
    if (colored) {
      retired.add(mesh.material);
      mesh.material=envMat(0xffffff,{vertexColors:true,wash:.4,cool:.4,rim:.035});
    }
  });
  group.traverse(mesh => { if (mesh.isMesh) retired.delete(mesh.material); });
  for (const material of retired) material.dispose();
  return group;
}
