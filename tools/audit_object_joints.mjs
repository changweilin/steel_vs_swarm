// 程序生成物件「接合完成度」離線稽核(2026-07-27;神木樹幹/樹根脫節案)
// ---------------------------------------------------------------------------
// 為什麼要這支:程序生成的零件靠「位置 + 歐拉角」手算擺位,只要位移方向與旋轉方向
// 不同調(差 90°、差一個正負號),零件就會浮在錨體外面 —— 而從**單一視角**看常常
// 剛好被別的零件遮住,看不出破圖。故驗收規則(使用者要求)為:
//
//   對每個接合,取「接合方向 d」(零件的擠出軸),在 **d 的法平面**上取
//   **兩個互相正交的觀察角** u / v,各自量接合面兩側輪廓邊界的縫隙:
//     視角 A(沿 u 看)→ 量 ±v 兩側探針      視角 B(沿 v 看)→ 量 ±u 兩側探針
//   兩個視角都看不到縫 = 接好;只有一個視角看得到縫 = 半接(PARTIAL);
//   四支探針全都懸空 = 完全脫節(FLOAT)。
//
// 量法是解析的(不是截圖):零件與錨體都轉成**世界空間凸包**(平面集),
// 探針到凸包的距離取 max(nᵢ·p − dᵢ) —— 凸體外部時這是真實距離的下界
// (最近特徵是面時等值,是邊/角時略小),故本工具**不會虛報**縫隙。
//
// 幾何來源一律從真實原始碼抽,不手抄:
//   hazards.js  的 BUILDERS(障礙物;神木/倒木/防空陣地/中繼站…)以原始碼 + 樁件執行,
//               零件樹連同 Group 嵌套變換一起解析。
//   biomes.js   的 VEG_DEFS / GIANT_DEFS / GIANT_DECO(宣告式零件表)+
//               xform.js 的 vegPartXform(實例變換單一縫)—— 驗的是渲染真的用的那份數學。
//   biomes.js   的 MEGALITHS(名岩 10 座;2026-08-05 移除方盒量體的 elcap/petra)/ synthMegalith(合成 11 型)/ decorateMegalith
//               (峭壁樹·岩菇/石砌屋/疊石堆/鳥巢台/高壓電塔)—— 2026-07-30 納入:巨岩的
//               貼壁與頂面落點是**推算**出來的,推錯一步整棵樹就浮在半空(使用者回報
//               「巨石懸崖旁的樹沒接好」)。岩體的射線實測(`rockProbe`)以 RaycasterStub
//               對真零件求交,故驗的是生成期真的會落在哪裡。
//
// 亂數紀律:樁件 jitterColor / chiselRock **必須消耗與真品相同枚數的 rnd**
// (3 枚 / 42 枚),否則後續零件的擺位會整串漂掉,稽核就在驗一棵不存在的樹。
//
// 四條判定(全部硬失敗):
//   FLOAT    接合端兩個正交視角都是縫,且沒有一支探針貼合 = 整件懸空
//   PARTIAL  一側貼合、另一正交側開縫 = 半接(單一視角看不出來的那種)
//   DETACHED 接觸圖上連不回主體/地面 = 整串脫落
//   ISOLATED 構件與主體無接觸,但縫比自己的第二長邊還短 ⇒ 轉/挪一下就會接上
//            = 位移方向與旋轉方向不同調的典型指紋(板根鰭誤轉成切向就是這一類)
// 不算縫的合法接合(有 rescue,列在 cover 欄):主人(小構件插進大零件)/
//   貼面(接縫在側面:地衣環帶、剝落樹皮絲帶、纏繞藤蔓)/ 中心貫穿(樹冠罩、屋頂、
//   竹葉冠 —— 端面比錨體寬,外緣本來就該騰空)/ 橫躺觸地(倒木、車輪)。
//
// 已知量不到的(靠 code review + 目視):
//   ⓪ 兩端支承(樑:石楣/橫樑)有具名救援 —— 接合面沿某一軸的兩個相反端各自貼在**不同**
//      錨體上即算接好(中段懸空是構造)。「不同錨體」MUST 保留:兩端貼同一個錨體正是
//      「板根鰭誤轉成切向」的指紋。
//   ① 兩端都該接合的構件(斜撐/繫桿):工具只要求「有一端接上」,
//      斜撐頂端懸空判不出來 —— 見 hazards.js relay 斜撐的註解。
//   ② 接觸判定以「頂點 + 面心取樣」近似:兩凸體只以側面貼側面相交(無取樣點互埋)
//      時會偏保守地判成脫離。偏保守 = 不會虛報縫,但會多報接觸不良。
//   ③ 半透明罩體以 0.2m 厚的殼近似;曲面網皮的細部起伏不在模型內。
//
// 用法:node tools/audit_object_joints.mjs [--seeds 4] [--all] [--only <名稱>]
//   --all 連 ok 的零件一起列(預設只列有問題的)
// 退出碼:0 = 全部接好;1 = 有 FLOAT / PARTIAL / DETACHED / ISOLATED
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAZARDS } from '../public/js/data.js';
import { vegPartXform } from '../public/js/xform.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Math.max(1, +arg('--seeds', 4));
const SHOW_ALL = process.argv.includes('--all');
const ONLY = arg('--only', null);

const TOL = 0.05;          // 接合縫容許值(m):5cm 以內視為貼合
const SKIN = 0.2;          // 半透明罩體(偽裝網/水面)當成這麼厚的一張皮
const K = 16;              // 接合面探針數;第 0/4/8/12 支 = 兩組互相正交的觀察軸
const AX = [0, 4, 8, 12];  // 正交探針索引:+z / +x / −z / −x(three 橫截面 (sinθ, cosθ))

