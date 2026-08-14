// ============ 建模版本註冊表(機體展示台唯一縫;dev-only)============
// 2026-08-14 使用者:「機體台的新版展示台 UI 要跟舊版一樣,可以看變形過程,
// 以後擴充不同版本時都用同一套展示台」。
//
// 病灶:舊版對照原本是一顆布林 `legacy` + 散在 viewer.js 五處的 `if (legacy)`
// (建 unit / 樞軸鈕 / 武器頁 / rig 契約欄 / 鈕面切換)。第三個版本進來時那五處各要再補一次,
// 而漏掉任一處**不會報錯** —— 只表現成「切到某個版本時某個功能悄悄用了別版的規則」。
// ⇒ 版本收成**一張表**:一列 = 一個版本(標籤 + 能力旗標 + 怎麼建 + 結構欄怎麼印),
// 展示台只認下面這份「台上單位」契約,一行 `if (版本 === …)` 都沒有。
//
// **台上單位契約**(每個版本的 build() MUST 回這個形狀):
//   { group, rig, joints: Group[], spin: Object3D[], doll: index|null,
//     dolls: {ground, flight}|null, morph: 把手|null }
//   ・`dolls` 只有「一台兩格」的版本有:換型態時看板只把 `doll` 指到台上那一棵,
//     **不重鍛**(重鍛會把 locomotion 的型態狀態一起丟掉 = 變形演出變成瞬切)。
//   ・`joints` 是**陣列**:變形者兩棵樹各有一組樞軸點(單樹的版本就是一組)——
//     收成單一 Group 的話,新版變形者的樞軸鈕會只點亮其中一棵,而另一棵靜靜沒有反應。
//   ・`morph` = locomotion.js `morphSwap` 認的那一格(`group.userData.morph`);
//     舊版是單樹 + `rig.pose(m)` ⇒ 恆 null,而**變形過程照樣看得到** ——
//     兩版的變形都由真品 locomotion 依 `ent.heroY` 驅動(新版 morphSwap / 舊版 stepMorph),
//     展示台只負責把高度推過門檻,MUST NOT 自己寫一份型態插值。
//
// 三條紀律:
//   ① **建構只有這裡一份**:viewer.js MUST NOT 直接呼叫 forgeMech / forgeMorphUnit /
//      buildLegacyUnit —— 那就是第二份「這個版本怎麼建」的規則。
//   ② **變形者一律建兩棵樹**(forgeMorphUnit):只建選中那一格的話,台上根本沒有另一個
//      型態可以變過去,而「看變形過程」就退化成「換一格重新鍛一台」。
//   ③ **能力旗標是宣告的不是問出來的**:編輯/武器頁/樞軸點能不能用寫在這張表上,
//      MUST NOT 由 viewer 去嗅探 `unit.doll == null` 之類的副作用推回來。

import * as THREE from 'three';
import {
  forgeMech, forgeMorphUnit, mergeSpec, specOf,
} from '../../public/js/forge/forge.js';
import { entryKey } from '../../public/js/forge/roster.js';
import { dollFinish } from './dollfinish.js';
// 舊版建模對照(2026-08-14 退役,只留在本台):七支舊 hero 建構器整組住 legacy/,
// 遊戲一行都不 import 它 —— 這裡是它唯一的服役地點。
import { buildLegacyUnit, legacyKindOf } from './legacy/legacy_models.js';

/** 這一格的另一個型態(變形者才有;名冊鍵只有 `entryKey()` 一份,MUST NOT 自己拼 `id_form`) */
export const siblingSpec = (spec) => (spec.form
  ? specOf(entryKey(spec.ch, spec.form === 'flight' ? 'ground' : 'flight'))
  : null);

/** 新版:出廠規格 + 覆寫層 + (選中那一格的)未存檔草稿 → 合併規格 */
const mergeFor = (s, spec, ctx) => {
  const m = mergeSpec(s, ctx.ovrOf(s.id));
  if (s.id === spec.id && ctx.draft) m.doll = ctx.draft;
  return m;
};

function forgeBuild(spec, ctx) {
  const sib = siblingSpec(spec);
  if (spec.form && sib) {
    const G = spec.form === 'ground' ? spec : sib;
    const A = spec.form === 'flight' ? spec : sib;
    const u = forgeMorphUnit(mergeFor(G, spec, ctx), mergeFor(A, spec, ctx), { finish: dollFinish });
    const dolls = { ground: u.ground.doll || null, flight: u.air.doll || null };
    return {
      group: u.group, rig: u.rig, joints: [u.ground.joints, u.air.joints],
      spin: u.spin || [], doll: dolls[spec.form] || null, dolls,
      morph: u.group.userData.morph || null,
    };
  }
  const u = forgeMech(mergeFor(spec, spec, ctx), { finish: dollFinish });
  return {
    group: u.group, rig: u.rig, joints: [u.joints],
    spin: u.spin || u.group.userData.spin || [], doll: u.doll || null, dolls: null, morph: null,
  };
}

