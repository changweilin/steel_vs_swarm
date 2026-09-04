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
import { spawnParticleCast } from './castparticles.js';

const TAU = Math.PI * 2;

// 施法演出只允許一份確定性亂數：版面由 profileId 種子決定，不讀不可預測亂數。
const hashSeed = (value) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0) || 1;
};
const seeded = (value) => {
  let s = hashSeed(value);
  return () => {
    s = Math.imul(s ^ (s >>> 16), 2246822507);
    s = Math.imul(s ^ (s >>> 13), 3266489909);
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
};

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
const GLYPH_ALIAS = {
  rivet: 'gear', crucible: 'flame', whale: 'wing', spectrum: 'star', slash: 'claw',
  banner: 'shield', axiom: 'math', rose: 'star', brand: 'star', lasso: 'reticle',
  eye: 'reticle', seven: 'circuit', staff: 'fist', dragon: 'note', blueprint: 'gear',
  pterosaur: 'wing', arrow: 'reticle', chord: 'note', calligraphy: 'poem', parabola: 'math',
  arch: 'shield', whistle: 'note', network: 'circuit', bat: 'wing', moon: 'star',
  cornerstone: 'shield', alpine: 'frost', aurora: 'frost', eagle: 'wing', breaker: 'bolt',
  thunder: 'bolt', carnival: 'note', rotor: 'wing', border: 'hex', check: 'coin',
  empty_circle: 'reticle', score: 'note', anvil: 'gear', furnace: 'flame', deadline: 'claw',
  synapse: 'circuit', starfall: 'star', tally: 'clock', tomb: 'shield', proof: 'math',
  triangulation: 'math', dropship: 'cross', bell: 'note', snare: 'reticle', feather: 'wing',
  noise: 'rune', escapement: 'clock', crescent: 'star', starpath: 'star', artillery: 'frost',
  rain: 'poem', trench: 'shield', firefly: 'star', exclusion: 'hex', cloud: 'flame',
};
const STRUCTURE_ALIASES = {
  ukrainian_score:'score', forge_anvil:'anvil', leviathan_ribs:'whale', shura_deadline:'deadline',
  neon_synapse:'synapse', elegy_tally:'tally', proof_chords:'proof', krakow_rose:'rose', outback_brand:'brand',
  spectrum_feather:'feather', watch_escapement:'escapement', crimea_starpath:'starpath', ural_artillery:'artillery',
  neural_seventh:'seven', xianxia_furnace:'furnace', gru_feather:'feather', crane_blueprint:'blueprint',
  qitian_cloudstaff:'staff', pterosaur_arrow:'arrow', dragon_aria:'dragon', persian_calligraphy:'calligraphy',
  mukarnas_arch:'arch', trench_whistle:'whistle', firefly_network:'network', raven_batmoon:'moon',
  titan_strata:'strata', alpine_aurora:'aurora', steppe_eagle:'eagle', blackout_breaker:'breaker',
  carnival_rotor:'rotor', border_gate:'border', contract_empty:'empty_circle',
};
const FIELD_FORM_ALIASES = {
  score_canopy:'score', forge_battlements:'anvil', whale_ellipse:'whale', broken_frame:'deadline',
  pixel_lattice:'synapse', tomb_phalanx:'tomb', axiom_polygon:'proof', rose_vault:'rose', ranch_fence:'brand',
  negative_screen:'noise', clockwork_cage:'escapement', constellation_door:'starpath', avalanche_wedge:'artillery',
  seven_rings:'seven', cauldron_shell:'furnace', optical_cloak:'feather', assembly_gate:'blueprint', cloud_mandala:'cloud',
  needle_sight:'arrow', resonance_bowl:'dragon', ink_rain:'rain', octant_vault:'arch', sandbag_line:'trench',
  coordinate_mesh:'network', blood_moon:'moon', cornerstone_wall:'cornerstone', ice_crown:'aurora', wind_compass:'eagle',
  thunder_cage:'thunder', flightdeck_fan:'rotor', exclusion_grid:'exclusion', folded_circle:'empty_circle',
};
const STRUCTURE_NAMES = Object.freeze(Object.keys(STRUCTURE_ALIASES));
// 視覺簽名不是 alias：每個命名圖騰都先走自己的 CanvasTexture，再由舊圖騰作
// 相容 fallback。這讓 whale 的十六肋、anvil 的砧座和 rose 的窗格不會退回 rune。
const SIGNATURE_NAMES = Object.freeze([
  'note','wing','rivet','crucible','whale','spectrum','claw','slash','circuit','reticle','shield','hex','fist',
  'banner','math','cross','star','rune','gear','flame','clock','score','anvil','furnace','deadline',
  'synapse','starfall','tally','tomb','proof','triangulation','dropship','bell','brand','snare',
  'feather','noise','escapement','crescent','starpath','artillery','seven','eye','crane','blueprint',
  'cloud','staff','pterosaur','arrow','chord','dragon','calligraphy','rain','parabola','arch','trench',
  'whistle','firefly','network','bat','moon','strata','cornerstone','alpine','aurora','eagle','breaker',
  'thunder','carnival','rotor','border','exclusion','check','empty_circle','frost','bolt','coin','poem',
]);
function drawSignature(ctx, name, S) {
  name = FIELD_FORM_ALIASES[name] || STRUCTURE_ALIASES[name] || name;
  const c = S * 0.5, R = S * 0.39;
  ctx.save(); ctx.translate(c, c); ctx.strokeStyle = ctx.fillStyle = '#fff';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = S * 0.035;
  if (['hex','note','wing','math','gear','frost','star','clock','cross','reticle','bolt','coin','claw','circuit','flame','poem','shield','fist'].includes(name)) {
    drawGlyph(ctx, name, R, 3); ctx.restore(); return;
  }
  switch (name) {
    case 'whale': // 十六道鯨腹稜線 + 等深線
      ctx.lineWidth = S * 0.025; ctx.beginPath(); ctx.ellipse(0, 0, R * 1.1, R * 0.48, 0, 0, TAU); ctx.stroke();
      for (let i = 0; i < 16; i++) { const x = -R * 0.92 + i * R * 0.123;
        ctx.beginPath(); ctx.moveTo(x, -R * 0.42); ctx.quadraticCurveTo(x + R * 0.12, 0, x, R * 0.42); ctx.stroke(); }
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.ellipse(0, 0, R * (0.28 + i * 0.2), R * (0.12 + i * 0.08), 0, 0, TAU); ctx.stroke(); }
      break;
    case 'spectrum': // 低頻橢圓波
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(0, 0, R * (0.22 + i * 0.14), R * (0.12 + i * 0.08), 0, 0, TAU); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke(); break;
    case 'anvil': case 'crucible': case 'furnace':
      ctx.beginPath(); ctx.moveTo(-R * 0.72, R * 0.25); ctx.lineTo(-R * 0.42, R * 0.05); ctx.lineTo(R * 0.45, R * 0.05);
      ctx.lineTo(R * 0.72, R * 0.25); ctx.lineTo(R * 0.35, R * 0.4); ctx.lineTo(-R * 0.4, R * 0.4); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * 0.45, -R * 0.2); ctx.lineTo(R * 0.5, -R * 0.2); ctx.lineTo(R * 0.3, R * 0.05); ctx.lineTo(-R * 0.3, R * 0.05); ctx.closePath(); ctx.stroke();
      if (name !== 'anvil') { ctx.beginPath(); ctx.arc(0, -R * 0.5, R * 0.23, 0, TAU); ctx.stroke(); } break;
    case 'rivet':
      ctx.strokeRect(-R * 0.7, -R * 0.42, R * 1.4, R * 0.84);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.arc(i * R * 0.48, j * R * 0.28, R * 0.08, 0, TAU); ctx.fill(); } break;
    case 'banner':
      ctx.beginPath(); ctx.moveTo(-R * 0.55, -R * 0.8); ctx.lineTo(-R * 0.55, R * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * 0.48, -R * 0.65); ctx.lineTo(R * 0.75, -R * 0.45); ctx.lineTo(R * 0.42, 0); ctx.lineTo(R * 0.75, R * 0.45); ctx.lineTo(-R * 0.48, R * 0.65); ctx.closePath(); ctx.stroke(); break;
    case 'bell':
      ctx.beginPath(); ctx.moveTo(-R * 0.55, R * 0.48); ctx.quadraticCurveTo(-R * 0.55, -R * 0.55, 0, -R * 0.7);
      ctx.quadraticCurveTo(R * 0.55, -R * 0.55, R * 0.55, R * 0.48); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, R * 0.5, R * 0.13, 0, TAU); ctx.fill(); break;
    case 'rose': case 'rose_window':
      ctx.beginPath(); ctx.arc(0, 0, R * 0.75, 0, TAU); ctx.stroke(); for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate(i * TAU / 8); ctx.beginPath(); ctx.arc(0, -R * 0.38, R * 0.28, 0, TAU); ctx.stroke(); ctx.restore(); } break;
    case 'slash': case 'deadline':
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-R * 0.7, i * R * 0.3 + R * 0.6); ctx.lineTo(R * 0.7, i * R * 0.3 - R * 0.6); ctx.stroke(); } break;
    case 'artillery': case 'arrow': case 'parabola':
      ctx.beginPath(); ctx.moveTo(-R * 0.85, R * 0.55); ctx.quadraticCurveTo(0, -R * 0.85, R * 0.78, R * 0.35); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(R * 0.78, R * 0.35); ctx.lineTo(R * 0.46, R * 0.22); ctx.moveTo(R * 0.78, R * 0.35); ctx.lineTo(R * 0.62, R * 0.05); ctx.stroke(); break;
    case 'thunder': case 'breaker':
      ctx.beginPath(); ctx.moveTo(-R * 0.15, -R * 0.85); ctx.lineTo(-R * 0.5, -R * 0.05); ctx.lineTo(-R * 0.08, -R * 0.05);
      ctx.lineTo(-R * 0.32, R * 0.85); ctx.lineTo(R * 0.52, -R * 0.25); ctx.lineTo(R * 0.12, -R * 0.25); ctx.closePath(); ctx.stroke(); break;
    case 'border': case 'exclusion':
      ctx.strokeRect(-R * 0.72, -R * 0.72, R * 1.44, R * 1.44); for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-R * 0.7, i * R * 0.35); ctx.lineTo(R * 0.7, i * R * 0.35); ctx.moveTo(i * R * 0.35, -R * 0.7); ctx.lineTo(i * R * 0.35, R * 0.7); ctx.stroke(); } break;
    case 'empty_circle': case 'check':
      ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, TAU); ctx.stroke(); if (name === 'check') { ctx.beginPath(); ctx.moveTo(-R * 0.42, 0); ctx.lineTo(-R * 0.08, R * 0.35); ctx.lineTo(R * 0.56, -R * 0.42); ctx.stroke(); } break;
    case 'noise': case 'spectrum':
      for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(-R * 0.78, i * R * 0.17); ctx.lineTo(R * 0.78, i * R * 0.17 + (i % 2) * R * 0.08); ctx.stroke(); } break;
    default: { // 尚未具象化的低頻語意仍須有獨特徽記，禁止全部退成同一個圓圈＋X。
      const rand = seeded(`signature:${name}`);
      const n = 5 + Math.floor(rand() * 4);
      const points = [];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * TAU / n;
        const rr = R * (0.52 + rand() * 0.27);
        points.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath(); ctx.stroke();
      const step = 2 + Math.floor(rand() * Math.max(1, n - 3));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const [x, y] = points[(i * step) % n];
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
      const bars = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < bars; i++) {
        const y = (i - (bars - 1) / 2) * R * 0.28;
        ctx.beginPath(); ctx.moveTo(-R * (0.25 + rand() * 0.25), y);
        ctx.lineTo(R * (0.25 + rand() * 0.25), y + (rand() - 0.5) * R * 0.18); ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}
