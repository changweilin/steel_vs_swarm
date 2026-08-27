// ============ 招式演出特效庫(castfx)============
// 32 名角色 × 小招/大招 = 64 式,每式指定「演出原型 × 圖騰 × 配色」——
// 告別全角色共用一套 shockRing 的年代,魔法陣/元素環繞/拳影劍氣/靈魂束縛/
// 治療綻放各有專屬演出。
//
//   原型(ARCHS):circle 魔法陣 / aura 元素環繞 / heal 治療綻放 / gate 召喚門 /
//                zone 打擊標定 / bind 靈魂束縛 / veil 隱匿消散 / scan 掃描脈波 /
//                dome 攔截穹頂 / dash 殘影突進 / slash 拳影劍氣 / atfield 絕對領域 /
//                snipe 天穹狙擊 / notewave 音波詠嘆
//   圖騰(MOTIF):hex 蜂巢 / note 音符 / math 數學 / gear 齒輪 / frost 雪花 /
//                star 星芒 / clock 錶盤 / cross 醫療 / reticle 準星 / bolt 電光 /
//                wing 羽翼 / coin 錢幣 / claw 爪痕 / rune 符文 / circuit 電路 /
//                flame 焰形 / poem 詩紋 / shield 盾徽 / fist 拳影
//                —— 全程序 canvas 向量繪製(不吃字型,賽璐璐硬邊),白稿 + 材質著色。
//
// 戰場(game.js 'cast' 事件)與展示台(charPreview.js)共用同一個 spawnCastFx():
// 特效物件全部走呼叫端的 effects 陣列({obj, ttl, fade(o,f,dt), dispose}),
// 不自帶迴圈;群組一律直掛 scene(effects 迴圈以 scene.remove 卸除),
// 跟隨施放者移動靠 fade() 每幀讀 casterPos()。
// 純視覺:不讀 sim 狀態、不影響判定;貼圖快取共用(dispose 只釋放 per-cast 幾何/材質)。
import * as THREE from 'three';
import { CHARACTERS, SIDES } from './data.js';
import { markShared, disposeTree } from './toon.js';

const TAU = Math.PI * 2;

// ---------------- 貼圖(快取,一律白稿供材質著色)----------------
const _tex = new Map();
function cached(key, S, draw, opts) {
  if (_tex.has(key)) return _tex.get(key);
  const cv = document.createElement('canvas');
  cv.width = opts?.w || S;
  cv.height = opts?.h || S;
  const ctx = cv.getContext('2d');
  draw(ctx, S, cv);
  const t = new THREE.CanvasTexture(cv);
  if (opts?.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _tex.set(key, t);
  return t;
}

/** 徑向光暈 */
function glowTex() {
  return cached('glow', 128, (ctx, S) => {
    const gr = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.30)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, S, S);
  });
}

/** 柔邊圓環(擴張波紋用) */
function softRingTex() {
  return cached('softring', 256, (ctx, S) => {
    const gr = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0.55, 'rgba(255,255,255,0)');
    gr.addColorStop(0.78, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.9, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, S, S);
  });
}

/** 虛線警戒環(打擊標定用) */
function dashRingTex() {
  return cached('dashring', 256, (ctx, S) => {
    const c = S / 2;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = S * 0.045;
    ctx.setLineDash([S * 0.07, S * 0.05]);
    ctx.beginPath(); ctx.arc(c, c, S * 0.42, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = S * 0.012;
    ctx.beginPath(); ctx.arc(c, c, S * 0.48, 0, TAU); ctx.stroke();
  });
}

/** 光柱縱向漸層(底亮頂透) */
function pillarTex() {
  return cached('pillar', 64, (ctx, S, cv) => {
    const gr = ctx.createLinearGradient(0, cv.height, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.30)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, cv.width, cv.height);
  }, { w: 32, h: 128 });
}

/** 三日月劍氣(拳影劍氣用) */
function crescentTex() {
  return cached('crescent', 256, (ctx, S) => {
    const c = S / 2;
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = S * 0.05;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(c, c - S * 0.06, S * 0.42, Math.PI * 0.06, Math.PI * 0.94);
    ctx.arc(c, c - S * 0.20, S * 0.36, Math.PI * 0.90, Math.PI * 0.10, true);
    ctx.closePath();
    ctx.fill();
  });
}

/** 六角能量格(穹頂/相位殼用;可平鋪)。
 *  repeat 是貼圖(非材質)屬性 → 不同鋪排 MUST 各拿一份快取克隆,別改共用那份。 */
function hexPatRepeat(rx, ry) {
  const key = `hexpat:${rx}x${ry}`;
  if (_tex.has(key)) return _tex.get(key);
  const t = hexPatTex().clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  _tex.set(key, t);
  return t;
}
function hexPatTex() {
  return cached('hexpat', 128, (ctx, S) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = S * 0.035;
    const r = S / 6, h = r * Math.sqrt(3) / 2;
    for (let row = -1; row < 8; row++) {
      for (let col = -1; col < 6; col++) {
        const x = col * r * 3 + (row % 2 ? r * 1.5 : 0), y = row * h;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i * TAU / 6;
          i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
            : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath(); ctx.stroke();
      }
    }
  }, { wrap: true });
}

/** 掃描扇(旋轉雷達掃過的殘輝) */
function sectorTex() {
  return cached('sector', 256, (ctx, S) => {
    const c = S / 2, n = 26, span = 0.9;
    for (let i = 0; i < n; i++) {
      const a0 = -span + (i / n) * span;
      ctx.fillStyle = `rgba(255,255,255,${(i / n) * 0.55})`;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, S * 0.48, a0, a0 + span / n + 0.01);
      ctx.closePath(); ctx.fill();
    }
  });
}

// ---------------- 圖騰(全向量白稿)----------------
/** 正 n 邊形路徑 */
function poly(ctx, n, R, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    i ? ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R) : ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
  }
  ctx.closePath();
}

