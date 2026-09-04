// ============ 自律召喚部隊專屬多面體 3D 模型庫 ============
// 依據 docs/combat-skills-and-summons-overhaul.md Part 1 規格：
// 徹底解除 6 大英雄自律召喚部隊與通用 NPC 小兵的模型耦合，
// 採用賽璐璐 / 多面體美學（geo3d 積木 + mat() 著色），
// 提供獨特陣營/英雄專屬塗裝與機械結構細節。
import * as THREE from 'three';
import { bx, cyl, sph, cone, torus, mat, dim, rbz } from './geo3d.js';
import { SOLDIER_H } from './data.js';

const TAU = Math.PI * 2;

function glowBox(parent, w, h, d, x, y, z, color, intensity = 0.9) {
  return bx(parent, w, h, d, x, y, z, color, {
    emissive: color,
    emissiveIntensity: intensity,
  });
}

function glowCyl(parent, rt, rb, h, seg, x, y, z, color, intensity = 0.9) {
  return cyl(parent, rt, rb, h, seg, x, y, z, color, {
    emissive: color,
    emissiveIntensity: intensity,
  });
}

/**
 * 1. 自律巡弋無人機 (drone_wingman) — 召喚者：S-09 Prof. Dariush Farahzad「詩人」
 * 構型：縮尺三角翼鴨翼構型 (Shahed-136 mini)，銳利切面翼面、雙鏡頭下向光電尋標轉塔、微型相位發光翼尖。
 * 塗裝：灰紫象牙圖騰 (0xc9b7e8) 與黑曜石裝甲飾板 (0x232029)。
 */
export function buildDroneWingman(side) {
  const g = new THREE.Group();
  const cBody = 0xc9b7e8;       // 灰紫象牙主色
  const cDark = 0x232029;       // 深黑曜石飾板
  const cDeep = 0x141217;       // 內嵌結構
  const cGlow = 0xd4afff;       // 相位光芒紫
  const cLens = 0x8259d6;       // 尋標鏡片

  // 主機身（扁平多面體機幹，尖銳菱形）
  const fuselage = bx(g, 1.1, 0.28, 2.2, 0, 0.14, 0, cBody);
  fuselage.rotation.x = 0.04;

  // 尖銳機首整流罩（前掠錐度）
  const nose = cone(g, 0.42, 0.95, 4, 0, 0.15, 1.45, cDark);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.y = Math.PI / 4; // 菱形切面

  // 前置鴨翼 (Canards)
  const canardL = bx(g, 0.55, 0.04, 0.32, -0.42, 0.15, 1.1, cDark);
  canardL.rotation.y = 0.35;
  canardL.rotation.z = -0.06;
  const canardR = bx(g, 0.55, 0.04, 0.32, 0.42, 0.15, 1.1, cDark);
  canardR.rotation.y = -0.35;
  canardR.rotation.z = 0.06;

  // 主三角翼 (Delta Wings)
  const wingL = bx(g, 1.6, 0.05, 1.4, -1.05, 0.14, -0.25, cBody);
  wingL.rotation.y = 0.42;
  wingL.rotation.z = -0.05;
  const wingR = bx(g, 1.6, 0.05, 1.4, 1.05, 0.14, -0.25, cBody);
  wingR.rotation.y = -0.42;
  wingR.rotation.z = 0.05;

  // 黑曜石圖騰翼面飾板
  bx(wingL, 0.65, 0.06, 0.9, 0.05, 0.02, 0, cDark);
  bx(wingR, 0.65, 0.06, 0.9, -0.05, 0.02, 0, cDark);

  // 翼端垂直安定小翼 (Wingtip Endplates)
  const tipL = bx(g, 0.05, 0.58, 0.72, -1.82, 0.35, -0.65, cDark);
  tipL.rotation.y = 0.06;
  const tipR = bx(g, 0.05, 0.58, 0.72, 1.82, 0.35, -0.65, cDark);
  tipR.rotation.y = -0.06;

  // 微型相位發光翼尖飾條 (Phase-glow wingtips)
  glowBox(tipL, 0.06, 0.48, 0.08, 0, 0.02, 0.32, cGlow, 1.2);
  glowBox(tipR, 0.06, 0.48, 0.08, 0, 0.02, 0.32, cGlow, 1.2);

  // 背部通訊脊柱與冷卻格柵
  bx(g, 0.38, 0.14, 1.2, 0, 0.33, -0.2, cDark);
  glowBox(g, 0.12, 0.04, 0.6, 0, 0.41, -0.2, cGlow, 0.8);

  // 尾部推力向量噴口 / 螺旋槳整流錐
  const thruster = cyl(g, 0.16, 0.24, 0.4, 8, 0, 0.14, -1.15, cDeep, { metalness: 0.8 });
  thruster.rotation.x = Math.PI / 2;
  glowCyl(g, 0.11, 0.11, 0.06, 8, 0, 0.14, -1.36, cGlow, 1.4).rotation.x = Math.PI / 2;

  // 下向光電尋標轉塔 (Dual-lens downward EO seeker turret)
  const turretBase = cyl(g, 0.22, 0.24, 0.18, 8, 0, -0.02, 0.75, cDark);
  const turretBall = sph(g, 0.2, 0, -0.12, 0.78, cDeep);

  // 雙光電鏡頭
  glowCyl(turretBall, 0.055, 0.055, 0.1, 8, -0.07, -0.04, 0.14, cLens, 1.1).rotation.x = 0.4;
  glowCyl(turretBall, 0.055, 0.055, 0.1, 8, 0.07, -0.04, 0.14, cLens, 1.1).rotation.x = 0.4;

  // 武器開火槍口錨點 (wingman_beam 脈衝雷射錨點)
  const muzzle = new THREE.Group();
  muzzle.position.set(0, -0.12, 1.0);
  g.add(muzzle);

  g.userData.turret = turretBall;
  g.userData.turretMuzzles = [muzzle];
  g.userData.muzzle = muzzle;
  g.userData.rig = {
    kind: 'aerial',
    tilt: g,
    tiltY0: 0,
    muzzles: { light: { n: muzzle, r: 0.15 } },
  };

  return g;
}

