// Fixed representative ensembles, using the shared stoneBuilder triangle/solid emitters.
// These are art-direction proportions, not archaeological measured reconstructions.
const TAU = Math.PI*2;

// Revolved profiles cover curved walls, tapering towers and domes through one mesh path.
function revolve(g,x,y,z,profile,{segments=24,start=0,end=TAU,sx=1,sz=1}={}) {
  for(let row=0;row<profile.length-1;row++) for(let i=0;i<segments;i++) {
    const a=start+(end-start)*i/segments,b=start+(end-start)*(i+1)/segments;
    const point=([r,h],angle)=>[x+r*Math.cos(angle)*sx,y+h,z+r*Math.sin(angle)*sz];
    g.quad(point(profile[row],a),point(profile[row+1],a),point(profile[row+1],b),point(profile[row],b));
  }
}
function ring(g,x,y,z,r,h,t,options={}) {
  revolve(g,x,y,z,[[r,0],[r,h],[r-t,h],[r-t,0]],options);
}
function dome(g,x,y,z,r,h) {
  const profile=Array.from({length:9},(_,i)=>[r*Math.cos(i/8*Math.PI/2),h*Math.sin(i/8*Math.PI/2)]);
  revolve(g,x,y,z,profile);
}
function taperTower(g,x,y,z,r,h) {
  revolve(g,x,y,z,[[r,0],[r*.75,h],[r*.55,h],[r*.7,0]]);
}
function portal(g,x,y,z,w,h) {
  g.box(x-w*.4,y,z,w*.2,h,1.5);g.box(x+w*.4,y,z,w*.2,h,1.5);
  g.box(x,y+h-1,z,w,1,1.5);
}
function tPillar(g,x,y,z,h,angle=0) {
  g.box(x,y,z,.9,h,1,angle);g.box(x,y+h,z,2.7,.8,1,angle);
}
function stupa(g,x,y,z,r,h) {
  g.column(x,y,z,r*1.1,.6);dome(g,x,y+.6,z,r,h);
  g.box(x,y+h+.6,z,r*.5,.6,r*.5);g.column(x,y+h+1.2,z,.15,1.8,8);
  for(let i=0;i<3;i++) g.column(x,y+h+1.3+i*.5,z,r*(.3-i*.06),.15,12);
}
function rockCourt(g,{w=36,d=34,h=14}={}) {
  // Rock remains around a genuinely open excavation; all vertices stay above the local datum.
  g.box(0,0,0,w,1,d);
  g.frustum(-w/2+3,1,0,6,h,d,5,d-2);
  g.frustum(w/2-3,1,0,6,h,d,5,d-2);
  g.frustum(0,1,-d/2+3,w-12,h,6,w-14,5);
}

