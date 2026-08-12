// ============ 機體原型參考照採集(dev-only;不進遊戲)============
// 2026-08-12 使用者第四輪:「除了機體圖也搜集下載原型動物或機型圖案,加入展示。」
//
// 「原型是什麼」的唯一真相 = `mecha.js` 的 `proto` 各層(`codex.js PROTO_LAYERS` 定義層集,
// `roster.js protoRefsOf()` 決定這一格該看哪幾層)—— 本檔**不判斷**任何機體是什麼原型,
// 只把那些層的 `src` 翻成搜尋關鍵詞、抓圖、記帳。手寫一份「這台機要找什麼圖」的清單
// 會在 proto 改寫時靜默過期,而畫面上只表現成「參考照跟這台機沒關係」。
//
// 三條邊界(與 tools/ai3d/fetch_photos.mjs 同一套,且**共用它的授權硬閘實作**):
//   ① **授權硬閘**:查詢寫死 CC0,逐張複驗回傳欄位(Openverse license ∈ {cc0,pdm};
//      Commons LicenseShortName 含 CC0 / Public domain)。CC-BY 也拒收 —— 這些圖會躺在
//      儲存庫裡當建模參考,而署名沒有地方放。搜尋/複驗/嗅探三支一律 import 那一支,
//      **MUST NOT 在這裡再寫一份**(第二份授權閘 = 兩套規則,而違規沒有錯誤訊息)。
//   ② **住 tools/ 不住 public/** —— build:solo 是整包複製 public/**,放進去就跟著出貨。
//   ③ **記帳**:每張寫進 tools/proto_refs/manifest.json({source_url, license, creator,
//      query, api});展示台只讀這一份,MUST NOT 掃目錄自己拼。
//
// 跑法:
//   node tools/fetch_protorefs.mjs --list              # 只印「每一格會用什麼關鍵詞去找」(不連網)
//   node tools/fetch_protorefs.mjs                     # 全名冊採集(逐層 N 張,已有的跳過)
//   node tools/fetch_protorefs.mjs --key t06@flight    # 只跑一格
//   node tools/fetch_protorefs.mjs --cat airframe --n 4
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './audit_src.mjs';
import { rosterEntries } from './humanoid_forge/roster.js';
import { CHARACTERS } from '../public/js/data.js';
import { searchOpenverse, searchCommons, sniffImage, licenceOk, UA } from './ai3d/fetch_photos.mjs';

const OUT = join(ROOT, 'tools', 'proto_refs');
const MANIFEST = join(OUT, 'manifest.json');
const MAX_BYTES = 6e6;        // 單張上限(見下方 download 段的理由)
const COMMONS_GAP_MS = 1200;  // Commons 查詢節流(見下方 searchCommons 呼叫點的理由)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 視覺代號 → 搜尋關鍵詞 --------------------------------------------------
// **代號本身是縫**(`data.js CHARACTERS[].visual` 的 creature/ground/flight),本表只做翻譯:
// 有些代號直接就是好用的英文搜尋詞(bee/eagle/wolf/beetle…),有些是內部縮寫(archo/levi/
// roo/trex/ptero…)⇒ 只有後者需要一列。查無 = 直接拿代號當關鍵詞(而不是跳過)。
const CODE_Q = {
  archo: 'archaeopteryx fossil bird', levi: 'airship blimp whale', uav: 'military drone uav',
  tilt: 'tiltrotor aircraft', heli: 'helicopter', jet: 'fighter jet aircraft',
  ptero: 'pterosaur pteranodon', roo: 'kangaroo', trex: 'tyrannosaurus rex skeleton',
  stego: 'stegosaurus', raptor: 'velociraptor deinonychus', cthulhu: 'octopus cephalopod',
  centaur: 'horse anatomy', hound: 'greyhound dog running', ostrich: 'ostrich bird',
  gorilla: 'gorilla knuckle walking', panther: 'black panther leopard', owl: 'barn owl wing',
  monkey: 'macaque monkey', vampire: 'bat wing membrane', atlas: 'humanoid robot',
  biped: 'humanoid robot', elephant: 'african elephant ear', dragon: 'chinese dragon sculpture',
  bee: 'honey bee insect', eagle: 'golden eagle wing',
};

