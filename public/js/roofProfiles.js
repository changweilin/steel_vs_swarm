// 屋頂截面與附件落點共用的純數學描述；不依賴渲染、無 RNG。
// 封頂沿牆唇邊（公尺）：牆體幾何較回報高度多出此值，封頂邊緣埋入牆內、
// 立柱頂面較牆頂退此值 —— 同向上共面重疊歸零，碰撞與立面佈局維持原值。
export const ROOF_RIM_LIP = 0.04;
// 屋頂底面沉入量（公尺）：屋頂實體底面較牆頂低此值；高程公式對非平面屋頂同步扣除，
// 落位 Foot 與面板間隙才會踩在真實面上。平板封頂本身不沉。
export const ROOF_SEAT_SINK = 0.06;
// 法線群組拆邊角（度）：夾角超過此值即拆頂點，圓頂／拱維持平滑、折邊脆直。
// 單一縫：facetMeshData 的預設值與此恆同，測試由這裡取值不斷言魔數。
export const ROOF_FACET_DEG = 30;
// 柱錐拆邊角（度）：8~12 段柱身維持圓潤（36° 以下），頂底蓋（90°）與 6 段以下
// 桿件照樣拆開。屋頂要脆稜、柱體要圓潤，兩個閾值分開。
export const CYL_FACET_DEG = 50;
export function roofDimensions(span, height = 10) {
  return { rise: Math.min(Math.max(1.6, height * 0.32), Math.max(1.8, span * 0.36)),
    eave: Math.min(0.45, Math.max(0.2, span * 0.05)) };
}
export function sectionRoofProfile(form, span, height = 10) {
  const { rise, eave } = roofDimensions(span, height);
  const half = span / 2 + eave;
  if (form === 'steep_gable') return [[-half,0],[0,Math.min(span * 0.8, height * 1.1)],[half,0]];
  if (form === 'crowstep') return [[-half,0],[0,rise],[half,0]];
  if (form === 'gambrel') return [[-half,0],[-half*.55,rise*.75],[0,rise],[half*.55,rise*.75],[half,0]];
  if (form === 'butterfly') return [[-half,rise*.7],[0,0.2],[half,rise*.7]];
  return null;
}
export function sectionRoofHeight(section, distance) {
  if (distance < section[0][0] || distance > section.at(-1)[0]) return 0;
  for (let i=1;i<section.length;i++) {
    const [x0,y0]=section[i-1], [x1,y1]=section[i];
    if(distance<=x1) return y0+(y1-y0)*(distance-x0)/(x1-x0);
  }
  return 0;
}