// ============================ 向量 / 3×3 小工具 ============================
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// 變換 = { m: 3×3(旋轉×縮放,row-major 9 元), t: 位移 }
const IDENT = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
const m3apply = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];
const xfPoint = (x, p) => { const r = m3apply(x.m, p); return [r[0] + x.t[0], r[1] + x.t[1], r[2] + x.t[2]]; };
const m3mul = (a, b) => {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
};
/** 外層 ∘ 內層 */
const xfMul = (A, B) => ({ m: m3mul(A.m, B.m), t: xfPoint(A, B.t) });
const m3inv = (m) => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det,
          B / det, (a * i - c * g) / det, (c * d - a * f) / det,
          C / det, (b * g - a * h) / det, (a * e - b * d) / det];
};
const xfInv = (x) => { const mi = m3inv(x.m); const t = m3apply(mi, x.t); return { m: mi, t: [-t[0], -t[1], -t[2]] }; };
/** 法向量變換:N = (M⁻¹)ᵀ(非等比縮放下不可直接乘 M) */
const xfNormal = (x, n) => {
  const mi = m3inv(x.m);
  return norm([mi[0] * n[0] + mi[3] * n[1] + mi[6] * n[2],
               mi[1] * n[0] + mi[4] * n[1] + mi[7] * n[2],
               mi[2] * n[0] + mi[5] * n[1] + mi[8] * n[2]]);
};
/** three 的 Euler 'XYZ' → 3×3(R = Rx·Ry·Rz;makeRotationFromEuler 實證) */
function eulerM3(x, y, z, sx = 1, sy = 1, sz = 1) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m = [c * e, -c * f, d,
             af + be * d, ae - bf * d, -b * c,
             bf - ae * d, be + af * d, a * c];
  return [m[0] * sx, m[1] * sy, m[2] * sz, m[3] * sx, m[4] * sy, m[5] * sz, m[6] * sx, m[7] * sy, m[8] * sz];
}
/** 四元數 → 3×3(xform.js 的 vegPartXform 回傳四元數) */
function quatM3(q, sx = 1, sy = 1, sz = 1) {
  const [x, y, z, w] = q;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
             2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
             2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  return [m[0] * sx, m[1] * sy, m[2] * sz, m[3] * sx, m[4] * sy, m[5] * sz, m[6] * sx, m[7] * sy, m[8] * sz];
}

// ============================ 幾何 → 凸包 ============================
// 幾何描述子(樁件產出):prism(柱/錐)/ box / ico / torus / ring(裝飾,不驗)
// n 邊形橫截面沿方位 φ 的邊界半徑(three 頂點在 θᵢ = i·2π/n,位置 (sinθ, cosθ)·R)
function polyR(R, n, phi) {
  if (n >= 16) return R;                       // 段數多 → 視為圓
  const step = Math.PI * 2 / n;
  const d = ((phi % step) + step) % step - step / 2;
  return R * Math.cos(step / 2) / Math.cos(d);
}
const ICO_V = (() => {                          // 正二十面體 12 頂點(單位化)
  const p = (1 + Math.sqrt(5)) / 2, v = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    v.push(norm([0, s1, s2 * p]), norm([s1, s2 * p, 0]), norm([s2 * p, 0, s1]));
  }
  return v;
})();

/** 由頂點集暴力枚舉凸包面(只用於 ico:12 點 220 組,便宜且精確) */
function hullPlanes(verts) {
  const planes = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) for (let k = j + 1; k < verts.length; k++) {
    const n0 = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    if (len(n0) < 1e-9) continue;
    const n = norm(n0), d = dot(n, verts[i]);
    let above = 0, below = 0;
    for (const v of verts) { const s = dot(n, v) - d; if (s > 1e-6) above++; else if (s < -1e-6) below++; }
    if (above && below) continue;
    const sign = above ? -1 : 1;
    const pl = [n[0] * sign, n[1] * sign, n[2] * sign, d * sign];
    if (!planes.some((q) => Math.abs(q[0] - pl[0]) < 1e-6 && Math.abs(q[1] - pl[1]) < 1e-6
                         && Math.abs(q[2] - pl[2]) < 1e-6 && Math.abs(q[3] - pl[3]) < 1e-6)) planes.push(pl);
  }
  return planes;
}