// ---- 中文技術名詞 → 搜尋關鍵詞 ---------------------------------------------
// 只在**拉丁抽取抓不到東西**時才動用(型號/廠牌永遠比通用名詞找得準)。這一張表刻意只收
// 「機型構型」的通名 —— 它翻的是 `proto.src` 裡描述**佈局**的那幾個字,不是機體的名字。
// 命中多個 ⇒ 全部串起來(「雙尾桁 + 貨運無人機」比單一個詞準)。
const ZH_Q = {
  六旋翼: 'hexacopter drone', 四旋翼: 'quadcopter drone', 共軸: 'coaxial rotor helicopter',
  傾轉旋翼: 'tiltrotor', 三旋翼: 'tricopter drone', 旋翼: 'rotorcraft',
  三角翼: 'delta wing aircraft', 鴨翼: 'canard aircraft', 定翼: 'fixed wing uav',
  雙尾桁: 'twin boom aircraft', 飛翼: 'flying wing aircraft', 撲翼: 'ornithopter flapping wing',
  滑翔: 'glider aircraft', 噴射: 'jet aircraft', 穿越機: 'fpv racing drone',
  浮空: 'airship blimp', 氣囊: 'airship envelope', 巡飛彈: 'loitering munition drone',
  外骨骼: 'powered exoskeleton', 步行平台: 'walking robot platform',
  機器狗: 'quadruped robot', 液壓: 'hydraulic actuator', 天線陣: 'phased array antenna',
  測向: 'direction finding antenna', 電子戰: 'electronic warfare aircraft',
  農噴機: 'agricultural spraying drone', 貨運: 'cargo drone', 運補: 'logistics drone',
  裝甲: 'armored vehicle', 砲塔: 'gun turret', 獵槍: 'double barrel shotgun',
  彈炮合一: 'air defence gun missile system', 攔截彈: 'interceptor missile',
  星型引擎: 'radial engine aircraft', 感測轉塔: 'electro optical turret',
};
export function zhTerms(src) {
  const hit = Object.keys(ZH_Q).filter((k) => src.includes(k));
  return hit.length ? hit.map((k) => ZH_Q[k]).slice(0, 2).join(' ') : null;
}

/** 拉丁字串抽取:`proto.src` 是中英混寫(「DJI Matrice 系列工業六旋翼 × 美軍 Golden Horde…」)
 *  ⇒ 中文段落餵給圖庫搜尋幾乎零命中,拉丁段(型號/廠牌/專有名詞)才是可用的查詢。
 *  以「×」拆句、逐段取最長的拉丁 run;一段都沒有 ⇒ 回 null(由代號那條路接手)。 */
export function latinTerms(src) {
  const out = [];
  for (const part of String(src).split(/[×✕x]\s/)) {
    const runs = part.match(/[A-Za-z][A-Za-z0-9\-. ]{2,}/g) || [];
    const best = runs.map((r) => r.trim()).sort((a, b) => b.length - a.length)[0];
    if (best && best.length >= 3) out.push(best);
  }
  return out.length ? out : null;
}

/** 這一層要用什麼關鍵詞找圖:仿生/型態層走代號翻譯,設計/機體原型層走拉丁抽取。 */
export function queryFor(entry, layer) {
  const vis = CHARACTERS[entry.id]?.visual || {};
  const code = layer.key === 'bionic' ? vis.creature
    : layer.key === 'ground' ? vis.ground
      : layer.key === 'air' ? vis.flight
        : null;
  if (code) return CODE_Q[code] || code;
  const lat = latinTerms(layer.src);
  return lat ? lat.join(' ') : zhTerms(layer.src);   // 兩條都沒命中 ⇒ 這一層沒有可用查詢,略過
}

const safeKey = (k) => k.replace(/@/g, '_').replace(/[^\w.-]/g, '');

async function loadManifest() {
  try { return JSON.parse(await readFile(MANIFEST, 'utf8')); }
  catch { return { version: 1, entries: {} }; }
}