/**
 * 2. 自律斥候戰車 (assault_rover) — 召喚者：M-06 Túlio Ferreira「狂歡節」
 * 構型：6 輪高底盤越野底盤，外露防滾架與傳動軸、車頂低音震膜聲學雷達艙、柔性天線錦旗。
 * 塗裝：里約狂歡節旭日金黃 (0xf0c24a) 與熱帶火焰飾條 (0xff4b2b)。
 */
export function buildAssaultRover(side) {
  const g = new THREE.Group();
  const cGold = 0xf0c24a;      // 狂歡節旭日金黃
  const cFlame = 0xff4b2b;     // 熱帶火焰紅橙
  const cFrame = 0x2e2924;     // 重裝骨架防滾架
  const cTire = 0x1c1c1e;      // 越野胎壁
  const cRim = 0xddb844;       // 輪圈金色
  const cGlow = 0xffdf66;      // 車燈與儀表光

  const hull = new THREE.Group();
  g.add(hull);

  // 船型高離地底盤
  bx(hull, 1.45, 0.42, 2.7, 0, 0.65, 0, cFrame, { metalness: 0.7 });
  // 上車身裝甲外殼
  bx(hull, 1.55, 0.48, 2.3, 0, 0.98, -0.08, cGold);
  // 熱帶火焰側裙飾板
  bx(hull, 1.62, 0.22, 1.8, 0, 0.92, -0.12, cFlame);

  // 前傾式裝甲車頭
  const prow = bx(hull, 1.38, 0.42, 0.75, 0, 0.88, 1.25, cGold);
  prow.rotation.x = -0.35;
  // 前車燈
  glowBox(prow, 0.26, 0.12, 0.08, -0.48, 0.02, 0.38, cGlow, 1.1);
  glowBox(prow, 0.26, 0.12, 0.08, 0.48, 0.02, 0.38, cGlow, 1.1);

  // 外露防滾架 (Roll Cage)
  const cageY = 1.38;
  bx(hull, 0.08, 0.65, 0.08, -0.72, cageY, 0.85, cFrame);
  bx(hull, 0.08, 0.65, 0.08, 0.72, cageY, 0.85, cFrame);
  bx(hull, 0.08, 0.65, 0.08, -0.72, cageY, -0.85, cFrame);
  bx(hull, 0.08, 0.65, 0.08, 0.72, cageY, -0.85, cFrame);
  bx(hull, 1.52, 0.08, 0.08, 0, cageY + 0.32, 0.85, cFrame);
  bx(hull, 1.52, 0.08, 0.08, 0, cageY + 0.32, -0.85, cFrame);
  bx(hull, 0.08, 0.08, 1.78, -0.72, cageY + 0.32, 0, cFrame);
  bx(hull, 0.08, 0.08, 1.78, 0.72, cageY + 0.32, 0, cFrame);

  // 車頂聲學低音震膜雷達艙 (Acoustic bass-membrane radar housing)
  cyl(hull, 0.38, 0.42, 0.22, 10, 0, 1.76, -0.45, cFrame);
  const radarDish = torus(hull, 0.32, 0.09, 0, 1.95, -0.45, cFlame);
  radarDish.rotation.x = Math.PI / 2;
  // 震膜同心發光環
  glowCyl(hull, 0.24, 0.24, 0.05, 12, 0, 1.92, -0.45, cGlow, 1.0);

  // 柔性天線與三角狂歡錦旗
  cyl(hull, 0.02, 0.03, 1.4, 4, 0.65, 2.1, -1.05, cFrame);
  const pennant = cone(hull, 0.22, 0.55, 3, 0.65, 2.55, -1.25, cFlame);
  pennant.rotation.x = -Math.PI / 2;
  pennant.rotation.z = Math.PI / 6;

  // 6 輪懸吊與獨立車輪
  const wheels = [];
  const axleZ = [0.95, 0.0, -0.95];
  for (const z of axleZ) {
    // 橫貫傳動軸
    cyl(hull, 0.08, 0.08, 1.85, 6, 0, 0.45, z, cFrame).rotation.z = Math.PI / 2;
    for (const sideX of [-1, 1]) {
      const wGroup = new THREE.Group();
      wGroup.position.set(sideX * 1.02, 0.45, z);
      hull.add(wGroup);

      // 越野寬胎
      const tire = cyl(wGroup, 0.44, 0.44, 0.32, 12, 0, 0, 0, cTire);
      tire.rotation.z = Math.PI / 2;
      // 輪圈與金屬卡鉗
      const rim = cyl(wGroup, 0.28, 0.28, 0.33, 8, 0, 0, 0, cRim, { metalness: 0.8 });
      rim.rotation.z = Math.PI / 2;
      sph(wGroup, 0.12, 0, 0, 0, cFlame);

      wheels.push(wGroup);
    }
  }

  // 車載雙聯速射砲塔 (Twin-fragment autocannon)
  const turret = new THREE.Group();
  turret.position.set(0, 1.38, 0.35);
  hull.add(turret);

  cyl(turret, 0.42, 0.46, 0.22, 8, 0, 0.11, 0, cFrame);
  bx(turret, 0.72, 0.38, 0.85, 0, 0.35, -0.05, cGold);
  bx(turret, 0.76, 0.18, 0.65, 0, 0.38, -0.05, cFlame);

  const pitch = new THREE.Group();
  pitch.position.set(0, 0.36, 0.32);
  turret.add(pitch);
  turret.userData.pitch = pitch;

  // 雙聯砲管與砲口制退器
  const muzzles = [];
  for (const bxOff of [-0.18, 0.18]) {
    const barrel = cyl(pitch, 0.065, 0.075, 1.15, 8, bxOff, 0, 0.55, cFrame, { metalness: 0.85 });
    barrel.rotation.x = Math.PI / 2;
    const brake = torus(pitch, 0.085, 0.025, bxOff, 0, 1.12, cGold, { metalness: 0.9 });
    brake.rotation.x = Math.PI / 2;

    const mzNode = new THREE.Group();
    mzNode.position.set(bxOff, 0, 1.18);
    pitch.add(mzNode);
    muzzles.push(mzNode);
  }

  g.userData.turret = turret;
  g.userData.turretMuzzles = muzzles;
  g.userData.wheels = wheels;
  g.userData.rig = {
    kind: 'wheeled',
    hull,
    hullY0: 0,
    wheels,
    muzzles: { light: { n: muzzles[0], r: 0.15 } },
  };

  return g;
}