/** 在已平移到中心的 ctx 上,以半徑 R 畫指定圖騰(i 變化同組花色) */
function drawGlyph(ctx, motif, R, i = 0) {
  ctx.lineWidth = R * 0.18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  const L = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  switch (motif) {
    case 'hex': poly(ctx, 6, R * 0.8); ctx.stroke(); break;
    case 'note': {   // 八分音符
      ctx.beginPath(); ctx.ellipse(-R * 0.3, R * 0.5, R * 0.32, R * 0.22, -0.4, 0, TAU); ctx.fill();
      L(-R * 0.02, R * 0.42, -R * 0.02, -R * 0.62);
      ctx.beginPath(); ctx.moveTo(-R * 0.02, -R * 0.62);
      ctx.quadraticCurveTo(R * 0.45, -R * 0.45, R * 0.42, -R * 0.02); ctx.stroke();
      break;
    }
    case 'math': {   // Σ π √ ∞ 輪替
      const k = i % 4;
      if (k === 0) {         // Σ
        ctx.beginPath(); ctx.moveTo(R * 0.5, -R * 0.65); ctx.lineTo(-R * 0.5, -R * 0.65);
        ctx.lineTo(R * 0.05, 0); ctx.lineTo(-R * 0.5, R * 0.65); ctx.lineTo(R * 0.5, R * 0.65); ctx.stroke();
      } else if (k === 1) {  // π
        L(-R * 0.65, -R * 0.4, R * 0.65, -R * 0.4);
        L(-R * 0.35, -R * 0.4, -R * 0.4, R * 0.6);
        ctx.beginPath(); ctx.moveTo(R * 0.35, -R * 0.4);
        ctx.quadraticCurveTo(R * 0.3, R * 0.45, R * 0.6, R * 0.55); ctx.stroke();
      } else if (k === 2) {  // √
        ctx.beginPath(); ctx.moveTo(-R * 0.65, R * 0.1); ctx.lineTo(-R * 0.25, R * 0.6);
        ctx.lineTo(R * 0.2, -R * 0.6); ctx.lineTo(R * 0.7, -R * 0.6); ctx.stroke();
      } else {               // ∞
        ctx.beginPath(); ctx.ellipse(-R * 0.32, 0, R * 0.3, R * 0.22, 0, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(R * 0.32, 0, R * 0.3, R * 0.22, 0, 0, TAU); ctx.stroke();
      }
      break;
    }
    case 'gear': {   // 齒輪:外齒 + 環身 + 軸孔
      for (let k = 0; k < 8; k++) {
        ctx.save(); ctx.rotate(k * TAU / 8);
        ctx.fillRect(-R * 0.11, -R * 0.86, R * 0.22, R * 0.3);
        ctx.restore();
      }
      ctx.lineWidth = R * 0.3;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.52, 0, TAU); ctx.stroke();
      break;
    }
    case 'frost': {  // 六芒雪花
      ctx.lineWidth = R * 0.13;
      for (let k = 0; k < 6; k++) {
        ctx.save(); ctx.rotate(k * TAU / 6);
        L(0, 0, 0, -R * 0.85);
        L(0, -R * 0.5, R * 0.24, -R * 0.72);
        L(0, -R * 0.5, -R * 0.24, -R * 0.72);
        ctx.restore();
      }
      break;
    }
    case 'star': {   // 四芒星 + 伴星
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.85); ctx.lineTo(R * 0.16, -R * 0.16); ctx.lineTo(R * 0.85, 0);
      ctx.lineTo(R * 0.16, R * 0.16); ctx.lineTo(0, R * 0.85); ctx.lineTo(-R * 0.16, R * 0.16);
      ctx.lineTo(-R * 0.85, 0); ctx.lineTo(-R * 0.16, -R * 0.16);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(R * 0.55, -R * 0.55, R * 0.09, 0, TAU); ctx.fill();
      break;
    }
    case 'clock': {  // 錶盤:刻度 + 時分針
      ctx.lineWidth = R * 0.1;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, TAU); ctx.stroke();
      for (let k = 0; k < 12; k++) {
        ctx.save(); ctx.rotate(k * TAU / 12);
        L(0, -R * 0.8, 0, -R * (k % 3 === 0 ? 0.58 : 0.68));
        ctx.restore();
      }
      ctx.lineWidth = R * 0.14;
      L(0, 0, 0, -R * 0.5);
      L(0, 0, R * 0.34, R * 0.1);
      break;
    }
    case 'cross':    // 醫療十字
      ctx.fillRect(-R * 0.2, -R * 0.68, R * 0.4, R * 1.36);
      ctx.fillRect(-R * 0.68, -R * 0.2, R * 1.36, R * 0.4);
      break;
    case 'reticle': {  // 準星
      ctx.lineWidth = R * 0.12;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, TAU); ctx.stroke();
      for (let k = 0; k < 4; k++) {
        ctx.save(); ctx.rotate(k * TAU / 4);
        L(0, -R * 0.9, 0, -R * 0.5);
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(0, 0, R * 0.1, 0, TAU); ctx.fill();
      break;
    }
    case 'bolt':     // 閃電
      ctx.beginPath();
      ctx.moveTo(R * 0.15, -R * 0.85); ctx.lineTo(-R * 0.35, R * 0.05); ctx.lineTo(-R * 0.02, R * 0.05);
      ctx.lineTo(-R * 0.15, R * 0.85); ctx.lineTo(R * 0.35, -R * 0.1); ctx.lineTo(R * 0.02, -R * 0.1);
      ctx.closePath(); ctx.fill();
      break;
    case 'wing': {   // 三疊翼羽(雪佛龍)
      ctx.lineWidth = R * 0.15;
      for (let k = 0; k < 3; k++) {
        const y = -R * 0.45 + k * R * 0.42;
        ctx.beginPath();
        ctx.moveTo(-R * 0.7, y + R * 0.3);
        ctx.quadraticCurveTo(0, y - R * 0.25, R * 0.7, y + R * 0.3);
        ctx.stroke();
      }
      break;
    }
    case 'coin': {   // 方孔錢
      ctx.lineWidth = R * 0.2;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.68, 0, TAU); ctx.stroke();
      ctx.lineWidth = R * 0.12;
      poly(ctx, 4, R * 0.3, Math.PI / 4); ctx.stroke();
      break;
    }
    case 'claw': {   // 三道爪痕
      ctx.lineWidth = R * 0.16;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(-R * 0.55 + k * R * 0.34, -R * 0.7);
        ctx.quadraticCurveTo(R * 0.25 + k * R * 0.34, 0, -R * 0.1 + k * R * 0.34, R * 0.75);
        ctx.stroke();
      }
      break;
    }
    case 'circuit': {  // 電路走線 + 節點
      ctx.lineWidth = R * 0.13;
      ctx.beginPath(); ctx.moveTo(-R * 0.65, -R * 0.55); ctx.lineTo(0, -R * 0.55); ctx.lineTo(0, 0);
      ctx.lineTo(R * 0.6, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * 0.55, R * 0.55); ctx.lineTo(R * 0.1, R * 0.55); ctx.lineTo(R * 0.1, R * 0.15);
      ctx.stroke();
      for (const [x, y] of [[-R * 0.65, -R * 0.55], [R * 0.6, 0], [-R * 0.55, R * 0.55]]) {
        ctx.beginPath(); ctx.arc(x, y, R * 0.13, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'flame': {  // 焰形(空心淚滴)
      ctx.beginPath();
      ctx.moveTo(0, R * 0.75);
      ctx.bezierCurveTo(-R * 0.75, R * 0.25, -R * 0.3, -R * 0.3, 0, -R * 0.85);
      ctx.bezierCurveTo(R * 0.3, -R * 0.3, R * 0.75, R * 0.25, 0, R * 0.75);
      ctx.fill();
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(0, R * 0.45);
      ctx.bezierCurveTo(-R * 0.3, R * 0.15, -R * 0.12, -R * 0.05, 0, -R * 0.3);
      ctx.bezierCurveTo(R * 0.12, -R * 0.05, R * 0.3, R * 0.15, 0, R * 0.45);
      ctx.fill(); ctx.restore();
      break;
    }
    case 'poem': {   // 詩紋(飄逸雙曲)
      ctx.lineWidth = R * 0.13;
      ctx.beginPath(); ctx.moveTo(-R * 0.6, -R * 0.5);
      ctx.bezierCurveTo(R * 0.4, -R * 0.7, -R * 0.5, R * 0.1, R * 0.55, -R * 0.05);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * 0.5, R * 0.35);
      ctx.bezierCurveTo(R * 0.3, R * 0.1, -R * 0.2, R * 0.75, R * 0.6, R * 0.5);
      ctx.stroke();
      break;
    }
    case 'shield': { // 盾徽
      ctx.lineWidth = R * 0.14;
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.75); ctx.lineTo(R * 0.58, -R * 0.5); ctx.lineTo(R * 0.52, R * 0.15);
      ctx.quadraticCurveTo(R * 0.3, R * 0.55, 0, R * 0.78);
      ctx.quadraticCurveTo(-R * 0.3, R * 0.55, -R * 0.52, R * 0.15);
      ctx.lineTo(-R * 0.58, -R * 0.5);
      ctx.closePath(); ctx.stroke();
      L(0, -R * 0.35, 0, R * 0.3);
      break;
    }
    case 'fist': {   // 拳影剪影
      const rr = (x, y, w, h, rad) => {
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.arcTo(x + w, y, x + w, y + h, rad);
        ctx.arcTo(x + w, y + h, x, y + h, rad);
        ctx.arcTo(x, y + h, x, y, rad);
        ctx.arcTo(x, y, x + w, y, rad);
        ctx.closePath(); ctx.fill();
      };
      rr(-R * 0.55, -R * 0.25, R * 1.1, R * 0.75, R * 0.18);
      for (let k = 0; k < 4; k++) {
        ctx.beginPath(); ctx.arc(-R * 0.4 + k * R * 0.27, -R * 0.28, R * 0.16, 0, TAU); ctx.fill();
      }
      ctx.beginPath(); ctx.ellipse(-R * 0.58, R * 0.18, R * 0.16, R * 0.26, 0.4, 0, TAU); ctx.fill();
      break;
    }
    default: {       // rune:確定性亂數折線符文(i 為種子 → 同組不同花)
      let s = (i * 2654435761 + 909091) >>> 0;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      ctx.lineWidth = R * 0.14;
      ctx.beginPath();
      let x = (rnd() - 0.5) * R, y = -R * 0.7;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x = (rnd() - 0.5) * R * 1.4; y = -R * 0.7 + (k + 1) * R * 0.35;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      L(-R * 0.45, -R * 0.1, R * 0.45, (rnd() - 0.5) * R * 0.5);
    }
  }
}

