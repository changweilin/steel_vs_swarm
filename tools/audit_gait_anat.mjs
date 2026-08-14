// ============ 解剖學步態曲線(前肢 vs 後肢的時序拓樸)稽核 ============
// 用途:改 `public/js/gaitcurve.js` 的任一條曲線/站姿型/佔空比、`locomotion.js` 的
// `flexChain`·`stepQuad`·`stepBiped`·`stepAerial`·`stepJumpPose`、`forge/forge.js` 的
// rig `limb` 欄,或任一台機體的 `gait.limb` 之後跑。
//
// 2026-08-15 使用者:「射擊/奔跑/奔跑射擊/飛行/飛行射擊/跳躍/大跳躍等不符合真實動作……
// 特別注意各個動物前腳肱骨/尺骨/掌骨與後腳股骨/脛骨/蹠骨,不同機體加入細部差異化」。
//
// 本支釘死的是**會靜默壞掉的那幾條**(壞了畫面上只讀成「動起來怪怪的」,沒有錯誤訊息):
//
//  Ⅰ 前後肢是兩種拓樸,不是同一條曲線換係數
//     ① 前肢腕(橈尺↔掌)支撐相**鎖死**:支撐段的擺幅 ≪ 擺動段的峰值(承重柱);
//     ② 後肢跗/飛節(脛↔蹠)支撐相**有真正的峰**(吃重下沉的彈簧);
//     ③ 後肢 膝↔跗 **同相**(交互韌帶裝置)、前肢 肘↔腕 **不同相**(一鎖一甩);
//     ④ 後肢膝是**雙峰**(支撐 + 擺動),前肢肘的支撐峰遠小於它。
//     這四條任一翻掉 = 前後腿又長回一模一樣,而每一條既有斷言照樣全綠。
//  Ⅱ 佔空比 —— 慢步 > 小跑 > 襲步,且襲步 < 0.5(騰空相是它的**結果**不是另畫的動畫);
//     `dutyOf` 隨襲步混成度連續(不瞬跳)。
//  Ⅲ 髖驅動不滑步 —— 支撐相角速度**近乎定值**(等速後掠),而舊制的純正弦兩端慢中間快;
//     兩段在接縫上值連續、端點斜率為 0(否則每一步頓一下)。
//  Ⅳ 站姿型差異化 —— 柱狀(象)遠端行程 < 蹠行 < 趾行;蹄行的鎖死度 > 趾行;
//     現役機體逐台解析得出來且**至少涵蓋三種站姿**(不是全部退化成同一種)。
//  Ⅴ 站姿不被步態改掉 —— `limbFlex` 在 amp = 0 時**恆回 0**(逐機 `base` 就是量出來的站姿角,
//     疊靜態偏移 = 站姿被曲線改掉);曲線兩段在接縫上同值(每步兩次角度跳變)。
//  Ⅵ 接線 —— locomotion 真的把 fore/hind 分開餵、鷹架真的把 `limb` 交到 rig 上、
//     `?gait=0` killswitch 在冊(A/B 前後對照的落點)、gaitcurve.js **零 import**。
//  Ⅶ 跳躍分級 —— 大跳(蓄力跳)與小跳的落地深度與頂點收腿**不是同一組數**;
//     舊制 airF 在 1.1m 飽和 ⇒ 兩者逐幀相同。
//  Ⅷ 交戰姿態 —— 移動中開火收斂骨盆對轉(奔跑射擊)、飛行開火鳥類停拍而昆蟲**不停拍**。
//
// 跑法:`node tools/audit_gait_anat.mjs`
// 反向驗證:`--break-lock`(腕改吃跗節曲線)/ `--break-duty`(佔空比恆 0.5)/
//           `--break-hip`(髖改回純正弦)/ `--break-rest`(站姿疊靜態偏移)/
//           `--break-posture`(站姿型全部退化成同一份行程)
import { readSrc } from './audit_src.mjs';
import * as G from '../public/js/gaitcurve.js';

