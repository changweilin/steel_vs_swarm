// ============ 漫畫式戰鬥特效(2D Billboard in 3D)============
// 依 doc/drone_vs_robot_fps_dota_plan.html 美術參考區 + Phase 5:
//   - 擊殺/拆塔:粗體斜角漫畫字卡(BOOM!! 星形底,彈跳縮放後淡出)
//   - 命中火花:星爆 sprite,150ms 內放大淡出(非寫實、硬邊)
//   - AoE 爆炸:放射狀衝擊環,200~300ms 擴張到傷害半徑邊界
//   - 浮動傷害數字:命中點往上飄
//   - 破壞碎片:toon 小方塊/四面體放射狀噴散(重力+自旋+縮小消失)
// 特效物件全部走 game.js 的 effects 陣列({ obj, ttl, fade(o, f, dt) },
// f = 剩餘壽命比例 1→0),不自帶迴圈。
import * as THREE from 'three';
import { toonMat, outlinify, markShared, INK_INFO_DECL, INK_INFO_NONE } from './toon.js';

// ---------------- canvas 貼圖(快取)----------------
const _texCache = new Map();

/** 星形底 + 粗體斜角字的漫畫字卡貼圖 */
function comicTexture(text, hue = 45) {
  const key = `c:${text}:${hue}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const cx = S / 2, cy = S / 2;
  // 星形底(鋸齒爆炸框):外白內色、黑描邊
  const spikes = 14, R = S * 0.48, r = S * 0.30;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = (i % 2 === 0 ? R : r) * (0.92 + Math.sin(i * 7.3) * 0.08);
    i === 0 ? ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad)
            : ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = `hsl(${hue}, 95%, 60%)`;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#0a0b12';
  ctx.stroke();
  // 內圈亮心
  ctx.save();
  ctx.scale(0.72, 0.72);
  ctx.translate(cx * 0.39, cy * 0.39);
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    i === 0 ? ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad)
            : ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = `hsl(${hue + 12}, 100%, 78%)`;
  ctx.fill();
  ctx.restore();
  // 粗體斜角字(黑描邊白字,漫畫排版)
  ctx.translate(cx, cy);
  ctx.rotate(-0.13);
  ctx.font = `900 ${text.length > 6 ? 46 : 58}px "Arial Black", "Noto Sans TC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0a0b12';
  ctx.strokeText(text, 0, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 0, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

/** 細長八芒星火花貼圖(加法混色用,白心) */
function sparkTexture() {
  if (_texCache.has('spark')) return _texCache.get('spark');
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const cx = S / 2, cy = S / 2;
  ctx.translate(cx, cy);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 8; i++) {   // 8 根細長針刺(主 4 長、副 4 短)
    const len = i % 2 === 0 ? S * 0.48 : S * 0.26;
    const wid = i % 2 === 0 ? S * 0.055 : S * 0.04;
    ctx.save();
    ctx.rotate((i / 8) * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(0, -wid);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, wid);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.09, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  _texCache.set('spark', tex);
  return tex;
}

/**
 * 浮動傷害數字貼圖(**快取**:同一把武器打同一種目標,數字重複率極高)。
 * 舊版每次命中都新建 canvas + CanvasTexture ⇒ 每發一次 GPU 貼圖上傳,持續開火時
 * 在手機上就是可見的頓挫。快取上限 240 筆(逾量整批清空 —— 傷害數字是短命特效,
 * 清掉最多只是下一次重畫一張)。
 */
const _numTex = new Map();
function numberTexture(num, color) {
  const key = `${num}|${color}`;
  const hit = _numTex.get(key);
  if (hit) return hit;
  if (_numTex.size >= 240) { for (const t of _numTex.values()) t.dispose(); _numTex.clear(); }
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = '900 44px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0a0b12';
  ctx.strokeText(String(num), 64, 34);
  ctx.fillStyle = color;
  ctx.fillText(String(num), 64, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  _numTex.set(key, tex);
  return tex;
}

// ---------------- 共用單位幾何(能量體)----------------
// 光束/曳光/貫穿圓柱是**每發數十顆**的高頻特效(扇形武器一次擊發就 9~13 條)。
// 舊版每條都 `new THREE.CylinderGeometry(w, w, len, …)` ⇒ 每發配置並上傳十幾份頂點緩衝,
// 又因為移除時沒 dispose 而留在 GPU 上累積。改用「單位圓柱(r=1, h=1,原點置中)+ scale」:
// 幾何全域共用一份、永不重配,粗細/長度全靠 scale 表達。
// **MUST NOT** 對這些共用幾何呼叫 dispose(整場共用一份)。
const _UP = new THREE.Vector3(0, 1, 0);
const _FWD = new THREE.Vector3(0, 0, 1);
const _INST = new THREE.Object3D();
const _unitGeo = new Map();
const unitGeo = (key, make) => {
  let g = _unitGeo.get(key);
  // markShared:註冊給 toon.js disposeTree ⇒ 一次性特效回收時只放材質,不會誤放這份共用幾何
  if (!g) _unitGeo.set(key, g = markShared(make()));
  return g;
};
/** 單位圓柱(r=1, h=1, 開口):scale = (粗, 長, 粗) */
const unitCylinder = (seg) => unitGeo(`cyl${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, true));
/** 單位噴口錐(離子吐息喉部:槍口端粗、末端細) */
const unitThroat = () => unitGeo('throat', () => new THREE.CylinderGeometry(0.30, 1.7, 1, 14, 1, true));
/** 單位球(能量珠) */
const unitBead = () => unitGeo('bead', () => new THREE.SphereGeometry(1, 7, 5));
/** 單位環(能量環 / 衝擊環;內外徑比例固定,靠 scale 定大小) */
const unitRing = (key, ri, ro, seg) => unitGeo(key, () => new THREE.RingGeometry(ri, ro, seg));

// ---------------- 特效 ----------------
const POP_BIG = ['BOOM!!', 'KA-BOOM!', 'CRASH!!', 'WRECKED!'];
const POP_SMALL = ['POW!', 'BAM!', 'BLAM!', 'ZAP!'];

/**
 * 漫畫字卡:彈跳放大(150ms 內衝到 1.15 倍再回彈)→ 停留 → 淡出。
 * big=true 拆塔/擊殺英雄用(大字卡 + 暖色),否則小字卡。
 */
export function comicPop(scene, effects, x, y, z, { text, big = false, hue } = {}) {
  const t = text || (big ? POP_BIG : POP_SMALL)[Math.floor(Math.random() * 4)];
  const mat = new THREE.SpriteMaterial({
    map: comicTexture(t, hue ?? (big ? 18 : 48)),
    transparent: true, depthWrite: false, depthTest: false,
    rotation: (Math.random() - 0.5) * 0.5,
  });
  const sp = new THREE.Sprite(mat);
  const size = big ? 26 : 9;
  sp.position.set(x, y, z);
  sp.scale.setScalar(0.01);
  sp.renderOrder = 998;
  scene.add(sp);
  const ttl = big ? 0.9 : 0.6;
  effects.push({
    obj: sp, ttl,
    fade(o, f) {
      const p = 1 - f;                       // 0→1 進度
      const t01 = Math.min(1, p * ttl / 0.15);
      const back = 1 + 2.2 * Math.pow(t01 - 1, 3) + 1.2 * Math.pow(t01 - 1, 2); // easeOutBack
      o.scale.setScalar(size * Math.max(0.01, back));
      o.material.opacity = f < 0.3 ? f / 0.3 : 1;
    },
  });
}

/** 星爆命中火花:150ms 放大淡出 + 硬邊(加法混色) */
export function starburst(scene, effects, x, y, z, r, color = 0xffe27a) {
  const mat = new THREE.SpriteMaterial({
    map: sparkTexture(), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
    rotation: Math.random() * Math.PI,
  });
  const sp = new THREE.Sprite(mat);
  sp.position.set(x, y, z);
  sp.scale.setScalar(r * 0.4);
  scene.add(sp);
  effects.push({
    obj: sp, ttl: 0.15,
    fade(o, f) {
      o.scale.setScalar(r * (0.4 + (1 - f) * 1.8));
      o.material.opacity = f;
    },
  });
}

/**
 * 彈體工廠(2026-07-22 彈藥同源):自機 FPV 彈道、他人重武器視覺彈道、展示台重武器演出、
 * 伺服器 SAM 飛彈全部吃這一顆 —— 彈藥外觀只准在這裡定義(單一縫,與 podWeapon 掛架上的
 * 外露彈藥同語彙:彈身淺灰 / 彈頭角色識別色發光 / X 尾翼 / 尾焰)。
 * 幾何一律 +z 朝前(呼叫端以 setFromUnitVectors((0,0,1), dir) 對準航向);不自行加入場景。
 * @param def 武器定義(heroWeapon 輸出或 {type})
 * @param opts.col 陣營曳光色(動能彈)  @param opts.hue 角色識別色(彈頭)  @param opts.heavy 重武器
 */
export function projectileMesh(def, { col = 0xffd27a, hue = col, heavy = false } = {}) {
  const ty = def?.type || 'gun';
  const jetFlame = (g, z, r) => {
    // 尾焰與氣流只建兩層共享單位錐:白熱內芯 + 陣營色外暈。逐幀只改 scale/opacity,
    // 不再沿航跡配置火花 sprite；飛彈群密集時 draw call 與垃圾量都有固定上限。
    const jets = [];
    const add = (color, opacity, rad, len, dz) => {
      const jet = new THREE.Mesh(
        unitGeo('projectileJet', () => new THREE.ConeGeometry(1, 1, 8, 1, true)),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      jet.rotation.x = Math.PI / 2;
      jet.position.z = z - dz;
      jet.scale.set(rad, len, rad);
      jet.userData.noOutline = true;
      g.add(jet);
      jets.push({ mesh: jet, rad, len, opacity });
    };
    add(col, 0.32, r * 1.45, r * (heavy ? 7.5 : 6.2), r * 2.4);   // 稀薄氣流外暈
    add(0xfff1bd, 0.92, r * 0.72, r * (heavy ? 5.4 : 4.5), r * 1.7); // 白熱尾焰內芯
    g.userData.projectileFx = { jets, phase: Math.random() * Math.PI * 2 };
  };
  if (ty === 'missile') {
    // 飛彈:彈身 + 發光導引頭 + 十字尾翼(對稱薄盒兩片斜置即成 X)
    const g = new THREE.Group();
    const body = new THREE.Mesh(unitGeo('missileBody', () => new THREE.CylinderGeometry(0.09, 0.09, 1.05, 8)), toonMat(0xcfd6dd, { celMetal: true }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(
      unitGeo('missileNose', () => new THREE.ConeGeometry(0.095, 0.3, 8)),
      toonMat(new THREE.Color(hue).multiplyScalar(0.9).getHex(), { emissive: hue, emissiveIntensity: 0.9 }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.66;
    g.add(nose);
    for (let i = 0; i < 2; i++) {
      const fin = new THREE.Mesh(unitGeo('missileFin', () => new THREE.BoxGeometry(0.02, 0.34, 0.2)), toonMat(0x39424b));
      fin.position.z = -0.42;
      fin.rotation.z = Math.PI / 4 + i * Math.PI / 2;
      g.add(fin);
    }
    outlinify(g, 0.03);
    jetFlame(g, -0.6, 0.11);
    return g;
  }
  if (ty === 'launcher') {
    // 火箭/榴彈:短粗彈身 + 外露彈頭(podWeapon 溫壓彈頭同語彙)+ 小尾翼
    const g = new THREE.Group();
    const body = new THREE.Mesh(unitGeo('launcherBody', () => new THREE.CylinderGeometry(0.11, 0.1, 0.6, 8)), toonMat(0x39424b, { celMetal: true }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const head = new THREE.Mesh(
      unitGeo('launcherHead', () => new THREE.SphereGeometry(0.14, 8, 6)),
      toonMat(new THREE.Color(hue).multiplyScalar(0.9).getHex(), { emissive: hue, emissiveIntensity: 0.5 }),
    );
    head.scale.z = 1.5;
    head.position.z = 0.36;
    g.add(head);
    for (let i = 0; i < 2; i++) {
      const fin = new THREE.Mesh(unitGeo('launcherFin', () => new THREE.BoxGeometry(0.016, 0.26, 0.14)), toonMat(0x2b3239));
      fin.position.z = -0.26;
      fin.rotation.z = Math.PI / 4 + i * Math.PI / 2;
      g.add(fin);
    }
    outlinify(g, 0.03);
    jetFlame(g, -0.42, 0.09);
    return g;
  }
  // 動能彈(gun/rail):曳光條 —— 與第三人稱曳光束同色;重武器(反器材/磁軌)更長更亮
  const m = new THREE.Mesh(
    heavy ? new THREE.BoxGeometry(0.14, 0.14, 2.2) : new THREE.BoxGeometry(0.09, 0.09, 1.4),
    new THREE.MeshBasicMaterial(heavy
      ? { color: col, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }
      : { color: col }),
  );
  m.userData.noOutline = true;
  return m;
}

/**
 * 飛行彈體尾焰唯一更新縫。只改既有子網格，不配置粒子、不影響彈道或命中。
 * age 使用呼叫端既有飛行時間；speed 僅控制視覺拉伸，絕不回寫權威速度。
 */
export function stepProjectileFx(projectile, age = 0, speed = 0) {
  const fx = projectile?.userData?.projectileFx;
  if (!fx) return;
  const thrust = 0.82 + Math.min(1, Math.max(0, speed) / 260) * 0.28;
  for (let i = 0; i < fx.jets.length; i++) {
    const j = fx.jets[i];
    const flick = 1 + Math.sin(age * (31 + i * 7) + fx.phase + i * 1.9) * (i ? 0.09 : 0.15);
    j.mesh.scale.set(j.rad * (0.92 + flick * 0.08), j.len * thrust * flick, j.rad * (0.92 + flick * 0.08));
    j.mesh.material.opacity = j.opacity * (0.82 + flick * 0.18);
  }
}

/**
 * 餌機投彈的拋擲彈體(2026-07-22):依機體類型上色 + 專屬造型的手榴彈。
 * 幾何原點置中(呼叫端逐幀 tumble 自旋);不自行加入場景。
 * type: 'fire'|'freeze'|'poison'|'thunder'  color: DECOY_BOMB[type].color(彈殼識別色;thunder = 閃光彈)
 */
export function decoyBombMesh(type, color = 0xff6a2a) {
  const g = new THREE.Group();
  const dark = new THREE.Color(color).multiplyScalar(0.55).getHex();
  // 彈殼(圓潤彈體)+ 頂部保險蓋(引信)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8),
    toonMat(dark, { celMetal: true, emissive: color, emissiveIntensity: 0.35 }));
  body.scale.y = 1.15;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.22, 8), toonMat(0x2b3239, { celMetal: true }));
  cap.position.y = 0.46;
  g.add(cap);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.12), toonMat(0x9aa2a8, { celMetal: true }));
  lever.position.set(0.14, 0.42, 0);
  g.add(lever);
  // 類型專屬識別造型(投擲中一眼可辨)
  if (type === 'fire') {
    // 燃燒彈:頂部竄出的加法火苗
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb457, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.position.y = 0.72; fl.userData.noOutline = true;
    g.add(fl);
  } else if (type === 'freeze') {
    // 凍結彈:放射冰晶尖刺
    for (let i = 0; i < 5; i++) {
      const sh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16),
        toonMat(0xbfeaff, { emissive: 0x8fd8ff, emissiveIntensity: 0.5 }));
      const a = (i / 5) * Math.PI * 2;
      sh.position.set(Math.cos(a) * 0.42, 0.05 + Math.sin(i * 2) * 0.12, Math.sin(a) * 0.42);
      sh.scale.set(1, 1.7, 1);
      g.add(sh);
    }
  } else if (type === 'poison') {
    // 毒霧彈:側掛三顆毒氣囊
    for (let i = 0; i < 3; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6),
        toonMat(0x6fbf46, { emissive: 0x8fe36a, emissiveIntensity: 0.45 }));
      const a = (i / 3) * Math.PI * 2;
      bulb.position.set(Math.cos(a) * 0.4, -0.05, Math.sin(a) * 0.4);
      g.add(bulb);
    }
  } else if (type === 'thunder') {
    // 閃光彈:上下電極針
    for (let i = 0; i < 2; i++) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.5, 6),
        toonMat(0xfff3a0, { emissive: 0xffe14f, emissiveIntensity: 0.7 }));
      rod.position.set((i ? 0.24 : -0.24), 0.3, 0);
      rod.rotation.z = (i ? -1 : 1) * 0.4;
      g.add(rod);
    }
  }
  outlinify(g, 0.03);
  return g;
}

/**
 * 氣旋噴射尾流(2026-07-22 巨炮砲彈):附掛在砲彈子體(+z 朝前)底下的旋轉渦輪葉片 + 熾亮尾焰。
 * 呼叫端逐幀轉 rotation.z(自旋)並另撒螺旋煙圈(見 game._updateBullets 的 cyclone 分支);
 * 純加法混色、userData.noOutline。回傳 Group(不自行加入場景)。
 */
export function cycloneJet(color = 0xffd27a) {
  const g = new THREE.Group();
  g.userData.noOutline = true;
  const mat = () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  // 3 片後掠渦輪葉:繞行進軸環列 → 自旋即成氣旋
  for (let i = 0; i < 3; i++) {
    const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.4), mat());
    const a = (i / 3) * Math.PI * 2;
    vane.position.set(Math.cos(a) * 0.32, Math.sin(a) * 0.32, -0.3);
    vane.rotation.z = a;
    vane.rotation.y = 0.6;   // 後掠角:葉面斜切氣流
    g.add(vane);
  }
  // 熾亮尾焰(比一般彈體尾焰長且亮)
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  jet.rotation.x = -Math.PI / 2;   // 錐尖朝 -z(尾部)
  jet.position.z = -1.0;
  jet.userData.noOutline = true;
  g.add(jet);
  return g;
}

/** 能量光束:兩點間的發光圓柱(雷射/磁軌/電漿焰舌;展示台與戰場共用) */
// op:不透明度(預設 0.85)。滿寬的貫穿通道要壓低,否則整根實心柱子會把畫面糊掉。
export function beamLine(scene, effects, from, to, color, { ttl = 0.4, w = 0.08, op = 0.85 } = {}) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 0.01) return;
  const beam = new THREE.Mesh(
    unitCylinder(6),   // 共用單位圓柱:粗細/長度靠 scale(不再每條配一份幾何)
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: op,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  beam.scale.set(w, len, w);
  beam.userData.noOutline = true;
  beam.position.copy(from).addScaledVector(dir, 0.5);
  beam.quaternion.setFromUnitVectors(_UP, dir.normalize());
  scene.add(beam);
  effects.push({
    obj: beam, ttl,
    fade(o, f) {
      o.material.opacity = op * f;
      o.scale.x = o.scale.z = w * (0.3 + 0.7 * f);   // 光束冷卻收細
    },
  });
}

// ================= 直線貫穿(line)/ 扇形離子(fan)的範圍演出 =================
// 使用者定案(2026-07-23):「根據砲彈類型要明顯做出範圍傷害的效果動畫」;
// 光束類參考鋼彈動畫(熾白內芯 + 飽和外暈 + 沿軸行進的能量環 + 落點綻放),
// 離子類參考哥吉拉離子吐息(噴口錐 + 螺旋纏繞能量帶 + 末端灼燒)。
// 兩者都吃 game.js 的 effects 陣列,不自帶迴圈;一律 additive + noOutline(A14 toon 描邊排除)。

/** 加法混色材質(能量體共用;不參與描邊、不寫深度) */
function energyMat(color, opacity = 0.85) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}
/** 沿 from→to 架一根圓柱(回傳 Mesh,已定位定向;len<0.01 回傳 null;幾何共用單位圓柱) */
function axisCylinder(from, to, r, color, opacity) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 0.01) return null;
  const m = new THREE.Mesh(unitCylinder(10), energyMat(color, opacity));
  m.scale.set(r, len, r);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(_UP, dir.clone().normalize());
  m.userData.noOutline = true;
  return m;
}

/**
 * 光束砲(鋼彈式 mega beam / beam rifle):
 *   熾白內芯 + 飽和外暈雙層圓柱(外暈收縮、內芯延遲熄滅)+ 槍口衝擊環 +
 *   沿軸「行進」的能量環(rings 個,由槍口衝向落點)+ 落點綻放。
 * r = 圓柱半徑(= 伺服器 LANCE.R 的貫穿半徑)⇒ **看到多粗就是打到多粗**,不是裝飾。
 */
export function gundamBeam(scene, effects, from, to, color, { r = 3.6, ttl = 0.5, rings = 4, core = 0xffffff } = {}) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 0.01) return;
  const axis = dir.clone().normalize();
  // 外暈:與貫穿半徑同寬,由滿寬收細 = 能量潰散
  // 幾何一律共用單位體 ⇒ scale 內含半徑 r(舊版把 r 烤進幾何,fade 的 scale 才是純比例)
  const halo = axisCylinder(from, to, r, color, 0.42);
  if (halo) {
    scene.add(halo);
    effects.push({ obj: halo, ttl, fade(o, f) { o.material.opacity = 0.42 * f; o.scale.x = o.scale.z = r * (0.25 + 0.75 * f); } });
  }
  // 熾白內芯:細、亮、撐得比外暈久一點(鋼彈光束的「殘光」)
  const cr = r * 0.28;
  const cm = axisCylinder(from, to, cr, core, 0.95);
  if (cm) {
    scene.add(cm);
    effects.push({ obj: cm, ttl: ttl * 1.15, fade(o, f) { o.material.opacity = 0.95 * f * f; o.scale.x = o.scale.z = cr * (0.2 + 0.8 * f); } });
  }
  // 槍口衝擊環 + 沿軸能量環共用一個 InstancedMesh。環數硬上限 9，避免大範圍招式
  // 以子網格數線性放大 draw call；第 0 環仍以白芯 instanceColor 區分。
  const count = Math.max(1, Math.min(9, Math.round(rings) + 1));
  const ring = new THREE.InstancedMesh(unitRing('beamRing', 0.55, 0.95, 24), energyMat(color, 0.9), count);
  ring.userData.noOutline = true;
  ring.frustumCulled = false;
  ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) ring.setColorAt(i, new THREE.Color(i === 0 ? core : color));
  ring.instanceColor.needsUpdate = true;
  scene.add(ring);
  const ringFx = {
    obj: ring, ttl: ttl * 0.9,
    fade(o, f) {
      for (let i = 0; i < count; i++) {
        const t0 = i / count;
        const p = Math.min(1, t0 + (1 - f) * 1.15);
        _INST.position.copy(from).addScaledVector(axis, p * len);
        _INST.quaternion.setFromUnitVectors(_FWD, axis);
        _INST.scale.setScalar(r * (1 + p * 0.9));
        _INST.updateMatrix();
        o.setMatrixAt(i, _INST.matrix);
      }
      o.instanceMatrix.needsUpdate = true;
      o.material.opacity = 0.9 * f;
    },
  };
  ringFx.fade(ring, 1);
  effects.push(ringFx);
  starburst(scene, effects, to.x, to.y, to.z, r * 1.6, core);
  starburst(scene, effects, to.x, to.y, to.z, r * 2.4, color);
}

/**
 * 離子吐息(哥吉拉式 atomic breath;扇形離子重武器的主噴流):
 *   噴口錐(近粗遠細的能量喉)+ coil 條螺旋纏繞的能量帶(繞射線旋進)+ 末端灼燒綻放。
 * 扇形的「越近越強」由伺服器 fanFalloff 結算 —— 這裡以噴口最粗、末端收束把它畫出來。
 */
export function ionBreath(scene, effects, from, to, color, { r = 2.2, ttl = 0.45, coil = 3, core = 0xffffff } = {}) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 0.01) return;
  const axis = dir.clone().normalize();
  // 噴口喉:錐形(**槍口端最粗、末端收束**)—— 這是吐息與雷射最大的外形差異,
  // 同時也是扇形「越近越強」(fanFalloff)的可視化。
  const throat = new THREE.Mesh(unitThroat(), energyMat(color, 0.45));
  throat.scale.set(r, len, r);
  throat.position.copy(from).addScaledVector(dir, 0.5);
  throat.quaternion.setFromUnitVectors(_UP, axis);
  throat.userData.noOutline = true;
  scene.add(throat);
  effects.push({ obj: throat, ttl, fade(o, f) { o.material.opacity = 0.45 * f; o.scale.x = o.scale.z = r * (0.45 + 0.55 * f); } });
  // 熾芯
  const cm = axisCylinder(from, to, r * 0.24, core, 0.9);
  if (cm) {
    scene.add(cm);
    effects.push({ obj: cm, ttl: ttl * 0.85, fade(o, f) { o.material.opacity = 0.9 * f * f; } });
  }
  const up = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const nx = new THREE.Vector3().crossVectors(axis, up).normalize();
  const nz = new THREE.Vector3().crossVectors(axis, nx).normalize();
  // 螺旋纏繞能量帶:沿軸切段的小球排成螺線並逐幀旋進 = 吐息的翻騰感。
  // 螺線半徑刻意**大於喉部**(1.05→1.9×)⇒ 從側面看得到能量帶繞在噴流外,不是貼在管壁上的點。
  const SEG = 10;
  const coilN = Math.max(1, Math.min(4, Math.round(coil)));
  const beadN = SEG * coilN;
  const beads = new THREE.InstancedMesh(unitBead(), energyMat(color, 0.8), beadN);
  beads.userData.noOutline = true;
  beads.frustumCulled = false;
  beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let c = 0; c < coilN; c++) for (let i = 0; i < SEG; i++) {
    beads.setColorAt(c * SEG + i, new THREE.Color(c === 0 ? core : color));
  }
  beads.instanceColor.needsUpdate = true;
  scene.add(beads);
  const beadFx = {
    obj: beads, ttl,
    fade(o, f) {
      for (let c = 0; c < coilN; c++) for (let i = 0; i < SEG; i++) {
        const ix = c * SEG + i;
        const t0 = (i + 0.5) / SEG;
        const ph = (c / coilN) * Math.PI * 2 + t0 * Math.PI * 3 + (1 - f) * 7;
        const rad = r * (1.9 - 1.35 * t0);
        _INST.position.copy(from).addScaledVector(axis, t0 * len)
          .addScaledVector(nx, Math.cos(ph) * rad).addScaledVector(nz, Math.sin(ph) * rad);
        _INST.quaternion.identity();
        _INST.scale.setScalar(r * (0.42 - 0.26 * t0));
        _INST.updateMatrix();
        o.setMatrixAt(ix, _INST.matrix);
      }
      o.instanceMatrix.needsUpdate = true;
      o.material.opacity = 0.8 * f;
    },
  };
  beadFx.fade(beads, 1);
  effects.push(beadFx);
  // 放電弧:自噴流表面往外劈的短折線(離子吐息的招牌;近噴口最密最長)
  const arcN = 7;
  const arcs = new THREE.InstancedMesh(unitCylinder(10), energyMat(core, 0.9), arcN);
  arcs.userData.noOutline = true;
  arcs.frustumCulled = false;
  for (let i = 0; i < arcN; i++) {
    const t0 = (i + 0.4) / 7;
    const ph = i * 2.3;
    const rad = r * (1.9 - 1.35 * t0);
    const p0 = from.clone().addScaledVector(axis, t0 * len)
      .addScaledVector(nx, Math.cos(ph) * rad).addScaledVector(nz, Math.sin(ph) * rad);
    const p1 = p0.clone()
      .addScaledVector(nx, Math.cos(ph + 0.6) * r * (1.5 - t0))
      .addScaledVector(nz, Math.sin(ph + 0.6) * r * (1.5 - t0))
      .addScaledVector(axis, (0.5 - (i % 2)) * r);
    const d = p1.sub(p0);
    _INST.position.copy(p0).addScaledVector(d, 0.5);
    _INST.quaternion.setFromUnitVectors(_UP, d.clone().normalize());
    _INST.scale.set(r * 0.07, d.length(), r * 0.07);
    _INST.updateMatrix();
    arcs.setMatrixAt(i, _INST.matrix);
  }
  arcs.instanceMatrix.needsUpdate = true;
  scene.add(arcs);
  effects.push({ obj: arcs, ttl: ttl * 0.45, fade(o, f) { o.material.opacity = 0.9 * f; } });
  starburst(scene, effects, to.x, to.y, to.z, r * 2.0, core);
  starburst(scene, effects, from.x, from.y, from.z, r * 1.7, core);   // 噴口綻放
}

/** AoE 衝擊環:貼地放射環,250ms 擴張到傷害半徑邊界後消散 */
export function shockRing(scene, effects, x, y, z, r, color = 0xffd27a) {
  const ring = new THREE.Mesh(
    unitRing('shock', 0.72, 1.0, 40),   // 內外徑固定 → 整場共用一份幾何
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.userData.noOutline = true;
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y + 0.6, z);
  ring.scale.setScalar(r * 0.15);
  scene.add(ring);
  effects.push({
    obj: ring, ttl: 0.28,
    fade(o, f) {
      o.scale.setScalar(r * (0.15 + (1 - f) * 1.05));   // 擴張到半徑邊界略外
      o.material.opacity = 0.95 * f;
    },
  });
}

/**
 * 命中節拍唯一入口:接觸白芯 → 色彩綻放 → 重擊衝擊環。所有尺寸皆由呼叫端既有
 * 武器/招式演出半徑推導；不讀寫傷害、命中或鏡頭狀態。
 */
export function impactBurst(scene, effects, pos, { r = 1.6, color = 0xffd27a, core = 0xffffff, heavy = false } = {}) {
  starburst(scene, effects, pos.x, pos.y, pos.z, r * (heavy ? 0.72 : 1), core);
  if (!heavy) return;
  starburst(scene, effects, pos.x, pos.y, pos.z, r, color);
  shockRing(scene, effects, pos.x, pos.y, pos.z, r, color);
}

/** 浮動傷害數字:命中點上飄 + 微隨機橫移,0.6s 淡出。
 *  text:覆寫顯示字面(灰字)—— 打無敵幀目標的「-0」等零傷害回饋用,與一般數字同一條快取。 */
export function damageNumber(scene, effects, pos, dmg, { big = false, text = null } = {}) {
  const mat = new THREE.SpriteMaterial({
    map: numberTexture(text ?? Math.round(dmg), text ? '#aab4bd' : (big ? '#ff5f4a' : '#ffd94a')),
    transparent: true, depthWrite: false, depthTest: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.position.copy(pos);
  const s = big ? 5 : 3;
  sp.scale.set(s * 2, s, 1);
  sp.renderOrder = 999;
  scene.add(sp);
  const vx = (Math.random() - 0.5) * 2.5;
  effects.push({
    obj: sp, ttl: 0.6,
    fade(o, f, dt) {
      o.position.y += dt * 6;
      o.position.x += vx * dt;
      o.material.opacity = f < 0.5 ? f / 0.5 : 1;
    },
    // 貼圖已改為快取共用(numberTexture),MUST NOT 在這裡 dispose —— 只釋放本次的材質
    dispose() { mat.dispose(); },
  });
}

// ---------------- 能量護盾(六角格紋 shader)----------------
// 依計畫 Task 3.2:平時近乎透明只剩 fresnel 邊緣光,受擊瞬間整面亮起
// 六角能量格 + 波紋衰減(動漫式能量漣漪);格紋隨時間垂直流動。
const SHIELD_VERT = /* glsl */`
  #include <common>
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vN = normalize( normalMatrix * normal );
    // 世界曲面(toon.js installWorldCurve):護盾泡泡是全專案**唯二**自寫頂點著色器的東西,
    // 天生吃不到 project_vertex 的那一刀 ⇒ 得自己呼叫同一支 worldCurve。少了這一行,
    // 遠處被護盾罩住的機體會沉下去、泡泡留在原處 = 罩子與機體脫開,而且沒有任何錯誤訊息。
    // (另一個自寫的是 environment.js 的天空穹頂 —— 那一個**本來就該**留在無限遠。)
    // ⚠ 這一段註解裡 MUST NOT 出現反引號:整支 SHIELD_VERT 是 JS 樣板字串,
    //    註解裡的反引號會直接把字串結束掉(2026-08-09 實測:整支 vfx.js 當場語法錯誤)。
    vec4 _sw = modelMatrix * vec4( position, 1.0 );
    _sw.xyz = worldCurve( _sw.xyz, cameraPosition );
    vec4 mv = viewMatrix * _sw;
    vV = -mv.xyz;
    vP = position;
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = /* glsl */`
  ${INK_INFO_DECL}
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlash;   // 受擊 1 → 0 衰減
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;

  float hexDist( vec2 p ) {
    p = abs( p );
    return max( dot( p, vec2( 0.8660254, 0.5 ) ), p.x );
  }
  float hexEdge( vec2 uv ) {
    vec2 r = vec2( 1.0, 1.7320508 );
    vec2 h = r * 0.5;
    vec2 a = mod( uv, r ) - h;
    vec2 b = mod( uv - h, r ) - h;
    vec2 gv = dot( a, a ) < dot( b, b ) ? a : b;
    return smoothstep( 0.38, 0.48, hexDist( gv ) );   // 六角格「邊線」
  }
  void main() {
    vec3 N = normalize( vN );
    vec3 V = normalize( vV );
    float fres = pow( 1.0 - abs( dot( N, V ) ), 2.2 );
    // 以柱面座標鋪六角格,隨時間往上流動
    vec2 uv = vec2( atan( vP.z, vP.x ) * 3.2, vP.y * 0.55 - uTime * 0.35 ) * 3.0;
    float edge = hexEdge( uv );
    // 受擊波紋:自頂向下掃過的亮帶
    float ripple = uFlash * smoothstep( 0.25, 0.0, abs( fract( vP.y * 0.04 + uTime * 1.6 ) - 0.5 ) - 0.2 );
    float glow = edge * ( 0.25 + uFlash * 1.4 ) + fres * 0.55 + ripple;
    float alpha = 0.05 + edge * 0.08 + fres * 0.22 + uFlash * ( 0.30 + edge * 0.45 );
    gl_FragColor = vec4( uColor * ( 0.6 + glow * 1.8 ), alpha );
    ${INK_INFO_NONE}   // 半透明加成殼不該畫輪廓線:寫哨兵 0(見 toon.js 的材質契約)
  }
`;

/**
 * 工事(塔/主堡)受擊回饋殼:回傳 mesh;mesh.userData.update(dt) 每幀呼叫,
 * mesh.userData.hit() 受擊時呼叫(閃亮 + 波紋,約 1.1s 衰減後自行收起)。
 *
 * **這不是「護盾」**:塔/主堡在 sim 裡沒有 `sp` 那一層(`sp`/`maxSp` 只掛在英雄機體上,
 * `shieldSplit` 對非英雄一律以 sp=0 呼叫)⇒ 亮起來的時機其實是**裝甲掉血**。
 * 它的功能只有一個:遠距離擊中 26m 的塔 / 40 幾 m 的主堡時,把「這一發打中了」畫出來
 * (工事沒有受擊動作、血條在頭頂,單看曳光分不出打中還是擦過)。
 *
 * 尺寸 MUST 由呼叫端餵**權威命中量體**(`hitR`/`hitH`),MUST NOT 手寫(原則 4:
 * 看到多大 = 打到多大)。舊制手寫 r=30 / yScale=1.5,而主堡的 hitR 只有 20 ——
 * 殼比實際打得到的範圍寬了 50%,浮在主堡上空像個與任何機制都無關的球面輪廓。
 * @param radius 命中量體水平半徑(赤道半徑)
 * @param height 命中量體垂直帶高度(極半徑;殼頂 = 腳底 + height)
 *   —— 半橢球內接於「hitR × hitH」那根圓柱 ⇒ 偏差恆朝「畫得比打得到的小」(原則 6)。
 */
export function makeHitShell(radius, height, color) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SHIELD_VERT,
    fragmentShader: SHIELD_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: Math.random() * 10 },
      uFlash: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    mat,
  );
  mesh.scale.y = height / radius;   // 推導不手寫:頂點恰好落在命中量體上緣
  mesh.renderOrder = 10;
  mesh.userData.noOutline = true;
  mesh.visible = false;   // 平時不存在;受擊才浮現(閃亮 → 淡出 → 收起)
  mesh.userData.update = (dt) => {
    if (!mesh.visible) return;
    mat.uniforms.uTime.value += dt;
    const f = mat.uniforms.uFlash.value - dt * 0.9;
    mat.uniforms.uFlash.value = Math.max(0, f);
    if (f <= 0) mesh.visible = false;
  };
  mesh.userData.hit = () => { mesh.visible = true; mat.uniforms.uFlash.value = 1; };
  return mesh;
}

// ---------------- 破壞碎片(機械殘骸噴散)----------------
const _chunkGeos = [
  new THREE.BoxGeometry(1, 0.5, 0.8),
  new THREE.BoxGeometry(0.5, 1.1, 0.4),
  new THREE.TetrahedronGeometry(0.7),
  new THREE.CylinderGeometry(0.28, 0.28, 0.9, 6),
];
const _chunkMats = [0x51565b, 0x3a4148, 0x6d757c, 0x2c3238].map((c) => toonMat(c, { celMetal: true }));

/**
 * 機械碎片爆散:radial impulse + 重力 + 自旋,最後 30% 壽命縮小despawn。
 * big=true(塔/主堡/坦克)碎片更多更大。
 */
export function debrisBurst(scene, effects, x, y, z, { big = false, accent } = {}) {
  const n = big ? 14 : 7;
  const g = new THREE.Group();
  const chunks = [];
  const accMat = accent != null ? toonMat(accent, { emissive: accent, emissiveIntensity: 0.35 }) : null;
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(
      _chunkGeos[i % _chunkGeos.length],
      (accMat && i % 4 === 3) ? accMat : _chunkMats[i % _chunkMats.length],
    );
    const sc = (big ? 1.6 : 0.7) * (0.6 + Math.random() * 0.9);
    mesh.scale.setScalar(sc);
    mesh.position.set(x, y, z);
    const th = Math.random() * Math.PI * 2;
    const up = 6 + Math.random() * (big ? 22 : 12);
    const out = (big ? 14 : 8) * (0.4 + Math.random());
    chunks.push({
      mesh, sc,
      vel: new THREE.Vector3(Math.cos(th) * out, up, Math.sin(th) * out),
      ang: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
    });
    g.add(mesh);
  }
  scene.add(g);
  const groundY = y - 2;
  effects.push({
    obj: g, ttl: big ? 1.4 : 1.0,
    // 碎塊的幾何與材質是模組級共用池(_chunkGeos/_chunkMats)⇒ 回收時什麼都不能 dispose;
    // 只有 accent 那份是本次新建的,單獨釋放。
    dispose: () => accMat?.dispose(),
    fade(o, f, dt) {
      for (const c of chunks) {
        c.vel.y -= 32 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        if (c.mesh.position.y < groundY) {   // 落地彈跳一下並吃掉速度
          c.mesh.position.y = groundY;
          c.vel.y *= -0.35;
          c.vel.x *= 0.6; c.vel.z *= 0.6;
        }
        c.mesh.rotation.x += c.ang.x * dt;
        c.mesh.rotation.y += c.ang.y * dt;
        c.mesh.rotation.z += c.ang.z * dt;
        if (f < 0.3) c.mesh.scale.setScalar(c.sc * (f / 0.3));   // 最後 30% 縮小消失
      }
    },
  });
}

