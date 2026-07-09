// ============ 地被覆蓋層:開闊地的賽璐璐地表精修(doc/botw_plan.html)============
// 無障礙的空曠地面也要有「畫上去的地表」:依地貌分類鋪設特徵色塊(patch)+
// 立體細節,取代裸露衛星照片質感。23 種地表 × 每種 3 變體貼圖,像無限隨機花磚:
//   綠地   — 草皮 / 芒草原 / 灌木叢 / 水田 / 旱田 / 花田 / 果園 / 茶園
//   裸露地 — 荒野 / 碎石 / 沙漠風沙 / 越野泥地 / 龜裂旱地 / 紅土地
//   市區   — 草坪 / 水泥地 / 磚瓦地 / PU 球場 / 停車場 / 人行道磚 / 跑道
//   濕地   — 泥灘蘆葦 / 荷塘
// 無縫拼接三原則(避免大面積重複感,無限延伸):
//   1. 自然類 edge:'fade' — 外圈頂點 alpha 淡出,與水彩化衛星底圖(或彼此)交融
//   2. tile 型 UV 用世界座標投影 + 鏡射重複:同類相鄰 patch 花紋自動連續延伸
//   3. 變體以低頻雜訊分區指派(鄰近同變體)+ 每 patch 色調抖動 + 家族延伸擺放
//      (農田拼布/運動園區/綠地群落),异類交疊也讀不出拼貼邊界
// 手法與 buildRoads 同族:貼地多邊形 + 程序生成 canvas 筆刷貼圖 + 頂點色墨線,
// 每「地表×變體」合併成單一 Mesh(常數 draw call);細節物件全 InstancedMesh。
// 純視覺:不進射擊 raycast、不描邊、不產生碰撞柱(空地依然自由通行)。
// 亂數決定性:呼叫端傳入以戰場中心為種子的 rnd + seed,全房間一致。
import * as THREE from 'three';
import { ENV } from './data.js';
import { toonMat, envMat } from './toon.js';

const MAX_DETAIL = 3200;   // 3D 細節實例總上限
const VARIANTS = 3;        // 每種地表的貼圖變體數

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 低頻值雜訊:subtype / 變體分區(鄰近 patch 同類同變體 → 連片延伸不斷紋)
function vnoise(x, z, seed) {
  const h = (i, j) => {
    let n = ((i * 374761393 + j * 668265263) ^ seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x), zi = Math.floor(z);
  let fx = x - xi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - fx) + h(xi + 1, zi) * fx) * (1 - fz)
       + (h(xi, zi + 1) * (1 - fx) + h(xi + 1, zi + 1) * fx) * fz;
}