const BRK = new Set(process.argv.slice(2).filter((a) => a.startsWith('--break-')).map((a) => a.slice(8)));
const locoSrc = readSrc('public', 'js', 'locomotion.js');
const forgeSrc = readSrc('public', 'js', 'forge', 'forge.js');
const gcSrc = readSrc('public', 'js', 'gaitcurve.js');

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const f2 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

// ── 壞版注入(反向驗證;每一支都 MUST 讓對應條目紅字)────────────────────────
const jointFlex = (role, i, u, duty) => {
  if (BRK.has('lock') && role === 'fore' && i === 1) return G.jointFlex('hind', 1, u, duty);
  return G.jointFlex(role, i, u, duty);
};
const dutyOf = (g, gal) => (BRK.has('duty') ? 0.5 : G.dutyOf(g, gal));
const hipDrive = (u, d) => (BRK.has('hip') ? Math.sin(2 * Math.PI * (u - 0.25)) : G.hipDrive(u, d));
const limbFlex = (P, i, u, d, a) => G.limbFlex(P, i, u, d, a) + (BRK.has('rest') ? 0.25 : 0);
const limbProfile = (l) => {
  const p = G.limbProfile(l);
  if (BRK.has('posture')) { p.fore.reach = [1, 1, 1]; p.hind.reach = [1, 1, 1]; p.fore.lock = 0.2; p.hind.lock = 0.2; }
  return p;
};

/** 一整個週期的取樣(N 點),分成支撐段與擺動段 */
// LOAD_F:支撐相「真的在承重」的那一段(末段 15% 是卸載/蹬離,腕本來就在那時開始解鎖 ——
// 拿整個支撐段量「鎖不鎖」會把離地前的解鎖算成沒鎖住,那是量錯不是壞掉)
const LOAD_F = 0.85;
function scan(role, i, duty, N = 720) {
  const st = [], sw = [], all = [], ld = [];
  for (let n = 0; n < N; n++) {
    const u = n / N, v = jointFlex(role, i, u, duty);
    all.push(v);
    if (u < duty) { st.push(v); if (u < duty * LOAD_F) ld.push(v); } else sw.push(v);
  }
  const rng = (v) => Math.max(...v) - Math.min(...v);
  return { all, st, sw, ld, ldRange: rng(ld), stRange: rng(st), swPeak: Math.max(...sw), stPeak: Math.max(...st), range: rng(all) };
}
const corr = (a, b) => {
  const n = Math.min(a.length, b.length);
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; sa += da * da; sb += db * db; }
  return sab / Math.sqrt(sa * sb || 1e-12);
};

const DT = G.GAIT_DUTY.trot;

console.log('\nⅠ 前肢 vs 後肢的時序拓樸(肱/橈尺/掌 ↔ 股/脛/蹠)');
const foreEl = scan('fore', 0, DT), foreCa = scan('fore', 1, DT);
const hindSt = scan('hind', 0, DT), hindHk = scan('hind', 1, DT);
console.log(`    前 腕 承重段擺幅 ${f2(foreCa.ldRange)} / 擺動峰 ${f2(foreCa.swPeak)}`
  + ` ｜ 後 跗 承重段擺幅 ${f2(hindHk.ldRange)} / 支撐峰 ${f2(hindHk.stPeak)}`);
t('① 前肢腕:承重段鎖死(擺幅 < 擺動峰的 1/8)',
  foreCa.ldRange < foreCa.swPeak / 8, `(${f2(foreCa.ldRange)} vs ${f2(foreCa.swPeak / 8)})`);
t('② 後肢跗:支撐相有真正的峰(≥ 0.45,是彈簧不是柱)',
  hindHk.stPeak >= 0.45, `(${f2(hindHk.stPeak)})`);
t('②b 同一個位置上前後差一個量級(後跗承重段擺幅 ≥ 前腕的 5 倍)',
  hindHk.ldRange >= foreCa.ldRange * 5, `(${f2(hindHk.ldRange)} vs ${f2(foreCa.ldRange * 5)})`);
