// ============ 電腦玩家策略學習迴圈(2026-08-06 使用者需求)============
// 「設計一個最佳操作策略的電腦玩家,平衡性調整時可不斷學習」的工具半:離線自對戰持續優化
// BOT_TACTIC 的**取捨型旋鈕**(BOT_LEARN.KEYS 白名單),成果寫進 `public/js/botPolicy.js`,
// 由 data.js 的覆寫迴圈套回 BOT_TACTIC ⇒ 中/高難度 bot 上場就是學到的策略。
//
// 用法:
//   node tools/bot_learn.mjs                       # 學習(自 botPolicy.js 暖啟動;預設 6 輪)
//   node tools/bot_learn.mjs --iters 12 --workers 4
//   node tools/bot_learn.mjs --eval                # 只評測:現行策略 vs 手寫基準
//   node tools/bot_learn.mjs --reset               # 寫回中性策略(BOT_TACTIC 回到手寫基準)
//   node tools/bot_learn.mjs --dry                 # 學習但不寫檔(看報告)
//   其餘旋鈕:--cands 4 --seeds 4 --team 2 --cap 240 --dt 0.125 --sigma 0.12 --seed 1 --diff high
//
// ---- 方法(為什麼是這個形狀;詳見 docs/bot_learning.md)----
// ①**評測 = 候選策略 vs 現行策略的真自對戰**(真 BattleSim + 真 BotBrain,兩邊同難度),
//   不是代理模型 —— 策略的價值只能在「對手也在打」的環境量到(lanesim/duel 都沒有 AI 決策)。
// ②**CRN(共同亂數)+ 側別鏡射**:每顆種子把 Math.random 換成 mulberry32(seed),同一顆種子
//   跑「候選當 SWARM」與「候選當 STEEL」各一場取平均 ⇒ 側別不對稱與抽角運氣被配對消掉。
//   CLAUDE.md 的教訓:單場工事損血在 433~10298 之間跳,n≤3 能同時「證明」變好與變壞 ——
//   不做配對變異數削減,學習訊號整個淹在雜訊裡。
// ③**適應度 = 結構傷害差 + 擊殺差 + 勝負獎勵**(候選視角):二元勝負在長局天生飽和
//   (5v5 塔+主堡總 HP 數十萬,上限內常未分勝負),工事損血差才是連續、對「推得動線」敏感的量。
// ④**鏡射高斯擾動(θ ± σd)的 (1+λ) 演化策略**:無梯度、對雜訊穩健、參數只有 8 維 ——
//   比策略梯度/RL 少幾個量級的樣本量,而且每一步都是「可直接上場的完整策略」。
// ⑤**夾制走 data.js `botPolicySanitize` 單一縫**:本檔 MUST NOT 手寫任何邊界/交叉約束 ——
//   邊界鏡射 audit_bot_tactics 的守門線,學壞了也寫不出非法策略。
// ⑥**平衡指紋**:meta.balHash 記訓練當時的 `balanceFingerprint()`;平衡一調整指紋就變,
//   下次執行本工具即提示「基準過期」並以現行策略暖啟動再學 —— 「不斷學習」= 追指紋,不追 commit。
// ⑦**收尾閘門**:逐輪接受用的是小樣本訓練種子,雜訊晉升擋不乾淨 ⇒ 最終策略換一批**沒用過**
//   的種子對「被取代的那份策略」重測,沒贏就不寫檔(寧缺勿錯;--force 才能繞過,除錯限定)。
//
// 學不學得到「能力」?不。白名單只有決策權重/距離環/集結參數;視野、手速、反應、準度
// 一律不可學(A32:電腦玩家 MUST NOT 比真人多看/多走)。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { BattleSim } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';
import { buildConfig } from '../test/simrun.mjs';
import { mulberry32 } from '../public/js/rng.js';
import { lanesFor, UNITS, BOT_LEARN, BOT_TACTIC_BASE, botPolicySanitize, balanceFingerprint } from '../public/js/data.js';
import { BOT_POLICY } from '../public/js/botPolicy.js';

const POLICY_PATH = new URL('../public/js/botPolicy.js', import.meta.url);