function signatureTex(name) {
  return cached(`sig:${name}`, 128, (ctx, S) => drawSignature(ctx, name, S));
}

/**
 * 文化框架只採建築、工藝與民俗的幾何語彙，不畫經文或神祇肖像。
 * 同一框架仍會疊該招 tellShape，因此「同國角色」也不會共用完整圖案。
 */
function drawCultureFrame(ctx, frame, S) {
  const c = S / 2, R = S * 0.43;
  ctx.save(); ctx.translate(c, c);
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = S * 0.018;
  const ring = (r, w = 1) => { ctx.lineWidth = S * 0.018 * w; ctx.beginPath(); ctx.arc(0, 0, R * r, 0, TAU); ctx.stroke(); };
  const polygon = (n, r, rot = -Math.PI / 2) => { poly(ctx, n, R * r, rot); ctx.stroke(); };
  const spokes = (n, r0 = 0.62, r1 = 0.95) => {
    for (let i = 0; i < n; i++) { const a = i * TAU / n;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * r0, Math.sin(a) * R * r0);
      ctx.lineTo(Math.cos(a) * R * r1, Math.sin(a) * R * r1); ctx.stroke(); }
  };
  switch (frame) {
    case 'baroque':
      ring(0.96); ring(0.70, 0.6);
      for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate(i * TAU / 8); ctx.beginPath();
        ctx.moveTo(0, -R * 0.68); ctx.bezierCurveTo(R * 0.26, -R * 0.82, R * 0.22, -R, 0, -R * 1.03); ctx.stroke(); ctx.restore(); }
      break;
    case 'rivet':
      polygon(8, 0.96); polygon(8, 0.72, -Math.PI / 8); spokes(8);
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84, S * 0.025, 0, TAU); ctx.fill(); }
      break;
    case 'tao_cloud':
      ring(0.94); ring(0.55, 0.6); spokes(8, 0.56, 0.88);
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.beginPath();
        ctx.moveTo(-R * 0.36, -R * 0.72); ctx.bezierCurveTo(-R * 0.10, -R, R * 0.15, -R * 0.58, R * 0.42, -R * 0.78); ctx.stroke(); ctx.restore(); }
      break;
    case 'torii':
      polygon(4, 0.92, Math.PI / 4); ring(0.64, 0.6);
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.fillRect(-R * 0.38, -R * 0.91, R * 0.76, S * 0.028); ctx.fillRect(-R * 0.24, -R * 0.82, R * 0.48, S * 0.018); ctx.restore(); }
      break;
    case 'cyber':
      polygon(6, 0.96); polygon(3, 0.60); spokes(6, 0.62, 0.91);
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78, S * 0.027, 0, TAU); ctx.fill(); }
      break;
    case 'jazz':
      ring(0.94); for (let i = -3; i <= 3; i++) { const x = i * R * 0.22; ctx.beginPath();
        ctx.moveTo(x, -R * (i % 2 ? 0.92 : 0.72)); ctx.lineTo(x + R * 0.12, R * (i % 3 ? 0.82 : 0.58)); ctx.stroke(); }
      break;
    case 'hexstar':
      ring(0.96); polygon(6, 0.82); polygon(3, 0.70); polygon(3, 0.70, Math.PI / 2); spokes(12, 0.84, 0.95);
      break;
    case 'gothic':
      ring(0.97); ring(0.70, 0.6);
      for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i * TAU / 12); ctx.beginPath();
        ctx.moveTo(0, -R * 0.28); ctx.quadraticCurveTo(R * 0.30, -R * 0.55, 0, -R * 0.86); ctx.quadraticCurveTo(-R * 0.30, -R * 0.55, 0, -R * 0.28); ctx.stroke(); ctx.restore(); }
      break;
    case 'frontier':
      polygon(8, 0.96); spokes(16, 0.76, 0.96); ring(0.60, 0.6);
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -R * 0.58); ctx.lineTo(R * 0.16, -R * 0.88); ctx.lineTo(-R * 0.16, -R * 0.88); ctx.closePath(); ctx.stroke(); ctx.restore(); }
      break;
    case 'runic':
      polygon(12, 0.96); ring(0.66, 0.5); spokes(12, 0.68, 0.92);
      for (let i = 0; i < 6; i++) { ctx.save(); ctx.rotate(i * TAU / 6); ctx.beginPath(); ctx.moveTo(-R * 0.08, -R * 0.72); ctx.lineTo(R * 0.10, -R * 0.84); ctx.lineTo(-R * 0.04, -R * 0.94); ctx.stroke(); ctx.restore(); }
      break;
    case 'clockwork':
      ring(0.96); ring(0.74, 0.7); spokes(12, 0.72, 0.94);
      for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i * TAU / 12); ctx.fillRect(-S * 0.018, -R, S * 0.036, R * 0.14); ctx.restore(); }
      break;
    case 'girih':
      polygon(10, 0.96); polygon(5, 0.76); polygon(5, 0.76, Math.PI / 2); spokes(10, 0.42, 0.94); ring(0.40, 0.5);
      break;
    case 'constructivist':
      polygon(4, 0.92, Math.PI / 4); for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(-R * 0.86, i * R * 0.28); ctx.lineTo(R * 0.86, i * R * 0.28 - R * 0.42); ctx.stroke(); }
      break;
    case 'trench':
      polygon(6, 0.95); ctx.beginPath(); ctx.moveTo(-R * 0.88, -R * 0.36); ctx.lineTo(-R * 0.44, -R * 0.10); ctx.lineTo(-R * 0.12, -R * 0.42);
      ctx.lineTo(R * 0.22, R * 0.08); ctx.lineTo(R * 0.72, -R * 0.10); ctx.lineTo(R * 0.88, R * 0.35); ctx.stroke(); break;
    case 'folklore':
      ring(0.96); for (let i = 0; i < 12; i++) { const a = i * TAU / 12, r = i % 2 ? 0.62 : 0.90; ctx.beginPath(); ctx.arc(Math.cos(a) * R * r, Math.sin(a) * R * r, S * (i % 2 ? 0.018 : 0.032), 0, TAU); ctx.fill(); } break;
    case 'citadel':
      polygon(8, 0.96); polygon(8, 0.72, Math.PI / 8); for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate(i * TAU / 8); ctx.strokeRect(-R * 0.09, -R * 0.97, R * 0.18, R * 0.22); ctx.restore(); } break;
    case 'alpine':
      polygon(6, 0.96); ctx.beginPath(); ctx.moveTo(-R * 0.92, R * 0.55); ctx.lineTo(-R * 0.38, -R * 0.50); ctx.lineTo(-R * 0.08, -R * 0.05); ctx.lineTo(R * 0.30, -R * 0.72); ctx.lineTo(R * 0.92, R * 0.55); ctx.stroke(); spokes(6, 0.68, 0.94); break;
    case 'tengri':
      ring(0.96); ring(0.32, 0.7); spokes(16, 0.35, 0.67); for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.beginPath(); ctx.arc(0, -R * 0.79, R * 0.18, 0.1, Math.PI - 0.1); ctx.stroke(); ctx.restore(); } break;
    case 'storm':
      polygon(6, 0.96); for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * R * 0.22, -R * 0.86); ctx.lineTo((i - 1) * R * 0.18, -R * 0.08); ctx.lineTo((i + 0.5) * R * 0.12, R * 0.10); ctx.lineTo(i * R * 0.18, R * 0.86); ctx.stroke(); } break;
    case 'carnival':
      ring(0.94); for (let i = 0; i < 14; i++) { ctx.save(); ctx.rotate(i * TAU / 14); ctx.beginPath(); ctx.moveTo(0, -R * 0.40); ctx.quadraticCurveTo(R * 0.22, -R * 0.72, 0, -R); ctx.quadraticCurveTo(-R * 0.22, -R * 0.72, 0, -R * 0.40); ctx.stroke(); ctx.restore(); } break;
    case 'stepped':
      polygon(4, 0.96, Math.PI / 4); for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.beginPath(); ctx.moveTo(-R * 0.58, -R * 0.74); ctx.lineTo(-R * 0.18, -R * 0.74); ctx.lineTo(-R * 0.18, -R * 0.58); ctx.lineTo(R * 0.24, -R * 0.58); ctx.lineTo(R * 0.24, -R * 0.42); ctx.lineTo(R * 0.62, -R * 0.42); ctx.stroke(); ctx.restore(); } break;
    case 'mandala':
      ring(0.96); ring(0.50, 0.5); for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i * TAU / 12); ctx.beginPath(); ctx.moveTo(0, -R * 0.32); ctx.quadraticCurveTo(R * 0.32, -R * 0.62, 0, -R * 0.92); ctx.quadraticCurveTo(-R * 0.32, -R * 0.62, 0, -R * 0.32); ctx.stroke(); ctx.restore(); } break;
    default: ring(0.96); polygon(6, 0.72); spokes(12, 0.74, 0.94);
  }
  ctx.restore();
}