/**
 * 3. 交響武裝直升機 (heli_squad) — 召喚者：S-01 Kateryna Shevchenko「蜂后」
 * 構型：重型共軸雙旋翼武裝直升機，流線型空氣動力機身，機鼻音叉型共振感測桅桿，雙側短翼微型火箭巢。
 * 塗裝：烏克蘭黑土橄欖綠 (0x4a5d4e) 鑲嵌指揮家燕尾服金滾邊 (0xdfca7a)。
 */
export function buildHeliSquad(side) {
  const g = new THREE.Group();
  const cOlive = 0x4a5d4e;      // 黑土橄欖綠
  const cGold = 0xdfca7a;       // 指揮家金滾邊
  const cDark = 0x29332b;       // 機械暗部
  const cGlass = 0x98cfc3;      // 座艙通透藍綠
  const cGlow = 0x9ecfff;       // 微型火箭導引冷藍光

  const fuselage = new THREE.Group();
  g.add(fuselage);

  // 流線型水滴機身
  rbz(fuselage, 1.35, 1.25, 2.9, 0, 1.1, 0.35, cOlive, { metalness: 0.35 });
  // 金色指揮家滾邊飾條
  bx(fuselage, 1.38, 0.12, 2.7, 0, 1.1, 0.35, cGold);

  // 縱列雙座座艙罩
  const cockpit = bx(fuselage, 0.88, 0.65, 1.45, 0, 1.48, 1.05, cGlass, {
    transparent: true,
    opacity: 0.78,
  });
  cockpit.rotation.x = -0.32;
  bx(fuselage, 0.92, 0.08, 1.48, 0, 1.5, 1.05, cGold);

  // 細長錐形尾樑
  const tailBoom = cyl(fuselage, 0.32, 0.16, 2.8, 6, 0, 1.28, -2.1, cOlive);
  tailBoom.rotation.x = Math.PI / 2;

  // 雙垂尾安定翼 (燕尾設計)
  for (const sx of [-0.42, 0.42]) {
    const fin = bx(fuselage, 0.08, 0.85, 0.55, sx, 1.62, -3.3, cOlive);
    fin.rotation.y = sx * 0.12;
    fin.rotation.z = -sx * 0.15;
    bx(fin, 0.09, 0.88, 0.12, 0, 0, 0.22, cGold); // 尾翼金邊
  }

  // 機鼻音叉型感測桅桿 (Tuning-fork sensor mast)
  const mastRoot = cyl(fuselage, 0.06, 0.08, 0.65, 6, 0, 0.85, 2.05, cDark);
  mastRoot.rotation.x = Math.PI / 2;
  // 音叉雙叉
  for (const fx of [-0.14, 0.14]) {
    const prong = cyl(fuselage, 0.025, 0.03, 0.52, 4, fx, 0.85, 2.55, cGold);
    prong.rotation.x = Math.PI / 2;
  }
  // 音叉中心共振水晶球
  sph(fuselage, 0.09, 0, 0.85, 2.4, cGlow, { emissive: cGlow, emissiveIntensity: 1.2 });

  // 重型共軸雙旋翼 (Coaxial twin rotors)
  cyl(fuselage, 0.16, 0.18, 1.2, 8, 0, 2.05, 0.2, cDark, { metalness: 0.85 });
  const spinRotors = [];

  // 上層旋翼 (3 葉)
  const rotorTop = new THREE.Group();
  rotorTop.position.set(0, 2.55, 0.2);
  fuselage.add(rotorTop);
  spinRotors.push(rotorTop);

  // 下層旋翼 (3 葉)
  const rotorBottom = new THREE.Group();
  rotorBottom.position.set(0, 2.15, 0.2);
  fuselage.add(rotorBottom);
  spinRotors.push(rotorBottom);

  const makeBlades = (parent, rSign) => {
    cyl(parent, 0.22, 0.24, 0.14, 8, 0, 0, 0, cGold);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * TAU;
      const blade = bx(parent, 0.18, 0.03, 2.3, 0, 0, 1.15, cOlive);
      bx(blade, 0.2, 0.04, 0.45, 0, 0, 0.8, cGold); // 葉梢金線
      blade.position.set(Math.sin(ang) * 1.15, 0, Math.cos(ang) * 1.15);
      blade.rotation.y = ang + (rSign * 0.08);
    }
  };
  makeBlades(rotorTop, 1);
  makeBlades(rotorBottom, -1);

  // 起落架滑橇 (Skids)
  for (const sx of [-0.65, 0.65]) {
    cyl(fuselage, 0.04, 0.04, 0.65, 4, sx, 0.35, 0.7, cDark).rotation.z = sx * 0.25;
    cyl(fuselage, 0.04, 0.04, 0.65, 4, sx, 0.35, -0.3, cDark).rotation.z = sx * 0.25;
    const skidTube = cyl(fuselage, 0.06, 0.06, 2.5, 6, sx * 1.15, 0.1, 0.15, cGold, { metalness: 0.7 });
    skidTube.rotation.x = Math.PI / 2;
  }

  // 短翼與微型火箭巢 (Dual wingstub micro-rocket pods)
  const muzzles = [];
  for (const sx of [-1, 1]) {
    // 短翼
    const stubWing = bx(fuselage, 0.85, 0.08, 0.42, sx * 0.95, 0.95, 0.35, cOlive);
    stubWing.rotation.z = -sx * 0.08;
    bx(stubWing, 0.88, 0.1, 0.08, 0, 0, 0.18, cGold);

    // 火箭巢發射筒 (微型火箭彈筒)
    const pod = cyl(fuselage, 0.28, 0.32, 1.05, 8, sx * 1.35, 0.82, 0.42, cDark);
    pod.rotation.x = Math.PI / 2;
    // 前端多孔端蓋
    torus(fuselage, 0.28, 0.05, sx * 1.35, 0.82, 0.95, cGold);

    // 7 孔微型火箭孔陣
    for (let k = 0; k < 6; k++) {
      const ka = (k / 6) * TAU;
      glowCyl(fuselage, 0.045, 0.045, 0.08, 6,
        sx * 1.35 + Math.sin(ka) * 0.16, 0.82 + Math.cos(ka) * 0.16, 0.96, cGlow, 1.2).rotation.x = Math.PI / 2;
    }
    const centerTube = glowCyl(fuselage, 0.055, 0.055, 0.08, 6, sx * 1.35, 0.82, 0.96, cGlow, 1.4);
    centerTube.rotation.x = Math.PI / 2;

    const mz = new THREE.Group();
    mz.position.set(sx * 1.35, 0.82, 1.05);
    fuselage.add(mz);
    muzzles.push(mz);
  }

  g.userData.spin = spinRotors;
  g.userData.turretMuzzles = muzzles;
  g.userData.rig = {
    kind: 'aerial',
    tilt: fuselage,
    tiltY0: 0,
    muzzles: { light: { n: muzzles[0], r: 0.2 } },
  };

  return g;
}