// ---------------------------------------------------------------------------------
// 一場配對評測:候選策略(candTac)對上基準策略(baseTac),candSide 執候選。
// CRN:整場的 Math.random(含抽角、bot 出生抖動、瞄準擲骰)一律走 mulberry32(seed) ——
// 同 seed 同輸入 ⇒ 逐位元同一場;不同候選共用同一批 seed = 變異數配對削減。
// ---------------------------------------------------------------------------------
export function runMatch(candTac, baseTac, candSide, seed, opts) {
  const orig = Math.random;
  const rng = mulberry32(seed >>> 0);
  Math.random = () => rng();
  try {
    const L = lanesFor(opts.team);
    const sim = new BattleSim(buildConfig(L));
    const brains = [];
    let idx = 0;
    for (const side of ['SWARM', 'STEEL']) {
      for (let i = 0; i < opts.team; i++) {
        const pid = 'b' + (++idx);
        sim.addHero(side, pid);
        const b = new BotBrain(sim, pid, side, idx - 1, opts.diff);
        b.tac = side === candSide ? candTac : baseTac;   // 逐 brain 注入(bots.js 唯一讀取縫)
        brains.push(b);
      }
    }
    // 工事名冊(結束時可能已從 ents 移除 ⇒ 開場記 maxHp,消失 = 全額損血)
    const structs = [...sim.ents.values()]
      .filter((e) => e.kind === 'tower' || e.kind === 'base')
      .map((e) => ({ id: e.id, side: e.side, maxHp: e.maxHp || e.hp }));
    while (!sim.over && sim.t < opts.cap) {
      for (const b of brains) b.update(opts.dt);
      sim.tick(opts.dt);
    }
    const taken = { SWARM: 0, STEEL: 0 };   // 各陣營工事**被打掉**多少
    for (const s of structs) {
      const e = sim.ents.get(s.id);
      taken[s.side] += e ? Math.max(0, s.maxHp - e.hp) : s.maxHp;
    }
    const foe = candSide === 'SWARM' ? 'STEEL' : 'SWARM';
    const fit = (taken[foe] - taken[candSide]) / UNITS.tower.hp
      + 0.05 * ((sim.stats[candSide]?.kills || 0) - (sim.stats[foe]?.kills || 0))
      + (sim.winner === candSide ? 2 : sim.winner === foe ? -2 : 0);
    return { fit, taken, winner: sim.winner || null, seconds: Math.round(sim.t) };
  } finally {
    Math.random = orig;
  }
}

/** 一批 job(worker 與單執行緒共用同一支;job = { cand, base, candSide, seed }) */
function runJobs(jobs, opts) { return jobs.map((j) => runMatch(j.cand, j.base, j.candSide, j.seed, opts).fit); }

/** 候選 vs 基準:seeds × 兩側鏡射的 job 清單(>0 = 候選較強;候選 == 基準時期望值為 0) */
function pairJobs(cand, base, seeds) {
  const jobs = [];
  for (const seed of seeds) for (const candSide of ['SWARM', 'STEEL']) jobs.push({ cand, base, candSide, seed });
  return jobs;
}

async function runJobsParallel(jobs, opts, workers) {
  if (workers <= 1) return runJobs(jobs, opts);
  const here = fileURLToPath(import.meta.url);
  const per = Math.ceil(jobs.length / workers);
  const chunks = [];
  for (let w = 0; w * per < jobs.length; w++) chunks.push(jobs.slice(w * per, (w + 1) * per));
  const outs = await Promise.all(chunks.map((chunk) => new Promise((res, rej) => {
    const wk = new Worker(here, { workerData: { botlearn: true, jobs: chunk, opts } });
    wk.on('message', res);
    wk.on('error', rej);
    wk.on('exit', (c) => { if (c !== 0) rej(new Error(`worker exit ${c}`)); });
  })));
  return outs.flat();
}

// ---------------------------------------------------------------------------------
// 參數向量 ↔ 旋鈕表(正規化到 [0,1];夾制一律回 botPolicySanitize,本檔零手寫邊界)
// ---------------------------------------------------------------------------------
const KEYS = Object.keys(BOT_LEARN.KEYS);
const toVec = (tac) => KEYS.map((k) => {
  const [lo, hi] = BOT_LEARN.KEYS[k];
  return (tac[k] - lo) / (hi - lo);
});
const toTac = (vec) => botPolicySanitize(Object.fromEntries(KEYS.map((k, i) => {
  const [lo, hi] = BOT_LEARN.KEYS[k];
  return [k, lo + Math.min(1, Math.max(0, vec[i])) * (hi - lo)];
})));

/** 高斯亂數(Box-Muller;擾動抽樣走**自己的** rng,與對局 CRN 分開) */
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const fmtTac = (tac) => KEYS.map((k) => `${k}=${(+tac[k]).toFixed(3)}`).join(' ');

