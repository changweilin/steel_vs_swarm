// 屋頂截面與附件落點共用的純數學描述；不依賴渲染、無 RNG。
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