// 相關性 MUST 只量**支撐段** —— 整個週期都被那個共同的擺動峰主導,兩條鏈在那裡本來就像,
// 前後肢真正分家的地方在承重的那半週期(後肢兩節一起吃重、前肢一節吃重一節鎖著)。
const cHind = corr(hindSt.st, hindHk.st), cFore = corr(foreEl.st, foreCa.st);
console.log(`    支撐段相關:後 膝↔跗 ${f2(cHind)} ｜ 前 肘↔腕 ${f2(cFore)}`);
t('③ 後肢 膝↔跗 支撐段同相(交互韌帶裝置;相關 ≥ 0.8)', cHind >= 0.8, `(${f2(cHind)})`);
t('③b 前肢 肘↔腕 支撐段不同相(相關比後肢低 0.5 以上)',
  cFore <= cHind - 0.5, `(前 ${f2(cFore)} / 後 ${f2(cHind)})`);
// ④ 雙峰:支撐峰相對於自身常屈角的凸起量
const bump = (s, role, i) => s.stPeak - G.restOf(role, i);
const bH = bump(hindSt, 'hind', 0), bF = bump(foreEl, 'fore', 0);
t('④ 後肢膝雙峰(支撐凸起 ≥ 前肢肘的 2 倍 = 後腿吃重、前肢是柱)',
  bH >= bF * 2, `(後 ${f2(bH)} / 前 ${f2(bF)})`);

console.log('\nⅡ 佔空比(支撐相佔比;騰空相是它的結果)');
const dW = dutyOf('walk', 0), dT = dutyOf('trot', 0), dG = dutyOf('trot', 1);
console.log(`    慢步 ${f2(dW)} ＞ 小跑 ${f2(dT)} ＞ 襲步 ${f2(dG)}`);
t('① 慢步 > 小跑 > 襲步', dW > dT && dT > dG, `(${f2(dW)}/${f2(dT)}/${f2(dG)})`);
t('② 慢步 > 0.5(恆有腳在地上)且襲步 < 0.5(才有騰空相)', dW > 0.5 && dG < 0.5);
t('③ 三角步態 > 0.5(六足恆三足觸地是結構要求)', dutyOf('tripod', 0) > 0.5);
let mono = true, prev = dutyOf('trot', 0);
for (let n = 1; n <= 50; n++) { const d = dutyOf('trot', n / 50); if (d > prev + 1e-12) mono = false; prev = d; }
t('④ 隨襲步混成度連續單調縮短(換步態不瞬跳)', mono);

console.log('\nⅢ 髖/肩驅動(等速後掠 = 腳不滑地)');
const rate = [];
for (let n = 1; n < 200; n++) {
  const u = (n / 200) * DT;
  if (u < DT * 0.2 || u > DT * 0.8) continue;              // 兩端 EASE 帶不計
  rate.push((hipDrive(u, DT) - hipDrive(u - 1e-4, DT)) / 1e-4);
}
const rMean = rate.reduce((a, b) => a + b, 0) / rate.length;
const rDev = Math.max(...rate.map((r) => Math.abs(r / rMean - 1)));
console.log(`    支撐相主段角速度離散度 ${f2(rDev * 100)}%(純正弦約 41%)`);
t('① 支撐相主段角速度近乎定值(離散 < 12%)', rDev < 0.12, `(${f2(rDev * 100)}%)`);
t('② 觸地 = 最前伸(−1)、離地 = 最後掠(+1)',
  Math.abs(hipDrive(0, DT) + 1) < 1e-6 && Math.abs(hipDrive(DT - 1e-9, DT) - 1) < 1e-4);
t('③ 接縫連續(擺動段起點 = 支撐段終點、終點 = 起點)',
  Math.abs(hipDrive(DT + 1e-9, DT) - 1) < 1e-4 && Math.abs(hipDrive(1 - 1e-9, DT) + 1) < 1e-3);
t('④ 端點斜率為 0(不出現機械式頓挫)',
  Math.abs(G.hipDrive(1e-5, DT) - G.hipDrive(0, DT)) / 1e-5 < 0.5);

