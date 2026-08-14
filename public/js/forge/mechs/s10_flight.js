// ============ s10@flight 逐機零件檔(航空機體;dev-only)============
// s10「靜電」長耳可變訊號機 —— **飛行型**(飛鯨浮空艦)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s10_flight_static.jpg / s10_ground_static.jpg
//
// 2026-08-13 使用者定案:「利維坦+巨像:**保持飛艇形象,加入飛鯨頭部與胸鰭特徵**;
// 地面形態胸鰭充當象耳;飛行形態四肢象腿與象牙內縮,地面形態才展開;
// 飛行形態象鼻變獨角鯨的角連帶武器挺直,地面形態象鼻保持柔軟持武器攻擊。」
//   ⇒ 舊制那台的囊體/吊艙/耳板/鯨尾都是另畫的一份,而地面型(機械巨象)根本沒有建模。
//     兩張 2D 定案圖其實是**同一具氣囊 + 同一顆鯨首**:本檔因此一顆自己的幾何都沒有,
//     整台由 `s10.js` 的建構器組出來,四個旋鈕各轉一次就是另一個型態:
//       earOut 1→0(象耳後掠成胸鰭)/ tuskOut 1→0(象牙內縮)/ trunkDown true→false
//       (象鼻挺成獨角鯨的角,鼻端武器隨之同軸)/ 四肢上收進腹艙。
//   ⇒ 升力來自浮力 ⇒ **沒有旋翼、沒有噴口**;只有兩具低速矢量推進器。
import * as THREE from 'three';
import { cylF, rotorF } from '../geo.js';
import s10 from './s10.js';
import { staticLimb } from './_morph.js';