/** 每招一張文化法陣白稿；64 × 256² 約 16 MiB，上限固定且全場快取共用。 */
function culturalSealTex(P) {
  const key = `culture:${P.profile.profileId}:${P.profile.frame}`;
  return cached(key, 256, (ctx, S) => {
    drawCultureFrame(ctx, P.profile.frame, S);
    ctx.save(); ctx.translate(S * 0.22, S * 0.22);
    drawSignature(ctx, P.profile.tellShape, S * 0.56);
    ctx.restore();
  });
}
function glyphTex(motif, i = 0) {
  if (SIGNATURE_NAMES.includes(motif) || STRUCTURE_NAMES.includes(motif)) return signatureTex(motif);
  const base = GLYPH_ALIAS[motif] || motif;
  const vi = (base === 'math' || base === 'rune') ? i : 0;
  return cached(`g:${motif}:${vi}`, 96, (ctx, S) => {
    ctx.translate(S / 2, S / 2);
    drawGlyph(ctx, base, S * 0.42, vi);
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
const BOX = markShared(new THREE.BoxGeometry(1, 1, 0.08));                                // 盾牆／門框薄板
const SPIRE = markShared(new THREE.ConeGeometry(1, 1, 4, 1, true));                       // 冰冠／祭柱尖塔

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
const ease01 = (p) => p * p * (3 - 2 * p);
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
// 狀態可以維持 6–12 秒，施放物件只演短促四拍；若權威持續時間更短則提早收掉。
// 這避免多人連續施放時，把每招 3–7 個透明層一路堆到整段增益結束。
const fxDur = (P, fallback) => Math.min(fallback, P.dur > 0 ? P.dur : fallback);
const SHAPE_MODE = {
  score:1, anvil:2, whale:3, arrow:1, deadline:6, synapse:4, starfall:7, tally:5,
  tomb:6, proof:3, triangulation:7, dropship:4, bell:5, brand:1, snare:7, feather:3,
  noise:6, escapement:5, crescent:1, starpath:7, banner:6, artillery:7, seven:4,
  furnace:2, eye:1, crane:5, blueprint:6, cloud:1, staff:2, pterosaur:3, dragon:7,
  chord:6, calligraphy:1, rain:7, parabola:3, arch:5, trench:6, whistle:1,
  firefly:4, network:7, bat:3, moon:5, strata:2, cornerstone:6, alpine:3, aurora:7,
  eagle:1, breaker:6, thunder:7, carnival:1, rotor:4, border:5, exclusion:7,
  check:3, empty_circle:5,
};
const LAYOUT_SCALE = { spiral:1.0, airline:1.15, weld:0.72, streams:1.25, ears:0.86, ribs:1.4,
  thrust:1.35, frame:1.05, chain:0.78, funnel:1.3, dome:1, phalanx:1.2, chord:0.9,
  inverse:1.3, pillar:0.72, rose:1.12, track:1.4, net:1.3, wing:1.1, waterfall:1.5,
  gear:0.9, explode:1.35, starpath:1.2, door:1, arrowline:1.4, azimuth:1.3, nodes:0.8,
  rings:1.15, rows:1.05, cone:1.3, joints:0.85, assembly:1.35, sweep:1.25, split:1.1,
  membrane:1, needle:1.45, bars:1.1, throat:1.3, ribbons:1.2, cloud:1.3, mirror:1.1,
  octant:1.25, contour:1, bands:1.15, compass:1.4, switches:1, columns:1.2, flightdeck:1.4,
  gates:1.2, grid:1.45, fold:0.75, negative:0.95, vortex:1.35, pillars:1.05, walls:1.2,
  curtains:1.4, wind:1.2, feast:1.1, wings:1.1,
};
// 佈局除了尺度還指定平面朝向；值是程序材質的展示參數，不是命中半徑。
const LAYOUT_STYLE = {
  spiral:0.2, airline:0, weld:1.57, streams:0.35, ears:1.57, ribs:0, thrust:0, frame:0.78,
  chain:1.57, funnel:0, dome:0, phalanx:1.57, chord:0.35, inverse:0.78, pillar:0,
  rose:0, track:0, net:0.78, wing:1.57, waterfall:1.57, gear:0, explode:0.4,
  starpath:0.35, door:1.57, arrowline:0, azimuth:0, nodes:0.78, rings:0, rows:1.57,
  cone:0, joints:1.57, assembly:0.78, sweep:0, split:1.57, membrane:0.35, needle:0,
  bars:1.57, throat:0, ribbons:0.35, cloud:0.78, mirror:0, octant:0, contour:0,
  bands:1.57, compass:0, switches:1.57, columns:0, flightdeck:0.78, gates:0, grid:0,
  fold:0.78, negative:0, vortex:0.35, pillars:1.57, walls:0, curtains:0.35, wind:0,
  feast:0.78, wings:1.57,
};
// 機體文化層：主色仍來自 CHARACTERS.visual.hue，這裡只提供不影響權威的
// 輔色與場域結構。shieldForm 每台機體唯一，禁止所有防護場域退回同一穹頂。
const CULTURAL_PALETTES = {
  s01:{culture:'烏克蘭軍樂', accent:0xf4c542, structure:'ukrainian_score', shieldForm:'score_canopy'},
  s02:{culture:'工業鍛造', accent:0xff7b35, structure:'forge_anvil', shieldForm:'forge_battlements'},
  s03:{culture:'台灣利維坦深海', accent:0x8ce7ee, structure:'leviathan_ribs', shieldForm:'whale_ellipse'},
  s04:{culture:'日本修羅軍刀', accent:0xff4747, structure:'shura_deadline', shieldForm:'broken_frame'},
  s05:{culture:'競速神經電競', accent:0x47d9ff, structure:'neon_synapse', shieldForm:'pixel_lattice'},
  s06:{culture:'追悼護航拱券', accent:0xcfd6ff, structure:'elegy_tally', shieldForm:'tomb_phalanx'},
  s07:{culture:'白板數學證明', accent:0xffc857, structure:'proof_chords', shieldForm:'axiom_polygon'},
  s08:{culture:'克拉科夫晨鐘', accent:0xb8ffbe, structure:'krakow_rose', shieldForm:'rose_vault'},
  s09:{culture:'澳洲牧場獵巡', accent:0xe49b52, structure:'outback_brand', shieldForm:'ranch_fence'},
  s10:{culture:'終端始祖翼陣', accent:0xd8ff9f, structure:'spectrum_feather', shieldForm:'negative_screen'},
  s11:{culture:'德國精密錶芯', accent:0xd8c690, structure:'watch_escapement', shieldForm:'clockwork_cage'},
  s12:{culture:'克里米亞星圖', accent:0xc7a8ff, structure:'crimea_starpath', shieldForm:'constellation_door'},
  t01:{culture:'烏拉爾閱兵砲兵', accent:0xff5b4d, structure:'ural_artillery', shieldForm:'avalanche_wedge'},
  t02:{culture:'神經同步科幻', accent:0xd89cff, structure:'neural_seventh', shieldForm:'seven_rings'},
  t03:{culture:'中式熔爐神話', accent:0xffa94f, structure:'xianxia_furnace', shieldForm:'cauldron_shell'},
  t04:{culture:'格魯烏灰雁', accent:0x8294a8, structure:'gru_feather', shieldForm:'optical_cloak'},
  t05:{culture:'兵工重工生產線', accent:0xf0d27c, structure:'crane_blueprint', shieldForm:'assembly_gate'},
  t06:{culture:'齊天筋斗雲', accent:0xffc83d, structure:'qitian_cloudstaff', shieldForm:'cloud_mandala'},
  t07:{culture:'翼龍終結狙擊', accent:0xc9b6ff, structure:'pterosaur_arrow', shieldForm:'needle_sight'},
  t08:{culture:'聲電神龍', accent:0xff65d2, structure:'dragon_aria', shieldForm:'resonance_bowl'},
  t09:{culture:'波斯火箭哀歌', accent:0xc49a5a, structure:'persian_calligraphy', shieldForm:'ink_rain'},
  t10:{culture:'穆卡納斯庇護所', accent:0x6fe4c9, structure:'mukarnas_arch', shieldForm:'octant_vault'},
  t11:{culture:'戰壕老兵', accent:0xb7a27a, structure:'trench_whistle', shieldForm:'sandbag_line'},
  t12:{culture:'螢火神經悼亡', accent:0xbaff67, structure:'firefly_network', shieldForm:'coordinate_mesh'},
  m01:{culture:'哥德渡鴉血月', accent:0xff435f, structure:'raven_batmoon', shieldForm:'blood_moon'},
  m02:{culture:'泰坦岩層誓約', accent:0xd4aa70, structure:'titan_strata', shieldForm:'cornerstone_wall'},
  m03:{culture:'阿爾卑斯極光', accent:0x79f5d0, structure:'alpine_aurora', shieldForm:'ice_crown'},
  m04:{culture:'蒙古金鵰草原', accent:0xd9b45b, structure:'steppe_eagle', shieldForm:'wind_compass'},
  m05:{culture:'工業斷路雷刑', accent:0xb58aff, structure:'blackout_breaker', shieldForm:'thunder_cage'},
  m06:{culture:'巴西嘉年華艦隊', accent:0x54e8a3, structure:'carnival_rotor', shieldForm:'flightdeck_fan'},
  m07:{culture:'邊境界碑拒止', accent:0x62e9ff, structure:'border_gate', shieldForm:'exclusion_grid'},
  m08:{culture:'合約刺客水墨', accent:0xd0b36a, structure:'contract_empty', shieldForm:'folded_circle'},
};
// 文化外框決定法陣的建築／工藝語彙；角色技能簽名再疊於其上，避免同文化複製貼上。
const CULTURE_FRAME = {
  s01:'baroque', s02:'rivet', s03:'tao_cloud', s04:'torii', s05:'cyber', s06:'jazz',
  s07:'hexstar', s08:'gothic', s09:'frontier', s10:'runic', s11:'clockwork', s12:'girih',
  t01:'constructivist', t02:'cyber', t03:'tao_cloud', t04:'constructivist', t05:'rivet', t06:'tao_cloud',
  t07:'torii', t08:'tao_cloud', t09:'girih', t10:'girih', t11:'trench', t12:'folklore',
  m01:'gothic', m02:'citadel', m03:'alpine', m04:'tengri', m05:'storm', m06:'carnival',
  m07:'stepped', m08:'mandala',
};
// 每種世界佈局都有結構型，不單靠縮放冒充不同場域。
const LAYOUT_STRUCTURE = {
  spiral:'score', airline:'banner', weld:'anvil', streams:'furnace', ears:'whale', ribs:'spectrum',
  thrust:'arrow', frame:'deadline', chain:'synapse', funnel:'starfall', dome:'tally', phalanx:'tomb',
  chord:'proof', inverse:'triangulation', pillar:'dropship', rose:'bell', track:'brand', net:'snare',
  wing:'feather', waterfall:'noise', gear:'escapement', explode:'escapement', starpath:'crescent', door:'arch',
  arrowline:'banner', azimuth:'artillery', nodes:'seven', rings:'seven', rows:'trench', cone:'eye', joints:'crane',
  assembly:'blueprint', sweep:'cloud', split:'staff', membrane:'pterosaur', needle:'arrow', bars:'chord', throat:'dragon',
  ribbons:'calligraphy', cloud:'rain', mirror:'parabola', octant:'arch', contour:'alpine', bands:'firefly', compass:'eagle',
  switches:'breaker', columns:'thunder', flightdeck:'rotor', gates:'border', grid:'exclusion', fold:'check', negative:'empty_circle',
  vortex:'furnace', pillars:'strata', walls:'cornerstone', curtains:'aurora', wind:'eagle', feast:'moon', wings:'bat',
};
// 運動表直接改變簽名層的路徑/包絡；每個名稱都來自 ability-vfx-direction.md。
const MOTION_STYLE = {
  chase:{x:1,z:0}, lift:{y:1}, inward:{scale:-1}, flow:{x:0.4,z:0.2}, close:{scale:-1}, outward:{scale:1},
  forward:{x:1}, pulse:{pulse:1}, dive:{x:0.4,y:-1}, stitch:{y:0.4}, lock:{scale:-1}, solve:{scale:-1}, fold:{scale:-1},
  drop:{y:-1}, threebeat:{pulse:1}, advance:{x:1}, shrink:{scale:-1}, scan:{x:0.3}, erase:{scale:-1}, step:{pulse:1},
  rewind:{x:-0.3}, veil:{scale:-1}, reconnect:{x:0.3}, march:{x:1}, fall:{y:-1}, blink:{pulse:1}, align:{scale:-1},
  cool:{scale:-1}, search:{x:0.5}, repair:{scale:1}, descend:{y:-1}, land:{y:0.2}, slam:{y:-1}, fracture:{scale:1}, charge:{scale:1},
  resonate:{pulse:1}, write:{x:0.4}, converge:{scale:-1}, rise:{y:1}, guide:{x:0.3}, reveal:{scale:1}, orbit:{x:0.2},
  cover:{scale:-1}, cross:{x:0.4}, tilt:{x:1}, reconnecting:{x:0.2}, s:{x:0.7},
};
const CONTACT_STYLE = {
  reverse:'snap', impact:'flash', steam:'fade', silence:'blackout', noise:'fade', stab:'flash', break:'split', dive:'flash',
  multi:'pulse', spark:'flash', divert:'split', close:'snap', scatter:'split', renew:'pulse', jump:'flash', reel:'snap',
  scan:'flash', blackout:'blackout', lock:'snap', restore:'snap', drift:'fade', return:'snap', fan:'split', avalanche:'flash',
  slit:'split', seal:'snap', ram:'flash', pressure:'snap', delete:'blackout', pierce:'flash', fracture:'split', negative:'blackout',
  gate:'snap', inkburst:'flash', hourglass:'snap', deflect:'split', gap:'split', advance:'flash', reveal:'flash', extinguish:'blackout',
  tear:'split', dust:'fade', stress:'snap', crystal:'flash', crown:'pulse', fade:'blackout', mark:'flash', crawl:'split', fold:'snap',
  deploy:'snap', barrage:'flash', confirm:'flash', cut:'split', land:'flash', crack:'split', tilt:'split', strike:'flash', pressureWave:'pulse',
};

/**
 * 全招式共用的接觸節拍:短促收束後釋放，讓不同原型仍共享「蓄勢→命中→餘韻」語法。
 * 尺寸只綁機體尺度，不冒充範圍判定；單一共享平面使每次施放只增加一個 draw call。
 */
function fxCastBeat(scene, effects, P) {
  // 共享四拍節奏，但 Tell/Release 的輪廓由 profile mode 決定；只有 mode 0 使用環，
  // 其餘是刀路、十字、楔形、節點、垂直柵與半穹頂，避免所有招式先畫同一枚圓環。
  const mode = SHAPE_MODE[P.profile.tellShape] ?? 0;
  const layoutScale = LAYOUT_SCALE[P.profile.layout] ?? 1;
  const layoutTurn = LAYOUT_STYLE[P.profile.layout] ?? 0;
  const motion = MOTION_STYLE[P.profile.motion] ?? {};
  const contact = CONTACT_STYLE[P.profile.contact] ?? 'fade';
  const rv = Math.min(P.cap, P.scale * (P.big ? 2.8 : 1.9));
  const g = new THREE.Group();
  const parts = [];
  const addFlat = (map, color, opacity = 0.82) => {
    const m = flat(new THREE.Mesh(PLANE, M(map, color, opacity)));
    m.userData.noOutline = true;
    g.add(m); parts.push(m); return m;
  };
  if (mode === 0) addFlat(signatureTex(P.profile.tellShape), P.col, P.big ? 0.9 : 0.72);
  else if (mode === 1) {
    const m = addFlat(signatureTex(P.profile.tellShape), P.col2, 0.88); m.rotation.z = Math.PI / 2;
    m.scale.set(1.9, 0.32, 1);
  } else if (mode === 2) {
    const a = addFlat(pillarTex(), P.col, 0.68); a.scale.set(0.14, 1.7, 1);
    const b = addFlat(pillarTex(), P.col2, 0.62); b.scale.set(1.7, 0.14, 1); b.rotation.z = Math.PI / 2;
  } else if (mode === 3) {
    const m = addFlat(signatureTex(P.profile.tellShape), P.col, 0.82); m.scale.set(1.2, 0.52, 1);
    const n = addFlat(signatureTex(P.profile.accentMotif), P.col2, 0.9); n.scale.setScalar(0.5);
  } else if (mode === 4) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(CYL, M(pillarTex(), i === 1 ? P.col2 : P.col, 0.7));
      m.position.set((i - 1) * P.scale * 0.55, P.scale * 0.55, 0);
      m.scale.set(P.scale * 0.08, P.scale * (0.5 + i * 0.2), P.scale * 0.08);
      m.userData.noOutline = true; g.add(m); parts.push(m);
    }
  } else if (mode === 5) {
    const m = flat(new THREE.Mesh(PLANE, M(signatureTex(P.profile.tellShape), P.col, 0.88)));
    m.scale.setScalar(0.85); m.userData.noOutline = true; g.add(m); parts.push(m);
    const n = addFlat(glyphTex(P.profile.accentMotif, P.variant), P.col2, 0.86); n.scale.setScalar(0.52);
  } else if (mode === 6) {
    for (let i = 0; i < 4; i++) {
      const m = addFlat(pillarTex(), i % 2 ? P.col2 : P.col, 0.62);
      m.scale.set(0.08, 1.2 + i * 0.18, 1); m.position.x = (i - 1.5) * P.scale * 0.36;
    }
  } else {
    const m = new THREE.Mesh(DOME, M(hexPatRepeat(3, 2), P.col, 0.36));
    m.scale.setScalar(0.95); m.userData.noOutline = true; g.add(m); parts.push(m);
  }
  if (mode === 2 || mode === 4 || mode === 6 || mode === 7) {
    const semantic = addFlat(signatureTex(P.profile.tellShape), P.col2, 0.56);
    semantic.scale.setScalar(0.68);
  }
  g.position.copy(P.at); g.position.y += 0.08;
  push(scene, effects, g, Math.min(P.dur || (P.big ? 0.46 : 0.34), P.big ? 0.46 : 0.34), (t, dt) => {
    const p = Math.max(0, Math.min(1, t / (P.big ? 0.46 : 0.34)));
    const s = p < 0.22 ? 0.58 - ease01(p / 0.22) * 0.40 : 0.18 + ease01((p - 0.22) / 0.78) * 0.96;
    g.position.copy(P.at); g.position.y += 0.08;
    g.rotation.y = P.phase + layoutTurn + p * (motion.pulse ? 0.9 : 0.35);
    for (const part of parts) {
      part.material.opacity = part.material.userData.o * (p < 0.22 ? 0.72 : 1 - p);
    }
    const pulse = motion.pulse ? 1 + Math.sin(p * Math.PI * 4) * 0.12 : 1;
    const collapse = motion.scale === -1 ? 1 - p * 0.55 : 1;
    const release = contact === 'blackout' ? Math.max(0, 1 - Math.max(0, p - 0.62) / 0.18) : 1;
    const split = contact === 'split' ? 1 + Math.max(0, p - 0.62) * 0.9 : 1;
    const contactBeat = p > 0.62 && contact === 'flash' ? 1 + Math.max(0, 1 - (p - 0.62) / 0.22) * 0.65
      : p > 0.62 && contact === 'snap' ? 0.76 + Math.min(1, (p - 0.62) / 0.12) * 0.24
      : p > 0.62 && contact === 'pulse' ? 1 + Math.sin((p - 0.62) * 28) * 0.18 : 1;
    g.scale.setScalar(rv * s * layoutScale * pulse * collapse * release * contactBeat);
    g.position.x += (motion.x || 0) * p * P.scale * 0.55;
    g.position.y += (motion.y || 0) * (1 - p) * P.scale * 0.45;
    g.position.z += (motion.z || 0) * p * P.scale * 0.35;
    g.rotation.x = (motion.y || 0) * p * 0.25;
    g.rotation.z += (motion.x || 0) * p * 0.4;
    if (split !== 1) g.rotation.z += (split - 1) * 0.35;
  });
}

/** 環繞 sprite 群(元素環繞/音符/雪花……) */
function makeOrbit(motif, col, n, R, size, rand = seeded(`orbit:${motif}:${n}`)) {
  const g = new THREE.Group();
  const items = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(SPM(glyphTex(motif, i), col, 0.9));
    s.scale.setScalar(size * (0.75 + rand() * 0.5));
    g.add(s);
    items.push({
      s,
      ph: (i / n) * TAU + rand() * 0.4,
      spd: (2.0 + rand() * 1.4) * (rand() < 0.5 ? 1 : -1),   // 確定性正反向 = 雙向交錯
      rr: R * (0.85 + rand() * 0.35),
      h0: rand() * 0.6,
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
function risingPoints(motif, col, n, R, size, rand = seeded(`points:${motif}:${n}`)) {
  const pos = new Float32Array(n * 3);
  const dat = [];
  for (let i = 0; i < n; i++) {
    const a = rand() * TAU, rr = Math.sqrt(rand()) * R;
    pos[i * 3] = Math.cos(a) * rr;
    pos[i * 3 + 1] = rand() * 0.8;
    pos[i * 3 + 2] = Math.sin(a) * rr;
    dat.push({ v: 2.2 + rand() * 2.6, sw: (rand() - 0.5) * 1.6 });
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

/** 固定數量的共享幾何實例；矩陣只在建立時寫入，逐幀僅動父群組。 */
function instances(geo, mat, count, place) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    place(dummy, i, count);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.noOutline = true;
  return mesh;
}

/**
 * 法陣的立體冠層：拱券文化用直立門片、機械文化用節點柱、自然／神話文化用尖塔。
 * 每次施放只增加一個 instanced draw call，且不修改招式半徑。
 */
function culturalCrown(P, rv) {
  const g = new THREE.Group();
  const frame = P.profile.frame;
  const arch = new Set(['baroque','torii','hexstar','gothic','girih','citadel','stepped','mandala']);
  const machine = new Set(['rivet','cyber','clockwork','constructivist','storm']);
  const n = P.big ? 8 : 6;
  let mesh;
  if (arch.has(frame)) {
    mesh = instances(BOX, M(signatureTex(P.profile.structure), P.col2, 0.52), n, (d, i, count) => {
      const a = i * TAU / count;
      d.position.set(Math.cos(a) * rv * 0.68, rv * 0.23, Math.sin(a) * rv * 0.68);
      d.rotation.y = Math.PI / 2 - a;
      d.scale.set(rv * 0.22, rv * 0.46, 1);
    });
  } else if (machine.has(frame)) {
    mesh = instances(CYL, M(pillarTex(), P.col2, 0.42), n, (d, i, count) => {
      const a = i * TAU / count;
      d.position.set(Math.cos(a) * rv * 0.68, rv * (0.16 + (i % 2) * 0.12), Math.sin(a) * rv * 0.68);
      d.scale.set(rv * 0.055, rv * (0.32 + (i % 2) * 0.24), rv * 0.055);
    });
  } else {
    mesh = instances(SPIRE, M(signatureTex(P.profile.structure), P.col2, 0.46), n, (d, i, count) => {
      const a = i * TAU / count;
      d.position.set(Math.cos(a) * rv * 0.68, rv * 0.20, Math.sin(a) * rv * 0.68);
      d.rotation.y = -a;
      d.scale.set(rv * 0.10, rv * (0.38 + (i % 3) * 0.11), rv * 0.10);
    });
  }
  g.add(mesh);
  return g;
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
  const dur = fxDur(P, P.big ? 2.6 : 2.0);
  const g = new THREE.Group();
  const main = flat(new THREE.Mesh(PLANE, M(culturalSealTex(P), P.col, 0.95)));
  const inner = flat(new THREE.Mesh(PLANE, M(signatureTex(P.profile.layoutStructure), P.col2, 0.7)));
  inner.position.y = 0.25;
  const crown = culturalCrown(P, rv);
  const pil = pillar(P.col, rv * 0.30, P.scale * (P.big ? 3.2 : 2.2), 0.30);
  const orb = makeOrbit(P.profile.accentMotif, P.col2, P.big ? 6 + P.variant % 5 : 4 + P.variant % 3,
    rv * (0.58 + (P.variant % 4) * 0.06), P.scale * (0.30 + (P.variant % 3) * 0.04), P.rand);
  g.add(main, inner, crown, pil, orb.g);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    const grow = outBack(Math.min(1, t / 0.4));
    main.scale.setScalar(Math.max(0.01, rv * grow));
    inner.scale.setScalar(Math.max(0.01, rv * 0.55 * grow));
    main.rotation.z += dt * (0.35 + P.profile.tempo * 0.24);
    inner.rotation.z -= dt * (0.75 + P.profile.tempo * 0.4);
    crown.rotation.y += dt * (0.22 + P.profile.tempo * 0.12);
    crown.scale.y = 0.72 + 0.28 * grow;
    stepOrbit(orb, t, P.scale * 0.55);
    fadeAll(g, bell(t, dur));
    pil.material.opacity *= 0.75 + 0.25 * Math.sin(t * 9);
  });
}

/** aura 元素環繞:足下小法陣 + 圖騰螺旋昇騰(自身增益) */
function fxAura(scene, effects, P) {
  const rv = P.scale * (1.25 + (P.variant % 5) * 0.1);
  const dur = fxDur(P, 1.8 + P.profile.tempo * 0.55);
  const g = new THREE.Group();
  const base = flat(new THREE.Mesh(PLANE, M(signatureTex(P.profile.structure), P.col, 0.8)));
  const orb = makeOrbit(P.profile.accentMotif, P.col, 5 + P.variant % 4, rv, P.scale * 0.36, P.rand);
  const orb2 = makeOrbit(P.profile.accentMotif, P.col2, 3 + P.variant % 3, rv * (0.48 + (P.variant % 3) * 0.08), P.scale * 0.25, P.rand);
  g.add(base, orb.g, orb2.g);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    base.scale.setScalar(Math.max(0.01, rv * outBack(Math.min(1, t / 0.3))));
    base.rotation.z += dt * (0.9 + P.profile.tempo * 0.65);
    stepOrbit(orb, t * P.profile.tempo, P.scale * (0.6 + (P.variant % 4) * 0.1));
    stepOrbit(orb2, t * (1.25 + (P.variant % 3) * 0.2), P.scale * 1.1);
    fadeAll(g, bell(t, dur));
  });
}

/** heal 治療綻放:柔光地圈 + 上升圖騰粒子 + 雙螺旋光帶 + 光柱 */
function fxHeal(scene, effects, P) {
  const rv = clampR(P, 1.8, 90);
  const dur = fxDur(P, (P.big ? 2.5 : 1.9) + P.profile.tempo * 0.35);
  const g = new THREE.Group();
  const disc = flat(new THREE.Mesh(PLANE, M(glowTex(), P.col2, 0.55)));
  disc.scale.setScalar(rv);
  const pts = risingPoints(P.profile.accentMotif, P.col2, P.big ? 38 + P.variant % 9 : 20 + P.variant % 7,
    Math.min(rv, P.scale * (2.8 + (P.variant % 3) * 0.25)), P.scale * 0.5, P.rand);
  const pil = pillar(P.col2, P.scale * 0.8, P.scale * 2.8, 0.4);
  g.add(disc, pts.pts, pil);
  // 大招附魔法陣底 + 雙螺旋
  const helix = [];
  if (P.big) {
    const ring = flat(new THREE.Mesh(PLANE, M(signatureTex(P.profile.layoutStructure), P.col, 0.85)));
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
  const dur = fxDur(P, 2.25 + P.profile.tempo * 0.5);
  const g = new THREE.Group();
  const main = flat(new THREE.Mesh(PLANE, M(signatureTex(P.profile.structure), P.col, 0.95)));
  const wave = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.8)));
  wave.position.y = 0.2;
  const beacons = [];
  const beaconN = 3 + P.variant % 3;
  for (let k = 0; k < beaconN; k++) {
    const b = pillar(P.col2, rv * 0.06, P.scale * 4.2, 0.75);
    const a = (k / beaconN) * TAU + P.phase;
    b.position.set(Math.cos(a) * rv * 0.62, b.position.y, Math.sin(a) * rv * 0.62);
    beacons.push(b);
    g.add(b);
  }
  const pts = risingPoints(null, P.col, 34, rv * 0.5, P.scale * 0.4, P.rand);
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
  const dur = fxDur(P, 1.45 + P.profile.tempo * 0.45);
  const g = new THREE.Group();
  const dash = flat(new THREE.Mesh(PLANE, M(dashRingTex(), P.col, 0.95)));
  const converge = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.85)));
  converge.position.y = 0.25;
  const pil = pillar(P.col, rv * 0.10, P.scale * 5.5, 0.5);
  const glyphs = [];
  for (let k = 0; k < 4; k++) {
    const s = new THREE.Sprite(SPM(glyphTex(P.profile.accentMotif, k), P.col, 0.9));
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
  const dur = fxDur(P, 2.25 + P.profile.tempo * 0.5);
  const g = new THREE.Group();
  // 暗幕(normal blending 壓暗地面,加法陣疊在上面)
  const dark = flat(new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({
    map: glowTex(), color: 0x0a0414, transparent: true, opacity: 0.5, depthWrite: false,
  })));
  dark.material.userData.o = 0.5;
  dark.scale.setScalar(rv);
  const ring = flat(new THREE.Mesh(PLANE, M(signatureTex(P.profile.layoutStructure), P.col, 0.9)));
  ring.position.y = 0.2;
  // 鎖鏈:自外緣拱起收向中心上方,drawRange 逐節生長
  const chains = [];
  const chainN = 4 + P.variant % 4;
  for (let k = 0; k < chainN; k++) {
    const a = (k / chainN) * TAU + P.rand() * 0.4;
    const top = P.scale * (1.6 + P.rand() * 0.8);
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
    s.scale.setScalar(P.scale * (0.5 + P.rand() * 0.6));
    s.position.set((P.rand() - 0.5) * cr * 1.4, P.rand() * P.scale, (P.rand() - 0.5) * cr * 1.4);
    wisps.push({ s, v: 1 + P.rand() * 1.6, ph: P.rand() * TAU });
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
  const dur = fxDur(P, 1.55 + P.profile.tempo * 0.35);
  const g = new THREE.Group();
  const shell = new THREE.Mesh(SHELL, M(hexPatRepeat(4, 2), P.col, 0.4));
  shell.scale.setScalar(P.scale * 0.95);
  shell.position.y = P.scale * 0.55;
  const ringM = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.6)));
  // 崩解光屑:自殼面向下飄落
  const n = 28 + P.variant % 9;
  const pos = new Float32Array(n * 3);
  const dat = [];
  for (let i = 0; i < n; i++) {
    const a = P.rand() * TAU, ph = P.rand() * Math.PI;
    const rr = P.scale * 0.95;
    pos[i * 3] = Math.cos(a) * Math.sin(ph) * rr;
    pos[i * 3 + 1] = P.scale * 0.55 + Math.cos(ph) * rr * 0.6;
    pos[i * 3 + 2] = Math.sin(a) * Math.sin(ph) * rr;
    dat.push({ v: 1.2 + P.rand() * 2 });
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
  const dur = fxDur(P, 2.05 + P.profile.tempo * 0.45);
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
  const glyph = new THREE.Sprite(SPM(glyphTex(P.profile.accentMotif, 2), P.col2, 0.95));
  glyph.scale.setScalar(P.scale * 0.9);
  const base = flat(new THREE.Mesh(PLANE, M(signatureTex(P.profile.layoutStructure), P.col, 0.5)));
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

/** 七種防護場的體積語彙；僅聖所使用穹頂，其餘是盾牆、機械籠、熔爐、冰冠與界碑。 */
function shieldField(P, rv, opacity) {
  const g = new THREE.Group();
  const tex = signatureTex(P.profile.fieldForm);
  const form = P.profile.fieldForm;
  let spin = 0;
  if (form === 'tomb_phalanx') {
    g.add(instances(BOX, M(tex, P.col, opacity), 7, (d, i) => {
      const x = i - 3;
      d.position.set(x * rv * 0.23, rv * (0.33 + (3 - Math.abs(x)) * 0.055), -Math.abs(x) * rv * 0.035);
      d.rotation.y = x * 0.07;
      d.scale.set(rv * 0.19, rv * (0.58 + (3 - Math.abs(x)) * 0.07), 1);
    }));
  } else if (form === 'clockwork_cage') {
    g.add(instances(OCT, M(null, P.col, Math.min(0.8, opacity * 1.8)), 3, (d, i) => {
      d.position.y = rv * 0.48;
      if (i === 0) d.rotation.x = Math.PI / 2;
      else if (i === 1) d.rotation.y = Math.PI / 2;
      else d.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      d.scale.setScalar(rv * (0.72 + i * 0.10));
    }));
    spin = 0.55;
  } else if (form === 'cauldron_shell') {
    g.add(instances(CYL, M(tex, P.col, opacity), 3, (d, i) => {
      d.position.y = rv * (0.14 + i * 0.20);
      d.scale.set(rv * (0.96 - i * 0.18), rv * 0.20, rv * (0.96 - i * 0.18));
    }));
    const lid = flat(new THREE.Mesh(OCT, M(null, P.col2, 0.62)));
    lid.position.y = rv * 0.72; lid.scale.setScalar(rv * 0.55); g.add(lid);
    spin = -0.32;
  } else if (form === 'octant_vault') {
    const vault = new THREE.Mesh(DOME, M(tex, P.col, opacity * 0.72));
    vault.scale.set(rv, rv * 0.88, rv); g.add(vault);
    g.add(instances(CYL, M(pillarTex(), P.col2, opacity), 8, (d, i, count) => {
      const a = i * TAU / count;
      d.position.set(Math.cos(a) * rv * 0.82, rv * 0.34, Math.sin(a) * rv * 0.82);
      d.scale.set(rv * 0.035, rv * 0.68, rv * 0.035);
    }));
    spin = 0.12;
  } else if (form === 'cornerstone_wall') {
    g.add(instances(BOX, M(tex, P.col, opacity), 4, (d, i) => {
      const a = i * Math.PI / 2;
      d.position.set(Math.cos(a) * rv * 0.58, rv * 0.34, Math.sin(a) * rv * 0.58);
      d.rotation.y = -a;
      d.scale.set(rv * 1.04, rv * 0.68, 1);
    }));
  } else if (form === 'ice_crown') {
    g.add(instances(SPIRE, M(tex, P.col, opacity), 9, (d, i, count) => {
      const a = i * TAU / count;
      d.position.set(Math.cos(a) * rv * 0.70, rv * (0.22 + (i % 3) * 0.05), Math.sin(a) * rv * 0.70);
      d.rotation.y = -a;
      d.scale.set(rv * 0.16, rv * (0.52 + (i % 3) * 0.15), rv * 0.16);
    }));
    spin = 0.18;
  } else if (form === 'exclusion_grid') {
    g.add(instances(BOX, M(tex, P.col, opacity), 8, (d, i) => {
      const side = i >> 1, end = i & 1, a = side * Math.PI / 2;
      d.position.set(Math.cos(a) * rv * 0.72 + Math.sin(a) * (end ? rv * 0.38 : -rv * 0.38),
        rv * 0.38, Math.sin(a) * rv * 0.72 - Math.cos(a) * (end ? rv * 0.38 : -rv * 0.38));
      d.rotation.y = -a;
      d.scale.set(rv * 0.12, rv * 0.76, 1);
    }));
    g.add(instances(PLANE, M(tex, P.col2, opacity * 0.62), 4, (d, i) => {
      const a = i * Math.PI / 2;
      d.position.set(Math.cos(a) * rv * 0.72, rv * 0.42, Math.sin(a) * rv * 0.72);
      d.rotation.y = Math.PI / 2 - a;
      d.scale.set(rv * 0.72, rv * 0.42, 1);
    }));
  } else {
    g.add(instances(BOX, M(tex, P.col, opacity), 4, (d, i) => {
      const a = i * Math.PI / 2;
      d.position.set(Math.cos(a) * rv * 0.65, rv * 0.35, Math.sin(a) * rv * 0.65);
      d.rotation.y = -a;
      d.scale.set(rv, rv * 0.7, 1);
    }));
  }
  return { g, spin };
}

/** dome 攔截場：依角色建築／工藝語彙生成不同的三維邊界。 */
function fxDome(scene, effects, P) {
  const rv = clampR(P, 2.4, 70);
  const dur = fxDur(P, 2.0);
  const g = new THREE.Group();
  // 大型場域降低透明度，避免透明層覆蓋率隨半徑平方失控。
  const dO = 0.35 * Math.min(1, Math.max(0.35, P.scale * 5 / rv));
  const field = shieldField(P, rv, dO);
  const rim = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.85)));
  rim.position.y = 0.25;
  const glyph = new THREE.Sprite(SPM(signatureTex(P.profile.structure), P.col2, 0.95));
  glyph.scale.setScalar(P.scale * 0.9);
  g.add(field.g, rim, glyph);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    const grow = outBack(Math.min(1, t / 0.35));
    field.g.scale.setScalar(grow);
    field.g.rotation.y += dt * field.spin;
    rim.scale.setScalar(Math.max(0.01, rv * (1 + 0.06 * Math.sin(t * 8))));
    glyph.position.y = rv * grow * 0.9;
    fadeAll(g, bell(t, dur, 0.15, 0.55));
    const flicker = 0.88 + 0.12 * Math.sin(t * 12);
    field.g.traverse((o) => { if (o.material?.userData.o != null) o.material.opacity *= flicker; });
  });
}