/** 單一圖騰貼圖(粒子/環繞 sprite 用)。
 *  只有 math(i%4 輪替)與 rune(i 為種子)真的隨 i 變化,其餘一律鍵到 i=0
 *  —— 否則每個 i 各建一張像素相同的貼圖,白佔 GPU。 */
function glyphTex(motif, i = 0) {
  const vi = (motif === 'math' || motif === 'rune') ? i : 0;
  return cached(`g:${motif}:${vi}`, 96, (ctx, S) => {
    ctx.translate(S / 2, S / 2);
    drawGlyph(ctx, motif, S * 0.42, vi);
  });
}

// 魔法陣內圈幾何:圖騰 → 疊繪的正多邊形邊數(查無 → 雙三角六芒)
const MOTIF_POLY = { hex: 6, frost: 6, gear: 8, math: 4, star: 5, clock: 12, reticle: 4, shield: 5, coin: 4 };

/** 完整魔法陣貼圖(雙環 + 刻度 + 圖騰環 + 內圈星形 + 輻條) */
function circleTex(motif) {
  return cached(`mc:${motif}`, 512, (ctx, S) => {
    const c = S / 2;
    ctx.translate(c, c);
    ctx.strokeStyle = '#fff';
    const ring = (r, w) => { ctx.lineWidth = S * w; ctx.beginPath(); ctx.arc(0, 0, c * r, 0, TAU); ctx.stroke(); };
    ring(0.97, 0.010);
    ring(0.885, 0.005);
    // 外環刻度
    ctx.lineWidth = S * 0.006;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU, r0 = c * 0.885, r1 = c * (i % 4 === 0 ? 0.94 : 0.915);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    // 圖騰環(14 枚,朝外站立)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -c * 0.78);
      drawGlyph(ctx, motif, S * 0.048, i);
      ctx.restore();
    }
    ring(0.66, 0.005);
    // 內圈星形:兩枚疊轉多邊形
    const n = MOTIF_POLY[motif] ?? 3;
    ctx.lineWidth = S * 0.007;
    poly(ctx, n, c * 0.60); ctx.stroke();
    poly(ctx, n, c * 0.60, -Math.PI / 2 + Math.PI / n); ctx.stroke();
    ring(0.30, 0.006);
    // 輻條
    ctx.lineWidth = S * 0.004;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * c * 0.30, Math.sin(a) * c * 0.30);
      ctx.lineTo(Math.cos(a) * c * 0.60, Math.sin(a) * c * 0.60);
      ctx.stroke();
    }
    // 中心大圖騰
    drawGlyph(ctx, motif, S * 0.11, 7);
  });
}

// ---------------- 幾何/材質共用件 ----------------
// 共用幾何(MUST NOT dispose;經 toon.js markShared 註冊,disposeTree 依此跳過)
const PLANE = markShared(new THREE.PlaneGeometry(2, 2));                                  // 邊長 2 = 半徑 1
const CYL = markShared(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true));                 // 單位光柱
const OCT = markShared(new THREE.RingGeometry(0.82, 1, 8, 1));                            // 八角環(絕對領域)
const DOME = markShared(new THREE.SphereGeometry(1, 24, 10, 0, TAU, 0, Math.PI / 2));     // 半球
const SHELL = markShared(new THREE.SphereGeometry(1, 20, 12));                            // 相位殼

