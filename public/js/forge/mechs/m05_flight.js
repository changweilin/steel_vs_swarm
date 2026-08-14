// ============ m05@flight 逐機零件檔(航空機體;dev-only)============
// m05「鎖喉」電戰可變機甲 —— **飛行型**(飛鼠滑翔態)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m05_ground_static.jpg(地面型 = 建模主體)
//
// 2026-08-13 使用者定案:「狼人+飛鼠:**重製為狼人為主體,移除羽翼**,飛行型態狼頭朝前,
// 四肢飛鼠一樣打開,飛膜由透明轉實體,爪子更顯眼,尾巴控制方向。」
//   ⇒ 舊制那台「噴射戰機」(壓平機身 + wingF 後掠翼 + 進氣口 + 干擾吊艙 + 尾焰)整組退場:
//     mecha.js gen.sil 的「機身壓平、肩部進氣口、翼下干擾吊艙」是 2D 圖的描述,使用者這一輪
//     把飛行原型從噴射機改成**飛鼠**,升力面因此是**飛膜**不是翼。
//   ⇒ 零件比例:狼人(地面型)75% / 飛鼠 25% —— 飛鼠那 25% 就是「四肢張開的姿態 + 實體飛膜」,
//     其餘(頭/胸/鬃冠/四肢/爪/尾/武器)全部是 m05.js 的同一批零件。
//   ⇒ **尾巴進 rig.tailSegs**:locomotion whipTail 依轉向角速度把尾甩向反側 = 使用者說的
//     「尾巴控制方向」(這一台與 t06 相反 —— t06 的尾是武器瞄準架,刻意不掛)。
import * as THREE from 'three';
import m05 from './m05.js';
import { bipedDims, groundCtx, upright } from './_morph.js';