console.log('\nⅣ 站姿型差異化(逐機)');
const P = {
  dog: limbProfile({ fore: 'digitigrade', hind: 'digitigrade' }),
  horse: limbProfile({ fore: 'unguligrade', hind: 'unguligrade' }),
  eleph: limbProfile({ fore: 'columnar', hind: 'columnar' }),
  gorilla: limbProfile({ fore: 'digitigrade', hind: 'plantigrade' }),
  raptor: limbProfile({ foreRole: 'grasp', hind: 'digitigrade' }),
  beetle: limbProfile({ foreRole: 'arthropod', hindRole: 'arthropod' }),
};
t('① 柱狀(象)遠端行程 < 蹠行 < 趾行',
  P.eleph.fore.reach[1] < G.POSTURE.plantigrade.reach[1]
  && G.POSTURE.plantigrade.reach[1] < P.dog.fore.reach[1]);
t('② 蹄行(馬)支撐相鎖死度 > 趾行(犬)', P.horse.fore.lock > P.dog.fore.lock);
t('③ 前後可以不同(猩猩:前趾行 / 後蹠行)',
  P.gorilla.fore.posture !== P.gorilla.hind.posture);
t('④ 不承重前肢走 grasp(抱在胸前,不進步態)', P.raptor.fore.role === 'grasp');
const graspRange = scan('grasp', 0, DT).range, foreRange = foreEl.range;
t('④b grasp 的擺幅小一個量級(不跟著跑步甩大臂)',
  graspRange < foreRange * 0.2, `(${f2(graspRange)} vs ${f2(foreRange * 0.2)})`);
t('④c grasp **連肩都收**(有些機體的前肢沒有 chFL ⇒ 只改分節鏈是改不到的)',
  /LP\.fore\.role === 'grasp' \? 0\.18 : 1/.test(locoSrc) && /hip\(phFL\) \* legA \* foreF/.test(locoSrc));
t('⑤ 節肢足:支撐相**主動伸展**(支撐段起點 > 終點,與獸腿的收腿相反)',
  G.jointFlex('arthropod', 0, 0.02, DT) > G.jointFlex('arthropod', 0, DT * 0.9, DT));
const kinds = new Set(Object.values(P).flatMap((p) => [p.fore.posture, p.hind.posture]));
t('⑥ 現役涵蓋 ≥ 4 種站姿(沒有全部退化成同一份)', kinds.size >= 4, `(${[...kinds].join('/')})`);
t('⑦ 省略 limb ⇒ 前後皆趾行(獸型多數;不必逐台寫也有正確拓樸)',
  G.limbProfile().fore.posture === 'digitigrade' && G.limbProfile().hind.role === 'hind');

console.log('\nⅤ 站姿不被步態改掉 / 曲線連續');
let restOk = true, seamOk = true;
for (const role of G.ROLES) {
  for (let i = 0; i < 3; i++) {
    for (let n = 0; n < 40; n++) {
      if (Math.abs(limbFlex(G.limbProfile().hind, i, n / 40, DT, 0)) > 1e-9
        && role === 'hind') restOk = false;
    }
    // 接縫:支撐段末 = 擺動段首、擺動段末 = 支撐段首
    const e = 1e-6;
    if (Math.abs(G.jointFlex(role, i, DT - e, DT) - G.jointFlex(role, i, DT + e, DT)) > 5e-3) seamOk = false;
    if (Math.abs(G.jointFlex(role, i, 1 - e, DT) - G.jointFlex(role, i, 0, DT)) > 5e-3) seamOk = false;
  }
}
t('① amp = 0 ⇒ 逐位元回 0(站姿仍由逐機 base 決定)', restOk);
t('② 支撐/擺動兩段在接縫上同值(每步不出現兩次角度跳變)', seamOk);
t('③ 佔空比一變,曲線形狀守恆(慢步的支撐段只是被拉長)',
  Math.abs(G.jointFlex('hind', 1, 0.5 * G.GAIT_DUTY.walk, G.GAIT_DUTY.walk)
    - G.jointFlex('hind', 1, 0.5 * DT, DT)) < 1e-9);
