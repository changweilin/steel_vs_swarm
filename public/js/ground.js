// ============ 地被覆蓋層:開闊地的賽璐璐地表精修(doc/botw_plan.html)============
// 無障礙的空曠地面也要有「畫上去的地表」:依地貌分類鋪設特徵色塊(patch)+
// 立體細節,取代裸露衛星照片質感。50 種地表 × 每種 6 變體貼圖,像無限隨機花磚:
//   綠地   — 草皮 / 芒草原 / 灌木叢 / 水田 / 旱田 / 花田 / 果園 / 茶園 / 箭竹林
//            / 枯木林 / 混亂倒木 / 砍伐跡地 / 木材堆置場 / 腐朽木屋 / 葡萄園 / 溫室棚
//   裸露地 — 荒野 / 碎石 / 沙漠風沙 / 越野泥地 / 龜裂旱地 / 紅土地 / 倒塌石板屋
//            / 死林 / 乾草原 / 廢棄農田 / 鹽田 / 採石場
//   高地   — 高原 / 岩屑坡 / 冰原(相對高程觸發;冬季裸露地也混入冰原)
//   市區   — 草坪 / 水泥地 / 磚瓦地 / PU 球場 / 停車場 / 人行道磚 / 跑道 / 廢棄工地
//            / 加油站 / 公園 / 廣場 / 廢車場 / 貨櫃場 / 墓園 / 太陽能場 / 直升機坪
//   濕地   — 泥灘蘆葦 / 荷塘 / 魚塭
// 雙層結構(2026-07-10 改制):
//   底毯層 — 抖動網格把「全部陸地」鋪滿(不留衛星底圖空隙):角點以格點雜湊
//            抖動且相鄰 cell 共用 → 水密無縫;地表種類由低頻雜訊分區指派成大片
//            連續區域;異類交界疊「角點隸屬度雙線性外溢」做兩格寬對稱 cross-fade
//            (planSeamOverlays,含對角鄰格;2026-07-29 邊界鋸齒改制,詳該函式檔頭),
//            交界樣態逐分區組合查表(SEAM_STYLES:市區界明確壓窄 / 生態界寬淡出
//            + 間歇中間過渡帶(乾草原/蘆葦/泥灘脊帶)/ 雪線斑塊 dither / 其餘柔和),
//            過渡帶再以準晶體場擾動出手繪碎形邊,無硬縫、無 90° 階梯。
//   特徵層 — 原 patch 散佈,降級為「場所」點綴(農田/球場/遺跡/工地…),
//            疊在底毯上;fade 邊融入底毯、ink 邊讀作田埂/路緣,不再是磁磚縫。
// 無縫拼接原則(避免大面積重複感,無限延伸;2026-07-12 反重複改制):
//   1. 自然類 edge:'fade' — 外圈頂點 alpha 淡出,與底毯(或彼此)交融
//   2. 底毯 tile 型 UV 用世界座標投影 + 鏡射重複:同類相鄰花紋自動連續延伸;
//      特徵 patch 的 blob UV 每塊隨機旋轉 + rect fit 隨機鏡射(U/V)→ 同款不同貌
//   3. 低頻水彩 wash 頂點色 + 家族延伸擺放(農田拼布/運動園區/綠地群落)
//   4. 特徵拼圖不疊置:僅允許邊緣小比例交疊(SEP_F 圓近似間距);且英雄視野
//      (VIS_R)內同款「地表#變體」只准出現一次,同款用罄輪替其他變體/地表
//   5. 特徵層分區走純圖資分類(classifyPure,不吃場地 mix 隨機改寫)→
//      球場/停車場只落市區、水田/果園只落綠地、沙漠/碎石只落裸露地
//   6. 整齊度沿路對齊(2026-07-23):每型拼圖/物件帶 reg(0..1)整齊規律程度,
//      越規律越高機率沿最近道路方向擺放(DEFS.reg / REG 表 + opts.roadDirAt),
//      其餘機率(或附近無路)維持隨機朝向;自然件 reg=0 恆隨機
// 規律/不規律雙軌拼貼(2026-07-25 使用者需求):
//   7. 規律結構(ink rect、reg≥0.7:停車場/球場/太陽能板/稻田/農田)沿道路兩側主動鋪
//      「連續等尺寸格陣」(layRegularArrays + opts.roadPolys):鎖路向、同陣列共 rot、法線
//      偏移讓開路面 → 街廓般整齊;近路規律型交陣列,遠路/無路退回主迴圈隨機散佈。
//   8. 不規律(自然:草木/風沙碎石)走準晶體概念(qcVal 五向平面波、十重對稱非週期):
//      底毯角點位移(cornerAt,保 (i,j) 純函數 = 水密)+ 選格群聚(cellKeyAt)+ 主散佈
//      候選點陣(全循環雙射走訪)+ 細節 blue-noise 微推(qcNudge)皆吃同一場 → 無方格重複感。
//   9. 圖層交會分級(lift):底毯 < 外溢 < 不規律 fade < 規律 ink,規律再依所對齊道路分級
//      (opts.roadRank)抬高 = 大馬路 > 小馬路,整體仍 < 道路;規律↔規律 overlapPs 全分離
//      (INK_SEP_F)不破壞結構完整性(停車場不疊球場)。
// 手法與 buildRoads 同族:貼地多邊形 + 程序生成 canvas 筆刷貼圖 + 頂點色墨線,
// 每「地表×變體」合併成單一 Mesh(常數 draw call);細節物件全 InstancedMesh。
// 純視覺:不進射擊 raycast、不描邊、不產生碰撞柱(空地依然自由通行)。
// 亂數決定性:呼叫端傳入以戰場中心為種子的 rnd + seed,全房間一致。
import * as THREE from 'three';
import { ENV } from './data.js';
import { envMat } from './toon.js';

const MAX_DETAIL = 19000;  // 3D 細節實例總上限(特徵層 + 底毯撒佈;全 InstancedMesh,draw call 不變;
                           // 2026-07-12 15000→19000:綠地雜草/花帶密集散佈需要更多實例配額)
const FEAT_DETAIL = 12000; // 特徵層細節配額;剩餘留給底毯,空地才不會光禿
const VARIANTS = 6;        // 每種地表的貼圖變體數(變體貼圖惰性生成,只有實際用到才建;
                           // 2026-07-12 4→6:視野內同款不重複需要更多款式輪替)