/**
 * 4. 自律主戰坦克 (main_battle_tank) — 召喚者：T-05 Shen Heming「仙鶴」
 * 構型：瀋陽重工第 7 代履帶底盤，仿生液氣懸掛、低輪廓多面體砲塔、鶴羽相控陣雷達反射面。
 * 塗裝：協約工業鈦灰 (0x3d444d) 配高反差防滑塗層與出廠銘文白金飾 (0xdce4ec)。
 */
export function buildMainBattleTank(side) {
  const g = new THREE.Group();
  const cTitan = 0x3d444d;     // 鈦灰主裝甲
  const cGrip = 0x24282e;      // 防滑複合塗層
  const cCrane = 0xdce4ec;     // 鶴羽白金飾面
  const cGold = 0xdfca7a;      // 銘文金線
  const cDark = 0x16181b;      // 履帶與輪盤重金屬

  const hull = new THREE.Group();
  g.add(hull);

  // 楔形裝甲底盤
  bx(hull, 2.3, 0.62, 3.8, 0, 0.68, 0, cTitan, { metalness: 0.65 });
  // 大斜角首上裝甲 (Glacis plate)
  const glacis = bx(hull, 2.25, 0.55, 1.45, 0, 0.92, 1.62, cGrip, { metalness: 0.7 });
  glacis.rotation.x = -0.48;
  // 首上鶴羽仿生層壓裝甲飾條
  bx(glacis, 1.6, 0.08, 1.1, 0, 0.28, 0, cCrane);
  bx(glacis, 1.62, 0.1, 0.15, 0, 0.28, 0.35, cGold);

  // 側裙板與爆炸反應裝甲模組 (ERA blocks)
  for (const sx of [-1, 1]) {
    bx(hull, 0.22, 0.62, 3.6, sx * 1.22, 0.65, 0, cTitan);
    // 側裙 ERA 方塊
    for (let iz = -1.4; iz <= 1.4; iz += 0.55) {
      bx(hull, 0.08, 0.32, 0.45, sx * 1.34, 0.68, iz, cGrip);
    }
  }

  // 液氣懸掛路輪 (Road wheels)
  const wheels = [];
  const roadZ = [1.4, 0.8, 0.2, -0.4, -1.0, -1.6];
  for (const z of roadZ) {
    for (const sx of [-1, 1]) {
      const rw = cyl(hull, 0.36, 0.36, 0.24, 10, sx * 1.12, 0.36, z, cDark, { metalness: 0.8 });
      rw.rotation.z = Math.PI / 2;
      sph(hull, 0.12, sx * 1.25, 0.36, z, cGold);
      wheels.push(rw);
    }
  }

  // 低輪廓多面體鑄造砲塔 (Low-profile faceted turret)
  const turret = new THREE.Group();
  turret.position.set(0, 1.05, -0.15);
  hull.add(turret);

  // 砲塔主體座環
  cyl(turret, 0.95, 1.05, 0.25, 12, 0, 0.12, 0, cDark);
  // 多面體外擴楔形裝甲
  bx(turret, 2.05, 0.52, 2.2, 0, 0.44, -0.1, cTitan);
  // 砲塔正面箭頭楔形防盾
  const cheekL = bx(turret, 0.85, 0.48, 1.15, -0.62, 0.44, 0.85, cGrip);
  cheekL.rotation.y = -0.32;
  const cheekR = bx(turret, 0.85, 0.48, 1.15, 0.62, 0.44, 0.85, cGrip);
  cheekR.rotation.y = 0.32;

  // 鶴羽相控陣雷達反射面 (Crane-feather phased radar reflector)
  // 後部砲塔尾艙上的折疊羽翼相控陣天線板
  bx(turret, 1.6, 0.42, 1.1, 0, 0.52, -1.2, cTitan);
  const antennaRack = new THREE.Group();
  antennaRack.position.set(0, 0.78, -1.1);
  turret.add(antennaRack);

  // 扇形羽狀相控陣板
  for (let k = -2; k <= 2; k++) {
    const featherPlate = bx(antennaRack, 0.24, 0.45, 0.05, k * 0.28, 0, 0, cCrane);
    featherPlate.rotation.y = k * 0.18;
    featherPlate.rotation.x = -0.25;
    glowBox(featherPlate, 0.18, 0.06, 0.06, 0, 0.15, 0.03, cGold, 0.8);
  }

  // 俯仰砲盾與 130mm 滑膛穿甲砲管
  const pitch = new THREE.Group();
  pitch.position.set(0, 0.44, 0.85);
  turret.add(pitch);
  turret.userData.pitch = pitch;

  // 穿甲砲管
  const barrel = cyl(pitch, 0.12, 0.14, 2.85, 10, 0, 0, 1.42, cTitan, { metalness: 0.85 });
  barrel.rotation.x = Math.PI / 2;
  // 熱套筒 (Thermal sleeve)
  const sleeve = cyl(pitch, 0.16, 0.16, 1.35, 8, 0, 0, 1.1, cGrip);
  sleeve.rotation.x = Math.PI / 2;
  // 砲口制退器 (Muzzle brake)
  const brake = bx(pitch, 0.36, 0.26, 0.42, 0, 0, 2.85, cDark);
  bx(brake, 0.38, 0.12, 0.15, 0, 0, 0, cGold);

  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0, 3.1);
  pitch.add(muzzle);

  g.userData.turret = turret;
  g.userData.turretMuzzles = [muzzle];
  g.userData.wheels = wheels;
  g.userData.rig = {
    kind: 'tracked',
    hull,
    hullY0: 0,
    wheels,
    muzzles: { light: { n: muzzle, r: 0.22 } },
  };

  return g;
}

