export const TREE_ATTACHMENTS = Object.freeze(['gnest', 'epiphyte', 'antnest', 'beehive', 'branch', 'vinebranch', 'treehouse', 'vine']);

const box = (w, h, d, x, y, z, c) => ({ g: ['box', w, h, d], p: [x, y, z], c });
const ellipsoid = (r, p, s, c) => ({ g: ['ico', r], p, s, c });
const lathe = (profile, p, c) => ({ g: ['lathe', profile, 16], p, c });

// Euler XYZ with rx = 0 aligns the local Y axis to the measured endpoints.
export function sceneRod(a, b, radius, color, endRadius = radius) {
  const [dx, dy, dz] = b.map((v, i) => v - a[i]), h = Math.hypot(dx, dy, dz);
  if (!(h > 0)) throw new RangeError('A scene rod needs distinct endpoints');
  return { g: ['cyl', endRadius, radius, h, 8], p: a.map((v, i) => (v + b[i]) / 2),
    r: [0, Math.atan2(-dz, dx), -Math.acos(Math.max(-1, Math.min(1, dy / h)))], c: color };
}

export function treeAttachmentParts(kind) {
  if (!TREE_ATTACHMENTS.includes(kind)) throw new RangeError('Unknown tree attachment: ' + kind);
  const rows = [], wood = 0x73543a, leaf = 0x4d7539;
  if (kind !== 'treehouse' && kind !== 'vine') {
    rows.push(sceneRod([0, -.15, 0], [2.6, .3, 0], .24, wood, .08));
    for (const side of [-1, 1]) {
      rows.push(sceneRod([1.35, .08, 0], [2.25, .5, side * .6], .1, wood, .025),
        ellipsoid(.6, [2.3, .53, side * .6], [1, .6, .8], leaf));
    }
  }
  if (kind === 'gnest') {
    rows.push(lathe([[0, 0], [.4, 0], [.72, .2], [.8, .48], [.66, .51], [.55, .25], [0, .18]], [1.2, .05, 0], wood));
    for (let i = 0; i < 22; i++) {
      const a = i * Math.PI * 2 / 22, b = a + .6, r = .69;
      rows.push(sceneRod([1.2 + Math.cos(a)*r, .3 + i%3*.055, Math.sin(a)*r],
        [1.2 + Math.cos(b)*r, .36 + i%3*.055, Math.sin(b)*r], .022, i%2 ? 0xa18558 : 0x59432d));
    }
    for (const [x,z] of [[1,0],[1.4,.1],[1.18,-.23]]) rows.push(ellipsoid(.18,[x,.36,z],[.8,1.2,.8],0xece3c8));
    rows.push(ellipsoid(.22,[1.75,.7,-.32],[.8,1.1,1.4],0x64777e),
      ellipsoid(.13,[1.75,.96,-.26],[1,1,1],0x465861),
      {g:['cone',.075,.18,6],p:[1.75,.95,-.1],r:[Math.PI/2,0,0],c:0xbf9a54});
  } else if (kind === 'epiphyte') {
    rows.push(ellipsoid(.48,[1.2,.12,0],[1,.5,1],0x594b31));
    for (let i = 0; i < 12; i++) {
      const a=i*Math.PI/6, vertices=[], faces=[];
      for(let j=0;j<6;j++) {
        const t=j/5, spread=t*1.1, y=.2+Math.sin(t*Math.PI*.7)*1.3, w=Math.sin(t*Math.PI)*.15;
        for(const side of [-1,0,1]) vertices.push(1.2+Math.cos(a)*spread-Math.sin(a)*w*side,
          y+(side===0?.04:0),Math.sin(a)*spread+Math.cos(a)*w*side);
        if(j)for(let k=0;k<2;k++){const n=(j-1)*3+k;faces.push(n,n+3,n+1,n+1,n+3,n+4);}
      }
      const count=vertices.length/3, reverse=faces.slice();vertices.push(...vertices.map((v,j)=>j%3===1?v-.006:v));
      for(let j=0;j<reverse.length;j+=3)faces.push(reverse[j]+count,reverse[j+2]+count,reverse[j+1]+count);
      rows.push({g:['mesh',{vertices,faces}],c:i%2?0x5d873c:leaf});
    }
  } else if (kind === 'antnest' || kind === 'beehive') {
    const hive=kind==='beehive', y=hive?-1.5:-.55, x=1.25;
    rows.push(lathe([[0,0],[.25,.05],[.52,.3],[.6,.65],[.44,1.05],[.2,1.35],[0,1.5]], [x,y,0],hive?0xb39662:0x695038));
    for(let i=1;i<7;i++) {
      const yy=i*.19, r=.6*Math.sin(yy/1.5*Math.PI)+.02;
      rows.push({g:['torus',r,.025,5,16],p:[x,y+yy,0],r:[Math.PI/2,0,0],c:hive?0x8c754e:0x4e3d2c});
    }
    rows.push(ellipsoid(.1,[x,y+.35,.48],[1,.65,.25],0x30271f));
  } else if (kind === 'treehouse') {
    for(let i=0;i<11;i++)rows.push(box(.3,.16,3.6,(i-5)*.33,0,0,wood));
    for(const x of [-1.1,1.1])for(const z of [-1,1])rows.push(box(.13,1.9,.13,x,1,z,0x564231));
    for(let i=0;i<6;i++) {
      const y=.3+i*.27;
      rows.push(box(2.2,.24,.12,0,y,-1,0x9a7852));
      for(const x of [-1.1,1.1])rows.push(box(.12,.24,2,x,y,0,0x98704b));
      for(const x of [-.85,.85])rows.push(box(.5,.24,.12,x,y,1,0x9a7852));
    }
    for(const side of [-1,1]) {
      const roof=box(1.9,.14,2.5,side*.66,2.27,0,0x665749);roof.r=[0,0,-side*.48];rows.push(roof);
      rows.push(sceneRod([side*1.6,-.12,0],[side*.45,-1.4,0],.1,wood));
      rows.push(sceneRod([side*.35,-4.65,1.5],[side*.35,0,1.5],.05,wood));
    }
    for(let i=0;i<12;i++)rows.push(box(.8,.07,.1,0,-.25-i*.37,1.5,0xaa8557));
    rows.push(box(.75,.12,.3,0,.15,1.1,wood));
  }
  if(kind==='vine'||kind==='vinebranch') {
    const length=kind==='vine'?7:3.2, x=kind==='vine'?0:1.8;
    let previous=[x,.1,0];
    for(let i=1;i<=12;i++) {
      const t=i/12, next=[x+Math.sin(t*8)*.13,-length*t,Math.sin(t*5)*.12];
      rows.push(sceneRod(previous,next,.035,0x6c7141));
      for(const side of [-1,1])rows.push(ellipsoid(.19,[next[0]+side*.14,next[1]+.09,next[2]],[1,.4,.7],leaf));
      previous=next;
    }
  }
  return rows;
}