/** dash 殘影突進:沿實際位移灑圖騰殘影 + 光streak(靜止時 = 原地環爆殘影) */
function fxDash(scene, effects, P) {
  const dur = fxDur(P, 1.5);
  const g = new THREE.Group();           // 子件全用世界座標,群組留在原點
  const ghosts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const seg = new THREE.Vector3();
  const last = new THREE.Vector3();
  const p = new THREE.Vector3();
  let hasLast = false, timer = 0, cursor = 0;
  const burst = flat(new THREE.Mesh(PLANE, M(softRingTex(), P.col2, 0.95)));
  const p0 = P.casterPos?.() || P.at;
  burst.position.set(p0.x, p0.y - P.scale * 0.4, p0.z);
  g.add(burst);
  // 固定深度的殘影池：fade 期間只重用 transform/material，不建立或擴張陣列。
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(SPM(glyphTex(P.profile.accentMotif, i), P.col, 0));
    const st = new THREE.Mesh(CYL, M(pillarTex(), P.col2, 0));
    s.visible = st.visible = false;
    g.add(s, st);
    ghosts.push({ s, st, age: 1, ttl: 0.55 });
  }
  push(scene, effects, g, dur, (t, dt) => {
    burst.scale.setScalar(Math.max(0.01, P.scale * (1 + t * 5)));
    burst.material.opacity = burst.material.userData.o * Math.max(0, 1 - t / 0.6);
    const cp = P.casterPos?.() || P.at;
    p.set(cp.x, cp.y, cp.z);
    timer -= dt;
    if (timer <= 0 && t < dur - 0.5) {
      timer = 0.045;
      const gh = ghosts[cursor++ % ghosts.length];
      gh.age = 0;
      gh.s.visible = true;
      gh.st.visible = false;
      gh.s.material.opacity = gh.s.material.userData.o * 0.95;
      gh.s.scale.setScalar(P.scale * (0.8 + P.rand() * 0.6));
      const moved = hasLast && last.distanceToSquared(p) > 0.05;
      if (moved) {
        gh.s.position.copy(last).lerp(p, P.rand());
        gh.s.position.y += (P.rand() - 0.3) * P.scale * 0.5;
        // 光痕:上一幀 → 這一幀的發光速度線
        seg.copy(p).sub(last);
        const len = seg.length();
        if (len > 0.1) {
          gh.st.visible = true;
          gh.st.scale.set(P.scale * 0.1, len * 1.6, P.scale * 0.1);
          gh.st.position.copy(last).addScaledVector(seg, 0.5);
          gh.st.quaternion.setFromUnitVectors(up, seg.normalize());
          gh.st.material.opacity = gh.st.material.userData.o * 0.8;
          gh.ttl = 0.4;
        }
      } else {
        const a = P.rand() * TAU;
        gh.s.position.set(
          p.x + Math.cos(a) * P.scale * (0.8 + P.rand()),
          p.y + (P.rand() - 0.4) * P.scale,
          p.z + Math.sin(a) * P.scale * (0.8 + P.rand()));
      }
      last.copy(p);
      hasLast = true;
    }
    if (!hasLast) { last.copy(p); hasLast = true; }
    for (const gh of ghosts) {
      gh.age += dt;
      const k = Math.max(0, 1 - gh.age / gh.ttl);
      gh.s.material.opacity = gh.s.material.userData.o * k;
      gh.st.material.opacity = gh.st.material.userData.o * k;
      if (k <= 0) gh.s.visible = gh.st.visible = false;
    }
  });
}

