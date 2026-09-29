import { sceneRod } from './sceneAttachmentParts.js';

// Metre-space visual parts; callers own siting, collision and scaling.
const box = (w, h, d, x, y, z, c) => ({ g: ['box', w, h, d], p: [x, y, z], c });
const cyl = (rt, rb, h, x, y, z, c) => ({ g: ['cyl', rt, rb, h, 12], p: [x, y, z], c });
const lathe = (profile, x, y, z, c) => ({ g: ['lathe', profile, 20], p: [x, y, z], c });
const steel = 0x4e5e61, concrete = 0xaaa697, wood = 0x99734c, light = 0xdedbc8;

export function sceneFurnitureParts(kind) {
  const parts = [];
  const add = (...rows) => parts.push(...rows);
  if (kind === 'bench') {
    for (let i = 0; i < 5; i++) add(box(2.6, .07, .105, 0, .85, (i - 2) * .13, wood));
    for (let i = 0; i < 3; i++) add(box(2.6, .11, .055, 0, 1.02 + i * .15, -.31, wood));
    for (const x of [-.95, .95]) {
      add(box(.09, .82, .09, x, .41, -.24, steel), box(.09, .82, .09, x, .41, .24, steel),
        box(.09, .09, .65, x, .78, 0, steel), box(.09, .65, .07, x, 1.05, -.34, steel),
        box(.12, .07, .48, x, 1.13, 0, steel));
    }
  } else if (kind === 'goal') {
    for (const x of [-2.4, 2.4]) {
      add(cyl(.065, .065, 2.5, x, 1.25, 0, light), box(.08, .08, 1.4, x, .04, -.66, light));
    }
    add(box(4.9, .13, .13, 0, 2.5, 0, light), box(4.9, .08, .08, 0, .04, -1.3, steel));
    for (let i = 0; i <= 12; i++) add(box(.016, 2.3, .016, -2.4 + i * .4, 1.15, -1.3, 0x8e9a8b));
    for (let i = 1; i < 6; i++) add(box(4.8, .016, .016, 0, i * .4, -1.3, 0x8e9a8b));
  } else if (kind === 'tank') {
    add(lathe([[0,0],[2.8,0],[3,.18],[3,4.5],[2.9,4.7],[.45,5.1],[0,5.1]], 0, 0, 0, 0x879a99));
    for (const y of [.2, 1.7, 3.2, 4.5]) add(lathe([[2.99,0],[3.04,0],[3.04,.07],[2.99,.07]], 0, y, 0, light));
    add(cyl(.4, .4, .18, 0, 5.12, 0, steel));
    for (const x of [-.3, .3]) add(cyl(.035,.035,4.7,x,2.35,3.08,steel));
    for (let i=1;i<13;i++) add(box(.66,.035,.07,0,i*.36,3.08,steel));
  } else if (kind === 'barrier') {
    add({ g: ['mesh', { vertices: [-2,0,-.4,2,0,-.4,2,0,.4,-2,0,.4,
      -2,.45,-.24,2,.45,-.24,2,.45,.24,-2,.45,.24,
      -2,1.1,-.13,2,1.1,-.13,2,1.1,.13,-2,1.1,.13],
      faces: [0,2,1,0,3,2,8,9,10,8,10,11,0,1,5,0,5,4,4,5,9,4,9,8,
        3,7,6,3,6,2,7,11,10,7,10,6,0,4,7,0,7,3,4,8,11,4,11,7,1,2,6,1,6,5,5,6,10,5,10,9]}, [4,1.1,.8]],
      p: [0,0,0], c: concrete });
    for (const side of [-1,1]) for(let i=0;i<5;i++) add(box(.35,.17,.025,-1.6+i*.8,.91,side*.15,i%2?0xe6c362:0x665c46));
    for (const x of [-1.6,1.6]) add(box(.3,.06,.9,x,.03,0,steel));
  } else if (kind === 'signal' || kind === 'streetlamp' || kind === 'marketlamp') {
    const lamp = kind !== 'signal';
    add(cyl(.07,.13,4.8,0,2.4,0,steel),cyl(.22,.27,.16,0,.08,0,concrete));
    if (lamp) {
      add(box(1.3,.08,.09,.6,4.7,0,steel),box(.68,.15,.33,1.12,4.61,0,steel),
        {...box(.56,.025,.26,1.12,4.52,0,0xffe2a0),e:0xffe2a0});
      if(kind==='marketlamp')add({...box(.42,.55,.42,1.12,4.22,0,0xb04a34),e:0xffa65b});
    } else {
      add(box(.65,1.45,.35,.28,4.1,0,steel));
      for (let i=0;i<3;i++) {
        const disc=cyl(.18,.18,.055,.28,4.57-i*.45,.205,[0xb04b3d,0xd3ac43,0x518967][i]);
        disc.r=[Math.PI/2,0,0];disc.e=disc.c;add(disc);
        add(box(.5,.055,.3,.28,4.78-i*.45,.25,steel));
      }
    }
  } else if (kind === 'buoy') {
    add(lathe([[0,0],[.6,.04],[.75,.22],[.65,.5],[.3,.68],[.25,1.3],[0,1.3]],0,0,0,0xc9683b),
      cyl(.04,.055,1,0,1.7,0,steel),cyl(.15,.15,.22,0,2.2,0,0xdfb755));
    for (const y of [.8,1.0]) add(cyl(.255,.255,.1,0,y,0,light));
  } else if (kind === 'marker') {
    add(box(1,.14,.65,0,.07,0,0x85887d),box(.8,.12,.42,0,.2,0,concrete),
      lathe([[0,0],[.32,0],[.32,.9],[.25,1.08],[0,1.15]],0,.25,0,concrete));
    for(let i=0;i<3;i++)add(box(.32-i*.04,.025,.025,0,.7+i*.14,.325,0x666b66));
  } else if (kind === 'solar') {
    add(box(2.5,.09,1.5,0,.8,0,steel),box(2.38,.02,1.38,0,.858,0,0x25445d));
    for(let i=1;i<6;i++)add(box(.015,.025,1.38,-1.19+i*.397,.87,0,0x78979f));
    add(box(2.38,.025,.015,0,.87,0,0x78979f));
    for(const x of [-.9,.9])add(box(.08,.75,.08,x,.375,0,steel),box(.5,.1,.35,x,.05,0,concrete));
  } else if (kind === 'transformer') {
    add(box(4.5,.2,3.2,0,.1,0,concrete),box(3.2,2.8,2.1,0,1.6,0,0x687e79));
    for(const side of [-1,1])for(let i=0;i<12;i++)add(box(.3,2.1,.09,side*1.68,1.5,-.9+i*.16,steel));
    for(const x of [-.9,0,.9]) {
      add(cyl(.09,.15,1.2,x,3.45,0,0x695745));
      for(let i=0;i<5;i++)add(cyl(.23,.25,.08,x,3.1+i*.16,0,0x87735e));
    }
  } else if (kind === 'acbox') {
    add(box(2.4,1.25,1.5,0,.8,0,0xb0b9b7),box(2.5,.12,1.6,0,1.46,0,steel));
    for(const x of [-.85,.85]) add(box(.16,.22,1.55,x,.11,0,steel));
    for(const x of [-.63,.63]) {
      add(cyl(.48,.48,.06,x,1.55,0,steel),cyl(.14,.14,.08,x,1.6,0,light));
      for(let i=0;i<4;i++) {
        const blade=box(.75,.025,.055,x,1.59,0,0x9aa7a5);blade.r=[0,i*Math.PI/4,0];add(blade);
      }
    }
    for(let i=0;i<9;i++)add(box(2.1,.035,.035,0,.37+i*.105,.768,steel));
    add(box(.3,.55,.06,.87,.8,-.78,steel));
  } else if (kind === 'antenna') {
    add(cyl(.07,.14,5,0,2.5,0,steel),box(.5,.12,.5,0,.06,0,concrete));
    for(let i=0;i<5;i++) {
      add(box(1.4-i*.15,.035,.035,0,3.5+i*.28,0,light));
      for(const x of [-.35,.35])add(box(.035,1.3,.035,x,3.95,0,steel));
    }
    add(cyl(.09,.09,.16,0,5.03,0,0xc65742));
  } else if (kind === 'cone') {
    add(box(.65,.08,.65,0,.04,0,steel),
      lathe([[.26,0],[.26,.06],[.07,.68],[.04,.71],[0,.71]],0,.08,0,0xd97439),
      lathe([[.142,0],[.153,0],[.12,.12],[.109,.12]],0,.43,0,light));
  } else if (kind === 'scaffold') {
    for(const x of [-1,1])for(const z of [-1,1]) {
      add(cyl(.045,.045,3.5,x,1.75,z,steel),box(.3,.05,.3,x,.025,z,steel));
    }
    for(const y of [1.65,3.25]) {
      for(let i=0;i<5;i++)add(box(2.2,.065,.36,0,y,(i-2)*.4,wood));
      for(const z of [-1,1])add(box(2,.055,.055,0,y-.13,z,steel));
    }
    for(const z of [-1,1])for(const sign of [-1,1]) {
      const brace=box(.045,Math.hypot(2,3.1),.045,0,1.6,z,steel);
      brace.r=[0,0,sign*Math.atan2(2,3.1)];add(brace);
    }
    for(let i=0;i<10;i++)add(box(.55,.04,.07,-1, .25+i*.31,0,steel));
    for(const x of [-1.275,-.725])add(cyl(.035,.035,3.4,x,1.7,0,steel));
  } else if (kind === 'pond') {
    add(lathe([[3.6,0],[4,0],[4,.4],[3.6,.4],[3.6,0]],0,0,0,concrete),cyl(3.61,3.61,.06,0,.2,0,0x59848b));
    for(let i=0;i<24;i++) {
      const a=i*Math.PI/12, p=box(.035,.035,.4,Math.cos(a)*3.8,.42,Math.sin(a)*3.8,steel);
      p.r=[0,-a+Math.PI/2,0];add(p);
    }
  } else if (kind === 'gazeboRoof') {
    const roof=lathe([[0,2.4],[.3,2.3],[1.5,1.2],[3.7,.25],[4.6,.12],[4.55,0],[3.6,.12],[1.4,1.08],[0,2.3]],0,0,0,0x955e42);
    roof.g[2]=6;add(roof);
    for(let i=0;i<6;i++) {
      const a=i*Math.PI/3;
      add(sceneRod([0,2.4,0],[Math.cos(a)*4.6,.12,Math.sin(a)*4.6],.06,0x684b3e));
    }
  } else if (kind === 'stand') {
    add(box(10,.65,2.8,0,.325,0,concrete));
    for(let i=0;i<14;i++) {
      const x=(i-6.5)*.68;
      add(box(.54,.1,.6,x,.76,-.6,0x637f86),box(.54,.35,.09,x,.9,-.91,0x537078),box(.07,.15,.5,x,.7,-.6,steel));
    }
    add(box(10,.06,.18,0,.67,1.25,light));
  } else if (kind === 'relay') {
    add(cyl(2.4,2.8,.7,0,.35,0,concrete));
    const level = y => 1.15 - y * .105;
    for(let y=.65;y<7.6;y+=1.35) {
      const top=Math.min(7.8,y+1.35), r=level(y), rt=level(top);
      for(let i=0;i<4;i++) {
        const a=i*Math.PI/2, b=a+Math.PI/2;
        const p=[Math.cos(a)*r,y,Math.sin(a)*r], q=[Math.cos(a)*rt,top,Math.sin(a)*rt];
        add(sceneRod(p,q,.055,steel),sceneRod(p,[Math.cos(b)*r,y,Math.sin(b)*r],.04,steel),
          sceneRod(p,[Math.cos(b)*rt,top,Math.sin(b)*rt],.03,steel));
      }
    }
    add(box(1.2,.08,1.2,0,6.6,0,steel),box(1.2,.8,.7,1.25,1.1,0,0x718383));
    const dish=lathe([[0,0],[.35,.04],[.8,.2],[1.25,.55],[1.28,.6],[1.23,.62],[.78,.25],[.3,.09],[0,.06]],0,6.95,.25,light);
    dish.r=[.9,0,0];add(dish,sceneRod([0,6.8,0],[0,7.4,1.3],.04,steel),cyl(.2,.2,.18,0,7.88,0,light));
  } else if (kind === 'aasite') {
    for(let i=0;i<16;i++)for(let row=0;row<2;row++) {
      if(i===3||i===4)continue;
      const a=(i+row*.45)*Math.PI/8;
      add({g:['ico',1],p:[Math.cos(a)*4.3,.28+row*.45,Math.sin(a)*4.3],s:[.63,.28,.37],
        r:[0,-a+Math.PI/2,0],c:i%2?0x9d946e:0x827e5d});
    }
    add(box(2.4,.35,2,0,.175,0,steel),cyl(.7,.8,.45,0,.55,0,0x647256),
      box(2.2,.3,1.3,0,.85,0,0x526147));
    for(const x of [-.65,0,.65]) {
      const start=[x,.88,.4], end=[x,2.9,-2.1];
      add(sceneRod(start,end,.24,0x465340),sceneRod([x-.23,.9,.2],[x-.23,1.95,-.9],.055,steel));
      for(const t of [.15,.8]) {
        const p=start.map((v,i)=>v+(end[i]-v)*t), q=start.map((v,i)=>v+(end[i]-v)*(t+.035));
        add(sceneRod(p,q,.27,0x89917b));
      }
      add({g:['ico',.23],p:end,s:[1,1,1],c:0xb0b59e});
    }
    for(const x of [-3.4,3.4])for(const z of [-2.8,2.8])add(sceneRod([x,0,z],[x,3.3,z],.055,wood));
    for(const x of [-3.4,3.4])add(sceneRod([x,3.2,-2.8],[x,3.2,2.8],.04,wood));
    const netPoint=(i,j)=>[-3.4+i*6.8/13,3.2-.4*Math.sin(i/13*Math.PI)*Math.sin(j/9*Math.PI),-2.8+j*5.6/9];
    for(let i=0;i<14;i++)for(let j=0;j<10;j++) {
      const p=netPoint(i,j);
      if(i)add(sceneRod(netPoint(i-1,j),p,.012,0x62754c));
      if(j)add(sceneRod(netPoint(i,j-1),p,.012,0x62754c));
      if((i*3+j*7)%4===0)continue;
      const [x,y,z]=p;
      add(box(.58,.025,.36,x,y,z,(i+j)%3===0?0x9b9767:0x526b49));
    }
  } else if (kind === 'crate') {
    add(box(1.4,1.1,1.3,0,.63,0,0x67795a),box(1.48,.14,1.38,0,1.25,0,steel));
    for(const x of [-.5,.5]) {
      add(box(.12,1.16,1.36,x,.66,0,0xac9d6e),box(.18,.1,1.4,x,.05,0,steel));
      for(const z of [-.68,.68])add(box(.21,.24,.04,x,1.04,z,light));
    }
    for(const z of [-.67,.67]) {
      add(box(.42,.04,.06,0,.8,z,steel),box(.055,.2,.06,-.19,.88,z,steel),box(.055,.2,.06,.19,.88,z,steel));
    }
  } else throw new RangeError('Unknown scene furniture: '+kind);
  return parts;
}
