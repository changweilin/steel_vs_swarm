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
import { toonMat, outlinify } from './toon.js';

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

/** 浮動傷害數字貼圖(不快取:數值多變,小畫布便宜) */
function numberTexture(num, color) {
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
  return tex;
}

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
  const jetFlame = (g, z, r) => {   // 尾焰:加法混色小球(描邊剔除),飛行中恆亮
    const jet = new THREE.Mesh(
      new THREE.SphereGeometry(r, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffc36b, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    jet.position.z = z;
    jet.scale.z = 1.8;
    jet.userData.noOutline = true;
    g.add(jet);
  };
  if (ty === 'missile') {
    // 飛彈:彈身 + 發光導引頭 + 十字尾翼(對稱薄盒兩片斜置即成 X)
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.05, 8), toonMat(0xcfd6dd, { celMetal: true }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.095, 0.3, 8),
      toonMat(new THREE.Color(hue).multiplyScalar(0.9).getHex(), { emissive: hue, emissiveIntensity: 0.9 }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.66;
    g.add(nose);
    for (let i = 0; i < 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.2), toonMat(0x39424b));
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
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.6, 8), toonMat(0x39424b, { celMetal: true }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      toonMat(new THREE.Color(hue).multiplyScalar(0.9).getHex(), { emissive: hue, emissiveIntensity: 0.5 }),
    );
    head.scale.z = 1.5;
    head.position.z = 0.36;
    g.add(head);
    for (let i = 0; i < 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.26, 0.14), toonMat(0x2b3239));
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
 * 餌機投彈的拋擲彈體(2026-07-22):依機體類型上色 + 專屬造型的手榴彈。
 * 幾何原點置中(呼叫端逐幀 tumble 自旋);不自行加入場景。
 * type: 'fire'|'freeze'|'poison'|'thunder'  color: DECOY_BOMB[type].color(彈殼識別色)
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
    // 雷爆彈:上下電極針
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
export function beamLine(scene, effects, from, to, color, { ttl = 0.4, w = 0.08 } = {}) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 0.01) return;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(w, w, len, 6, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  beam.position.copy(from).addScaledVector(dir, 0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  scene.add(beam);
  effects.push({
    obj: beam, ttl,
    fade(o, f) {
      o.material.opacity = 0.85 * f;
      o.scale.x = o.scale.z = 0.3 + 0.7 * f;   // 光束冷卻收細
    },
  });
}

/** AoE 衝擊環:貼地放射環,250ms 擴張到傷害半徑邊界後消散 */
export function shockRing(scene, effects, x, y, z, r, color = 0xffd27a) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 1.0, 40),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
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

/** 浮動傷害數字:命中點上飄 + 微隨機橫移,0.6s 淡出 */
export function damageNumber(scene, effects, pos, dmg, { big = false } = {}) {
  const mat = new THREE.SpriteMaterial({
    map: numberTexture(Math.round(dmg), big ? '#ff5f4a' : '#ffd94a'),
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
    // 傷害數字貼圖每發都是新 canvas,移除時要釋放 GPU 資源
    dispose() { mat.map.dispose(); mat.dispose(); },
  });
}

// ---------------- 能量護盾(六角格紋 shader)----------------
// 依計畫 Task 3.2:平時近乎透明只剩 fresnel 邊緣光,受擊瞬間整面亮起
// 六角能量格 + 波紋衰減(動漫式能量漣漪);格紋隨時間垂直流動。
const SHIELD_VERT = /* glsl */`
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vN = normalize( normalMatrix * normal );
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    vV = -mv.xyz;
    vP = position;
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = /* glsl */`
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
  }
`;

/**
 * 能量護盾半球:回傳 mesh;mesh.userData.update(dt) 每幀呼叫,
 * mesh.userData.hit() 受擊時呼叫(閃亮 + 波紋,0.5s 衰減)。
 */
export function makeShield(radius, color, yScale = 1) {
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
  mesh.scale.y = yScale;
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

/** 徑向漸層光暈貼圖(快取) */
function glowTexture() {
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