// ---- 程序生成地表筆刷貼圖(固定種子;「地表#變體」為鍵快取共用)----
const _texCache = new Map();
function groundTex(sub, variant, fit) {
  const key = `${sub}#${variant}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  let hs = 0;
  for (let i = 0; i < key.length; i++) hs = (hs * 31 + key.charCodeAt(i)) | 0;
  PAINTERS[sub](cv.getContext('2d'), S, mulberry32(0x67D0 ^ hs));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  // 鏡射重複:筆刷特徵跨磚無接縫(fit 型單張鋪滿,不重複)
  t.wrapS = t.wrapT = fit ? THREE.ClampToEdgeWrapping : THREE.MirroredRepeatWrapping;
  _texCache.set(key, t);
  return t;
}

// 手繪筆刷小色塊(painterly blob;photoreal 噪點禁用)
function brushBlob(g, x, y, r, rnd) {
  g.beginPath();
  for (let a = 0; a <= 10; a++) {
    const t = a / 10 * Math.PI * 2;
    const rr = r * (0.7 + rnd() * 0.5);
    const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
    a ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
  g.fill();
}
// 底色微變:同種地表不同變體的基調彼此不同(hex → css rgb)
function vary(hex, rnd, amt = 10) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 2 * amt)));
  return `rgb(${c(hex >> 16 & 255)},${c(hex >> 8 & 255)},${c(hex & 255)})`;
}

const PAINTERS = {
  turf(g, S, rnd) {                                    // 草皮:筆刷色塊 + 草叢短撇 + 野花
    g.fillStyle = vary(0x7db159, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(214,238,160,${0.10 + rnd() * 0.12})`;
      brushBlob(g, rnd() * S, rnd() * S, 14 + rnd() * 30, rnd);
    }
    g.strokeStyle = 'rgba(42,84,36,0.4)'; g.lineWidth = 2;
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y - 4 - rnd() * 5); g.stroke();
    }
    for (let i = 0; i < 8; i++) {
      g.fillStyle = rnd() < 0.5 ? '#f2ee9a' : '#f5f5f5';
      g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.6, 0, 7); g.fill();
    }
  },
  lawn(g, S, rnd) {                                    // 市區草坪:割草機平行紋
    g.fillStyle = vary(0x6fae5a, rnd, 8); g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 64) {
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.fillRect(x, 0, 32, S);
    }
    g.strokeStyle = 'rgba(40,80,36,0.3)'; g.lineWidth = 1.6;
    for (let i = 0; i < 30; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 5, y - 4); g.stroke();
    }
  },
  meadow(g, S, rnd) {                                  // 芒草原:直立草束筆觸 + 抽穗點
    g.fillStyle = vary(0xb3a468, rnd); g.fillRect(0, 0, S, S);
    const cs = ['#d9d0a8', '#8f8352', '#c4b87e'];
    g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 110; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.strokeStyle = cs[(rnd() * cs.length) | 0];
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 8, y - 8 - rnd() * 8); g.stroke();
    }
    g.fillStyle = '#e8dfb8';
    for (let i = 0; i < 24; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.4, 0, 7); g.fill(); }
  },
  bushfield(g, S, rnd) {                               // 灌木叢地:深色團塊 + 左上受光
    g.fillStyle = vary(0x6f9a4c, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 14; i++) {
      const x = rnd() * S, y = rnd() * S, r = 12 + rnd() * 20;
      g.fillStyle = '#537c39'; brushBlob(g, x, y, r, rnd);
      g.fillStyle = 'rgba(150,190,110,0.8)'; brushBlob(g, x - r * 0.3, y - r * 0.3, r * 0.45, rnd);
    }
  },
  flowerfield(g, S, rnd) {                             // 花田:彩色花帶漂流在綠底上
    g.fillStyle = vary(0x78a854, rnd); g.fillRect(0, 0, S, S);
    const cs = ['#e88bb0', '#f2d24a', '#f5f5f5', '#c77ddb', '#e8734a'];
    for (let i = 0; i < 7; i++) {
      const c = cs[(rnd() * cs.length) | 0];
      const x = rnd() * S, y = rnd() * S, r = 14 + rnd() * 22;
      g.fillStyle = c; g.globalAlpha = 0.55; brushBlob(g, x, y, r, rnd);
      g.globalAlpha = 0.9;
      for (let k = 0; k < 14; k++) {                   // 花帶內的點狀花簇
        g.beginPath(); g.arc(x + (rnd() - 0.5) * r * 1.6, y + (rnd() - 0.5) * r * 1.6, 1.8, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
    }
    g.strokeStyle = 'rgba(42,84,36,0.35)'; g.lineWidth = 2;
    for (let i = 0; i < 30; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 5); g.stroke();
    }
  },
  orchard(g, S, rnd) {                                 // 果園:整列樹蔭圓斑 + 除草帶
    g.fillStyle = vary(0x82ab5e, rnd); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 42) {
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, y, S, 20);
    }
    for (let y = 21; y < S; y += 42) {
      for (let x = 16 + (rnd() * 10 | 0); x < S; x += 40) {
        const r = 9 + rnd() * 4;
        g.fillStyle = '#55803e'; brushBlob(g, x, y, r, rnd);
        g.fillStyle = 'rgba(150,190,110,0.7)'; brushBlob(g, x - r * 0.3, y - r * 0.3, r * 0.4, rnd);
      }
    }
  },
  teafield(g, S, rnd) {                                // 茶園:波浪茶壟(暗籬 + 亮頂)+ 田間小徑
    g.fillStyle = vary(0x5f8f46, rnd); g.fillRect(0, 0, S, S);
    for (let y = 6; y < S; y += 22) {
      const ph = rnd() * 7, amp = 2 + rnd() * 3;
      for (const [c, w, dy] of [['#3f6b30', 12, 0], ['#7fae57', 4, -5]]) {
        g.strokeStyle = c; g.lineWidth = w;
        g.beginPath();
        for (let x = -4; x <= S + 4; x += 8) {
          const yy = y + dy + Math.sin(x * 0.05 + ph) * amp;
          x < 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
        }
        g.stroke();
      }
    }
    if (rnd() < 0.7) {                                 // 縱向採茶小徑
      const x = 40 + rnd() * (S - 80);
      g.strokeStyle = '#8a744e'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 20, S); g.stroke();
    }
  },
  paddy(g, S, rnd) {                                   // 水田:淺水面 + 秧苗列 + 田埂框(fit)
    g.fillStyle = vary(0x7ba393, rnd, 8); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.16)';            // 水面天光
    for (let i = 0; i < 10; i++) g.fillRect(rnd() * S, rnd() * S, 20 + rnd() * 40, 2);
    g.strokeStyle = '#5c8f46'; g.lineWidth = 4; g.lineCap = 'round';
    for (let y = 20; y < S - 14; y += 16) {
      for (let x = 12; x < S - 10; x += 9) {
        if (rnd() < 0.08) continue;                    // 缺株:手插不勻
        g.beginPath(); g.moveTo(x, y + (rnd() - 0.5) * 2); g.lineTo(x + 3, y + (rnd() - 0.5) * 2); g.stroke();
      }
    }
    g.strokeStyle = '#7a5c3e'; g.lineWidth = 14;       // 田埂(patch 外框,配外圈頂點隆起)
    g.strokeRect(3, 3, S - 6, S - 6);
  },
  dryfield(g, S, rnd) {                                // 旱田:壟溝條紋 + 土塊(fit)
    g.fillStyle = vary(0x96714a, rnd); g.fillRect(0, 0, S, S);
    for (let x = 6; x < S; x += 18) {
      g.fillStyle = '#7a5836'; g.fillRect(x, 0, 7, S);
      g.fillStyle = '#a5825a'; g.fillRect(x + 7, 0, 3, S);   // 壟頂受光
    }
    g.fillStyle = '#6f5030';
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.5 + rnd() * 2, 0, 7); g.fill(); }
    g.strokeStyle = '#7a5c3e'; g.lineWidth = 10;
    g.strokeRect(2, 2, S - 4, S - 4);
  },
  wild(g, S, rnd) {                                    // 荒野:乾草/土斑駁色塊
    g.fillStyle = vary(0x8d835f, rnd); g.fillRect(0, 0, S, S);
    const cs = ['rgba(124,138,85,0.45)', 'rgba(156,141,102,0.45)', 'rgba(132,122,88,0.4)'];
    for (let i = 0; i < 18; i++) {
      g.fillStyle = cs[(rnd() * cs.length) | 0];
      brushBlob(g, rnd() * S, rnd() * S, 14 + rnd() * 26, rnd);
    }
    g.fillStyle = '#6e6650';
    for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.2 + rnd() * 1.6, 0, 7); g.fill(); }
  },
  gravel(g, S, rnd) {                                  // 碎石:兩階色卵石 + 硬邊高光點
    g.fillStyle = vary(0x9a9384, rnd, 7); g.fillRect(0, 0, S, S);
    const cs = ['#a8a294', '#b4ae9e', '#8c8678'];
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 7;
      g.save(); g.translate(x, y); g.rotate(rnd() * 3.2);
      g.fillStyle = cs[(rnd() * cs.length) | 0];
      g.beginPath(); g.ellipse(0, 0, r, r * (0.55 + rnd() * 0.3), 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(90,86,74,0.7)'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.45)';          // 賽璐璐硬邊高光
      g.beginPath(); g.ellipse(-r * 0.3, -r * 0.25, r * 0.3, r * 0.16, 0, 0, 7); g.fill();
      g.restore();
    }
  },
  sand(g, S, rnd) {                                    // 沙漠風沙:平行風紋波線 + 亮脊
    g.fillStyle = vary(0xdcc28f, rnd); g.fillRect(0, 0, S, S);
    for (let y = 8; y < S; y += 13) {
      const ph = rnd() * 7, amp = 2 + rnd() * 3;
      for (const [c, w, dy] of [['rgba(178,144,90,0.85)', 3, 0], ['rgba(255,244,214,0.5)', 1.5, -2.5]]) {
        g.strokeStyle = c; g.lineWidth = w;
        g.beginPath();
        for (let x = -4; x <= S + 4; x += 8) {
          const yy = y + dy + Math.sin(x * 0.06 + ph) * amp;
          x < 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
        }
        g.stroke();
      }
    }
  },
  mud(g, S, rnd) {                                     // 越野泥地:車轍雙線 + 水窪
    g.fillStyle = vary(0x6d5940, rnd); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (let t = 0; t < 3; t++) {                      // 三道彎曲車轍(左右輪距 ±7)
      const x0 = 30 + rnd() * (S - 60), ph = rnd() * 7, amp = 8 + rnd() * 10;
      for (const off of [-7, 7]) {
        for (const [c, w] of [['#4a3a26', 6], ['#7d6848', 2]]) {
          g.strokeStyle = c; g.lineWidth = w;
          g.beginPath();
          for (let y = -4; y <= S + 4; y += 10) {
            const xx = x0 + off + Math.sin(y * 0.03 + ph) * amp;
            y < 0 ? g.moveTo(xx, y) : g.lineTo(xx, y);
          }
          g.stroke();
        }
      }
    }
    for (let i = 0; i < 4; i++) {                      // 水窪:亮天光 + 白邊
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 12;
      g.fillStyle = 'rgba(142,162,171,0.8)'; brushBlob(g, x, y, r, rnd);
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, r * 0.9, 3.4, 5.2); g.stroke();
    }
  },
  crackedearth(g, S, rnd) {                            // 龜裂旱地:裂縫網 + 泥板塊亮面
    g.fillStyle = vary(0xb08d5f, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 18, rnd);
    }
    g.strokeStyle = '#7a5c38'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {                     // 分岔裂縫(隨機折線)
      let x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y);
      const n = 3 + (rnd() * 3 | 0);
      for (let k = 0; k < n; k++) {
        x += (rnd() - 0.5) * 44; y += (rnd() - 0.5) * 44;
        g.lineTo(x, y);
        if (rnd() < 0.4) {                             // 分岔
          g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30); g.moveTo(x, y);
        }
      }
      g.stroke();
    }
  },
  redsoil(g, S, rnd) {                                 // 紅土地:侵蝕條痕 + 土礫
    g.fillStyle = vary(0xa05f42, rnd); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S, y = rnd() * S, l = 10 + rnd() * 30;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(127,70,48,0.6)' : 'rgba(184,122,85,0.6)';
      g.lineWidth = 2 + rnd() * 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (rnd() - 0.5) * 8); g.stroke();
    }
    g.fillStyle = '#824c34';
    for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.4 + rnd() * 2, 0, 7); g.fill(); }
  },
  concrete(g, S, rnd) {                                // 水泥地:伸縮縫格線 + 髮絲裂縫 + 污漬
    g.fillStyle = vary(0xb4b6b2, rnd, 6); g.fillRect(0, 0, S, S);
    g.strokeStyle = '#8d8f8b'; g.lineWidth = 3;
    for (let p = 0; p <= S; p += 85) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(80,86,80,0.15)';
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 20, rnd);
    }
    g.strokeStyle = '#9a9c96'; g.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      let x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 26; y += (rnd() - 0.5) * 26; g.lineTo(x, y); }
      g.stroke();
    }
  },
  brick(g, S, rnd) {                                   // 磚瓦地:交丁磚縫 + 每磚色差 + 受光邊
    g.fillStyle = '#b3a698'; g.fillRect(0, 0, S, S);
    const cs = ['#b06a4a', '#a35f3f', '#bd7855', '#9d5a3e', '#b57050'];
    const bw = 34, bh = 18;
    for (let row = 0; row * bh < S; row++) {
      const off = row % 2 ? -bw / 2 : 0;
      for (let x = off; x < S; x += bw) {
        g.fillStyle = cs[(rnd() * cs.length) | 0];
        g.fillRect(x + 1.5, row * bh + 1.5, bw - 3, bh - 3);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x + 1.5, row * bh + 1.5, bw - 3, 3);
      }
    }
  },
  pavement(g, S, rnd) {                                // 人行道磚:方格地磚 + 雙色交錯
    g.fillStyle = vary(0xa8a49c, rnd, 6); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 32) {
      for (let x = 0; x < S; x += 32) {
        if ((x / 32 + y / 32) % 2 < 1) { g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x, y, 32, 32); }
        if (rnd() < 0.08) { g.fillStyle = 'rgba(90,88,80,0.25)'; g.fillRect(x, y, 32, 32); }   // 換色磚
      }
    }
    g.strokeStyle = '#8c8880'; g.lineWidth = 2;
    for (let p = 0; p <= S; p += 32) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
  },
  parking(g, S, rnd) {                                 // 停車場:瀝青 + 白色車格線(fit)
    g.fillStyle = vary(0x3f444a, rnd, 5); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 20, rnd);
    }
    g.strokeStyle = '#e8eae6'; g.lineWidth = 3;
    for (const [y0, y1] of [[16, 96], [S - 96, S - 16]]) {   // 兩排車格,中間行車道
      g.beginPath(); g.moveTo(8, y0 === 16 ? 96 : S - 96); g.lineTo(S - 8, y0 === 16 ? 96 : S - 96); g.stroke();
      for (let x = 16; x < S - 8; x += 36) {
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      }
    }
  },
  court(g, S, rnd) {                                   // PU 球場:綠外圈 + 紅場心 + 白線(fit)
    g.fillStyle = '#3f7f63'; g.fillRect(0, 0, S, S);
    const m = 34;
    g.fillStyle = '#b5674d'; g.fillRect(m, m, S - m * 2, S - m * 2);
    g.strokeStyle = '#f2f4f0'; g.lineWidth = 3;
    g.strokeRect(m, m, S - m * 2, S - m * 2);
    g.beginPath(); g.moveTo(m, S / 2); g.lineTo(S - m, S / 2); g.stroke();   // 中線
    g.beginPath(); g.arc(S / 2, S / 2, 30, 0, 7); g.stroke();                // 中圈
    g.strokeRect(S / 2 - 28, m, 56, 34);                                     // 兩端禁區
    g.strokeRect(S / 2 - 28, S - m - 34, 56, 34);
    void rnd;
  },
  track(g, S, rnd) {                                   // 跑道:紅 PU + 白分道線(fit)
    g.fillStyle = vary(0xb85a44, rnd, 8); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 60; i++) g.fillRect(rnd() * S, rnd() * S, 2, 2);     // PU 顆粒
    g.strokeStyle = '#f2f4f0'; g.lineWidth = 2;
    for (let x = 16; x < S; x += 32) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke();
    }
    g.lineWidth = 4;                                    // 起跑線
    g.beginPath(); g.moveTo(0, S - 20); g.lineTo(S, S - 20); g.stroke();
  },
  marsh(g, S, rnd) {                                   // 濕地泥灘:積水塊 + 蘆葦筆觸
    g.fillStyle = vary(0x63604a, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) {
      const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 16;
      g.fillStyle = 'rgba(125,147,156,0.65)'; brushBlob(g, x, y, r, rnd);
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(x, y, r * 0.85, 3.4, 5.0); g.stroke();
    }
    g.strokeStyle = '#a9b06a'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 50; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 5, y - 7 - rnd() * 7); g.stroke();
    }
  },
  lotus(g, S, rnd) {                                   // 荷塘:深水 + 荷葉圓盤(缺口)+ 荷花點
    g.fillStyle = vary(0x41616b, rnd, 8); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 8; i++) g.fillRect(rnd() * S, rnd() * S, 16 + rnd() * 30, 2);   // 水面天光
    for (let i = 0; i < 12; i++) {
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 9, a = rnd() * 7;
      g.fillStyle = '#4f8f4f';
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a + 0.5, a + 6.1); g.closePath(); g.fill();   // 缺口荷葉
      g.strokeStyle = 'rgba(220,240,210,0.5)'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(x, y, r * 0.9, a + 0.6, a + 2.2); g.stroke();
      if (rnd() < 0.3) { g.fillStyle = '#e88bb0'; g.beginPath(); g.arc(x + r, y - r * 0.4, 2.4, 0, 7); g.fill(); }
    }
  },
};