// ---------------------------------------------------------------------------------
// 寫回 botPolicy.js(整檔重生;人手 MUST NOT 編輯的工具產出檔)
// ---------------------------------------------------------------------------------
function writePolicy(tac, meta) {
  const t = Object.fromEntries(KEYS.map((k) => [k, +(+tac[k]).toFixed(4)]));
  const body = `// ============ 電腦玩家學習策略(工具產出檔;人手 MUST NOT 編輯)============
// 由 \`tools/bot_learn.mjs\` 的離線自對戰學習迴圈改寫;\`data.js\` 於載入時把 \`tactic\` 內
// **白名單鍵**(BOT_LEARN.KEYS)經 \`botPolicySanitize\` 夾制後套回 BOT_TACTIC。
// 空的 \`tactic = {}\` = 中性策略:BOT_TACTIC 逐位元等於手寫基準(原則 6 寧缺勿錯)。
//
// 本檔 MUST 維持零 import(同 rng.js / vernacular.js):瀏覽器、伺服器、離線工具、
// 稽核四種環境都要能直接吃真品。
//
// meta 只是留檔(平衡指紋/訓練紀錄),不進任何遊戲判定:
//   balHash   = 訓練當時的平衡數值指紋(data.js balanceFingerprint());
//               與現行指紋不符 = 平衡已調整,策略基準過期 ⇒ 重跑 bot_learn 再學一輪。
//   history   = 最近幾輪學習的摘要(暖啟動的軌跡,方便回看策略怎麼演化)。
export const BOT_POLICY = ${JSON.stringify({ meta, tactic: t }, null, 2).replace(/"([A-Za-z_]\w*)":/g, '$1:')};
`;
  writeFileSync(POLICY_PATH, body);
}

function neutralPolicy() {
  writeFileSync(POLICY_PATH, `// ============ 電腦玩家學習策略(工具產出檔;人手 MUST NOT 編輯)============
// 由 \`tools/bot_learn.mjs\` 的離線自對戰學習迴圈改寫;\`data.js\` 於載入時把 \`tactic\` 內
// **白名單鍵**(BOT_LEARN.KEYS)經 \`botPolicySanitize\` 夾制後套回 BOT_TACTIC。
// 空的 \`tactic = {}\` = 中性策略:BOT_TACTIC 逐位元等於手寫基準(原則 6 寧缺勿錯)。
//
// 本檔 MUST 維持零 import(同 rng.js / vernacular.js):瀏覽器、伺服器、離線工具、
// 稽核四種環境都要能直接吃真品。
//
// meta 只是留檔(平衡指紋/訓練紀錄),不進任何遊戲判定:
//   balHash   = 訓練當時的平衡數值指紋(data.js balanceFingerprint());
//               與現行指紋不符 = 平衡已調整,策略基準過期 ⇒ 重跑 bot_learn 再學一輪。
//   history   = 最近幾輪學習的摘要(暖啟動的軌跡,方便回看策略怎麼演化)。
export const BOT_POLICY = {
  meta: { v: 1, balHash: null, trainedAt: null, history: [] },
  tactic: {},
};
`);
}