function legacyBuild(spec) {
  // 舊版對照:一台機體只有一份舊建模(舊制的變形者是**單樹雙姿**,沒有「型態」這個維度)
  // ⇒ 變形者兩格都拿同一台;取景高沿用本台的建模基準高,兩版並排比例才可比。
  const lu = buildLegacyUnit(spec.ch, { height: spec.height });
  const joints = new THREE.Group();     // 舊建構器沒有樞軸點名冊 ⇒ 空的一組(鈕面另由 caps 關掉)
  joints.visible = false;
  const group = lu ? lu.group : new THREE.Group();
  group.add(joints);
  return { group, rig: lu?.rig || null, joints: [joints], spin: lu?.spin || [],
    doll: null, dolls: null, morph: null };
}

/** rig 契約欄:每個版本印自己的契約(新版的契約表拿去驗舊版一定對不上,那不是「舊版壞了」) */
function forgeRigLines(unit, spec) {
  const rig = unit.rig;
  if (!rig) return [['查無 rig(這一格沒建成)', false]];
  if (spec.kind === 'air') return [
    ['tilt(壓坡樞軸)+ tiltY0/bob/top', !!(rig.tilt && rig.tiltY0 != null && rig.top)],
    ['升力系統(旋翼 / 撲翼 / 噴焰)', !!(unit.spin?.length || rig.wings?.length || rig.jets?.length)],
    ['level(定翼巡航不低頭)', rig.level ? true : !rig.level],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ];
  if (spec.kind === 'quad') return [
    ['spine/chest/neck/head', !!(rig.spine && rig.chest && rig.neck && rig.head)],
    ['legFL/FR/HL/HR + ch ×4', !!(rig.legFL && rig.legFR && rig.legHL && rig.legHR
      && rig.chFL?.length && rig.chFR?.length && rig.chHL?.length && rig.chHR?.length)],
    ['tailSegs(尾鞭)', !!(rig.tailSegs && rig.tailSegs.length >= 2)],
    ['gait 參數(stride/top/bob)', !!(rig.stride && rig.top && rig.bob != null)],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ];
  return [
    ['hips/chest/head', !!(rig.hips && rig.chest && rig.head)],
    ['legL/R + legChain ×2', !!(rig.legL && rig.legChainL.length === 2 && rig.legChainR.length === 2)],
    ['armL/R + armChain ×2', !!(rig.armL && rig.armChainL.length === 2 && rig.armChainR.length === 2)],
    ['aimPose(據槍)', !!rig.aimPose],
    ['gunR/gunL(俯仰)', !!(rig.gunR && rig.gunL)],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ];
}

/**
 * 版本表。**加一個版本 = 加一列**,展示台一行都不用改。
 *   caps.edit   紙娃娃編輯(要有 doll 索引)
 *   caps.wpn    武器獨立檢視(要有 rig.wpn 同源登記)
 *   caps.joints 樞軸點顯示
 *   pair        變形者建的是兩棵樹(⇒ 換型態不必重鍛;單樹版本靠 rig.pose 自己插值)
 */
export const STAGE_VERSIONS = [
  {
    key: 'forge', label: '新版',
    tip: '2026-08-14 起遊戲本體吃的那一份(public/js/forge/ 逐機零件檔)',
    caps: { edit: true, wpn: true, joints: true }, pair: true,
    build: forgeBuild,
    rigLines: forgeRigLines,
  },
  {
    key: 'legacy', label: '舊版',
    tip: '2026-08-14 退役的舊建模(只在本台看得到;遊戲已全面換成新版)',
    caps: { edit: false, wpn: false, joints: false }, pair: false,
    build: legacyBuild,
    rigLines: (unit, spec) => [
      [`舊版建構器:${legacyKindOf(spec.ch) || '(無)'}`, !!unit.rig],
      [`rig.kind:${unit.rig?.kind || '—'}(舊制變形者 = 單樹 rig.pose)`, !!unit.rig?.kind],
      ['已退役,只在本台對照 —— 遊戲已全面換成新版建模', true],
    ],
  },
];

export const versionOf = (key) => STAGE_VERSIONS.find((v) => v.key === key) || STAGE_VERSIONS[0];