// ---------------- 損傷特效(冒煙 / 裂痕 / 失火)----------------
// 建築/單位受損視覺化,兩階遞進:
//   階段1(HP ≤ LIGHT_F):淺灰煙 + 暗色裂痕
//   階段2(HP ≤ HEAVY_F):濃黑煙 + 熾裂痕 + 火舌 + 飛濺火星(破損失火)
// 純客戶端表現層 —— 不進 sim / raycast(A6);掛在 ent.mesh 底下隨機體移動/旋轉/顯隱,
// _removeEnt 移除 mesh 時一併消失。動畫由 game.js 每幀呼叫 userData.update(dt, now)。
export const DMG_FX = { LIGHT_F: 0.5, HEAVY_F: 0.25 };

/** 軟邊煙團貼圖(快取):中心不透明 → 外緣淡出 */
function smokeTexture() {
  if (_texCache.has('smoke')) return _texCache.get('smoke');
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const gr = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  _texCache.set('smoke', tex);
  return tex;
}

/** 裂痕貼圖(快取):透明底上一組由中心放射的鋸齒白線(材質 color 決定明暗:暗色=裂縫、加色橙=熾裂) */
function crackTexture() {
  if (_texCache.has('crack')) return _texCache.get('crack');
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const cx = S / 2, cy = S / 2;
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  // 三條主裂縫,各自鋸齒延伸並分岔
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2 + (i * 1.7);
    ctx.lineWidth = 6 - i;
    let x = cx, y = cy, a = a0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const seg = 5 + (i % 2);
    for (let s = 0; s < seg; s++) {
      a += (Math.sin(i * 3.1 + s * 2.3)) * 0.7;
      const step = S * 0.11;
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      ctx.lineTo(x, y);
      if (s === 2) {   // 分岔一支
        const bx = x + Math.cos(a + 1.1) * step * 1.4, by = y + Math.sin(a + 1.1) * step * 1.4;
        ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  _texCache.set('crack', tex);
  return tex;
}

/**
 * 受損特效群組。dims = 呼叫端量好的基準包圍盒 { r 半徑, top 頂高, h 全高 }。
 * 回傳 Group 掛在 ent.mesh 底下;setStage(1|2) 切階、update(dt, now) 逐幀動畫。
 */
export function makeDamageFx({ r = 2, top = 3, h = 3 }) {
  const g = new THREE.Group();
  g.userData.noOutline = true;
  const rr = Math.max(0.8, r);
  const plumeH = Math.min(20, Math.max(3, h * 1.3));

  // --- 煙柱:錯開相位循環上升的軟邊 sprite ---
  const smokeBaseY = top * 0.55, smokeTex = smokeTexture();
  const smoke = [];
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTex, transparent: true, opacity: 0, depthWrite: false,
    }));
    sp.userData.ph = i / 4;                        // 相位 0..1(錯開)
    sp.userData.jx = (Math.random() - 0.5) * rr;
    sp.userData.jz = (Math.random() - 0.5) * rr;
    g.add(sp);
    smoke.push(sp);
  }

  // --- 裂痕:貼在機體外緣、朝外的鋸齒白線板(材質 color 上暗) ---
  const crackTex = crackTexture();
  const cracks = [], hotCracks = [];
  const CN = 5;
  for (let i = 0; i < CN; i++) {
    const a = (i / CN) * Math.PI * 2 + Math.random() * 0.8;
    const y = top * (0.3 + Math.random() * 0.45);
    const w = rr * (0.4 + Math.random() * 0.28), ht = h * (0.2 + Math.random() * 0.18);
    const px = Math.cos(a) * rr * 0.44, pz = Math.sin(a) * rr * 0.44;   // 貼近軸心:窄身機體的裂痕不飄出輪廓外
    const mkPlane = (color, additive) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), new THREE.MeshBasicMaterial({
        map: crackTex, color, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      m.position.set(px, y, pz);
      m.rotation.set((Math.random() - 0.5) * 0.7, Math.atan2(px, pz), (Math.random() - 0.5) * 1.5);
      return m;
    };
    const dark = mkPlane(0x141416, false);
    g.add(dark); cracks.push(dark);
    const hot = mkPlane(0xff5a1e, true);   // 熾裂(階段2疊在暗裂之上)
    hot.visible = false;
    g.add(hot); hotCracks.push(hot);
  }

  // --- 火舌(階段2):機體中下段閃爍的圓錐 ---
  const flames = [];
  const flameBaseY = top * 0.28;
  for (let i = 0; i < 3; i++) {
    const fh = h * (0.28 + Math.random() * 0.18);
    const f = new THREE.Mesh(new THREE.ConeGeometry(rr * (0.18 + Math.random() * 0.1), fh, 6),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffa826 : 0xff5a1e, transparent: true, opacity: 0.85, depthWrite: false }));
    const a = Math.random() * Math.PI * 2, d = rr * Math.random() * 0.55;
    f.userData.h0 = fh;
    f.userData.baseY = flameBaseY;
    f.userData.px = Math.cos(a) * d; f.userData.pz = Math.sin(a) * d;
    f.userData.ph = Math.random() * Math.PI * 2;
    f.position.set(f.userData.px, flameBaseY + fh / 2, f.userData.pz);
    f.visible = false;
    g.add(f);
    flames.push(f);
  }

  // --- 火星(階段2):additive 小亮點,快速循環上飄 ---
  const embers = [], emberTex = glowTexture();
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: emberTex, color: 0xffb24a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.scale.setScalar(rr * 0.28);
    sp.userData.ph = Math.random();
    sp.userData.jx = (Math.random() - 0.5) * rr;
    sp.userData.jz = (Math.random() - 0.5) * rr;
    sp.userData.spd = 0.7 + Math.random() * 0.5;
    sp.visible = false;
    g.add(sp);
    embers.push(sp);
  }

  g.userData.stage = 1;
  g.userData.setStage = (s) => {
    g.userData.stage = s;
    const heavy = s >= 2;
    for (const f of flames) f.visible = heavy;
    for (const hc of hotCracks) hc.visible = heavy;
    for (const em of embers) em.visible = heavy;
    // 暗裂:階段1露前 3 道,階段2全露(破損加劇)
    cracks.forEach((c, i) => { c.visible = heavy || i < 3; });
  };

  g.userData.update = (dt, now) => {
    const heavy = g.userData.stage >= 2;
    // 煙:濃黑(重傷)/ 淺灰(輕傷),循環上升淡出
    const smCol = heavy ? 0x2a2a2e : 0x6f757c;
    const opMax = heavy ? 0.62 : 0.44, scEnd = rr * (heavy ? 1.9 : 1.3);
    for (const sp of smoke) {
      sp.userData.ph = (sp.userData.ph + dt * 0.33) % 1;
      const p = sp.userData.ph;
      sp.position.set(sp.userData.jx * (0.4 + p), smokeBaseY + p * plumeH, sp.userData.jz * (0.4 + p));
      sp.scale.setScalar(rr * 0.5 + p * scEnd);
      sp.material.opacity = opMax * Math.sin(p * Math.PI);
      sp.material.color.setHex(smCol);
    }
    if (!heavy) return;
    for (const f of flames) {
      const k = 0.7 + 0.35 * Math.sin(now * 9 + f.userData.ph) + 0.12 * Math.sin(now * 23 + f.userData.ph * 2);
      f.scale.set(1, k, 1);
      f.position.y = f.userData.baseY + f.userData.h0 * k / 2;
    }
    for (const em of embers) {
      em.userData.ph = (em.userData.ph + dt * em.userData.spd) % 1;
      const p = em.userData.ph;
      em.position.set(em.userData.jx * (0.3 + p), flameBaseY + p * plumeH * 0.9, em.userData.jz * (0.3 + p));
      em.material.opacity = 0.9 * (1 - p);
    }
    for (const hc of hotCracks) hc.material.opacity = 0.55 + 0.35 * Math.sin(now * 6 + hc.position.y);
  };

  g.userData.setStage(1);
  return g;
}