const M = (map, color, o = 1) => {
  const m = new THREE.MeshBasicMaterial({
    map, color, transparent: true, opacity: o, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  m.userData.o = o;
  return m;
};
const SPM = (map, color, o = 1) => {
  const m = new THREE.SpriteMaterial({
    map, color, transparent: true, opacity: o, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  m.userData.o = o;
  return m;
};

/** 平躺(貼地)網格 */
function flat(mesh) { mesh.rotation.x = -Math.PI / 2; return mesh; }

/** 群組整體透明度(材質建立時記住基準 opacity) */
function fadeAll(group, k) {
  group.traverse((o) => {
    const m = o.material;
    if (m && m.userData.o != null) m.opacity = m.userData.o * k;
  });
}

/** 進出場包絡:attack 秒淡入、release 秒淡出 */
const bell = (t, dur, a = 0.18, r = 0.45) =>
  Math.max(0, Math.min(t / a, 1, (dur - t) / r));
/** 回彈放大(魔法陣展開) */
const outBack = (t) => {
  const p = Math.min(1, t) - 1;
  return 1 + 2.2 * p * p * p + 1.2 * p * p;
};

/** 施放者錨點:貼著機體下緣的水平面(飛行機體 = 懸浮魔法陣;取不到 = 落點) */
function anchorCaster(g, P, dy = null) {
  const p = P.casterPos?.();
  if (!p) { g.position.copy(P.at); g.position.y += 0.35; return; }
  const gy = P.groundY ? P.groundY(p.x, p.z) : 0;
  g.position.set(p.x, Math.max(gy + 0.35, p.y + (dy ?? -P.scale * 0.55)), p.z);
}

/** 視覺半徑:自身演出至少 selfK × 機體尺度,範圍演出吃招式半徑(夾上限防糊屏;
 *  P.cap = 呼叫端取景預算 —— 展示台鏡頭框不住絕對下限,一律最後夾) */
const clampR = (P, selfK, cap = 120) => Math.min(Math.max(P.r || 0, P.scale * selfK), cap, P.cap);

/** 環繞 sprite 群(元素環繞/音符/雪花……) */
function makeOrbit(motif, col, n, R, size) {
  const g = new THREE.Group();
  const items = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(SPM(glyphTex(motif, i), col, 0.9));
    s.scale.setScalar(size * (0.75 + Math.random() * 0.5));
    g.add(s);
    items.push({
      s,
      ph: (i / n) * TAU + Math.random() * 0.4,
      spd: (2.0 + Math.random() * 1.4) * (Math.random() < 0.5 ? 1 : -1),   // 隨機正反向 = 雙向交錯
      rr: R * (0.85 + Math.random() * 0.35),
      h0: Math.random() * 0.6,
    });
  }
  return { g, items };
}
function stepOrbit(orb, t, riseK, spreadK = 1) {
  for (const it of orb.items) {
    const a = it.ph + t * it.spd;
    it.s.position.set(
      Math.cos(a) * it.rr * spreadK,
      it.h0 + t * riseK,
      Math.sin(a) * it.rr * spreadK,
    );
    it.s.material.rotation = a * 0.7;
  }
}

/** 上升粒子群(治療/召喚火花) */
function risingPoints(motif, col, n, R, size) {
  const pos = new Float32Array(n * 3);
  const dat = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * R;
    pos[i * 3] = Math.cos(a) * rr;
    pos[i * 3 + 1] = Math.random() * 0.8;
    pos[i * 3 + 2] = Math.sin(a) * rr;
    dat.push({ v: 2.2 + Math.random() * 2.6, sw: (Math.random() - 0.5) * 1.6 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: motif ? glyphTex(motif, 0) : glowTex(), color: col, size,
    transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  mat.userData.o = 0.95;
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;   // 位置每幀改寫,首繪快取的包圍球會把升空粒子整批誤剔除
  return { pts, dat };
}
function stepPoints(P2, dt, vK = 1) {
  const arr = P2.pts.geometry.attributes.position.array;
  for (let i = 0; i < P2.dat.length; i++) {
    arr[i * 3] += P2.dat[i].sw * dt;
    arr[i * 3 + 1] += P2.dat[i].v * vK * dt;
  }
  P2.pts.geometry.attributes.position.needsUpdate = true;
}

/** 光柱(單位圓柱縮放;高 h、半徑 r) */
function pillar(col, r, h, o = 0.35) {
  const p = new THREE.Mesh(CYL, M(pillarTex(), col, o));
  p.scale.set(r, h, r);
  p.position.y = h / 2;
  return p;
}

/** 掛進 effects 陣列(群組直掛 scene,fade 每幀驅動 step) */
function push(scene, effects, g, dur, step) {
  scene.add(g);
  let t = 0;
  effects.push({
    obj: g, ttl: dur,
    fade: (o, f, dt) => { t += dt; step(t, dt, o); },
    dispose: () => disposeTree(g),
  });
}

// ---------------- 演出原型 ----------------
/** circle 魔法陣:雙層對轉法陣 + 光柱 + 圖騰環繞(團隊增益/守護) */
function fxCircle(scene, effects, P) {
  const rv = clampR(P, P.big ? 2.8 : 2.2);
  const dur = P.big ? 2.6 : 2.0;
  const g = new THREE.Group();
  const main = flat(new THREE.Mesh(PLANE, M(circleTex(P.motif), P.col, 0.95)));
  const inner = flat(new THREE.Mesh(PLANE, M(circleTex(P.motif), P.col2, 0.7)));
  inner.position.y = 0.25;
  const pil = pillar(P.col, rv * 0.30, P.scale * (P.big ? 3.2 : 2.2), 0.30);
  const orb = makeOrbit(P.motif, P.col2, P.big ? 10 : 6, rv * 0.72, P.scale * 0.36);
  g.add(main, inner, pil, orb.g);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    const grow = outBack(Math.min(1, t / 0.4));
    main.scale.setScalar(Math.max(0.01, rv * grow));
    inner.scale.setScalar(Math.max(0.01, rv * 0.55 * grow));
    main.rotation.z += dt * 0.5;
    inner.rotation.z -= dt * 1.1;
    stepOrbit(orb, t, P.scale * 0.55);
    fadeAll(g, bell(t, dur));
    pil.material.opacity *= 0.75 + 0.25 * Math.sin(t * 9);
  });
}

/** aura 元素環繞:足下小法陣 + 圖騰螺旋昇騰(自身增益) */
function fxAura(scene, effects, P) {
  const rv = P.scale * 1.5;
  const dur = 2.2;
  const g = new THREE.Group();
  const base = flat(new THREE.Mesh(PLANE, M(circleTex(P.motif), P.col, 0.8)));
  const orb = makeOrbit(P.motif, P.col, 7, rv, P.scale * 0.42);
  const orb2 = makeOrbit(P.motif, P.col2, 4, rv * 0.6, P.scale * 0.3);
  g.add(base, orb.g, orb2.g);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    base.scale.setScalar(Math.max(0.01, rv * outBack(Math.min(1, t / 0.3))));
    base.rotation.z += dt * 1.4;
    stepOrbit(orb, t, P.scale * 0.9);          // 外圈盤旋昇騰
    stepOrbit(orb2, t * 1.6, P.scale * 1.3);   // 內圈快轉
    fadeAll(g, bell(t, dur));
  });
}

/** heal 治療綻放:柔光地圈 + 上升圖騰粒子 + 雙螺旋光帶 + 光柱 */
function fxHeal(scene, effects, P) {
  const rv = clampR(P, 1.8, 90);
  const dur = P.big ? 2.8 : 2.2;
  const g = new THREE.Group();
  const disc = flat(new THREE.Mesh(PLANE, M(glowTex(), P.col2, 0.55)));
  disc.scale.setScalar(rv);
  const pts = risingPoints(P.motif, P.col2, P.big ? 46 : 26, Math.min(rv, P.scale * 3.2), P.scale * 0.5);
  const pil = pillar(P.col2, P.scale * 0.8, P.scale * 2.8, 0.4);
  g.add(disc, pts.pts, pil);
  // 大招附魔法陣底 + 雙螺旋
  const helix = [];
  if (P.big) {
    const ring = flat(new THREE.Mesh(PLANE, M(circleTex(P.motif), P.col, 0.85)));
    ring.position.y = 0.15;
    ring.scale.setScalar(rv);
    g.add(ring);
    helix.push(ring);
    for (let k = 0; k < 2; k++) {
      const pts3 = [];
      for (let i = 0; i <= 22; i++) {
        const u = i / 22, a = u * Math.PI * 3.2 + k * Math.PI;
        pts3.push(new THREE.Vector3(
          Math.cos(a) * P.scale * 1.1 * (1 - 0.3 * u), u * P.scale * 2.6, Math.sin(a) * P.scale * 1.1 * (1 - 0.3 * u)));
      }
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts3), 32, P.scale * 0.05, 5),
        M(null, P.col2, 0.8));
      g.add(tube);
      helix.push(tube);
    }
  }
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    stepPoints(pts, dt);
    for (const h of helix) if (h !== helix[0]) h.rotation.y += dt * 2.2;
    if (P.big && helix[0]) helix[0].rotation.z += dt * 0.4;
    fadeAll(g, bell(t, dur, 0.22, 0.6));
  });
}