async function saveManifest(man) {
  await mkdir(OUT, { recursive: true });
  await writeFile(MANIFEST, `${JSON.stringify(man, null, 2)}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (f, d = null) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };
  const only = arg('--key'), cat = arg('--cat'), n = Number(arg('--n', 3));
  const list = argv.includes('--list');
  const entries = rosterEntries()
    .filter((e) => (!only || e.key === only) && (!cat || e.cat === cat));

  const man = await loadManifest();
  let got = 0, skipped = 0, failed = 0;
  for (const e of entries) {
    for (const layer of e.protos) {
      const q = queryFor(e, layer);
      const dir = join(OUT, safeKey(e.key), layer.key);
      const slot = (man.entries[e.key] ||= {})[layer.key] ||= [];
      if (list) {
        console.log(`${e.key.padEnd(12)} ${layer.key.padEnd(7)} ${q ? `「${q}」` : '(無可用查詢:純中文原型敘述)'}`
          + `  ← ${layer.src.slice(0, 42)}`);
        continue;
      }
      if (!q) { skipped++; continue; }
      if (slot.length >= n) { skipped++; continue; }
      // Openverse 先跑(命中率高、不限流);Commons 只在還缺圖時才問,而且**逐次節流** ——
      // 2026-08-12 實測不節流會從第 20 幾格開始整片 HTTP 429,而 429 不是「這張圖有問題」,
      // 是「我們問太快」⇒ 那一層被記成沒圖,畫面上看不出差別。
      // Commons 掛掉 MUST NOT 連 Openverse 的收穫一起丟(降級不例外,原則 6)。
      let hits = [];
      try { hits = await searchOpenverse(q, n * 2); }
      catch (err) { console.warn(`✗ ${e.key}/${layer.key}:Openverse ${err.message}`); failed++; }
      if (hits.length < n) {
        await sleep(COMMONS_GAP_MS);
        try { hits = [...hits, ...await searchCommons(q, n)]; }
        catch (err) { console.warn(`  · ${e.key}/${layer.key}:Commons ${err.message}(只用 Openverse 的結果)`); }
      }
      if (!hits.length) { failed++; continue; }
      await mkdir(dir, { recursive: true });
      for (const it of hits) {
        if (slot.length >= n) break;
        if (!licenceOk(it.license)) continue;                 // 硬閘第二道(不信任查詢參數)
        if (slot.some((r) => r.id === it.id)) continue;
        const ext = (it.url.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1] || 'jpg').toLowerCase();
        const file = `${it.id}.${ext}`;
        const path = join(dir, file);
        if (!existsSync(path)) {
          try {
            const r = await fetch(it.url, { headers: { 'User-Agent': UA } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const buf = Buffer.from(await r.arrayBuffer());
            if (!sniffImage(buf)) throw new Error('非影像位元組');   // 副檔名與 content-type 都不可信
            // 這些圖只當**看的**參考(不進 img→3D 管線)⇒ 不需要典藏解析度;
            // Commons 的原圖動輒數十 MB,收下來只是把工作目錄撐大。
            if (buf.length > MAX_BYTES) throw new Error(`檔案過大(${(buf.length / 1e6).toFixed(1)}MB)`);
            await writeFile(path, buf);
          } catch (err) {
            console.warn(`  ✗ ${e.key}/${layer.key}/${it.id}:${err.message}`);
            failed++;
            continue;
          }
        }
        slot.push({ id: it.id, file, license: it.license, creator: it.creator || null,
          source_url: it.source_url, query: q, api: it.api });
        got++;
        console.log(`  ✓ ${e.key}/${layer.key}/${file}  (${it.license})`);
      }
      // **逐層落帳**(不是跑完才寫):採集要連幾十次外網,中斷是常態 —— 只在結尾寫一次的話,
      // 被限流掐斷時磁碟上留著圖、帳本裡一列都沒有,而展示台讀的是帳本 ⇒ 看起來像一張都沒抓到。
      await saveManifest(man);
    }
  }
  if (list) return;
  await saveManifest(man);
  console.log(`\n原型參考照:新增 ${got} 張 / 略過 ${skipped} 層 / 失敗 ${failed} 次`);
  console.log(`帳本:tools/proto_refs/manifest.json(展示台 /api/protorefs 只讀這一份)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