// ---------------- 準星鎖定光暈(常駐,由 game.js 掛/卸)----------------
/**
 * 掛在目標 mesh 底下的鎖定光暈:脈動的加成混合光球 + 腳下旋轉環。
 * 走 onBeforeRender 自更新(不進 effects 陣列 —— 它不會自己過期)。
 * 回傳的 Group 由呼叫端 remove() 卸除。
 */
export function lockGlow(target, color = 0xffffff, dims = null) {
  // 尺寸優先吃呼叫端的「基準包圍盒」(掛護盾殼/血條/標記之前量的):
  // 塔/主堡的 Box3 會被 11~30m 的護盾殼撐大 → 光暈飄成巨球。無 dims 才退回現量。
  let h, halfR, top;
  if (dims) {
    h = dims.h; halfR = dims.r; top = dims.top ?? dims.h;
  } else {
    const box = new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3());
    h = size.y; halfR = Math.max(size.x, size.z) / 2; top = size.y;
  }
  const r = Math.max(1.5, halfR * 1.5);              // 腳下環半徑基準 ≈ 機體外緣
  const D = Math.max(3, Math.max(h, halfR * 2) * 1.15);   // 光暈直徑 = 機體高/寬取大 ×1.15:剛好罩住
  const g = new THREE.Group();
  g.userData.noOutline = true;

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }));
  halo.scale.setScalar(D);
  halo.position.y = top - h * 0.5;                   // 機體幾何中心(不是「高度一半」假設原點在腳)
  g.add(halo);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r * 1.05, r * 1.35, 4, 1),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  g.add(ring);

  g.onBeforeRender = () => {
    const now = performance.now();
    const t = now / 1000;
    const p = 0.5 + 0.5 * Math.sin(t * 6);
    // 命中閃爍:呼叫端設 userData.flashAt(performance.now()),之後 FLASH_MS 內額外增亮放大、線性衰減
    const fl = Math.max(0, 1 - (now - (g.userData.flashAt || -1e9)) / 200);
    halo.material.opacity = Math.min(1, 0.3 + p * 0.35 + fl * 0.6);
    halo.scale.setScalar(D * (0.92 + p * 0.16 + fl * 0.55));
    ring.material.opacity = Math.min(1, 0.9 + fl * 0.6);
    ring.rotation.z = t * 1.6;
    ring.scale.setScalar(0.94 + p * 0.12 + fl * 0.45);
  };
  target.add(g);
  return g;
}