/**
 * 5. 精銳突擊步兵 (veteran_squad) — 召喚者：T-11 Rafael Fuentes「老雪茄」
 * 構型：重型動力外骨骼裝甲，左臂展開式防彈小圓盾，背部緊湊冷卻模組，單眼戰術目鏡。
 * 塗裝：古巴經典叢林斑塊迷彩 (0x4b533e) 與暗銅散熱片 (0x9c7a4a)。
 */
export function buildVeteranSquad(side) {
  const g = new THREE.Group();
  const cCamo = 0x4b533e;      // 叢林斑塊迷彩綠
  const cEarth = 0x6e684d;     // 泥土褐
  const cExo = 0x272b25;       // 外骨骼高強度合金黑
  const cCopper = 0x9c7a4a;    // 散熱暗銅
  const cVisor = 0x77ff88;     // 單眼戰術目鏡夜視綠

  const hips = new THREE.Group();
  hips.position.set(0, 0.95, 0);
  g.add(hips);

  // 裝甲骨盆與戰術腰帶
  bx(hips, 0.46, 0.24, 0.32, 0, 0, 0, cExo);
  bx(hips, 0.5, 0.08, 0.36, 0, 0.08, 0, cEarth);

  // 重型胸腹軀幹
  const torso = new THREE.Group();
  torso.position.set(0, 0.2, 0);
  hips.add(torso);

  bx(torso, 0.58, 0.54, 0.38, 0, 0.24, 0, cCamo);
  // 斜向防彈護胸板
  const chestPlate = bx(torso, 0.54, 0.36, 0.12, 0, 0.28, 0.18, cExo);
  chestPlate.rotation.x = -0.15;
  bx(chestPlate, 0.46, 0.14, 0.05, 0, 0.04, 0.07, cCopper);

  // 背部緊湊冷卻模組 (Backpack cooling pack)
  const pack = bx(torso, 0.48, 0.52, 0.26, 0, 0.26, -0.26, cExo);
  // 雙散熱排格柵
  for (const px of [-0.14, 0.14]) {
    cyl(pack, 0.08, 0.08, 0.36, 6, px, 0, 0.14, cCopper).rotation.x = Math.PI / 2;
  }

  // 戰術頭盔與單眼目鏡
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.02);
  torso.add(head);

  bx(head, 0.32, 0.34, 0.34, 0, 0, 0, cCamo);
  bx(head, 0.36, 0.12, 0.36, 0, 0.08, 0, cExo); // 頂盔加固脊
  // 單眼戰術目鏡 (右眼戰術單晶體)
  glowCyl(head, 0.065, 0.065, 0.12, 8, 0.08, 0.02, 0.18, cVisor, 1.4).rotation.x = Math.PI / 2;

  // 雙腿（含液壓動力外骨骼關節支撐）
  const legL = new THREE.Group();
  legL.position.set(-0.18, -0.05, 0);
  hips.add(legL);
  bx(legL, 0.18, 0.45, 0.22, 0, -0.22, 0, cCamo);
  cyl(legL, 0.04, 0.04, 0.42, 6, -0.11, -0.22, 0, cExo); // 側邊液壓桿
  bx(legL, 0.16, 0.48, 0.2, 0, -0.65, 0.02, cExo);
  bx(legL, 0.2, 0.14, 0.32, 0, -0.92, 0.08, cEarth);

  const legR = new THREE.Group();
  legR.position.set(0.18, -0.05, 0);
  hips.add(legR);
  bx(legR, 0.18, 0.45, 0.22, 0, -0.22, 0, cCamo);
  cyl(legR, 0.04, 0.04, 0.42, 6, 0.11, -0.22, 0, cExo);
  bx(legR, 0.16, 0.48, 0.2, 0, -0.65, 0.02, cExo);
  bx(legR, 0.2, 0.14, 0.32, 0, -0.92, 0.08, cEarth);

  // 左臂：展開式防彈小圓盾 (Deployable ballistic buckler shield)
  const armL = new THREE.Group();
  armL.position.set(-0.38, 0.45, 0);
  torso.add(armL);

  bx(armL, 0.18, 0.38, 0.18, 0, -0.18, 0, cCamo);
  bx(armL, 0.16, 0.36, 0.16, 0, -0.52, 0.05, cExo);

  // 防彈圓盾 (Buckler)
  const shield = new THREE.Group();
  shield.position.set(-0.12, -0.52, 0.18);
  armL.add(shield);
  shield.rotation.y = 0.3;

  cyl(shield, 0.42, 0.45, 0.08, 8, 0, 0, 0, cExo, { metalness: 0.8 }).rotation.x = Math.PI / 2;
  cyl(shield, 0.28, 0.32, 0.09, 8, 0, 0, 0.01, cCamo).rotation.x = Math.PI / 2;
  sph(shield, 0.12, 0, 0, 0.05, cCopper);

  // 右臂：持握「老戰士」特裝 12.7mm 重機槍
  const armR = new THREE.Group();
  armR.position.set(0.38, 0.45, 0);
  torso.add(armR);

  bx(armR, 0.18, 0.38, 0.18, 0, -0.18, 0, cCamo);
  bx(armR, 0.16, 0.36, 0.16, 0, -0.52, 0.12, cExo);
  armR.rotation.x = -0.45; // 舉槍瞄準

  const gunR = new THREE.Group();
  gunR.position.set(0, -0.62, 0.25);
  armR.add(gunR);

  // 12.7mm AP 重機槍槍身
  bx(gunR, 0.14, 0.22, 0.95, 0, 0, 0.15, cExo, { metalness: 0.85 });
  // 圓形彈鼓
  const drum = cyl(gunR, 0.18, 0.18, 0.14, 8, -0.14, -0.05, 0.1, cEarth);
  drum.rotation.z = Math.PI / 2;
  // 散熱多孔重槍管
  const barrel = cyl(gunR, 0.055, 0.065, 0.85, 8, 0, 0.04, 0.95, cExo, { metalness: 0.9 });
  barrel.rotation.x = Math.PI / 2;
  torus(gunR, 0.075, 0.02, 0, 0.04, 1.35, cCopper);

  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.04, 1.4);
  gunR.add(muzzle);

  g.userData.turretMuzzles = [muzzle];
  g.userData.rig = {
    kind: 'biped',
    hips,
    legL,
    legR,
    armL,
    armR,
    gunR,
    hipsY0: 0.95,
    muzzles: { light: { n: muzzle, r: 0.12 } },
  };

  return g;
}