/** gate 召喚門:法陣 + 環列信標光柱 + 噴湧火花 + 擴張波紋 */
function fxGate(scene, effects, P) {
  const rv = Math.min(Math.max(P.scale * 2.6, 14), P.cap);
  const dur = 2.6;
  const g = new THREE.Group();
  const main = flat(new THREE.Mesh(PLANE, M(circleTex(P.motif), P.col, 0.95)));
  const wave = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.8)));
  wave.position.y = 0.2;
  const beacons = [];
  for (let k = 0; k < 4; k++) {
    const b = pillar(P.col2, rv * 0.06, P.scale * 4.2, 0.75);
    const a = (k / 4) * TAU + 0.5;
    b.position.set(Math.cos(a) * rv * 0.62, b.position.y, Math.sin(a) * rv * 0.62);
    beacons.push(b);
    g.add(b);
  }
  const pts = risingPoints(null, P.col, 34, rv * 0.5, P.scale * 0.4);
  g.add(main, wave, pts.pts);
  g.position.copy(P.at);
  g.position.y += 0.35;
  push(scene, effects, g, dur, (t, dt) => {
    main.scale.setScalar(Math.max(0.01, rv * outBack(Math.min(1, t / 0.45))));
    main.rotation.z += dt * 0.8;
    wave.scale.setScalar(Math.max(0.01, rv * (0.3 + (t % 0.9) / 0.9 * 1.3)));
    stepPoints(pts, dt, 1.4);
    const env = bell(t, dur, 0.2, 0.5);
    fadeAll(g, env);
    // fadeAll 之後再疊各自的週期項(先寫會被覆掉)
    beacons.forEach((b, i) => { b.material.opacity *= 0.5 + 0.5 * Math.sin(t * 10 + i * 1.7); });
    wave.material.opacity = wave.material.userData.o * env * (1 - (t % 0.9) / 0.9);
  });
}

/** zone 打擊標定:虛線警戒環旋轉 + 收束環 + 四向圖騰 + 中心警示光柱 */
function fxZone(scene, effects, P) {
  const rv = Math.min(Math.max((P.r || 10) * 3.2, 22), 70, P.cap);
  const dur = 1.8;
  const g = new THREE.Group();
  const dash = flat(new THREE.Mesh(PLANE, M(dashRingTex(), P.col, 0.95)));
  const converge = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.85)));
  converge.position.y = 0.25;
  const pil = pillar(P.col, rv * 0.10, P.scale * 5.5, 0.5);
  const glyphs = [];
  for (let k = 0; k < 4; k++) {
    const s = new THREE.Sprite(SPM(glyphTex(P.motif, k), P.col, 0.9));
    s.scale.setScalar(rv * 0.2);
    glyphs.push(s);
    g.add(s);
  }
  g.add(dash, converge, pil);
  g.position.copy(P.at);
  g.position.y += 0.35;
  push(scene, effects, g, dur, (t, dt) => {
    dash.scale.setScalar(Math.max(0.01, rv * Math.min(1, t / 0.25)));
    dash.rotation.z += dt * 1.8;
    converge.scale.setScalar(Math.max(0.01, rv * (1.6 - Math.min(1, t / 0.9) * 0.7)));
    glyphs.forEach((s, i) => {
      const a = (i / 4) * TAU + t * 1.8;
      const rr = rv * (1.05 - Math.min(1, t / 0.9) * 0.35);
      s.position.set(Math.cos(a) * rr, P.scale * 0.6, Math.sin(a) * rr);
    });
    fadeAll(g, bell(t, dur, 0.12, 0.35));
    pil.material.opacity *= 0.6 + 0.4 * Math.sin(t * 14);
  });
}

/** bind 靈魂束縛:暗色地縛陣 + 鎖鏈自外緣竄升收束 + 遊魂光點 */
function fxBind(scene, effects, P) {
  const rv = clampR(P, 2.2, 90);
  const cr = Math.min(rv, P.scale * 4.5);          // 鎖鏈只圍住中心(大範圍照樣讀得懂)
  const dur = 2.6;
  const g = new THREE.Group();
  // 暗幕(normal blending 壓暗地面,加法陣疊在上面)
  const dark = flat(new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({
    map: glowTex(), color: 0x0a0414, transparent: true, opacity: 0.5, depthWrite: false,
  })));
  dark.material.userData.o = 0.5;
  dark.scale.setScalar(rv);
  const ring = flat(new THREE.Mesh(PLANE, M(circleTex(P.motif), P.col, 0.9)));
  ring.position.y = 0.2;
  // 鎖鏈:自外緣拱起收向中心上方,drawRange 逐節生長
  const chains = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.random() * 0.4;
    const top = P.scale * (1.6 + Math.random() * 0.8);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * cr, 0, Math.sin(a) * cr),
      new THREE.Vector3(Math.cos(a + 0.5) * cr * 0.6, top * 0.55, Math.sin(a + 0.5) * cr * 0.6),
      new THREE.Vector3(Math.cos(a + 0.9) * cr * 0.12, top, Math.sin(a + 0.9) * cr * 0.12),
    ]);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 20, P.scale * 0.07, 5),
      M(null, P.col, 0.9));
    tube.geometry.userData.total = tube.geometry.index.count;
    chains.push(tube);
    g.add(tube);
  }
  // 遊魂:柔光點緩升飄移
  const wisps = [];
  for (let k = 0; k < 8; k++) {
    const s = new THREE.Sprite(SPM(glowTex(), P.col2, 0.7));
    s.scale.setScalar(P.scale * (0.5 + Math.random() * 0.6));
    s.position.set((Math.random() - 0.5) * cr * 1.4, Math.random() * P.scale, (Math.random() - 0.5) * cr * 1.4);
    wisps.push({ s, v: 1 + Math.random() * 1.6, ph: Math.random() * TAU });
    g.add(s);
  }
  g.add(dark, ring);
  g.position.copy(P.at);
  g.position.y += 0.35;
  push(scene, effects, g, dur, (t, dt) => {
    ring.scale.setScalar(Math.max(0.01, rv * Math.min(1, t / 0.35)));
    ring.rotation.z -= dt * 0.4;
    const grow = Math.min(1, t / 0.8);
    for (const c of chains) c.geometry.setDrawRange(0, Math.floor(c.geometry.userData.total * grow));
    for (const w of wisps) {
      w.s.position.y += w.v * dt;
      w.s.position.x += Math.sin(t * 2 + w.ph) * dt * 1.2;
    }
    fadeAll(g, bell(t, dur, 0.2, 0.55));
  });
}

/** veil 隱匿消散:相位殼收攏 + 崩解光屑下墜 + 足下殘紋(演出完 = 人消失) */
function fxVeil(scene, effects, P) {
  const dur = 1.8;
  const g = new THREE.Group();
  const shell = new THREE.Mesh(SHELL, M(hexPatRepeat(4, 2), P.col, 0.4));
  shell.scale.setScalar(P.scale * 0.95);
  shell.position.y = P.scale * 0.55;
  const ringM = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.6)));
  // 崩解光屑:自殼面向下飄落
  const n = 36;
  const pos = new Float32Array(n * 3);
  const dat = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, ph = Math.random() * Math.PI;
    const rr = P.scale * 0.95;
    pos[i * 3] = Math.cos(a) * Math.sin(ph) * rr;
    pos[i * 3 + 1] = P.scale * 0.55 + Math.cos(ph) * rr * 0.6;
    pos[i * 3 + 2] = Math.sin(a) * Math.sin(ph) * rr;
    dat.push({ v: 1.2 + Math.random() * 2 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pmat = new THREE.PointsMaterial({
    map: glowTex(), color: P.col2, size: P.scale * 0.22,
    transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  pmat.userData.o = 0.9;
  const pts = new THREE.Points(geo, pmat);
  pts.frustumCulled = false;   // 光屑每幀下墜,別吃首繪包圍球的視錐剔除
  g.add(shell, ringM, pts);
  anchorCaster(g, P, -P.scale * 0.5);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P, -P.scale * 0.5);
    shell.rotation.y += dt * 1.2;
    shell.scale.setScalar(P.scale * 0.95 * (1 + t * 0.18));
    ringM.scale.setScalar(Math.max(0.01, P.scale * (1.2 + t * 1.6)));
    const arr = pts.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) arr[i * 3 + 1] -= dat[i].v * dt;
    pts.geometry.attributes.position.needsUpdate = true;
    fadeAll(g, bell(t, dur, 0.15, 0.9));   // 長釋放 = 逐漸消失的重點
  });
}

