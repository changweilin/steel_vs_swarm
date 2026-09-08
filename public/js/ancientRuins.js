// Activity-based abandoned stone ensembles. Random damage/layout precedes uniform scaling.
const ruin=(name,activity,build)=>({name,activity,build});
function basin(g,x,y,z,w,d,h=1) {
  g.box(x,y,z,w,.25,d);
  g.box(x-w/2,y,z,.5,h,d);g.box(x+w/2,y,z,.5,h,d);
  g.box(x,y,z-d/2,w,h,.5);g.box(x,y,z+d/2,w,h,.5);
}
function stoneRing(g,x,y,z,r,h) {
  for(let i=0;i<16;i++) {
    const a=i/16*Math.PI*2;
    g.box(x+Math.cos(a)*r,y,z+Math.sin(a)*r,2*r*Math.sin(Math.PI/16)+.1,h,.6,a+Math.PI/2);
  }
}
function stalls(g,rnd) {
  for(const z of [-5,5]) for(let i=0;i<4;i++) {
    const x=-12+i*8;g.house(x,0,z,6,6,1.5+rnd()*2);
    g.box(x,0,z+(z>0?-2:2),4,1.1,.8);
  }
}
export const ACTIVITY_RUINS = {
  farm:ruin('廢棄農莊與梯田','農牧',(g,rnd)=>{
    for(let i=0;i<4;i++) {g.box(0,i,-i*4,26-i*3,1,18-i*3);g.box(0,i+1,8-i*3.5,26-i*3,.5,.5);}
    g.house(-5,4,-6,6,7,2+rnd());g.house(5,4,-6,5,6,2);
  }),
  threshing:ruin('廢棄打穀場','農牧',(g)=>{
    g.column(0,0,0,9,.3,24);stoneRing(g,0,.3,0,9,.6);g.house(13,0,-4,5,6,2);
  }),
  granary:ruin('廢棄石造糧倉','儲藏',(g,rnd)=>{
    for(let i=0;i<3;i++) {const x=-8+i*8;
      for(const dx of [-2,2]) for(const z of [-3,3]) g.column(x+dx,0,z,.6,1.5,8);
      g.box(x,1.5,0,6,.5,8);g.house(x,2,0,5,7,2+rnd());
    }
  }),
  sheepfold:ruin('廢棄畜圈與牧人屋','農牧',(g,rnd)=>{
    for(const x of [-8,8]) {stoneRing(g,x,0,0,7,1.2);g.box(x,0,0,4,.5,.8);}
    g.house(0,0,-12,6,5,1.5+rnd());
  }),
  well:ruin('廢棄石井','水利',(g)=>{
    g.column(0,0,0,4,.25,16);stoneRing(g,0,.25,0,1.5,1.3);
    for(const x of [-2,2]) g.box(x,0,0,.6,4,.6);g.box(0,4,0,5,.6,.7);basin(g,5,0,0,3,2,.8);
  }),
  cistern:ruin('廢棄蓄水池','水利',(g,rnd)=>{
    basin(g,0,0,0,20,14,3);g.stairs(-7,.25,5,2,2.75,10,10,Math.PI);
    for(let i=0;i<4;i++) g.column(-6+i*4,.25,0,.6,1+rnd()*2);
  }),
  aqueduct:ruin('廢棄引水渠','水利',(g)=>{
    for(let i=0;i<5;i++) g.box(-16+i*8,0,0,2,5,2);
    for(let i=0;i<4;i++) {const x=-12+i*8;g.arch(x,5,0,3,1,2);basin(g,x,9,0,8,2,1);}
  }),
  bridge:ruin('殘缺石拱橋','交通',(g)=>{
    for(const x of [-8,0,8]) g.box(x,0,0,2,3,6);
    for(const x of [-4,4]) {g.arch(x,3,0,3,1,6);g.box(x,7,0,8,.6,6);}
    for(const z of [-3,3]) for(const x of [-5,3]) g.box(x,7.6,z,5,.7,.4);
    g.stairs(-16,0,0,6,7.6,8,12,-Math.PI/2);
  }),
  wharf:ruin('廢棄石碼頭','交通',(g)=>{
    g.box(0,0,0,10,2,24);g.box(8,0,-10,16,2,4);
    for(let i=0;i<4;i++) g.column(-4,2,-8+i*5,.4,1,8);
    g.house(8,2,-10,7,3,2);
  }),
  caravanserai:ruin('廢棄驛站與商旅院','交通',(g,rnd)=>{
    for(const x of [-12,12]) for(let j=0;j<4;j++) g.house(x,0,-12+j*8,6,7,2+rnd()*2);
    for(const x of [-7,0,7]) g.house(x,0,-15,6,6,3);
    g.box(-9,0,15,12,4,1);g.box(9,0,15,12,4,1);g.arch(0,2,15,3,1,1);
    basin(g,0,0,0,4,4,.6);
  }),
  kiln:ruin('廢棄陶窯','生產',(g)=>{
    for(const x of [-5,5]) {stoneRing(g,x,0,0,3,3);g.frustum(x,3,0,6,1.5,6,2,2);g.column(x,4.5,0,.7,2,8);}
    for(let i=0;i<5;i++) g.column(-6+i*3,0,7,.6,.6+i%2*.4,8);
  }),
  smelter:ruin('廢棄冶煉作坊','生產',(g,rnd)=>{
    g.house(0,0,0,16,12,2);
    for(const x of [-5,0,5]) {stoneRing(g,x,0,-3,1.5,2);g.column(x,2,-3,.8,2+rnd()*2,8);}
    g.box(0,0,4,9,1,2);
  }),
  mill:ruin('廢棄磨坊與石磨','生產',(g)=>{
    g.house(0,0,0,12,10,3);
    for(const x of [-3,3]) {g.column(x,0,0,1.7,.8,16);g.column(x,.8,0,1.5,.5,16);g.column(x,1.3,0,.2,.7,8);}
    basin(g,-9,0,0,2,16,.8);
  }),
  market:ruin('廢棄市集','交易',stalls),
  bathhouse:ruin('廢棄浴場','生活',(g,rnd)=>{
    g.house(0,0,0,24,20,3);
    basin(g,-6,0,0,8,12,1.4);basin(g,6,0,0,8,8,1);
    for(const z of [-8,8]) for(let i=0;i<5;i++) g.column(-10+i*5,0,z,.6,2+rnd()*2);
  }),
  altar:ruin('廢棄祭壇與立石','祭祀',(g,rnd)=>{
    for(let i=0;i<3;i++) g.box(0,i*.6,0,12-i*3,.6,12-i*3);
    g.box(0,1.8,0,3,1.2,2);
    for(let i=0;i<8;i++) {const a=i/8*Math.PI*2;g.box(Math.cos(a)*10,0,Math.sin(a)*10,1.1,2+rnd()*2,1,a);}
  }),
  cemetery:ruin('廢棄墓園與石棺','喪葬',(g,rnd)=>{
    for(let i=0;i<4;i++) for(let j=0;j<3;j++) {
      const x=-9+i*6,z=-6+j*6;g.box(x,0,z,2,.7,3);g.box(x,0,z-1.5,.8,1+rnd(),.4);
    }
  }),
  watchtower:ruin('廢棄烽火瞭望台','防禦',(g,rnd)=>{
    g.frustum(0,0,0,9,7,9,6,6);g.house(0,7,0,6,6,2+rnd());
    basin(g,0,7,0,2,2,.5);g.stairs(-6,0,-6,2,7,12,16);
  }),
  mine:ruin('廢棄礦坑入口','生產',(g)=>{
    g.frustum(-7,0,-4,10,10,14,7,10);g.frustum(7,0,-4,10,12,14,7,10);
    g.box(0,8,-4,6,3,12);g.arch(0,3,2,2,1,2);
    for(const x of [-2.5,2.5]) g.box(x,0,2,1,3,2);
    basin(g,8,0,8,6,4,1);
  }),
};