/**
 * 6. 嘉年華武裝直升機 (carnival_heli) — 召喚者：M-06 Túlio Ferreira「狂歡節」
 * 構型：改裝重型攻擊直升機，單主旋翼配尾旋翼，重裝甲座艙澡盆，機身外掛高功率放克 PA 擴音號角陣列，旋轉火箭彈筒。
 * 塗裝：熱帶霓虹萊姆綠 (0x3ad97a) 與狂暴烈焰虎紋橙 (0xff6b35)。
 */
export function buildCarnivalHeli(side) {
  const g = new THREE.Group();
  const cLime = 0x3ad97a;      // 霓虹萊姆綠
  const cOrange = 0xff6b35;    // 狂暴虎紋橙
  const cYellow = 0xffe042;    // 耀眼黃
  const cBathtub = 0x222a22;   // 澡盆裝甲黑綠
  const cDark = 0x181e18;      // 機械深黑

  const tilt = new THREE.Group();
  g.add(tilt);

  // 主機身
  rbz(tilt, 1.45, 1.35, 3.2, 0, 1.25, 0.2, cLime, { metalness: 0.3 });
  // 烈焰虎紋條帶
  for (let z = -0.6; z <= 0.8; z += 0.5) {
    bx(tilt, 1.48, 0.28, 0.22, 0, 1.35, z, cOrange);
  }

  // 重裝甲浴盆 (Armored bathtub around cockpit)
  bx(tilt, 1.38, 0.72, 1.6, 0, 0.88, 0.95, cBathtub, { metalness: 0.75 });
  bx(tilt, 1.42, 0.18, 1.65, 0, 1.18, 0.95, cYellow); // 醒目防彈邊條

  // 階梯雙座座艙罩
  const canopy = bx(tilt, 0.92, 0.55, 1.35, 0, 1.62, 0.85, 0x111111, { metalness: 0.9 });
  canopy.rotation.x = -0.36;

  // 尾樑與垂尾
  const tailBoom = cyl(tilt, 0.35, 0.18, 3.2, 6, 0, 1.45, -2.4, cLime);
  tailBoom.rotation.x = Math.PI / 2;
  // 尾部垂直安定翼
  const tailFin = bx(tilt, 0.08, 1.1, 0.72, 0, 1.95, -3.8, cOrange);
  bx(tailFin, 0.09, 1.12, 0.12, 0, 0, 0.3, cYellow);

  // 外掛高功率放克 PA 擴音號角陣列 (Funk PA speaker array)
  for (const sx of [-1, 1]) {
    bx(tilt, 0.22, 0.14, 0.85, sx * 0.82, 1.35, 0.25, cBathtub);
    // 雙層號角擴音喇叭
    for (const sy of [-0.18, 0.18]) {
      const horn = cone(tilt, 0.24, 0.35, 8, sx * 0.98, 1.35 + sy, 0.25, cYellow);
      horn.rotation.z = -sx * (Math.PI / 2);
      glowCyl(tilt, 0.08, 0.08, 0.05, 8, sx * 1.05, 1.35 + sy, 0.25, cOrange, 1.2).rotation.z = Math.PI / 2;
    }
  }

  // 主旋翼桿與單主旋翼 (Single main rotor, 4-blade)
  cyl(tilt, 0.15, 0.18, 0.85, 8, 0, 2.25, 0.15, cDark, { metalness: 0.85 });
  const spinList = [];

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 2.65, 0.15);
  tilt.add(mainRotor);
  spinList.push(mainRotor);

  cyl(mainRotor, 0.28, 0.32, 0.16, 8, 0, 0, 0, cOrange);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    const blade = bx(mainRotor, 0.18, 0.035, 2.6, 0, 0, 1.3, cLime);
    bx(blade, 0.22, 0.045, 0.55, 0, 0, 1.0, cOrange); // 葉面虎紋
    blade.position.set(Math.sin(a) * 1.3, 0, Math.cos(a) * 1.3);
    blade.rotation.y = a + 0.06;
  }

  // 尾旋翼 (Tail rotor)
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.18, 2.05, -3.85);
  tilt.add(tailRotor);
  spinList.push(tailRotor);

  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    const tBlade = bx(tailRotor, 0.05, 0.65, 0.08, 0, 0.3, 0, cYellow);
    tBlade.position.set(-Math.sin(a) * 0.3, Math.cos(a) * 0.3, 0);
    tBlade.rotation.z = a;
  }

  // 起落架固定輪 (Heavy landing gear)
  for (const sx of [-0.65, 0.65]) {
    cyl(tilt, 0.06, 0.06, 0.65, 4, sx, 0.55, 0.8, cDark).rotation.z = sx * 0.2;
    const wheel = cyl(tilt, 0.26, 0.26, 0.18, 8, sx * 0.78, 0.26, 0.8, cDark);
    wheel.rotation.z = Math.PI / 2;
  }
  // 尾輪
  cyl(tilt, 0.16, 0.16, 0.12, 8, 0, 0.45, -2.6, cDark).rotation.z = Math.PI / 2;

  // 旋轉火箭彈筒 (Revolving rocket canister on stub pylons)
  bx(tilt, 1.85, 0.12, 0.45, 0, 0.95, 0.35, cBathtub);
  const muzzles = [];

  for (const sx of [-1, 1]) {
    const canisterGroup = new THREE.Group();
    canisterGroup.position.set(sx * 1.15, 0.88, 0.35);
    tilt.add(canisterGroup);
    spinList.push(canisterGroup); // 火箭彈筒亦可自旋

    // 6 管旋轉筒體
    const podBody = cyl(canisterGroup, 0.32, 0.32, 1.1, 8, 0, 0, 0, cOrange);
    podBody.rotation.x = Math.PI / 2;
    torus(canisterGroup, 0.32, 0.06, 0, 0, 0.55, cYellow);

    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * TAU;
      const rx = Math.sin(ang) * 0.18;
      const ry = Math.cos(ang) * 0.18;
      const tube = cyl(canisterGroup, 0.065, 0.065, 1.12, 6, rx, ry, 0, cDark);
      tube.rotation.x = Math.PI / 2;
      glowCyl(canisterGroup, 0.05, 0.05, 0.06, 6, rx, ry, 0.56, 0xff5511, 1.3).rotation.x = Math.PI / 2;
    }

    const mzNode = new THREE.Group();
    mzNode.position.set(sx * 1.15, 0.88, 0.95);
    tilt.add(mzNode);
    muzzles.push(mzNode);
  }

  g.userData.spin = spinList;
  g.userData.turretMuzzles = muzzles;
  g.userData.rig = {
    kind: 'aerial',
    tilt,
    tiltY0: 0,
    muzzles: { light: { n: muzzles[0], r: 0.22 } },
  };

  return g;
}

/**
 * 統一建構入口與尋找表
 */
export const SUMMON_BUILDERS = {
  'summon:drone_wingman': buildDroneWingman,
  'summon:assault_rover': buildAssaultRover,
  'summon:heli_squad': buildHeliSquad,
  'summon:main_battle_tank': buildMainBattleTank,
  'summon:veteran_squad': buildVeteranSquad,
  'summon:carnival_heli': buildCarnivalHeli,
};

export function buildSummonModel(kind, side) {
  const builder = SUMMON_BUILDERS[kind];
  if (builder) return builder(side);
  console.warn(`未知的自律召喚部隊型態: ${kind}，退回 drone_wingman`);
  return buildDroneWingman(side);
}