/** slash 拳影劍氣:三日月刃波環身盤旋飛出 + 圖騰殘影(近戰增益的殺氣) */
function fxSlash(scene, effects, P) {
  const dur = fxDur(P, 2.2);
  const g = new THREE.Group();
  const n = P.big ? 7 : 5;
  const waves = [];
  for (let i = 0; i < n; i++) {
    const w = new THREE.Mesh(PLANE, M(crescentTex(), i % 3 === 2 ? P.col2 : P.col, 0.95));
    w.visible = false;
    waves.push({
      m: w, t0: 0.15 + i * 0.18, a0: (i / n) * TAU + P.rand(),
      spin: 3.2 + P.rand() * 1.5, h: P.scale * (0.4 + P.rand() * 0.9),
      roll: (P.rand() - 0.5) * 1.2, life: 0.65,
    });
    g.add(w);
  }
  const orb = makeOrbit(P.profile.accentMotif, P.col, 5, P.scale * 1.2, P.scale * 0.5, P.rand);
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

/** atfield 絕對領域：三招分別為追悼盾牆、七重神經環、嘉年華飛行甲板。 */
function fxAtfield(scene, effects, P) {
  const dur = fxDur(P, 2.2);
  const g = new THREE.Group();
  let field;
  if (P.profile.profileId === 's06.ult.undying_phalanx') {
    field = instances(BOX, M(signatureTex('tomb'), P.col, 0.72), 7, (d, i) => {
      const x = i - 3;
      d.position.set(x * P.scale * 0.58, P.scale * (0.72 + (3 - Math.abs(x)) * 0.10), 0);
      d.rotation.y = x * 0.06;
      d.scale.set(P.scale * 0.48, P.scale * (1.34 + (3 - Math.abs(x)) * 0.16), 1);
    });
  } else if (P.profile.profileId === 't02.ult.galatea_fullsync') {
    field = instances(OCT, M(null, P.col2, 0.82), 7, (d, i) => {
      d.position.y = P.scale * (0.45 + i * 0.18);
      d.rotation.set(i % 2 ? Math.PI / 2 : 0, i * Math.PI / 7, i % 3 ? 0 : Math.PI / 2);
      d.scale.setScalar(P.scale * (1.65 - i * 0.11));
    });
  } else {
    field = instances(BOX, M(signatureTex('rotor'), P.col, 0.66), 8, (d, i) => {
      const a = i * TAU / 8;
      d.position.set(Math.cos(a) * P.scale * 0.65, P.scale * (0.22 + (i % 2) * 0.18), Math.sin(a) * P.scale * 0.65);
      d.rotation.y = -a;
      d.scale.set(P.scale * 1.45, P.scale * 0.12, 1);
    });
  }
  g.add(field);
  const pil = pillar(P.col, P.scale * 0.5, P.scale * 3.4, 0.4);
  g.add(pil);
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    const grow = outBack(Math.min(1, t / 0.34));
    field.scale.setScalar(Math.max(0.01, grow * (1 + t * 0.10)));
    field.rotation.y += dt * (P.profile.profileId === 'm06.ult.helicopter_carnival' ? 1.8 : 0.32);
    field.material.opacity = field.material.userData.o
      * (0.62 + 0.38 * Math.sin(t * 16 + P.phase)) * bell(t, dur, 0.1, 0.5);
    pil.material.opacity = pil.material.userData.o * bell(t, dur, 0.2, 0.5);
  });
}

