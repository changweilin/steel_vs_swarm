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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSrc, grabFn } from './audit_src.mjs';
import { patchOvr, loadSpecs } from './humanoid_forge/specstore.mjs';

const BREAK = new Set(process.argv.filter((a) => a.startsWith('--break-')));
const brk = (k) => BREAK.has(`--break-${k}`);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
/** 執行原文(剝掉區塊/行註解;註解裡提得到同一個名字,連著數會把「說明寫得詳細」誤判成縫破了) */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

const dollSrcRaw = readSrc('tools', 'humanoid_forge', 'doll.js');
const shapesSrc = readSrc('tools', 'humanoid_forge', 'shapes.js');
const markSrc = readSrc('tools', 'humanoid_forge', 'mark.js');
const applySrc = readSrc('tools', 'humanoid_forge', 'dollapply.js');
const editSrc = readSrc('tools', 'humanoid_forge', 'dolledit.js');
const forgeSrc = readSrc('tools', 'humanoid_forge', 'forge.js');
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
    /from '\.\/geo\.js'/.test(shapesSrc) && !/function\s+facet\s*\(/.test(shapesSrc));
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
  if (brk('seam')) fg = fg.replace('return finishUnit({ group: g, rig, joints, spin: g.userData.spin }, spec, H);',
    'return { group: g, rig, joints, spin: g.userData.spin };');
  const rets = (fg.match(/return finishUnit\(/g) || []).length;
  t('三支鷹架(biped/quad/air)全部經 finishUnit 收尾', rets === 3, `${rets} 支`);
  t('收尾 = 套用紙娃娃覆寫 + 補描黏貼件', /applyDoll\(unit, spec\.doll\)/.test(fg) && /outlineAdds\(ix/.test(fg));
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

console.log(`\n${fail ? '❌' : '✅'} 紙娃娃系統稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