// ---- 地表定義 ----
// shape:blob=不規則色塊 / rect=田塊、場地;uv:'fit'=單張鋪滿(否則世界投影 tile)
// edge:'fade'=外圈 alpha 淡出融入地形(自然類)/ 'ink'=硬邊墨線(人造類)
// slope:允許的高差/半徑比;rim:外圈隆起(田埂);fam:延伸擺放家族
const DEFS = {
  turf:         { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.40, green: true, fam: 'blobGreen' },
  meadow:       { shape: 'blob', uvS: 1 / 16, edge: 'fade', slope: 0.45, green: true, fam: 'blobGreen' },
  bushfield:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.40, green: true, fam: 'blobGreen' },
  flowerfield:  { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.35, green: true, fam: 'blobGreen' },
  orchard:      { shape: 'blob', uvS: 1 / 20, edge: 'fade', slope: 0.30, green: true, fam: 'blobGreen' },
  teafield:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.22, green: true, fam: 'rectFarm' },
  paddy:        { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.09, rim: 0.5, green: true, fam: 'rectFarm' },
  dryfield:     { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.14, rim: 0.35, fam: 'rectFarm' },
  wild:         { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, fam: 'blobBare' },
  gravel:       { shape: 'blob', uvS: 1 / 10, edge: 'fade', slope: 0.40, fam: 'blobBare' },
  sand:         { shape: 'blob', uvS: 1 / 18, edge: 'fade', slope: 0.35, fam: 'blobBare' },
  mud:          { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.30, fam: 'blobBare' },
  crackedearth: { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.35, fam: 'blobBare' },
  redsoil:      { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.40, fam: 'blobBare' },
  lawn:         { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.30, green: true },
  concrete:     { shape: 'rect', uvS: 1 / 16, aspect: 0.8, edge: 'ink', slope: 0.14, fam: 'rectUrban' },
  brick:        { shape: 'rect', uvS: 1 / 8, aspect: 0.8, edge: 'ink', slope: 0.12 },
  pavement:     { shape: 'blob', uvS: 1 / 8, edge: 'ink', slope: 0.20 },
  parking:      { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.10, fam: 'rectUrban' },
  court:        { shape: 'rect', uv: 'fit', aspect: 0.54, edge: 'ink', slope: 0.08, fam: 'rectUrban' },
  track:        { shape: 'rect', uv: 'fit', aspect: 0.5, edge: 'ink', slope: 0.08, fam: 'rectUrban' },
  marsh:        { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.25, green: true, fam: 'wetFam' },
  lotus:        { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.15, fam: 'wetFam' },
};
// 分區切片(值雜訊挑選;重複項 = 權重,首尾 = 稀有)
const ZONES = {
  green: ['meadow', 'turf', 'paddy', 'flowerfield', 'turf', 'dryfield', 'orchard', 'teafield', 'bushfield'],
  bare:  ['wild', 'gravel', 'crackedearth', 'sand', 'redsoil', 'mud', 'gravel', 'wild'],
  urban: ['concrete', 'pavement', 'brick', 'lawn', 'parking', 'court', 'track', 'pavement', 'concrete'],
  wet:   ['marsh', 'lotus'],
};
// 延伸擺放家族:同族 patch 相互毗鄰延伸(農田拼布 / 運動園區 / 綠地群落)
const FAMS = {
  rectFarm:  ['paddy', 'dryfield', 'teafield'],
  rectUrban: ['parking', 'court', 'track', 'concrete'],
  blobGreen: ['turf', 'meadow', 'flowerfield', 'bushfield', 'orchard'],
  blobBare:  ['wild', 'gravel', 'sand', 'crackedearth', 'redsoil', 'mud'],
  wetFam:    ['marsh', 'lotus'],
};
// 尺寸 [基準半徑, 變幅](rect 半寬;court/track 接近真實場地)
const SIZE = {
  turf: [9, 10], meadow: [10, 12], bushfield: [8, 8], flowerfield: [10, 8], orchard: [11, 8],
  lawn: [8, 8], wild: [10, 12], gravel: [8, 9], sand: [11, 12], mud: [8, 9],
  crackedearth: [11, 10], redsoil: [10, 9], marsh: [8, 8], lotus: [8, 6],
  paddy: [13, 8], dryfield: [12, 8], teafield: [12, 6], concrete: [9, 7], brick: [7, 6],
  pavement: [8, 6], parking: [14, 4], court: [16, 3], track: [15, 3],
};
// 綠色系季節色偏(材質 color 乘上貼圖)
const SEASON_TINT = { spring: 0xeaffe0, summer: 0xffffff, autumn: 0xffd9a8, winter: 0xdfe8ea };
const FLOWER_C = [0xe88bb0, 0xf2d24a, 0xf5f5f5, 0xc77ddb, 0xe8734a];