const PITCH = 1.44;           // 軀幹幾乎水平(滑翔;狼頭朝航向)
const HG = 6.0;               // 地面型的取景高 = 兩態共用的骨架尺度基準

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '鎖喉・飛行型(m05 飛鼠滑翔)', kind: 'air', height: HG,
  air: { tiltY: 3.0, bob: 0.05, top: 30, span: 6.0 },
  moveSig: { hover: 0.22, hoverF: 0.8, hoverA: 0.12, surge: 0.80, flare: 0.70, bank: 0.75 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['狼首朝航向', '地面型楔形狼首(m05.head:錯咬齒列/犬齒/怒眉稜/三角耳殼)+ 反傾中介 Group'],
    ['軀幹 + 鬃冠', '地面型犬科比例軀幹(鬐甲/胸廓/腰段/肩胛板)/胸毛疊瓦板/電戰背包/頸背鬃冠(m05.chest)壓平成滑翔線'],
    ['四肢張開成 X', '同一組臂件/腿件(m05.armUp/armFore/thigh/shin/foot):前肢前外、後肢後外,與體軸各 45°(m05.GLIDE,量自飛鼠解剖圖)'],
    ['飛膜 ×2(實體)', 'm05.patagium 展開:四附著點 = 頸/腕/踝/尾根(解剖圖),輪廓自四肢關節座標推導 + 膜骨 ×3 + 外緣識別稜(地面態 = 收攏成貼體側的半透明皮褶,同一片)'],
    ['爪 ×2 + 足爪 ×6', '加大的彎爪錐(兩態同一組;張開時是全機最顯眼的一批零件)'],
    ['方向舵尾', '三節狼尾節鏈 + 逐節橫向舵羽(扁尾;m05.extra)進 rig.tailSegs ⇒ whipTail 依轉向甩尾控向'],
    ['武裝', '同一具六管電磁旋砲(右)+ 追債者 2×2 制導彈箱(左),由爪直接握著;滑翔時**順著航向收成翼端砲艙**(槍管軸 = 機首方向,不垂下來)'],
  ],

  body(c, t) {
    const dim = bipedDims(m05, HG);
    groundCtx(c, dim);
    c._glide = true;      // 告訴 m05.chest 這一場的飛膜由這裡展開,它不要再建一片收摺的
    const hull = new THREE.Group();
    hull.position.set(0, 0.1, -0.35);
    hull.rotation.x = PITCH;
    t.add(hull);

    const hips = new THREE.Group();
    hull.add(hips);
    m05.pelvis(c, hips, { shoulderX: dim.shoulderX });
    const chest = new THREE.Group();
    hips.add(chest);
    m05.chest(c, chest, { shoulderX: dim.shoulderX, shoulderY: dim.shoulderYl, waistY: dim.waistYl });
    m05.head(c, upright(chest, PITCH - 0.34, 0, dim.headYl, 0.04));   // 狼頭抬起朝航向

    // ---- 四肢像飛鼠一樣張開成 X 字(前肢朝前外、後肢朝後外;膜就撐在這四點之間)----
    // 2026-08-13 使用者「四肢調整為 X 字形」:舊制兩組都往**後**耙(前肢 −0.16、後肢 −0.28)
    // ⇒ 俯視是 K 不是 X。角度一律取 m05.GLIDE(飛膜輪廓吃同一份 ⇒ 改姿勢膜自己跟著走)。
    // 2026-08-14 骨架校準:m05.GLIDE 的掃掠角改由飛鼠解剖圖量到的 **45°** 定(見該常數檔頭),
    // 本檔一格未改 —— 這正是「角度只有一份」的用處:改姿勢時飛行檔不必動,膜也自己跟著走。
    // 每肢兩層 Group:①掃掠 Rz ②繞肢體長軸的 roll Ry —— 有了 ② 第二節的 rotation.x 才在
    // **滑翔面內**折;少了它肘/膝一折就出平面,而正面看完全正常(見 m05.glideFrame 檔頭)。
    const GL = m05.GLIDE;
    const hands = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const piv = new THREE.Group();
      piv.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      piv.rotation.z = sx * (Math.PI / 2 + GL.armSweep);        // 前肢:側向 → 再往機首掃
      chest.add(piv);
      const arm = new THREE.Group();
      arm.rotation.y = -sx * Math.PI / 2;                       // roll:肘的折向轉進滑翔面
      piv.add(arm);
      m05.armUp(cx, arm, { len: dim.upperArmL });
      const fore = new THREE.Group();
      fore.position.y = -dim.upperArmL;
      fore.rotation.x = GL.elbow;
      arm.add(fore);
      m05.armFore(cx, fore, { len: dim.foreArmL });
      const hand = new THREE.Group();
      hand.position.y = -dim.foreArmL;
      hand.rotation.y = sx * Math.PI / 2;                       // 把 roll 轉回來:武器朝向同地面型
      hand.name = `wrist${sx}`;                                 // 探針錨(飛膜前角 MUST 落在這裡)
      fore.add(hand);
      hands[sx] = hand;
    }
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const piv = new THREE.Group();
      piv.position.set(sx * dim.legX, 0, 0);
      piv.rotation.z = sx * (Math.PI / 2 - GL.legSweep);        // 後肢:側向 → 再往機尾掃
      hull.add(piv);
      const leg = new THREE.Group();
      leg.rotation.y = -sx * Math.PI / 2;
      piv.add(leg);
      m05.thigh(cx, leg, { len: dim.thighL });
      const shin = new THREE.Group();
      shin.position.y = -dim.thighL;
      shin.rotation.x = -GL.knee;
      leg.add(shin);
      m05.shin(cx, shin, { len: dim.shinL });
      const foot = new THREE.Group();
      foot.position.y = -dim.shinL;
      foot.rotation.x = GL.toe;                                 // 爪往後拖(飛鼠滑翔時後足是收著的)
      foot.name = `ankle${sx}`;                                 // 探針錨(飛膜後角 MUST 落在這裡)
      shin.add(foot);
      m05.foot(cx, foot, { clear: dim.clear, footL: dim.footL });
    }

    // ---- 飛膜:同一片零件展開成實體膜 ----
    // **掛 chest、零旋轉**:膜與四肢因此同在軀幹的局部 XY 平面上(共面 = 「不越界」的前提)。
    // 舊制掛在反傾錨上轉 −π/2 是要讓膜**水平**,但四肢留在俯仰面 ⇒ 肢端與膜差到 0.3m,
    // 不管輪廓怎麼算都會露出來(2026-08-13 使用者回報的「飛膜越界」有一半是這個)。
    const out = m05.patagiumOutline(HG, dim.G, dim.shoulderX, dim.shoulderYl);
    for (const sx of [-1, 1]) {
      const w = m05.patagium(c, chest, sx, true, out);
      w.position.z = -0.03;
      w.name = `pata${sx}`;
    }

    // ---- 方向舵尾(m05.extra 的同一條三節狼尾)----
    // **MUST 掛在反傾錨上**:節鏈沿局部 −z 往後長,直接掛 hips 會被軀幹前傾 1.44 轉成朝天
    // 的一根立桿(實測第一版就是這樣),而 whipTail 只覆寫節樞軸、不會把它轉回來。
    const stub = { muzzles: {}, heavy: { glow: [] }, wpn: {} };
    m05.extra(c, { hips: upright(hips, PITCH) }, stub);
    c._tail = stub.tailSegs;

    c._W = m05.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });
    // ---- 武裝順著航向收(2026-08-14 D2)----
    // ⚠ 判退實測:m05.mount 給的靜姿是 `Rx(REST=1.62)` —— 那是**地面型**的「手垂著、槍朝前」。
    //   滑翔姿把整條手臂甩到側前方又繞長軸 roll 了 90°,同一個靜姿在這裡解出來的槍管軸是
    //   世界 (0, −0.99, 0.13):**垂直朝下**。逐頂點量到六管旋砲的 y 1.81…3.06 / z 3.06…3.42,
    //   俯視像一支起落架吊在右前肢下(全機最低點 minY 1.8077 就是它)。
    // 修法只有一條式子,而且是**推導**的:手的世界朝向在這一姿裡恰好是繞 z 的單一旋轉
    //   Rz(φ),φ = sx·(π/2 + armSweep + elbow)(掃掠 Rz、roll Ry(∓90°) 夾住的肘 Rx 共軛成 Rz,
    //   最後 hand 的 Ry 又把 roll 轉回來)⇒ 對槍組補 Rz(−φ) 就讓槍管的局部 +y 落回**機首方向**。
    //   角度因此只有 m05.GLIDE 一份:改姿勢時這裡自己跟著走,MUST NOT 手寫一個度數。
    const GPHI = Math.PI / 2 + GL.armSweep + GL.elbow;
    for (const [w, sx] of [[c._W.gunR, 1], [c._W.gunL, -1]]) {
      if (!w?.g) continue;
      w.g.rotation.set(0, 0, -sx * GPHI);
      w.g.position.set(sx * 0.06, -0.10, 0.02);   // 貼回掌心;z 在這一姿是「離滑翔面的高度」⇒ 收到 ~0
    }
  },

  // 升力全部來自飛膜滑翔(無翼、無旋翼、無噴口)
  lift() { return {}; },

  // 尾巴 = 方向舵:掛進 rig.tailSegs ⇒ whipTail 依 yawRate 甩向反側(使用者「尾巴控制方向」)
  tail(c) { return c._tail || null; },

  mount(c) { return { ...c._W, gunR: null, gunL: null, aimPose: null }; },
};
