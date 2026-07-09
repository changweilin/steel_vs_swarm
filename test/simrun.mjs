// 無伺服器・加速 / 平行對局模擬器 —— 直接驅動 BattleSim + BotBrain 跑完整場對戰,
// 不經 WebSocket、不受 8Hz wall-clock 限制(有多快 CPU 就跑多快),用於平衡驗證與回歸壓測。
//
// 用法(PowerShell 下用 --port 之外,一律 node 直跑):
//   node test/simrun.mjs                         # 預設:20 場 5v5 高難度對決
//   node test/simrun.mjs --matches 200 --team 3  # 200 場 3v3
//   node test/simrun.mjs --swarm novice --steel high   # 不對稱難度(檢視難度強度)
//   node test/simrun.mjs --matches 400 --workers 8      # 8 條 worker 平行跑
//   node test/simrun.mjs --cap 900 --dt 0.1             # 場長上限 900s、步長 0.1s
//
// 離開碼:0 = 全部正常結束(有勝負或達上限);1 = 有場次拋例外。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { BattleSim } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';
import { MAPGEO, lanesFor, BOT_DIFF } from '../public/js/data.js';

// ---- 合成戰場(台北 101 附近;兩堡 1600×L,與 e2e 同錨點,留防空安全邊界)----
function buildConfig(L) {
  const A = [25.0330, 121.5654];
  const D = 1600 * L, R = 6371000;
  const realD = D * MAPGEO.REAL_SCALE;
  const dLat = realD / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const mkLane = (off) => {
    const dLng = off / (R * Math.cos(A[0] * Math.PI / 180)) * 180 / Math.PI;
    const c = [mid[0], mid[1] + dLng];
    const pts = [];
    for (let t = 0; t <= 1.001; t += 0.05) {
      const u = 1 - t;
      pts.push([u * u * A[0] + 2 * u * t * c[0] + t * t * B[0], u * u * A[1] + 2 * u * t * c[1] + t * t * B[1]]);
    }
    return pts;
  };
  const offs = L === 1 ? [0] : L === 2 ? [0.3 * realD, -0.3 * realD] : [0.3 * realD, 0, -0.3 * realD];
  const sizeM = D / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B },
    lanes: offs.map(mkLane), sizeM, diagM: sizeM * Math.SQRT2, distM: D,
    sizeKey: 'medium', geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '模擬戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}

/** 跑完一場 bot vs bot,回傳結果。純模擬,無 wall-clock 等待。 */
function runMatch({ team, diffSwarm, diffSteel, dt, cap }) {
  const L = lanesFor(team);
  const sim = new BattleSim(buildConfig(L));
  const brains = [];
  let idx = 0;
  for (const side of ['SWARM', 'STEEL']) {
    const diff = side === 'SWARM' ? diffSwarm : diffSteel;
    for (let i = 0; i < team; i++) {
      const pid = 'b' + (++idx);   // isBotId 需以 'b' 開頭
      sim.addHero(side, pid);      // 未指定角色 → 同陣營 + 傭兵隨機
      brains.push(new BotBrain(sim, pid, side, idx - 1, diff));
    }
  }
  let ticks = 0;
  while (!sim.over && sim.t < cap) {
    for (const b of brains) b.update(dt);
    sim.tick(dt);
    ticks++;
  }
  return { winner: sim.winner || null, over: !!sim.over, seconds: Math.round(sim.t), wave: sim.wave, ticks };
}

function runBatch(opts, from, to) {
  const results = [];
  for (let i = from; i < to; i++) results.push(runMatch(opts));
  return results;
}

function summarize(opts, results, wallMs) {
  const n = results.length;
  const wins = { SWARM: 0, STEEL: 0, DRAW: 0 };
  let secSum = 0, tickSum = 0;
  for (const r of results) {
    wins[r.winner || 'DRAW']++;
    secSum += r.seconds; tickSum += r.ticks;
  }
  const gameSec = secSum;
  const pct = (x) => (100 * x / n).toFixed(1) + '%';
  console.log(`\n=== 模擬結果(${n} 場 ${opts.team}v${opts.team}・SWARM「${BOT_DIFF[opts.diffSwarm]?.name || opts.diffSwarm}」vs STEEL「${BOT_DIFF[opts.diffSteel]?.name || opts.diffSteel}」)===`);
  console.log(`SWARM 勝:${wins.SWARM}(${pct(wins.SWARM)}) ・ STEEL 勝:${wins.STEEL}(${pct(wins.STEEL)}) ・ 未分勝負(達上限):${wins.DRAW}(${pct(wins.DRAW)})`);
  console.log(`場均時長:${(secSum / n).toFixed(0)}s(遊戲內)・ 總模擬遊戲時間:${gameSec}s ・ 總 tick:${tickSum}`);
  console.log(`實際牆鐘耗時:${(wallMs / 1000).toFixed(2)}s → 加速比 ≈ ${(gameSec * 1000 / wallMs).toFixed(0)}× 即時`);
}

function parseArgs(argv) {
  const a = { team: 5, matches: 20, diffSwarm: 'high', diffSteel: 'high', dt: 0.125, cap: 1800, workers: 1 };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, ''), v = argv[i + 1];
    if (k === 'team') a.team = Math.max(1, Math.min(5, +v));
    else if (k === 'matches') a.matches = Math.max(1, +v);
    else if (k === 'swarm') a.diffSwarm = BOT_DIFF[v] ? v : a.diffSwarm;
    else if (k === 'steel') a.diffSteel = BOT_DIFF[v] ? v : a.diffSteel;
    else if (k === 'diff') { a.diffSwarm = a.diffSteel = BOT_DIFF[v] ? v : 'high'; }
    else if (k === 'dt') a.dt = Math.max(0.02, +v);
    else if (k === 'cap') a.cap = Math.max(30, +v);
    else if (k === 'workers') a.workers = Math.max(1, Math.min(32, +v));
  }
  return a;
}

if (!isMainThread) {
  // worker:跑指派的區間,回傳結果陣列
  const { opts, from, to } = workerData;
  parentPort.postMessage(runBatch(opts, from, to));
} else {
  const opts = parseArgs(process.argv.slice(2));
  const { matches, workers } = opts;
  const t0 = Date.now();
  if (workers <= 1) {
    try {
      const results = runBatch(opts, 0, matches);
      summarize(opts, results, Date.now() - t0);
    } catch (e) {
      console.error('❌ 模擬拋出例外:', e);
      process.exit(1);
    }
  } else {
    const here = fileURLToPath(import.meta.url);
    const per = Math.ceil(matches / workers);
    const jobs = [];
    for (let w = 0; w < workers; w++) {
      const from = w * per, to = Math.min(matches, from + per);
      if (from >= to) break;
      jobs.push(new Promise((res, rej) => {
        const wk = new Worker(here, { workerData: { opts, from, to } });
        wk.on('message', res);
        wk.on('error', rej);
        wk.on('exit', (code) => { if (code !== 0) rej(new Error(`worker exit ${code}`)); });
      }));
    }
    Promise.all(jobs)
      .then((chunks) => summarize(opts, chunks.flat(), Date.now() - t0))
      .catch((e) => { console.error('❌ 平行模擬失敗:', e); process.exit(1); });
  }
}