/** 徑向漸層光暈貼圖(快取;lockGlow 與 game.js 射程光暈共用同一份 —— A25 整場共用,MUST NOT dispose) */
export function glowTexture() {
  if (_texCache.has('glow')) return _texCache.get('glow');
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const gr = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  _texCache.set('glow', tex);
  return tex;
}

/** 黑森林神木防線:自地下拔地而起的神木群 */
export function spawnTreesVFX(scene, effects, { x, z, trees, dur = 8 }) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const treeList = trees || [
    { x, z: z + 4.8, r: 2.0, h: 9 },
    { x: x - 4.15, z: z - 2.4, r: 2.0, h: 9 },
    { x: x + 4.15, z: z - 2.4, r: 2.0, h: 9 },
  ];
  const woodMat = toonMat(0x4a2e18);
  const leafMat = toonMat(0x23522c);
  for (const t of treeList) {
    const tg = new THREE.Group();
    tg.position.set(t.x - x, 0, t.z - z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.7, t.r, t.h * 0.5, 8), woodMat);
    trunk.position.y = t.h * 0.25;
    tg.add(trunk);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(t.r * 2.2, t.h * 0.75, 8), leafMat);
    canopy.position.y = t.h * 0.65;
    tg.add(canopy);
    g.add(tg);
  }
  g.scale.set(1, 0.05, 1);
  scene.add(g);
  let elapsed = 0;
  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      elapsed += dt;
      if (elapsed < 0.4) {
        const p = elapsed / 0.4;
        o.scale.y = 0.05 + 0.95 * p;
      } else {
        o.scale.y = 1;
      }
      if (f < 0.2) {
        o.scale.x = o.scale.z = f / 0.2;
      }
    },
  });
}