// ---------------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    mode: 'learn', iters: 6, cands: 4, seeds: 4, team: 2, cap: 240, dt: 0.125,
    sigma: 0.12, seed: 1, diff: 'high', workers: 1, dry: false, force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'eval') a.mode = 'eval';
    else if (k === 'reset') a.mode = 'reset';
    else if (k === 'dry') a.dry = true;
    else if (k === 'force') a.force = true;   // 收尾閘門沒過也強制寫檔(除錯用;一般 MUST NOT)
    else if (['iters', 'cands', 'seeds', 'team', 'cap', 'seed', 'workers'].includes(k)) a[k] = Math.max(1, +argv[++i]);
    else if (k === 'dt') a.dt = Math.max(0.02, +argv[++i]);
    else if (k === 'sigma') a.sigma = Math.max(0.01, +argv[++i]);
    else if (k === 'diff') a.diff = argv[++i];
  }
  a.team = Math.min(5, a.team);
  a.cands = Math.max(2, a.cands - (a.cands % 2));   // 鏡射成對 ⇒ 偶數
  return a;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fp = balanceFingerprint();

  if (opts.mode === 'reset') {
    neutralPolicy();
    console.log('✅ 已寫回中性策略(BOT_TACTIC = 手寫基準)。');
    return;
  }

  const cur = botPolicySanitize(BOT_POLICY?.tactic);
  const stale = BOT_POLICY?.meta?.balHash && BOT_POLICY.meta.balHash !== fp;
  console.log(`平衡指紋:${fp}${stale ? `(⚠ 策略基準 ${BOT_POLICY.meta.balHash} 已過期 — 平衡調整過,這一輪以現行策略暖啟動重新學習)` : ''}`);
  console.log(`現行策略:${fmtTac(cur)}`);

  if (opts.mode === 'eval') {
    const seeds = Array.from({ length: opts.seeds * 2 }, (_, i) => opts.seed + 7919 * i);
    const fits = await runJobsParallel(pairJobs(cur, { ...BOT_TACTIC_BASE }, seeds), opts, opts.workers);
    console.log(`現行策略 vs 手寫基準(${seeds.length} 種子 × 兩側鏡射 = ${fits.length} 場 ${opts.team}v${opts.team}×${opts.cap}s):`);
    console.log(`  平均適應度 ${mean(fits).toFixed(3)}(>0 = 學到的策略較強;0 = 打平)`);
    return;
  }

  // ---- 學習(鏡射高斯擾動 ES;暖啟動自現行策略)----
  let theta = toVec(cur);
  let sigma = opts.sigma;
  const drng = mulberry32((opts.seed * 2654435761) >>> 0);   // 擾動抽樣 rng(與對局 CRN 分開)
  const ACCEPT = 0.05;   // 接受門檻:平均適應度要贏過現行策略這麼多才更新(擋雜訊晉升)
  let accepted = 0;
  const t0 = Date.now();
  for (let it = 0; it < opts.iters; it++) {
    const base = toTac(theta);
    const seeds = Array.from({ length: opts.seeds }, (_, j) => opts.seed + it * 997 + j);   // 每輪換種子:不對固定種子過擬合
    const cands = [];
    for (let c = 0; c < opts.cands / 2; c++) {
      const d = theta.map(() => gauss(drng));
      cands.push(theta.map((v, i) => v + sigma * d[i]), theta.map((v, i) => v - sigma * d[i]));
    }
    const scored = [];
    for (const vec of cands) {
      const tac = toTac(vec);
      const fits = await runJobsParallel(pairJobs(tac, base, seeds), opts, opts.workers);
      scored.push({ vec, tac, f: mean(fits) });
    }
    scored.sort((a, b) => b.f - a.f);
    const best = scored[0];
    if (best.f > ACCEPT) {
      theta = best.vec.map((v) => Math.min(1, Math.max(0, v)));
      accepted++;
      console.log(`輪 ${it + 1}/${opts.iters}:✔ 接受(適應度 +${best.f.toFixed(3)});σ=${sigma.toFixed(3)}`);
      console.log(`  → ${fmtTac(best.tac)}`);
    } else {
      sigma = Math.max(0.03, sigma * 0.7);
      console.log(`輪 ${it + 1}/${opts.iters}:✘ 無明顯改善(最佳 ${best.f.toFixed(3)})⇒ 縮小步長 σ=${sigma.toFixed(3)}`);
    }
  }

  // ---- 收尾閘門:最終策略 MUST 在**乾淨種子**上贏過被取代的那份策略才落地 ----
  // 逐輪的接受是小樣本(訓練種子),雜訊晉升擋不乾淨;這裡換一批沒用過的種子重測一次,
  // 沒贏就不寫檔(寧缺勿錯,原則 6)—— 學習可以失敗,遊戲裡的策略不准因此變差。
  const finalTac = toTac(theta);
  const evalSeeds = Array.from({ length: opts.seeds * 2 }, (_, i) => opts.seed + 104729 + 7919 * i);
  const fits = await runJobsParallel(pairJobs(finalTac, cur, evalSeeds), opts, opts.workers);
  const fitVsPrev = mean(fits);
  console.log(`\n學習完成(${((Date.now() - t0) / 1000).toFixed(0)}s;接受 ${accepted}/${opts.iters} 輪)`);
  console.log(`最終策略:${fmtTac(finalTac)}`);
  console.log(`收尾閘門 vs 起點策略:平均適應度 ${fitVsPrev.toFixed(3)}(${fits.length} 場乾淨種子)`);
  if (opts.dry) { console.log('(--dry:不寫檔)'); return; }
  if (fitVsPrev <= 0 && !opts.force) {
    console.log('✘ 未優於現行策略 ⇒ 不寫檔(botPolicy.js 維持原樣;加大 --seeds/--iters 再學,或 --force 強制)。');
    return;
  }
  const entry = {
    at: new Date().toISOString(), balHash: fp, iters: opts.iters, accepted,
    fitVsPrev: +fitVsPrev.toFixed(3), team: opts.team, cap: opts.cap, seeds: opts.seeds,
  };
  const history = [...(BOT_POLICY?.meta?.history || []), entry].slice(-10);
  writePolicy(finalTac, { v: 1, balHash: fp, trainedAt: entry.at, history });
  console.log('✅ 已寫回 public/js/botPolicy.js(重開伺服器/單機即生效)。');
}

// ---- 入口 / worker 守衛(被 audit_bot_policy import 時 MUST NOT 執行主流程)----
const isEntry = isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMainThread && workerData?.botlearn) {
  parentPort.postMessage(runJobs(workerData.jobs, workerData.opts));
} else if (isEntry) {
  main().catch((e) => { console.error('❌ 學習迴圈失敗:', e); process.exit(1); });
}