/** 幾何描述子 → { planes:[[nx,ny,nz,d]], ends:[接合端候選] }(局部座標) */
function localSolid(g) {
  if (g.t === 'prism') {
    const { r1, r2, h, n } = g, hy = h / 2, step = Math.PI * 2 / n;
    const ring = (r, y) => Array.from({ length: n }, (_, i) =>
      [Math.sin(i * step) * r, y, Math.cos(i * step) * r]);
    const top = r1 > 1e-6 ? ring(r1, hy) : [[0, hy, 0]];
    const bot = r2 > 1e-6 ? ring(r2, -hy) : [[0, -hy, 0]];
    const planes = [];
    if (r1 > 1e-6) planes.push([0, 1, 0, hy]);
    if (r2 > 1e-6) planes.push([0, -1, 0, hy]);
    for (let i = 0; i < n; i++) {
      const b0 = bot[i % bot.length], b1 = bot[(i + 1) % bot.length], t0 = top[i % top.length];
      let nv = cross(sub(b1, b0), sub(t0, b0));
      if (len(nv) < 1e-9) continue;
      nv = norm(nv);
      const mid = [(b0[0] + b1[0]) / 2, 0, (b0[2] + b1[2]) / 2];
      if (dot(nv, mid) < 0) nv = [-nv[0], -nv[1], -nv[2]];
      planes.push([nv[0], nv[1], nv[2], dot(nv, b0)]);
    }
    // 接合端候選:兩個端面(軸 = 局部 ±y;法平面 = 局部 xz,兩正交觀察軸 = ±z / ±x)
    // 探針分兩圈:外緣 K 支 + 半徑 50% 內圈 K 支(內圈是「簷/凸沿」的救援:
    // 端面比錨體寬時外緣本來就該懸空,只要該方向內圈有貼合,接縫仍是密的)
    const ends = [];
    for (const [y, r, dir] of [[-hy, r2, 1], [hy, r1, -1]]) {
      const ring = (f) => Array.from({ length: K }, (_, i) => {
        const phi = i * (Math.PI * 2 / K), rr = polyR(r, n, phi) * f;
        return [Math.sin(phi) * rr, y, Math.cos(phi) * rr];
      });
      // 錐頂(r = 0)不是接合端:一個點無從「接合」,枝梢/樹尖本來就收在空中
      if (r <= 1e-6) continue;
      ends.push({ probes: [...ring(1), ...ring(0.5)], axis: [0, dir, 0], center: [0, y, 0], axial: true, r });
    }
    const side = [];   // 側面取樣(接觸判定用:柱體頂點只在兩端,細長件光靠頂點會誤判脫離)
    for (let i = 0; i < n; i++) for (const f of [0.25, 0.5, 0.75]) {
      const a = (i + 0.5) * step, rr = (r2 + (r1 - r2) * f) * Math.cos(step / 2);
      side.push([Math.sin(a) * rr, -hy + h * f, Math.cos(a) * rr]);
    }
    return { type: 'prism', planes, ends, verts: [...top, ...bot],
             samples: [...top, ...bot, ...side, [0, hy, 0], [0, -hy, 0]] };
  }
  if (g.t === 'box') {
    const { w, h, d } = g, X = w / 2, Y = h / 2, Z = d / 2;
    const planes = [[1, 0, 0, X], [-1, 0, 0, X], [0, 1, 0, Y], [0, -1, 0, Y], [0, 0, 1, Z], [0, 0, -1, Z]];
    const verts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) verts.push([sx * X, sy * Y, sz * Z]);
    const samples = [...verts, [0, 0, 0], ...planes.map((p) => [p[0] * p[3], p[1] * p[3], p[2] * p[3]])];
    // 六個面都是接合端候選;探針 = 該面 4 個角 + 4 個邊中點(邊中點 = 兩正交觀察軸)
    const ends = [];
    const faces = [[[1, 0, 0], X], [[-1, 0, 0], X], [[0, 1, 0], Y], [[0, -1, 0], Y], [[0, 0, 1], Z], [[0, 0, -1], Z]];
    for (const [nv, off] of faces) {
      const a = Math.abs(nv[0]) ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(nv, a)), v = norm(cross(nv, u));
      const eu = Math.abs(u[0]) * X + Math.abs(u[1]) * Y + Math.abs(u[2]) * Z;
      const ev = Math.abs(v[0]) * X + Math.abs(v[1]) * Y + Math.abs(v[2]) * Z;
      const c = [nv[0] * off, nv[1] * off, nv[2] * off];
      const at = (cu, cv) => [c[0] + u[0] * cu + v[0] * cv, c[1] + u[1] * cu + v[1] * cv, c[2] + u[2] * cu + v[2] * cv];
      // 外圈 K 支(索引 0=+v 4=+u 8=−v 12=−u,對齊 AX 兩組正交軸)+ 50% 內圈 K 支
      const ring = (f) => Array.from({ length: K }, (_, i) => {
        const phi = i * (Math.PI * 2 / K);
        return at(Math.sin(phi) * eu * f, Math.cos(phi) * ev * f);
      });
      ends.push({ probes: [...ring(1), ...ring(0.5)], axis: [-nv[0], -nv[1], -nv[2]], center: c,
                  axial: true, r: Math.max(eu, ev) });
    }
    return { type: 'box', planes, ends, verts, samples };
  }
  if (g.t === 'sphere') {
    // three SphereGeometry(r, wSeg, hSeg):φ 繞 y 一圈、θ 自 +y 往下。**刻意建成多面體**
    // 而不是理想球:貼壁特徵的錨點半徑用理想球半徑算,就會浮在「小面內縮」那一段的外面
    // (12×8 段的赤道小面內縮 ≈ 5% 半徑,r=75 的岩體就是 4m 的縫)。
    const { r, wSeg, hSeg } = g;
    const V = [];
    for (let iy = 0; iy <= hSeg; iy++) {
      const th = iy / hSeg * Math.PI;
      for (let ix = 0; ix <= wSeg; ix++) {
        const ph = ix / wSeg * Math.PI * 2;
        V.push([-r * Math.cos(ph) * Math.sin(th), r * Math.cos(th), r * Math.sin(ph) * Math.sin(th)]);
      }
    }
    const at = (ix, iy) => V[iy * (wSeg + 1) + ix];
    const planes = [];
    const tri = (a, b, c) => {                       // 凸多面體 ⇒ sd = max(nᵢ·p − dᵢ),法向朝外(d > 0)
      let nv = cross(sub(b, a), sub(c, a));
      if (len(nv) < 1e-9) return;
      nv = norm(nv);
      let d = dot(nv, a);
      if (d < 0) { nv = [-nv[0], -nv[1], -nv[2]]; d = -d; }
      planes.push([nv[0], nv[1], nv[2], d]);
    };
    for (let iy = 0; iy < hSeg; iy++) for (let ix = 0; ix < wSeg; ix++) {
      const a = at(ix, iy), b = at(ix, iy + 1), c = at(ix + 1, iy + 1), d2 = at(ix + 1, iy);
      if (iy !== 0) tri(a, b, d2);
      if (iy !== hSeg - 1) tri(b, c, d2);
    }
    const samples = V.filter((_, i) => i % 3 === 0);   // 取樣降頻:O(n²) 配對量不炸
    return { type: 'sphere', planes, verts: V, samples: [...samples, [0, 0, 0]],
             ends: [{ probes: samples, axis: null, center: [0, 0, 0], axial: false, r }] };
  }
  if (g.t === 'ico') {
    const verts = ICO_V.map((v) => [v[0] * g.r, v[1] * g.r, v[2] * g.r]);
    // 球狀簇沒有擠出軸 ⇒ 不做正交視角判定,只驗「整團有沒有黏到別的零件」
    return { type: 'ico', planes: hullPlanes(verts), verts, samples: [...verts, [0, 0, 0]],
             ends: [{ probes: verts, axis: null, center: [0, 0, 0], axial: false, r: g.r }] };
  }
  if (g.t === 'torus') {
    const { R, tube } = g;
    const verts = Array.from({ length: 12 }, (_, i) => {
      const a = i / 12 * Math.PI * 2; return [Math.sin(a) * R, 0, Math.cos(a) * R];
    });
    return { type: 'torus', torus: g, planes: null, ends: [{ probes: verts, axis: null, center: [0, 0, 0], axial: false, r: R }], verts };
  }
  return null;   // ring 等裝飾件
}

/** 局部 solid + 變換 → 世界空間求值器 */
function worldSolid(ls, xf, shell = false) {
  if (ls.torus) {
    const inv = xfInv(xf), { R, tube } = ls.torus;
    const vs = ls.verts.map((v) => xfPoint(xf, v));
    return { verts: vs, samples: vs,
      sd: (p) => { const q = xfPoint(inv, p); return Math.hypot(Math.hypot(q[0], q[2]) - R, q[1]) - tube; } };
  }
  const planes = ls.planes.map((pl) => {
    const n = xfNormal(xf, [pl[0], pl[1], pl[2]]);
    // 面上一點:局部法向乘 d 未必在面上(非等比縮放),取任一頂點投影最大者即該面
    let best = -Infinity;
    for (const v of ls.verts) best = Math.max(best, dot(n, xfPoint(xf, v)));
    return [n[0], n[1], n[2], best];
  });
  // shell = 半透明罩體(偽裝網/水面):它是一張皮,不是實心塊 ⇒ 距離取絕對值,
  // 「被它罩在裡面」不算接合(看得穿的東西遮不住縫),貼在皮上才算。
  // 皮厚 SKIN:多邊形化的網面本身就有這個量級的起伏(9 邊形外接半徑 vs 邊心距),
  // 不給厚度會把「貼在網上的色塊」誤判成脫離。
  const sdSolid = (p) => { let m = -Infinity;
    for (const q of planes) m = Math.max(m, q[0] * p[0] + q[1] * p[1] + q[2] * p[2] - q[3]);
    return m; };
  return {
    planes,                       // 世界空間面集(射線實測樁件 RaycasterStub 也吃這一份)
    verts: ls.verts.map((v) => xfPoint(xf, v)),
    samples: (ls.samples ?? ls.verts).map((v) => xfPoint(xf, v)),
    vol: bboxVol(ls.verts.map((v) => xfPoint(xf, v))),
    sd: shell ? (p) => Math.abs(sdSolid(p)) - SKIN : sdSolid,
  };
}
/** 半空間錨體(地面 / 樹皮面):n·p ≤ d 為內部 */
const halfSolid = (n, d) => ({ verts: [], sd: (p) => dot(n, p) - d });