/** 暗月引爆:浮空月岩與引力漩渦 */
export function spawnDarkMoonVFX(scene, effects, { x, z, y = 4.5, r = 3.5, dur = 3.5 }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), toonMat(0x8a92a5));
  g.add(moonMesh);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r * 1.3, r * 1.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xc8d8ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  scene.add(g);
  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      moonMesh.rotation.y += dt * 1.5;
      moonMesh.rotation.x += dt * 0.5;
      ring.rotation.z += dt * 2.5;
      const pulse = 1 + Math.sin((dur - f * dur) * 8) * 0.08;
      o.scale.setScalar(pulse);
    },
  });
}

/** 幾何神碑:法老立方石板牢籠 */
export function spawnCubicSlabsVFX(scene, effects, { x, z, r = 5.5, dur = 5 }) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const slabMat = toonMat(0xd2b77a);
  const runeMat = new THREE.MeshBasicMaterial({ color: 0xffe28a });
  for (let k = 0; k < 6; k++) {
    const ang = (k * Math.PI) / 3;
    const sx = Math.cos(ang) * r, sz = Math.sin(ang) * r;
    const sg = new THREE.Group();
    sg.position.set(sx, 3, sz);
    sg.rotation.y = -ang + Math.PI / 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.5, 6, 0.4), slabMat);
    sg.add(slab);
    const rune = new THREE.Mesh(new THREE.BoxGeometry(2.2, 4.5, 0.42), runeMat);
    sg.add(rune);
    g.add(sg);
  }
  g.scale.set(1, 0.05, 1);
  scene.add(g);
  let elapsed = 0;
  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      elapsed += dt;
      if (elapsed < 0.3) {
        o.scale.y = 0.05 + 0.95 * (elapsed / 0.3);
      } else {
        o.scale.y = 1;
      }
      if (f < 0.15) {
        o.scale.x = o.scale.z = f / 0.15;
      }
    },
  });
}