export const REGIONAL_STONE_BUILDERS = {
  great_zimbabwe(g) {
    ring(g,0,0,0,25,9,2.4,{sx:1.2,sz:.85,start:.15,end:TAU-.15,segments:48});
    ring(g,0,0,0,19,6,1.4,{sx:1.2,sz:.85,start:.3,end:4.5,segments:32});
    revolve(g,12,0,4,[[4.5,0],[1.6,11],[0,11]]);
    for(const [x,z] of [[-12,-5],[-4,-9],[-10,6]]) ring(g,x,0,z,3,1.2,.5);
  },
  lalibela(g) {
    rockCourt(g);
    g.box(0,1,0,5,11,15);g.box(0,1,0,15,11,5);
    for(const z of [-5,5]) for(const x of [-2.55,2.55]) g.box(x,6,z,.12,1.5,.7,0,0x473c37);
    for(const size of [3,2,1]) {
      g.box(0,12.01,0,size*.45,.05,size*2);g.box(0,12.01,0,size*2,.05,size*.45);
    }
    g.stairs(10,1,16,3,14,29,28,Math.PI);
  },
  petra(g) {
    g.frustum(0,0,-5,38,33,15,31,13,0,0xb9826c);
    for(const x of [-16,16]) g.frustum(x,0,0,7,28,12,4,9,0,0xbb876f);
    for(const x of [-10,-6,6,10]) {g.column(x,0,4,1,12);g.box(x,12,4,2.5,1,2.5);}
    portal(g,0,0,3,6,9);g.box(0,13,4,24,1.5,3);
    for(const x of [-9,9]) {portal(g,x,14.5,4,5,8);g.frustum(x,22.5,4,7,4,3,0,3);}
    g.column(0,14.5,4,3,8);dome(g,0,22.5,4,3,2);g.column(0,24.5,4,.8,2);
    g.box(0,0,4.1,3,7,.1,0,0x4a3530);
  },
  hegra(g) {
    g.frustum(0,0,-3,24,24,18,17,12,0,0xbca080);
    portal(g,0,0,6,11,12);g.box(0,12,6,14,1,2);
    for(let i=0;i<5;i++) g.box(0,13+i,6,16-i*2,1,2);
    for(const x of [-6,6]) g.box(x,0,6,1,12,1.5);
    g.box(0,0,6.1,3,6,.1,0,0x4a4036);
  },
  persepolis(g) {
    g.box(0,0,0,64,5,48);g.stairs(0,0,36,14,5,12,15,Math.PI);
    for(let i=0;i<5;i++) for(let j=0;j<4;j++) {
      const x=-22+i*11,z=-16+j*10;
      g.column(x,5,z,1.4,1);g.column(x,6,z,.7,(i+j)%5===0?5:15);
      if((i+j)%5!==0) {g.box(x,21,z,3,1,1.2);g.box(x-1,22,z,.8,1,1.2);g.box(x+1,22,z,.8,1,1.2);}
    }
    portal(g,0,5,20,12,12);
  },
  gobekli_tepe(g) {
    for(const [x,z,r] of [[-10,0,8],[10,0,7],[0,-15,6]]) {
      ring(g,x,0,z,r,1.5,1);
      for(let i=0;i<8;i++) {const a=i/8*TAU;tPillar(g,x+Math.cos(a)*(r-1),0,z+Math.sin(a)*(r-1),2.7,a);}
      tPillar(g,x-2,0,z,4.7);tPillar(g,x+2,0,z,4.7);
    }
  },
  geghard(g) {
    rockCourt(g,{w:44,d:38,h:23});
    g.house(-4,1,0,14,18,9);g.box(-4,10,0,15,.8,19);
    g.column(-4,10.8,0,4,5,8);revolve(g,-4,15.8,0,[[4.5,0],[0,7]],{segments:8});
    g.house(10,1,-6,9,10,6);g.frustum(10,7,-6,10,4,11,0,11);
    portal(g,-4,1,9,5,6);
  },
  sanchi(g) {
    g.column(0,0,0,13,1);stupa(g,0,1,0,11,9);
    ring(g,0,0,0,15,1.6,.35,{start:.12,end:TAU-.12,segments:48});
    for(let side=0;side<4;side++) {
      const a=side/4*TAU,x=Math.sin(a)*16,z=Math.cos(a)*16;
      for(const off of [-2.4,2.4]) g.box(x+off*Math.cos(a),0,z-off*Math.sin(a),.8,7,.8,a);
      for(let i=0;i<3;i++) g.box(x,5.1+i*.9,z,7,.5,1,a);
    }
  },
  chola(g) {
    g.box(0,0,0,38,1,54);g.house(0,1,-9,18,18,6);
    for(let i=0;i<11;i++) {
      const w=21-i*1.5;g.frustum(0,7+i*2.4,-9,w,2.1,w,w-1.2,w-1.2);
      g.box(0,9.1+i*2.4,-9,w,.3,w);
    }
    dome(g,0,33.4,-9,3,3);g.column(0,36.4,-9,.4,1.5);
    g.house(0,1,13,12,22,5);g.frustum(0,6,13,14,3,24,9,20);
    for(const x of [-16,16]) for(let j=0;j<10;j++) g.column(x,1,-23+j*5,.5,4);
  },
  borobudur(g) {
    for(let i=0;i<5;i++) g.box(0,i*2.4,0,64-i*7,2.4,64-i*7);
    for(let i=0;i<3;i++) {
      const r=17-i*4,y=12+i*2;g.column(0,y,0,r,2,48);
      const count=16-i*4;
      for(let j=0;j<count;j++) {
        const a=j/count*TAU,x=Math.cos(a)*(r-2),z=Math.sin(a)*(r-2);
        // Open posts under a bell roof preserve the lattice-stupa silhouette at low detail.
        for(let k=0;k<6;k++) g.column(x+Math.cos(k/6*TAU)*.8,y+2,z+Math.sin(k/6*TAU)*.8,.15,1,6);
        dome(g,x,y+3,z,1,1);g.column(x,y+4,z,.12,.8,6);
      }
    }
    stupa(g,0,18,0,4,4);g.stairs(0,0,42,5,12,27,24,Math.PI);
  },
  seokguram(g) {
    g.column(0,0,0,9,1,32);
    // Open front sector is a deliberate cutaway to expose the granite chamber and statue.
    ring(g,0,1,0,7,5,1,{start:.75*Math.PI,end:2.25*Math.PI,segments:24});
    revolve(g,0,6,0,[[7,0],[6.5,2],[4.5,4],[0,5]],{start:.75*Math.PI,end:2.25*Math.PI,segments:24});
    for(const x of [-3,3]) g.box(x,1,9,1,4,8);
    g.column(0,1,-1,2,1,16);dome(g,0,2,-1,1.8,1);
    g.frustum(0,3,-1,1.6,2,1.2,1.2,1);dome(g,0,5,-1,.75,1);
    g.box(0,1,10,5,.4,10);
  },
  gusuku(g) {
    for(let i=0;i<3;i++) {
      const y=i*4,r=22-i*6;
      g.column(0,y,-i*5,r,4,32);
      ring(g,0,y+4,-i*5,r,2,.8,{start:.2,end:TAU-.2,segments:32});
    }
    portal(g,18,0,0,6,5);g.arch(18,3,0,2,1,2);
    g.stairs(0,0,27,4,12,26,24,Math.PI);
  },
  malta_temples(g) {
    g.box(0,0,0,27,.4,34);
    for(const z of [-9,2,11]) for(const x of [-6,6]) {
      ring(g,x,.4,z,5,4,1.2,{start:x<0?.25*Math.PI:1.25*Math.PI,end:x<0?1.75*Math.PI:2.75*Math.PI,segments:20});
    }
    portal(g,0,.4,16,5,5);g.box(-7,.4,16,9,4,1.5);g.box(7,.4,16,9,4,1.5);
  },
  nuraghe(g) {
    taperTower(g,0,0,0,6,15);
    for(const x of [-8,8]) for(const z of [-8,8]) taperTower(g,x,0,z,4,9);
    for(const x of [-8,8]) g.box(x,0,0,2,6,16);
    g.box(0,0,-8,16,6,2);portal(g,0,0,8,8,6);
    for(const [x,z] of [[-18,3],[-16,13],[0,18],[13,17],[18,3]]) ring(g,x,0,z,3,1.5,.6);
  },
  tiwanaku(g) {
    g.box(0,0,0,34,1,24);portal(g,0,1,0,8,5);
    g.box(0,5.3,.8,8,.6,.2);g.box(0,5.1,.95,.7,.8,.2);
    for(const x of [-3,-2,2,3]) g.box(x,4.8,.9,.4,.5,.15);
    for(const x of [-16,16]) for(let i=0;i<6;i++) g.box(x,1,-10+i*4,1,2,1);
    g.box(0,1,-11,32,1,1);g.stairs(0,0,16,7,1,4,6,Math.PI);
    for(const x of [-11,11]) g.column(x,1,-6,.6,3,6);
  },
  chaco(g) {
    // Semicircular multi-storey great house with a courtyard and open circular kivas.
    for(let i=0;i<12;i++) {
      const a=Math.PI+i/11*Math.PI,x=Math.cos(a)*23,z=Math.sin(a)*23;
      g.house(x,0,z,6,7,7);g.house(x,7,z,6,7,3);
    }
    for(const x of [-20,-12,-4,4,12,20]) g.house(x,0,5,7,8,3);
    for(const x of [-9,9]) {g.column(x,0,-7,5,.5,24);ring(g,x,.5,-7,5,2,.8);}
  },
  nan_madol(g) {
    for(let i=0;i<3;i++) for(let j=0;j<2;j++) {
      const x=(i-1)*24,z=(j-.5)*26;
      g.box(x,0,z,19,1,21,0,0xb5afa0);
      for(let row=0;row<7;row++) {
        const y=1+row*.8;
        for(const side of [-1,1]) {
          g.box(x+side*8,y,z,1,.65,19);
          g.box(x,y,z+side*9,17,.65,1);
          if(row%2===0) for(let k=0;k<5;k++) g.box(x+side*8,y,z-7+k*3.5,2,.75,.65);
        }
      }
      g.box(x,1,z,7,1,9);
    }
  },
};
