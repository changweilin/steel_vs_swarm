#!/usr/bin/env node
/**
 * 照片庫抓取器(docs/ai3d_asset_plan.md §4.1;Track B 靜態零件的照片來源)
 *
 * 「照片數據庫」= 下方 PHOTO_CATALOG(逐物件族 × 逐零件的查詢型錄)+ photo_manifest.json
 * (帳本)+ photos/(檔案,**勿入版控** —— 照片只是離線輸入,入庫的只有零件 GLB)。
 *
 * 四條紀律:
 *   ① **授權硬閘,不是建議**:查詢寫死 `license=cc0`,而且逐張複驗回傳欄位
 *      (Openverse `license` ∈ {cc0, pdm};Commons LicenseShortName 含 CC0 / Public domain)。
 *      **CC-BY 也拒收** —— 烤進 repo 的石頭沒有地方放署名,而授權違規沒有任何錯誤訊息。
 *   ② **可續跑補缺**:每個零件有目標張數(want),重跑只補不足的部分,已有的照片
 *      與帳本原樣保留(同 gen2d.mjs ① 的續跑語意)。
 *   ③ **記帳**:每一張都寫進 photo_manifest.json({source_url, license, creator,
 *      retrieved_at, …}),skill photo-to-prop-forge §1 規定的欄位一項不少。
 *   ④ **降級不例外**(原則 6):單一 API 掛掉/單張下載失敗只記 fail 繼續,
 *      MUST NOT 中止整批;Openverse 沒料改問 Wikimedia Commons。
 *
 * 選片標準(skill §1;能過濾的在這裡過濾,其餘靠人眼在 --review 清單上挑):
 *   短邊 ≥1024(API 有回尺寸才驗,沒回的照收並在帳本標 `size_unknown`)、
 *   單一主體/乾淨背景/平光交給 §5.3 的去背與人工挑選 —— 一張好照片勝過三張拼湊的。
 *
 * ⚠ 沙箱跑不動(CLAUDE.md ㋓):api.openverse.org / commons.wikimedia.org 走不出代理
 *    ⇒ 本工具在真機(3060 那台)或 GitHub Actions 上跑。
 *
 * 用法:
 *   node tools/ai3d/fetch_photos.mjs --plan               只印工作清單與缺額(不打 API)
 *   node tools/ai3d/fetch_photos.mjs --family rock        只抓某一族(rock|tree|landmark|building)
 *   node tools/ai3d/fetch_photos.mjs --part rock/facet    只抓某一個零件
 *   node tools/ai3d/fetch_photos.mjs --limit 10           本輪最多下載幾張
 *   node tools/ai3d/fetch_photos.mjs --review             列出已抓照片供人工挑選(路徑 + 尺寸 + 來源)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PHOTOS = join(HERE, 'photos');
const MANIFEST = join(HERE, 'photo_manifest.json');
const UA = 'steel-vs-swarm-asset-pipeline/1.0 (CC0 photo sourcing; contact: repo issues)';

// ============ 照片型錄(唯一縫)============
// 族/零件對齊計畫書 §4.2 的「AI 該產出什麼」:查詢是**零件**不是成品(拍整棵樹沒有用,
// image→3D 要的是樹冠模組/枝叉/板根各自成像)。want = 每零件目標張數(多抓幾張供挑選,
// 一件零件最後只用一張 —— skill §1:一張好照片勝過三張拼湊的)。
export const PHOTO_CATALOG = {
  rock: {                                                    // MEGALITHS:岩面/崩落塊/落石堆
    facet:    { want: 6, q: ['granite boulder isolated', 'weathered rock outcrop closeup', 'limestone boulder'] },
    // 第 2 輪放寬名詞(runbook §4-A:第 1 輪 0/4、1/4 的成因是查詢措辭太窄,不是沒料)
    collapse: { want: 4, q: ['fallen boulder', 'rockfall boulder', 'boulder field'] },
    talus:    { want: 4, q: ['scree slope', 'talus slope mountain', 'rock debris slope'] },
  },
  tree: {                                                    // VEG_DEFS / GIANT_DEFS:樹冠模組/枝叉/板根
    canopy:   { want: 6, q: ['tree crown isolated sky', 'oak tree canopy', 'conifer crown'] },
    fork:     { want: 4, q: ['tree branch fork bare', 'large tree bough'] },
    buttress: { want: 4, q: ['buttress root rainforest', 'tree buttress roots'] },
  },
  landmark: {                                                // beacons KIND_PARTS:桁架節/微波碟/水塔桶/貨櫃
    lattice:  { want: 4, q: ['electricity pylon', 'transmission tower', 'steel lattice tower'] },
    dish:     { want: 3, q: ['microwave dish antenna tower', 'parabolic antenna'] },
    tank:     { want: 3, q: ['water tower', 'water tank', 'elevated water tank'] },
    container:{ want: 3, q: ['shipping container single', 'cargo container isolated'] },
  },
  building: {                                                // hazards BUILDERS:窗格/簷口/陽台/外管
    window:   { want: 4, q: ['window facade', 'office building facade', 'factory windows'] },
    roofcap:  { want: 4, q: ['rooftop parapet', 'building rooftop', 'roof cornice'] },
    balcony:  { want: 3, q: ['concrete balcony facade', 'apartment balcony module'] },
    piping:   { want: 3, q: ['industrial external piping wall', 'building exterior pipes'] },
  },
};

// ---- CLI ----
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const ONLY_FAM = opt('family');
const ONLY_PART = opt('part');                               // 'rock/facet' 形式
const LIMIT = Number(opt('limit') || 20);

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];
const have = (fam, part) => manifest.filter((e) => e.family === fam && e.part === part && e.ok).length;

function workList() {
  const out = [];
  for (const [fam, parts] of Object.entries(PHOTO_CATALOG)) {
    if (ONLY_FAM && fam !== ONLY_FAM) continue;
    for (const [part, def] of Object.entries(parts)) {
      if (ONLY_PART && `${fam}/${part}` !== ONLY_PART) continue;
      const got = have(fam, part);
      if (got < def.want) out.push({ fam, part, def, got, need: def.want - got });
    }
  }
  return out;
}

// ---- 授權複驗(硬閘的第二道:不信任查詢參數,逐張再驗一次)----
const CC0_RE = /^(cc0|pdm)$/i;                               // Openverse 的 license 欄
const COMMONS_OK = /cc0|public domain/i;                     // Commons 的 LicenseShortName

async function jget(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Openverse:免金鑰;license=cc0 已含 public domain mark */
async function searchOpenverse(q, n) {
  const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0&page_size=${n}`;
  const j = await jget(u);
  return (j.results || []).filter((it) => CC0_RE.test(it.license || '')).map((it) => ({
    id: `ov_${it.id}`, url: it.url, w: it.width, h: it.height,
    license: it.license, creator: it.creator || null,
    source_url: it.foreign_landing_url || it.url, api: 'openverse',
  }));
}

/** Wikimedia Commons:補地標類;逐張驗 extmetadata 的授權欄 */
async function searchCommons(q, n) {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
    + `&generator=search&gsrnamespace=6&gsrlimit=${n}&gsrsearch=${encodeURIComponent(q)}`
    + '&prop=imageinfo&iiprop=url|size|extmetadata';
  const j = await jget(u);
  const pages = Object.values(j?.query?.pages || {});
  return pages.map((p) => {
    const ii = p.imageinfo?.[0]; if (!ii) return null;
    const lic = ii.extmetadata?.LicenseShortName?.value || '';
    if (!COMMONS_OK.test(lic)) return null;                  // 硬閘:CC-BY 一律拒收
    return {
      id: `wc_${p.pageid}`, url: ii.url, w: ii.width, h: ii.height,
      license: lic, creator: ii.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, '') || null,
      source_url: ii.descriptionurl, api: 'commons',
    };
  }).filter(Boolean);
}

async function download(it, fam, part) {
  const dir = join(PHOTOS, fam, part);
  mkdirSync(dir, { recursive: true });
  const ext = (it.url.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const file = join(dir, `${it.id}.${ext}`);
  if (existsSync(file)) return file;
  const r = await fetch(it.url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

async function main() {
  const work = workList();
  if (flag('review')) {
    for (const e of manifest.filter((e) => e.ok)) {
      console.log(`${e.family}/${e.part}  ${e.file}  ${e.w || '?'}×${e.h || '?'}  ${e.license}  ${e.source_url}`);
    }
    return;
  }
  if (flag('plan') || !work.length) {
    console.log('工作清單(零件:已有/目標):');
    for (const [fam, parts] of Object.entries(PHOTO_CATALOG)) {
      for (const [part, def] of Object.entries(parts)) console.log(`  ${fam}/${part}: ${have(fam, part)}/${def.want}`);
    }
    if (!work.length) console.log('\n缺額為零,不用抓。');
    return;
  }

  let fetched = 0;
  let cooled = false;   // 撞上 IP 級限流(2026-08-05 實測 upload.wikimedia.org Retry-After: 600)
  for (const { fam, part, def, need } of work) {
    if (cooled || fetched >= LIMIT) break;
    // seen 只收成功條目:暫時性失敗(429 限流)重跑 MUST 能再試,否則②的「可續跑」對
    // 整批被限流的零件永久失效;失敗紀錄仍留在帳本當歷史(④),成功時另推一筆新條目。
    const seen = new Set(manifest.filter((e) => e.family === fam && e.part === part && e.ok).map((e) => e.id));
    for (const q of def.q) {
      if (cooled || fetched >= LIMIT) break;
      const tryItems = async (items) => {
        for (const it of items) {
          if (cooled || fetched >= LIMIT || have(fam, part) >= def.want) break;
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          // 選片過濾:短邊 <1024 直接跳過(skill §5.3:不足 1024 不准進 image→3D);尺寸未知照收並標記
          const short = Math.min(it.w || Infinity, it.h || Infinity);
          if (short < 1024) continue;
          const entry = {
            family: fam, part, id: it.id, query: q, api: it.api,
            source_url: it.source_url, license: it.license, creator: it.creator,
            retrieved_at: new Date().toISOString(), w: it.w || null, h: it.h || null,
            size_unknown: !(it.w && it.h) || undefined,
          };
          try {
            entry.file = (await download(it, fam, part)).replace(HERE + '/', '');
            entry.ok = true;
            fetched++;
            console.log(`✓ ${fam}/${part} ← ${it.id}(${it.license})`);
          } catch (e) {
            entry.ok = false; entry.error = e.message;
            console.warn(`✗ ${fam}/${part} ← ${it.id}:${e.message}`);
            // 429 = IP 級限流:繼續打只是把候選燒成失敗紀錄 ⇒ 提前收工,等冷卻窗過再跑。
            // 它是「這一輪的網路狀態」不是「這張照片的屬性」⇒ 也不進帳本(帳本記的是
            // 授權與檔案的事實;持續性失敗如 404 仍照記)。
            if (/HTTP 429/.test(e.message)) { cooled = true; continue; }
          }
          manifest.push(entry);
          writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
          await new Promise((r) => setTimeout(r, 1100));     // 禮貌限速(Openverse 匿名額度)
        }
      };
      let items = [];
      try { items = await searchOpenverse(q, need * 3); } catch (e) { console.warn(`Openverse 失敗(${q}):${e.message}`); }
      await tryItems(items);
      // 降級不例外(④):Openverse「搜尋零結果」**或「有結果但下載被限流(429)整批失敗」**
      // 同一條查詢都降級到 Commons 再試 —— 舊制只蓋前者,實測 Openverse 匿名額度一燒完,
      // 缺額零件就永遠補不滿,而畫面上只看得到「✗ HTTP 429」一排。
      if (have(fam, part) < def.want && fetched < LIMIT) {
        let more = [];
        try { more = await searchCommons(q, need * 3); } catch (e) { console.warn(`Commons 失敗(${q}):${e.message}`); }
        await tryItems(more);
      }
      if (have(fam, part) >= def.want) break;
    }
  }
  if (cooled) console.log('\n⚠ 撞上來源 IP 級限流(HTTP 429),本輪提前收工;約 10 分鐘後重跑同指令續補。');
  console.log(`\n本輪下載 ${fetched} 張;重跑同指令可續補缺額。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
