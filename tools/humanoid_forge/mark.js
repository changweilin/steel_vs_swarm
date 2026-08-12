// ============ 彩繪圖樣:塗鴉 / 圖騰 / 烙印(dev-only;程序 Canvas2D)============
// 使用者第五輪的三件事:「塗鴉 / 圖騰設計 / 烙印」。三者的差別不是畫得像不像,而是**語域**:
//   塗鴉 graffiti —— 手噴的、歪的、有滴流;蓋在裝甲上宣示所有權。
//   圖騰 totem    —— 徑向對稱的部族紋樣;它的「設計」就是對稱階數與環帶構成。
//   烙印 brand    —— 壓上去的印記:環 + 缺口 + 短字,邊緣焦黑、內圈熾亮。
//
// 兩條紀律:
//   ① **零 Math.random**(§2.3):圖樣一律由 `seed` 決定(rng.js 唯一縫)。現抽亂數的話
//      重開頁面同一張貼花就換一張圖,而覆寫層裡什麼都沒變 —— 那是「存了等於沒存」。
//   ② 貼圖只在本檔建構、且**逐鍵快取**:同一枚貼花每次重鍵不重新配置 GPU 資源
//      (A25 的同一條;貼花在編輯期會隨每次拖曳重建整棵樹)。
import * as THREE from 'three';
import { mulberry32 } from '/public/js/rng.js';
import { MARK_KINDS } from './doll.js';

const PX = 256;                       // 貼花是大色塊,256² 足夠(同 paint.js 花紋)
const cache = new Map();