// ---- 3D 細節(多零件;底部貼地,pebble 不平移 = 半埋入土)----
// c:'grass'/'foliage' = 季節色;'palette' = 每實例指定色(材質白底 × instance tint)
const cone = (r, h, n) => new THREE.ConeGeometry(r, h, n).translate(0, h / 2, 0);
const DETAIL_DEFS = {
  tuft:     [{ geo: cone(0.5, 1.2, 5), c: 'grass' }],
  rice:     [{ geo: cone(0.26, 0.95, 4), c: 0x7fb257 }],
  reed:     [{ geo: cone(0.3, 1.7, 4), c: 0xa9b06a }],
  bush:     [{ geo: new THREE.IcosahedronGeometry(0.85, 0).translate(0, 0.55, 0), c: 'foliage', sy: 0.8 }],
  pebble:   [{ geo: new THREE.IcosahedronGeometry(0.42, 0), c: 0x938c7e, sy: 0.55 }],
  hay:      [{ geo: new THREE.CylinderGeometry(1.0, 1.0, 1.5, 9).rotateZ(Math.PI / 2).translate(0, 1.0, 0), c: 0xc9a85c }],
  sapling:  [{ geo: new THREE.CylinderGeometry(0.09, 0.13, 1.3, 5).translate(0, 0.65, 0), c: 0x6b4a2f },
             { geo: new THREE.IcosahedronGeometry(0.9, 0).translate(0, 1.7, 0), c: 'foliage', sy: 0.9 }],
  flower:   [{ geo: cone(0.07, 0.5, 4), c: 0x5f8f44 },
             { geo: new THREE.IcosahedronGeometry(0.16, 0).translate(0, 0.55, 0), c: 'palette' }],
  lotuspad: [{ geo: new THREE.CylinderGeometry(0.6, 0.65, 0.06, 9).translate(0, 0.16, 0), c: 0x4f8f4f }],
};

