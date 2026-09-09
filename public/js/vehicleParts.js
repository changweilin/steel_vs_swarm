// 描述子宿主的適配層：新車模與既有碰撞契約分開，兩者不反推彼此。
import { vehicleBackgroundObject } from './vehicleCatalog.js';
import {selectRoadCar} from './vehicleEveryday.js';
import { makeVehicle as collisionContract, VEHICLE_SPEC, placeParts } from './vehicles.js';

export function makeSceneVehicleParts(kind, opts = {}) {
  // 貨櫃是獨立物流構件，沒有車輛模型。
  if (kind.startsWith('container')) return collisionContract(kind, opts);
  const seed = (opts.paint || 0) ^ Math.round((opts.at?.[0] || 0)*100) ^ Math.round((opts.at?.[2] || 0)*100);
  const key = kind === 'railcar' ? 'tram' : kind==='sedan'?selectRoadCar(seed):kind;
  const model = vehicleBackgroundObject(key, seed);
  const fit = opts.fit || VEHICLE_SPEC[kind];
  if (!fit || !['L','W','H'].every(axis=>Number.isFinite(fit[axis]) && fit[axis]>0)) throw new RangeError('載具宿主缺少正有限 fit');
  const { min,max,size } = model.bounds;
  const factor = Math.min(fit.L/size[0],fit.H/size[1],fit.W/size[2]);
  const crush = opts.crush ?? 1;
  if (!Number.isFinite(crush) || crush <= 0 || crush > 1) throw new RangeError('crush 必須介於 0 與 1');
  const rows = model.parts.map(p=>{
    if (!['box','cylinder'].includes(p.type)) throw new RangeError(`描述子宿主不支援車型零件:${p.type}`);
    const dims=p.type==='box' ? ['box',...p.dimensions.map(n=>n*factor)]
      : ['cyl',p.radii[0]*factor,p.radii[1]*factor,p.height*factor,p.sides];
    const at=[(p.position[0]-(min[0]+max[0])/2)*factor,(p.position[1]-min[1])*factor,(p.position[2]-(min[2]+max[2])/2)*factor];
    // 殘骸的上半部塌陷保留輪組接地；這裡只處理新幾何。
    if (p.type==='box' && at[1]>fit.H*.5) {
      at[1]=fit.H*.5+(at[1]-fit.H*.5)*crush;
      dims[2]*=crush;
    }
    return {g:dims,p:at,r:p.rotation,c:p.color,role:p.name,...(opts.vc?{vc:opts.vc}:{})};
  });
  const visual=placeParts(rows,opts.at,opts.ry);
  if (!opts.col) return visual;
  // 權威碰撞柱逐位元保留；渲染器跳過這些無外觀的契約列。
  return [...collisionContract(kind,opts).filter(p=>p.col).map(p=>({...p,collisionOnly:true})),...visual];
}