t('④ 值域有界(0..1;乘 k 之前不得爆掉)',
  G.ROLES.every((r) => [0, 1, 2].every((i) => scan(r, i, DT).all.every((v) => v >= -1e-9 && v <= 1 + 1e-9))));

console.log('\nⅥ 接線(執行原文)');
t('① locomotion 真的把 fore/hind 分開餵',
  /P:\s*LP\.fore,\s*duty/.test(locoSrc) && /P:\s*LP\.hind,\s*duty/.test(locoSrc));
t('② flexChain 收下 profile 並改走 limbFlex', /function flexChain\([^)]*A = null\)/.test(locoSrc)
  && /limbFlex\(A\.P, i, cycleU\(ph - j\.d\), A\.duty, a\)/.test(locoSrc));
t('③ 髖/肩驅動改吃 hipDrive(兩支步態各一處)',
  (locoSrc.match(/hipDrive\(cycleU\(p\), duty\)/g) || []).length === 2);
t('④ 鷹架把 limb 交到 rig 上(四足 + 雙足各一)',
  /limb: GA\.limb \|\| null/.test(forgeSrc) && /limb: spec\.gait\.limb \|\| null/.test(forgeSrc));
t('⑤ killswitch `?gait=0` 在冊(A/B 前後對照的落點)',
  /get\('gait'\) !== '0'/.test(locoSrc) && /GAIT_ANAT/.test(locoSrc));
t('⑥ gaitcurve.js 零 import(離線稽核吃得到真品)', !/^\s*import\s/m.test(gcSrc));
t('⑦ gaitcurve.js 零亂數/零狀態(跨客戶端一致)',
  !/Math\.random|Date\.now/.test(gcSrc));

console.log('\nⅦ 跳躍分級(大跳 vs 小跳)');
const jump = locoSrc.split('function stepJumpPose').slice(-1)[0];
t('① 以**本次騰空最高點**分級(不是在 1.1m 就飽和的 airF)',
  /L\.peakY = Math\.max/.test(jump) && /bigF = clamp\(\(\(L\.peakY/.test(jump));
t('② 落地深度 ∝ 跳了多高', /L\.landK = clamp\(\(0\.45[^;]*\* \(1 \+ 0\.75 \* pk\)/.test(jump));
t('③ 頂點收腿(floatF)真的驅動腿鏈與骨盆,不是只算不用',
  (jump.match(/floatF/g) || []).length >= 5);
t('④ 觸地時峰值歸零(下一跳重新分級)', /L\.peakY = 0/.test(jump));

console.log('\nⅧ 交戰姿態(奔跑射擊 / 飛行射擊)');
t('① 移動中開火收斂骨盆對轉(上身當雲台)',
  /braceF = clamp\(rig\._aim/.test(locoSrc) && /1 - 0\.8 \* braceF/.test(locoSrc));
t('①b braceF 只吃開火窗、不吃 idle(站著不動不是「射擊姿勢」的來源)',
  !/braceF = clamp\(rig\._aim \|\| 0 \+ idle/.test(locoSrc));
t('② 飛行開火:機鼻壓向目標 + 懸停修正收斂',
  /atk = clamp\(rig\._aim/.test(locoSrc) && /1 - 0\.65 \* atk/.test(locoSrc));
t('③ 鳥類撲翼**停拍**滑翔撲擊(頻率與振幅一起收)',
  /\(1 - 0\.8 \* atk\)/.test(locoSrc) && /1 - 0\.85 \* atk/.test(locoSrc));
t('③b 昆蟲**不停拍**(升力全靠震翅;只收掃掠幅度)',
  /dt \* \(30 \+ k \* 16\);/.test(locoSrc) && /1 - 0\.25 \* atk/.test(locoSrc));

const brk = [...BRK];
console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? ` / 失敗 ${fail} 項` : ''}`
  + (brk.length ? `(壞版注入:${brk.join(', ')} —— 上面 MUST 有紅字)` : ''));
process.exit(fail && !brk.length ? 1 : 0);