/** 荒原天幕:戰術迷霧 */
export function spawnFogVFX(scene, effects, { x, z, r = 35, dur = 8, isAlly = true }) {
  const g = new THREE.Group();
  g.position.set(x, 0.5, z);
  const fogColor = isAlly ? 0x7fa8d8 : 0x4a5568;
  const baseOpacity = isAlly ? 0.28 : 0.85;
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(r, 24),
    new THREE.MeshBasicMaterial({ color: fogColor, transparent: true, opacity: baseOpacity, side: THREE.DoubleSide })
  );
  disk.rotation.x = -Math.PI / 2;
  g.add(disk);
  for (let i = 0; i < 5; i++) {
    const cloud = new THREE.Mesh(
      new THREE.RingGeometry(r * (0.2 + i * 0.15), r * (0.4 + i * 0.15), 16),
      new THREE.MeshBasicMaterial({ color: fogColor, transparent: true, opacity: baseOpacity * 0.7, side: THREE.DoubleSide })
    );
    cloud.rotation.x = -Math.PI / 2;
    cloud.position.y = 1 + i * 0.8;
    g.add(cloud);
  }
  scene.add(g);
  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      o.rotation.y += dt * 0.2;
      const op = f > 0.2 ? baseOpacity : baseOpacity * (f / 0.2);
      disk.material.opacity = op;
    },
  });
}

/** 天律鎖定：動能穿刺重索視覺演出 */
export function spawnHarpoonVFX(scene, effects, { fx, fy = 1.5, fz, tx, ty = 1.5, tz, hit = false }) {
  const g = new THREE.Group();
  const vFrom = new THREE.Vector3(fx, fy, fz);
  const vTo = new THREE.Vector3(tx, ty, tz);
  const dist = vFrom.distanceTo(vTo);

  const cableGeo = new THREE.CylinderGeometry(0.08, 0.08, Math.max(0.1, dist), 6);
  cableGeo.translate(0, dist / 2, 0);
  cableGeo.rotateX(Math.PI / 2);
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x90e0ef, transparent: true, opacity: 0.9 });
  const cable = new THREE.Mesh(cableGeo, cableMat);
  cable.position.copy(vFrom);
  cable.lookAt(vTo);
  g.add(cable);

  if (hit) {
    starburst(scene, effects, tx, ty, tz, 8, 0xffd166);
    impactBurst(scene, effects, tx, ty, tz, 0x00f5d4);
  }

  scene.add(g);
  effects.push({
    obj: g, ttl: 0.35,
    fade(o, f, dt) {
      cable.scale.z = Math.max(0.05, f);
      cableMat.opacity = f * 0.9;
    },
  });
}

/** 極化偏轉：鏡面防衛矩陣 (120° 偏轉護盾) */
export function spawnReflectBarrierVFX(scene, effects, { getPos, ry = 0, dur = 3.0 }) {
  const g = new THREE.Group();
  const arcR = 3.2;
  const arcAngle = (120 * Math.PI) / 180;
  const shieldGeo = new THREE.CylinderGeometry(arcR, arcR, 3.5, 24, 1, true, -arcAngle / 2, arcAngle);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x66e0ff,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
  shieldMesh.rotation.y = Math.PI / 2;
  g.add(shieldMesh);

  const innerGeo = new THREE.CylinderGeometry(arcR * 0.95, arcR * 0.95, 3.2, 16, 1, true, -arcAngle / 2, arcAngle);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.rotation.y = Math.PI / 2;
  g.add(innerMesh);

  scene.add(g);
  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      if (getPos) {
        const p = getPos();
        if (p) {
          o.position.set(p.x, p.y + 1.6, p.z);
          o.rotation.y = p.ry || ry;
        }
      }
      const pulse = 0.5 + 0.3 * Math.sin((dur - f * dur) * 12);
      shieldMat.opacity = Math.min(f / 0.2, 1) * pulse;
      innerMat.opacity = Math.min(f / 0.2, 1) * pulse * 0.6;
    },
  });
}

/** 量子命運：同調共振鏈 (多目標共振射線) */
export function spawnEntangleLinkVFX(scene, effects, { getPositions, dur = 6.0 }) {
  const g = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xb5179e,
    transparent: true,
    opacity: 0.85,
  });
  const geo = new THREE.BufferGeometry();
  const line = new THREE.LineSegments(geo, lineMat);
  g.add(line);
  scene.add(g);

  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      const pts = getPositions ? getPositions() : [];
      if (pts.length >= 2) {
        const segs = [];
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            segs.push(pts[i].x, (pts[i].y || 1) + 1.2, pts[i].z);
            segs.push(pts[j].x, (pts[j].y || 1) + 1.2, pts[j].z);
          }
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      }
      lineMat.opacity = Math.min(f / 0.2, 1) * (0.6 + 0.3 * Math.sin((dur - f * dur) * 15));
    },
  });
}

/** 地熱拒止：熔核地雷標記 */
export function spawnThermiteMinesVFX(scene, effects, { mines }) {
  const g = new THREE.Group();
  const mineMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });

  for (const m of mines) {
    const mg = new THREE.Group();
    mg.position.set(m.x, m.y || 0.15, m.z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.2, 8), mineMat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), coreMat);
    light.position.y = 0.15;
    mg.add(body);
    mg.add(light);
    g.add(mg);
  }
  scene.add(g);
  const dur = mines[0]?.dur || 12;
  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      const flash = (Math.sin((dur - f * dur) * 8) > 0) ? 1 : 0.2;
      coreMat.opacity = flash;
    },
  });
}

/** 地熱拒止：熔核溫壓焦土火場 */
export function spawnThermitePuddleVFX(scene, effects, { x, z, y = 0.1, r = 6, dur = 5 }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const circle = new THREE.Mesh(
    new THREE.CircleGeometry(r, 24),
    new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
  );
  circle.rotation.x = -Math.PI / 2;
  g.add(circle);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.55, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd000, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.05;
  g.add(inner);

  scene.add(g);
  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      const op = Math.min(f / 0.2, 1);
      circle.material.opacity = op * (0.55 + 0.15 * Math.sin(f * 25));
      inner.material.opacity = op * (0.75 + 0.2 * Math.sin(f * 35));
    },
  });
}

/** 相位穿梭：虛空超維步 */
export function spawnPhaseShiftVFX(scene, effects, { getPos, dur = 1.8 }) {
  const g = new THREE.Group();
  const sphereMat = new THREE.MeshBasicMaterial({
    color: 0x9b5de5,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
  });
  const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(2.5, 2), sphereMat);
  g.add(sphere);
  scene.add(g);

  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      if (getPos) {
        const p = getPos();
        if (p) o.position.set(p.x, p.y + 1.5, p.z);
      }
      sphere.rotation.x += dt * 3;
      sphere.rotation.y += dt * 4;
      sphereMat.opacity = Math.min(f / 0.15, 1) * 0.6;
    },
  });
}

/** 相位現身震波 */
export function spawnPhaseExitVFX(scene, effects, { x, z, y = 0, r = 6 }) {
  shockRing(scene, effects, x, y, z, r, 0x9b5de5);
  starburst(scene, effects, x, y + 1.2, z, r * 1.2, 0xf15bb5);
}