const RSCALE = 1.3;        // 特徵 patch 半徑全域放大
const VIS_R = 300;         // 反重複半徑 = 英雄最大視野(UNITS.drone.sight)
const SEP_F = 0.85;        // 拼圖間距係數(圓近似):d ≥ (r1+r2)×0.85,僅容邊緣小比例交疊
const INK_SEP_F = 1.06;    // 規律結構(edge:'ink')↔ 規律結構完全分離係數(1.0=相切;+6% 結構間隙,不切穿整齊區塊,如停車場不疊球場)

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
    for (let i = 0; i < 14; i++) {                     // 灌木淡影(灌木本體 = 3D 實例;受光壓淡不立體)
      const x = rnd() * S, y = rnd() * S, r = 12 + rnd() * 20;
      g.fillStyle = '#537c39'; brushBlob(g, x, y, r, rnd);
      g.fillStyle = 'rgba(150,190,110,0.35)'; brushBlob(g, x - r * 0.3, y - r * 0.3, r * 0.45, rnd);
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
  orchard(g, S, rnd) {                                 // 果園:除草帶 + 樹行淡影(果樹本體 = 3D 實例)
    g.fillStyle = vary(0x82ab5e, rnd); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 42) {
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, y, S, 20);
    }
    for (let y = 21; y < S; y += 42) {
      for (let x = 16 + (rnd() * 10 | 0); x < S; x += 40) {
        g.fillStyle = 'rgba(60,100,46,0.28)';          // 樹行淡影:只給定位感,不畫樹體
        brushBlob(g, x, y, 8 + rnd() * 4, rnd);
      }
    }
  },
  veggiefield(g, S, rnd) {                             // 菜園:窄畦壟溝 + 葉菜球列 + 畦邊框(fit)
    g.fillStyle = vary(0x8a6e4a, rnd); g.fillRect(0, 0, S, S);
    for (let y = 10; y < S - 8; y += 22) {
      g.fillStyle = 'rgba(110,88,60,0.55)';            // 畦溝
      g.fillRect(4, y + 13, S - 8, 6);
      g.fillStyle = 'rgba(160,132,96,0.5)';            // 畦頂受光
      g.fillRect(4, y, S - 8, 4);
      for (let x = 12; x < S - 8; x += 14) {           // 葉菜球(缺株 = 手種不勻)
        if (rnd() < 0.12) continue;
        g.fillStyle = rnd() < 0.3 ? '#9ec462' : '#6f9a44';
        g.beginPath(); g.arc(x + (rnd() - 0.5) * 4, y + 6 + (rnd() - 0.5) * 3, 4 + rnd() * 1.5, 0, 7); g.fill();
      }
    }
    g.strokeStyle = '#7a5c3e'; g.lineWidth = 8;        // 畦邊框
    g.strokeRect(2, 2, S - 4, S - 4);
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
  concrete(g, S, rnd) {                                // 水泥地:伸縮縫格線 + 髮絲裂縫 + 污漬(降亮:遠處不刷白)
    g.fillStyle = vary(0xa2a49e, rnd, 6); g.fillRect(0, 0, S, S);
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
  pavement(g, S, rnd) {                                // 人行道磚:方格地磚 + 雙色交錯(降亮:遠處不刷白)
    g.fillStyle = vary(0x98948b, rnd, 6); g.fillRect(0, 0, S, S);
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
  court(g, S, rnd) {                                   // PU 球場:變體換配色(籃球紅/硬地藍/紅土)(fit)
    const [outer, inner] = [['#3f7f63', '#b5674d'], ['#4a7d94', '#38618f'], ['#5f8f46', '#b5744d']][(rnd() * 3) | 0];
    g.fillStyle = outer; g.fillRect(0, 0, S, S);
    const m = 34;
    g.fillStyle = inner; g.fillRect(m, m, S - m * 2, S - m * 2);
    g.strokeStyle = '#f2f4f0'; g.lineWidth = 3;
    g.strokeRect(m, m, S - m * 2, S - m * 2);
    g.beginPath(); g.moveTo(m, S / 2); g.lineTo(S - m, S / 2); g.stroke();   // 中線
    g.beginPath(); g.arc(S / 2, S / 2, 30, 0, 7); g.stroke();                // 中圈
    g.strokeRect(S / 2 - 28, m, 56, 34);                                     // 兩端禁區
    g.strokeRect(S / 2 - 28, S - m - 34, 56, 34);
  },
  track(g, S, rnd) {                                   // 操場:完整一圈 PU 跑道(直道 + 兩端彎道)+ 內場草皮(fit)
    // 跑道是「環」不是「條」:外緣圓角矩形 → 內場草皮 → 白分道線沿整圈繞行。
    // canvas 為正方,rect 以 aspect 0.5 貼上 → 畫面上自然拉成真實操場的長橢圓。
    const ring = (inset, r) => {                        // 圓角矩形路徑(跑道等距內縮 = 一條分道線)
      g.beginPath();
      g.moveTo(inset + r, inset);
      g.lineTo(S - inset - r, inset);
      g.arcTo(S - inset, inset, S - inset, inset + r, r);
      g.lineTo(S - inset, S - inset - r);
      g.arcTo(S - inset, S - inset, S - inset - r, S - inset, r);
      g.lineTo(inset + r, S - inset);
      g.arcTo(inset, S - inset, inset, S - inset - r, r);
      g.lineTo(inset, inset + r);
      g.arcTo(inset, inset, inset + r, inset, r);
      g.closePath();
    };
    g.fillStyle = vary(0x6f8a52, rnd, 6); g.fillRect(0, 0, S, S);            // 場外草地
    const OUT = 10, LANES = 6, LW = 12;                 // 外緣內縮 / 分道數 / 單道寬
    g.fillStyle = vary(0xb85a44, rnd, 8);
    ring(OUT, 52); g.fill();                            // PU 跑道環(外緣)
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 80; i++) g.fillRect(rnd() * S, rnd() * S, 2, 2);     // PU 顆粒
    g.fillStyle = vary(0x5f8f46, rnd, 6);
    ring(OUT + LANES * LW, 52 - LANES * LW * 0.6); g.fill();                 // 內場草皮(足球場)
    g.strokeStyle = '#f2f4f0'; g.lineWidth = 2;                              // 分道線:整圈繞行
    for (let k = 0; k <= LANES; k++) { ring(OUT + k * LW, Math.max(6, 52 - k * LW * 0.6)); g.stroke(); }
    g.lineWidth = 4;                                    // 起跑/終點線:橫跨直道
    g.beginPath(); g.moveTo(S * 0.72, OUT); g.lineTo(S * 0.72, OUT + LANES * LW); g.stroke();
  },
  marsh(g, S, rnd) {                                   // 濕地泥灘:混濁紫水窪 + 蘆葦筆觸(沼澤識別色 = 濁紫)
    g.fillStyle = vary(0x5d5647, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) {
      const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 16;
      g.fillStyle = 'rgba(128,106,150,0.65)'; brushBlob(g, x, y, r, rnd);
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(x, y, r * 0.85, 3.4, 5.0); g.stroke();
    }
    g.strokeStyle = '#a9b06a'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 50; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 5, y - 7 - rnd() * 7); g.stroke();
    }
  },
  lotus(g, S, rnd) {                                   // 荷塘:深水 + 天光 + 水深暗影(荷葉 = 3D 實例)
    g.fillStyle = vary(0x41616b, rnd, 8); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 10; i++) g.fillRect(rnd() * S, rnd() * S, 16 + rnd() * 30, 2);   // 水面天光
    for (let i = 0; i < 8; i++) {                      // 水下暗影:水深錯落
      g.fillStyle = `rgba(30,52,58,${0.15 + rnd() * 0.15})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 14, rnd);
    }
  },
  watertile(g, S, rnd) {                               // 水域(淺):亮藍波光弧 + 岸沫點 —— 一眼可辨「這是水」
    g.fillStyle = vary(0x2f6f96, rnd, 8); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {                     // 波光弧(同向排列 = 水流感)
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 16;
      g.strokeStyle = `rgba(210,236,255,${0.35 + rnd() * 0.3})`; g.lineWidth = 1.6 + rnd();
      g.beginPath(); g.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.65); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.28)';
    for (let i = 0; i < 26; i++) g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 3, 1.5);   // 碎浪沫
    g.fillStyle = 'rgba(24,58,84,0.30)';
    for (let i = 0; i < 6; i++) brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 14, rnd);   // 水色深斑
  },
  deepwater(g, S, rnd) {                               // 水域(深):暗藍底 + 稀疏天光 —— 與淺水同語彙、更深沉
    g.fillStyle = vary(0x1c4560, rnd, 8); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(190,224,246,0.16)';
    for (let i = 0; i < 8; i++) g.fillRect(rnd() * S, rnd() * S, 12 + rnd() * 26, 1.6);  // 稀疏天光
    for (let i = 0; i < 9; i++) {                      // 深水暗湧
      g.fillStyle = `rgba(10,28,42,${0.18 + rnd() * 0.16})`;
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 18, rnd);
    }
    g.lineCap = 'round'; g.strokeStyle = 'rgba(150,196,224,0.22)'; g.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 14;
      g.beginPath(); g.arc(x, y, r, Math.PI * 1.15, Math.PI * 1.55); g.stroke();
    }
  },
  // ======== 綠地擴充 ========
  arrowbamboo(g, S, rnd) {                             // 箭竹林:密集細稈直豎 + 竹節 + 斜葉短撇
    g.fillStyle = vary(0x8ba757, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(60,96,44,${0.10 + rnd() * 0.1})`;
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 22, rnd);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S, y = rnd() * S, h = 14 + rnd() * 14;
      g.strokeStyle = rnd() < 0.5 ? '#c8d47e' : '#a9bd63';
      g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 4, y - h); g.stroke();
      g.fillStyle = '#7d8f43';
      g.fillRect(x - 1.5, y - h * 0.5, 3, 1.5);        // 竹節
    }
    g.strokeStyle = 'rgba(220,236,150,0.7)'; g.lineWidth = 1.4;
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 5 + rnd() * 4, y - 2 - rnd() * 3); g.stroke();
    }
  },
  deadwood(g, S, rnd) {                                // 枯木林:乾草底 + 細碎小枝(枯木本體 = 3D 實例)
    g.fillStyle = vary(0x9c9070, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(120,110,88,${0.2 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 20, rnd);
    }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(110,97,82,0.6)'; g.lineWidth = 1.6;
    for (let i = 0; i < 22; i++) {                     // 細碎小枝:只是地面質感,不畫成倒枝
      const x = rnd() * S, y = rnd() * S, a = rnd() * 7;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7); g.stroke();
    }
    g.fillStyle = '#b8a67e';
    for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.3, 0, 7); g.fill(); }
  },
  fallenlogs(g, S, rnd) {                              // 混亂倒木:草土底 + 壓倒草痕(倒木本體 = 3D 實例)
    g.fillStyle = vary(0x7c8a55, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(110,96,66,${0.2 + rnd() * 0.15})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 16, rnd);
    }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(90,80,52,0.35)'; g.lineWidth = 5;
    for (let i = 0; i < 8; i++) {                      // 倒木壓出的草痕(淡影,非木身)
      const x = rnd() * S, y = rnd() * S, a = rnd() * 7, l = 20 + rnd() * 30;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  },
  clearcut(g, S, rnd) {                                // 砍伐跡地:泥土 + 木屑斑 + 拖木刮痕(樹頭 = 3D 實例)
    g.fillStyle = vary(0x8a7350, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(214,196,150,${0.15 + rnd() * 0.15})`;
      brushBlob(g, rnd() * S, rnd() * S, 8 + rnd() * 16, rnd);
    }
    g.fillStyle = '#d9c49a';
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.2 + rnd() * 1.6, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(90,70,46,0.5)'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + rnd() * 26, y + (rnd() - 0.5) * 10); g.stroke();
    }
  },
  lumberyard(g, S, rnd) {                              // 木材堆置場:土面 + 木屑帶 + 車轍(木堆/板材 = 3D 實例)
    g.fillStyle = vary(0x8f7854, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(214,196,150,${0.18 + rnd() * 0.18})`;
      brushBlob(g, rnd() * S, rnd() * S, 8 + rnd() * 16, rnd);
    }
    g.lineCap = 'round'; g.strokeStyle = 'rgba(90,70,46,0.5)'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {                      // 搬運車轍
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 26 + rnd() * 30, y + (rnd() - 0.5) * 12); g.stroke();
    }
  },
  rottencabin(g, S, rnd) {                             // 腐朽木屋地:苔草底 + 爛木板 + 青苔斑 + 朽洞
    g.fillStyle = vary(0x74855a, rnd); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * 7, l = 12 + rnd() * 16;
      g.strokeStyle = rnd() < 0.4 ? '#4f3a28' : '#5c452e'; g.lineWidth = 4 + rnd() * 3;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(96,138,70,${0.25 + rnd() * 0.25})`;
      brushBlob(g, rnd() * S, rnd() * S, 6 + rnd() * 12, rnd);
    }
    g.fillStyle = '#3f4a35';
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.6 + rnd() * 2, 0, 7); g.fill(); }
  },
  vineyard(g, S, rnd) {                                // 葡萄園:藤蔓籬行列 + 木樁 + 行間草帶(fit)
    g.fillStyle = vary(0x9a8a5e, rnd); g.fillRect(0, 0, S, S);
    for (let y = 14; y < S - 8; y += 24) {
      g.fillStyle = 'rgba(140,160,90,0.4)';            // 行間草帶
      g.fillRect(0, y + 7, S, 10);
      const ph = rnd() * 7;
      g.strokeStyle = '#3f6b30'; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath();
      for (let x = 2; x <= S - 2; x += 8) {
        const yy = y + Math.sin(x * 0.08 + ph) * 1.5;
        x <= 2 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
      g.strokeStyle = '#7fae57'; g.lineWidth = 2.5;    // 籬頂受光
      g.beginPath(); g.moveTo(2, y - 3); g.lineTo(S - 2, y - 3); g.stroke();
      g.fillStyle = '#6e5138';
      for (let x = 8; x < S; x += 26) g.fillRect(x, y - 6, 3, 12);   // 木樁
    }
  },
  greenhouse(g, S, rnd) {                              // 溫室棚地:土面 + 苗床帶(拱棚本體 = 3D 實例)(fit)
    g.fillStyle = vary(0x8a7a5c, rnd); g.fillRect(0, 0, S, S);
    for (let y = 6; y < S - 20; y += 34) {
      g.fillStyle = 'rgba(120,100,70,0.5)';            // 苗床翻土帶
      g.fillRect(4, y, S - 8, 22);
      g.fillStyle = 'rgba(140,160,90,0.35)';           // 苗床新綠
      g.fillRect(4, y + 8, S - 8, 7);
    }
  },
  // ======== 裸露地擴充 ========
  deadforest(g, S, rnd) {                              // 死林:灰燼地 + 焦木倒影 + 白灰斑
    g.fillStyle = vary(0x6b655c, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(40,38,34,${0.18 + rnd() * 0.18})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 18, rnd);
    }
    g.strokeStyle = '#3a3632'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const x = rnd() * S, y = rnd() * S, l = 12 + rnd() * 18, a = rnd() * 7;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.fillStyle = 'rgba(214,210,200,0.5)';
    for (let i = 0; i < 10; i++) brushBlob(g, rnd() * S, rnd() * S, 5 + rnd() * 8, rnd);
  },
  slabruin(g, S, rnd) {                                // 倒塌石板屋:殘存牆基 + 瓦礫斑(石板本體 = 3D 實例)
    g.fillStyle = vary(0x8d867a, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(154,160,164,${0.2 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, rnd() * S, 8 + rnd() * 14, rnd);
    }
    g.strokeStyle = 'rgba(90,86,78,0.7)'; g.lineWidth = 3;
    g.strokeRect(30 + rnd() * (S - 120), 30 + rnd() * (S - 120), 60 + rnd() * 40, 44 + rnd() * 30);
    g.fillStyle = '#6e6a60';
    for (let i = 0; i < 24; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.4 + rnd() * 2, 0, 7); g.fill(); }
  },
  steppe(g, S, rnd) {                                  // 乾草原:金黃草浪(風向一致)+ 深草叢
    g.fillStyle = vary(0xbca95e, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(220,204,140,${0.12 + rnd() * 0.12})`;
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 24, rnd);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(150,130,70,0.6)' : 'rgba(228,214,156,0.6)';
      g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 7, y - 3, x + 14, y - 2); g.stroke();
    }
    g.fillStyle = '#7d7040';
    for (let i = 0; i < 10; i++) brushBlob(g, rnd() * S, rnd() * S, 3 + rnd() * 4, rnd);
  },
  abandonedfarm(g, S, rnd) {                           // 廢棄農田:褪色壟溝 + 雜草入侵 + 傾倒圍籬(fit)
    g.fillStyle = vary(0x8f7f5e, rnd); g.fillRect(0, 0, S, S);
    for (let x = 6; x < S; x += 18) {
      g.fillStyle = 'rgba(110,92,64,0.45)'; g.fillRect(x, 0, 7, S);
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(120,150,80,${0.3 + rnd() * 0.3})`;
      brushBlob(g, rnd() * S, rnd() * S, 8 + rnd() * 16, rnd);
    }
    g.strokeStyle = 'rgba(90,72,50,0.8)'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * 0.8 - 0.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); g.stroke();
    }
  },
  saltpan(g, S, rnd) {                                 // 鹽田:結晶白池格 + 淡粉滷水 + 埂道(fit)
    g.fillStyle = vary(0xd8d4c8, rnd, 6); g.fillRect(0, 0, S, S);
    const cs = ['#f2f4f0', '#e8dfe0', '#edd8d2', '#dfe8ea'];
    const gw = 58, gh = 44;
    for (let y = 6; y < S - 8; y += gh) {
      for (let x = 6; x < S - 8; x += gw) {
        g.fillStyle = cs[(rnd() * cs.length) | 0];     // 每池結晶度/滷水色不同
        g.fillRect(x, y, gw - 6, gh - 6);
        g.fillStyle = 'rgba(255,255,255,0.8)';
        for (let k = 0; k < 5; k++) g.fillRect(x + rnd() * (gw - 10), y + rnd() * (gh - 10), 3, 1.6);
      }
    }
    g.strokeStyle = '#a09884'; g.lineWidth = 4;
    for (let y = 3; y < S; y += gh) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    for (let x = 3; x < S; x += gw) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  },
  quarry(g, S, rnd) {                                  // 採石場:階狀採掘帶 + 垂直切割線 + 碎石(fit)
    g.fillStyle = vary(0xa39a8c, rnd, 7); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 40) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(150,140,124,0.6)' : 'rgba(190,182,166,0.6)';
      g.fillRect(0, y, S, 22 + rnd() * 10);
      g.strokeStyle = 'rgba(80,74,64,0.7)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    }
    g.strokeStyle = 'rgba(110,102,90,0.6)'; g.lineWidth = 1.6;
    for (let x = 20; x < S; x += 34 + (rnd() * 20 | 0)) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 8, S); g.stroke();
    }
    g.fillStyle = '#8a8274';
    for (let i = 0; i < 20; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.5 + rnd() * 2.5, 0, 7); g.fill(); }
  },
  // ======== 高地擴充 ========
  plateau(g, S, rnd) {                                 // 高原:層積岩階帶 + 階緣受光 + 高地矮草
    g.fillStyle = vary(0xa08c6a, rnd); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 26 + (rnd() * 14 | 0)) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(140,116,84,0.5)' : 'rgba(180,158,120,0.5)';
      g.fillRect(0, y, S, 12 + rnd() * 10);
      g.strokeStyle = 'rgba(240,228,200,0.5)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
      g.strokeStyle = 'rgba(90,74,54,0.6)'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, y + 13); g.lineTo(S, y + 13); g.stroke();
    }
    g.fillStyle = 'rgba(122,138,84,0.8)';
    for (let i = 0; i < 16; i++) brushBlob(g, rnd() * S, rnd() * S, 2.5 + rnd() * 3.5, rnd);
  },
  icefield(g, S, rnd) {                                // 冰原:青白冰面 + 裂隙分岔 + 雪斑 + 晶點
    g.fillStyle = vary(0xd8e8ee, rnd, 7); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.3})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 20, rnd);
    }
    g.strokeStyle = 'rgba(124,168,190,0.8)'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      let x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50;
        g.lineTo(x, y);
        if (rnd() < 0.35) { g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 26, y + (rnd() - 0.5) * 26); g.moveTo(x, y); }
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 20; i++) g.fillRect(rnd() * S, rnd() * S, 2, 2);
  },
  scree(g, S, rnd) {                                   // 岩屑坡:角礫三角碎片 + 陰影錯落
    g.fillStyle = vary(0x8f8c84, rnd, 6); g.fillRect(0, 0, S, S);
    const cs = ['#a2a09a', '#8a8880', '#b0aea6', '#7c7a72'];
    for (let i = 0; i < 90; i++) {
      const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 6, a = rnd() * 7;
      g.fillStyle = cs[(rnd() * cs.length) | 0];
      g.beginPath();
      g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      g.lineTo(x + Math.cos(a + 2.1) * r, y + Math.sin(a + 2.1) * r);
      g.lineTo(x + Math.cos(a + 4.2) * r, y + Math.sin(a + 4.2) * r);
      g.closePath(); g.fill();
      if (rnd() < 0.4) { g.strokeStyle = 'rgba(60,58,52,0.5)'; g.lineWidth = 1; g.stroke(); }
    }
  },
  // ======== 市區擴充 ========
  construction(g, S, rnd) {                            // 廢棄工地:翻土 + 弧形車轍 + 鏽色鋼筋束 + 水泥板(fit)
    g.fillStyle = vary(0x9c8a70, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(120,100,72,${0.2 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 18, rnd);
    }
    g.lineCap = 'round';
    const cx = rnd() * S, cy = rnd() * S, a0 = rnd() * 4;
    g.strokeStyle = '#6b5a42'; g.lineWidth = 4;
    for (const off of [-6, 6]) {                       // 履帶雙轍
      g.beginPath(); g.arc(cx, cy, 60 + off, a0, a0 + 2.2); g.stroke();
    }
    g.strokeStyle = '#8a5a3a'; g.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {                      // 鏽色鋼筋束
      const x = rnd() * S, y = rnd() * S, a = rnd() * 7;
      for (let k = 0; k < 4; k++) {
        const ox = k * 3 * Math.sin(a), oy = k * 3 * Math.cos(a);
        g.beginPath(); g.moveTo(x + ox, y + oy);
        g.lineTo(x + Math.cos(a) * 30 + ox, y + Math.sin(a) * 30 + oy); g.stroke();
      }
    }
    g.fillStyle = '#b0b4b8';
    for (let i = 0; i < 4; i++) g.fillRect(rnd() * S, rnd() * S, 20 + rnd() * 14, 10 + rnd() * 8);
  },
  gasstation(g, S, rnd) {                              // 加油站:水泥坪 + 黃邊加油島 + 油漬 + 導引虛線(fit)
    g.fillStyle = vary(0xb8bab6, rnd, 6); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = `rgba(50,52,56,${0.15 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, S * 0.3 + rnd() * S * 0.5, 6 + rnd() * 12, rnd);
    }
    g.fillStyle = '#d9b23d';
    g.fillRect(S * 0.28, S * 0.42, S * 0.44, 16);
    g.fillStyle = '#c8cac6';
    g.fillRect(S * 0.28 + 3, S * 0.42 + 3, S * 0.44 - 6, 10);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3;
    g.setLineDash([14, 10]);
    for (const y of [S * 0.2, S * 0.78]) {
      g.beginPath(); g.moveTo(8, y); g.lineTo(S - 8, y); g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = '#e04a3a'; g.lineWidth = 2;        // 禁停紅框
    g.strokeRect(S * 0.06, S * 0.34, 26, 30);
  },
  park(g, S, rnd) {                                    // 公園:草坪 + 蜿蜒步道 + 樹蔭 + 花圃
    g.fillStyle = vary(0x74a85c, rnd); g.fillRect(0, 0, S, S);
    const ph = rnd() * 7;
    g.strokeStyle = '#c9b98e'; g.lineWidth = 12; g.lineCap = 'round';
    g.beginPath();
    for (let x = -4; x <= S + 4; x += 10) {
      const y = S * 0.5 + Math.sin(x * 0.03 + ph) * S * 0.22;
      x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    for (let i = 0; i < 6; i++) {                      // 樹蔭淡影(樹體 = 3D 實例)
      g.fillStyle = 'rgba(60,110,52,0.35)';
      brushBlob(g, rnd() * S, rnd() * S, 9 + rnd() * 9, rnd);
    }
    const cs = ['#e88bb0', '#f2d24a', '#f5f5f5'];
    for (let i = 0; i < 3; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.fillStyle = '#5c8a44'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
      g.fillStyle = cs[(rnd() * cs.length) | 0];
      for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(x + (rnd() - 0.5) * 10, y + (rnd() - 0.5) * 10, 1.6, 0, 7); g.fill(); }
    }
  },
  plaza(g, S, rnd) {                                   // 廣場:同心圓環雙色舖面 + 放射縫線(fit)
    g.fillStyle = vary(0xb0a898, rnd, 6); g.fillRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    for (let r = S * 0.62; r > 10; r -= 16) {
      g.fillStyle = (r / 16 | 0) % 2 ? '#a89a86' : '#c0b4a0';
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(120,110,96,0.7)'; g.lineWidth = 2;
    for (let a = 0; a < 6.28; a += 0.52) {
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * S * 0.62, cy + Math.sin(a) * S * 0.62); g.stroke();
    }
    g.fillStyle = '#8a7c68';
    g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
  },
  scrapyard(g, S, rnd) {                               // 廢車場:鏽水漬 + 油污 + 廢鐵散件(fit)
    g.fillStyle = vary(0x86766a, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(150,80,42,${0.18 + rnd() * 0.22})`;
      brushBlob(g, rnd() * S, rnd() * S, 6 + rnd() * 14, rnd);
    }
    for (let i = 0; i < 8; i++) {                      // 油污(廢鐵散件 = 3D 實例)
      g.fillStyle = `rgba(40,40,44,${0.2 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, rnd() * S, 5 + rnd() * 10, rnd);
    }
  },
  containeryard(g, S, rnd) {                           // 貨櫃場:瀝青 + 黃色櫃位格線 + 走道白斑馬點(fit)
    g.fillStyle = vary(0x4a4e52, rnd, 5); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 18, rnd);
    }
    g.strokeStyle = '#d9b23d'; g.lineWidth = 2.5;
    for (let y = 14; y < S; y += 46) {
      for (let x = 10; x < S - 30; x += 40) g.strokeRect(x, y, 34, 16);
    }
    g.fillStyle = 'rgba(240,242,238,0.85)';
    for (let x = 8; x < S; x += 22) g.fillRect(x, S / 2 - 2, 12, 4);
  },
  cemetery(g, S, rnd) {                                // 墓園:草坪 + 十字步道 + 墓位淡列(墓碑 = 3D 實例)(fit)
    g.fillStyle = vary(0x7fa35e, rnd, 8); g.fillRect(0, 0, S, S);
    g.strokeStyle = '#cfc8b4'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(S / 2, 4); g.lineTo(S / 2, S - 4); g.stroke();
    g.beginPath(); g.moveTo(4, S / 2); g.lineTo(S - 4, S / 2); g.stroke();
    g.strokeStyle = 'rgba(90,110,80,0.4)'; g.lineWidth = 2;
    for (let y = 18; y < S - 8; y += 24) {             // 墓位列的踏痕淡線
      g.beginPath(); g.moveTo(8, y); g.lineTo(S - 8, y); g.stroke();
    }
  },
  solarfarm(g, S, rnd) {                               // 太陽能場:碎石地 + 支架軌道列(板體 = 3D 實例)(fit)
    g.fillStyle = vary(0x9a9584, rnd, 7); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (let i = 0; i < 40; i++) g.fillRect(rnd() * S, rnd() * S, 2, 2);
    g.strokeStyle = 'rgba(140,136,124,0.8)'; g.lineWidth = 3;
    for (let y = 14; y < S - 8; y += 30) {             // 支架軌道(板列由 3D solarpanel 對齊排上)
      g.beginPath(); g.moveTo(6, y); g.lineTo(S - 6, y); g.stroke();
    }
  },
  helipad(g, S, rnd) {                                 // 直升機坪:圓標 + H 字 + 外框虛線(fit)
    g.fillStyle = vary(0x8f9294, rnd, 5); g.fillRect(0, 0, S, S);
    g.strokeStyle = '#f2f4f0'; g.lineWidth = 6;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.34, 0, 7); g.stroke();
    g.lineWidth = 10;
    g.beginPath(); g.moveTo(S * 0.42, S * 0.36); g.lineTo(S * 0.42, S * 0.64); g.stroke();
    g.beginPath(); g.moveTo(S * 0.58, S * 0.36); g.lineTo(S * 0.58, S * 0.64); g.stroke();
    g.beginPath(); g.moveTo(S * 0.42, S / 2); g.lineTo(S * 0.58, S / 2); g.stroke();
    g.setLineDash([10, 8]); g.lineWidth = 3;
    g.strokeRect(8, 8, S - 16, S - 16); g.setLineDash([]);
  },
  // ======== 濕地擴充 ========
  fishpond(g, S, rnd) {                                // 魚塭:深水池格 + 水車白花 + 土堤(fit)
    g.fillStyle = vary(0x9a8a68, rnd); g.fillRect(0, 0, S, S);
    const gw = 74, gh = 56;
    for (let y = 8; y < S - 10; y += gh) {
      for (let x = 8; x < S - 10; x += gw) {
        g.fillStyle = vary(0x3f5e63, rnd, 10);
        g.fillRect(x, y, gw - 10, gh - 10);
        g.fillStyle = 'rgba(255,255,255,0.16)';        // 水面天光
        g.fillRect(x + 4, y + 4, gw - 26, 2.5);
        const wx = x + 10 + rnd() * (gw - 30), wy = y + 8 + rnd() * (gh - 24);
        g.fillStyle = 'rgba(240,248,250,0.85)';        // 增氧水車白花
        for (let k = 0; k < 6; k++) {
          g.beginPath(); g.arc(wx + (rnd() - 0.5) * 10, wy + (rnd() - 0.5) * 7, 1.6, 0, 7); g.fill();
        }
      }
    }
  },
};

