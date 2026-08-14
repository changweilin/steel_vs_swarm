// ============ 紙娃娃系統 稽核(離線;不需瀏覽器/網路)============
// 用途:改 `tools/humanoid_forge/` 的 doll.js / shapes.js / mark.js / dollapply.js /
// dolledit.js / specstore.mjs,或 forge.js 的收尾(finishUnit)之後跑。
//
// 這一族**壞掉的樣子與「使用者自己就是拖成這樣」長得一模一樣** —— 沒有錯誤訊息、
// 沒有紅字、畫面照樣動,所以每一條都要有人在離線這一端咬著:
//   ① 夾制沒生效 → 覆寫層存進一個 1e30 的角度,下次開機體台整台機體不見(而 JSON 是合法的)。
//   ② 鍵漂掉    → 拖的是左臂,套回去的是右腿;看板不會抱怨,它只是照著文件擺。
//   ③ 套用順序錯 → 貼花貼在「還沒換形狀」的那一顆幾何上,換完形狀貼花就浮在空中。
//   ④ 存檔語意退回整格取代 → 在覆核台調一次比例,機體台存的紙娃娃整份消失。
//   ⑤ 名冊分家   → 面板列得出「六稜柱」但 shapes.js 沒有它,選下去等於什麼都沒發生。
//
// 手法:
//   ・純資料層(doll.js)**零 import** ⇒ 直接 import 真品跑行為直測。
//   ・吃 three 的三支(shapes/mark/dollapply/dolledit)Node 端載不動 ⇒ 讀**執行原文**驗紀律
//     (readSrc 單一縫;逐行剝註解在 CRLF 工作區會靜默失效,見 audit_src.mjs 檔頭)。
//   ・`--break-*` 反向驗證(CLAUDE.md 原則 9):把判定寫回壞版,對應段落 MUST 當場紅字。
//     破壞一律以 `data:` URL 重載被改過的 doll.js 原文 —— 它零 import,是唯一能這樣重載的一支。
//
// 跑法:
//   node tools/audit_paper_doll.mjs
//   node tools/audit_paper_doll.mjs --break-clamp   # 夾制拿掉 ⇒ Ⅰ 紅
//   node tools/audit_paper_doll.mjs --break-key     # 鍵的字集閘拿掉 ⇒ Ⅰ 紅
//   node tools/audit_paper_doll.mjs --break-seam    # 一支鷹架繞過 finishUnit ⇒ Ⅴ 紅
//   node tools/audit_paper_doll.mjs --break-order   # 貼花排到換形狀之前 ⇒ Ⅴ 紅
//   node tools/audit_paper_doll.mjs --break-roster  # 形狀型錄少一款 ⇒ Ⅳ 紅
//   node tools/audit_paper_doll.mjs --break-patch   # 存檔改回整格取代 ⇒ Ⅵ 紅
//   node tools/audit_paper_doll.mjs --break-pilot   # 抬頭退回建模註記/名冊不帶駕駛員 ⇒ Ⅸ 紅
//   node tools/audit_paper_doll.mjs --break-layout  # 武器檢視的第二份入口長回來 ⇒ Ⅹ 紅
//   node tools/audit_paper_doll.mjs --break-marktab # 標記時把資訊欄蓋掉 ⇒ Ⅹ 紅
//   node tools/audit_paper_doll.mjs --break-stageseam # 版本分支長回展示台 ⇒ ⅩⅣ 紅
//   node tools/audit_paper_doll.mjs --break-pair    # 變形者只建一棵樹 ⇒ ⅩⅣ 紅
//   node tools/audit_paper_doll.mjs --break-morph   # 型態不推回報高度 ⇒ ⅩⅣ 紅
//   node tools/audit_paper_doll.mjs --break-rebuild # 換型態順手重鍛 ⇒ ⅩⅣ 紅
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSrc, grabFn } from './audit_src.mjs';
import { patchOvr, loadSpecs } from './humanoid_forge/specstore.mjs';

const BREAK = new Set(process.argv.filter((a) => a.startsWith('--break-')));
const brk = (k) => BREAK.has(`--break-${k}`);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
/**
 * 執行原文(剝掉區塊/行註解;註解裡提得到同一個名字,連著數會把「說明寫得詳細」誤判成縫破了)。
 *
 * ⚠ **行註解 MUST 先剝**(2026-08-13 修):反過來的話,一行註解裡只要出現 `/**`
 * (例如 `// 住 tools/ 不住 public/**`)就會被當成區塊註解的開頭,一路吃到底下第一個
 * `*​/` —— 實測 `fetch_protorefs.mjs` 因此有 88 行**真的程式碼**在稽核眼中消失,
 * 而症狀是「這幾條斷言恆紅,但原文明明就在那裡」。
 */
const code = (s) => s
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const dollSrcRaw = readSrc('tools', 'humanoid_forge', 'doll.js');
const shapesSrc = readSrc('tools', 'humanoid_forge', 'shapes.js');
const markSrc = readSrc('tools', 'humanoid_forge', 'mark.js');
const applySrc = readSrc('tools', 'humanoid_forge', 'dollapply.js');
const editSrc = readSrc('tools', 'humanoid_forge', 'dolledit.js');
// 2026-08-14 新版建模整合:鍛造鷹架搬進 public/js/forge/(遊戲本體的建構器),
// 編輯器那一層(doll/shapes/mark/dollapply)刻意留在 tools/,收尾改以 dollfinish.js 注入。
const forgeSrc = readSrc('public', 'js', 'forge', 'forge.js');
const dfinSrc = readSrc('tools', 'humanoid_forge', 'dollfinish.js');
const storeSrc = readSrc('tools', 'humanoid_forge', 'specstore.mjs');
const reviewSrc = readSrc('tools', 'codex_review', 'review.js');

// ---- 被驗的真品(doll.js 零 import ⇒ 可以直接載;--break-* 時載改過的原文)-------------
let dollSrc = dollSrcRaw;
const bust = (name, from, to) => {
  if (!dollSrc.includes(from)) { console.log(`  ✗ --break-${name} 沒有咬到目標原文(樣式過期)`); process.exit(1); }
  dollSrc = dollSrc.replace(from, to);
};
// 夾制:三元組的 clamp 拿掉(值直接照抄)—— Ⅰ 的值域斷言 MUST 全紅
if (brk('clamp')) bust('clamp', 'const out = v.map((x) => clamp(num(x, def), -lim, lim));',
  'const out = v.map((x) => num(x, def));');
// 鍵的字集閘拿掉 —— 覆寫層是不可信輸入,鍵放行就等於文件裡什麼字串都收
if (brk('key')) bust('key', 'const okKey = (k) => typeof k === \'string\' && k.length <= 64 && KEY_RE.test(k);',
  'const okKey = (k) => typeof k === \'string\';');