/** 包圍盒體積(判斷「誰是主人、誰是插進去的構件」) */
function bboxVol(vs) {
  if (!vs.length) return 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of vs) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  return Math.max(1e-6, (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]));
}

/** 世界空間三軸尺寸(排序後 long ≥ mid ≥ short):用來判斷「長條件」 */
function extents(s) {
  const vs = s.w.verts;
  if (!vs.length) return { long: 0, mid: 0 };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of vs) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const e = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].sort((a, b) => b - a);
  return { long: e[0], mid: e[1], short: e[2] };
}

// ============================ 接合稽核 ============================
/**
 * @param parts [{ tag, ls, xf, tol?, subject? }]  subject:false = 只當錨體不受檢
 * @param anchors [solid]                          地面 / 樹皮等隱含錨體
 */
function auditJoints(parts, anchors = [], opt = {}) {
  const solids = parts.map((p) => ({ ...p, w: worldSolid(p.ls, p.xf, p.anchor === false) }));
  const n = solids.length;
  // ---- 接觸關係(雙向取樣:我的取樣點埋進你,或你的埋進我)----
  const gapTo = (a, b) => { let d = Infinity;
    for (const p of a.w.samples) d = Math.min(d, b.w.sd(p));
    for (const p of b.w.samples) d = Math.min(d, a.w.sd(p));
    return d; };
  const nn = solids.map(() => ({ gap: Infinity, who: '', j: -1 }));
  const touching = solids.map(() => []);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = gapTo(solids[i], solids[j]);
    if (d <= TOL) { touching[i].push(j); touching[j].push(i); }
    if (d < nn[i].gap) nn[i] = { gap: d, who: solids[j].tag, j };
    if (d < nn[j].gap) nn[j] = { gap: d, who: solids[i].tag, j: i };
  }
  const onGround = solids.map((s) => anchors.some((a) => s.w.samples.some((v) => a.sd(v) <= TOL)));
  const bodyI = solids.reduce((b, s, i) => (s.w.vol > solids[b].w.vol ? i : b), 0);   // 主體 = 量體最大者

  const rows = [];
  solids.forEach((self, i) => {
    if (self.subject === false) return;
    const others = solids.filter((_, j) => j !== i).map((s) => s.w).concat(anchors);
    const sdMin = (p) => { let m = Infinity; for (const o of others) m = Math.min(m, o.sd(p)); return m; };
    /** 最貼近該點的錨體序號(判「兩端支承」是不是撐在**兩個不同**的東西上) */
    const sdWho = (p) => { let m = Infinity, w = -1;
      others.forEach((o, k) => { const d = o.sd(p); if (d < m) { m = d; w = k; } }); return w; };
    const tol = self.tol ?? TOL;
    // 球狀簇 / 環(無擠出軸):只驗「有沒有黏到東西」,兩正交視角不適用
    if (!self.ls.ends.some((e) => e.axial)) {
      const glued = touching[i].length > 0 || onGround[i];
      rows.push({ tag: self.tag, flag: glued ? 'ok' : 'FLOAT', axial: false,
                  gap: +Math.max(0, nn[i].gap).toFixed(3), cover: glued ? '接觸' : `離 ${nn[i].who}` });
      return;
    }
    // 「主人」不受檢:比自己小的構件插進來(圍籬板 vs 立柱、樹幹 vs 枝),
    // 端面本來就不該被小構件填滿 —— 該驗的是那些小構件自己
    if (touching[i].length && touching[i].every((j) => solids[j].w.vol < self.w.vol * 0.95)) {
      rows.push({ tag: self.tag, flag: 'ok', axial: false, gap: 0, cover: '主人' });
      return;
    }
    // 貼面接合(sleeve/decal):接縫在**側面**而不在端面 —— 地衣環帶、剝落樹皮絲帶、
    // 纏繞藤蔓、貼幹樹瘤都是這一類,端面本來就露在外面。側面取樣有 ≥20% 埋進錨體
    // 就算接好(真的浮空的零件,側面一支都埋不進去)。
    const emb = self.w.samples.filter((p) => sdMin(p) <= tol).length / self.w.samples.length;
    if (emb >= 0.2) {
      rows.push({ tag: self.tag, flag: 'ok', axial: false, gap: 0, cover: `貼面 ${Math.round(emb * 100)}%` });
      return;
    }
    // 橫躺件:擠出軸接近水平又碰到地面(倒木/橫躺原木/車輪)—— 用側面躺在地上,
    // 端面(垂直的圓盤)本來就露在外面,拿端面判定接合沒有意義
    const upAx = self.ls.ends.map((e) => Math.abs(m3apply(self.xf.m, e.axis)[1] / (len(m3apply(self.xf.m, e.axis)) || 1)));
    if (onGround[i] && Math.min(...upAx) < 0.35) {
      rows.push({ tag: self.tag, flag: 'ok', axial: false, gap: 0, cover: '橫躺觸地' });
      return;
    }
    let best = null;
    for (const end of self.ls.ends) {
      if (!end.axial) continue;
      const ds = end.probes.map((p) => sdMin(xfPoint(self.xf, p)));
      // 某方向的接縫是否密合:外緣或 50% 內圈任一貼合即算(簷/凸沿不算縫)
      const dirGap = (k) => Math.min(ds[k], ds[k + K]);
      const cand = { end, ds, inside: ds.filter((d) => d <= tol).length, min: Math.min(...ds),
                     mid: sdMin(xfPoint(self.xf, end.center)),                  // 端面中心是否被貫穿
                     viewA: Math.max(dirGap(AX[0]), dirGap(AX[2])),             // 沿局部 x 看 → 量 ±z
                     viewB: Math.max(dirGap(AX[1]), dirGap(AX[3])) };           // 沿局部 z 看 → 量 ±x
      // 兩端支承(樑):接合面沿某一軸的**兩個相反端**各自貼在**不同**的錨體上 —— 石楣架在兩根
      // 立石上、橫樑跨兩柱,中段懸空是構造本身,不是接合不良。「不同錨體」這一條 MUST 保留:
      // 兩端貼在**同一個**錨體上正是「板根鰭誤轉成切向」的指紋(沿樹幹一條線貼著、兩側翹起),
      // 少了它就會把本工具最初要抓的那類病灶一併放過。
      const bridged = (k1, k2) => {
        const g1 = dirGap(k1), g2 = dirGap(k2);
        if (g1 > tol || g2 > tol) return false;
        const at = (k) => xfPoint(self.xf, end.probes[ds[k] <= ds[k + K] ? k : k + K]);
        return sdWho(at(k1)) !== sdWho(at(k2));
      };
      cand.bridge = bridged(AX[0], AX[2]) || bridged(AX[1], AX[3]);
      // 中心被貫穿 = 零件是「套在錨體上」(樹冠罩、屋頂、竹葉冠):接縫在中心,外緣本該騰空
      cand.score = cand.mid <= tol || cand.bridge ? 1e3 - Math.min(cand.mid, 0) : -Math.max(cand.viewA, cand.viewB);
      if (!best || cand.score > best.score) best = cand;
    }
    const orthoWorst = Math.max(best.viewA, best.viewB);
    let flag = 'ok';
    if (best.mid > tol && orthoWorst > tol && !best.bridge) flag = best.min > tol ? 'FLOAT' : 'PARTIAL';
    rows.push({ tag: self.tag, flag, axial: true, gap: +orthoWorst.toFixed(3),
                viewA: +best.viewA.toFixed(3), viewB: +best.viewB.toFixed(3),
                cover: best.bridge ? '兩端支承' : `${best.inside}/${best.end.probes.length}` });
  });

  // ---- 連通性:接觸圖 + 地面接觸;連不回主體/地面那組 = 整串脫落 ----
  const par = Array.from({ length: n + 1 }, (_, i) => i);   // n = 地面節點
  const find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  for (let i = 0; i < n; i++) { if (onGround[i]) uni(i, n); for (const j of touching[i]) uni(i, j); }
  const loose = solids.map((s, i) => (s.subject !== false && find(i) !== find(n) ? s.tag : null)).filter(Boolean);

  // ---- 與主體無接觸的長條件(整群一起看:誤轉 90° 的板根鰭會彼此相碰成一圈柵欄,
  // 逐件看反而全都「有接觸」)。判準:該群連不到主體,而群內某長條件到群外零件的縫
  // 比它自己還短 ⇒ 把它轉/挪向主體就會接上,擺位或旋轉方向十分可疑。
  // 真的刻意散置的地面道具(沙包圈/碎石裙/土丘),縫都遠大於自身尺寸或不是長條件。
  const par2 = Array.from({ length: n }, (_, i) => i);
  const find2 = (x) => { while (par2[x] !== x) x = par2[x] = par2[par2[x]]; return x; };
  for (let i = 0; i < n; i++) for (const j of touching[i]) { const a = find2(i), b = find2(j); if (a !== b) par2[a] = b; }
  const lone = [];
  if (!opt.scatter) solids.forEach((self, i) => {
    if (self.subject === false || find2(i) === find2(bodyI)) return;
    const ext = extents(self);
    // 只看「構件」:柱/錐/盒(桿件、鰭板、藤條)。ico 一律是團狀簇(土丘/岩塊/葉團),
    // 本來就是散置道具,不套此規則。60cm 以下的小件(菇柄/小枯枝)看不出來,也不看。
    if (self.ls.type === 'ico' || self.ls.type === 'torus') return;
    if (ext.long < 0.6 || ext.long < ext.short * 2.2) return;
    let gap = Infinity, who = '';
    for (let j = 0; j < n; j++) if (find2(j) !== find2(i)) {
      const d = gapTo(self, solids[j]); if (d < gap) { gap = d; who = solids[j].tag; }
    }
    if (gap > TOL && gap < ext.mid) lone.push({ tag: self.tag, gap: +gap.toFixed(2), who, size: +ext.mid.toFixed(2) });
  });
  return { rows, loose, lone };
}