// ---- 地表定義 ----
// shape:blob=不規則色塊 / rect=田塊、場地;uv:'fit'=單張鋪滿(否則世界投影 tile)
// edge:'fade'=外圈 alpha 淡出融入地形(自然類)/ 'ink'=硬邊墨線(人造類)
// slope:允許的高差/半徑比;rim:外圈隆起(田埂);fam:延伸擺放家族
// reg:整齊規律程度(0..1)= 放置時沿最近道路方向整齊擺放的機率(orient());
//     其餘機率、或附近無路 → 隨機朝向。人造耕地/場地高,自然色塊 0 恆隨機
const DEFS = {
  turf:         { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.40, reg: 0, green: true, fam: 'blobGreen' },
  meadow:       { shape: 'blob', uvS: 1 / 16, edge: 'fade', slope: 0.45, reg: 0, green: true, fam: 'blobGreen' },
  bushfield:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.40, reg: 0, green: true, fam: 'blobGreen' },
  flowerfield:  { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.35, reg: 0.15, green: true, fam: 'blobGreen' },
  orchard:      { shape: 'blob', uvS: 1 / 20, edge: 'fade', slope: 0.30, reg: 0.45, green: true, fam: 'blobGreen' },
  teafield:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.22, reg: 0.8, green: true, fam: 'rectFarm' },
  veggiefield:  { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.12, reg: 0.8, green: true, fam: 'rectFarm' },
  paddy:        { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.09, rim: 0.5, reg: 0.8, green: true, fam: 'rectFarm' },
  dryfield:     { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.14, rim: 0.35, reg: 0.7, fam: 'rectFarm' },
  wild:         { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'blobBare' },
  gravel:       { shape: 'blob', uvS: 1 / 10, edge: 'fade', slope: 0.40, reg: 0, fam: 'blobBare' },
  sand:         { shape: 'blob', uvS: 1 / 18, edge: 'fade', slope: 0.35, reg: 0, fam: 'blobBare' },
  mud:          { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.30, reg: 0, fam: 'blobBare' },
  crackedearth: { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.35, reg: 0, fam: 'blobBare' },
  redsoil:      { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.40, reg: 0, fam: 'blobBare' },
  lawn:         { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.30, reg: 0.2, green: true },
  concrete:     { shape: 'rect', uvS: 1 / 16, aspect: 0.8, edge: 'ink', slope: 0.14, reg: 0.75, fam: 'rectUrban' },
  brick:        { shape: 'rect', uvS: 1 / 8, aspect: 0.8, edge: 'ink', slope: 0.12, reg: 0.7 },
  pavement:     { shape: 'blob', uvS: 1 / 8, edge: 'ink', slope: 0.20, reg: 0.6 },
  parking:      { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.10, reg: 0.95, fam: 'rectUrban' },
  court:        { shape: 'rect', uv: 'fit', aspect: 0.54, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  track:        { shape: 'rect', uv: 'fit', aspect: 0.5, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  marsh:        { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.25, reg: 0, green: true, fam: 'wetFam', aq: 1 },
  lotus:        { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.15, reg: 0, fam: 'wetFam', aq: 1 },
  // — 水域專屬底毯(aq:灘線/水面高度淘汰放行,頂點高夾到水面上;terrainEnvCode===1 專用)—
  watertile:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 1.0, reg: 0, aq: 1 },
  deepwater:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 1.0, reg: 0, aq: 1 },
  // — 綠地擴充:竹林/枯朽森林/伐木業/棚架農業 —
  arrowbamboo:  { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.50, reg: 0, green: true, fam: 'blobGreen' },
  deadwood:     { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'deadFam' },
  fallenlogs:   { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.45, reg: 0, green: true, fam: 'deadFam' },
  clearcut:     { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.35, reg: 0.2, fam: 'deadFam' },
  lumberyard:   { shape: 'blob', uvS: 1 / 11, edge: 'fade', slope: 0.20, reg: 0.65, fam: 'deadFam' },
  rottencabin:  { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.25, reg: 0.3, green: true, fam: 'ruinFam' },
  vineyard:     { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.18, reg: 0.85, green: true, fam: 'rectFarm' },
  greenhouse:   { shape: 'rect', uv: 'fit', aspect: 0.6, edge: 'ink', slope: 0.10, reg: 0.9, fam: 'rectFarm' },
  // — 裸露地擴充:遺跡/死林/乾草原/廢耕/產業 —
  deadforest:   { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'deadFam' },
  slabruin:     { shape: 'blob', uvS: 1 / 10, edge: 'fade', slope: 0.45, reg: 0.15, fam: 'ruinFam' },
  steppe:       { shape: 'blob', uvS: 1 / 16, edge: 'fade', slope: 0.50, reg: 0, green: true, fam: 'alpFam' },
  abandonedfarm:{ shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.16, reg: 0.55, fam: 'rectFarm' },
  saltpan:      { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.06, reg: 0.85, fam: 'panFam' },
  quarry:       { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.45, reg: 0.5, fam: 'digFam' },
  // — 高地(相對高程分區;冬季裸露地也混入冰原)—
  plateau:      { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.60, reg: 0, fam: 'alpFam' },
  icefield:     { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.40, reg: 0, fam: 'alpFam' },
  scree:        { shape: 'blob', uvS: 1 / 11, edge: 'fade', slope: 0.80, reg: 0, fam: 'alpFam' },
  // — 市區擴充:工業/服務/休憩設施 —
  construction: { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.20, reg: 0.7, fam: 'digFam' },
  gasstation:   { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.08, reg: 0.95, fam: 'rectUrban' },
  park:         { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.30, reg: 0.15, green: true, fam: 'blobGreen' },
  plaza:        { shape: 'rect', uv: 'fit', aspect: 0.85, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  scrapyard:    { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.15, reg: 0.55, fam: 'yardFam' },
  containeryard:{ shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'yardFam' },
  cemetery:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.18, reg: 0.85, green: true },
  solarfarm:    { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.12, reg: 0.9, fam: 'solarFam' },
  helipad:      { shape: 'rect', uv: 'fit', aspect: 1.0, edge: 'ink', slope: 0.06, reg: 0.6 },
  // — 濕地擴充 —
  fishpond:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.06, reg: 0.8, fam: 'panFam' },
};
// 分區切片(值雜訊挑選;重複項 = 權重,首尾 = 稀有)
// 特徵層分區切片(值雜訊挑選;重複項 = 權重,首尾 = 稀有):
// 只放「場所」型地物 — 有立體細節或明確邊界;純地面型全數改由底毯負責
// 跨地貌形式差異(2026-07-12):太陽能板/貨櫃「市區零星件、裸露地大面積陣列」——
// solarfarm/containeryard 場所 patch 移到裸露地(荒地光電場/內陸貨櫃堆場),
// 市區改由 scatterDetails 在水泥地/停車場撒零星單件(見 concrete 分支)
const ZONES = {
  green: ['rottencabin', 'deadwood', 'paddy', 'flowerfield', 'orchard', 'arrowbamboo',
          'dryfield', 'bushfield', 'teafield', 'vineyard', 'paddy', 'clearcut',
          'veggiefield', 'flowerfield', 'fallenlogs', 'greenhouse', 'lumberyard'],
  bare:  ['slabruin', 'quarry', 'abandonedfarm', 'crackedearth', 'gravel', 'abandonedfarm',
          'solarfarm', 'containeryard', 'saltpan'],
  urban: ['helipad', 'park', 'brick', 'parking', 'plaza', 'court',
          'construction', 'track', 'gasstation', 'cemetery', 'scrapyard'],
  wet:   ['fishpond', 'lotus', 'marsh', 'fishpond'],
  alpine: ['slabruin', 'scree', 'plateau', 'slabruin'],
};
// 底毯分區切片:全為 tile 型(世界投影 UV)地面,大片連續鋪滿全部陸地
const CARPET = {
  green: ['turf', 'meadow', 'turf', 'bushfield', 'meadow', 'flowerfield', 'turf',
          'arrowbamboo', 'meadow', 'deadwood', 'turf', 'fallenlogs'],
  bare:  ['wild', 'gravel', 'steppe', 'crackedearth', 'sand', 'redsoil', 'wild',
          'deadforest', 'mud', 'scree'],
  urban: ['concrete', 'pavement', 'lawn', 'brick', 'concrete', 'park', 'pavement'],
  wet:   ['marsh', 'marsh', 'lotus'],
  water: ['watertile'],   // 水域專屬(深水格由 cellKeyAt 依水深改配 deepwater,不走雜訊輪替)
  alpine: ['plateau', 'scree', 'icefield', 'steppe', 'plateau'],
};
// 延伸擺放家族:同族 patch 相互毗鄰延伸(農田拼布 / 運動園區 / 綠地群落 /
// 伐木跡地群 / 聚落遺跡 / 高地帶 / 鹽田魚塭 / 工地採石 / 堆置場)
const FAMS = {
  rectFarm:  ['paddy', 'dryfield', 'teafield', 'vineyard', 'greenhouse', 'veggiefield', 'abandonedfarm'],
  rectUrban: ['parking', 'court', 'track', 'concrete', 'plaza', 'gasstation'],
  blobGreen: ['turf', 'meadow', 'flowerfield', 'bushfield', 'orchard', 'park', 'arrowbamboo'],
  blobBare:  ['wild', 'gravel', 'sand', 'crackedearth', 'redsoil', 'mud'],
  wetFam:    ['marsh', 'lotus'],
  deadFam:   ['deadwood', 'deadforest', 'fallenlogs', 'clearcut', 'lumberyard'],
  ruinFam:   ['slabruin', 'rottencabin'],
  alpFam:    ['plateau', 'scree', 'icefield', 'steppe'],
  panFam:    ['saltpan', 'fishpond'],
  digFam:    ['quarry', 'construction'],
  yardFam:   ['scrapyard', 'containeryard'],
  solarFam:  ['solarfarm'],
};
// 尺寸 [基準半徑, 變幅](rect 半寬;court/track 接近真實場地)
const SIZE = {
  turf: [9, 10], meadow: [10, 12], bushfield: [8, 8], flowerfield: [10, 8], orchard: [11, 8],
  lawn: [8, 8], wild: [10, 12], gravel: [8, 9], sand: [11, 12], mud: [8, 9],
  crackedearth: [11, 10], redsoil: [10, 9], marsh: [8, 8], lotus: [8, 6], watertile: [10, 8], deepwater: [10, 8],
  paddy: [13, 8], dryfield: [12, 8], teafield: [12, 6], veggiefield: [10, 6], concrete: [9, 7], brick: [7, 6],
  pavement: [8, 6], parking: [14, 4], court: [16, 3], track: [15, 3],
  arrowbamboo: [10, 8], deadwood: [11, 10], deadforest: [12, 10], fallenlogs: [9, 8],
  clearcut: [12, 8], lumberyard: [8, 6], rottencabin: [7, 4], vineyard: [13, 6],
  greenhouse: [11, 5], abandonedfarm: [12, 8], saltpan: [12, 6], fishpond: [11, 6],
  slabruin: [9, 6], steppe: [12, 12], plateau: [13, 10], icefield: [12, 10], scree: [10, 10],
  quarry: [14, 6], construction: [12, 6], gasstation: [11, 4], park: [12, 8], plaza: [10, 6],
  scrapyard: [11, 6], containeryard: [13, 5], cemetery: [10, 6], solarfarm: [14, 5], helipad: [9, 3],
};
// 綠色系季節色偏(材質 color 乘上貼圖)
const SEASON_TINT = { spring: 0xeaffe0, summer: 0xffffff, autumn: 0xffd9a8, winter: 0xdfe8ea };
const FLOWER_C = [0xe88bb0, 0xf2d24a, 0xf5f5f5, 0xc77ddb, 0xe8734a];
const CONTAINER_C = [0xd94f3d, 0x3d7ad9, 0x4f9a55, 0xe8a03d, 0x8a8f96];   // 貨櫃塗裝
const CAR_C = [0x9a4a3a, 0x5a6a7a, 0x7a6a3a, 0x4a5a4a, 0x8a3a2a];         // 廢車鏽色
const PUMP_C = [0xd94f3d, 0x3d6ed9, 0xf2d24a];                            // 加油機品牌色
const DRUM_C = [0x3d6ed9, 0xd94f3d, 0x4f9a55, 0xd9b23d, 0x8a8f96];        // 油桶塗裝
const AD_C = [0xe8734a, 0x3d7ad9, 0xf2d24a, 0x4f9a55, 0xc77ddb];          // 廣告看板底色