const D = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(dollSrc)}`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅰ 覆寫文件的夾制與正規化(doll.js sanitizeDoll —— 唯一縫,三端同吃)');
// ═══════════════════════════════════════════════════════════════════════════
{
  const L = D.DOLL_LIMITS;
  const wild = {
    v: 1,
    bones: {
      hips: { r: [99, -99, 0], p: [1e9, 0, 0], len: 99 },
      'legChainL.0': { len: -5 },
      '../../etc/passwd': { r: [1, 0, 0] },
      ok: {},                                   // 全預設 ⇒ 不落檔
    },
    parts: {
      '1.2.3': { s: [1e9, 0, -3], bevel: 9, glow: -4, color: 0x1000000, shape: 'nope' },
      '2.0': { shape: 'prism6', hide: true },
    },
    marks: Array.from({ length: L.marks + 20 }, () => ({ pid: '1.2', kind: 'totem', p: [0, 0, 0], n: [0, 0, 1], size: 99, text: 'x'.repeat(40) })),
    adds: Array.from({ length: L.adds + 9 }, () => ({ src: '1.2', to: 'chest' })),
  };
  const s = D.sanitizeDoll(wild);
  t('角度夾在 ±π', s.bones.hips.r.every((x) => Math.abs(x) <= L.rot + 1e-12), JSON.stringify(s.bones.hips.r));
  t('位置夾在 ±DOLL_LIMITS.pos', s.bones.hips.p.every((x) => Math.abs(x) <= L.pos + 1e-12), JSON.stringify(s.bones.hips.p));
  t('骨長夾在 [0.25, 3]', s.bones.hips.len <= L.len[1] && s.bones['legChainL.0'].len >= L.len[0],
    `${s.bones.hips.len} / ${s.bones['legChainL.0']?.len}`);
  t('縮放夾在 DOLL_LIMITS.scale', s.parts['1.2.3'].s.every((x) => x >= L.scale[0] && x <= L.scale[1]),
    JSON.stringify(s.parts['1.2.3'].s));
  t('邊緣夾在 ±1', Math.abs(s.parts['1.2.3'].bevel) <= 1, `${s.parts['1.2.3'].bevel}`);
  t('發光夾在 DOLL_LIMITS.glow', s.parts['1.2.3'].glow >= L.glow[0] && s.parts['1.2.3'].glow <= L.glow[1],
    `${s.parts['1.2.3'].glow}`);
  t('顏色夾在 24 bit', s.parts['1.2.3'].color <= 0xffffff, `${s.parts['1.2.3'].color}`);
  t('不認得的形狀丟掉(MUST NOT 猜)', s.parts['1.2.3'].shape === undefined, `${s.parts['1.2.3'].shape}`);
  t('認得的形狀留著', s.parts['2.0'].shape === 'prism6' && s.parts['2.0'].hide === true);
  t('非法鍵丟掉(覆寫層是不可信輸入)', !('../../etc/passwd' in s.bones), Object.keys(s.bones).join());
  t('全預設的格子不落檔(覆寫層只存差異)', !('ok' in s.bones), Object.keys(s.bones).join());
  t('貼花張數夾 DOLL_LIMITS.marks', s.marks.length === L.marks, `${s.marks.length}`);
  t('黏貼件夾 DOLL_LIMITS.adds', s.adds.length === L.adds, `${s.adds.length}`);
  t('貼花尺寸夾 markSize、文字夾長度', s.marks[0].size <= L.markSize[1] && s.marks[0].text.length <= L.text,
    `${s.marks[0].size} / ${s.marks[0].text.length}`);
  t('版本不認得 ⇒ 整份當空白(寧缺勿錯)', D.isEmptyDoll(D.sanitizeDoll({ v: 99, bones: { hips: { len: 2 } } })));
  t('冪等:sanitize(sanitize(x)) 逐位元相同',
    JSON.stringify(D.sanitizeDoll(s)) === JSON.stringify(s));
  t('空文件判定', D.isEmptyDoll(D.emptyDoll()) && !D.isEmptyDoll(s));
  const st = D.dollStats(s);
  t('統計 = 逐類實數', st.bones === Object.keys(s.bones).length && st.parts === Object.keys(s.parts).length
    && st.marks === s.marks.length && st.adds === s.adds.length, JSON.stringify(st));
  // 零法線的貼花無解(朝向算不出來)⇒ 整枚丟掉,MUST NOT 補一個預設方向
  t('零法線貼花丟掉', D.sanitizeDoll({ marks: [{ pid: '1', kind: 'totem', p: [0, 0, 0], n: [0, 0, 0] }] }).marks.length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅱ 骨架鍵推導(boneList:rig 契約 → 可編輯骨;MUST NOT 手寫名冊)');
// ═══════════════════════════════════════════════════════════════════════════
{
  const o3 = (n) => ({ isObject3D: true, name: n });
  const rig = {
    kind: 'biped',                                   // 純量:不是骨
    hips: o3('hips'), chest: o3('chest'), head: o3('head'),
    legChainL: [{ g: o3('kL'), base: 0.1, k: 1, d: 0 }, { g: o3('aL'), base: 0, k: 1, d: 0.2 }],
    tailSegs: [o3('t1'), o3('t2')],
    muzzles: { light: [o3('m')], heavy: [] },        // 物件:不是骨
    lightGlow: [{ mesh: o3('g'), base: 1 }],         // 帳(元素沒有 g/isObject3D):不是骨
    wpn: { light: { nodes: [o3('n')] } },
    kickAmp: { light: 1, heavy: 1.3 },
    s: 1,
  };
  const keys = D.boneKeys(rig);
  t('純量/物件欄位不是骨', !keys.includes('kind') && !keys.includes('muzzles') && !keys.includes('wpn'));
  t('Object3D 欄位 = 一根骨', ['hips', 'chest', 'head'].every((k) => keys.includes(k)), keys.join());
  t('鏈欄位逐節展開(欄位.序)', keys.includes('legChainL.0') && keys.includes('legChainL.1'), keys.join());
  t('Object3D 陣列也逐節展開', keys.includes('tailSegs.0') && keys.includes('tailSegs.1'));
  t('發光帳不是鏈(元素不是骨節)', !keys.some((k) => k.startsWith('lightGlow')), keys.join());
  t('序 = rig 宣告序(面板順序穩定)', keys.indexOf('hips') < keys.indexOf('chest')
    && keys.indexOf('chest') < keys.indexOf('legChainL.0'));
  t('骨標籤查不到就印原鍵(名冊過期只少一句中文,不少一根骨)',
    D.boneLabel('zzz') === 'zzz' && D.boneLabel('legChainL.1') === '左腿 2');
  t('boneList 回得到物件本身(套用端要拿它插編輯座)',
    D.boneList(rig).find((b) => b.key === 'legChainL.0').obj.name === 'kL');
  // 別名去重的規則住 dollapply(同一顆骨掛兩個 rig 欄位:tail ↔ tailSegs.0)
  t('別名去重在套用端(以物件為鍵,第一個鍵勝出)',
    /seen\.has\(b\.obj\)/.test(code(applySrc)) && /seen\.add\(b\.obj\)/.test(code(applySrc)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅲ 決定性(§2.3:圖樣/佈局 MUST NOT 用 Math.random)');
// ═══════════════════════════════════════════════════════════════════════════
{
  for (const [n, s] of [['doll.js', dollSrcRaw], ['shapes.js', shapesSrc], ['mark.js', markSrc],
    ['dollapply.js', applySrc], ['dolledit.js', editSrc]]) {
    t(`${n} 零 Math.random`, !/Math\.random/.test(code(s)));
  }
  t('彩繪亂數走 rng.js 唯一縫', /from '\/public\/js\/rng\.js'/.test(markSrc) && /mulberry32\(m\.seed/.test(markSrc));
  const a = D.markSeed('1.2.3', 0), b = D.markSeed('1.2.3', 0);
  t('貼花種子:同鍵同值(重開頁面圖樣不變)', a === b && Number.isInteger(a), `${a}`);
  t('貼花種子:換零件/換序就換值', D.markSeed('1.2.3', 1) !== a && D.markSeed('9.9', 0) !== a);
  t('doll.js 零 import(離線稽核吃得到真品)', !/^\s*import\s/m.test(dollSrcRaw));
  t('shapes/mark/dollapply 的幾何積木取自 geo.js/toon.js,MUST NOT 自建第二套硬邊化',
    /from '\.\.\/\.\.\/public\/js\/forge\/geo\.js'/.test(shapesSrc) && !/function\s+facet\s*\(/.test(shapesSrc));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅳ 名冊一致(型錄鍵集只有一份:doll.js 宣告、shapes/mark 實作)');
// ═══════════════════════════════════════════════════════════════════════════
{
  let gens = shapesSrc.slice(shapesSrc.indexOf('export const SHAPE_GENS'));
  gens = gens.slice(0, gens.indexOf('\n};'));
  if (brk('roster')) gens = gens.replace(/\n  prism6:[\s\S]*?\n/, '\n');
  const have = [...gens.matchAll(/\n  ([a-z0-9]+):/g)].map((m) => m[1]);
  const want = D.SHAPE_KEYS;
  t('SHAPE_KEYS ⊆ SHAPE_GENS(面板列得出來的都畫得出來)',
    want.every((k) => have.includes(k)), want.filter((k) => !have.includes(k)).join() || '—');
  t('SHAPE_GENS ⊆ SHAPE_KEYS(畫得出來的都在名冊上)',
    have.every((k) => want.includes(k)), have.filter((k) => !want.includes(k)).join() || '—');
  t('每一款都有中文標籤', want.every((k) => D.SHAPE_LABEL[k]), want.filter((k) => !D.SHAPE_LABEL[k]).join() || '—');
  const draw = /const DRAW = \{([^}]*)\}/.exec(code(markSrc))?.[1] || '';
  t('MARK_KINDS 與 mark.js 的圖樣實作逐項對上',
    D.MARK_KINDS.every((k) => draw.includes(k)) && D.MARK_KINDS.every((k) => D.MARK_LABEL[k]), draw.trim());
  t('面板的型錄列表由名冊推導(dolledit MUST NOT 自己寫一份順序)',
    /shapeKeys\(\)\.map/.test(editSrc) && /markKinds\(\)\.map/.test(editSrc));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅴ 套用縫(dollapply / forge 收尾:一份實作、順序、locomotion 互不覆寫)');
// ═══════════════════════════════════════════════════════════════════════════
{
  let ap = code(applySrc);
  // 破壞:把貼花排到換形狀之前(貼花會投影到「等一下就被丟掉」的那顆幾何上)
  if (brk('order')) ap = ap.replace(/(\/\/[^\n]*)?\n\s*d\.marks\.forEach\([\s\S]*?\}\);\n/,
    '\n').replace('const boneObjs = new Set(ix.bones.values());',
    'const boneObjs = new Set(ix.bones.values());\n  d.marks.forEach((m, i) => { const mesh = ix.parts.get(m.pid); if (mesh?.isMesh) applyMark(mesh, m, i); });');
  const iIndex = ap.indexOf('indexUnit(unit)');
  const iBones = ap.indexOf('for (const [key, b] of Object.entries(d.bones))');
  const iParts = ap.indexOf('for (const [pid, q] of Object.entries(d.parts))');
  const iAdds = ap.indexOf('d.adds.forEach');
  const iMarks = ap.indexOf('d.marks.forEach');
  t('索引 MUST 排在任何改動之前(插編輯座會改變樹的形狀)', iIndex > 0 && iIndex < iBones && iIndex < iParts);
  t('順序 = 骨架 → 零件 → 黏貼 → 貼花', iBones < iParts && iParts < iAdds && iAdds < iMarks,
    `${iBones}/${iParts}/${iAdds}/${iMarks}`);
  const partBlock = ap.slice(iParts, iAdds);
  t('換形狀 MUST 排在邊緣之前(否則磨的是等一下就被丟掉的那顆)',
    partBlock.indexOf('applyShape') < partBlock.indexOf('bevelGeo'));
  t('貼花 MUST 在更新世界矩陣之後投影', /updateMatrixWorld\(true\);\n\s*d\.marks\.forEach/.test(ap));
  // 編輯座:骨本身一格不動(locomotion 每幀絕對指派,動它就是雙倍位移)
  const sock = grabFn(applySrc, 'socketOf');
  t('編輯座 MUST NOT 動骨自己的 transform',
    !/bone\.(position|rotation|quaternion|scale)\s*[.=]/.test(code(sock)), code(sock).trim().slice(0, 80));
  t('編輯座是把子節點搬進來(維持單位變換 ⇒ 畫面逐位元不變)', /for \(const c of \[\.\.\.bone\.children\]\) s\.add\(c\)/.test(sock));
  t('編輯座逐鍵去重(同一根骨只插一層)', /ix\.sockets\.get\(key\)/.test(sock) && /if \(s\) return s;/.test(sock));
  // 骨長:子骨只移位置、其餘子節點連幾何一起拉長
  const len = code(grabFn(applySrc, 'applyBoneLen'));
  t('骨長沿骨軸(−y)伸縮', /c\.position\.y \*= f/.test(len));
  t('子骨 MUST NOT 被拉長(只有它的位置跟著移)', /if \(!boneObjs\.has\(c\)\) c\.scale\.y \*= f/.test(len));
  // 黏貼件與原件共用幾何 ⇒ MUST NOT 在複本上 dispose
  t('黏貼件換幾何不 dispose 共用的那一份', /swapGeo\(o, mirrorGeo\(o\.geometry\), false\)/.test(ap));
  t('鏡射是真的翻幾何(繞序 + 法線),MUST NOT 用 scale.x = -1',
    /computeVertexNormals\(\)/.test(shapesSrc) && !/scale\.set\(-1/.test(code(applySrc)));
  t('複本 MUST 清掉原件的建構序路徑', /delete o\.userData\.pid/.test(ap));
  t('換幾何時描邊外殼跟著換(看到的與描的是同一顆)', /isOutline\) c\.geometry = geo\.userData\.outlineGeo/.test(ap));
  t('配色遇到共用材質改建新材質(MUST NOT material.clone —— 賽璐璐補丁不跟著走)',
    /matUse\.get\(m\)[\s\S]{0,40}> 1/.test(ap) && /toonMat\(color/.test(ap) && !/material\.clone\(\)/.test(ap));

  // forge.js:三支鷹架同一個收尾(兩座看板同形的唯一保證)
  let fg = code(forgeSrc);
  if (brk('seam')) fg = fg.replace('return finishUnit({ group: g, rig, joints, spin: g.userData.spin }, spec, H, opts);',
    'return { group: g, rig, joints, spin: g.userData.spin };');
  const rets = (fg.match(/return finishUnit\(/g) || []).length;
  t('三支鷹架(biped/quad/air)全部經 finishUnit 收尾', rets === 3, `${rets} 支`);
  // 收尾的**內容**搬到 dollfinish.js(看板注入),鷹架只留那個鉤:兩件事都要在
  t('鷹架把收尾開成選用鉤(遊戲不傳 = 逐位元同出廠)', /opts\?\.finish/.test(fg));
  t('收尾 = 套用紙娃娃覆寫 + 補描黏貼件',
    /applyDoll\(unit, spec\.doll\)/.test(code(dfinSrc)) && /outlineAdds\(ix/.test(code(dfinSrc)));
  // 2026-08-14 統一展示台:機體台這一端的「怎麼建」整組搬進 versions.js 的版本表
  // (viewer.js 從此不認得任何一個版本)⇒ 收尾的注入點跟著搬,規則一格未變。
  t('兩座看板都傳同一支收尾(同形的唯一保證)',
    /finish: dollFinish/.test(code(readSrc('tools', 'humanoid_forge', 'versions.js')))
    && /finish: FORGE\.dollFinish/.test(code(reviewSrc)));
  t('mergeSpec 帶得動 doll 欄(覆寫層 → 鍛造)', /doll: ovr\?\.doll \?\? base\.doll \?\? null/.test(fg));
  t('applyDoll 全專案只有一個實作', (code(applySrc).match(/export function applyDoll/g) || []).length === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅵ 存檔語意(specstore:兩個寫入端、逐欄 patch —— 整格取代會互相洗掉)');
// ═══════════════════════════════════════════════════════════════════════════
{
  const dir = await mkdtemp(join(tmpdir(), 'svs-doll-'));
  const f = join(dir, 'specs.json');
  const doll = { v: 1, bones: { hips: { len: 1.2 } }, parts: {}, marks: [], adds: [] };
  await patchOvr('t01', { doll }, f);
  await patchOvr('t01', { prop: { hips: 0.5 }, knobs: null }, f);   // 覆核台那一端(比例/旋鈕)
  let st = await loadSpecs(f);
  if (brk('patch')) {                                              // 壞版:整格取代
    st.mechs.t01 = { prop: { hips: 0.5 } };
  }
  t('另一端寫比例時,紙娃娃留著', !!st.mechs.t01?.doll, JSON.stringify(st.mechs.t01 || {}));
  t('比例也寫進同一格', st.mechs.t01?.prop?.hips === 0.5);
  await patchOvr('t01', { doll: null }, f);
  st = await loadSpecs(f);
  t('欄位給 null = 只清那一欄', !st.mechs.t01?.doll && !!st.mechs.t01?.prop, JSON.stringify(st.mechs.t01 || {}));
  await patchOvr('t01', { prop: null }, f);
  st = await loadSpecs(f);
  t('清空的格子整格刪掉(覆寫層只存差異)', !('t01' in st.mechs), JSON.stringify(st.mechs));
  await patchOvr('t02', { doll }, f);
  await patchOvr('t02', null, f);
  st = await loadSpecs(f);
  t('整包 null = 還原出廠(含紙娃娃)', !('t02' in st.mechs));
  t('缺檔 = 全走出廠值(MUST NOT 拋)', (await loadSpecs(join(dir, 'nope.json'))).mechs != null);
  await rm(dir, { recursive: true, force: true });

  // ⚠ 這兩條刻意**不剝註解**:humanoid_forge.mjs 的檔頭寫著 `public/**`,那個 `/*`
  // 會讓「剝區塊註解」的樣式一路吃到下一個 `*/`(連 import 段一起吃掉)⇒ 斷言變成永遠紅字。
  // 改以「只有程式碼會長這樣」的錨定樣式比對,比剝註解更準也更短。
  const fSrc = readSrc('tools', 'humanoid_forge.mjs'), cSrc = readSrc('tools', 'codex_review.mjs');
  const wired = (s) => /^import \{ handleForgeApi \} from '\.\/humanoid_forge\/specstore\.mjs';$/m.test(s)
    && /^\s*if \(await handleForgeApi\(req, res, send\)\) return;$/m.test(s);
  t('兩支 dev server 共用同一個處理器', wired(fSrc) && wired(cSrc), `forge ${wired(fSrc)} / codex ${wired(cSrc)}`);
  t('specstore 是唯一的寫入實作(其餘端 MUST NOT 自己組 specs.json 路徑)',
    ![fSrc, cSrc].some((s) => /join\(ROOT,[^)]*'specs\.json'\)/.test(s)));
  t('覆核台存檔改送逐欄 null(MUST NOT 整包 null,否則洗掉 doll)',
    /prop: Object\.keys\(ovr\.prop\)\.length \? ovr\.prop : null/.test(reviewSrc)
    && /knobs: Object\.keys\(ovr\.knobs\)\.length \? ovr\.knobs : null/.test(reviewSrc));
  t('patch 語意寫在 specstore(單一縫)', /export async function patchOvr/.test(storeSrc));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅶ 編輯器紀律(dolledit:只寫草稿文件、拖曳與重鍛分流)');
// ═══════════════════════════════════════════════════════════════════════════
{
  const ec = code(editSrc);
  t('編輯器 MUST NOT 自己動幾何(換形狀/邊緣一律經文件 → 重鍛)',
    !/new THREE\.(Mesh|BufferGeometry)\(/.test(ec) && !/\.geometry\s*=/.test(ec));
  t('拖曳放手才回寫文件(拖曳中重鍛會把 gizmo 抓著的物件 dispose 掉)',
    /dragging-changed/.test(ec) && /if \(!e\.value\) commitTransform\(\)/.test(ec));
  t('拖曳中停掉軌道鏡頭', /ctx\.orbit\.enabled = !e\.value/.test(ec));
  t('回寫一律再過一次夾制(唯一縫)', /ed\.doc = sanitizeDoll\(ed\.doc\)/.test(ec));
  t('零件是「相對出廠值的差」(重鍛後才對得回去)', /o\.position\.x - base\.p\.x/.test(ec) && /o\.scale\.x \/ base\.s\.x/.test(ec));
  t('重鍛後依**鍵**重新掛回選取', /function attach\(\)/.test(ec) && /selObject\(\)/.test(ec));
  t('滑桿拖曳中不重畫面板(重畫 = 滑桿被換掉,拖一格斷一次)', /rebuild\(false, false\)/.test(ec));
  t('彩繪分頁 MUST detach gizmo(藏起來的 gizmo 照樣攔指標)', /tc\.detach\(\);\s*\n?\s*\/\/|tab === 'paint'\) \{\n\s*tc\.detach\(\)/.test(editSrc));
  t('貼花位置存零件局部座標(存世界座標會隨動畫飄走)', /worldToLocal\(h\.point\.clone\(\)\)/.test(ec));
  t('骨架分頁的目標是編輯座', /I\.sockets\.get\(key\)/.test(ec));
  t('看板只在編輯模式接管點選', /if \(!ed\.on \|\| !I\) return;/.test(ec));
  // 選到骨要當場有座可拖:寫一格「空覆寫」再重鍛是無效的 —— 空覆寫會被 sanitizeDoll
  // 當成沒有改動丟掉(覆寫層只存差異)⇒ 樹上沒有那個座,選了拖不動而面板一切正常。
  let ec2 = ec;
  if (brk('socket')) ec2 = ec2.replace(/function ensureBone\(key\) \{[^}]*\}/,
    'function ensureBone(key) { if (!ed.doc.bones[key]) { ed.doc.bones[key] = { r: [0, 0, 0] }; rebuild(); } }');
  t('選到骨 = 當場補編輯座(MUST NOT 靠空覆寫 + 重鍛)',
    /function ensureBone\(key\) \{ ensureSocket\(ix\(\), key\); \}/.test(ec2), ec2.match(/function ensureBone[^\n]*/)?.[0] || '');
  t('補座走 dollapply 的 ensureSocket(與 applyDoll 同一支 socketOf)',
    /export function ensureSocket/.test(code(applySrc)) && /socketOf\(ix, key, bone\)/.test(code(applySrc)));
  t('分頁切換清掉型別不符的選取(否則零件旋鈕會寫進以骨鍵當零件鍵的格子)',
    /want\.includes\(ed\.sel\.type\)\) ed\.sel = null/.test(ec));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅷ 兩座看板整合(展示台 :8631 / 美術覆核台 :8641:同一支編輯器、同一份標記與樣式)');
// ═══════════════════════════════════════════════════════════════════════════
{
  const revJs = readSrc('tools', 'codex_review', 'review.js');
  let revCss = readSrc('tools', 'codex_review', 'review.css');
  const revHtml = readSrc('tools', 'codex_review', 'index.html');
  const fwdHtml = readSrc('tools', 'humanoid_forge', 'index.html');
  const boardCss = readSrc('tools', 'humanoid_forge', 'board.css');
  const refSrc = readSrc('tools', 'humanoid_forge', 'refstrip.js');
  const apiSrc = readSrc('tools', 'humanoid_forge', 'boardapi.mjs');
  let revForge = revJs;

  // ── 使用者 2026-08-12 回報:「武器招式按鍵擋住機體3D建模」──
  // 病因不是按鈕太多,是**疊層**:`.cr-stage-btns` 同時吃到共用規則的 `bottom: 6px` 與
  // 鍛造台自己那條 `top: 6px` ⇒ 絕對定位被撐成整格高(實測 366px / 380px 的台子),
  // flex 子項跟著 stretch,四顆鈕變成蓋住整台機體的柱子。
  // 故驗的是**結構**:動作鈕 MUST 在畫布外面,而不是「疊得剛剛好」。
  if (brk('overlay')) {
    revCss += '\n.cr-fstage .cr-stage-btns { position: absolute; left: 6px; top: 6px; }\n';
    revForge = revForge.replace('<div class="cr-fstage" id="crForgeStage"></div>',
      '<div class="cr-fstage" id="crForgeStage"><div class="cr-stage-btns"></div></div>');
  }
  t('鍛造台的畫布容器裡沒有別的東西(動作鈕 MUST 在畫布外面)',
    /<div class="cr-fstage" id="crForgeStage"><\/div>/.test(revForge),
    (revForge.match(/<div class="cr-fstage"[^\n]*/) || [''])[0]);
  t('CSS 沒有任何「疊在鍛造畫布上」的絕對定位子選擇器',
    !/\.cr-fstage\s+\.[\w-]+\s*\{[^}]*position:\s*absolute/.test(revCss));
  t('動作鈕列是普通的一列(MUST NOT 絕對定位)',
    /\.cr-fbar\s*\{[^}]*display:\s*flex/.test(revCss) && !/\.cr-fbar\s*\{[^}]*position:\s*absolute/.test(revCss));

  // ── 使用者同一輪:「紙娃娃系統與原型照片也加入機體美術台整合」──
  t('編輯器只有一支:覆核台動態 import dolledit.js(MUST NOT 自己寫一個)',
    /import\('\/tools\/humanoid_forge\/dolledit\.js'\)/.test(revJs)
    && /makeDollEditor\(\{/.test(revJs)
    && (code(revJs).match(/function makeDollEditor/g) || []).length === 0);
  t('覆核台只提供場景與回呼(rebuild / save / stored / specKey)',
    /rebuild: \(doc\) =>/.test(revJs) && /save: async \(doc\)/.test(revJs)
    && /stored: \(\) =>/.test(revJs) && /specKey: \(\) =>/.test(revJs));
  t('原型照標記只有一份:兩座看板都 import refstrip.js',
    /from '\/tools\/humanoid_forge\/refstrip\.js'/.test(revJs)
    && /from '\.\/refstrip\.js'/.test(readSrc('tools', 'humanoid_forge', 'viewer.js')));
  t('兩座看板都沒有自己拼原型照的標記(figure.proto 只在 refstrip.js 裡)',
    !/figure class="proto"/.test(code(revJs))
    && !/figure class="proto"/.test(code(readSrc('tools', 'humanoid_forge', 'viewer.js')))
    && /figure class="proto"/.test(refSrc));
  t('共用樣式只有一份:兩張 index.html 都掛 board.css',
    /humanoid_forge\/board\.css/.test(revHtml) && /humanoid_forge\/board\.css/.test(fwdHtml));
  t('紙娃娃面板樣式 MUST NOT 留在任一頁的 inline style(那就是第二份 CSS)',
    !/\.d-row\s*\{/.test(fwdHtml) && !/\.d-row\s*\{/.test(revCss) && /\.d-row\s*\{/.test(boardCss));
  t('原型圖路由只有一份:兩支 server 都轉呼 boardapi',
    /handleBoardApi\(req, res, send\)/.test(readSrc('tools', 'humanoid_forge.mjs'))
    && /handleBoardApi\(req, res, send\)/.test(readSrc('tools', 'codex_review.mjs'))
    && /export async function handleBoardApi/.test(apiSrc));
  t('名冊推導在伺服器端(客戶端 MUST NOT 拼原型照檔名)',
    /manifest\.json/.test(apiSrc) && !/proto_refs\//.test(code(revJs))
    && !/proto_refs\//.test(code(readSrc('tools', 'humanoid_forge', 'viewer.js'))));
  // 一邊自轉一邊拖 gizmo = 零件被拉往「拖的那一瞬間鏡頭在的地方」
  t('覆核台編輯時停自轉(與展示台同一條)', /autoRotate = !fapp\.editOn/.test(code(revJs)));
  t('覆核台重鍛不重新取景(每拖一格就重新取景 = 鏡頭一直跳)',
    /fapp\.framedKey !== fapp\.key/.test(code(revJs)));
  // 這座台先前沒有任何 headless 入口 ⇒ 純視覺的壞法在離線這端一條都量不到
  t('覆核台有 headless 入口(手動步進 + 顯式渲染 + 落盤)',
    /window\.__cr = \{/.test(revJs) && /step: \(n = 1/.test(revJs) && /shot: async \(name\)/.test(revJs));
  t('截圖落盤路由與展示台同一支(boardapi)', /'\/__shot\/'/.test(apiSrc)
    && !/'\/__shot\/'/.test(code(readSrc('tools', 'humanoid_forge.mjs'))));

  // ── 使用者同一輪:「機體美術台沒看到武器模組跳轉頁面」──
  let wpnSrc = readSrc('tools', 'humanoid_forge', 'wpnview.js');
  const viewerSrc = readSrc('tools', 'humanoid_forge', 'viewer.js');
  if (brk('dollvis')) wpnSrc = wpnSrc.replace(
    'unit.group.traverse((o) => { if (o.isMesh) o.visible = !o.userData.dollHidden; });',
    'unit.group.traverse((o) => { if (o.isMesh) o.visible = true; });');
  t('武器檢視只有一支實作(wpnview.js),兩座看板都轉呼',
    /export function showWpn/.test(wpnSrc)
    && /from '\.\/wpnview\.js'/.test(viewerSrc)
    && /import\('\/tools\/humanoid_forge\/wpnview\.js'\)/.test(revJs));
  t('兩座看板都沒有自己撈 wpn.nodes(那就是第二份武器檢視)',
    !/wpn\?\.\[?\w*\]?\.nodes|for \(const n of w\.nodes/.test(code(revJs))
    && (code(viewerSrc).match(/w\.nodes/g) || []).length === 0);
  // 切回機體時「全部顯示」MUST 尊重紙娃娃的隱藏覆寫,否則藏起來的零件會自己冒出來
  t('回到機體的全開 MUST 跳過紙娃娃藏起來的零件',
    /o\.visible = !o\.userData\.dollHidden/.test(wpnSrc)
    && /mesh\.userData\.dollHidden = true/.test(code(applySrc)));
  t('鈕面只列掛得到的槽位(點下去卻退回機體 = 鈕面在說謊)',
    /wl \? `<button[^`]*data-view="light"/.test(revJs) && /wh \? `<button[^`]*data-view="heavy"/.test(revJs));
  // 入口:鍛造區塊在第三段、離頁首兩個畫面 ⇒ 沒有頁首入口就等於沒有這個功能
  let entry = revJs;
  if (brk('entry')) entry = entry.replace('<div class="cr-jump" id="crForgeJump"></div>', '');
  t('頁首有跳轉入口(⚙ 機體鍛造 / 🧷 紙娃娃 / 武器)',
    /id="crForgeJump"/.test(entry) && /data-jump="doll"/.test(entry) && /data-jump="light"/.test(entry));
  t('抬頭列有檢視分頁與紙娃娃開關(捲兩個畫面才看得到的入口 = 沒有入口)',
    /id="crForgeView"/.test(revJs) && /class="cr-fhead"/.test(revJs) && /id="cfDoll"/.test(revJs));
  t('三個入口同吃一支切換(MUST NOT 各自寫一份「開啟編輯器」)',
    (code(revJs).match(/function setForgeView/g) || []).length === 1
    && /data-jump/.test(revJs) && /\$\('cfDoll'\)\.click\(\)/.test(revJs));
  t('武器頁停止移動(取景框定住而機體繼續走 ⇒ 武器飄出畫面)',
    /if \(fapp\.view !== 'mech'\) \{ fapp\.speedTgt = 0; fapp\.speed = 0; \}/.test(code(revJs)));
  // 取景是在**鍛造靜姿**下量的,而切過去的第一幀手臂就彈到據槍姿(t01 實測位移 >1.5m)
  // ⇒ 武器當場被甩出畫面。兩座看板 MUST 都在姿勢落定後補一次取景。
  let reframeV = code(viewerSrc), reframeC = code(revJs);
  if (brk('reframe')) {
    reframeV = reframeV.replace(/if \(reframeNext && view !== 'mech'\)[^\n]*\n/, '');
    reframeC = reframeC.replace(/if \(fapp\.reframeNext && fapp\.view !== 'mech'\)[^\n]*\n/g, '');
  }
  t('展示台:切武器頁後在姿勢落定的那一幀重取景',
    /reframeNext && view !== 'mech'/.test(reframeV) && /reframeNext = true/.test(reframeV));
  t('覆核台:同一條(rAF 迴圈與 headless step 都要有)',
    (reframeC.match(/fapp\.reframeNext && fapp\.view !== 'mech'/g) || []).length === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅸ 機體 ⇄ 角色(機體台抬頭的駕駛員關係:每一欄都到原處取)');
// ═══════════════════════════════════════════════════════════════════════════
// 2026-08-12 使用者:「機體台中,機體與角色的關係還沒更新」。
// 這一段守的是**同一件事在兩座看板說同一句話**:機體名/陣營/機種/全高/羈絆全部由
// codex.js 的識別段推導,MUST NOT 在看板端手寫,也 MUST NOT 拿 mechs/*.js 的建模註記
// (`label`)當機體名 —— 那份註記換陣營/改 `machine` 時不會跟著動,而畫面上只表現成
// 「名冊鈕與抬頭寫著兩個不一樣的機體名」,沒有任何錯誤訊息。
{
  const { rosterEntries } = await import('../public/js/forge/roster.js');
  const { CHARACTERS } = await import('../public/js/data.js');
  const { mechaCodex, charCodex } = await import('../public/js/codex.js');
  const { LORE } = await import('../public/js/lore.js');

  const rows = rosterEntries();
  t('每一格都解得出駕駛員(缺一格 = 那台機體在台上沒有主人)',
    rows.length > 0 && rows.every((e) => e.pilot?.name && e.pilot?.machine && e.pilot?.bond));
  t('欄位逐一等於原處的值(機體名/陣營/機種/全高/呼號/羈絆)',
    rows.every((e) => {
      const mc = mechaCodex(e.id), cc = charCodex(e.id), lo = LORE[e.id] || {};
      return e.pilot.machine === mc.ident.name && e.pilot.machine === CHARACTERS[e.id].machine
        && e.pilot.code === mc.ident.code && e.pilot.name === mc.ident.pilot
        && e.pilot.sideName === mc.ident.side && e.pilot.kindWord === mc.ident.kind
        && e.pilot.heightM === mc.scaleM && e.pilot.callsign === cc.ident.code
        && e.pilot.bond === mc.deep.bond && e.pilot.role === (lo.role || '');
    }));
  // 變形者兩格是同一個人開的:兩格的駕駛員資料 MUST 逐欄相同(分家 = 地面型與飛行型
  // 在台上看起來像兩台不同的機體)
  t('變形者兩個型態共用同一份駕駛員關係',
    rows.filter((e) => e.form).every((e) => {
      const other = rows.find((x) => x.id === e.id && x.form && x.form !== e.form);
      return other && JSON.stringify(other.pilot) === JSON.stringify(e.pilot);
    }));

  let rosterSrc = readSrc('public', 'js', 'forge', 'roster.js');
  let viewSrc = readSrc('tools', 'humanoid_forge', 'viewer.js');
  if (brk('pilot')) {
    // 壞版 = 退回「看板自己拼一份」:抬頭改印建模註記、名冊格不再帶駕駛員
    const before = rosterSrc + viewSrc;
    rosterSrc = rosterSrc.replace(/\r?\n\s*pilot: pilotOf\(id\),/, '');
    viewSrc = viewSrc.replace(/const mechName = [^\n]*\n/, "const mechName = (s) => s.label;\n");
    if (before === rosterSrc + viewSrc) {
      console.log('  ✗ --break-pilot 沒有咬到目標原文(樣式過期)'); process.exit(1);
    }
  }
  t('名冊格帶著駕駛員(pilotOf 單一縫;看板端 MUST NOT 自己查 CHARACTERS)',
    /export function pilotOf/.test(rosterSrc) && /pilot: pilotOf\(id\)/.test(rosterSrc)
    && !/CHARACTERS\[/.test(code(viewSrc)));
  // `spec.label` 只准出現在「查不到駕駛員」的那條缺料分支(缺了要看得出來,不准靜默留白)
  t('機體名只有一個來源(mechName → pilot.machine,MUST NOT 退回 spec.label)',
    /const mechName = \(s\) => s\.pilot\?\.machine/.test(code(viewSrc))
    && (code(viewSrc).match(/spec\.label/g) || []).length === 1);
  t('抬頭有駕駛員區塊(姓名/呼號/陣營/機種/全高/羈絆)',
    /function pilotHTML/.test(code(viewSrc)) && /pl-bond/.test(viewSrc)
    && /p\.heightM\.toFixed\(2\)/.test(viewSrc) && /p\.callsign/.test(viewSrc));
  // 取景高是展示台自己的常數(mechs/*.js),拿它當機體全高 = 有人照著它改機體比例
  t('全高與展示台取景高分開印(兩個數字 MUST NOT 併成一個)',
    /全高 \$\{p\.heightM/.test(viewSrc) && /取景高 \$\{spec\.height\}/.test(viewSrc));
  t('頭像走 portraits.js 的 avatarURL(MUST NOT 自己拼 assets/avatars 路徑)',
    /from '\/public\/js\/portraits\.js'/.test(viewSrc)
    && !/assets\/avatars/.test(code(viewSrc)));
  t('spec 那一層有把駕駛員帶下去(MECH_SPECS 的 pilot 欄)',
    /pilot: e\.pilot/.test(code(forgeSrc)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅹ 機體台版面(三欄重排 / 控制只留一份 / 覆核意見標記)');
// ═══════════════════════════════════════════════════════════════════════════
// 2026-08-12 使用者:「目前的機體台 UI 很亂,須重構,以可讀性、易於標記為主,整併重複的
// 資訊與功能」。這一段守的是**整併之後不會再長回來**:
//   ① 同一個功能兩個入口(武器檢視:舞台工具列 + 側欄文字跳轉)—— 兩邊各自維護選取態,
//      遲早說出不一樣的話;
//   ② 編輯模式兩顆開關(頁首鈕 + 分頁)—— 有一條路徑忘了同步,就會停在「看起來沒在編輯、
//      點機體卻會選到零件」;
//   ③ 標記時把資訊欄整個蓋掉 —— 正在對照的 2D 定案圖當場消失,而那是標記時唯一要看的東西。
{
  let viewSrc = readSrc('tools', 'humanoid_forge', 'viewer.js');
  let htmlSrc = readSrc('tools', 'humanoid_forge', 'index.html');
  if (brk('layout')) {
    // 壞版 = 把武器檢視的第二份入口(側欄文字跳轉)加回去
    viewSrc = viewSrc.replace('const body = {',
      'const jumps = `<span class="jump" data-go="light">→ 檢視輕武器</span>`;\n  const body = {');
  }
  if (brk('marktab')) {
    // 壞版 = 標記時把資訊欄整個藏起來(改版前的行為)
    viewSrc = viewSrc.replace("$('dollPanel').hidden = !on;", "$('panelBody').hidden = on; $('dollPanel').hidden = !on;");
  }

  t('三欄骨架:左名冊欄 / 中舞台 / 右分頁欄',
    /id="rail"/.test(htmlSrc) && /id="railList"/.test(htmlSrc)
    && /class="stagebar"/.test(htmlSrc) && /id="panelTabs"/.test(htmlSrc) && /id="panelBody"/.test(htmlSrc));
  t('名冊是逐列一格(頭像 + 機體名 + 駕駛員 + 覆核徽章),MUST NOT 退回頂部橫條',
    /function renderRail/.test(code(viewSrc)) && /class="rl-p"/.test(viewSrc)
    && !/specSeg/.test(code(viewSrc)) && !/id="specSeg"/.test(htmlSrc));
  t('演出/視角/檢視控制收在舞台工具列一條(頁首只剩身分)',
    /class="stagebar"/.test(htmlSrc)
    && !/<header>[\s\S]*id="btnFire"[\s\S]*<\/header>/.test(htmlSrc)
    && !/<header>[\s\S]*id="vWpnL"[\s\S]*<\/header>/.test(htmlSrc));
  // ① 武器檢視只有一份入口
  t('武器檢視只有一組控制(側欄的文字跳轉整組退場)',
    (code(viewSrc).match(/data-go=/g) || []).length === 0
    && /id="vWpnL"/.test(htmlSrc) && /id="vWpnH"/.test(htmlSrc));
  // ② 編輯模式只有一個開關
  t('紙娃娃編輯模式的開關只有「標記」分頁一個(btnEdit 全域鈕已退場)',
    /function setTab/.test(code(viewSrc)) && /editor\.setOn\(on\)/.test(code(viewSrc))
    && !/btnEdit/.test(code(viewSrc)) && !/id="btnEdit"/.test(htmlSrc)
    && (code(viewSrc).match(/editor\.setOn/g) || []).length === 1);
  t('headless 入口與人走同一條路(__forge.edit 轉呼 setTab,MUST NOT 自己開關面板)',
    /edit: \(on\) => setTab\(/.test(code(viewSrc)));
  // ③ 標記時參考圖不被蓋掉
  t('標記分頁 MUST NOT 藏掉資訊欄(2D 定案圖是標記時唯一要對照的東西)',
    !/panelBody'\)\.hidden/.test(code(viewSrc)));

  // ---- 覆核意見標記 ----
  t('判決字彙只有 MARK_STATUS 一份(鈕面/徽章/計數全由它推導)',
    /export const MARK_STATUS/.test(code(viewSrc))
    && /MARK_STATUS\.map/.test(code(viewSrc))
    && (code(viewSrc).match(/'✔'|'✎'/g) || []).length === 2);   // 只在字彙表裡各出現一次
  t('意見存在既有覆寫層的 review 欄(逐欄 patch,MUST NOT 另開第二本帳)',
    /saveOvr\(spec\.id, \{ review \}\)/.test(code(viewSrc))
    && !/api\/(review|marks)/.test(code(viewSrc)));
  t('意見是逐格的(名冊鍵),不是逐角色',
    /const markOf = \(key\) => OVR\[key\]\?\.review/.test(code(viewSrc))
    && /markIcon\(e\.key\)/.test(code(viewSrc)));
  t('清除走同一條寫入路徑(status 為空 ⇒ patch 掉整欄)',
    /const review = status \|\| note/.test(code(viewSrc))
    && /: null;/.test(code(viewSrc)));

  // 行為直測:review 與 doll 併存(逐欄 patch —— 在標記分頁打一個 ✔ 不可以洗掉紙娃娃)
  {
    const dir = await mkdtemp(join(tmpdir(), 'svs-mark-'));
    const f = join(dir, 'specs.json');
    await patchOvr('t01', { doll: { bones: {}, parts: { '1.0': { color: 1 } }, marks: [], adds: [] } }, f);
    await patchOvr('t01', { review: { status: 'fix', note: '腰甲要再厚', at: '2026-08-12 14:00' } }, f);
    const st1 = await loadSpecs(f);
    await patchOvr('t01', { review: null }, f);
    const st2 = await loadSpecs(f);
    t('打一個意見不會洗掉紙娃娃(逐欄 patch)',
      !!st1.mechs.t01.doll && st1.mechs.t01.review.status === 'fix'
      && !!st2.mechs.t01.doll && st2.mechs.t01.review === undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅺ 原型參考照的判決 / 重搜 / 使用者自貼(帳本形狀只有一份)');
// ═══════════════════════════════════════════════════════════════════════════
// 2026-08-12 使用者:「有些機體搜索的照片完全不符合機體原型,加入標記與註解以重新搜索,
// 或是使用者直接貼上照片」。這一段守三件會靜默壞掉的事:
//   ① 判不符只刪檔、不記黑名單 ⇒ 同一個查詢詞下一輪把同一張抓回來(看起來像標記沒有用);
//   ② 關鍵詞覆寫看板寫了、採集端沒讀 ⇒ 使用者改了搜尋詞而下一輪還是照舊去找;
//   ③ 使用者自己貼的圖混進 cc0 那一堆 ⇒ 帳本在說謊(CC0 硬閘管的是我們去抓的那些)。
{
  const store = await import('./humanoid_forge/refstore.mjs');
  let fetchSrc = readSrc('tools', 'fetch_protorefs.mjs');
  const apiSrc2 = readSrc('tools', 'humanoid_forge', 'boardapi.mjs');
  const stripSrc = readSrc('tools', 'humanoid_forge', 'refstrip.js');
  const viewSrc2 = readSrc('tools', 'humanoid_forge', 'viewer.js');
  if (brk('reject')) fetchSrc = fetchSrc.replace(/\n\s*if \(rejected\(man[^\n]*\n/, '\n');
  if (brk('override')) fetchSrc = fetchSrc.replace('const q = over || queryFor(e, layer);', 'const q = queryFor(e, layer);');

  t('帳本的形狀只有一份(refstore.mjs;兩個寫入端同吃)',
    /export async function loadManifest/.test(readSrc('tools', 'humanoid_forge', 'refstore.mjs'))
    && /from '\.\/humanoid_forge\/refstore\.mjs'/.test(fetchSrc)
    && /from '\.\/refstore\.mjs'/.test(apiSrc2)
    && !/async function loadManifest/.test(code(fetchSrc)));   // 採集端不准自己再開一份
  t('採集端讀關鍵詞覆寫(看板改了搜尋詞,下一輪就要用它)',
    /queryOverride\(man, e\.key, layer\.key\)/.test(code(fetchSrc))
    && /const q = over \|\| queryFor/.test(code(fetchSrc)));
  t('判不符的 id 進黑名單且採集端會跳過(否則下一輪抓回同一張)',
    /if \(rejected\(man, e\.key, layer\.key, it\.id\)\) continue;/.test(code(fetchSrc)));
  t('看板的三條寫入路由只改帳本,MUST NOT 在請求裡連外網',
    /url\.startsWith\('\/api\/protorefs\/'\)/.test(code(apiSrc2))
    && !/searchOpenverse|searchCommons/.test(code(apiSrc2)));
  t('使用者自貼的圖標成 user(MUST NOT 混進 cc0)',
    /license: 'user'/.test(code(readSrc('tools', 'humanoid_forge', 'refstore.mjs')))
    && /m\.user \? '使用者提供'/.test(stripSrc));
  t('上傳 MUST 嗅探真實位元組並夾大小(副檔名與 content-type 都是輸入方說了算)',
    /sniffImage\(buf\)/.test(code(apiSrc2)) && /MAX_UPLOAD/.test(code(apiSrc2)));
  t('標記/重搜的標記只有一份(兩座看板共用 refstrip.js,viewer 不自己拼)',
    /function refTuneHTML/.test(code(stripSrc)) && /data-refbad=/.test(stripSrc)
    && !/data-refbad="/.test(code(viewSrc2).replace(/querySelectorAll\('\[data-refbad\]'\)/g, '')));
  t('寫入只有一個呼叫處(refPost),貼上三條路只有一個落地點',
    /export const refPost/.test(code(stripSrc))
    && (code(stripSrc).match(/refPost\('upload'/g) || []).length === 1
    && (code(viewSrc2).match(/fetch\('\/api\/protorefs\//g) || []).length === 0
    && (code(viewSrc2).match(/refPost\(/g) || []).length === 0);
  t('行為也只有一份:兩座看板都轉呼 bindRefStrip(MUST NOT 各綁一套)',
    /export function bindRefStrip/.test(code(stripSrc))
    && /bindRefStrip\(box, spec\.id/.test(code(viewSrc2))
    && /bindRefStrip\(\$\('crRefStrip'\), key/.test(code(readSrc('tools', 'codex_review', 'review.js'))));
  t('改過帳本要丟快取(否則畫面停在改之前那一份)',
    /export const dropRefsCache/.test(code(stripSrc)) && /dropRefsCache\(spec\.id\)/.test(code(viewSrc2)));
  // import 這支去看查詢詞不可以觸發一整趟採集(2026-08-12 踩過:當場把圖庫限流撞更深)
  t('fetch_protorefs 只有被當成程式跑才採集(import 是惰性的)',
    /if \(entry\) main\(\)/.test(code(fetchSrc)) && /import\.meta\.url\.endsWith/.test(code(fetchSrc)));

  // 行為直測:判不符 → 黑名單 + 移列;覆寫 → 讀得回來;自貼 → 標 user
  {
    const dir = await mkdtemp(join(tmpdir(), 'svs-refs-'));
    const man = { version: 1, entries: {}, tune: {} };
    store.slotOf(man, 't01', 'frame').push({ id: 'ov_x', file: 'ov_x.jpg', license: 'cc0', api: 'openverse' });
    const r = await store.rejectImg(man, 't01', 'frame', 'ov_x.jpg', '這是坦克不是機甲', dir);
    store.retune(man, 't01', 'frame', { q: 'main battle tank turret' });
    const row = await store.addUserImg(man, 't01', 'frame', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'png', '我自己拍的', dir);
    t('判不符:移列 + 進黑名單 + 刪檔,三件一起',
      r.ok && store.slotOf(man, 't01', 'frame').every((x) => x.id !== 'ov_x')
      && store.rejected(man, 't01', 'frame', 'ov_x'));
    t('覆寫讀得回來(採集端問的就是這一支)',
      store.queryOverride(man, 't01', 'frame') === 'main battle tank turret'
      && store.tuneOf(man, 't01', 'frame').note === '這是坦克不是機甲');
    t('自貼的列:license/api 都是 user,且不帶 source_url',
      row.license === 'user' && row.api === 'user' && row.source_url === null);
    await rm(dir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ Ⅻ 來源與構圖(Google 官方 API / 全身照 + 背景乾淨的篩選)');
// ═══════════════════════════════════════════════════════════════════════════
// 2026-08-13 使用者:「不要只搜索 wiki,直接搜索 google」「必須搜索全身照,盡可能背景乾淨,
// 現有的照片不符合條件的也重新搜索」。三件會靜默壞掉的事:
//   ① 爬 google 的搜尋頁 ⇒ 違反服務條款、而且哪天被擋的樣子是「今天開始一張都抓不到」;
//   ② 沒設金鑰時如果用拋的,整趟採集會在第一層就死掉(而其他兩個來源本來還能用);
//   ③ 構圖門檻散成兩份(採集端一份、重新打分一份)⇒ 剛抓進來的合格、隔天重跑變不合格。
{
  let fetchSrc3 = readSrc('tools', 'fetch_protorefs.mjs');
  const photoSrc = readSrc('tools', 'ai3d', 'fetch_photos.mjs');
  const screenSrc = readSrc('tools', 'screen_protorefs.mjs');
  const pySrc = readSrc('tools', 'screen_protorefs.py');
  if (brk('screen')) {
    // 壞版 = 採集端不篩構圖(抓到什麼就落帳)。**改的 MUST 是採集端那一支**:
    // 先前這一行改的是 screen_protorefs.mjs,而斷言讀的是 fetch_protorefs.mjs
    // ⇒ `--break-screen` 是個安靜的 no-op(紅 0 條 = 那條斷言根本沒被驗到)
    const was = fetchSrc3;
    fetchSrc3 = fetchSrc3.replace(/\r?\n\s*const sc = await screenOne\(path\);/, '');
    if (was === fetchSrc3) { console.log('  ✗ --break-screen 沒有咬到目標原文(樣式過期)'); process.exit(1); }
  }

  t('Google 走官方 Custom Search API(MUST NOT 爬搜尋頁)',
    /googleapis\.com\/customsearch\/v1/.test(code(photoSrc))
    && !/google\.com\/search/.test(code(photoSrc)));
  t('沒設金鑰 = 跳過這個來源(回空陣列,MUST NOT 拋)',
    /if \(!key \|\| !cx\) return \[\];/.test(code(photoSrc)));
  t('授權硬閘照舊(查詢帶 rights,且帳本不假裝它跟 CC0 同級)',
    /rights=cc_publicdomain/.test(code(photoSrc)) && /license: 'pd\(google 回報\)'/.test(code(photoSrc)));
  t('三個來源都在採集端串起來,Google 先跑',
    /searchGoogle\(`\$\{q\} \$\{COMPOSE_Q\}`/.test(code(fetchSrc3))
    && /searchOpenverse\(q/.test(code(fetchSrc3)) && /searchCommons\(q/.test(code(fetchSrc3)));
  t('構圖詞只加在 Google(其他兩家的 metadata 不寫這種話,加了會把命中打成 0)',
    (code(fetchSrc3).match(/COMPOSE_Q/g) || []).length === 2);   // 定義一次 + 用一次
  t('構圖門檻只有一份(採集端與重新打分同吃 SCREEN)',
    /export const SCREEN = \{/.test(code(screenSrc))
    && /import \{ screenOne \}/.test(code(fetchSrc3))
    && !/BG_MIN|COV_MAX|TOUCH_MAX/.test(code(fetchSrc3)));
  t('採集端在**落帳之前**篩(不合格的當場刪檔 + 進黑名單)',
    /const sc = await screenOne\(path\)/.test(code(fetchSrc3))
    && /if \(sc && !sc\.ok\)/.test(code(fetchSrc3)));
  // Python 的註解裡本來就會提到 manifest(檔頭在講「為什麼不碰它」)⇒ 驗的是**程式碼**
  const pyCode = pySrc.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  t('量在 Python、判與寫帳本在 Node(Python MUST NOT 碰帳本)',
    /import json/.test(pyCode) && !/manifest/.test(pyCode)
    && /spawn\('python'/.test(code(screenSrc)));
  t('沒有 python/PIL ⇒ 降級成不篩,MUST NOT 把整批判成不合格',
    /ps\.on\('error', \(\) => res\(null\)\)/.test(code(screenSrc))
    && /if \(lines === null\) return null;/.test(code(screenSrc)));
  t('使用者自己貼的照片不進構圖篩選(他知道自己要什麼)',
    /if \(r\.api === 'user'\) continue;/.test(code(screenSrc)));
  t('--annotate 只標不刪(還沒有替代品時,刪光比留著更糟)',
    /if \(note && !apply\)/.test(code(screenSrc)) && /annotate\(man, b\.key/.test(code(screenSrc)));

  // 行為直測:三個門檻各自咬得住(量測值是假的,驗的是判準)
  const S = await import('./screen_protorefs.mjs');
  const good = { bg_clean: 0.92, coverage: 0.3, edge_touch: 0.01 };
  t('判準:乾淨棚拍過、雜背景/特寫/壓邊各自不過',
    S.verdict(good).ok
    && !S.verdict({ ...good, bg_clean: 0.4 }).ok
    && !S.verdict({ ...good, coverage: 0.95 }).ok
    && !S.verdict({ ...good, edge_touch: 0.3 }).ok
    && S.verdict({ ...good, bg_clean: S.SCREEN.BG_MIN }).ok);   // 門檻是「≥」不是「>」
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('■ ⅩⅣ 展示台版本註冊表 + 變形過程(2026-08-14:一套展示台,每一版都上同一座)');
// ═══════════════════════════════════════════════════════════════════════════
// 使用者:「機體台的新版展示台 UI 要跟舊版一樣,可以看變形過程,以後擴充不同版本時
// 都用同一套展示台」。這一段守三件會靜默壞掉的事:
//   ① **版本分支長回 viewer**:舊制是一顆布林 `legacy` + 五處 `if (legacy)`(建 unit /
//      樞軸 / 武器頁 / rig 契約欄 / 鈕面)。第三個版本進來時漏補任何一處都不報錯,
//      只表現成「切到某個版本時某個功能悄悄用了別版的規則」。
//   ② **變形沒有東西可以變**:新版建模的變形者是兩棵樹,只建選中那一格的話台上根本沒有
//      另一個型態 —— 而畫面上只是「按了型態鈕沒反應」,每一條既有斷言照樣全綠。
//   ③ **換型態順手重鍛**:重鍛把 locomotion 的型態狀態一起丟掉 ⇒ 收摺/換樹/展開整段不見,
//      看到的是瞬切。使用者這一輪要的正是那個「過程」。
{
  let viewSrc = readSrc('tools', 'humanoid_forge', 'viewer.js');
  let verSrc = readSrc('tools', 'humanoid_forge', 'versions.js');
  const htmlSrc = readSrc('tools', 'humanoid_forge', 'index.html');
  const fgSrc = readSrc('public', 'js', 'forge', 'forge.js');
  const bustSrc = (name, src, from, to) => {
    if (!src.includes(from)) { console.log(`  ✗ --break-${name} 沒有咬到目標原文(樣式過期)`); process.exit(1); }
    return src.replace(from, to);
  };
  // 壞版 ①:展示台自己認得某一個版本(版本分支長回來)
  if (brk('stageseam')) viewSrc = bustSrc('stageseam', viewSrc,
    'unit = ver.build(spec, { ovrOf: (id) => OVR[id], draft: draftDoll });',
    'unit = legacy ? buildLegacyUnit(spec.ch) : ver.build(spec, { ovrOf: (id) => OVR[id], draft: draftDoll });');
  // 壞版 ②:變形者只建選中那一棵
  if (brk('pair')) verSrc = bustSrc('pair', verSrc,
    'const u = forgeMorphUnit(mergeFor(G, spec, ctx), mergeFor(A, spec, ctx), { finish: dollFinish });',
    'const u = forgeMech(mergeFor(spec, spec, ctx), { finish: dollFinish });');
  // 壞版 ③:型態不推回報高度(鈕還在、台上不動)
  if (brk('morph')) viewSrc = bustSrc('morph', viewSrc,
    'ent.heroY = formT * MORPH.GROUND_Y * 2;', 'ent.heroY = 0;');
  // 壞版 ④:換型態照樣重鍛(變形過程被砍成瞬切)
  if (brk('rebuild')) viewSrc = bustSrc('rebuild', viewSrc,
    'if (keep) retargetDoll(); else buildUnit();', 'buildUnit();');
  const vc = code(viewSrc), rc = code(verSrc);

  t('版本只有一張表(versions.js),展示台不認得任何一個版本的名字',
    /export const STAGE_VERSIONS/.test(rc)
    && !/legacy/i.test(vc) && !/legacy_models/.test(viewSrc));
  t('建構只有版本表一份(viewer MUST NOT 直接呼叫任何建構器)',
    /ver\.build\(spec/.test(vc)
    && !/forgeMech\(|forgeMorphUnit\(|buildLegacyUnit\(/.test(vc));
  t('版本鈕由表推導(index.html 只放空容器,MUST NOT 寫死某一版的鈕)',
    /for \(const v of STAGE_VERSIONS\)/.test(vc)
    && /id="verSeg"/.test(htmlSrc) && !/btnLegacy/.test(htmlSrc));
  t('能力旗標宣告在表上、鈕面吃它(MUST NOT 由 viewer 嗅探 unit 的副作用推回來)',
    /caps: \{ edit:/.test(rc)
    && /ver\.caps\.wpn/.test(vc) && /ver\.caps\.joints/.test(vc) && /ver\.caps\.edit/.test(vc));
  t('rig 契約欄由版本自己印(新版的契約拿去驗舊版一定對不上)',
    /rigLines\(unit, spec\)/.test(vc) && /rigLines:/.test(rc));
  t('樞軸點是**逐棵一組**(變形者兩棵樹;收成單一 Group 只點得亮一棵)',
    /joints: \[u\.ground\.joints, u\.air\.joints\]/.test(rc)
    && /for \(const j of unit\?\.joints \|\| \[\]\)/.test(vc));

  t('變形者一律建兩棵樹(只建一棵 = 按了型態鈕沒有東西可以變過去)',
    /forgeMorphUnit\(mergeFor\(G/.test(rc));
  t('鍛造縫交得出兩棵子單位(看板要拿那一棵的紙娃娃索引與樞軸)',
    /ground: G, air: A/.test(code(fgSrc)));
  t('變形過程只有一條驅動:型態推 ent.heroY 過門檻,插值讓真品 locomotion 做',
    /ent\.heroY = formT \* MORPH\.GROUND_Y/.test(vc)
    && /from '\/public\/js\/data\.js'/.test(viewSrc));
  t('型態進度只**讀** locomotion 那一份(自己再阻尼一次 = 第二條變形曲線)',
    /unit\?\.morph\?\.m \?\? ent\.loco\?\.morph/.test(vc)
    && !/damp\(/.test(vc));
  t('型態 = 選另一格(名冊的單位本來就是 (機體, 型態)),鍵只有 entryKey 一份',
    /function setForm/.test(vc) && /siblingSpec\(spec\)/.test(vc)
    && /entryKey\(spec\.ch/.test(rc) && !/`\$\{spec\.ch\}@/.test(rc));
  t('同一台變形者換型態 MUST NOT 重鍛(重鍛 = 變形過程被砍成瞬切)',
    /unitKeyOf\(s\) === unitKey/.test(vc)
    && /s\.form \? s\.ch : s\.id/.test(vc)
    && /if \(keep\) retargetDoll\(\); else buildUnit\(\);/.test(vc));
  t('型態鈕的標籤由 FORM_LABEL 推導(MUST NOT 在 HTML 手寫地面型/飛行型)',
    /Object\.entries\(FORM_LABEL\)/.test(vc)
    && !/地面型|飛行型/.test(htmlSrc) && /id="formSeg"/.test(htmlSrc));
}

console.log(`\n${fail ? '❌' : '✅'} 紙娃娃系統稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