/** 全息干涉：幻影突擊信標 (全息無人機) */
export function spawnDecoyBeaconVFX(scene, effects, { id, x, z, y = 2.0, ry = 0, dur = 6 }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  const holoMat = new THREE.MeshBasicMaterial({
    color: 0x00f5d4,
    wireframe: true,
    transparent: true,
    opacity: 0.65,
  });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 4), holoMat);
  body.rotation.x = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 0.8), holoMat);
  g.add(body);
  g.add(wing);
  scene.add(g);

  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      o.position.x -= Math.sin(ry) * dt * 18;
      o.position.z += Math.cos(ry) * dt * 18;
      holoMat.opacity = (Math.sin(f * 40) > -0.7 ? 0.65 : 0.15) * Math.min(f / 0.15, 1);
    },
  });
}

/** 全息信標殉爆閃光彈 */
export function spawnFlashbangVFX(scene, effects, { x, z, y = 2, r = 14 }) {
  starburst(scene, effects, x, y, z, r * 1.5, 0xffffff);
  shockRing(scene, effects, x, y - 1.8, z, r, 0x00f5d4);
}

/** 噬甲蟲群：納米病毒雲 */
export function spawnNaniteSwarmVFX(scene, effects, { getPos, dur = 4.0 }) {
  const g = new THREE.Group();
  const pCount = 20;
  const pts = [];
  for (let i = 0; i < pCount; i++) {
    pts.push((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0x76ff03,
    size: 0.25,
    transparent: true,
    opacity: 0.85,
  });
  const cloud = new THREE.Points(geo, pMat);
  g.add(cloud);
  scene.add(g);

  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      if (getPos) {
        const p = getPos();
        if (p) o.position.set(p.x, p.y + 1.2, p.z);
      }
      cloud.rotation.y += dt * 5;
      cloud.rotation.x += dt * 3;
      pMat.opacity = Math.min(f / 0.2, 1) * 0.85;
    },
  });
}

/** 噬甲蟲群：破體分裂轉移軌跡 */
export function spawnNaniteSplitVFX(scene, effects, { fx, fz, tx, tz }) {
  const g = new THREE.Group();
  const v1 = new THREE.Vector3(fx, 1.2, fz);
  const v2 = new THREE.Vector3(tx, 1.2, tz);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([v1, v2]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x76ff03, transparent: true, opacity: 0.9 });
  g.add(new THREE.Line(lineGeo, lineMat));
  scene.add(g);
  effects.push({
    obj: g, ttl: 0.35,
    fade(o, f, dt) {
      lineMat.opacity = f * 0.9;
    },
  });
}