/** scan 掃描脈波:擴張波紋 ×3 + 旋轉掃描扇 + 中心圖騰昇起 */
function fxScan(scene, effects, P) {
  const rv = clampR(P, 2.6);
  const dur = 2.4;
  const g = new THREE.Group();
  const waves = [];
  for (let k = 0; k < 3; k++) {
    const w = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col, 0.85)));
    w.position.y = 0.2 + k * 0.1;
    waves.push(w);
    g.add(w);
  }
  const sweep = flat(new THREE.Mesh(PLANE, M(sectorTex(), P.col, 0.7)));
  sweep.position.y = 0.4;
  sweep.scale.setScalar(rv * 0.8);
  const glyph = new THREE.Sprite(SPM(glyphTex(P.motif, 2), P.col2, 0.95));
  glyph.scale.setScalar(P.scale * 0.9);
  const base = flat(new THREE.Mesh(PLANE, M(circleTex(P.motif), P.col, 0.5)));
  base.scale.setScalar(rv * 0.5);
  g.add(sweep, glyph, base);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    waves.forEach((w, i) => {
      const u = (t - i * 0.3) / 1.1;
      if (u < 0 || u > 1) { w.material.opacity = 0; return; }
      w.scale.setScalar(Math.max(0.01, rv * u));
      w.material.opacity = w.material.userData.o * (1 - u) * bell(t, dur, 0.1, 0.3);
    });
    sweep.rotation.z += dt * 2.6;
    base.rotation.z -= dt * 0.7;
    glyph.position.y = P.scale * (0.8 + t * 0.5);
    const env = bell(t, dur, 0.15, 0.5);
    sweep.material.opacity = sweep.material.userData.o * env;
    glyph.material.opacity = glyph.material.userData.o * env;
    base.material.opacity = base.material.userData.o * env;
  });
}

/** dome 攔截穹頂:六角能量半球 + 環腳波紋 + 頂點圖騰 */
function fxDome(scene, effects, P) {
  const rv = clampR(P, 2.4, 70);
  const dur = 2.0;
  const g = new THREE.Group();
  // 六角格密度隨半徑等比(量化以免快取爆量):大穹頂的格子才不會被撐成巨格;
  // 濃度隨半徑遞減 —— 大型攔截力場是「罩住半個戰場的薄膜」,個人護盾才是實感硬殼
  const rep = Math.min(28, Math.max(6, Math.round(rv * 0.2) * 2));
  const dO = 0.35 * Math.min(1, Math.max(0.35, P.scale * 5 / rv));
  const dome = new THREE.Mesh(DOME, M(hexPatRepeat(rep, Math.max(3, Math.round(rep * 0.4))), P.col, dO));
  const rim = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.85)));
  rim.position.y = 0.25;
  const glyph = new THREE.Sprite(SPM(glyphTex(P.motif, 1), P.col2, 0.95));
  glyph.scale.setScalar(P.scale * 0.9);
  g.add(dome, rim, glyph);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    const grow = outBack(Math.min(1, t / 0.35));
    dome.scale.set(rv * grow, rv * grow * 0.85, rv * grow);
    dome.rotation.y += dt * 0.5;
    rim.scale.setScalar(Math.max(0.01, rv * (1 + 0.06 * Math.sin(t * 8))));
    glyph.position.y = rv * grow * 0.9;
    fadeAll(g, bell(t, dur, 0.15, 0.55));
    dome.material.opacity *= 0.8 + 0.2 * Math.sin(t * 12);
  });
}

/** dash 殘影突進:沿實際位移灑圖騰殘影 + 光streak(靜止時 = 原地環爆殘影) */
function fxDash(scene, effects, P) {
  const dur = 1.5;
  const g = new THREE.Group();           // 子件全用世界座標,群組留在原點
  const ghosts = [];
  let last = null, timer = 0;
  const burst = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.95)));
  const p0 = P.casterPos?.() || P.at;
  burst.position.set(p0.x, p0.y - P.scale * 0.4, p0.z);
  g.add(burst);
  push(scene, effects, g, dur, (t, dt) => {
    burst.scale.setScalar(Math.max(0.01, P.scale * (1 + t * 5)));
    burst.material.opacity = burst.material.userData.o * Math.max(0, 1 - t / 0.6);
    const p = P.casterPos?.() || P.at;
    timer -= dt;
    if (timer <= 0 && t < dur - 0.5) {
      timer = 0.045;
      const moved = last && last.distanceToSquared(p) > 0.05;
      // 殘影:貼著行進軌跡;原地施放(展示台)→ 繞著機體灑
      const s = new THREE.Sprite(SPM(glyphTex(P.motif, ghosts.length), P.col, 0.95));
      s.scale.setScalar(P.scale * (0.8 + Math.random() * 0.6));
      if (moved) {
        s.position.copy(last).lerp(p, Math.random());
        s.position.y += (Math.random() - 0.3) * P.scale * 0.5;
        // 光痕:上一幀 → 這一幀的發光速度線
        const seg = p.clone().sub(last);
        const len = seg.length();
        if (len > 0.1) {
          const st = new THREE.Mesh(CYL, M(pillarTex(), P.col2, 0.8));
          st.scale.set(P.scale * 0.1, len * 1.6, P.scale * 0.1);
          st.position.copy(last).addScaledVector(seg, 0.5);
          st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.normalize());
          g.add(st);
          ghosts.push({ o: st, age: 0, ttl: 0.4 });
        }
      } else {
        const a = Math.random() * TAU;
        s.position.set(
          p.x + Math.cos(a) * P.scale * (0.8 + Math.random()),
          p.y + (Math.random() - 0.4) * P.scale,
          p.z + Math.sin(a) * P.scale * (0.8 + Math.random()));
      }
      g.add(s);
      ghosts.push({ o: s, age: 0, ttl: 0.55 });
      last = p.clone();
    }
    if (!last) last = p.clone();
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const gh = ghosts[i];
      gh.age += dt;
      const k = Math.max(0, 1 - gh.age / gh.ttl);
      gh.o.material.opacity = gh.o.material.userData.o * k;
      if (k <= 0) {
        g.remove(gh.o);
        disposeTree(gh.o);   // 共用幾何由 toon.js markShared 註冊表跳過
        ghosts.splice(i, 1);
      }
    }
  });
}