// ============================ 幾何樁件 ============================
const geoStub = (dn) => ({
  cyl: (r1, r2, h, n = dn) => ({ t: 'prism', r1, r2, h, n }),
  cone: (r, h, n = dn) => ({ t: 'prism', r1: 0, r2: r, h, n }),
  ico: (r) => ({ t: 'ico', r }),
  box: (w, h, d) => ({ t: 'box', w, h, d }),
});
const colorStub = () => { const c = { multiplyScalar: () => c, offsetHSL: () => c, clone: () => c, setRGB: () => c, set: () => c, getHex: () => 0 }; return c; };
const THREE_STUB = {
  Color: class { constructor() { return colorStub(); } }, Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    // set/copy MUST 真的存值:biomes.js 的 rockProbe 拿 Vector3 當射線起點/方向(空殼 = 永遠射原點)
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    fromBufferAttribute() { return this; } multiply() { return this; }
    applyQuaternion() { return this; } add() { return this; } sub() { return this; } normalize() { return this; } },
  Quaternion: class { setFromEuler() { return this; } copy() { return this; } invert() { return this; } },
  BoxGeometry: class { constructor(w, h, d) { this.t = 'box'; this.w = w; this.h = h; this.d = d; } },
  SphereGeometry: class { constructor(r, wSeg = 8, hSeg = 6) { this.t = 'sphere'; this.r = r; this.wSeg = wSeg; this.hSeg = hSeg; } },
  TorusGeometry: class { constructor(R, tube) { this.t = 'torus'; this.R = R; this.tube = tube; } },
  RingGeometry: class { constructor() { this.t = 'ring'; } },
  MeshBasicMaterial: class { constructor(o = {}) { Object.assign(this, o); } },
  MeshToonMaterial: class { constructor(o = {}) { Object.assign(this, o); } },
  Mesh: null, Group: null, DoubleSide: 2,
};