function bucketOf(buckets, key) {
  let b = buckets.get(key);
  if (!b) { b = { pos: [], nrm: [], uv: [], col: [], idx: [], base: 0 }; buckets.set(key, b); }
  return b;
}

// 不規則色塊。edge:'fade' 外圈 alpha=0 淡入地形;'ink' 外圈墨線頂點色(手繪描邊)
function emitBlob(b, terrain, x, z, r, lift, uvS, edge, pt, rnd) {
  const n = 12;
  const push = (vx, vz, cr, cg, cb, ca) => {
    b.pos.push(vx, terrain.heightAt(vx, vz) + lift, vz);
    b.nrm.push(0, 1, 0);
    b.uv.push(vx * uvS, vz * uvS);
    b.col.push(cr * pt[0], cg * pt[1], cb * pt[2], ca);
  };
  const angs = [], rads = [];
  for (let i = 0; i < n; i++) {
    angs.push(-i / n * Math.PI * 2);            // 角度遞減 → 三角形面朝 +y
    rads.push(r * (0.72 + rnd() * 0.42));       // 邊界抖動 = 手繪輪廓
  }
  const eC = edge === 'fade' ? [1, 1, 1, 0] : [0.55, 0.56, 0.62, 1];
  const mR = edge === 'fade' ? 0.66 : 0.6;
  for (let i = 0; i < n; i++) push(x + Math.cos(angs[i]) * rads[i], z + Math.sin(angs[i]) * rads[i], ...eC);
  for (let i = 0; i < n; i++) push(x + Math.cos(angs[i]) * rads[i] * mR, z + Math.sin(angs[i]) * rads[i] * mR, 1, 1, 1, 1);
  push(x, z, 1, 1, 1, 1);
  const k = b.base, c = k + 2 * n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.idx.push(k + i, k + j, k + n + i, k + j, k + n + j, k + n + i, k + n + i, k + n + j, c);
  }
  b.base += 2 * n + 1;
}