/** snipe 天穹狙擊:標定圈收束 → 天降狙擊光線 + 白閃(一發,只需要一發) */
function fxSnipe(scene, effects, P) {
  const rv = Math.min(Math.max((P.r || 6) * 2.5, 12), P.cap);
  const dur = fxDur(P, 1.8);
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
  const dur = fxDur(P, 2.6);
  const g = new THREE.Group();
  const waves = [];
  for (let k = 0; k < 4; k++) {
    const w = flat(new THREE.Mesh(PLANE, M(softRingTex(), k % 2 ? P.col2 : P.col, 0.9)));
    w.position.y = 0.25 + k * 0.12;
    waves.push(w);
    g.add(w);
  }
  const orb = makeOrbit(P.profile.accentMotif, P.col2, 8, P.scale * 1.6, P.scale * 0.5, P.rand);
  const pil = pillar(P.col, P.scale * 0.6, P.scale * 3, 0.35);
  const base = flat(new THREE.Mesh(PLANE, M(signatureTex(P.profile.structure), P.col, 0.6)));
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

/**
 * 有界 profile 合成器：一般招式固定三個結構層；防護招式以最多兩個實例化
 * 盾場層取代接觸層。連同兩個共用粒子層，每招固定落在 4–6 draw call 預算內。
 */
function profileCastCompositor(scene, effects, P) {
  const dur = fxDur(P, P.big ? 2.4 : 1.8);
  const rv = clampR(P, P.big ? 2.8 : 2.1);
  const profile = P.profile;
  const g = new THREE.Group();
  const layers = [];
  const addLayer = (name, mesh) => { mesh.userData.noOutline = true; g.add(mesh); layers.push(name); return mesh; };
  const seal = addLayer('struct.culturalSeal', flat(new THREE.Mesh(PLANE, M(culturalSealTex(P), P.col, 0.78))));
  seal.scale.setScalar(rv * 0.74);
  const tell = addLayer('struct.layoutStructure', flat(new THREE.Mesh(PLANE, M(signatureTex(profile.layoutStructure), P.col2, 0.66))));
  tell.scale.setScalar(rv * (0.42 + (LAYOUT_SCALE[profile.layout] || 1) * 0.22));
  tell.rotation.z = LAYOUT_STYLE[profile.layout] || 0;
  let field = null;
  const fieldMaterials = [];
  let accent = null;
  if (profile.arch === 'dome') {
    field = shieldField(P, rv, 0.30);
    // 建立時收集一次；逐幀只走固定材質陣列，不巡覽場景樹。
    field.g.traverse((o) => { if (o.material) fieldMaterials.push(o.material); });
    field.g.userData.noOutline = true;
    g.add(field.g);
    layers.push('struct.shieldField');
  } else {
    accent = addLayer('struct.accentMotif', flat(new THREE.Mesh(PLANE, M(glyphTex(profile.accentMotif, profile.variant), P.col, 0.72))));
    accent.scale.setScalar(P.scale * (0.34 + (profile.tempo - 0.82) * 0.18));
    accent.rotation.z = (LAYOUT_STYLE[profile.layout] || 0) * 0.5 + profile.phase;
  }
  g.userData.castLayers = layers;
  anchorCaster(g, P);
  push(scene, effects, g, dur, (t, dt) => {
    anchorCaster(g, P);
    const env = bell(t, dur, 0.14, 0.42);
    const motion = MOTION_STYLE[profile.motion] || {};
    const contact = CONTACT_STYLE[profile.contact] || 'fade';
    const hit = contact === 'flash' || contact === 'pulse' ? Math.max(0, 1 - Math.abs(t - dur * 0.58) * 8) : 0;
    const amp = P.scale * 0.08;
    seal.scale.setScalar(Math.max(0.01, rv * (0.66 + ease01(Math.min(1, t / 0.3)) * 0.16)));
    seal.rotation.z += dt * (0.24 + profile.tempo * 0.12);
    tell.position.x = Math.sin(profile.phase + t * profile.tempo) * amp * (motion.x || 0);
    tell.position.y = (motion.y || 0) * amp * Math.sin(Math.min(1, t / 0.34) * Math.PI);
    tell.scale.setScalar(Math.max(0.01, rv * (0.42 + (LAYOUT_SCALE[profile.layout] || 1) * 0.22) * (1 + (motion.scale || 0) * 0.12 * ease01(Math.min(1, t / 0.5)))));
    tell.material.opacity = tell.material.userData.o * env;
    seal.material.opacity = seal.material.userData.o * env;
    if (accent) {
      accent.position.y = P.scale * 0.24 + (motion.y || 0) * amp;
      accent.rotation.z += dt * (0.5 + profile.tempo * 0.25);
      accent.material.opacity = accent.material.userData.o * Math.max(env, hit);
    }
    if (field) {
      field.g.scale.setScalar(Math.max(0.01, outBack(Math.min(1, t / 0.34)) * (1 + hit * 0.14)));
      field.g.rotation.y += dt * (field.spin || 0.1) * (1 + profile.tempo * 0.2);
      for (const material of fieldMaterials) material.opacity = material.userData.o * env;
    }
  });
}

// ---------------- 角色 → 唯一 profileId ----------------
// 每列都是獨立的「輪廓 + 層次 + 節奏」契約；渲染器可以共享，但不得把 Q/E
// 壓回同一個 archetype。profileId 也是確定性亂數的種子，換角時版面仍可重現。
const PROFILE_ROWS = [
  ['s01.skill.fugue_concord','s01','skill','notewave','note'], ['s01.ult.sky_orchestra','s01','ult','gate','wing'],
  ['s02.skill.tempered_reforge','s02','skill','slash','gear'], ['s02.ult.world_crucible','s02','ult','circle','flame'],
  ['s03.skill.silent_lobes','s03','skill','scan','circuit'], ['s03.ult.leviathan_song','s03','ult','notewave','star'],
  ['s04.skill.breakthrough_thrust','s04','skill','dash','claw'], ['s04.ult.deadline_shura','s04','ult','slash','claw'],
  ['s05.skill.synapse_overclock','s05','skill','aura','bolt'], ['s05.ult.star_swarm_dive','s05','ult','zone','reticle'],
  ['s06.skill.elegy_intercept','s06','skill','dome','wing'], ['s06.ult.undying_phalanx','s06','ult','atfield','shield'],
  ['s07.skill.causal_proof','s07','skill','bind','math'], ['s07.ult.inverse_geometry','s07','ult','zone','math'],
  ['s08.skill.angel_dropship','s08','skill','gate','cross'], ['s08.ult.krakow_bells','s08','ult','notewave','cross'],
  ['s09.skill.royal_hunt','s09','skill','aura','star'], ['s09.ult.sky_snare','s09','ult','bind','reticle'],
  ['s10.skill.allseeing_decode','s10','skill','scan','circuit'], ['s10.ult.white_noise_void','s10','ult','veil','wing'],
  ['s11.skill.fatal_escapement','s11','skill','circle','clock'], ['s11.ult.glashutte_retime','s11','ult','dome','clock'],
  ['s12.skill.lavender_moonveil','s12','skill','veil','rune'], ['s12.ult.homeward_constellation','s12','ult','gate','star'],
  ['t01.skill.steel_advance','t01','skill','aura','shield'], ['t01.ult.ural_avalanche','t01','ult','zone','frost'],
  ['t02.skill.neural_seventh_step','t02','skill','dash','circuit'], ['t02.ult.galatea_fullsync','t02','ult','atfield','hex'],
  ['t03.skill.cauldron_ram','t03','skill','dome','shield'], ['t03.ult.furnace_maelstrom','t03','ult','bind','flame'],
  ['t04.skill.grey_goose_cloak','t04','skill','veil','wing'], ['t04.ult.reaper_gaze','t04','ult','snipe','reticle'],
  ['t05.skill.crane_stress_heal','t05','skill','heal','gear'], ['t05.ult.industrial_descent','t05','ult','gate','gear'],
  ['t06.skill.cloud_somersault','t06','skill','dash','flame'], ['t06.ult.heaven_riot','t06','ult','slash','fist'],
  ['t07.skill.pterosaur_silence','t07','skill','veil','rune'], ['t07.ult.terminal_arrow','t07','ult','snipe','reticle'],
  ['t08.skill.broken_tuning','t08','skill','bind','note'], ['t08.ult.dragon_aria','t08','ult','notewave','note'],
  ['t09.skill.martyrs_elegy','t09','skill','gate','poem'], ['t09.ult.missile_black_rain','t09','ult','zone','poem'],
  ['t10.skill.prophetic_intercept','t10','skill','scan','math'], ['t10.ult.sky_sanctuary','t10','ult','dome','shield'],
  ['t11.skill.trench_doctrine','t11','skill','circle','star'], ['t11.ult.veteran_muster','t11','ult','gate','shield'],
  ['t12.skill.firefly_spectrum','t12','skill','scan','star'], ['t12.ult.collective_silence','t12','ult','bind','circuit'],
  ['m01.skill.night_bat_escape','m01','skill','dash','wing'], ['m01.ult.blood_raven_feast','m01','ult','aura','flame'],
  ['m02.skill.titan_stance','m02','skill','dome','shield'], ['m02.ult.cornerstone_oath','m02','ult','circle','shield'],
  ['m03.skill.alpine_spring','m03','skill','heal','frost'], ['m03.ult.aurora_revival','m03','ult','dome','frost'],
  ['m04.skill.steppe_mist','m04','skill','veil','wing'], ['m04.ult.eagle_skyeye','m04','ult','scan','reticle'],
  ['m05.skill.blackout_breaker','m05','skill','bind','bolt'], ['m05.ult.thunder_judgement','m05','ult','zone','bolt'],
  ['m06.skill.carnival_vanguard','m06','skill','gate','note'], ['m06.ult.helicopter_carnival','m06','ult','atfield','wing'],
  ['m07.skill.border_dome','m07','skill','dome','hex'], ['m07.ult.total_exclusion','m07','ult','zone','hex'],
  ['m08.skill.paid_positioning','m08','skill','dash','coin'], ['m08.ult.formless_finale','m08','ult','snipe','coin'],
];
// 每個 profile 的美術簽名是資料，不由角色序號推導；四欄分別控制 Tell 輪廓、層次
// 佈局、運動方向與 Contact 收尾。accentMotif 只提供圖騰，不能取代前三欄。
const PROFILE_SIGNATURES = {
  's01.skill.fugue_concord': { tellShape:'score', layout:'spiral', motion:'chase', contact:'reverse', accentMotif:'note' },
  's01.ult.sky_orchestra': { tellShape:'score', layout:'airline', motion:'lift', contact:'scatter', accentMotif:'wing' },
  's02.skill.tempered_reforge': { tellShape:'anvil', layout:'weld', motion:'inward', contact:'impact', accentMotif:'rivet' },
  's02.ult.world_crucible': { tellShape:'furnace', layout:'streams', motion:'flow', contact:'steam', accentMotif:'crucible' },
  's03.skill.silent_lobes': { tellShape:'whale', layout:'ears', motion:'close', contact:'silence', accentMotif:'whale' },
  's03.ult.leviathan_song': { tellShape:'whale', layout:'ribs', motion:'outward', contact:'noise', accentMotif:'spectrum' },
  's04.skill.breakthrough_thrust': { tellShape:'arrow', layout:'thrust', motion:'forward', contact:'stab', accentMotif:'claw' },
  's04.ult.deadline_shura': { tellShape:'deadline', layout:'frame', motion:'pulse', contact:'break', accentMotif:'slash' },
  's05.skill.synapse_overclock': { tellShape:'synapse', layout:'chain', motion:'pulse', contact:'dive', accentMotif:'circuit' },
  's05.ult.star_swarm_dive': { tellShape:'starfall', layout:'funnel', motion:'dive', contact:'multi', accentMotif:'reticle' },
  's06.skill.elegy_intercept': { tellShape:'tally', layout:'dome', motion:'stitch', contact:'spark', accentMotif:'shield' },
  's06.ult.undying_phalanx': { tellShape:'tomb', layout:'phalanx', motion:'lock', contact:'divert', accentMotif:'banner' },
  's07.skill.causal_proof': { tellShape:'proof', layout:'chord', motion:'solve', contact:'close', accentMotif:'math' },
  's07.ult.inverse_geometry': { tellShape:'triangulation', layout:'inverse', motion:'fold', contact:'scatter', accentMotif:'math' },
  's08.skill.angel_dropship': { tellShape:'dropship', layout:'pillar', motion:'drop', contact:'impact', accentMotif:'cross' },
  's08.ult.krakow_bells': { tellShape:'bell', layout:'rose', motion:'threebeat', contact:'renew', accentMotif:'star' },
  's09.skill.royal_hunt': { tellShape:'brand', layout:'track', motion:'advance', contact:'jump', accentMotif:'star' },
  's09.ult.sky_snare': { tellShape:'snare', layout:'net', motion:'shrink', contact:'reel', accentMotif:'reticle' },
  's10.skill.allseeing_decode': { tellShape:'feather', layout:'wing', motion:'inward', contact:'scan', accentMotif:'circuit' },
  's10.ult.white_noise_void': { tellShape:'noise', layout:'waterfall', motion:'erase', contact:'blackout', accentMotif:'wing' },
  's11.skill.fatal_escapement': { tellShape:'escapement', layout:'gear', motion:'step', contact:'lock', accentMotif:'clock' },
  's11.ult.glashutte_retime': { tellShape:'escapement', layout:'explode', motion:'rewind', contact:'restore', accentMotif:'clock' },
  's12.skill.lavender_moonveil': { tellShape:'crescent', layout:'starpath', motion:'veil', contact:'drift', accentMotif:'star' },
  's12.ult.homeward_constellation': { tellShape:'starpath', layout:'door', motion:'reconnect', contact:'return', accentMotif:'star' },
  't01.skill.steel_advance': { tellShape:'banner', layout:'arrowline', motion:'march', contact:'fan', accentMotif:'shield' },
  't01.ult.ural_avalanche': { tellShape:'artillery', layout:'azimuth', motion:'fall', contact:'avalanche', accentMotif:'frost' },
  't02.skill.neural_seventh_step': { tellShape:'seven', layout:'nodes', motion:'blink', contact:'slit', accentMotif:'circuit' },
  't02.ult.galatea_fullsync': { tellShape:'seven', layout:'rings', motion:'align', contact:'seal', accentMotif:'hex' },
  't03.skill.cauldron_ram': { tellShape:'furnace', layout:'door', motion:'close', contact:'ram', accentMotif:'shield' },
  't03.ult.furnace_maelstrom': { tellShape:'furnace', layout:'vortex', motion:'inward', contact:'pressure', accentMotif:'flame' },
  't04.skill.grey_goose_cloak': { tellShape:'feather', layout:'rows', motion:'cool', contact:'delete', accentMotif:'wing' },
  't04.ult.reaper_gaze': { tellShape:'eye', layout:'cone', motion:'search', contact:'lock', accentMotif:'reticle' },
  't05.skill.crane_stress_heal': { tellShape:'crane', layout:'joints', motion:'repair', contact:'seal', accentMotif:'gear' },
  't05.ult.industrial_descent': { tellShape:'blueprint', layout:'assembly', motion:'descend', contact:'deploy', accentMotif:'gear' },
  't06.skill.cloud_somersault': { tellShape:'cloud', layout:'sweep', motion:'s', contact:'land', accentMotif:'flame' },
  't06.ult.heaven_riot': { tellShape:'staff', layout:'split', motion:'slam', contact:'crack', accentMotif:'fist' },
  't07.skill.pterosaur_silence': { tellShape:'pterosaur', layout:'membrane', motion:'cool', contact:'fold', accentMotif:'wing' },
  't07.ult.terminal_arrow': { tellShape:'arrow', layout:'needle', motion:'charge', contact:'pierce', accentMotif:'reticle' },
  't08.skill.broken_tuning': { tellShape:'chord', layout:'bars', motion:'fracture', contact:'reverse', accentMotif:'note' },
  't08.ult.dragon_aria': { tellShape:'dragon', layout:'throat', motion:'resonate', contact:'negative', accentMotif:'note' },
  't09.skill.martyrs_elegy': { tellShape:'calligraphy', layout:'ribbons', motion:'write', contact:'gate', accentMotif:'poem' },
  't09.ult.missile_black_rain': { tellShape:'rain', layout:'cloud', motion:'fall', contact:'inkburst', accentMotif:'poem' },
  't10.skill.prophetic_intercept': { tellShape:'parabola', layout:'mirror', motion:'converge', contact:'hourglass', accentMotif:'math' },
  't10.ult.sky_sanctuary': { tellShape:'arch', layout:'octant', motion:'rise', contact:'deflect', accentMotif:'shield' },
  't11.skill.trench_doctrine': { tellShape:'trench', layout:'contour', motion:'guide', contact:'gap', accentMotif:'star' },
  't11.ult.veteran_muster': { tellShape:'whistle', layout:'rows', motion:'march', contact:'advance', accentMotif:'shield' },
  't12.skill.firefly_spectrum': { tellShape:'firefly', layout:'bands', motion:'rise', contact:'reveal', accentMotif:'star' },
  't12.ult.collective_silence': { tellShape:'network', layout:'nodes', motion:'converge', contact:'extinguish', accentMotif:'circuit' },
  'm01.skill.night_bat_escape': { tellShape:'bat', layout:'wings', motion:'close', contact:'tear', accentMotif:'wing' },
  'm01.ult.blood_raven_feast': { tellShape:'moon', layout:'feast', motion:'orbit', contact:'return', accentMotif:'flame' },
  'm02.skill.titan_stance': { tellShape:'strata', layout:'pillars', motion:'lock', contact:'dust', accentMotif:'shield' },
  'm02.ult.cornerstone_oath': { tellShape:'cornerstone', layout:'walls', motion:'close', contact:'stress', accentMotif:'shield' },
  'm03.skill.alpine_spring': { tellShape:'alpine', layout:'contour', motion:'flow', contact:'crystal', accentMotif:'frost' },
  'm03.ult.aurora_revival': { tellShape:'aurora', layout:'curtains', motion:'close', contact:'crown', accentMotif:'frost' },
  'm04.skill.steppe_mist': { tellShape:'eagle', layout:'wind', motion:'cover', contact:'fade', accentMotif:'wing' },
  'm04.ult.eagle_skyeye': { tellShape:'eagle', layout:'compass', motion:'scan', contact:'mark', accentMotif:'reticle' },
  'm05.skill.blackout_breaker': { tellShape:'breaker', layout:'switches', motion:'drop', contact:'blackout', accentMotif:'bolt' },
  'm05.ult.thunder_judgement': { tellShape:'thunder', layout:'columns', motion:'fall', contact:'crawl', accentMotif:'bolt' },
  'm06.skill.carnival_vanguard': { tellShape:'carnival', layout:'bands', motion:'cross', contact:'deploy', accentMotif:'note' },
  'm06.ult.helicopter_carnival': { tellShape:'rotor', layout:'flightdeck', motion:'rise', contact:'tilt', accentMotif:'wing' },
  'm07.skill.border_dome': { tellShape:'border', layout:'gates', motion:'rise', contact:'strike', accentMotif:'hex' },
  'm07.ult.total_exclusion': { tellShape:'exclusion', layout:'grid', motion:'close', contact:'barrage', accentMotif:'hex' },
  'm08.skill.paid_positioning': { tellShape:'check', layout:'fold', motion:'blink', contact:'confirm', accentMotif:'coin' },
  'm08.ult.formless_finale': { tellShape:'empty_circle', layout:'negative', motion:'shrink', contact:'cut', accentMotif:'coin' },
};
const PROFILE_DEFS = Object.fromEntries(PROFILE_ROWS.map((row, i) => {
  const [profileId, ch, slot, arch, motif] = row;
  const signature = PROFILE_SIGNATURES[profileId];
  const culture = CULTURAL_PALETTES[ch];
  return [profileId, { profileId, ch, slot, arch, motif, ...signature, ...culture,
    frame: CULTURE_FRAME[ch], fieldForm: culture.shieldForm, layoutStructure: LAYOUT_STRUCTURE[signature.layout], variant: i, phase: i * 0.37,
    layers: `${signature.tellShape}/${signature.layout}/${signature.motion}/${signature.contact}`, tempo: 0.82 + (i % 7) * 0.07 }];
}));
const CFX = {};
for (const [profileId, ch, slot] of PROFILE_ROWS) (CFX[ch] ||= {})[slot] = profileId;
export const CAST_PROFILE_IDS = Object.freeze(Object.keys(PROFILE_DEFS));
const PARTICLE_RECIPES = Object.fromEntries(PROFILE_ROWS.map(([profileId], i) => {
  const sig = PROFILE_SIGNATURES[profileId];
  return [profileId, {
    count: 64 + ((i * 17) % 65), system: i % 2,
    shape: sig.tellShape, layout: sig.layout, motion: sig.motion, contact: sig.contact,
    accentMotif: sig.accentMotif, phase: i * 0.37, tempo: 0.82 + (i % 7) * 0.07,
  }];
}));

// fx 型別 fallback(表上查無 → 依 sim 語意選原型;新增角色不會沒演出)
const ARCH_BY_FX = {
  buff: 'aura', heal: 'heal', strike: 'zone', summon: 'gate', emp: 'bind',
  vision: 'scan', stealth: 'veil', dash: 'dash', intercept: 'dome',
  trees: 'zone', moon: 'zone', cube: 'zone', fog: 'veil',
};
// fx 型別輔色(語意色:治療綠 / 癱瘓紫 / 增益暖白……)
const FX_ACCENT = {
  buff: 0xfff2b8, heal: 0x9dffb0, strike: 0xffb06b, summon: 0xfff2b8, emp: 0xb78aff,
  vision: 0x9adfff, stealth: 0xcfd6ff, dash: 0xffffff, intercept: 0x9adfff,
  trees: 0x5ebd55, moon: 0xd9e5ff, cube: 0xe0ca85, fog: 0xccd9e8,
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
  const profileId = CFX[opts.ch]?.[opts.slot];
  const conf = profileId ? PROFILE_DEFS[profileId] : null;
  if (!conf) {
    if (globalThis.__DEV__ || globalThis.location?.search.includes('debug')) {
      throw new Error(`castfx 缺少 profileId: ${opts.ch}.${opts.slot}`);
    }
    return;
  }
  const fx = opts.fx || CHARACTERS[opts.ch]?.[opts.slot]?.fx;
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
    motif: conf.motif,
    profileId: conf.profileId,
    profile: conf,
    variant: conf.variant,
    rand: seeded(conf.profileId),
    cap: opts.rvCap ?? Infinity,   // 呼叫端取景預算(展示台);戰場不設限
    col, col2: new THREE.Color(conf.c2 ?? conf.accent ?? FX_ACCENT[fx] ?? 0xffffff),
  };
  spawnParticleCast(scene, effects, P, PARTICLE_RECIPES[profileId]);
  profileCastCompositor(scene, effects, P);
}