// ============================ hazards.js:BUILDERS ============================
const hzSrc = fs.readFileSync(path.join(ROOT, 'public/js/hazards.js'), 'utf8');
const hzBlock = hzSrc.match(/const BUILDERS = \{[\s\S]*?\n\};/);
if (!hzBlock) { console.error('抽不到 hazards.js 的 BUILDERS'); process.exit(1); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class Node3 {
  constructor(geo = null) {
    this.geo = geo; this.children = [];
    this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; },
                   setScalar(v) { this.x = this.y = this.z = v; return this; },
                   multiplyScalar(v) { this.x *= v; this.y *= v; this.z *= v; return this; } };
    this.material = {}; this.userData = {};
    this.geometry = { attributes: { position: { count: 0 }, normal: { count: 0, setXYZ() {}, needsUpdate: false } } };
  }
  add(...cs) { this.children.push(...cs); return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); return this; }
  updateMatrixWorld() { return this; }   // 樁件的變換每次現算(xfOf),不需快取
}
/** 節點子樹 → [{ ls, xf }](xf 自該節點自身的局部變換起算,與真品 g 未套放置變換時的世界座標同義) */
function flattenSolids(node, parentXf = IDENT, out = []) {
  const xf = xfMul(parentXf, xfOf(node));
  if (node.geo) { const ls = localSolid(node.geo); if (ls) out.push({ ls, xf }); }
  for (const c of node.children) flattenSolids(c, xf, out);
  return out;
}
/** 射線 vs 凸多面體({p : nᵢ·p ≤ dᵢ}):slab 法求進出區間,回傳進入參數(正面命中)或 null */
function rayConvex(planes, o, d) {
  let tIn = -Infinity, tOut = Infinity;
  for (const [nx, ny, nz, dd] of planes) {
    const den = nx * d[0] + ny * d[1] + nz * d[2];
    const num = dd - (nx * o[0] + ny * o[1] + nz * o[2]);
    if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
    const t = num / den;
    if (den > 0) tOut = Math.min(tOut, t); else tIn = Math.max(tIn, t);
  }
  const t0 = Math.max(tIn, 0);
  return tOut >= t0 ? t0 : null;
}
/** three 的 Raycaster / Box3 樁件:巨岩表面實測(biomes.js rockProbe)靠它們吃到真幾何。
 *  只實作 rockProbe 用到的介面;命中取「進入點」= three 只認正面(FrontSide)的等價語意。 */
class RaycasterStub {
  constructor() { this.far = Infinity; this.ray = { origin: [0, 0, 0], direction: [0, 0, 1] }; }
  set(o, d) {
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    this.ray = { origin: [o.x, o.y, o.z], direction: [d.x / l, d.y / l, d.z / l] };
    return this;
  }
  intersectObjects(list) {
    const hits = [];
    for (const obj of list) for (const { ls, xf } of flattenSolids(obj)) {
      if (!ls.planes) continue;                       // 環(torus)不參與實測
      const w = worldSolid(ls, xf);
      const t = rayConvex(w.planes, this.ray.origin, this.ray.direction);
      if (t != null && t <= this.far) hits.push({ distance: t });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }
}
class Box3Stub {
  setFromObject(root) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const { ls, xf } of flattenSolids(root)) for (const v of ls.verts) {
      const p = xfPoint(xf, v);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
    this.min = { x: lo[0], y: lo[1], z: lo[2] };
    this.max = { x: hi[0], y: hi[1], z: hi[2] };
    return this;
  }
}
const xfOf = (o) => ({
  m: eulerM3(o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z),
  t: [o.position.x, o.position.y, o.position.z],
});

function buildHazardParts(kind, seed, r) {
  const g = new Node3();
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const G = geoStub(6);
  const THREE = { ...THREE_STUB, Mesh: class extends Node3 { constructor(geo) { super(geo); } }, Group: class extends Node3 {} };
  const mesh = (parent, geo, color, x = 0, y = 0, z = 0, opts = {}) => {
    const m = new Node3(geo); m.position.set(x, y, z); parent.add(m);
    m.seeThrough = !!opts.transparent;   // 半透明件(偽裝網/水面/火舌)不能當錨體:看得穿的東西遮不住縫
    return m;
  };
  // chiselRock:ico(r,1) 42 個相異頂點各抽 1 枚 ⇒ 樁件必須照抽 42 枚保住亂數序
  const rockMesh = (parent, size, rn, color, x, y, z) => {
    for (let i = 0; i < 42; i++) rn();
    const m = new Node3({ t: 'ico', r: size, rock: true }); m.position.set(x, y, z); parent.add(m); return m;
  };
  const jitterColor = (hex, rn) => { rn(); rn(); rn(); return colorStub(); };   // offsetHSL 三個引數 = 3 枚
  const BUILDERS = new Function('mesh', 'box', 'cyl', 'cone', 'ico', 'rockMesh', 'jitterColor', 'THREE', 'Math',
    hzBlock[0].replace('const BUILDERS =', 'return'))(
    mesh, G.box, G.cyl, G.cone, G.ico, rockMesh, jitterColor, THREE, Math);
  if (!BUILDERS[kind]) return null;
  BUILDERS[kind](g, r, rnd);
  // 攤平零件樹(Group 嵌套變換一併算進去)
  const parts = [];
  const walk = (node, parentXf, trail) => {
    const xf = xfMul(parentXf, xfOf(node));
    if (node.geo) {
      const ls = localSolid(node.geo);
      if (ls) parts.push({ tag: `${trail}${node.geo.t}`, ls, xf, anchor: !node.seeThrough,
                           tol: node.geo.rock ? 0.35 : TOL, rock: !!node.geo.rock });
    }
    node.children.forEach((c, i) => walk(c, xf, `${trail}${node.geo ? '' : ''}${i}.`));
  };
  walk(g, IDENT, '');
  return parts;
}

// 刻意不相接的物件:整體略過(skip)或只放寬「散置」規則(scatter = 不套 ISOLATED、
// loose = 不套連通性)。每一條都要寫得出理由 —— 沒理由的豁免就是把 bug 藏起來。
const HZ_EXEMPT = {
  fire: { skip: '火舌與煙柱刻意離地飄浮(逐幀閃爍動畫)' },
  flood: { skip: '水面漣漪圈與露頭雜物刻意不相接' },
  construction: { scatter: '施工圍籬/三角錐/鷹架各自散置,本來就不相連' },
  wreck: { scatter: 1, loose: 1, joints: '2~3 台獨立殘骸各自翻覆/斜插:翻車的車輪朝天懸空、'
    + '正立的車輪跨越輪拱線只半埋 —— 端面接合判定不適用' },
  landslide: { scatter: '土石流舌狀堆:落石與倒木散置' },
  rockfall: { scatter: '落石群散置' },
  sinkhole: { scatter: '塌陷傾斜裂板各自翹起' },
  pothole: { scatter: '坑緣碎裂柏油塊散置' },
};