// ---- 3D 附件材質塗層:小型程序貼圖(白底 × 材質色/instance tint 相乘)----
// 人造附件不再是純色塊:貨櫃浪板/太陽能電池格/看板畫面/木箱板紋,與 2D 地表同語彙
const _detTexCache = new Map();
function detailTex(name) {
  if (_detTexCache.has(name)) return _detTexCache.get(name);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(0xDE7A ^ name.charCodeAt(0));
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S);
  if (name === 'corrugated') {                       // 貨櫃浪板:縱向明暗條
    for (let x = 0; x < S; x += 16) {
      g.fillStyle = 'rgba(120,120,124,0.35)'; g.fillRect(x, 0, 5, S);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 9, 0, 3, S);
    }
    g.fillStyle = 'rgba(150,90,50,0.3)';             // 鏽斑
    for (let i = 0; i < 5; i++) g.fillRect(rnd() * S, rnd() * S, 6 + rnd() * 10, 4 + rnd() * 6);
  } else if (name === 'solarcell') {                 // 太陽能板:電池片格線 + 天光反射
    g.fillStyle = '#dfe6f0'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
    for (let p = 0; p <= S; p += 21) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(0, 0, S * 0.4, S * 0.22);             // 斜角天光
  } else if (name === 'ad') {                        // 廣告看板:色塊構圖 + 標語筆畫
    g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(150,150,158,0.8)';
    g.fillRect(S * 0.08, S * 0.12, S * 0.5, S * 0.45);   // 主視覺色塊(乘 tint 後 = 品牌色)
    g.fillStyle = 'rgba(90,90,98,0.9)'; g.lineWidth = 5; g.lineCap = 'round';
    g.strokeStyle = 'rgba(90,90,98,0.9)';
    for (let i = 0; i < 3; i++) {                    // 標語行(抽象筆畫,不寫實際字)
      const y = S * (0.68 + i * 0.11);
      g.beginPath(); g.moveTo(S * 0.1, y); g.lineTo(S * (0.5 + rnd() * 0.35), y); g.stroke();
    }
  } else {                                           // wood 木箱:板條縫 + 木紋短撇
    for (let y = 0; y < S; y += 26) {
      g.strokeStyle = 'rgba(120,96,60,0.7)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    }
    g.strokeStyle = 'rgba(140,112,72,0.5)'; g.lineWidth = 1.6;
    for (let i = 0; i < 20; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + rnd() * 14, y + (rnd() - 0.5) * 3); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _detTexCache.set(name, t);
  return t;
}

// ---- 3D 細節(多零件;底部貼地,pebble 不平移 = 半埋入土)----
// c:'grass'/'foliage' = 季節色;'palette' = 每實例指定色(材質白底 × instance tint);
// tex = 材質塗層貼圖(detailTex;與 2D 地表同為程序 canvas)
const cone = (r, h, n) => new THREE.ConeGeometry(r, h, n).translate(0, h / 2, 0);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const cyl = (r0, r1, h, n) => new THREE.CylinderGeometry(r0, r1, h, n).translate(0, h / 2, 0);
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
  // — 枯朽森林/伐木業 —
  bamboo:   [{ geo: cyl(0.05, 0.08, 2.6, 4), c: 0xa9c364 },
             { geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0, 2.7, 0), c: 'foliage', sy: 0.7 }],
  // 枯立木:分枝基部 MUST 落在該高度的主幹半徑內(骨折感 = 基部懸在幹外)
  snag:     [{ geo: cyl(0.12, 0.3, 3.0, 5), c: 0x8a7a66 },
             { geo: cone(0.09, 1.5, 4).rotateZ(-0.9).translate(0.1, 1.8, 0), c: 0x8a7a66 },
             { geo: cone(0.08, 1.2, 4).rotateZ(1.1).translate(-0.08, 2.1, 0), c: 0x8a7a66 }],
  charsnag: [{ geo: cyl(0.1, 0.26, 2.4, 5), c: 0x3a3632 },
             { geo: cone(0.08, 1.2, 4).rotateZ(-1.0).translate(0.08, 1.5, 0), c: 0x3a3632 }],
  log:      [{ geo: new THREE.CylinderGeometry(0.32, 0.36, 3.4, 7).rotateZ(Math.PI / 2).translate(0, 0.34, 0), c: 0x8a6a48 }],
  stump:    [{ geo: cyl(0.42, 0.55, 0.55, 7), c: 0x6e5138 },
             { geo: new THREE.CylinderGeometry(0.36, 0.36, 0.08, 7).translate(0, 0.58, 0), c: 0xd9c49a }],
  logpile:  [{ geo: new THREE.CylinderGeometry(0.3, 0.3, 3.0, 6).rotateZ(Math.PI / 2).translate(0, 0.3, 0), c: 0x9a744e },
             { geo: new THREE.CylinderGeometry(0.3, 0.3, 3.0, 6).rotateZ(Math.PI / 2).translate(0, 0.3, 0.62), c: 0x8a6a48 },
             { geo: new THREE.CylinderGeometry(0.28, 0.28, 2.8, 6).rotateZ(Math.PI / 2).translate(0, 0.82, 0.3), c: 0xa5825a }],
  plank:    [{ geo: box(2.2, 0.8, 1.1), c: 0xc9a86a }],
  cabin:    [{ geo: box(3.2, 1.7, 2.6), c: 0x6e5138 },
             { geo: new THREE.BoxGeometry(3.8, 0.2, 3.0).rotateZ(0.34).translate(0, 2.0, 0), c: 0x4f3a28 },
             { geo: new THREE.BoxGeometry(0.18, 2.6, 0.18).rotateZ(1.15).translate(1.9, 0.5, 0.6), c: 0x5c452e }],
  fencepost:[{ geo: cyl(0.07, 0.09, 1.1, 4), c: 0x6e5138 }],
  // — 棚架農業(半埋圓管 = 拱棚)—
  vinerow:  [{ geo: box(3.0, 1.0, 0.5), c: 0x4f7a38 },
             { geo: cyl(0.06, 0.06, 1.4, 4), c: 0x6e5138 }],
  ghouse:   [{ geo: new THREE.CylinderGeometry(1.0, 1.0, 3.2, 10).rotateZ(Math.PI / 2).translate(0, 0.32, 0), c: 0xd4dcd8 }],
  // — 遺跡/高地 —
  slab:     [{ geo: new THREE.BoxGeometry(1.7, 0.22, 1.2).rotateZ(0.16).translate(0, 0.3, 0), c: 0x9aa0a4 },
             { geo: box(0.7, 0.5, 0.6), c: 0x8d9094 }],
  iceshard: [{ geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.28, 0), c: 0xcfe8f2 }],
  rockflat: [{ geo: new THREE.IcosahedronGeometry(0.7, 0), c: 0x8f887a, sy: 0.45 }],
  saltmound:[{ geo: cone(0.6, 0.9, 6), c: 0xf2f4f0 }],
  // — 工地/工業 —
  pipe:     [{ geo: new THREE.CylinderGeometry(0.5, 0.5, 2.6, 9).rotateZ(Math.PI / 2).translate(0, 0.5, 0), c: 0xb4b8bc }],
  spoil:    [{ geo: cone(1.2, 0.9, 7), c: 0x9a9384 }],
  barrier:  [{ geo: box(1.6, 0.7, 0.3), c: 0xe0dcd0 }],
  canopy:   [{ geo: cyl(0.14, 0.14, 3.2, 5), c: 0xc8ccc8 },
             { geo: new THREE.BoxGeometry(4.6, 0.28, 3.2).translate(0, 3.3, 0), c: 0xe8e4da }],
  pump:     [{ geo: box(0.5, 1.1, 0.35), c: 'palette' }],
  container:[{ geo: box(3.0, 1.3, 1.25), c: 'palette', tex: 'corrugated' }],
  carwreck: [{ geo: box(1.9, 0.6, 1.05), c: 'palette' }],
  solarpanel: [{ geo: new THREE.BoxGeometry(2.4, 0.1, 1.4).rotateX(-0.42).translate(0, 0.85, 0), c: 0x2e4a6e, tex: 'solarcell' },
             { geo: cyl(0.07, 0.07, 0.6, 4), c: 0x9aa0a4 }],
  // — 休憩設施 —
  bench:    [{ geo: box(1.4, 0.45, 0.5), c: 0x8a6a48, tex: 'wood' }],
  headstone:[{ geo: box(0.5, 0.85, 0.16), c: 0xb0b2ae }],
  // — 通用散件(2026-07-10:貼圖上的 2D 物件全面 3D 化)—
  boulder:  [{ geo: new THREE.IcosahedronGeometry(1.0, 0).translate(0, 0.5, 0), c: 0x8a8578, sy: 0.75 },
             { geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0.75, 0.22, 0.3), c: 0x9a948a, sy: 0.7 }],
  drybush:  [{ geo: new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.4, 0), c: 0xa08c58, sy: 0.7 }],
  drum:     [{ geo: cyl(0.34, 0.34, 0.95, 8), c: 'palette' }],
  crate:    [{ geo: box(0.95, 0.9, 0.95), c: 0xb8935a, tex: 'wood' }],
  // — 2026-07-12 附件擴充:飄逸芒草/雜草/菜園葉球/看板/盆栽/籃球架 —
  miscanthus:[{ geo: cone(0.5, 1.6, 5), c: 'grass' },                     // 芒草束:斜出抽穗 = 飄逸剪影
             // 花穗基部埋進草束錐內(該高度錐半徑 ~0.15),自叢心斜出才不像折枝
             { geo: cone(0.15, 1.1, 4).rotateZ(0.4).translate(0.1, 1.1, 0), c: 0xe8dfb8 },
             { geo: cone(0.14, 1.0, 4).rotateZ(-0.32).translate(-0.09, 1.05, 0.04), c: 0xd8cfa8 },
             { geo: cone(0.13, 0.9, 4).rotateX(0.35).translate(0, 1.0, 0.1), c: 0xe0d5ae }],
  weed:     [{ geo: cone(0.3, 0.75, 4), c: 0x9aa060 },                    // 雜草:歪斜雙叢
             { geo: cone(0.2, 0.55, 4).rotateZ(0.5).translate(0.25, 0, 0), c: 0x8a9050 }],
  cabbage:  [{ geo: new THREE.IcosahedronGeometry(0.34, 0).translate(0, 0.24, 0), c: 0x6f9a44, sy: 0.75 }],
  billboard:[{ geo: cyl(0.09, 0.12, 3.4, 5).translate(-1.4, 0, 0), c: 0x8a8f96 },
             { geo: cyl(0.09, 0.12, 3.4, 5).translate(1.4, 0, 0), c: 0x8a8f96 },
             { geo: box(3.8, 2.0, 0.16).translate(0, 2.2, 0), c: 'palette', tex: 'ad' },
             { geo: new THREE.BoxGeometry(4.0, 0.16, 0.2).translate(0, 2.16, 0), c: 0x5a6066 }],
  planter:  [{ geo: box(1.0, 0.5, 1.0), c: 0xa8654a },                    // 盆栽:陶盆 + 修剪灌木
             { geo: new THREE.IcosahedronGeometry(0.58, 0).translate(0, 0.95, 0), c: 'foliage', sy: 0.85 }],
  hoop:     [{ geo: cyl(0.1, 0.13, 3.0, 5), c: 0x8a8f96 },                // 籃球架:柱 + 白板 + 橘框
             { geo: box(1.8, 1.15, 0.1).translate(0, 2.55, -0.08), c: 0xf2f4f0 },
             { geo: new THREE.TorusGeometry(0.29, 0.045, 4, 9).rotateX(Math.PI / 2).translate(0, 2.8, 0.32), c: 0xd9622e }],
};

// 每型別的最大隨機傾角(rad;繞 x/z 各自抽):自然件歪斜、人造件近直立,
// 加上既有的隨機朝向 ry / 尺寸抖動 → 同型實例不再複製貼上
const TILT = {
  tuft: 0.22, rice: 0.16, reed: 0.2, bush: 0.1, sapling: 0.09, flower: 0.16, lotuspad: 0.05,
  bamboo: 0.13, snag: 0.18, charsnag: 0.18, log: 0.07, stump: 0.06, logpile: 0.05, plank: 0.08,
  fencepost: 0.14, vinerow: 0.04, ghouse: 0.03, slab: 0.22, iceshard: 0.35, rockflat: 0.3,
  saltmound: 0.06, pipe: 0.06, spoil: 0.05, barrier: 0.08, pebble: 0.4, hay: 0.07,
  boulder: 0.3, drybush: 0.18, drum: 0.07, crate: 0.06, carwreck: 0.05, bench: 0.04, headstone: 0.1,
  miscanthus: 0.24, weed: 0.3, cabbage: 0.12, billboard: 0.04, planter: 0.05, hoop: 0.03,
};

// 每型 3D 物件的整齊規律程度(0..1)= 隨機朝向路徑改為「沿最近道路方向擺放」的
// 機率(addDetail 經 orient() 擲骰;rows()/固定 ry 呼叫端已對齊 patch 軸,不經此表)。
// 人造直線件(貨櫃/太陽能板/看板/長凳/墓碑/拱棚)高;自然件與旋轉對稱件 0 恆隨機。
const REG = {
  tuft: 0, rice: 0, reed: 0, bush: 0, pebble: 0, hay: 0.3, sapling: 0, flower: 0, lotuspad: 0,
  bamboo: 0, snag: 0, charsnag: 0, log: 0.15, stump: 0, logpile: 0.6, plank: 0.4, cabin: 0.7,
  fencepost: 0.2, vinerow: 0.9, ghouse: 0.85, slab: 0.1, iceshard: 0, rockflat: 0, saltmound: 0,
  pipe: 0.5, spoil: 0, barrier: 0.75, canopy: 0.9, pump: 0.9, container: 0.9, carwreck: 0.45,
  solarpanel: 0.9, bench: 0.8, headstone: 0.85, boulder: 0, drybush: 0, drum: 0.2, crate: 0.5,
  miscanthus: 0, weed: 0, cabbage: 0, billboard: 0.85, planter: 0.6, hoop: 0.9,
};

function bucketOf(buckets, key) {
  let b = buckets.get(key);
  if (!b) { b = { pos: [], nrm: [], uv: [], col: [], idx: [], base: 0 }; buckets.set(key, b); }
  return b;
}

