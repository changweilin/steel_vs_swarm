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
import { join, dirname, relative } from 'node:path';
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
  // 第 5 輪大擴充(2026-08-05 使用者定案):「大量下載不同樹種的 2D 照片再 img→3D,
  // 無視舊有物件、不要只是原版重繪」⇒ 樹族改成**逐樹種**列(GIANT_DEFS 的 11 個真實
  // 樹種逐種對位 + VEG_DEFS 常見樹種),查詢一律走實測有效的「具名單一主體」句式;
  // 岩族加四個新岩型;建築族加 img→3D 友善的單一主體模組(使用者定案:建築也走
  // img→3D,計畫書 §8 方法分流已修訂)。族序 = 抓取優先序(fetcher 依序補缺)。
  tree: {                                                    // VEG_DEFS / GIANT_DEFS:樹冠模組/枝叉/板根
    // 第 4 輪品質補抓(2026-08-05):首批 14 張過 SF3D 只有 1 顆實心 —— buttress 查詢命中
    // 臘葉標本掃描、canopy 命中夜拍。與 rock 族同一帖藥:「具名單一主體」——
    // 唯一可用的那張正是空地孤立樹(oak tree canopy → rawpixel 孤樹);板根改點名
    // 以板根聞名的樹種(吉貝木棉/澳洲大葉榕),避開 rainforest(整片都是暗景)。
    canopy:   { want: 12, q: ['solitary oak tree meadow', 'lone tree field', 'isolated tree grassland'] },
    // —— 逐樹種列(GIANT_DEFS 對位)——(排在 fork/buttress 前:那兩列的候選重度
    // Wikimedia-hosted,先跑會把每一輪都撞死在 429 上,樹種列永遠輪不到)
    sp_sequoia: { want: 6, q: ['giant sequoia tree', 'sequoia tree isolated', 'coast redwood tree'] },
    sp_conifer: { want: 8, q: ['lone spruce tree field', 'solitary fir tree meadow', 'single conifer tree'] },
    sp_pine:    { want: 8, q: ['lone scots pine tree', 'stone pine tree isolated', 'solitary pine tree field'] },
    sp_cypress: { want: 5, q: ['italian cypress tree', 'lone cypress tree', 'mediterranean cypress isolated'] },
    sp_euc:     { want: 6, q: ['lone gum tree paddock', 'eucalyptus tree isolated', 'gum tree australia'] },
    sp_tropical:{ want: 6, q: ['kapok tree isolated', 'rainforest emergent tree', 'lone tropical tree field'] },
    // —— 逐樹種列(VEG_DEFS / 場地地貌對位)——
    sp_acacia:  { want: 6, q: ['umbrella thorn acacia', 'acacia tree savanna', 'lone acacia tree'] },
    sp_baobab:  { want: 6, q: ['baobab tree', 'lone baobab tree', 'adansonia tree'] },
    sp_willow:  { want: 5, q: ['weeping willow tree isolated', 'lone willow tree lake'] },
    sp_maple:   { want: 6, q: ['lone maple tree field', 'solitary maple tree autumn', 'isolated maple tree'] },
    sp_banyan:  { want: 5, q: ['banyan tree isolated', 'large fig tree isolated', 'lone ficus tree'] },
    sp_cherry:  { want: 5, q: ['lone cherry blossom tree', 'sakura tree isolated', 'cherry tree in bloom field'] },
    fork:     { want: 8, q: ['tree branch fork bare', 'large tree bough', 'lone bare oak tree winter', 'dead standing tree'] },
    buttress: { want: 14, q: ['ceiba buttress roots', 'kapok tree trunk buttress', 'moreton bay fig trunk', 'strangler fig trunk', 'ficus macrophylla roots'] },
  },
  rock: {                                                    // MEGALITHS:岩面/崩落塊/落石堆
    // 第 3 輪品質補抓(2026-08-05):數量達標 ≠ img→3D 可用 —— CC0 語料重度偏向博物館
    // 掃描/畫作/立體鏡老照片,rock 族逐張人眼覆核後可用率近乎零。改用「現代、單體、
    // 站在空地上」的地物詞:glacial erratic(冰川漂礫)正是「孤立巨石」的專名。
    facet:    { want: 9, q: ['glacial erratic boulder', 'erratic boulder', 'granite boulder isolated'] },
    // 第 2 輪放寬名詞(runbook §4-A:第 1 輪 0/4、1/4 的成因是查詢措辭太窄,不是沒料)
    collapse: { want: 7, q: ['glacial erratic', 'balanced rock formation', 'fallen boulder'] },
    talus:    { want: 4, q: ['scree slope', 'talus slope mountain', 'rock debris slope'] },
    // —— 新岩型(第 5 輪;MEGALITHS/rockfield 的形狀字彙擴充)——
    hoodoo:   { want: 5, q: ['hoodoo rock formation', 'sandstone hoodoo', 'earth pyramid rock'] },
    tor:      { want: 5, q: ['granite tor', 'tor rock formation', 'weathered granite outcrop'] },
    karst:    { want: 5, q: ['limestone karst pinnacle', 'karst rock formation', 'limestone pinnacle'] },
    strata:   { want: 5, q: ['tilted rock strata', 'sedimentary rock outcrop', 'layered rock formation'] },
  },
  building: {                                                // hazards BUILDERS:窗格/簷口/陽台/外管
    window:   { want: 4, q: ['window facade', 'office building facade', 'factory windows'] },
    roofcap:  { want: 4, q: ['rooftop parapet', 'building rooftop', 'roof cornice'] },
    balcony:  { want: 3, q: ['concrete balcony facade', 'apartment balcony module'] },
    piping:   { want: 3, q: ['industrial external piping wall', 'building exterior pipes'] },
    // —— img→3D 友善的單一主體屋頂/立面模組(第 5 輪;使用者定案建築走 img→3D)——
    acunit:   { want: 6, q: ['air conditioner outdoor unit', 'hvac rooftop unit', 'air conditioning condenser'] },
    rooftank: { want: 5, q: ['rooftop water tank', 'stainless steel water tank', 'plastic water tank'] },
    chimney:  { want: 5, q: ['brick chimney', 'industrial chimney stack', 'old brick smokestack'] },
    dormer:   { want: 5, q: ['dormer window roof', 'roof dormer'] },
    // —— 第 6 輪大擴充(2026-08-06 使用者定案):「大量下載不同國家、城市、小鎮、風格的
    // 建築物照片,再進行 img to 3D;無視舊有物件直接畫,禁止使用原版重繪」——
    // 查詢一律走實測有效的「具名單一主體」句式(§5c/§5g:句式勝過所有模型旋鈕);
    // 建物多為獨棟開闊地主體(穀倉/風車/教堂/農舍…),貼街相連的立面列(rowhouse/shophouse)
    // 明知 SF3D 會出薄殼,仍收 —— fill 預篩會擋,留作立面模組語料。列序 = 抓取優先序:
    // 本批接線的模組列在前(tank_wood 供水塔第二款式),整棟風格列供本批與後續批次。
    tank_wood:      { want: 5, q: ['wooden water tower rooftop', 'wooden water tank tower', 'rooftop wooden water tower new york'] },
    bld_barn:       { want: 5, q: ['red barn field', 'old wooden barn', 'lone barn meadow'] },          // 美國鄉間
    bld_windmill:   { want: 5, q: ['dutch windmill', 'stone windmill isolated', 'old windmill field'] }, // 荷蘭
    bld_chalet:     { want: 5, q: ['alpine chalet', 'swiss chalet mountain', 'wooden mountain hut alps'] }, // 瑞士山城
    bld_minka:      { want: 5, q: ['japanese thatched farmhouse', 'gassho zukuri house', 'thatched roof cottage'] }, // 日本合掌造
    bld_hanok:      { want: 4, q: ['korean hanok house', 'hanok traditional building'] },               // 韓國
    bld_pagoda:     { want: 4, q: ['japanese pagoda', 'five storied pagoda', 'stone pagoda'] },         // 東亞塔樓
    bld_medit:      { want: 5, q: ['santorini white house', 'whitewashed greek house', 'mediterranean house isolated'] }, // 地中海
    bld_adobe:      { want: 4, q: ['adobe house', 'pueblo adobe building', 'mud brick house'] },        // 美洲西南/北非
    bld_halftimber: { want: 5, q: ['half timbered house', 'fachwerkhaus', 'tudor house'] },             // 德/英老鎮
    bld_stonecottage:{ want: 5, q: ['stone cottage', 'scottish blackhouse', 'stone farmhouse countryside'] }, // 蘇格蘭/愛爾蘭
    bld_church:     { want: 4, q: ['village church', 'white wooden church', 'country church steeple'] }, // 歐美小鎮
    bld_lighthouse: { want: 4, q: ['lighthouse tower', 'coastal lighthouse isolated'] },                // 海岸
    bld_rowhouse:   { want: 4, q: ['brick townhouse facade', 'amsterdam canal house facade', 'victorian terraced house'] }, // 歐洲城市
    bld_shophouse:  { want: 4, q: ['shophouse facade', 'colonial shophouse'] },                         // 東南亞城鎮
    bld_tower:      { want: 4, q: ['art deco skyscraper', 'apartment tower block', 'brutalist tower'] }, // 城市高樓
    bld_warehouse:  { want: 4, q: ['brick warehouse', 'old factory building', 'industrial warehouse exterior'] }, // 工業
    bld_yurt:       { want: 3, q: ['mongolian yurt', 'ger tent grassland'] },                           // 蒙古草原
  },
  landmark: {                                                // beacons KIND_PARTS:桁架節/微波碟/水塔桶/貨櫃
    lattice:  { want: 4, q: ['electricity pylon', 'transmission tower', 'steel lattice tower'] },
    dish:     { want: 3, q: ['microwave dish antenna tower', 'parabolic antenna'] },
    tank:     { want: 3, q: ['water tower', 'water tank', 'elevated water tank'] },
    container:{ want: 3, q: ['shipping container single', 'cargo container isolated'] },
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

// 供應者排除(2026-08-05 第 5 輪實測):CC0 的語料重心是**博物館/圖書館的數位化館藏** ——
// 逐張人眼複核 19+26 顆 SF3D 產出,fill 排名前段一再是臘葉標本壓葉、19 世紀蛋白照片、
// 石版畫、立體鏡雙聯卡、鉛筆素描明信片。那些東西 img→3D 生不出可用幾何,而**授權完全合法**
// ⇒ 篩不掉的話,每一輪的 GPU 時間都花在注定要丟的候選上。這裡排掉純館藏型供應者;
// rawpixel 刻意留著(它同時供應現代攝影與公版版畫,砍掉會連最好的那幾張一起砍)。
const EXCLUDED_SOURCES = ['smithsonian_cooper_hewitt_museum', 'museumsvictoria', 'digitaltmuseum',
  'sciencemuseum', 'statensmuseum', 'clevelandmuseum', 'smithsonian_national_museum_of_natural_history',
  'smithsonian_institution_archives', 'smithsonian_libraries', 'brooklynmuseum', 'thorvaldsensmuseum',
  'floraon', 'inaturalist', 'biodiversity_heritage_library'].join(',');

/** Openverse:免金鑰;license=cc0 已含 public domain mark */
async function searchOpenverse(q, n) {
  const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0&page_size=${n}`
    + `&excluded_source=${EXCLUDED_SOURCES}`;
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

// magic bytes 嗅探:副檔名與 Content-Type 都不可信(2026-08-05 實測 Commons 一張「照片」
// 是 148 頁 PDF)⇒ 只認檔案開頭位元組;認得的三種 = 影像管線吃得下的三種格式。
function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function download(it, fam, part) {
  const dir = join(PHOTOS, fam, part);
  mkdirSync(dir, { recursive: true });
  const ext = (it.url.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const file = join(dir, `${it.id}.${ext}`);
  if (existsSync(file)) return file;
  const r = await fetch(it.url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  // 非影像是「這張檔案的事實」不是網路狀態 ⇒ 照 404 的規矩記進帳本(ok:false),不落地。
  if (!sniffImage(buf)) throw new Error(`非影像位元組(${buf.subarray(0, 4).toString('hex')})`);
  writeFileSync(file, buf);
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
  // 節流是**逐主機**的:upload.wikimedia.org 撞 429 不代表 rawpixel/flickr 也被封 ——
  // 舊制「一顆 429 整輪收工」讓 Commons-hosted 候選多的零件把整輪額度全數陪葬,
  // 排在後面的零件永遠輪不到。改成:被封主機記進 hostCool,本輪只跳過同主機的候選。
  const hostCool = new Set();
  const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };
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
          if (hostCool.has(hostOf(it.url))) continue;   // 該主機本輪已被 429 封鎖:跳過,別燒成失敗
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
            // 帳本一律記「相對 HERE 的 POSIX 路徑」:舊制 replace(HERE + '/') 在 Windows 上
            // 因分隔符不符靜默失效 ⇒ 別台 worktree 的絕對路徑漏進帳本(2026-08-05 實測 28 筆)。
            entry.file = relative(HERE, await download(it, fam, part)).split('\\').join('/');
            entry.ok = true;
            fetched++;
            console.log(`✓ ${fam}/${part} ← ${it.id}(${it.license})`);
          } catch (e) {
            entry.ok = false; entry.error = e.message;
            console.warn(`✗ ${fam}/${part} ← ${it.id}:${e.message}`);
            // 429 = IP 級限流:它是「這一輪的網路狀態」不是「這張照片的屬性」⇒ 不進帳本
            // (帳本記的是授權與檔案的事實;持續性失敗如 404 仍照記)。封鎖只及**該主機**,
            // 其他主機的候選照抓;全輪早退(cooled)只留給搜尋 API 本身被限流的情況。
            if (/HTTP 429/.test(e.message)) { hostCool.add(hostOf(it.url)); continue; }
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
  if (cooled || hostCool.size) console.log(`\n⚠ 撞上來源 IP 級限流(HTTP 429${hostCool.size ? `;被封主機:${[...hostCool].join(', ')}` : ''}),約 10 分鐘後重跑同指令續補。`);
  console.log(`\n本輪下載 ${fetched} 張;重跑同指令可續補缺額。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