// ============================ biomes.js:植被 / 神木 ============================
const bmSrc = fs.readFileSync(path.join(ROOT, 'public/js/biomes.js'), 'utf8');
function pick(re, what) {
  const m = bmSrc.match(re);
  if (!m) { console.error(`抽不到 biomes.js 的 ${what}`); process.exit(1); }
  return m[0];
}
const defs = (() => {
  const G = geoStub(5);   // biomes.js 的 cyl/cone 預設 n = 5
  const code = [
    pick(/const bough = \(\) => \[[\s\S]*?\n\];/, 'bough'),
    pick(/const VEG_DEFS = \{[\s\S]*?\n\};/, 'VEG_DEFS'),
    pick(/const GIANT_DEFS = \{[\s\S]*?\n\};/, 'GIANT_DEFS'),
    pick(/const GIANT_DECO = \{[\s\S]*?\n\};/, 'GIANT_DECO'),
    'return { VEG_DEFS, GIANT_DEFS, GIANT_DECO };',
  ].join('\n');
  return new Function('cyl', 'cone', 'ico', 'THREE', 'Math', code)(G.cyl, G.cone, G.ico, THREE_STUB, Math);
})();

/** 宣告式零件表 → 稽核零件(實例變換走 xform.js 的 vegPartXform 單一縫) */
function vegParts(def, it) {
  const parts = [];
  def.parts.forEach((part, i) => {
    const ls = localSolid(part.g);
    if (!ls) return;
    const { pos, quat, scl } = vegPartXform(part, it);
    parts.push({ tag: `#${i} ${part.g.t}`, ls, xf: { m: quatM3(quat, scl[0], scl[1], scl[2]), t: pos } });
  });
  return parts;
}

// ============================ biomes.js:巨岩(岩體 + 表面特徵)============================
// 巨岩 = 岩體(名岩 `build` / `synthMegalith`)+ 表面特徵(`decorateMegalith`:峭壁樹/岩菇/
// 石砌屋/疊石堆/鳥巢台/高壓電塔)。特徵的錨點半徑是**推算**出來的(側壁橢圓 `er` × 高度
// 收縮 `f`),推錯一步整棵樹就浮在半空 —— 與神木樹根脫節同一族的病灶,故一併納入本工具。
// 岩體本身也受檢(疊石/柱束/刃嶺各自著地,故一律走 scatter:只放寬 ISOLATED,FLOAT/DETACHED 照判)。
const megal = (() => {
  const G = geoStub(5);
  const code = [
    pick(/const MEGALITHS = \{[\s\S]*?\n\};/, 'MEGALITHS'),
    // `[^\n]*` 而非 `.*`:JS 的 `.` 不吃 `\r`,CRLF 檢出(Windows core.autocrlf)會整支抽不到原文
    pick(/const _rcO = new THREE\.Vector3[^\n]*\n/, 'rockProbe 的射線暫存'),
    pick(/function rockProbe\(g\) \{[\s\S]*?\n\}/, 'rockProbe'),
    pick(/const ROCK_TONES = \[[\s\S]*?\];/, 'ROCK_TONES'),
    pick(/function synthMegalith\(g, rnd\) \{[\s\S]*?\n\}/, 'synthMegalith'),
    pick(/function decorateMegalith\(g, anchor, rnd, s\) \{[\s\S]*?\n\}/, 'decorateMegalith'),
    'return { MEGALITHS, synthMegalith, decorateMegalith };',
  ].join('\n');
  const THREE = { ...THREE_STUB, Mesh: class extends Node3 { constructor(geo) { super(geo); } }, Group: class extends Node3 {},
                  Raycaster: RaycasterStub, Box3: Box3Stub };
  const mat = () => ({});
  const box = (w, h, d, c, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh({ t: 'box', w, h, d }); m.position.set(x, y + h / 2, z); return m;
  };
  // 高壓電塔本體的接合歸 LANDMARKS 稽核(不在本節範圍);此處只驗它有沒有站在岩頂上,
  // 故以「與真品同佔地」的樁件代表:LANDMARK_COL.power r=2.6 h=42(不消耗 rnd)
  const LANDMARKS = { power: (g) => { const m = new THREE.Mesh({ t: 'prism', r1: 2.6, r2: 2.6, h: 42, n: 4 }); m.position.set(0, 21, 0); g.add(m); } };
  const mod = new Function('cyl', 'cone', 'ico', 'box', 'rockMat', 'toonMat', 'LANDMARKS', 'THREE', 'Math', code)(
    G.cyl, G.cone, G.ico, box, mat, mat, LANDMARKS, THREE, Math);
  return { ...mod, THREE };
})();

/** 巨岩一顆 → { parts(世界公尺:根變換 = 放置縮放 s;local y=0 在地表下 1.5m), main } */
function megalithParts(name, seed, s) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const g = new megal.THREE.Group();
  const meta = name === '合成' ? megal.synthMegalith(g, rnd)
    : (megal.MEGALITHS[name].build(g, rnd), megal.MEGALITHS[name]);
  const nBody = g.children.length;   // 之後加進來的都是 decorateMegalith 的表面特徵
  megal.decorateMegalith(g, meta.anchor, rnd, s);
  const parts = [];
  const walk = (node, parentXf, trail) => {
    const xf = xfMul(parentXf, xfOf(node));
    if (node.geo) {
      const ls = localSolid(node.geo);
      // 岩體本身是多塊拼接的粗獷量體(小面內縮/塊間節理縫):容差比一般零件寬,與 hazards 的
      // rock 件同一量級。**表面特徵一律吃嚴格容差** —— 落點是實測出來的,就該貼死。
      // 標籤帶尺寸:巨岩一顆有 20~40 塊同型零件,光靠序號認不出是哪一塊出問題
      const G2 = node.geo;
      const dim = G2.t === 'box' ? `${G2.w}×${G2.h}×${G2.d}`
        : G2.t === 'prism' ? `r${G2.r1}/${G2.r2}×${G2.h}` : `r${G2.r ?? ''}`;
      if (ls) parts.push({ tag: `${trail}${G2.t}(${dim})`, ls, xf, tol: trail.startsWith('岩體') ? 0.35 : TOL });
    }
    node.children.forEach((c, i) => walk(c, xf,
      trail ? `${trail}${i}.` : `${i < nBody ? '岩體' : '特徵'}${i}.`));
  };
  walk(g, { m: [s, 0, 0, 0, s, 0, 0, 0, s], t: [0, 0, 0] }, '');
  return { parts, main: meta.main || name };
}

// ============================ 執行 ============================
const GROUND = halfSolid([0, 1, 0], 0);          // 地面:y ≤ 0 為土裡(埋入)
let bad = 0, checked = 0, info = 0;
const out = [];
const say = (s) => out.push(s);