// 不規則色塊。edge:'fade' 外圈 alpha=0 淡入地形;'ink' 外圈墨線頂點色(手繪描邊)
function emitBlob(b, terrain, x, z, r, lift, uvS, edge, pt, rnd) {
  const n = 12;
  // 每塊 UV 隨機旋轉:同款貼圖不同朝向(視野內同款已不重複,無需跨塊花紋連續)
  const ua = rnd() * Math.PI * 2, cu = Math.cos(ua), su = Math.sin(ua);
  const push = (vx, vz, cr, cg, cb, ca) => {
    b.pos.push(vx, terrain.heightAt(vx, vz) + lift, vz);
    b.nrm.push(0, 1, 0);
    b.uv.push((vx * cu - vz * su) * uvS, (vx * su + vz * cu) * uvS);
    b.col.push(cr * pt[0], cg * pt[1], cb * pt[2], ca);
  };
  const ph = rnd() * Math.PI * 2;               // 輪廓隨機起始相位:同半徑 blob 形狀互異
  const angs = [], rads = [];
  for (let i = 0; i < n; i++) {
    angs.push(ph - i / n * Math.PI * 2);        // 角度遞減 → 三角形面朝 +y
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
function emitRect(b, terrain, x, z, r, rot, def, lift, pt, flipU, flipV, rnd) {
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
        const u = i / (nx - 1), v = j / (nz - 1);
        b.uv.push(flipU ? 1 - u : u, flipV ? 1 - v : v);   // 隨機雙軸鏡射:同變體場地四款朝向
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

// ==== 異類交界外溢配置(2026-07-29 邊界鋸齒改制;唯一縫,稽核執行原文)====
// 舊制 = 整格單向外溢:kA<kB 的一側把整張 cell 貼進「四鄰」鄰格(共享邊 α=1 → 對邊 0)。
// 兩個結構性病灶就是使用者回報的「不同類型地貌邊界的不自然鋸齒」:
//   ①交界輪廓被量化在 13m 級 cell 邊上,斜向邊界變成 90° 階梯狀鋸齒(角點抖動只能
//     讓每段扭一下,消不掉階梯本身);②對角鄰格之間沒有任何淡出,階梯每個轉角都留
//     一個硬缺口,鋸齒感被進一步強化(同格互疊的兩張外溢還會共面深度互吃)。
// 新制 = 角點隸屬度雙線性淡出(dual-grid / marching-squares 語彙):
//   角點對某 key 的權重 = 圍著該角點的四格中屬於該 key 的比例,分母只算「有毯格」
//   (崖 '!' / 未鋪 null 不計 ⇒ 底毯淡出到崖面/圖界時交界角點權重收斂到 1,與不透明
//   底毯無縫銜接);每格對每個「異類鄰 key」(含對角鄰)各發一張 α=角點權重的外溢格。
//   兩側對稱互溢 ⇒ 交界中線恰為 50/50 混色;雙線性 0.5 等值線把 90° 階梯削成平滑
//   斜線,對角權重把階梯轉角的缺口補齊;孤立單格(影像分類雜訊斑點)角點權重達
//   0.75,自動被鄰區軟化吞掉。
// 純函式(零 rnd / 零 Math.random,§2.3;不碰 THREE):輸入 keys 格網,輸出
// [{ i, j, key, alphas, st }];alphas 對應 emitCell 四角 [P0(i,j), P1(i+1,j), P2(i+1,j+1), P3(i,j+1)]。
//
// —— 逐組合交界樣式(2026-07-29 追加,使用者定案「真實世界的邊界通常不是用融合的,
//    不同類型地貌有各自多元的邊界,有的明確、有的有各種中間過渡樣態」)——
// 樣式以 coarse 分區「無序對」查表(SEAM_STYLES;查無 → SEAM_SOFT 柔和淡出),四種樣態:
//   sharp  明確邊界(人工):過渡壓窄 ×sharp、擾動壓低 —— 市區對任何地貌是路緣/牆基的
//          直線切換,不是漸層(市區↔市區換鋪面切線最直);遮蔽物層的矮牆/圍籬同組把關。
//   soft   柔和淡出(預設):同分區異款(草皮↔花田)與其餘組合,維持雙線性 + 碎形擾動。
//   dither 斑塊過渡:雪線/高地界不是漸層也不是直線,是「殘雪/岩屑斑塊」—— 過渡帶把 α
//          往準晶體場的 0/1 斑塊推(端點錨定,見 seamAlpha)。
//   mid    中間過渡樣態:交界脊帶(4·w自·w鄰,恰在 50/50 混色線達峰)疊第三種地表 ——
//          綠地↔裸露地夾乾草原帶(steppe)、綠地/水↔濕地夾蘆葦帶(marsh)、裸露地↔濕地
//          夾泥灘帶(mud);以低頻值雜訊「間歇」出現(midP 蓋率,峰寬 ~65m)—— 真實
//          過渡帶本來就時有時無,整條都鑲滿反而假。
// 三個水密不變式(稽核 Ⅴ):①脊帶用「兩 key 權重乘積」不是單邊 w(1−w) —— 三分區交點
// 兩側才會算出同值;②間歇閘 gateAt 吃「角點座標」不是格索引 —— 逐格閘門會在格邊切出
// 新的硬縫;③樣式端點恆定(α=0→0、1→1,見 seamAlpha)—— 交界帶盡頭與不透明底毯無縫。
export const SEAM_STYLES = {
  // — 明確(人工)邊界 —
  'green|urban':  { sharp: 3.2, noise: 0.12 },
  'bare|urban':   { sharp: 3.2, noise: 0.12 },
  'urban|wet':    { sharp: 3.2, noise: 0.12 },
  'alpine|urban': { sharp: 3.2, noise: 0.12 },
  'urban|urban':  { sharp: 3.6, noise: 0.06 },
  'urban|water':  { sharp: 3.2, noise: 0.10 },   // 碼頭/堤岸:硬岸線
  // — 生態過渡帶(ecotone):寬淡出 + 高擾動 + 間歇中間樣態 —
  'bare|green':   { noise: 0.5,  mid: 'steppe', midP: 0.55 },
  'green|wet':    { noise: 0.45, mid: 'marsh',  midP: 0.7 },
  'bare|wet':     { noise: 0.45, mid: 'mud',    midP: 0.6 },
  'green|water':  { noise: 0.45, mid: 'marsh',  midP: 0.45 },   // 自然岸零星蘆葦緣(泡沫另住 buildWaterEdges)
  'water|wet':    { noise: 0.45, mid: 'marsh',  midP: 0.6 },
  // — 雪線/高地界:斑塊狀 —
  'alpine|bare':  { dither: 1 },
  'alpine|green': { dither: 1 },
};
export const SEAM_SOFT = { noise: 0.4 };   // 預設:柔和淡出(同分區異款與其餘組合)

// 交界頂點 α 塑形(純函式;emitCell 對外溢層逐頂點呼叫,稽核直測):
// q = 準晶體場值 ∈[-1,1]。端點恆定:a=0→0、a=1→1(所有樣式)⇒ 與不透明底毯水密。
export function seamAlpha(a, q, st) {
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  const s = st || SEAM_SOFT;
  if (s.sharp) a = Math.min(1, Math.max(0, (a - 0.5) * s.sharp + 0.5));
  const band = a * (1 - a) * 4;                 // 過渡帶包絡:端點歸零
  if (band <= 0) return a;
  if (s.dither) {                               // 斑塊:帶內把 α 推向場的 0/1 斑塊、兩端錨定
    const f = Math.min(1, Math.max(0, (a + q * 0.5 - 0.5) * 3 + 0.5));
    return a * (1 - band) + f * band;
  }
  return Math.min(1, Math.max(0, a + q * (s.noise ?? 0.4) * band));
}

export function planSeamOverlays(keys, gnx, gnz, opts = {}) {
  const { coarseOf = null, seed = 0, variants = 6 } = opts;
  const keyAt = (i, j) => (i < 0 || j < 0 || i >= gnx || j >= gnz) ? null : keys[j * gnx + i];
  const solid = (k) => k != null && k !== '!';          // 有毯格才算隸屬度分母/外溢來源
  const zoneOf = (k) => (coarseOf && k != null && k !== '!') ? coarseOf(k) : null;
  const styleOf = (za, zb) => {                         // 分區無序對 → 樣式(查無/分區未知 → 柔和)
    if (!za || !zb) return SEAM_SOFT;
    return SEAM_STYLES[za < zb ? `${za}|${zb}` : `${zb}|${za}`] || SEAM_SOFT;
  };
  const hash01 = (i, j, s) => {
    let n = (Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 2246822519) ^ seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const vn01 = (x, z, s) => {                           // 平滑值雜訊(雙線性;間歇閘用,純函數)
    const xi = Math.floor(x), zi = Math.floor(z);
    let fx = x - xi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    return (hash01(xi, zi, s) * (1 - fx) + hash01(xi + 1, zi, s) * fx) * (1 - fz)
         + (hash01(xi, zi + 1, s) * (1 - fx) + hash01(xi + 1, zi + 1, s) * fx) * fz;
  };
  // 中間樣態間歇閘:吃「角點座標」(逐角純函數 → 相鄰脊帶格共用角同值,水密);
  // 波長 5 格 ≈ 65m,midP = 期望蓋率,0.18 軟肩讓帶頭帶尾漸收不硬切
  const gateAt = (ci, cj, p) => Math.min(1, Math.max(0, (p - vn01(ci / 5, cj / 5, 0x51AB)) / 0.18));
  const cornerW = (k, ci, cj) => {                      // 角點 (ci,cj) 由 (ci-1..ci, cj-1..cj) 四格圍繞
    let n = 0, valid = 0;
    for (const [oi, oj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const kk = keyAt(ci + oi, cj + oj);
      if (solid(kk)) { valid++; if (kk === k) n++; }
    }
    return valid ? n / valid : 0;
  };
  const midVar = (sub) => {                             // 脊帶變體:每圖每樣態固定一款 —— 帶與帶之間
    let h = seed | 0;                                   // 沒有 crossfade,逐格/逐區換款會在帶峰上切出換款縫
    for (let c = 0; c < sub.length; c++) h = (Math.imul(h, 31) + sub.charCodeAt(c)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % variants;
  };
  const out = [];
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const k0 = keyAt(i, j);
      if (k0 == null) continue;                        // 未鋪格(水色灰帶/岸線)維持留空,不收外溢
      const z0 = zoneOf(k0);
      const seen = new Set(), seenMid = new Set();     // '!' 崖格可收外溢(淡出融入崖面)但不外溢
      const cs = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      for (let oj = -1; oj <= 1; oj++) {
        for (let oi = -1; oi <= 1; oi++) {
          if (!oi && !oj) continue;
          const kn = keyAt(i + oi, j + oj);
          if (!solid(kn) || kn === k0 || seen.has(kn)) continue;
          seen.add(kn);
          const st = styleOf(z0, zoneOf(kn));
          const alphas = [cornerW(kn, i, j), cornerW(kn, i + 1, j),
                          cornerW(kn, i + 1, j + 1), cornerW(kn, i, j + 1)];
          if (alphas[0] || alphas[1] || alphas[2] || alphas[3]) out.push({ i, j, key: kn, alphas, st });
          // 中間過渡樣態:兩 key 權重乘積的脊帶(50/50 混色線達峰 → 蓋住殘縫),間歇出現
          if (st.mid && z0 && !seenMid.has(st.mid)) {
            const bandAl = [0, 0, 0, 0];
            let mx = 0;
            for (let c = 0; c < 4; c++) {
              const wS = cornerW(k0, cs[c][0], cs[c][1]);
              const wF = alphas[c];
              bandAl[c] = 4 * wS * wF * gateAt(cs[c][0], cs[c][1], st.midP ?? 0.5);
              if (bandAl[c] > mx) mx = bandAl[c];
            }
            if (mx > 0.03) {
              seenMid.add(st.mid);
              out.push({ i, j, key: `${st.mid}#${midVar(st.mid)}`, alphas: bandAl, st: { band: 1 } });
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * 鋪設地被覆蓋層。加進 biomes group,回傳統計 { patches, details }。
 * @param group     biomes 的 THREE.Group
 * @param terrain   buildTerrain() 回傳物
 * @param opts.isBlocked  (x,z)=>bool 兵線/塔/主堡淨空
 * @param opts.classifyAt (x,z)=>'green'|'bare'|'urban'|'wet'|'water'(classifyPureAt 缺席時的備援)
 * @param opts.classifyPureAt 純圖資分類(無場地 mix 改寫);底毯與特徵層一律用它,
 *                            拼圖類型才與衛星影像相符(球場限市區/水田限綠地/碎石限裸露地)
 * @param opts.blockers   建物碰撞柱(patch 避開建物)
 * @param opts.season / opts.seed / opts.rnd  決定性環境參數
 * @param opts.roadDirAt  (x,z)=>最近道路方位角(rad,atLocal 平面角)或 null(附近無路);
 *                        整齊件沿路擺放用,可缺席 = 全部隨機朝向(行為同舊版)
 * @param opts.roadClear  (x,z)=>是否落在道路走廊上(bool);特徵拼圖避開路面免 3D 件戳穿,
 *                        可缺席 = 不遮罩(行為同舊版)。查詢不吃 rnd(拒絕在首個 rnd() 前 = 序列不變)
 */
export function buildGroundCover(group, terrain, { isBlocked, classifyAt, classifyPureAt, envCodeAt, blockers, season, seed, rnd, roadDirAt, roadRank, roadClear, roadPolys }) {
  const classifyPure = classifyPureAt || classifyAt;   // 底毯用:無隨機改寫的分區
  const envAt = envCodeAt || (() => 0);                // 水/沼分類唯一縫(biomes.terrainEnvCode;缺席 = 全乾)
  const AQ_DET = new Set(['reed', 'lotuspad']);        // 水生細節:免吃岸線高度淘汰、貼水面擺放
  const buckets = new Map();   // `${sub}#${variant}` -> 幾何桶
  const det = {};
  for (const t in DETAIL_DEFS) det[t] = [];
  let detCount = 0;
  let detCap = FEAT_DETAIL;   // 特徵層先用配額,底毯撒佈前放寬到 MAX_DETAIL
  // 整齊度 → 沿路對齊:reg = 該型拼圖/物件沿最近道路方向擺放的機率,其餘機率
  // (或附近無路)隨機朝向。亂數紀律(§2.3):固定先抽兩枚再決策 —— 對齊與否
  // 不改變 rnd 消耗序列;roadDirAt 本身不吃 rnd。回傳 atLocal 平面角。
  let aligned = 0;   // 沿路對齊次數(拼圖 + 物件;冒煙稽核用)
  const orient = (x, z, reg, halfTurn) => {
    const ra = rnd() * (halfTurn ? Math.PI : Math.PI * 2);   // 隨機朝向候選(固定枚數)
    const roll = rnd();                                       // 對齊擲骰(固定枚數)
    if (!reg || !roadDirAt || roll >= reg) return ra;
    const a = roadDirAt(x, z);
    if (a == null) return ra;
    aligned++;
    return a;
  };
  // ry:null = 依 REG[type] 整齊度擲骰(沿路對齊或隨機朝向);
  // 傳入固定角 = 對齊列陣(藤架/太陽能板/貨櫃與貼圖行列同向),不經整齊度擲骰
  const addDetail = (type, px, pz, s, tintHex = null, sy = 1, ry = null) => {
    if (detCount >= detCap || isBlocked(px, pz)) return;
    let y = terrain.heightAt(px, pz);
    if (y < 0.4) {
      if (!AQ_DET.has(type)) return;                   // 水生細節(蘆葦/荷葉)放行:貼水面擺放
      if (terrain.waterY != null) y = Math.max(y, terrain.waterY);
    }
    const tl = TILT[type] || 0;   // 隨機傾角:每實例姿態互異
    // atLocal 平面角 → three.js rotation.y 取負(同 rows 的 ry=-rot 慣例)
    det[type].push({ x: px, y, z: pz, s, sy, ry: ry ?? -orient(px, pz, REG[type] || 0, false),
                     tx: (rnd() - 0.5) * 2 * tl, tz: (rnd() - 0.5) * 2 * tl, tint: tintHex });
    detCount++;
  };

  const inb = 30;
  const area = terrain.worldW * terrain.worldH / 1e6;
  const target = Math.max(140, Math.min(1800, Math.round(area * 420)));
  let placed = 0;
  let arraysN = 0;   // 沿街規律陣列落塊數(冒煙稽核用;patches 含此數)

  // ---- 高地/季節分區:量測全場高程「起伏」(絕對海拔無意義,高原城市會誤判),
  // 相對高處改鋪高原/岩屑/冰原 ----
  let hMin = Infinity, hMax = -Infinity;
  for (let j = 0; j <= 20; j++) {
    for (let i = 0; i <= 20; i++) {
      const h = terrain.heightAt(terrain.minX + terrain.worldW * i / 20, terrain.minZ + terrain.worldH * j / 20);
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  }
  const relief = hMax - hMin;
  const alpineH = relief > 40 ? hMin + relief * 0.62 : Infinity;   // 平坦地圖不出現高地地貌
  const zoneLists = { ...ZONES };
  const carpetLists = { ...CARPET };
  if (season === 'winter') {                            // 冬季:裸露地混入冰原、高地以冰原為主
    zoneLists.bare = ['icefield', ...ZONES.bare, 'icefield'];
    zoneLists.alpine = ['plateau', 'icefield', 'scree', 'icefield', 'plateau', 'icefield'];
    carpetLists.bare = ['icefield', ...CARPET.bare, 'icefield'];
    carpetLists.alpine = ['icefield', 'plateau', 'icefield', 'scree', 'icefield'];
  }
  // coarse 分區查詢(sub → zone):交界樣式(planSeamOverlays)與邊界遮蔽物共用同一份(單一縫)
  const subCoarse = new Map();
  for (const zn in carpetLists) for (const s of carpetLists[zn]) if (!subCoarse.has(s)) subCoarse.set(s, zn);
  subCoarse.set('watertile', 'water'); subCoarse.set('deepwater', 'water');
  const coarseOfKey = (key) => subCoarse.get(key.slice(0, key.indexOf('#'))) || 'green';
  // 每地表允許出現的分區(特徵 + 底毯清單聯集):tryPatch 一律據此把關,
  // 家族延伸(鹽田→魚塭、農田拼布)跨進異分區/越過圖資邊界時直接擋下
  const subZones = new Map();
  for (const lists of [zoneLists, carpetLists]) {
    for (const zn in lists) {
      for (const sub of lists[zn]) {
        let s = subZones.get(sub);
        if (!s) { s = new Set(); subZones.set(sub, s); }
        s.add(zn);
      }
    }
  }
  const zoneAt = (x, z) => {
    // 水/沼優先走 envCode(與伺服器遮罩/涉水判定同一規則 = WYSIWYG):
    // 水域回 'water'(無特徵 patch 清單 ⇒ 任何場所拼圖不得落水),沼澤回 'wet'(啟用濕地特徵)
    const ec = envAt(x, z);
    if (ec === 1) return 'water';
    if (ec === 2) return 'wet';
    let zn = classifyPure(x, z);
    if ((zn === 'green' || zn === 'bare') && terrain.heightAt(x, z) > alpineH) zn = 'alpine';
    return zn;
  };

  // ==== 底毯層:抖動網格無縫鋪滿全部陸地 ====
  // 角點位置只由「格點索引雜湊」決定 → 相鄰 cell 引用同一角點,拼面天生水密;
  // 抖動幅度 ±0.45 格(不足半格,拓撲不翻面)讓交界呈手繪碎形而非直線格線。
  const carpetBuckets = new Map(), spillBuckets = new Map(), bandBuckets = new Map();
  const CLIFT = 0.07, SLIFT = 0.10;                     // 底毯 0.070 < 外溢 [0.100,0.107] < 不規律 fade[.110,.124] < 規律 ink[.135,.172] < 道路 0.18
  const cell = Math.max(13, Math.max(terrain.worldW, terrain.worldH) / 232);
  // 外溢每 key 微升差(0~0.007,合計仍 < fade 下限 0.110):異 key 外溢在同一格互疊時
  // 避免共面深度互吃(舊制後畫的整張被深度測試丟棄 = 交界轉角硬缺口);繪序(renderOrder)
  // 依同一雜湊 ⇒ 低者先畫、高者後蓋,混色連續且跨客戶端決定性(§2.3,不吃 rnd)
  const seamLift = (key) => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return ((h >>> 3) % 8) * 0.001;
  };
  // 過渡帶手繪碎形擾動波數(世界波長 ≈ 1.6 cell:小於交界帶寬、大於頂點間距)
  const SEAM_QC_W = (2 * Math.PI) / (cell * 1.6);
  const gnx = Math.ceil(terrain.worldW / cell), gnz = Math.ceil(terrain.worldH / cell);
  // ==== 準晶體場(quasicrystal;不規律拼貼的非週期骨架;底毯角點/選格/細節共用縫)====
  // 5 向平面波和(方向 kπ/5 → 十重對稱 = 各向同性、非週期)。純函數:同 seed 同座標 ⇒ 同值,
  // 全房間/跨客戶端一致(§2.3);相位由 seed 導 → 每圖不同、同房相同。零 rnd / 零 Math.random(A4)。
  // 以波數 w 縮放同一支餵三尺度:角點去格化(粗)、底毯選格群聚(中)、細節 blue-noise(細)。
  const QC_N = 5;
  const QC_DIR = [];
  for (let k = 0; k < QC_N; k++) QC_DIR.push([Math.cos(k * Math.PI / QC_N), Math.sin(k * Math.PI / QC_N)]);
  const QC_PH = QC_DIR.map((_, k) => {
    let n = (seed ^ Math.imul(k + 1, 0x9E3779B1)) | 0;
    n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296 * Math.PI * 2;
  });
  // 場值 ∈[-1,1] 嚴格(N 道 cos /N)→ 角點位移可精確編列 ±0.45 預算
  const qcVal = (x, z, w) => {
    let s = 0;
    for (let k = 0; k < QC_N; k++) s += Math.cos(w * (QC_DIR[k][0] * x + QC_DIR[k][1] * z) + QC_PH[k]);
    return s / QC_N;
  };
  // ∇場單位向量(指向最近波峰);近平坦回 [0,0]
  const qcGrad = (x, z, w) => {
    let gx = 0, gz = 0;
    for (let k = 0; k < QC_N; k++) {
      const s = -Math.sin(w * (QC_DIR[k][0] * x + QC_DIR[k][1] * z) + QC_PH[k]);
      gx += s * QC_DIR[k][0]; gz += s * QC_DIR[k][1];
    }
    const m = Math.hypot(gx, gz);
    return m < 1e-6 ? [0, 0] : [gx / m, gz / m];
  };
  // 細節 blue-noise 微推:白噪落點沿最近峰偏置 0.7m(<¼ 波長 → 去叢聚不硬吸);純函數,不吃 rnd
  const DET_QC_W = (2 * Math.PI) / 2.6;
  const qcNudge = (px, pz) => { const [gx, gz] = qcGrad(px, pz, DET_QC_W); return [px + gx * 0.7, pz + gz * 0.7]; };
  const QC_SEL_W = 0.035;   // 底毯 subtype 群聚調變波數(世界波長 ≈ 180m)

  const cornH = (i, j, s) => {                          // 手繪顆粒(疊在準晶體場上加碎形細節)
    let n = ((i * 374761393 + j * 668265263) ^ (seed ^ s)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  // 角點位移 = 準晶體場(主 ±0.34)+ cornH 顆粒(次 ±0.10),輸入格點索引 (i,j) → 天生 (i,j) 純函數
  // ⇒ 相鄰 cell 共用角索引 ⇒ 同位移 ⇒ 水密。dz 取座標偏移的第二組準晶體樣本解耦。合計振幅 0.44<0.45,
  // clampD 再保險 ⇒ 相鄰角最壞相向 0.88<1.0,拓撲不翻面。快取(i,j)→[x,z]:省重算 + 共用角位元相同保證。
  const QC_CORN_W = 1.75, QC_CORN_A = 0.34, QC_CORN_G = 0.20;
  const clampD = (d) => (d < -0.45 ? -0.45 : d > 0.45 ? 0.45 : d);
  const _cornCache = new Map();
  const cornerAt = (i, j) => {
    const ck = i * 65536 + j;
    let c = _cornCache.get(ck);
    if (c) return c;
    const dx = clampD(QC_CORN_A * qcVal(i, j, QC_CORN_W) + QC_CORN_G * (cornH(i, j, 0x9E37) - 0.5)) * cell;
    const dz = clampD(QC_CORN_A * qcVal(i + 8123.5, j + 2971.3, QC_CORN_W) + QC_CORN_G * (cornH(i, j, 0x85EB) - 0.5)) * cell;
    const x = terrain.minX + i * cell + dx, z = terrain.minZ + j * cell + dz;
    c = [Math.min(terrain.maxX, Math.max(terrain.minX, x)),
         Math.min(terrain.maxZ, Math.max(terrain.minZ, z))];
    _cornCache.set(ck, c);
    return c;
  };
  // 低頻水彩 wash(連續函數 → 跨 cell 無階差;botw_plan Task 2.1 的反重複手段)
  const wash = (x, z) => 0.88 + (vnoise(x * 0.011, z * 0.011, seed ^ 0x5A5A) - 0.5) * 0.34;
  // cell 分區:5 點多數決(抹平衛星像素雜訊的逐格跳動)+ 坡度規則
  //   懸崖(>0.75)→ '!' 不鋪(頂投影 UV 在近垂直面會拉絲,露地形岩面較自然,
  //                  鄰格外溢淡出補縫);中坡(>0.28)→ 強制 bare(山坡不會是停車場)
  //   低窪綠地(水面 +2.2m 內)→ wet(河岸蘆葦帶)
  const cellKeyAt = (i, j) => {                         // `${sub}#${variant}` / '!' / null(不鋪)
    const cx = terrain.minX + (i + 0.5) * cell, cz = terrain.minZ + (j + 0.5) * cell;
    const hC = terrain.heightAt(cx, cz);
    // 底毯用 3 變體(vs 特徵層 4;draw call 可控);大面積反重複交給 wash 雜訊 + 鏡射 UV
    const variant = Math.min(2, (vnoise(cx * 0.0025, cz * 0.0025, seed ^ 0x7E11) * 3) | 0);
    // 水/沼專屬拼圖(2026-07-22,envCode 與伺服器遮罩同一規則 = WYSIWYG):
    // 水域(1)必鋪水拼圖(免坡度/灘線淘汰 —— 水面是平的,易辨識優先);依水深配淺/深款。
    const ec = envAt(cx, cz);
    if (ec === 1) {
      const wy = terrain.waterY;
      return `${wy != null && hC < wy - 2.5 ? 'deepwater' : 'watertile'}#${variant}`;
    }
    const slope = Math.max(
      Math.abs(terrain.heightAt(cx + cell, cz) - hC),
      Math.abs(terrain.heightAt(cx, cz + cell) - hC)) / cell;
    if (slope > 0.75) return '!';
    const votes = {};
    for (const [ox, oz] of [[0, 0], [cell * 0.4, 0], [-cell * 0.4, 0], [0, cell * 0.4], [0, -cell * 0.4]]) {
      const zn0 = classifyPure(cx + ox, cz + oz);
      votes[zn0] = (votes[zn0] || 0) + 1;
    }
    let zn = Object.keys(votes).reduce((a, b) => (votes[b] > votes[a] ? b : a));
    if (zn === 'water') return null;   // envCode 判乾但影像多數決仍水色(灰帶):留空露衛星底圖
    if (slope > 0.28 && zn !== 'wet') zn = 'bare';
    // 沼澤(2)一律鋪濕地拼圖(取代舊「green 且 hC<2.2 且 minH<0.5」私規則 —— 與 envCode 統一)
    if (ec === 2) zn = 'wet';
    if ((zn === 'green' || zn === 'bare') && hC > alpineH) zn = 'alpine';
    const list = carpetLists[zn];
    if (!list) return null;
    let t = (vnoise(cx * 0.006, cz * 0.006, seed) - 0.5) * 2.2 + 0.5;
    if (zn !== 'urban') t += qcVal(cx, cz, QC_SEL_W) * 0.30;   // 不規律 zone 疊準晶體 → 群聚邊界非週期
    t = Math.min(0.999, Math.max(0, t));
    return `${list[(t * list.length) | 0]}#${variant}`;
  };
  // cell 幾何:3×3 貼地網格(邊中點 = 共用角點的中點 → 相鄰 cell 完全同點,水密;
  // ~半格取樣讓 cell 貼合地形起伏,丘頂不再戳穿底毯),頂點色 = wash
  const emitCell = (bmap, key, ti, tj, alphas, st) => {
    const P0 = cornerAt(ti, tj), P1 = cornerAt(ti + 1, tj);
    const P2 = cornerAt(ti + 1, tj + 1), P3 = cornerAt(ti, tj + 1);
    const mid = (a2, b2) => [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
    // 3×3 排列(列沿 z、行沿 x):P0 E01 P1 / E30 M E12 / P3 E23 P2
    const G = [P0, mid(P0, P1), P1,
               mid(P3, P0), mid(mid(P0, P1), mid(P3, P2)), mid(P1, P2),
               P3, mid(P3, P2), P2];
    const sub0 = key.slice(0, key.indexOf('#'));
    const aq = !!DEFS[sub0].aq;                         // 水生拼圖:免灘線淘汰、頂點夾到水面上(可見)
    let hs = G.map(([px, pz]) => terrain.heightAt(px, pz));
    if (!aq && Math.min(...hs) < 0.45) return null;     // 岸際留空 = 灘線,不鋪下水
    if (aq && terrain.waterY != null) hs = hs.map((hh) => Math.max(hh, terrain.waterY + 0.05));
    const [aA, aB, aC, aD] = alphas || [1, 1, 1, 1];
    const AL = [aA, (aA + aB) / 2, aB,
                (aD + aA) / 2, (aA + aB + aC + aD) / 4, (aB + aC) / 2,
                aD, (aC + aD) / 2, aC];
    const sub = key.slice(0, key.indexOf('#'));
    const uvS = DEFS[sub].uvS || 1 / 12;
    // 中間樣態脊帶(st.band)固定壓在其他外溢之上(0.108 仍 < fade 下限 0.110)—— 它是
    // 「疊在兩側淡出上的第三種地表」;一般外溢走每 key 微升差
    const lift = alphas ? (st?.band ? SLIFT + 0.008 : SLIFT + seamLift(key)) : CLIFT;
    const b = bucketOf(bmap, key);
    G.forEach(([px, pz], k) => {
      const w = wash(px, pz);
      let a = AL[k];
      if (alphas && a > 0 && a < 1) {
        // 交界頂點 α 塑形(seamAlpha 純函式,樣式 = 逐分區組合查表):明確邊界壓窄、
        // 柔和淡出疊碎形擾動、雪線推成斑塊。端點 α=0/1 恆定 ⇒ 與不透明底毯/淡出盡頭
        // 仍水密;純函數(世界座標+seed)⇒ 相鄰外溢格共用頂點同值不開縫(§2.3 零 rnd)
        a = seamAlpha(a, qcVal(px, pz, SEAM_QC_W), st);
      }
      b.pos.push(px, hs[k] + lift, pz);
      b.nrm.push(0, 1, 0);
      b.uv.push(px * uvS, pz * uvS);
      b.col.push(w, w, w, a);
    });
    for (let v = 0; v < 2; v++) {                       // 2×2 小格,面朝 +y
      for (let u = 0; u < 2; u++) {
        const a2 = b.base + v * 3 + u, e = a2 + 1, f = a2 + 3, g2 = f + 1;
        b.idx.push(a2, f, e, e, f, g2);
      }
    }
    b.base += 9;
    return G[4];
  };
  const keys = new Array(gnx * gnz).fill(null);
  const landCells = [];                                 // [x, z, key]:底毯細節撒佈用
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const key = cellKeyAt(i, j);
      if (!key) continue;
      if (key === '!') { keys[j * gnx + i] = '!'; continue; }   // 陡坡:不鋪但記錄(供外溢補縫)
      const mid = emitCell(carpetBuckets, key, i, j, null);
      if (!mid) continue;
      keys[j * gnx + i] = key;
      landCells.push([mid[0], mid[1], key]);
    }
  }
  // 異類交界(含對角)外溢:角點隸屬度雙線性淡出 —— 配置全住 planSeamOverlays
  // (純函式,稽核執行原文;舊制單向整格外溢的鋸齒病灶見該函式檔頭),此處只發幾何。
  // 兩側對稱互溢 + 對角補角 ⇒ 交界中線 = 50/50 混色的平滑等值線,90° 階梯縫消失。
  // 交界樣式逐分區組合查表(明確/柔和/斑塊/中間過渡帶,SEAM_STYLES);中間樣態脊帶
  // 進獨立 bandBuckets(固定壓在兩側淡出之上,renderOrder 見 mesh 段)。
  for (const ov of planSeamOverlays(keys, gnx, gnz, { coarseOf: coarseOfKey, seed, variants: VARIANTS })) {
    emitCell(ov.st?.band ? bandBuckets : spillBuckets, ov.key, ov.i, ov.j, ov.alphas, ov.st);
  }

  // ---- 特徵拼圖登錄:不疊置(邊緣小比例交疊)+ 視野內同款不重複 ----
  const MAXRE = 26;                       // 最大有效半徑(SIZE 上限 × RSCALE)
  const PCELL = 64;                       // 疊置查詢空間網格(交疊半徑 ≤ ~50m)
  const pGrid = new Map();                // `${i},${j}` -> [{x,z,re}]:疊置檢查
  const keyPos = new Map();               // 'sub#variant' -> [{x,z}]:同款反重複
  // 有效半徑:rect 以等面積圓近似(半寬 × √aspect),blob 直接用 r
  const rEffOf = (def, r) => def.shape === 'rect' ? r * Math.sqrt(def.aspect || 0.7) : r;
  const overlapPs = (x, z, re, isInk) => {
    const R = (re + MAXRE) * (isInk ? INK_SEP_F : SEP_F);   // isInk 用較大搜尋半徑免漏掉全分離鄰居
    const i0 = Math.floor((x - R) / PCELL), i1 = Math.floor((x + R) / PCELL);
    const j0 = Math.floor((z - R) / PCELL), j1 = Math.floor((z + R) / PCELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const arr = pGrid.get(`${i},${j}`);
        if (!arr) continue;
        for (const p of arr) {
          const f = (isInk && p.ink) ? INK_SEP_F : SEP_F;   // 規律↔規律完全分離;其餘容邊緣小交疊
          const dx = p.x - x, dz = p.z - z, rr = (re + p.re) * f;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  };
  const usedNear = (x, z, key) => {
    const arr = keyPos.get(key);
    if (!arr) return false;
    for (const p of arr) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < VIS_R * VIS_R) return true;
    }
    return false;
  };
  const regPatch = (x, z, re, key, ink) => {
    const gk = `${Math.floor(x / PCELL)},${Math.floor(z / PCELL)}`;
    let arr = pGrid.get(gk);
    if (!arr) { arr = []; pGrid.set(gk, arr); }
    arr.push({ x, z, re, ink });   // ink = 規律結構拼圖(edge:'ink'):邊界物件避開其覆蓋範圍
    let ps = keyPos.get(key);
    if (!ps) { ps = []; keyPos.set(key, ps); }
    ps.push({ x, z });
  };
  // 自雜訊指定變體起輪替,回傳視野內未用的變體;全數用罄回 -1(改試其他地表)
  const freeVariant = (sub, x, z, v0) => {
    for (let k = 0; k < VARIANTS; k++) {
      const v = (v0 + k) % VARIANTS;
      if (!usedNear(x, z, `${sub}#${v}`)) return v;
    }
    return -1;
  };

  // ---- 單塊 patch:檢查 → 幾何 → 細節 → 家族延伸(遞迴,同族異款毗鄰)----
  const tryPatch = (x, z, sub, variant, r, rot, depth) => {
    if (placed >= target) return false;
    if (x < terrain.minX + inb || x > terrain.maxX - inb || z < terrain.minZ + inb || z > terrain.maxZ - inb) return false;
    if (isBlocked(x, z)) return false;
    if (roadClear?.(x, z)) return false;   // 道路走廊上不鋪特徵拼圖(免細節件戳穿路面);與 isBlocked 同位、首個 rnd() 前 = 確定性不變
    const zn = zoneAt(x, z);
    if (!subZones.get(sub)?.has(zn)) return false;   // 類型必須與所在圖資分區相符
    const def = DEFS[sub];
    // 坡度/水面檢查:整塊落在陸地、高差在容許內(田與球場要平)
    let mn = Infinity, mx = -Infinity;
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const h = terrain.heightAt(x + ox, z + oz);
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
    if ((mn < 0.45 && !def.aq) || mx - mn > r * def.slope) return false;   // 水生拼圖(marsh/lotus/魚塭)可貼岸線
    for (const bl of blockers) {
      const dx = x - bl.x, dz = z - bl.z, rr = bl.r + r * 0.7;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    // 拼圖不疊置:與既有特徵拼圖圓近似間距,僅容邊緣小比例交疊(fade 邊互融)
    const rEff = rEffOf(def, r);
    if (overlapPs(x, z, rEff, def.edge === 'ink' && depth === 0)) return false;   // 獨立規律結構對既有規律零互疊

    // 圖層優先(使用者定):規律(ink)疊不規律(fade)之上;規律再依所對齊道路分級抬高(大馬路>小馬路),
    // 整體仍 < 道路 0.18。rank 為決定性查詢(不吃 rnd);每分支恰一枚 rnd。ink_min .135 > fade_max .124 恆成立。
    let lift;
    if (def.edge === 'ink') {
      const rk = roadRank ? (roadRank(x, z) ?? 0) : 0;
      lift = 0.135 + rk * 0.033 + rnd() * 0.004;
    } else {
      lift = 0.110 + rnd() * 0.014;
    }
    const pt = [0.88 + rnd() * 0.24, 0.88 + rnd() * 0.24, 0.88 + rnd() * 0.24];   // 每塊色調抖動
    const b = bucketOf(buckets, `${sub}#${variant}`);
    if (def.shape === 'rect') emitRect(b, terrain, x, z, r, rot, def, lift, pt, rnd() < 0.5, rnd() < 0.5, rnd);
    else emitBlob(b, terrain, x, z, r, lift, def.uvS, def.edge, pt, rnd);
    regPatch(x, z, rEff, `${sub}#${variant}`, def.edge === 'ink');
    placed++;

    scatterDetails(sub, x, z, r, rot, def, zn);

    // 家族延伸:農田拼布 / 運動園區 / 綠地群落(rect 沿軸毗鄰、blob 邊緣淡接);
    // 每鄰塊經 freeVariant 換款 → 拼布連片但視野內無同款重複
    if (def.fam && depth < 2 && rnd() < 0.65) {
      const k = 1 + (rnd() * 2 | 0);
      for (let i = 0; i < k; i++) {
        const sub2 = rnd() < 0.7 ? sub : FAMS[def.fam][(rnd() * FAMS[def.fam].length) | 0];
        const def2 = DEFS[sub2];
        if (def2.shape !== def.shape) continue;
        let nx2, nz2, r2, rot2;
        if (def.shape === 'rect') {
          // 沿本塊局部軸擺到正鄰位(間留 1.2m 小路),同 rot → 田字拼布
          const w1 = r * 2, d1 = r * 2 * (def.aspect || 0.7), d2 = r * 2 * (def2.aspect || 0.7);
          const g2 = 1.2;
          const [ox, oz] = rnd() < 0.5
            ? [(w1 + g2) * (rnd() < 0.5 ? 1 : -1), 0]
            : [0, ((d1 + d2) / 2 + g2) * (rnd() < 0.5 ? 1 : -1)];
          const ca = Math.cos(rot), sa = Math.sin(rot);
          nx2 = x + ox * ca - oz * sa; nz2 = z + ox * sa + oz * ca; r2 = r; rot2 = rot;
        } else {
          r2 = (SIZE[sub2][0] + rnd() * SIZE[sub2][1]) * RSCALE;
          const th = rnd() * Math.PI * 2, dist = (r + r2) * 0.86;   // 邊緣小比例交疊:fade 邊互融(> SEP_F)
          nx2 = x + Math.cos(th) * dist; nz2 = z + Math.sin(th) * dist;
          rot2 = orient(nx2, nz2, def2.reg, true);   // 鄰塊各自依整齊度擲骰(rect 拼布已同 rot 延伸)
        }
        const v2 = freeVariant(sub2, nx2, nz2, variant);
        if (v2 >= 0) tryPatch(nx2, nz2, sub2, v2, r2, rot2, depth + 1);
      }
    }
    return true;
  };

  // ---- 3D 細節(表面特徵輪廓)----
  // zn = 所在分區:同物件跨地貌形式不同(雜草/花/灌木 — 綠地大面積密集、
  // 市區/裸露地零星;貨櫃/太陽能板 — 裸露地大陣列、市區零星單件)
  function scatterDetails(sub, x, z, r, rot, def, zn) {
    const w = r * 2, dp = r * 2 * (def.aspect || 0.7);
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const atLocal = (lx, lz) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
    // 數量隨 patch 面積縮放(大 patch 不再顯得稀疏)+ 每次呼叫再抖 ±40%;
    // 散佈型態每 patch×型別隨機:cluster 群聚(1~3 簇)/ ring 沿緣 / uniform 均勻
    const kMul = Math.min(3, Math.max(0.7, (r / ((SIZE[sub]?.[0] || 9) * RSCALE)) ** 1.6));
    const scatter = (type, k, s0, sv, tintPick = null) => {
      k = Math.max(1, Math.round(k * kMul * (0.55 + rnd() * 1.1)));   // 數量抖動 ±55%
      const mode = rnd();
      let centers = null, arc0 = 0, arcSpan = Math.PI * 2;
      if (mode < 0.3) {
        centers = [];
        const nC = 1 + (rnd() * 3 | 0);
        for (let c = 0; c < nC; c++) centers.push([(rnd() - 0.5) * r * 1.1, (rnd() - 0.5) * r * 1.1]);
      } else if (mode < 0.45) {                        // ring 改隨機弧段:C 形/半圈,不再恆整圈
        arc0 = rnd() * Math.PI * 2; arcSpan = Math.PI * (0.5 + rnd() * 1.5);
      }
      for (let i = 0; i < k; i++) {
        let px, pz;
        if (centers) {                                 // cluster:簇心 + 高斯狀聚攏
          const [ox, oz] = centers[(rnd() * centers.length) | 0];
          const rr = r * 0.3 * rnd(), th = rnd() * Math.PI * 2;
          px = x + ox + Math.cos(th) * rr; pz = z + oz + Math.sin(th) * rr;
        } else if (mode < 0.45) {                      // ring:沿 patch 邊緣的隨機弧段
          const rr = r * (0.55 + rnd() * 0.35), th = arc0 + rnd() * arcSpan;
          px = x + Math.cos(th) * rr; pz = z + Math.sin(th) * rr;
        } else {                                       // uniform:面積均勻
          const rr = r * 0.75 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
          px = x + Math.cos(th) * rr; pz = z + Math.sin(th) * rr;
        }
        const tint = tintPick ? tintPick[(rnd() * tintPick.length) | 0] : null;
        const [jpx, jpz] = qcNudge(px, pz);           // 準晶體 blue-noise 位移:去叢聚/去重複,純函數不動 rnd 序列
        addDetail(type, jpx, jpz, s0 + rnd() * sv, tint);
      }
    };
    // 對齊列陣:沿 patch 局部軸整齊排列;ry=-rot 使 3D 件與貼圖行列同向
    // (atLocal 的平面旋轉正向 = three.js rotation.y 的負向);格位/朝向微抖不豆腐格
    const rows = (type, stepX, stepZ, mX, mZ, cap, skip, tintPick = null, s0 = 1, sv = 0) => {
      let k = 0;
      const jx = stepX * 0.18, jz = stepZ * 0.18;
      // 列陣隨機起點相位:同款場地的排列位置塊塊互異
      const px0 = (rnd() - 0.5) * stepX * 0.6, pz0 = (rnd() - 0.5) * stepZ * 0.6;
      for (let lz = -dp * mZ + pz0; lz <= dp * mZ && k < cap; lz += stepZ) {
        for (let lx = -w * mX + px0; lx <= w * mX && k < cap; lx += stepX) {
          if (rnd() < skip) continue;
          const [px, pz] = atLocal(lx + (rnd() - 0.5) * jx, lz + (rnd() - 0.5) * jz);
          const tint = tintPick ? tintPick[(rnd() * tintPick.length) | 0] : null;
          addDetail(type, px, pz, s0 + rnd() * sv, tint, 1, -rot + (rnd() - 0.5) * 0.1);
          k++;
        }
      }
    };
    if (sub === 'turf' || sub === 'lawn') {
      scatter('tuft', 3 + (rnd() * 4 | 0), 0.7, 0.6);
      // 雜草/花:綠地大面積密集,市區草坪只零星幾叢
      scatter('weed', zn === 'green' ? 7 + (rnd() * 5 | 0) : 2, 0.7, 0.5);
      if (zn === 'green' || rnd() < 0.4) scatter('flower', zn === 'green' ? 5 : 2, 0.7, 0.4, FLOWER_C);
    }
    else if (sub === 'meadow') { scatter('miscanthus', 9 + (rnd() * 7 | 0), 0.9, 0.7); scatter('tuft', 4, 1.0, 0.7); scatter('weed', 4, 0.7, 0.5); }
    else if (sub === 'bushfield') { scatter('bush', 5 + (rnd() * 4 | 0), 0.8, 0.9); scatter('tuft', 3, 0.7, 0.5); scatter('weed', 3, 0.7, 0.4); }
    else if (sub === 'flowerfield') { scatter('flower', 12 + (rnd() * 8 | 0), 0.8, 0.6, FLOWER_C); scatter('tuft', 4, 0.6, 0.4); scatter('weed', 3, 0.6, 0.4); }
    else if (sub === 'orchard') {
      let k = 0;                                  // 果樹成行成列(局部軸網格 + 微抖)
      for (let lz = -r * 0.7; lz <= r * 0.7 && k < 14; lz += 5) {
        for (let lx = -r * 0.7; lx <= r * 0.7 && k < 14; lx += 5) {
          if (rnd() < 0.2) continue;
          const [px, pz] = atLocal(lx + (rnd() - 0.5) * 1.4, lz + (rnd() - 0.5) * 1.4);
          addDetail('sapling', px, pz, 0.9 + rnd() * 0.5);
          k++;
        }
      }
    } else if (sub === 'teafield') scatter('tuft', 2, 0.5, 0.3);
    else if (sub === 'veggiefield') { rows('cabbage', 1.7, 2.4, 0.4, 0.34, 36, 0.15, null, 0.8, 0.5); if (rnd() < 0.5) scatter('fencepost', 3 + (rnd() * 3 | 0), 0.9, 0.3); }
    else if (sub === 'paddy') {
      let k = 0;                                  // 秧苗列:沿田塊軸向整齊插秧
      for (let lz = -dp * 0.32; lz <= dp * 0.32 && k < 34; lz += 2.6) {
        for (let lx = -w * 0.38; lx <= w * 0.38 && k < 34; lx += 2.8) {
          if (rnd() < 0.15) continue;
          const [px, pz] = atLocal(lx, lz);
          addDetail('rice', px, pz, 0.8 + rnd() * 0.4);
          k++;
        }
      }
    } else if (sub === 'dryfield') {
      if (rnd() < 0.6) scatter('hay', 1 + (rnd() < 0.3 ? 1 : 0), 0.8, 0.5);
      scatter('pebble', 2, 0.5, 0.5);
    } else if (sub === 'gravel') {
      scatter('pebble', 6 + (rnd() * 6 | 0), 0.5, 0.9);
      // 落石堆:大岩塊 + 岩板聚成一簇(自邊坡崩落的散置感)
      if (rnd() < 0.3) { scatter('boulder', 2 + (rnd() * 3 | 0), 0.8, 0.7); scatter('rockflat', 2, 0.7, 0.5); }
      scatter('weed', 2, 0.6, 0.4);
    }
    else if (sub === 'wild') {
      scatter('pebble', 3, 0.5, 0.8); scatter('tuft', 3, 0.6, 0.4); scatter('drybush', 2, 0.7, 0.5);
      if (rnd() < 0.35) scatter('boulder', 1, 0.7, 0.5);
      if (rnd() < 0.25) { scatter('boulder', 2 + (rnd() * 2 | 0), 0.8, 0.6); scatter('rockflat', 2, 0.6, 0.5); }   // 落石堆
      scatter('weed', 2 + (rnd() * 2 | 0), 0.7, 0.4); scatter('miscanthus', 2, 0.8, 0.5);   // 裸露地飄逸雜草(零星)
      if (rnd() < 0.15) scatter('flower', 1, 0.6, 0.3, FLOWER_C);   // 荒地零星野花
    }
    else if (sub === 'sand') scatter('pebble', 3, 0.7, 1.1);
    else if (sub === 'mud' || sub === 'crackedearth') { scatter('pebble', 2, 0.5, 0.4); scatter('weed', 2, 0.6, 0.3); if (sub === 'crackedearth') scatter('drybush', 1, 0.6, 0.4); }
    else if (sub === 'redsoil') { scatter('pebble', 2, 0.5, 0.4); scatter('tuft', 1, 0.5, 0.3); scatter('weed', 1, 0.6, 0.3); }
    else if (sub === 'marsh') scatter('reed', 8 + (rnd() * 6 | 0), 0.8, 0.6);
    else if (sub === 'lotus') { scatter('lotuspad', 12 + (rnd() * 8 | 0), 0.8, 0.8); scatter('reed', 4, 0.7, 0.5); }
    else if (sub === 'watertile') { if (rnd() < 0.35) scatter('reed', 2 + (rnd() * 3 | 0), 0.8, 0.5); }   // 淺水零星蘆葦(deepwater 全空)
    // — 綠地擴充 —
    else if (sub === 'arrowbamboo') { scatter('bamboo', 9 + (rnd() * 6 | 0), 0.8, 0.6); scatter('tuft', 3, 0.6, 0.4); }
    else if (sub === 'deadwood') { scatter('snag', 5 + (rnd() * 4 | 0), 0.8, 0.7); scatter('log', 2, 0.7, 0.4); scatter('pebble', 2, 0.5, 0.4); }
    else if (sub === 'fallenlogs') { scatter('log', 7 + (rnd() * 5 | 0), 0.8, 0.7); scatter('stump', 2, 0.8, 0.4); scatter('tuft', 3, 0.6, 0.4); }
    else if (sub === 'clearcut') { scatter('stump', 8 + (rnd() * 6 | 0), 0.8, 0.5); scatter('log', 2, 0.7, 0.4); }
    else if (sub === 'lumberyard') { rows('logpile', 4.2, 3.4, 0.3, 0.28, 7, 0.2, null, 0.9, 0.4); scatter('plank', 2 + (rnd() * 3 | 0), 0.8, 0.4); scatter('crate', 1, 0.9, 0.3); }
    else if (sub === 'rottencabin') { addDetail('cabin', x, z, 0.85 + rnd() * 0.35); scatter('fencepost', 5 + (rnd() * 3 | 0), 0.9, 0.3); scatter('bush', 3, 0.6, 0.5); }
    else if (sub === 'vineyard') rows('vinerow', 3.4, 3.0, 0.36, 0.32, 16, 0.12, null, 0.9, 0.3);
    else if (sub === 'greenhouse') rows('ghouse', 3.8, 3.2, 0.3, 0.3, 10, 0.08, null, 1.1, 0.4);
    // — 裸露地/高地擴充 —
    else if (sub === 'deadforest') { scatter('charsnag', 6 + (rnd() * 5 | 0), 0.8, 0.8); scatter('pebble', 2, 0.4, 0.4); }
    else if (sub === 'slabruin') { scatter('slab', 7 + (rnd() * 5 | 0), 0.8, 0.6); scatter('pebble', 4, 0.5, 0.6); scatter('boulder', 1, 0.6, 0.4); }
    else if (sub === 'steppe') { scatter('miscanthus', 6 + (rnd() * 4 | 0), 0.9, 0.7); scatter('tuft', 4, 0.9, 0.6); scatter('drybush', 3, 0.7, 0.5); scatter('weed', 3, 0.7, 0.4); scatter('pebble', 1, 0.5, 0.4); }
    else if (sub === 'abandonedfarm') { scatter('tuft', 4, 0.7, 0.5); scatter('drybush', 2, 0.7, 0.4); scatter('fencepost', 3, 0.9, 0.3); if (rnd() < 0.4) scatter('hay', 1, 0.7, 0.3); }
    else if (sub === 'saltpan') scatter('saltmound', 4 + (rnd() * 3 | 0), 0.7, 0.5);
    else if (sub === 'quarry') { scatter('rockflat', 4, 0.9, 0.8); scatter('spoil', 1 + (rnd() * 2 | 0), 0.8, 0.6); scatter('boulder', 1 + (rnd() * 2 | 0), 0.7, 0.5); }
    else if (sub === 'plateau') { scatter('rockflat', 3 + (rnd() * 3 | 0), 0.8, 0.7); scatter('boulder', 1, 0.7, 0.5); scatter('tuft', 3, 0.6, 0.4); }
    else if (sub === 'icefield') { scatter('iceshard', 6 + (rnd() * 5 | 0), 0.7, 0.8); scatter('pebble', 1, 0.4, 0.4); }
    else if (sub === 'scree') { scatter('pebble', 9 + (rnd() * 7 | 0), 0.5, 0.9); scatter('rockflat', 3, 0.7, 0.6); scatter('boulder', 1, 0.6, 0.5); }
    // — 市區擴充 —
    else if (sub === 'construction') { scatter('pipe', 1 + (rnd() * 2 | 0), 0.9, 0.4); scatter('spoil', 1 + (rnd() * 2 | 0), 0.8, 0.5); scatter('barrier', 3, 0.9, 0.3); scatter('plank', 1, 0.8, 0.3); scatter('drum', 2, 0.9, 0.2, DRUM_C); scatter('crate', 1, 0.9, 0.3); }
    else if (sub === 'gasstation') {
      addDetail('canopy', x, z, 1 + rnd() * 0.2, null, 1, -rot);   // 中柱雨棚 + 兩座加油機
      for (const lx of [-1.4, 1.4]) {
        const [px, pz] = atLocal(lx, 0);
        addDetail('pump', px, pz, 1, PUMP_C[(rnd() * PUMP_C.length) | 0], 1, -rot);
      }
      scatter('drum', 2, 0.9, 0.2, DRUM_C);
    }
    else if (sub === 'park') { scatter('sapling', 4 + (rnd() * 3 | 0), 0.9, 0.5); scatter('bench', 1 + (rnd() * 2 | 0), 0.9, 0.2); scatter('flower', 8, 0.7, 0.5, FLOWER_C); scatter('tuft', 3, 0.6, 0.4); if (rnd() < 0.5) scatter('planter', 1 + (rnd() * 2 | 0), 0.9, 0.2); }
    else if (sub === 'plaza') { scatter('bench', 2 + (rnd() * 2 | 0), 0.9, 0.2); scatter('planter', 2 + (rnd() * 2 | 0), 0.9, 0.2); if (rnd() < 0.4) scatter('billboard', 1, 0.9, 0.15, AD_C); }
    else if (sub === 'concrete' || sub === 'pavement' || sub === 'brick') {   // 市區空地:偶發街道家具,不再一片全空
      if (rnd() < 0.4) scatter('bench', 1, 0.9, 0.2);
      if (rnd() < 0.3) scatter('drum', 1, 0.9, 0.2, DRUM_C);
      if (rnd() < 0.3) scatter('crate', 1, 0.9, 0.3);
      // 市區綠意/招牌:盆栽/灌木/零星樹/廣告看板(全零星,不成片)
      if (rnd() < 0.35) scatter('planter', 1 + (rnd() * 2 | 0), 0.9, 0.2);
      if (rnd() < 0.3) scatter('bush', 1 + (rnd() * 2 | 0), 0.7, 0.4);
      if (rnd() < 0.25) scatter('sapling', 1, 0.9, 0.3);
      if (rnd() < 0.22) scatter('billboard', 1, 0.9, 0.15, AD_C);
      if (rnd() < 0.3) scatter('flower', 2, 0.7, 0.3, FLOWER_C);
      if (rnd() < 0.3) scatter('weed', 2, 0.6, 0.3);   // 縫隙雜草(市區零星)
      // 貨櫃/太陽能板:市區零星單件(裸露地才是大面積陣列)
      if (rnd() < 0.15) scatter('container', 1, 0.9, 0.2, CONTAINER_C);
      if (rnd() < 0.12) scatter('solarpanel', 1, 0.9, 0.2);
    }
    else if (sub === 'court') {   // 球場附件:兩端籃球架(沿場地軸向、面朝場心)+ 場邊長凳
      for (const e of [-1, 1]) {
        const [px, pz] = atLocal(0, dp * 0.42 * e);
        addDetail('hoop', px, pz, 1, null, 1, -rot + (e > 0 ? Math.PI : 0));
      }
      if (rnd() < 0.6) scatter('bench', 1 + (rnd() * 2 | 0), 0.9, 0.2);
    }
    else if (sub === 'scrapyard') { scatter('carwreck', 4 + (rnd() * 3 | 0), 0.9, 0.4, CAR_C); scatter('drum', 2, 0.9, 0.2, DRUM_C); scatter('crate', 1, 0.9, 0.3); scatter('pipe', 1, 0.7, 0.3); scatter('pebble', 2, 0.5, 0.4); scatter('weed', 3, 0.6, 0.4); }
    // 貨櫃/太陽能板陣列:裸露地大面積密排,市區(僅家族延伸殘留)小陣列
    else if (sub === 'containeryard') { rows('container', 4.0, 2.6, 0.4, 0.36, zn === 'bare' ? 26 : 12, zn === 'bare' ? 0.15 : 0.25, CONTAINER_C, 0.9, 0.3); scatter('crate', 2, 0.9, 0.3); }
    else if (sub === 'cemetery') { rows('headstone', 2.2, 2.6, 0.36, 0.3, 24, 0.25, null, 0.9, 0.3); scatter('sapling', 1, 0.9, 0.3); }
    else if (sub === 'solarfarm') rows('solarpanel', 3.0, 2.8, 0.4, 0.36, zn === 'bare' ? 32 : 18, 0.08, null, 0.9, 0.2);
    // — 濕地擴充 —
    else if (sub === 'fishpond') scatter('reed', 6, 0.7, 0.4);
  }

  // ==== 沿街連續規律陣列(2026-07-25 使用者需求「規律拼貼順著道路整齊排列」)====
  // 規律結構型(ink rect、reg≥ARR_MINREG:停車場/球場/太陽能板/稻田/農田…)沿道路兩側(法線偏移讓開
  // 路面)鋪成連續等尺寸格陣,朝向鎖道路角、同陣列共 rot ⇒ 無接歪。決定性:錨點沿 roadPolys(geocache
  // 定案、跨客戶端同序)以固定步距推進;變體走決定性輪替。tryPatch depth=2 ⇒ 無家族延伸、overlapPs 走
  // SEP_F(陣列 tile 相接不重疊,獨立結構才對它們全分離)。無道路圖資 → 不鋪(規律型退回主迴圈隨機散佈)。
  const ARR_MINREG = 0.7;
  const arrayable = new Set(Object.keys(DEFS).filter(
    (s) => DEFS[s].edge === 'ink' && DEFS[s].shape === 'rect' && (DEFS[s].reg || 0) >= ARR_MINREG));
  const arrPools = {};
  for (const zn in zoneLists) arrPools[zn] = zoneLists[zn].filter((s) => arrayable.has(s));
  const layRegularArrays = () => {
    if (!roadPolys?.length) return;
    const ARR_MARGIN = 3, ARR_GAP = 1.6, ARR_DEPTH = 2, ARR_MINSTEP = 28, ARR_FREQ = 0.004;
    const arrCap = Math.round(target * 0.55);            // 陣列最多吃 55% 配額,其餘留主迴圈填不規律
    const dropAt = (px, pz, a, hw, station) => {
      const zn = zoneAt(px, pz);
      const pool = arrPools[zn];
      if (!pool || !pool.length) return ARR_MINSTEP;     // 水域/高地/無候選 → 空推進
      const t = Math.min(0.999, Math.max(0, (vnoise(px * ARR_FREQ, pz * ARR_FREQ, seed ^ 0x1A77) - 0.5) * 2 + 0.5));
      const sub = pool[(t * pool.length) | 0], def = DEFS[sub];
      const r = SIZE[sub][0] * RSCALE;                   // 固定半徑(不抖):同陣列等尺寸才對齊
      const d = 2 * r * (def.aspect || 0.7);
      const stepA = 2 * r + ARR_GAP, stepP = d + ARR_GAP, off0 = hw + ARR_MARGIN + d / 2;
      const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, nz = ca;   // 道路法線
      for (let side = -1; side <= 1; side += 2) {
        for (let c = 0; c < ARR_DEPTH; c++) {
          if (placed >= arrCap) return stepA;
          const off = off0 + c * stepP;
          const tx = px + nx * side * off, tz = pz + nz * side * off;
          const variant = (station * 2 + c * 3 + (side > 0 ? 1 : 0)) % VARIANTS;   // 決定性變體輪替(同陣列不死板同款)
          if (tryPatch(tx, tz, sub, variant, r, a, 2)) arraysN++;   // depth=2:鎖路向、無家族延伸、overlapPs 走 SEP_F
        }
      }
      return stepA;
    };
    for (const [pts, hw] of roadPolys) {
      if (placed >= arrCap) break;
      let carry = 0, station = 0;
      for (let si = 1; si < pts.length; si++) {
        const x0 = pts[si - 1][0], z0 = pts[si - 1][1];
        const dx = pts[si][0] - x0, dz = pts[si][1] - z0, segLen = Math.hypot(dx, dz);
        if (segLen < 1e-3) continue;
        const ux = dx / segLen, uz = dz / segLen, a = Math.atan2(dz, dx);
        let dcur = carry;
        while (dcur < segLen) {
          if (placed >= arrCap) return;
          dcur += dropAt(x0 + ux * dcur, z0 + uz * dcur, a, hw, station++);
        }
        carry = dcur - segLen;                           // 跨段連續推進(街廓不因節點斷開)
      }
    }
  };
  layRegularArrays();

  // ---- 不規律主散佈:準晶體點陣候選 + tryPatch(近路規律型讓給沿街陣列)----
  // 候選由均勻 rnd 改「準晶體全循環走訪」(去格化 blue-noise、非週期不重複);保留完整 zone 清單內層重試,
  // 分區仍走純圖資分類(球場只落市區、水田只落綠地…)。qStride⊥nCells ⇒ 走訪為雙射(每格恰訪一次)。
  const qcArea = terrain.worldW * terrain.worldH;
  const qs = Math.max(18, Math.min(40, Math.sqrt(qcArea / Math.max(1, target * 4))));
  const QC_PT_W = (2 * Math.PI) / (qs * 1.7);
  const qcPoint = (cx, cz) => { const [gx, gz] = qcGrad(cx, cz, QC_PT_W); return [cx + gx * qs * 0.42, cz + gz * qs * 0.42]; };
  const nqx = Math.ceil(terrain.worldW / qs), nqz = Math.ceil(terrain.worldH / qs);
  const nCells = nqx * nqz;
  const gcd = (m, n) => { while (n) { const t = m % n; m = n; n = t; } return m; };
  let qStride = Math.max(1, Math.round(nCells * 0.61803));   // 黃金步幅、與 nCells 互質 ⇒ 全循環雙射走訪
  while (gcd(qStride, nCells) !== 1) qStride++;
  const qOff = (seed >>> 0) % Math.max(1, nCells);
  for (let a = 0; a < nCells && placed < target; a++) {
    const idx = (qOff + a * qStride) % nCells;
    const gi = idx % nqx, gj = (idx / nqx) | 0;
    const cx = terrain.minX + (gi + 0.5) * qs, cz = terrain.minZ + (gj + 0.5) * qs;
    const [qx, qz] = qcPoint(cx, cz);
    const x = qx + (rnd() - 0.5) * qs * 0.2;              // 固定 2 枚 rnd(破殘餘對稱;淘汰前抽 = 序列穩定)
    const z = qz + (rnd() - 0.5) * qs * 0.2;
    const zones = zoneLists[zoneAt(x, z)];
    if (!zones) continue;
    const t = Math.min(0.999, Math.max(0, (vnoise(x * 0.006, z * 0.006, seed) - 0.5) * 2.2 + 0.5));
    const zi = (t * zones.length) | 0;
    const v0 = Math.min(VARIANTS - 1, (vnoise(x * 0.0025, z * 0.0025, seed ^ 0x7E11) * VARIANTS) | 0);
    for (let s = 0; s < zones.length; s++) {
      const sub = zones[(zi + s) % zones.length];
      if (roadPolys?.length && arrayable.has(sub) && roadDirAt?.(x, z) != null) continue;   // 近路規律型 → 已交陣列
      const v = freeVariant(sub, x, z, v0);
      if (v < 0) continue;
      const r = (SIZE[sub][0] + rnd() * SIZE[sub][1]) * RSCALE;
      if (tryPatch(x, z, sub, v, r, orient(x, z, DEFS[sub].reg, true), 0)) break;
    }
  }

  // ---- 底毯細節:剩餘配額撒進大片空地(準晶體疏密,不留隨機禿斑;仍避開兵線走廊/建物)----
  detCap = MAX_DETAIL;
  const remain = MAX_DETAIL - detCount;
  if (remain > 60 && landCells.length) {
    const pDet = Math.min(0.3, remain / (landCells.length * 5));
    const CAR_QC_W = (2 * Math.PI) / (cell * 3);
    for (const [cx2, cz2, key] of landCells) {
      if (detCount >= MAX_DETAIL) break;
      const q = 0.5 + 0.5 * qcVal(cx2, cz2, CAR_QC_W);     // [0,1] 準晶體疏密調變(峰密谷疏,去隨機禿斑)
      if (rnd() >= pDet * (0.35 + 1.3 * q)) continue;       // 先抽 1 枚;E[0.35+1.3q]=1 ⇒ 總量不變
      const sub = key.slice(0, key.indexOf('#'));
      scatterDetails(sub, cx2, cz2, cell * 0.55, rnd() * Math.PI * 2, DEFS[sub], zoneAt(cx2, cz2));
    }
  }

  // ---- 底毯 Mesh(不透明,墊在最底)+ 外溢 Mesh(透明淡出)+ 中間樣態脊帶 Mesh
  //      (透明,壓在外溢之上),皆先於特徵/特效繪製 ----
  for (const [bmap, pass] of [[carpetBuckets, 0], [spillBuckets, 1], [bandBuckets, 2]]) {
    for (const [key, b] of bmap) {
      if (!b.idx.length) continue;
      const [sub, v] = key.split('#');
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
      geo.setIndex(b.idx);
      const tint = DEFS[sub].green ? (SEASON_TINT[season] ?? 0xffffff) : 0xffffff;
      const m = new THREE.Mesh(geo, envMat(tint, {
        map: groundTex(sub, +v, false),
        vertexColors: true, wash: 0.5, cool: 0.5, rim: 0,   // 貼地面關 rim:掠射角全開會把遠處洗白
        transparent: pass > 0,   // 外溢/脊帶靠頂點 alpha 淡出;depthWrite 保持 true
      }));
      // 外溢在透明佇列裡必須早於特徵 patch / 特效(renderOrder 0)繪製,
      // 否則 depthWrite 會把後畫的底層擋掉出現描圈破洞。
      // 同佇列內再依 seamLift 同一雜湊排序(低者先畫)⇒ 異 key 外溢互疊時
      // 高者後蓋、深度不互吃,混色連續且決定性(範圍 [-2, -1.3] 仍恆 < 0);
      // 中間樣態脊帶 -1.2:恆在全部外溢之後、特徵層之前(與 lift 0.108 同序)
      if (pass === 1) m.renderOrder = -2 + seamLift(key) * 100;
      else if (pass === 2) m.renderOrder = -1.2;
      m.frustumCulled = false;
      m.userData.noOutline = true;
      group.add(m);
    }
  }

  // ==== 邊界遮蔽物(2026-07-24 使用者需求)====
  // 不同地貌/拼圖區塊交界(= 底毯 cell 的抖動角點邊,即可見拼接縫)擺長條人造/自然物,
  // 遮住拼接的不連續感:樹籬(hedge)/矮牆(stonewall)/圍籬(fence)/堤防(dike),依交界兩側
  // coarse 分區選型。與地被同契約:純視覺、無碰撞、不描邊、不進 raycast(空地照常通行);
  // 合併成單一 Mesh(每型 1 draw call)且與底毯/特徵拼圖同樣進 coverMeshes → 洞口一併打洞。
  // 決定性只吃 seed + 格索引雜湊(不動用共享 rnd 序列、不用 Math.random)⇒ §2.3 佈局不變、跨客戶端一致。
  {
    const subOf = (key) => key.slice(0, key.indexOf('#'));
    // 與交界樣式(planSeamOverlays 的 coarseOf)共用同一份 subCoarse 表(單一縫)
    const coarseOf = (key) => (key && key !== '!') ? coarseOfKey(key) : null;
    const ehash = (a, b, c) => {
      let n = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519) ^ seed) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const snB = ENV.seasons[season] || ENV.seasons.summer;
    // w 底寬 / wt 頂寬(梯形收頂)/ h 高 / jit 頂高抖動比(樹籬蓬亂)/ color
    const KINDS = {
      hedge:     { w: 1.15, wt: 0.72, h: 1.5,  jit: 0.55, color: snB.foliage },
      fence:     { w: 0.16, wt: 0.16, h: 1.25, jit: 0.0,  color: 0x6b5138 },
      stonewall: { w: 0.55, wt: 0.42, h: 1.0,  jit: 0.14, color: 0x8f8c83 },
      dike:      { w: 2.4,  wt: 1.1,  h: 0.85, jit: 0.1,  color: 0x6e5c3f },
    };
    const PROB = { hedge: 0.42, fence: 0.32, stonewall: 0.3, dike: 0.55 };
    const pickKind = (za, zb, h) => {
      if (!za || !zb || za === 'water' || zb === 'water') return null;   // 水邊交給 buildWaterEdges 泡沫/潮間帶
      const has = (z) => za === z || zb === z;
      if (has('wet')) return 'dike';                          // 濕地↔旱地 → 堤防
      if (has('alpine')) return h < 0.45 ? 'stonewall' : null; // 高地岩坡少量石牆(其餘不擺,岩地無田界)
      if (has('urban')) return h < 0.6 ? 'stonewall' : 'fence'; // 市區界 → 矮牆/圍籬
      if (has('bare')) return h < 0.55 ? 'stonewall' : 'hedge'; // 荒地↔綠地 → 矮牆/樹籬
      return h < 0.6 ? 'hedge' : 'fence';                      // 綠地↔綠地(含農田拼布不同款)→ 田界樹籬/圍籬
    };
    const bB = {};
    for (const k in KINDS) bB[k] = { pos: [], nrm: [], idx: [], base: 0 };
    const wy = terrain.waterY;
    const okPt = (x, z) => !isBlocked(x, z) && !(roadClear && roadClear(x, z))
      && terrain.heightAt(x, z) > (wy != null ? wy + 0.15 : 0.45);
    // 規律結構拼圖(edge:'ink' 球場/停車場/農田/廣場…)覆蓋範圍:邊界物件一律避開,不切穿整齊區塊
    // (使用者回報「球場/停車場上放邊界拼圖很亂」)。查特徵拼圖登錄 pGrid 的 ink 標記。
    const onRegular = (x, z) => {
      const R = MAXRE * SEP_F;
      const i0 = Math.floor((x - R) / PCELL), i1 = Math.floor((x + R) / PCELL);
      const j0 = Math.floor((z - R) / PCELL), j1 = Math.floor((z + R) / PCELL);
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const arr = pGrid.get(`${ii},${jj}`);
        if (!arr) continue;
        for (const p of arr) if (p.ink && (p.x - x) ** 2 + (p.z - z) ** 2 < p.re * p.re) return true;
      }
      return false;
    };
    const emitRidge = (b, A, Bp, kd, ei, ej, ed) => {
      const dx = Bp[0] - A[0], dz = Bp[1] - A[1], len = Math.hypot(dx, dz) || 1;
      const pxv = -dz / len, pzv = dx / len;                   // 單位法向(垂直於邊)
      const spans = Math.max(1, Math.round(len / 5));
      const w2 = kd.w / 2, wt2 = kd.wt / 2;
      const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
      const NL = nrm([-pxv, 0.25, -pzv]), NR = nrm([pxv, 0.25, pzv]);       // 側面外法線(略朝上,倒角)
      const NLt = nrm([-pxv * 0.4, 1, -pzv * 0.4]), NRt = nrm([pxv * 0.4, 1, pzv * 0.4]);
      const first = b.base;
      let prev = null;
      for (let s = 0; s <= spans; s++) {
        const t = s / spans, cx = A[0] + dx * t, cz = A[1] + dz * t;
        const gy = terrain.heightAt(cx, cz) - 0.12;           // 底埋入地表,無縫接地
        const topY = gy + kd.h * (1 + (ehash(ei * 131 + s, ej * 197, ed) - 0.5) * kd.jit);
        const idx0 = b.base;
        const push = (px, py, pz, n) => { b.pos.push(px, py, pz); b.nrm.push(n[0], n[1], n[2]); };
        push(cx - pxv * w2, gy, cz - pzv * w2, NL);           // 0 Lb
        push(cx + pxv * w2, gy, cz + pzv * w2, NR);           // 1 Rb
        push(cx - pxv * wt2, topY, cz - pzv * wt2, NLt);      // 2 Lt
        push(cx + pxv * wt2, topY, cz + pzv * wt2, NRt);      // 3 Rt
        b.base += 4;
        if (prev != null) {
          const a0 = prev, c0 = idx0;
          b.idx.push(a0, a0 + 2, c0, c0, a0 + 2, c0 + 2);           // 左側面
          b.idx.push(a0 + 1, c0 + 1, a0 + 3, a0 + 3, c0 + 1, c0 + 3); // 右側面
          b.idx.push(a0 + 2, a0 + 3, c0 + 2, c0 + 2, a0 + 3, c0 + 3); // 頂面
        }
        prev = idx0;
      }
      b.idx.push(first, first + 1, first + 3, first, first + 3, first + 2);   // 端面封口(DoubleSide,繞向不拘)
      b.idx.push(prev, prev + 3, prev + 1, prev, prev + 2, prev + 3);
    };
    const consider = (k0, k1, A, Bp, i, j, ed) => {
      if (!k1 || k1 === '!' || subOf(k1) === subOf(k0)) return;   // 同款 = 無縫;'!'/空 = 崖/未鋪,交由外溢淡出
      const za = coarseOf(k0), zb = coarseOf(k1);
      // 使用者定案:邊界物件「只在不同類型地貌交會的邊界」擺 —— 同地貌內的換款(含農田/球場/停車場等
      // 規律區塊)一律不擺,避免整齊區塊被切亂。跨地貌交界(za≠zb)才是要遮的拼接不連續。
      if (za === zb) return;
      const kind = pickKind(za, zb, ehash(i, j, ed === 1 ? 11 : 37));
      if (!kind || ehash(i, j, ed === 1 ? 23 : 41) >= PROB[kind]) return;
      // 沿線密取樣(每 ~3m):任一點落在道路走廊 / 建物 / 水面 / 規律結構拼圖上 → 整段不擺。
      // 道路為最高優先(ROAD_LIFT 0.45)不可被 3D 邊界物遮住(「道路沒出現」修正);規律區塊保持完整。
      const dx = Bp[0] - A[0], dz = Bp[1] - A[1];
      const steps = Math.max(2, Math.ceil((Math.hypot(dx, dz) || 1) / 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, px = A[0] + dx * t, pz = A[1] + dz * t;
        if (!okPt(px, pz) || onRegular(px, pz)) return;
      }
      emitRidge(bB[kind], A, Bp, KINDS[kind], i, j, ed);
    };
    for (let j = 0; j < gnz; j++) {
      for (let i = 0; i < gnx; i++) {
        const k0 = keys[j * gnx + i];
        if (!k0 || k0 === '!') continue;
        if (i + 1 < gnx) consider(k0, keys[j * gnx + i + 1], cornerAt(i + 1, j), cornerAt(i + 1, j + 1), i, j, 1);
        if (j + 1 < gnz) consider(k0, keys[(j + 1) * gnx + i], cornerAt(i, j + 1), cornerAt(i + 1, j + 1), i, j, 2);
      }
    }
    for (const kind in bB) {
      const b = bB[kind];
      if (!b.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setIndex(b.idx);
      const m = new THREE.Mesh(geo, envMat(KINDS[kind].color, { wash: 0.4, cool: 0.45, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      m.userData.noOutline = true;
      group.add(m);
    }
  }

  // ---- 特徵色塊 Mesh(每「地表×變體」一個 draw call)----
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
      vertexColors: true, wash: 0.5, cool: 0.5, rim: 0,   // 貼地面關 rim(同底毯)
      transparent: def.edge === 'fade',   // 淡出邊融入地形;depthWrite 保持 true(貼花式)
    }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    // 特徵拼圖識別標記:冒煙測試核對不疊置/反重複/分區相符用
    m.userData.gsub = sub; m.userData.gvar = +v; m.userData.gshape = def.shape;
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
      // 材質塗層與 2D 地表同語彙:低頻水彩 wash + 冷藍陰影(envMat),
      // 人造附件再疊程序貼圖(貨櫃浪板/太陽能電池格/看板畫面/木箱板紋)
      const mat = envMat(partColor(part.c), {
        map: part.tex ? detailTex(part.tex) : null, wash: 0.35, cool: 0.4,
      });
      const m = new THREE.InstancedMesh(part.geo, mat, items.length);
      items.forEach((it, i) => {
        E.set(it.tx || 0, it.ry, it.tz || 0);   // 隨機傾角(TILT 表)+ 隨機朝向
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
  return { patches: placed, details: detCount, cells: landCells.length, aligned, arrays: arraysN };
}