/** 重力塌縮：微型奇點透鏡 */
export function spawnSingularityVFX(scene, effects, { x, z, y = 2, dur = 3.0, r = 18 }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x05010a })
  );
  g.add(core);

  const disk = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 3.8, 24),
    new THREE.MeshBasicMaterial({ color: 0x7209b7, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  disk.rotation.x = Math.PI / 3;
  g.add(disk);

  const outer = new THREE.Mesh(
    new THREE.RingGeometry(3.9, 4.4, 24),
    new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  outer.rotation.x = Math.PI / 3;
  g.add(outer);

  scene.add(g);
  effects.push({
    obj: g, ttl: dur,
    fade(o, f, dt) {
      disk.rotation.z += dt * 6;
      outer.rotation.z -= dt * 4;
      const s = 1 + (1 - f) * 0.5;
      o.scale.set(s, s, s);
    },
  });
}

/** 奇點引爆坍縮衝擊波 */
export function spawnSingularityImplosionVFX(scene, effects, { x, z, y = 2, r = 18 }) {
  starburst(scene, effects, x, y, z, r * 1.4, 0x7209b7);
  shockRing(scene, effects, x, y - 1.8, z, r, 0x4cc9f0);
}

// ════════════ 異常狀態 3D 動態效果與頭頂標示 (2026-09-04) ════════════
const _statusBadgeCache = new Map();
const BADGE_DEFS = [
  { bit: 1, key: 'pz', label: '麻痺', icon: '⚡', color: '#ffea00', border: '#ffe600', bg: 'rgba(35, 30, 0, 0.9)' },
  { bit: 2, key: 'emp', label: '癱瘓', icon: '🚫', color: '#c084fc', border: '#a855f7', bg: 'rgba(25, 10, 40, 0.9)' },
  { bit: 4, key: 'sl', label: '緩速', icon: '❄️', color: '#66e0ff', border: '#00ccff', bg: 'rgba(0, 25, 40, 0.9)' },
  { bit: 8, key: 'cf', label: '混亂', icon: '💫', color: '#f472b6', border: '#ec4899', bg: 'rgba(35, 10, 30, 0.9)' },
  { bit: 16, key: 'bl', label: '持續傷害', icon: '🩸', color: '#ff4d4f', border: '#f5222d', bg: 'rgba(40, 10, 10, 0.9)' },
  { bit: 32, key: 'vb', label: '致盲', icon: '👁️', color: '#cbd5e1', border: '#94a3b8', bg: 'rgba(20, 24, 30, 0.9)' },
  { bit: 64, key: 'mk', label: '標記', icon: '🎯', color: '#ff3333', border: '#ff0000', bg: 'rgba(40, 0, 0, 0.9)' },
  { bit: 128, key: 'ub', label: '失衡', icon: '⚠️', color: '#fb923c', border: '#f97316', bg: 'rgba(40, 20, 0, 0.9)' },
  { bit: 256, key: 'hs', label: '壓制', icon: '⬇️', color: '#facc15', border: '#ca8a04', bg: 'rgba(35, 28, 0, 0.9)' },
];

function getStatusBadgeTexture(sig, badges) {
  if (typeof document === 'undefined') return { tex: null, w: 1, h: 1 };
  if (_statusBadgeCache.has(sig)) return _statusBadgeCache.get(sig);
  const n = badges.length;
  const badgeW = 96, badgeH = 34, pad = 6;
  const W = Math.max(128, n * badgeW + (n + 1) * pad);
  const H = 48;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  let curX = (W - (n * badgeW + (n - 1) * pad)) / 2;
  const curY = (H - badgeH) / 2;
  for (const b of badges) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(curX, curY, badgeW, badgeH, 6);
    else ctx.rect(curX, curY, badgeW, badgeH);
    ctx.fillStyle = b.bg || 'rgba(10, 14, 20, 0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = b.border || '#ffffff';
    ctx.stroke();

    ctx.font = 'bold 15px "Noto Sans TC", "PingFang TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = b.color || '#ffffff';
    ctx.fillText(`${b.icon || ''} ${b.label}`, curX + badgeW / 2, curY + badgeH / 2 + 1);
    curX += badgeW + pad;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const res = { tex, w: W / 32, h: H / 32 };
  _statusBadgeCache.set(sig, res);
  return res;
}

// 模組級共用單例材質與幾何 (Rule A25 / markShared: 嚴禁逐機體重複配置與釋放)
let _statusSharedReady = false;
let _matStunLine, _matSlowRing, _matSlowIce, _matEmp1, _matEmp2;
let _matConfStar, _matBlindSmoke, _matBleedDrop, _matMarkRing, _matUnbalRing, _matSupRing;

function initStatusShared() {
  if (_statusSharedReady) return;
  _statusSharedReady = true;
  _matStunLine = new THREE.LineBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0.95 });
  _matSlowRing = new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  _matSlowIce = new THREE.MeshBasicMaterial({ color: 0xa0e7ff, transparent: true, opacity: 0.85 });
  _matEmp1 = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.85 });
  _matEmp2 = new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, opacity: 0.85 });
  _matConfStar = new THREE.MeshBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.95 });
  _matBlindSmoke = new THREE.SpriteMaterial({
    map: smokeTexture(), color: 0x18181b, transparent: true, opacity: 0.85, depthWrite: false,
  });
  _matBleedDrop = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.9 });
  _matMarkRing = new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  _matUnbalRing = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  _matSupRing = new THREE.MeshBasicMaterial({ color: 0xeab308, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
}

/**
 * 為機體建立完整的異常狀態動態動畫與頭頂看版標示
 * 回傳 Group 掛在 ent.mesh 底下;update(dt, now, st) 逐幀更新、dispose() 釋放資源。
 * isMajor: 僅主角/英雄/BOSS 啟用高解析度頭頂看板標示，一般小兵省略看板以省下大量 draw call 與 canvas 合成。
 */
export function makeStatusFx({ r = 1.8, top = 2.8, h = 2.4, isMajor = true }) {
  initStatusShared();
  const g = new THREE.Group();
  g.userData.noOutline = true;
  const rr = Math.max(0.8, r);

  // 1. 麻痺電弧 (pz): 預分配頂點陣列，原地更新數值，消除每幀 new Vector3 與 setFromPoints
  const stunGroup = new THREE.Group();
  const stunLines = [];
  const stunCount = isMajor ? 4 : 1;
  for (let i = 0; i < stunCount; i++) {
    const pos = new Float32Array(9); // 3 個頂點
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pos, 3);
    geo.setAttribute('position', posAttr);
    const line = new THREE.Line(geo, _matStunLine);
    line.frustumCulled = false;
    stunGroup.add(line);
    stunLines.push({ line, geo, posAttr });
  }
  stunGroup.visible = false;
  g.add(stunGroup);

  // 2. 緩速冰霜環 (sl): 共用單位環與冰塊幾何
  const slowGroup = new THREE.Group();
  const slowRing = new THREE.Mesh(
    unitRing('statusSlowRing', 0.7, 1.3, 20),
    _matSlowRing
  );
  slowRing.scale.set(rr, rr, 1);
  slowRing.rotation.x = -Math.PI / 2;
  slowRing.position.y = 0.12;
  slowGroup.add(slowRing);
  const slowIceCubes = [];
  if (isMajor) {
    const iceGeo = unitGeo('statusIceBox', () => new THREE.BoxGeometry(0.28, 0.28, 0.28));
    for (let i = 0; i < 3; i++) {
      const ice = new THREE.Mesh(iceGeo, _matSlowIce);
      slowGroup.add(ice);
      slowIceCubes.push(ice);
    }
  }
  slowGroup.visible = false;
  g.add(slowGroup);

  // 3. 電磁癱瘓 (emp): 共用環面幾何
  const empGroup = new THREE.Group();
  const empTorus1 = new THREE.Mesh(
    unitGeo('statusEmpTorus1', () => new THREE.TorusGeometry(1.15, 0.04, 6, 24)),
    _matEmp1
  );
  empTorus1.scale.set(rr, rr, rr);
  empTorus1.position.y = top * 0.5;
  empGroup.add(empTorus1);
  let empTorus2 = null;
  if (isMajor) {
    empTorus2 = new THREE.Mesh(
      unitGeo('statusEmpTorus2', () => new THREE.TorusGeometry(1.05, 0.04, 6, 24)),
      _matEmp2
    );
    empTorus2.scale.set(rr, rr, rr);
    empTorus2.position.y = top * 0.5;
    empGroup.add(empTorus2);
  }
  empGroup.visible = false;
  g.add(empGroup);

  // 4. 混亂公轉眩暈星 (cf): 共用八面體幾何
  const confGroup = new THREE.Group();
  confGroup.position.y = top + 0.4;
  const starGeo = unitGeo('statusConfStar', () => new THREE.OctahedronGeometry(0.22, 0));
  const stars = [];
  const starCount = isMajor ? 3 : 1;
  for (let i = 0; i < starCount; i++) {
    const st = new THREE.Mesh(starGeo, _matConfStar);
    confGroup.add(st);
    stars.push(st);
  }
  confGroup.visible = false;
  g.add(confGroup);

  // 5. 致盲黑煙 (vb): 共用煙霧精靈
  const blindGroup = new THREE.Group();
  blindGroup.position.y = top * 0.85;
  const smokePuffs = [];
  const smokeCount = isMajor ? 2 : 1;
  for (let i = 0; i < smokeCount; i++) {
    const sp = new THREE.Sprite(_matBlindSmoke);
    const s = rr * 1.5;
    sp.scale.set(s, s, s);
    blindGroup.add(sp);
    smokePuffs.push(sp);
  }
  blindGroup.visible = false;
  g.add(blindGroup);

  // 6. 持續傷害/流血/燃燒/中毒 (bl): 共用球體幾何
  const bleedGroup = new THREE.Group();
  const bleedGeo = unitGeo('statusBleedSphere', () => new THREE.SphereGeometry(0.12, 6, 6));
  const bleedDrops = [];
  const dropCount = isMajor ? 5 : 1;
  for (let i = 0; i < dropCount; i++) {
    const drop = new THREE.Mesh(bleedGeo, _matBleedDrop);
    bleedGroup.add(drop);
    bleedDrops.push({
      mesh: drop,
      rx: (Math.random() - 0.5) * rr * 0.8,
      rz: (Math.random() - 0.5) * rr * 0.8,
      ph: Math.random(),
    });
  }
  bleedGroup.visible = false;
  g.add(bleedGroup);

  // 7. 定位標記 (mk): 共用 4 段環面 (菱形準星)
  const markGroup = new THREE.Group();
  markGroup.position.y = top + 1.1;
  const markRing = new THREE.Mesh(
    unitRing('statusMarkRing', 0.45, 0.55, 4),
    _matMarkRing
  );
  markRing.scale.set(rr, rr, 1);
  markRing.rotation.z = Math.PI / 4;
  markGroup.add(markRing);
  markGroup.visible = false;
  g.add(markGroup);

  // 8. 失衡震盪 (ub): 共用地表擴散環
  const unbalGroup = new THREE.Group();
  const unbalRing = new THREE.Mesh(
    unitRing('statusUnbalRing', 0.4, 0.7, 18),
    _matUnbalRing
  );
  unbalRing.scale.set(rr, rr, 1);
  unbalRing.rotation.x = -Math.PI / 2;
  unbalRing.position.y = 0.08;
  unbalGroup.add(unbalRing);
  unbalGroup.visible = false;
  g.add(unbalGroup);

  // 9. 壓制 (hs): 共用重壓指示環
  const supGroup = new THREE.Group();
  supGroup.position.y = top * 0.6;
  const supRing = new THREE.Mesh(
    unitRing('statusSupRing', 0.8, 0.95, 16),
    _matSupRing
  );
  supRing.scale.set(rr, rr, 1);
  supRing.rotation.x = -Math.PI / 2;
  supGroup.add(supRing);
  supGroup.visible = false;
  g.add(supGroup);

  // 10. 頭頂 3D 看板標示 (Status Billboard Badge): 僅 major 機體實裝
  let badgeSprite = null;
  if (isMajor) {
    badgeSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true, depthWrite: false, depthTest: false,
    }));
    badgeSprite.position.y = top + 2.0;
    badgeSprite.renderOrder = 998;
    badgeSprite.visible = false;
    g.add(badgeSprite);
  }

  let lastMask = 0;

  const update = (dt, now, st) => {
    // 檢查各狀態剩餘時間
    const pz = (st.pz || 0) > 0;
    const sl = (st.sl || 0) > 0;
    const emp = (st.emp || 0) > 0;
    const cf = (st.cf || 0) > 0;
    const vb = (st.vb || 0) > 0;
    const bl = (st.bl || 0) > 0;
    const mk = (st.mk || 0) > 0;
    const ub = (st.ub || 0) > 0;
    const hs = (st.hs || 0) > 0;

    // 麻痺電弧 (原地更新 Float32Array, 零 GC)
    stunGroup.visible = pz;
    if (pz) {
      for (let j = 0; j < stunLines.length; j++) {
        const item = stunLines[j];
        const arr = item.posAttr.array;
        arr[0] = (Math.random() - 0.5) * rr * 1.5; arr[1] = Math.random() * top; arr[2] = (Math.random() - 0.5) * rr * 1.5;
        arr[3] = (Math.random() - 0.5) * rr * 1.5; arr[4] = Math.random() * top; arr[5] = (Math.random() - 0.5) * rr * 1.5;
        arr[6] = (Math.random() - 0.5) * rr * 1.5; arr[7] = Math.random() * top; arr[8] = (Math.random() - 0.5) * rr * 1.5;
        item.posAttr.needsUpdate = true;
      }
    }

    // 緩速冰霜
    slowGroup.visible = sl;
    if (sl) {
      slowRing.rotation.z += dt * 1.2;
      for (let i = 0; i < slowIceCubes.length; i++) {
        const a = now * 1.8 + (i * Math.PI * 2) / 3;
        slowIceCubes[i].position.set(Math.cos(a) * (rr * 0.9), 0.25 + 0.1 * Math.sin(now * 3 + i), Math.sin(a) * (rr * 0.9));
        slowIceCubes[i].rotation.x += dt * 2;
        slowIceCubes[i].rotation.y += dt * 2;
      }
    }

    // 電磁癱瘓
    empGroup.visible = emp;
    if (emp) {
      empTorus1.rotation.x += dt * 3.5;
      empTorus1.rotation.y += dt * 2.1;
      if (empTorus2) {
        empTorus2.rotation.y -= dt * 3.0;
        empTorus2.rotation.z += dt * 1.8;
      }
      const s = 1.0 + 0.12 * Math.sin(now * 10);
      empGroup.scale.set(s, s, s);
    }

    // 混亂眩暈星
    confGroup.visible = cf;
    if (cf) {
      for (let i = 0; i < stars.length; i++) {
        const a = now * 3.6 + (i * Math.PI * 2) / 3;
        stars[i].position.set(Math.cos(a) * (rr * 0.85), 0.15 * Math.sin(now * 6 + i * 2), Math.sin(a) * (rr * 0.85));
        stars[i].rotation.y += dt * 5;
      }
    }

    // 致盲煙霧
    blindGroup.visible = vb;
    if (vb) {
      blindGroup.rotation.y += dt * 0.8;
    }

    // 流血灼燒
    bleedGroup.visible = bl;
    if (bl) {
      for (let j = 0; j < bleedDrops.length; j++) {
        const item = bleedDrops[j];
        item.ph = (item.ph + dt * 1.4) % 1.0;
        const dy = (1.0 - item.ph) * (top * 0.8);
        item.mesh.position.set(item.rx, dy, item.rz);
        item.mesh.scale.setScalar(Math.sin(item.ph * Math.PI) * 1.2);
      }
    }

    // 標記
    markGroup.visible = mk;
    if (mk) {
      markGroup.rotation.y += dt * 2.5;
      const ms = 1.0 + 0.18 * Math.sin(now * 8);
      markGroup.scale.set(ms, ms, ms);
    }

    // 失衡
    unbalGroup.visible = ub;
    if (ub) {
      const ubP = (now * 2.2) % 1.0;
      unbalRing.scale.setScalar(rr * (1.0 + ubP * 1.6));
    }

    // 壓制
    supGroup.visible = hs;
    if (hs) {
      supGroup.position.y = (top * 0.8) - ((now * 1.8) % 1.0) * (top * 0.5);
    }

    // 狀態遮罩比對: 若非 major 機體或遮罩未變更，完全跳過銘牌與字串/陣列配置
    if (!badgeSprite) return;

    let mask = 0;
    if (pz) mask |= 1;
    if (emp) mask |= 2;
    if (sl) mask |= 4;
    if (cf) mask |= 8;
    if (bl) mask |= 16;
    if (vb) mask |= 32;
    if (mk) mask |= 64;
    if (ub) mask |= 128;
    if (hs) mask |= 256;

    if (mask === 0) {
      if (lastMask !== 0) {
        badgeSprite.visible = false;
        lastMask = 0;
      }
    } else if (mask !== lastMask) {
      lastMask = mask;
      const activeBadges = [];
      for (let i = 0; i < BADGE_DEFS.length; i++) {
        if ((mask & BADGE_DEFS[i].bit) !== 0) activeBadges.push(BADGE_DEFS[i]);
      }
      const curSig = String(mask);
      const res = getStatusBadgeTexture(curSig, activeBadges);
      badgeSprite.material.map = res.tex;
      badgeSprite.material.needsUpdate = true;
      badgeSprite.scale.set(res.w, res.h, 1);
      badgeSprite.visible = true;
    }
  };

  const dispose = () => {
    // 專屬 BufferGeometry (內嵌 TypedArray) 需顯式釋放
    for (let j = 0; j < stunLines.length; j++) stunLines[j].geo.dispose();
    if (badgeSprite) badgeSprite.material.dispose();
    // 其餘幾何與材質均為 markShared 共用單例,嚴禁 dispose 以免破壞其他實體
    if (g.parent) g.parent.remove(g);
  };

  g.userData.update = update;
  g.userData.dispose = dispose;
  return g;
}