function report(title, { rows, loose, lone }, note = '') {
  const hit = rows.filter((r) => r.flag !== 'ok');
  checked += rows.length;
  if (!hit.length && !loose.length && !lone.length && !SHOW_ALL) return;
  say(`\n== ${title} ==${note ? '  ' + note : ''}`);
  for (const r of (SHOW_ALL ? rows : hit)) {
    const v = r.axial ? `視角A=${r.viewA.toFixed(2)} 視角B=${r.viewB.toFixed(2)}` : '(球狀簇:只驗連通)';
    say(`  ${r.flag.padEnd(8)} ${r.tag.padEnd(16)} 縫=${String(r.gap).padStart(6)}m ${v} 埋入=${r.cover}`);
  }
  if (loose.length) say(`  DETACHED 整串脫離主體:${loose.join(', ')}`);
  for (const l of lone) say(`  ISOLATED ${l.tag.padEnd(16)} 與主體無接觸:離 ${l.who} ${l.gap}m < 自身 ${l.size}m(轉/挪向主體就會接上)`);
  bad += hit.length + loose.length + lone.length;
}

// ---- 障礙物(hazards.js)----
const hzKinds = Object.keys(HAZARDS).filter((k) => !HAZARDS[k].noModel).concat(['aasite', 'relay']);
for (const kind of hzKinds) {
  if (ONLY && !kind.includes(ONLY)) continue;
  const ex = HZ_EXEMPT[kind] || {};
  if (ex.skip) { say(`\n== 障礙物 ${kind} == 略過:${ex.skip}`); continue; }
  const why = [ex.scatter, ex.loose, ex.joints].find((v) => typeof v === 'string');
  if (why) say(`\n== 障礙物 ${kind} == 放寬:${why}`);
  // 實例尺寸 sc = 0.75~1.35(sim.js 每個障礙隨機):r 會縮放,但零件裡的絕對高度不會
  // ⇒ 兩端都要驗,否則只在標準尺寸下接得起來的擺位會漏掉
  for (const sc of [0.75, 1, 1.35]) {
    const r = Math.round(((HAZARDS[kind]?.r ?? 8) * sc) * 100) / 100;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const parts = buildHazardParts(kind, seed, r);
      if (!parts) continue;
      const res = auditJoints(parts, [GROUND], { scatter: !!ex.scatter });
      if (ex.loose) res.loose = [];
      if (ex.joints) res.rows = res.rows.map((r2) => ({ ...r2, flag: 'ok' }));
      report(`障礙物 ${kind}(seed ${seed}, r ${r})`, res);
    }
  }
}

// ---- 神木本體 / 一般植被(biomes.js;實例朝向與微傾斜都要驗)----
// 細節抖動(xform.js dj 縫,2026-07-29):半徑抖動 + 繞自身軸自轉之下接合 MUST 仍成立
// —— dj 是連續種子無法窮舉,抽三個相異種子取樣(每零件的抖動由 hash(零件識別, dj) 決定,
// 不同 dj 掃到不同的振幅組合)。
const INSTANCES = [
  { name: '正株', it: { x: 0, y: 0, z: 0, s: 1, ry: 0, tx: 0, tz: 0 } },
  { name: '轉向+微傾', it: { x: 0, y: 0, z: 0, s: 1, ry: 1.1, tx: 0.025, tz: -0.025 } },
  { name: '抖動A', it: { x: 0, y: 0, z: 0, s: 1, ry: 0.7, tx: 0.02, tz: 0.01, dj: 0.137 } },
  { name: '抖動B', it: { x: 0, y: 0, z: 0, s: 1, ry: 2.9, tx: -0.02, tz: 0.03, dj: 0.548 } },
  { name: '抖動C', it: { x: 0, y: 0, z: 0, s: 1, ry: 4.4, tx: 0.01, tz: -0.03, dj: 0.923 } },
];
for (const [group, table] of [['神木', defs.GIANT_DEFS], ['植被', defs.VEG_DEFS]]) {
  for (const [name, def] of Object.entries(table)) {
    if (ONLY && !name.includes(ONLY)) continue;
    for (const inst of INSTANCES) report(`${group} ${name}(${inst.name})`, auditJoints(vegParts(def, inst.it), [GROUND]));
  }
}
// ---- 巨木表面特徵(掛在樹皮上:local +x 徑向外 ⇒ 錨體 = 樹皮半空間 x ≤ 0)----
const BARK = halfSolid([-1, 0, 0], 0);
for (const [name, def] of Object.entries(defs.GIANT_DECO)) {
  if (ONLY && !name.includes(ONLY)) continue;
  for (const inst of INSTANCES) {
    // 特徵件不吃植株微傾斜(世界尺寸恆定);dj 自 2026-08-05 起由 hang() 以落點雜湊給
    // ⇒ 接合 MUST 在細節抖動之下仍成立(與神木/植被同一組抽樣種子)
    const it = { ...inst.it, tx: 0, tz: 0 };
    report(`巨木特徵 ${name}(${inst.name})`, auditJoints(vegParts(def, it), [BARK]), '錨體=樹皮面');
  }
}

// ---- 巨岩:岩體 + 表面特徵(錨體 = 地面;巨岩擺放時 local y=0 沉在地表下 1.5m)----
// 合成巨岩的主體型別是第 4 枚亂數決定的(11 型),用足量種子把每型都掃到。
const MEGA_S = [0.9 * 1.35, 1.4 * 1.35];   // placeMegaliths:s = (0.9~1.4) × OVER.mega
for (const name of ['合成', ...Object.keys(megal.MEGALITHS)]) {
  if (ONLY && !name.includes(ONLY)) continue;
  const ss = name === '合成' ? MEGA_S : megal.MEGALITHS[name].s.map((v) => v * 1.35);
  const nSeed = name === '合成' ? SEEDS * 6 : SEEDS;
  for (const s of ss) {
    for (let seed = 1; seed <= nSeed; seed++) {
      const { parts, main } = megalithParts(name, seed, s);
      report(`巨岩 ${name}/${main}(seed ${seed}, s ${s.toFixed(2)})`,
             auditJoints(parts, [halfSolid([0, 1, 0], 1.5 * s)], { scatter: true }),
             '錨體=地面');
    }
  }
}

console.log(out.join('\n') || '(無異常)');
console.log(`\n檢查 ${checked} 個接合;異常 ${bad} 項`
  + `  容許縫 ${TOL}m  探針 ${K}×2 支/接合面(外緣 + 50% 內圈,含 2 組正交觀察軸)`);
process.exit(bad ? 1 : 0);