const hexOf = (c) => `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
const mix = (c, f) => {
  const r = Math.round(((c >> 16) & 255) * f), g = Math.round(((c >> 8) & 255) * f), b = Math.round((c & 255) * f);
  return `rgb(${r},${g},${b})`;
};

/** 塗鴉:三到五筆噴漆走筆 + 滴流 + 噴霧點雲(歪斜是它的重點,MUST NOT 畫成幾何圖形) */
function drawGraffiti(x, rnd, color, text) {
  x.lineCap = 'round';
  x.lineJoin = 'round';
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const y0 = 60 + rnd() * 130, y1 = 60 + rnd() * 130;
    x.strokeStyle = i === 0 ? mix(color, 0.45) : hexOf(color);   // 第一筆當底影
    x.lineWidth = 26 + rnd() * 22 - i * 2;
    x.beginPath();
    x.moveTo(24 + rnd() * 24, y0);
    x.bezierCurveTo(70 + rnd() * 40, y0 - 60 + rnd() * 40,
      150 + rnd() * 40, y1 + 50 - rnd() * 60, 210 + rnd() * 24, y1);
    x.stroke();
  }
  // 滴流:噴漆重疊處往下流(貼花在機體側面時朝下,方向由貼花自身旋轉決定)
  x.fillStyle = hexOf(color);
  for (let i = 0; i < 6; i++) {
    const dx = 40 + rnd() * 176, dy = 110 + rnd() * 70, len = 16 + rnd() * 48;
    x.fillRect(dx, dy, 5 + rnd() * 4, len);
    x.beginPath();
    x.arc(dx + 3, dy + len, 4 + rnd() * 3, 0, Math.PI * 2);
    x.fill();
  }
  // 噴霧邊緣
  for (let i = 0; i < 220; i++) {
    x.globalAlpha = 0.12 + rnd() * 0.25;
    x.fillRect(20 + rnd() * 216, 40 + rnd() * 176, 2 + rnd() * 2, 2 + rnd() * 2);
  }
  x.globalAlpha = 1;
  if (text) {
    x.font = 'bold 54px "Noto Sans TC", sans-serif';
    x.textAlign = 'center';
    x.lineWidth = 8;
    x.strokeStyle = mix(color, 0.25);
    x.fillStyle = '#f2f4f8';
    x.save();
    x.translate(PX / 2, PX / 2 + 20);
    x.rotate(-0.12 + rnd() * 0.24);
    x.strokeText(text, 0, 0);
    x.fillText(text, 0, 0);
    x.restore();
  }
}

/** 圖騰:徑向對稱(3~8 階)的環帶紋樣 —— 一片楔形母題重複 n 次,中央一顆眼 */
function drawTotem(x, rnd, color, text) {
  const n = 3 + Math.floor(rnd() * 6);
  const R = PX / 2 - 10;
  const rings = 2 + Math.floor(rnd() * 2);
  x.translate(PX / 2, PX / 2);
  for (let i = 0; i < n; i++) {
    x.save();
    x.rotate((i / n) * Math.PI * 2);
    // 母題:自中心往外的尖楔 + 兩側鉤爪(逐階同形 ⇒ 對稱;差異只在環帶半徑)
    for (let r = 0; r < rings; r++) {
      const r0 = R * (0.34 + r * 0.28), r1 = r0 + R * 0.2;
      const w = 0.16 + rnd() * 0.12;
      x.fillStyle = r % 2 ? mix(color, 0.62) : hexOf(color);
      x.beginPath();
      x.moveTo(0, -r0);
      x.lineTo(Math.sin(w) * r1, -Math.cos(w) * r1);
      x.lineTo(0, -r1 - R * 0.06);
      x.lineTo(-Math.sin(w) * r1, -Math.cos(w) * r1);
      x.closePath();
      x.fill();
    }
    x.restore();
  }
  // 環帶
  x.strokeStyle = hexOf(color);
  for (let r = 0; r < rings; r++) {
    x.lineWidth = 4 + r * 2;
    x.beginPath();
    x.arc(0, 0, R * (0.3 + r * 0.28), 0, Math.PI * 2);
    x.stroke();
  }
  // 中央眼:內圈實心 + 瞳孔留空
  x.fillStyle = hexOf(color);
  x.beginPath();
  x.arc(0, 0, R * 0.24, 0, Math.PI * 2);
  x.fill();
  x.globalCompositeOperation = 'destination-out';
  x.beginPath();
  x.ellipse(0, 0, R * 0.13, R * 0.07, 0, 0, Math.PI * 2);
  x.fill();
  x.globalCompositeOperation = 'source-over';
  if (text) {
    x.font = 'bold 40px "Noto Sans TC", sans-serif';
    x.textAlign = 'center';
    x.fillStyle = hexOf(color);
    x.fillText(text, 0, R * 0.92);
  }
}

/** 烙印:壓印的環 + 缺口 + 短字;邊緣焦黑、內圈熾亮(它是燙上去的,不是噴上去的) */
function drawBrand(x, rnd, color, text) {
  const R = PX / 2 - 14;
  x.translate(PX / 2, PX / 2);
  // 焦邊:同心兩圈,外圈暗、內圈亮
  x.lineWidth = 22;
  x.strokeStyle = mix(color, 0.3);
  x.beginPath();
  x.arc(0, 0, R * 0.86, 0, Math.PI * 2);
  x.stroke();
  x.lineWidth = 12;
  x.strokeStyle = hexOf(color);
  x.beginPath();
  x.arc(0, 0, R * 0.86, 0, Math.PI * 2);
  x.stroke();
  // 缺口(烙鐵的斷點):決定性挑 2~4 個角度切掉
  const cuts = 2 + Math.floor(rnd() * 3);
  x.globalCompositeOperation = 'destination-out';
  x.lineWidth = 30;
  x.strokeStyle = '#000';
  for (let i = 0; i < cuts; i++) {
    const a = rnd() * Math.PI * 2, w = 0.16 + rnd() * 0.14;
    x.beginPath();
    x.arc(0, 0, R * 0.86, a, a + w);
    x.stroke();
  }
  x.globalCompositeOperation = 'source-over';
  // 中央印記:短字(使用者可填)或十字掛鉤
  x.fillStyle = hexOf(color);
  if (text) {
    x.font = `bold ${text.length > 2 ? 70 : 108}px "Noto Sans TC", sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 0, 4);
  } else {
    const arms = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < arms; i++) {
      x.save();
      x.rotate((i / arms) * Math.PI * 2 + 0.2);
      x.fillRect(-9, -R * 0.6, 18, R * 0.58);
      x.restore();
    }
    x.beginPath();
    x.arc(0, 0, R * 0.17, 0, Math.PI * 2);
    x.fill();
  }
}

const DRAW = { graffiti: drawGraffiti, totem: drawTotem, brand: drawBrand };

/**
 * 取得一枚彩繪的貼圖(逐鍵快取;同鍵回同一張 —— 貼花在編輯期每次拖曳都重建,
 * 不快取就是每一幀配置一張 256² 貼圖)。
 * @param m { kind, seed, color, text }
 */
export function markTexture(m) {
  const kind = MARK_KINDS.includes(m.kind) ? m.kind : MARK_KINDS[0];
  const color = m.color ?? 0xf05a3c;
  const text = m.text || '';
  const key = `${kind}:${m.seed >>> 0}:${color}:${text}`;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const x = cv.getContext('2d');
  x.clearRect(0, 0, PX, PX);
  DRAW[kind](x, mulberry32(m.seed >>> 0), color, text);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** 型錄鍵集(面板列表推導用;實作缺席的款不會出現在鈕面上) */
export const markKinds = () => MARK_KINDS.filter((k) => DRAW[k]);