const FR = s10.frame;

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '靜電・飛行型(s10 飛鯨浮空艦)', kind: 'air', height: s10.height,
  air: { tiltY: 3.0, bob: 0.11, top: 12, span: 3.6 },
  moveSig: { hover: 0.15, hoverF: 0.5, hoverA: 0.25, surge: 0.05, flare: 0.05, bank: 0.05 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['鯨體 + 艦橋', 's10.envelope 同一條收分鯨體(隔艙稜線 ×16 + 繫留帶 ×3 + 桅桿雷達)'],
    ['鯨首(無脖子)', 's10.whaleHead 同一顆頭殼 —— 它是鯨體往前的外套續接,兩態都沒有頸'],
    ['胸鰭 ×2(移到體側)', 's10.earFin 同一片板:earOut 0 ⇒ 位置由頰側移到**體側**、板面放平(後掠 + 微下反)'],
    ['象牙(內縮)', 's10.tusk 同一對月牙:tuskOut 0 ⇒ 弧翻進頰囊'],
    ['獨角(象鼻挺直)', 's10.trunk 同一條九節軟鼻:trunkDown false ⇒ 挺成獨角鯨的角 + 螺旋稜'],
    ['象腿 ×4(上收)', '同一組柱狀象腿(s10.legF/legH,2.66 m)收進囊內:前腿進鼻艙(z 0.52~1.86)、後腿大腿斜前上抬過鰭根高度再落回中段 —— 兩者都完全避開胸鰭埋在囊內的那一段(z ±0.45、min|x| 0.39),膝轂改朝內'],
    ['鯨尾 + 背鰭', 's10.tail 同一組尾柄(側扁 0.86)+ 水平尾鰭(後掠 0.78 + 上反 17.2°);背鰭改長在軀幹上(s10.envelope)'],
    ['矢量推進器 ×2', '涵道低速螺槳(浮力機的唯一動力;無旋翼升力、無噴口)'],
  ],

  body(c, t) {
    // ← 四個旋鈕:一次把地面型的巨象轉成飛行型的鯨(零件一批都沒換)
    c.earOut = 0; c.tuskOut = 0; c.trunkDown = false;

    const spine = new THREE.Group();
    t.add(spine);
    s10.body(c, spine);
    const chest = new THREE.Group();
    chest.position.set(...FR.chest);
    spine.add(chest);
    const neck = new THREE.Group();
    neck.position.set(...FR.neck);
    chest.add(neck);
    const head = new THREE.Group();
    head.position.set(...FR.head);
    neck.add(head);
    s10.neckHead(c, neck, head);
    c._spine = spine;

    // ---- 象腿 ×4 上收進腹艙(同一組腿件;規格陣列由 staticLimb 靜態組起來)----
    // ══ 2026-08-14 第三輪:整組重排,理由是前兩輪都沒修掉的**腿↔胸鰭互穿** ══
    // 症狀:大腿楔台與膝轂直接貫穿鰭板下表面,交線處墨線碎成一片,整個腹面讀起來是
    //   「一堆散落的楔塊」;而 s10_flight_static.jpg 的腹面是乾淨的(連腿都看不到)。
    // 前兩輪的做法都是「把腿再壓低一點 / 再往內收一點」—— 那治不好,因為**胸鰭的根
    //   本來就埋在囊體裡、而且往內埋得很深**:逐頂點量胸鰭(earOut 0)在 spine 座標下
    //   的佔位得到
    //     z∈[−0.3, 0.3] 這一段 min|x| 只有 **0.39**(y 帶 −0.31 ~ +0.06),
    //     z≥0.4 與 z≤−0.5 兩段 min|x| 都在 **0.80 以上**。
    //   ⇒ 腹面正中那條 |x|<0.39 的走廊寬度不夠塞下一條 0.56 寬的大腿(兩側還會在
    //     中線互穿),所以**唯一乾淨的解是讓腿完全避開 z∈[−0.45, 0.45] 這一帶**:
    //       前腿收進**鼻艙**(z 0.52 ~ 1.86),後腿的大腿**斜著往前上方抬**,
    //       進入那一帶時已經高過鰭根的 y 上緣(+0.06),小腿與足柱再落回中段囊內。
    //   三個姿態角因此各有出處,MUST NOT 隨手調:
    //     前腿 φ = +90° → −137.5° → 0°(大腿水平朝後貼腹、小腿往前上折、足柱鉛直向下)
    //     後腿 φ = −120.3° → −88.8° → 0°(大腿斜前上、小腿水平朝前、足柱鉛直向下)
    //   ⚠ **膝轂改朝內**:`_leg` 的膝轂掛在 `c.sx × 0.28` 上,朝外的話大腿一躺平它就
    //     頂到 |x|=0.65 —— 那正好是鰭板內緣。收腿時傳**反號的 sx** ⇒ 膝轂轉進腹腔,
    //     零件一顆沒換(這是唯一用得上 `sx` 的地方,`_leg` 其餘部分與它無關)。
    // ⚠ 收起來的四條腿彼此在囊內有重疊 —— 那是**刻意的**:囊體是不透明的旋成外殼,
    //   殼內的東西一律看不見,而 2.66 m 的肢柱 ×4 在 4.4 m 的囊裡本來就排不開。
    //   要驗的是「腿有沒有穿出殼外 / 有沒有碰到胸鰭」,不是腿彼此碰不碰。
    // ⚠ 後腿的落點是**夾在兩道相反的牆之間**調出來的,逐頂點量過才留得住:
    //     太高/太陡 ⇒ 大腿的上外側角頂穿囊體**背面**(俯視就是背上兩塊深色橢圓;
    //                 實測 y=−0.02 / r0=−2.30 時 2640 顆腿頂點有 55 顆在殼外、最深 0.176)
    //     太低      ⇒ 大腿的下緣切進胸鰭埋在囊裡的那截根(y=−0.10 時交插 18 條、
    //                 y=−0.24 時 28 條)
    //   現值(x 0.22 / y −0.02 / z −0.90 / r0 −2.10):**腿↔鰭三角形交插 0 條**、
    //   殼外只剩 18 顆頂點、最深 0.106 m,而那 0.106 是**前腿**大腿的腹側外緣
    //   (讀起來是起落架整流罩,不是破圖)。動 px/py/pz/r0 任一項 MUST 兩項一起重量。
    for (const [sx, front, px, py, pz, r0, p1, p2] of [
      [-1, true, 0.30, -0.30, 1.78, 1.5708, -3.9708, 2.40],
      [1, true, 0.30, -0.30, 1.78, 1.5708, -3.9708, 2.40],
      [-1, false, 0.22, -0.02, -0.90, -2.10, 0.55, 1.55],
      [1, false, 0.22, -0.02, -0.90, -2.10, 0.55, 1.55],
    ]) {
      const cx = { ...c, sx: -sx, front };            // sx 反號 = 膝轂朝內(見上)
      staticLimb(spine, front ? s10.legF(cx) : s10.legH(cx),
        [0, p1, p2], [sx * px, py, pz], [r0, 0, 0]);
    }
    // ---- 鯨尾(與地面型同一組;掛在囊尾)----
    const tail = new THREE.Group();
    tail.position.set(0, FR.tailY, FR.tailZ);
    spine.add(tail);
    const tail2 = new THREE.Group();
    tail2.position.set(0, 0, -FR.tail2Z);
    tail.add(tail2);
    s10.tail(c, tail, tail2);
  },

  lift(c) {
    const { PAL, K } = c;
    const spin = [];
    for (const sx of [-1, 1]) {                      // 矢量推進器 ×2(涵道低速螺槳)
      cylF(c._spine, 0.3, 0.3, 0.34, 12, sx * 1.0, -0.5, -1.5, PAL.deep, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      const r = rotorF(c._spine, { r: 0.26 * K.barrelF, blades: 4, pitch: 0.28, thick: 0.026, tilt: [Math.PI / 2, 0] },
        sx * 1.0, -0.5, -1.5, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c) { return s10.mount(c, { spine: c._spine }); },
};