/** slash 拳影劍氣:三日月刃波環身盤旋飛出 + 圖騰殘影(近戰增益的殺氣) */
function fxSlash(scene, effects, P) {
  const dur = 2.2;
  const g = new THREE.Group();
  const n = P.big ? 7 : 5;
  const waves = [];
  for (let i = 0; i < n; i++) {
    const w = new THREE.Mesh(PLANE, M(crescentTex(), i % 3 === 2 ? P.col2 : P.col, 0.95));
    w.visible = false;
    waves.push({
      m: w, t0: 0.15 + i * 0.18, a0: (i / n) * TAU + Math.random(),
      spin: 3.2 + Math.random() * 1.5, h: P.scale * (0.4 + Math.random() * 0.9),
      roll: (Math.random() - 0.5) * 1.2, life: 0.65,
    });
    g.add(w);
  }
  const orb = makeOrbit(P.motif, P.col, 5, P.scale * 1.2, P.scale * 0.5);
  g.add(orb.g);
  anchorCaster(g, P, -P.scale * 0.45);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P, -P.scale * 0.45);
    for (const w of waves) {
      const u = (t - w.t0) / w.life;
      if (u < 0 || u > 1) { w.m.visible = false; continue; }
      w.m.visible = true;
      const a = w.a0 + u * w.spin;
      const rr = P.scale * (0.8 + u * 3.4);
      w.m.position.set(Math.cos(a) * rr, w.h + u * P.scale * 0.5, Math.sin(a) * rr);
      // 刃面立起、朝切線方向,帶隨機滾轉
      w.m.rotation.set(0, -a + Math.PI / 2, w.roll, 'YXZ');
      const sc = P.scale * (1.1 + u * 0.9);
      w.m.scale.set(sc * 1.5, sc, 1);
      w.m.material.opacity = w.m.material.userData.o * Math.sin(Math.min(1, u) * Math.PI);
    }
    stepOrbit(orb, t * 1.5, P.scale * 0.4);
    const env = bell(t, dur, 0.1, 0.4);
    for (const it of orb.items) it.s.material.opacity = 0.9 * env;
  });
}

/** atfield 絕對領域:同心八角力場圈逐層展開 + 中央光柱(致敬 EVA) */
function fxAtfield(scene, effects, P) {
  const dur = 2.2;
  const g = new THREE.Group();
  const rings = [];
  const rv = P.scale * 2.0;
  for (let i = 0; i < 5; i++) {
    const m = flat(new THREE.Mesh(OCT, M(null, i % 2 ? P.col2 : P.col, 0.85)));
    m.position.y = 0.3 + i * P.scale * 0.5;
    rings.push({ m, t0: i * 0.14 });
    g.add(m);
  }
  const pil = pillar(P.col, P.scale * 0.5, P.scale * 3.4, 0.4);
  g.add(pil);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    for (const r of rings) {
      const u = Math.max(0, t - r.t0);
      const grow = outBack(Math.min(1, u / 0.3));
      r.m.scale.setScalar(Math.max(0.01, rv * grow * (1 + u * 0.25)));
      r.m.rotation.z += dt * 0.9;
      // 力場閃爍:高頻明滅是 AT 力場的簽名
      r.m.material.opacity = r.m.material.userData.o
        * (0.55 + 0.45 * Math.sin(t * 16 + r.t0 * 20)) * bell(t, dur, 0.1, 0.5);
    }
    pil.material.opacity = pil.material.userData.o * bell(t, dur, 0.2, 0.5);
  });
}

/** snipe 天穹狙擊:標定圈收束 → 天降狙擊光線 + 白閃(一發,只需要一發) */
function fxSnipe(scene, effects, P) {
  const rv = Math.min(Math.max((P.r || 6) * 2.5, 12), P.cap);
  const dur = 1.8;
  const g = new THREE.Group();
  const dash = flat(new THREE.Mesh(PLANE, M(dashRingTex(), P.col, 0.95)));
  const converge = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col, 0.8)));
  converge.position.y = 0.2;
  const beam = new THREE.Mesh(CYL, M(null, P.col, 0));
  beam.scale.set(P.scale * 0.16, 150, P.scale * 0.16);
  beam.position.y = 75;
  const flash = new THREE.Sprite(SPM(glowTex(), 0xffffff, 0));
  flash.scale.setScalar(0.01);
  flash.position.y = P.scale * 0.6;
  g.add(dash, converge, beam, flash);
  g.position.copy(P.at);
  g.position.y += 0.35;
  push(scene, effects, g, dur, (t, dt) => {
    dash.scale.setScalar(Math.max(0.01, rv));
    dash.rotation.z += dt * 3.2;
    converge.scale.setScalar(Math.max(0.01, rv * Math.max(0.15, 1.4 - t * 1.6)));
    const env = bell(t, dur, 0.1, 0.3);
    dash.material.opacity = dash.material.userData.o * env;
    converge.material.opacity = converge.material.userData.o * env;
    if (t >= 0.85) {                       // 擊發瞬間:光線貫落 + 白閃
      const u = Math.min(1, (t - 0.85) / 0.12);
      beam.material.opacity = 0.9 * u * Math.max(0, 1 - (t - 0.97) / 0.5);
      flash.material.opacity = Math.max(0, 1 - (t - 0.85) / 0.45);
      flash.scale.setScalar(P.scale * (1 + (t - 0.85) * 10));
    }
  });
}

/** notewave 音波詠嘆:同心聲波環週期盪開 + 圖騰環繞 + 光柱 */
function fxNotewave(scene, effects, P) {
  const rv = clampR(P, 2.6);
  const dur = 2.6;
  const g = new THREE.Group();
  const waves = [];
  for (let k = 0; k < 4; k++) {
    const w = flat(new THREE.Mesh(PLANE, M(softRingTex(), k % 2 ? P.col2 : P.col, 0.9)));
    w.position.y = 0.25 + k * 0.12;
    waves.push(w);
    g.add(w);
  }
  const orb = makeOrbit(P.motif, P.col2, 8, P.scale * 1.6, P.scale * 0.5);
  const pil = pillar(P.col, P.scale * 0.6, P.scale * 3, 0.35);
  const base = flat(new THREE.Mesh(PLANE, M(circleTex(P.motif), P.col, 0.6)));
  base.scale.setScalar(rv * 0.4);
  g.add(orb.g, pil, base);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    const env = bell(t, dur, 0.15, 0.5);
    waves.forEach((w, i) => {
      const u = ((t * 0.9 - i * 0.22) % 1 + 1) % 1;
      w.scale.setScalar(Math.max(0.01, rv * u));
      w.material.opacity = w.material.userData.o * (1 - u) * env * (t > i * 0.22 ? 1 : 0);
    });
    base.rotation.z += dt * 0.6;
    stepOrbit(orb, t, P.scale * 0.7);
    for (const it of orb.items) it.s.material.opacity = 0.9 * env;
    pil.material.opacity = pil.material.userData.o * env * (0.7 + 0.3 * Math.sin(t * 11));
    base.material.opacity = base.material.userData.o * env;
  });
}

const ARCHS = {
  circle: fxCircle, aura: fxAura, heal: fxHeal, gate: fxGate, zone: fxZone,
  bind: fxBind, veil: fxVeil, scan: fxScan, dome: fxDome, dash: fxDash,
  slash: fxSlash, atfield: fxAtfield, snipe: fxSnipe, notewave: fxNotewave,
};