// 矩形田塊/場地:6×7 網格貼地;rim = 外圈隆起田埂(暖土頂點色),否則外圈墨線
function emitRect(b, terrain, x, z, r, rot, def, lift, pt, flipU, rnd) {
  const w = r * 2, d = r * 2 * (def.aspect || 0.7);
  const nx = 7, nz = 6;
  const ca = Math.cos(rot), sa = Math.sin(rot);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const lx = (i / (nx - 1) - 0.5) * w, lz = (j / (nz - 1) - 0.5) * d;
      const vx = x + lx * ca - lz * sa, vz = z + lx * sa + lz * ca;
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      let dy = 0, cr = 1, cg = 1, cb = 1;
      if (edge) {
        if (def.rim) { dy = def.rim; cr = 0.78; cg = 0.66; cb = 0.5; }
        else { cr = 0.6; cg = 0.6; cb = 0.64; }
      }
      b.pos.push(vx, terrain.heightAt(vx, vz) + lift + dy, vz);
      b.nrm.push(0, 1, 0);
      if (def.uv === 'fit') {
        const u = i / (nx - 1);
        b.uv.push(flipU ? 1 - u : u, j / (nz - 1));   // 隨機鏡射:同變體場地也左右互異
      } else b.uv.push(vx * def.uvS, vz * def.uvS);
      b.col.push(cr * pt[0], cg * pt[1], cb * pt[2], 1);
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = b.base + j * nx + i, e = a + 1, f = a + nx, g = f + 1;
      b.idx.push(a, f, e, e, f, g);
    }
  }
  b.base += nx * nz;
  void rnd;
}

/**
 * 鋪設地被覆蓋層。加進 biomes group,回傳統計 { patches, details }。
 * @param group     biomes 的 THREE.Group
 * @param terrain   buildTerrain() 回傳物
 * @param opts.isBlocked  (x,z)=>bool 兵線/塔/主堡淨空
 * @param opts.classifyAt (x,z)=>'green'|'bare'|'urban'|'wet'|'water'
 * @param opts.blockers   建物碰撞柱(patch 避開建物)
 * @param opts.season / opts.seed / opts.rnd  決定性環境參數
 */