// ---------------- 角色 → 招式演出指定表 ----------------
// a = 原型、m = 圖騰、c/c2 = 主/輔色覆寫(預設 = 角色 visual.hue / fx 型別輔色)。
// 主題依 lore:蜂后指揮=音符法陣、鐵證=數學符文、電波歌姬=音波束縛、
// 編號七=絕對領域、小川=拳影、無聲=一發狙擊、螢火=靈魂遊點……
const CFX = {
  // ---- 蜂群 ----
  s01: { skill: { a: 'circle', m: 'note' },               ult: { a: 'gate', m: 'hex' } },
  s02: { skill: { a: 'heal', m: 'gear', c2: 0xffb066 },   ult: { a: 'heal', m: 'gear', c2: 0xffb066 } },
  s03: { skill: { a: 'bind', m: 'circuit' },              ult: { a: 'bind', m: 'circuit' } },
  s04: { skill: { a: 'dash', m: 'claw' },                 ult: { a: 'slash', m: 'claw' } },
  s05: { skill: { a: 'aura', m: 'bolt' },                 ult: { a: 'zone', m: 'reticle' } },
  s06: { skill: { a: 'dome', m: 'wing' },                 ult: { a: 'circle', m: 'wing', c: 0xf2f6ff } },
  s07: { skill: { a: 'dome', m: 'math' },                 ult: { a: 'zone', m: 'math' } },
  s08: { skill: { a: 'heal', m: 'cross' },                ult: { a: 'notewave', m: 'cross', c: 0xffe9b8 } },
  s09: { skill: { a: 'aura', m: 'star' },                 ult: { a: 'zone', m: 'reticle' } },
  s10: { skill: { a: 'scan', m: 'circuit' },              ult: { a: 'bind', m: 'rune' } },
  s11: { skill: { a: 'aura', m: 'clock' },                ult: { a: 'heal', m: 'clock', c2: 0xd8c690 } },
  s12: { skill: { a: 'veil', m: 'rune', c: 0xc7a8ff },    ult: { a: 'scan', m: 'star' } },
  // ---- 鋼鐵 ----
  t01: { skill: { a: 'circle', m: 'frost' },              ult: { a: 'zone', m: 'frost' } },
  t02: { skill: { a: 'dash', m: 'rune' },                 ult: { a: 'atfield', m: 'hex', c: 0xffa94f } },
  t03: { skill: { a: 'dome', m: 'shield', c: 0xffa94f },  ult: { a: 'zone', m: 'flame' } },
  t04: { skill: { a: 'veil', m: 'wing' },                 ult: { a: 'aura', m: 'reticle', c: 0xff5a4a } },
  t05: { skill: { a: 'heal', m: 'gear' },                 ult: { a: 'gate', m: 'gear' } },
  t06: { skill: { a: 'dash', m: 'flame', c: 0xff7a3d },   ult: { a: 'slash', m: 'fist' } },
  t07: { skill: { a: 'veil', m: 'rune' },                 ult: { a: 'snipe', m: 'reticle', c: 0xff4a3d } },
  t08: { skill: { a: 'bind', m: 'note' },                 ult: { a: 'notewave', m: 'note' } },
  t09: { skill: { a: 'gate', m: 'poem' },                 ult: { a: 'zone', m: 'poem' } },
  t10: { skill: { a: 'dome', m: 'bolt' },                 ult: { a: 'circle', m: 'shield' } },
  t11: { skill: { a: 'circle', m: 'star' },               ult: { a: 'gate', m: 'shield' } },
  t12: { skill: { a: 'scan', m: 'star' },                 ult: { a: 'bind', m: 'rune', c: 0xc3ffc9 } },
  // ---- 傭兵 ----
  m01: { skill: { a: 'dash', m: 'wing' },                 ult: { a: 'aura', m: 'clock' } },
  m02: { skill: { a: 'dome', m: 'shield' },               ult: { a: 'circle', m: 'shield' } },
  m03: { skill: { a: 'heal', m: 'coin', c2: 0xffd75e },   ult: { a: 'heal', m: 'coin', c2: 0xffd75e } },
  m04: { skill: { a: 'veil', m: 'rune' },                 ult: { a: 'scan', m: 'reticle' } },
  m05: { skill: { a: 'bind', m: 'bolt' },                 ult: { a: 'zone', m: 'coin' } },
  m06: { skill: { a: 'gate', m: 'hex' },                  ult: { a: 'gate', m: 'wing' } },
  m07: { skill: { a: 'dome', m: 'hex' },                  ult: { a: 'zone', m: 'hex' } },
  m08: { skill: { a: 'dash', m: 'coin' },                 ult: { a: 'veil', m: 'rune' } },
};

// fx 型別 fallback(表上查無 → 依 sim 語意選原型;新增角色不會沒演出)
const ARCH_BY_FX = {
  buff: 'aura', heal: 'heal', strike: 'zone', summon: 'gate', emp: 'bind',
  vision: 'scan', stealth: 'veil', dash: 'dash', intercept: 'dome',
};
// fx 型別輔色(語意色:治療綠 / 癱瘓紫 / 增益暖白……)
const FX_ACCENT = {
  buff: 0xfff2b8, heal: 0x9dffb0, strike: 0xffb06b, summon: 0xfff2b8, emp: 0xb78aff,
  vision: 0x9adfff, stealth: 0xcfd6ff, dash: 0xffffff, intercept: 0x9adfff,
};

/**
 * 施放招式演出(戰場與展示台共用的唯一入口)。
 * @param {THREE.Scene} scene
 * @param {Array} effects  呼叫端的特效陣列({obj, ttl, fade, dispose})
 * @param {object} opts
 *   ch / slot('skill'|'ult')/ lvl / fx(sim 的 fx 型別)/ side
 *   at:THREE.Vector3 落點世界座標(y = 地面高)
 *   casterPos:() => THREE.Vector3|null 施放者即時座標(跟隨移動;迷霧看不見 → null)
 *   groundY:(x, z) => y 地面高度查詢(展示台給 () => 0)
 *   r:招式半徑(遊戲公尺;視覺會夾上限) dur:招式持續
 *   scale:機體尺度(≈ 機體實高;施放者身邊的部件大小基準)
 */
export function spawnCastFx(scene, effects, opts) {
  const conf = CFX[opts.ch]?.[opts.slot] || {};
  const fx = opts.fx || CHARACTERS[opts.ch]?.[opts.slot]?.fx;
  let arch = conf.a || ARCH_BY_FX[fx] || 'aura';
  if (!conf.a && arch === 'aura' && (opts.r || 0) > 60) arch = 'circle';   // 大範圍團隊增益 → 魔法陣
  const col = new THREE.Color(conf.c ?? CHARACTERS[opts.ch]?.visual?.hue
    ?? (opts.side ? SIDES[opts.side].color : 0xffffff));
  // 亮度保底:加法混色下暗色會消失 → 主色拉到可讀亮度
  const hsl = col.getHSL({ h: 0, s: 0, l: 0 });
  if (hsl.l < 0.55) col.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), 0.62);
  const P = {
    at: opts.at, casterPos: opts.casterPos, groundY: opts.groundY,
    r: opts.r || 0, dur: opts.dur || 0, lvl: opts.lvl || 1,
    scale: Math.max(2, opts.scale || 4),
    big: opts.slot === 'ult',
    motif: conf.m || 'rune',
    cap: opts.rvCap ?? Infinity,   // 呼叫端取景預算(展示台);戰場不設限
    col, col2: new THREE.Color(conf.c2 ?? FX_ACCENT[fx] ?? 0xffffff),
  };
  (ARCHS[arch] || fxAura)(scene, effects, P);
}