export function buildGroundCover(group, terrain, { isBlocked, classifyAt, blockers, season, seed, rnd }) {
  const buckets = new Map();   // `${sub}#${variant}` -> 幾何桶
  const det = {};
  for (const t in DETAIL_DEFS) det[t] = [];
  let detCount = 0;
  const addDetail = (type, px, pz, s, tintHex = null, sy = 1) => {
    if (detCount >= MAX_DETAIL || isBlocked(px, pz)) return;
    const y = terrain.heightAt(px, pz);
    if (y < 0.4) return;
    det[type].push({ x: px, y, z: pz, s, sy, ry: rnd() * Math.PI * 2, tint: tintHex });
    detCount++;
  };

  const inb = 30;
  const area = terrain.worldW * terrain.worldH / 1e6;
  const target = Math.max(90, Math.min(560, Math.round(area * 170)));
  let placed = 0;

  // ---- 單塊 patch:檢查 → 幾何 → 細節 → 家族延伸(遞迴,同變體連片)----
  const tryPatch = (x, z, sub, variant, r, rot, depth) => {
    if (placed >= target) return false;
    if (x < terrain.minX + inb || x > terrain.maxX - inb || z < terrain.minZ + inb || z > terrain.maxZ - inb) return false;
    if (isBlocked(x, z)) return false;
    const def = DEFS[sub];
    // 坡度/水面檢查:整塊落在陸地、高差在容許內(田與球場要平)
    let mn = Infinity, mx = -Infinity;
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const h = terrain.heightAt(x + ox, z + oz);
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
    if (mn < 0.45 || mx - mn > r * def.slope) return false;
    for (const bl of blockers) {
      const dx = x - bl.x, dz = z - bl.z, rr = bl.r + r * 0.7;
      if (dx * dx + dz * dz < rr * rr) return false;
    }

    const lift = 0.12 + rnd() * 0.05;            // patch 間微錯層防 z-fighting(< 道路 0.18)
    const pt = [0.88 + rnd() * 0.24, 0.88 + rnd() * 0.24, 0.88 + rnd() * 0.24];   // 每塊色調抖動
    const b = bucketOf(buckets, `${sub}#${variant}`);
    if (def.shape === 'rect') emitRect(b, terrain, x, z, r, rot, def, lift, pt, rnd() < 0.5, rnd);
    else emitBlob(b, terrain, x, z, r, lift, def.uvS, def.edge, pt, rnd);
    placed++;

    scatterDetails(sub, x, z, r, rot, def);

    // 家族延伸:農田拼布 / 運動園區 / 綠地群落(rect 沿軸毗鄰、blob 交疊淡接)
    if (def.fam && depth < 2 && rnd() < 0.65) {
      const k = 1 + (rnd() * 2 | 0);
      for (let i = 0; i < k; i++) {
        const sub2 = rnd() < 0.7 ? sub : FAMS[def.fam][(rnd() * FAMS[def.fam].length) | 0];
        const def2 = DEFS[sub2];
        if (def2.shape !== def.shape) continue;
        if (def.shape === 'rect') {
          // 沿本塊局部軸擺到正鄰位(間留 1.2m 小路),同 rot → 田字拼布
          const w1 = r * 2, d1 = r * 2 * (def.aspect || 0.7), d2 = r * 2 * (def2.aspect || 0.7);
          const g2 = 1.2;
          const [ox, oz] = rnd() < 0.5
            ? [(w1 + g2) * (rnd() < 0.5 ? 1 : -1), 0]
            : [0, ((d1 + d2) / 2 + g2) * (rnd() < 0.5 ? 1 : -1)];
          const ca = Math.cos(rot), sa = Math.sin(rot);
          tryPatch(x + ox * ca - oz * sa, z + ox * sa + oz * ca, sub2, variant, r, rot, depth + 1);
        } else {
          const r2 = SIZE[sub2][0] + rnd() * SIZE[sub2][1];
          const th = rnd() * Math.PI * 2, dist = (r + r2) * 0.78;   // 交疊:fade 邊互融
          tryPatch(x + Math.cos(th) * dist, z + Math.sin(th) * dist, sub2, variant, r2, rnd() * Math.PI, depth + 1);
        }
      }
    }
    return true;
  };

  // ---- 3D 細節(表面特徵輪廓)----
  function scatterDetails(sub, x, z, r, rot, def) {
    const w = r * 2, dp = r * 2 * (def.aspect || 0.7);
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const atLocal = (lx, lz) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
    const scatter = (type, k, s0, sv, tintPick = null) => {
      for (let i = 0; i < k; i++) {
        const rr = r * 0.75 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
        const tint = tintPick ? tintPick[(rnd() * tintPick.length) | 0] : null;
        addDetail(type, x + Math.cos(th) * rr, z + Math.sin(th) * rr, s0 + rnd() * sv, tint);
      }
    };
    if (sub === 'turf' || sub === 'lawn') scatter('tuft', 2 + (rnd() * 3 | 0), 0.7, 0.6);
    else if (sub === 'meadow') scatter('tuft', 4, 1.0, 0.8);
    else if (sub === 'bushfield') { scatter('bush', 3 + (rnd() * 3 | 0), 0.8, 0.9); scatter('tuft', 2, 0.7, 0.5); }
    else if (sub === 'flowerfield') { scatter('flower', 8 + (rnd() * 6 | 0), 0.8, 0.6, FLOWER_C); scatter('tuft', 3, 0.6, 0.4); }
    else if (sub === 'orchard') {
      let k = 0;                                  // 果樹成行成列(局部軸網格 + 微抖)
      for (let lz = -r * 0.6; lz <= r * 0.6 && k < 10; lz += 5) {
        for (let lx = -r * 0.6; lx <= r * 0.6 && k < 10; lx += 5) {
          if (rnd() < 0.2) continue;
          const [px, pz] = atLocal(lx + (rnd() - 0.5) * 1.4, lz + (rnd() - 0.5) * 1.4);
          addDetail('sapling', px, pz, 0.9 + rnd() * 0.5);
          k++;
        }
      }
    } else if (sub === 'teafield') scatter('tuft', 2, 0.5, 0.3);
    else if (sub === 'paddy') {
      let k = 0;                                  // 秧苗列:沿田塊軸向整齊插秧
      for (let lz = -dp * 0.32; lz <= dp * 0.32 && k < 26; lz += 2.6) {
        for (let lx = -w * 0.38; lx <= w * 0.38 && k < 26; lx += 2.8) {
          if (rnd() < 0.15) continue;
          const [px, pz] = atLocal(lx, lz);
          addDetail('rice', px, pz, 0.8 + rnd() * 0.4);
          k++;
        }
      }
    } else if (sub === 'dryfield') {
      if (rnd() < 0.6) scatter('hay', 1 + (rnd() < 0.3 ? 1 : 0), 0.8, 0.5);
      scatter('pebble', 2, 0.5, 0.5);
    } else if (sub === 'gravel') scatter('pebble', 4 + (rnd() * 5 | 0), 0.5, 0.9);
    else if (sub === 'wild') { scatter('pebble', 3, 0.5, 0.8); scatter('tuft', 2, 0.6, 0.4); }
    else if (sub === 'sand') scatter('pebble', 2, 0.7, 1.1);
    else if (sub === 'mud' || sub === 'crackedearth') scatter('pebble', 2, 0.5, 0.4);
    else if (sub === 'redsoil') { scatter('pebble', 2, 0.5, 0.4); scatter('tuft', 1, 0.5, 0.3); }
    else if (sub === 'marsh') scatter('reed', 4 + (rnd() * 4 | 0), 0.8, 0.6);
    else if (sub === 'lotus') { scatter('lotuspad', 5 + (rnd() * 5 | 0), 0.8, 0.8); scatter('reed', 3, 0.7, 0.5); }
  }

  // ---- 主散佈迴圈 ----
  for (let a = 0, tries = target * 3; a < tries && placed < target; a++) {
    const x = terrain.minX + inb + rnd() * (terrain.worldW - inb * 2);
    const z = terrain.minZ + inb + rnd() * (terrain.worldH - inb * 2);
    const zones = ZONES[classifyAt(x, z)];
    if (!zones) continue;
    // 分區雜訊挑 subtype + 變體:鄰近同類同變體 → 大面積連片、花紋接續不重複
    const t = Math.min(0.999, Math.max(0, (vnoise(x * 0.006, z * 0.006, seed) - 0.5) * 2.2 + 0.5));
    const sub = zones[(t * zones.length) | 0];
    const variant = (vnoise(x * 0.0025, z * 0.0025, seed ^ 0x7E11) * VARIANTS) | 0;
    const r = SIZE[sub][0] + rnd() * SIZE[sub][1];
    tryPatch(x, z, sub, Math.min(VARIANTS - 1, variant), r, rnd() * Math.PI, 0);
  }

  // ---- 色塊 Mesh(每「地表×變體」一個 draw call)----
  for (const [key, b] of buckets) {
    if (!b.idx.length) continue;
    const [sub, v] = key.split('#');
    const def = DEFS[sub];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));   // RGBA:fade 邊用頂點 alpha
    geo.setIndex(b.idx);
    const tint = def.green ? (SEASON_TINT[season] ?? 0xffffff) : 0xffffff;
    const m = new THREE.Mesh(geo, envMat(tint, {
      map: groundTex(sub, +v, def.uv === 'fit'),
      vertexColors: true, wash: 0.5, cool: 0.5,
      transparent: def.edge === 'fade',   // 淡出邊融入地形;depthWrite 保持 true(貼花式)
    }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }

  // ---- 細節 InstancedMesh(每零件一個 draw call;實例色抖動同植被)----
  const sn = ENV.seasons[season] || ENV.seasons.summer;
  const partColor = (c) => c === 'grass' ? sn.grass : c === 'foliage' ? sn.foliage : c === 'palette' ? 0xffffff : c;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3(), tint = new THREE.Color();
  for (const type in det) {
    const items = det[type];
    if (!items.length) continue;
    for (const part of DETAIL_DEFS[type]) {
      const m = new THREE.InstancedMesh(part.geo, toonMat(partColor(part.c)), items.length);
      items.forEach((it, i) => {
        E.set(0, it.ry, 0);
        Q.setFromEuler(E);
        P.set(it.x, it.y, it.z);
        S.set(it.s, it.s * (part.sy ?? 1) * it.sy, it.s);
        M.compose(P, Q, S);
        m.setMatrixAt(i, M);
        if (part.c === 'palette' && it.tint != null) tint.setHex(it.tint);
        else {
          const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
          const j2 = ((i * 1597334677) >>> 0) % 100 / 100;
          const j3 = ((i * 3812015801) >>> 0) % 100 / 100;
          tint.setRGB(0.84 + j1 * 0.3, 0.84 + j2 * 0.3, 0.84 + j3 * 0.3);
        }
        m.setColorAt(i, tint);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = false;
      m.frustumCulled = false;
      group.add(m);
    }
  }
  return { patches: placed, details: detCount };
}
