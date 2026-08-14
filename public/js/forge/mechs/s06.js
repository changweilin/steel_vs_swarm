// ============ s06 逐機零件檔(dev-only;仿生四足 D.kind 'quad' + rider)============
// ── s06「輓歌」凱隆式護衛機甲(centaur 半人馬):四足底盤 + 人形上身雙手據長槍 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s06_{static,moving,heavy}.png(★ = s06_moving)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫(照 ★ 圖逐部位):騎士方稜盔 + 背包塔雙天線;
//   步槍 = 反器材軌道狙擊槍;馬軀/馬臀/馬腿/尾見下方 doc。迷彩塗裝是 paint 層(已知偏差)。
//
// 2026-08-13 使用者:「人馬:左右手都要畫出來,武器拿在雙手上有如穩定器,
//   移動時不會隨著身體晃動(還是有後座力)」⇒ 三件事,逐件的**依據**寫在這裡:
//
// ① 穩定射擊台 = 槍與雙臂一起改掛 **stabYoke**(head 之下 −0.92 的中介 Group)。
//    locomotion.js stepQuad 的 rider 分支(:794-842)是一條**逐節反吃**的鏈:
//      腰(neck)−40% → 胸(humChest)−40% → 頸(humNeck)−15% → 頭反轉 −95% 殘量。
//    ⇒ 各節點對馬軀俯仰 hp 的世界殘量:humChest 0.20·hp、humNeck 0.05·hp、head 0.0025·hp。
//    實測(playwright 量 matrixWorld,速度 1、150 幀):槍口世界俯仰 p2p
//      舊制(掛 humChest)10.51°、head 節點 0.34° ⇒ **同一條鏈上現成的陀螺節點**。
//    head 位於 humChest 局部 (0, 0.72+0.20, 0) ⇒ stabYoke 置於 head 局部 (0,−0.92,0) 時,
//    它的靜姿框與舊的 humChest 框**逐位元相同** ⇒ 肩/槍的既有座標一格不用改算。
//    雙臂 MUST 跟著搬(留在 humChest 上就是手隨身體晃、槍不動 = 手與槍分家);
//    肩軸位於 z=0(接近反吃樞軸)⇒ 肩相對軀幹只走 ~3cm,由**可見的伸縮阻尼**吸收。
// ② 左右手:掌 + 逐指兩節 + 指節環,兩手姿態不同 ——
//    右手扣握把(掌貼握把 +x 面、四指越過前緣繞 −x 捲、食指落在扳機護圈內、拇指對握),
//    左手掌心朝上托護木(四指自 −x 側向 +x 越過護木底面往上捲、拇指沿護木側面)。
//    ⚠ 手指方向與捲曲平面由**兩層 Group** 表達(finF 紀律 ③:Rz 與 Ry 寫在同一顆網格
//    會被尤拉序 XYZ 互轉);指節彎折一律繞該指根框的 z。
// ③ armBase 靜姿角**不准手寫** —— armPair()/ikAt() 閉式反解(見其檔頭),目標點 = 槍身上的
//    握把/護木托點;自由度(繞上臂自轉的 Y)以「手肘最低且不越中線」決定 ——
//    v1 手寫的那組把兩隻上臂張成水平翅膀(s06_b0_back 實測)。
// ④ 後座力仍在:gunPitch(rig.gunR) 的槍口上跳一格未動,另補制退器葉片
//    heavyPivot(蓄力張開、擊發 −0.85 反向甩回);armSh 的 rKick/rChg 也照吃。
//
// 2026-08-13 使用者:「人馬平時單手持槍放鬆,射擊時才維持現在的雙持向前」⇒ **兩態**,
//   而唯一能跨幀變化的通道是 locomotion 每幀重讀的那幾格資料。逐件的依據:
// ⑤ **槍改掛右腕之下**(hold 樞軸 → gun),不再掛 stabYoke:使用者要的是「槍跟著右手走」,
//    而放鬆姿的右手會下來。掛在腕下 ⇒ 手與槍**恆為剛體**(據槍姿的世界擺位與上一版逐位元相同,
//    見 gun.position 的推導),穩定台的效果也沒掉 —— 鏈仍是 head → yoke → 肩 → 肘 → 腕,
//    馬軀俯仰的世界殘量照舊由 head 那一節吃掉(0.0025·hp)。
// ⑥ **兩態的資料通道 = getter**:`armBase[i].shX/.shZ/.elX` 與 `gunR.rest/.aim` 從純資料
//    變成**計算屬性**,依 `rig._aim` 在「據槍姿 ↔ 放鬆姿」之間內插(rig._aim 本身已被
//    stepCombatFx 阻尼過 ⇒ 這裡線性內插即可)。locomotion.js **一行都不用改**。
//    ⚠ 後人 MUST NOT 把 armBase 當常數整份 clone/展開 —— 那會讓兩態靜默失效(姿勢凍在放鬆姿)。
// ⑦ **共用自轉軸**:rider 分支只寫 sh.rotation.x/.z ⇒ `sh.rotation.y` 是靜態的,
//    兩姿 MUST 共用同一個 Y ⇒ armPair 掃 Y 時**兩姿一起挑**(細節見其檔頭)。
//    代價:據槍姿的右肘自 (0.64,0.09,−0.11) 移到 (0.39,0.18,−0.35)(手/槍/槍口一格未動 ——
//    腕點與腕框朝向都被 IK 釘死,動的只有上臂繞自身軸的自轉)。
// ⑧ 腕俯仰 ψ 是**第四個自由度**:三個關節角只夠把手放到位,槍口俯角要靠它。
//    ψ 由 armPair 以「最貼近設計方向 CARRY」閉式解出,並經 gunR.rest≡aim 這條通道
//    交給 gunPitch ⇒ **後座與蓄力項原封不動**疊在它上面。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:視窗紅(★ 圖頭部紅色橫縫;武器發光仍走 c.accent)
const RED = 0xff2f3c;

/**
 * 兩節鏈 IK 閉式反解(給定自轉自由度 Y)—— 靜姿角的**唯一產生處**(MUST NOT 手寫一組角度)。
 * 鏈 = 肩 Group(three 預設尤拉序 'XYZ' ⇒ R = Rx·Ry·Rz)→ 肘 Group(只轉 x)→ 腕;
 * 肢體朝 −y(geo.js segLimbF 同一套符號)。S/T = 肩樞軸與腕目標(同一個框,本檔 = stabYoke)。
 *   ① 餘弦定理反解肘角 θ ⇒ 腕在肩局部 P = (0, −a−b·cosθ, −b·sinθ),且 |P| ≡ |T−S|。
 *   ② P 幾乎沿 −y ⇒ Ry 近似「繞上臂自轉」= 幾何自由度;給定 Y 後
 *      由 x 分量閉式解 Z(vx = −cy·sinZ·cosY + cz·sinY,只含 sinZ ⇒ 兩個分支),
 *      再由 y/z 分量解 X = atan2(vz,vy) − atan2(z1,y1)。
 *   ③ 逐解做一次正運動學驗算(殘差 > 1e-4 丟掉);代價 = 肘高 + 越過身體中線的懲罰。
 * 構不到就把目標拉到最遠端(原則 6 寧缺勿錯:不回 NaN、不硬解)。|sinZ| > 1 = 該 Y 無解。
 * 回傳合法分支陣列(可能是空的)。
 */
function ikAt(S, T, a, b, sx, Y) {
  const d = [T[0] - S[0], T[1] - S[1], T[2] - S[2]];
  let D = Math.hypot(d[0], d[1], d[2]);
  const cap = a + b - 0.012;
  if (D > cap) { const f = cap / D; d[0] *= f; d[1] *= f; d[2] *= f; D = cap; }
  const th = -Math.acos(Math.max(-1, Math.min(1, (D * D - a * a - b * b) / (2 * a * b))));
  const py = -a - b * Math.cos(th), pz = -b * Math.sin(th);
  const cy = py / D, cz = pz / D;
  const v = [d[0] / D, d[1] / D, d[2] / D];
  const sY = Math.sin(Y), cY = Math.cos(Y);
  const sZ = (cz * sY - v[0]) / (cy * cY);
  if (!(Math.abs(sZ) <= 1)) return [];                        // NaN 也在這裡被擋掉
  const eu = new THREE.Euler(), qq = new THREE.Quaternion();
  const pw = new THREE.Vector3(), ew = new THREE.Vector3();
  const zA = Math.asin(sZ), out = [];
  for (const Z of [zA, Math.PI - zA]) {
    const y1 = cy * Math.cos(Z), z1 = cy * sZ * sY + cz * cY;
    const X = Math.atan2(v[2], v[1]) - Math.atan2(z1, y1);
    qq.setFromEuler(eu.set(X, Y, Z, 'XYZ'));
    pw.set(0, py, pz).applyQuaternion(qq);
    if (Math.hypot(pw.x - d[0], pw.y - d[1], pw.z - d[2]) > 1e-4) continue;
    ew.set(0, -a, 0).applyQuaternion(qq);                     // 手肘(肩局部框的位移)
    out.push({ shX: X, shY: Y, shZ: Z, elX: th, cost: ew.y + 0.9 * Math.max(0, -sx * (S[0] + ew.x)) });
  }
  return out;
}

/** 肩+肘的鏈旋轉(尤拉序 'XYZ' ⇒ R = Rx·Ry·Rz,再串肘的 Rx)。 */
function chainQ(k) {
  return new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(k.shX, k.shY, k.shZ, 'XYZ'))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(k.elX, 0, 0, 'XYZ')));
}

/**
 * **兩姿聯解**(據槍 Ta ↔ 放鬆 Tr)—— 本輪的核心約束在這裡:
 * locomotion.js 的 rider 分支(:831-838)每幀只寫 `sh.rotation.x` / `.z` 與 `el.rotation.x`,
 * **`sh.rotation.y` 自建構期起一格不動** ⇒ 兩姿 MUST 共用同一個自轉自由度 Y。
 * 所以 Y 不再由單姿的代價挑,而是掃過整個 Y 域、要求**兩姿都解得出**,取總代價最小者。
 *
 * 右臂另帶「槍身朝向」項:手與槍是剛體(都掛在腕下的 hold 樞軸上,見 rider),
 * 槍身朝向 = Rw·Rx(ψ),Rw = C_rel·C_aim⁻¹(據槍姿恆為單位四元數)。ψ = **腕俯仰**,
 * 是唯一由 locomotion 驅動的第四個自由度(gunPitch 寫 rig.gunR.g.rotation.x)⇒
 * 給定放鬆姿的鏈旋轉後,ψ 由「最貼近設計方向 dir」**閉式**解出:
 *   fwd·dir = A·cosψ − B·sinψ(A = Rwẑ·dir、B = Rwŷ·dir)⇒ ψ = atan2(−B, A),殘差 1 − |(A,B)|。
 * 代價另計 ψ 的絕對值(腕不過度扭)與槍身正立度 up.y(單手低垂本來就會側傾,只是別翻過去)。
 * 回傳 { aim, rel, psi, q };q = 據槍姿鏈四元數(腕框反轉用)。
 */
function armPair(S, Ta, Tr, a, b, sx, dir) {
  const W = dir && new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const vy = new THREE.Vector3(), vz = new THREE.Vector3(), qi = new THREE.Quaternion();
  let best = null;
  for (let i = -160; i <= 160; i++) {
    const Y = i * 0.01;
    const A = ikAt(S, Ta, a, b, sx, Y);
    if (!A.length) continue;
    const aim = A.reduce((p, q) => (!p || q.cost < p.cost ? q : p), null);
    const R = ikAt(S, Tr, a, b, sx, Y);
    if (!R.length) continue;
    qi.copy(chainQ(aim)).invert();
    for (const rel of R) {
      let psi = 0, cost = aim.cost + rel.cost;
      if (W) {
        const Rw = chainQ(rel).multiply(qi);
        vy.set(0, 1, 0).applyQuaternion(Rw); vz.set(0, 0, 1).applyQuaternion(Rw);
        const A1 = vz.dot(W), B1 = vy.dot(W);
        psi = Math.atan2(-B1, A1);
        const uy = vy.y * Math.cos(psi) + vz.y * Math.sin(psi);
        cost += (1 - Math.hypot(A1, B1)) * 6 + Math.abs(psi) * 0.3 - uy * 0.6;
      }
      if (!best || cost < best.cost) best = { cost, aim, rel, psi };
    }
  }
  // 兩姿湊不出共用 Y:退回「只解據槍姿、放鬆姿 = 據槍姿」(降級,不例外;畫面上等於改制前)
  if (!best) {
    for (let i = -160; i <= 160 && !best; i++) {
      const A = ikAt(S, Ta, a, b, sx, i * 0.01);
      if (A.length) best = { aim: A[0], rel: A[0], psi: 0 };
    }
  }
  return { aim: best.aim, rel: best.rel, psi: best.psi, q: chainQ(best.aim) };
}

/** 角度內插:差值先摺回 (−π, π] —— Z 分支可能落在 π 附近,直接線性內插會繞遠路。 */
const wrapPi = (d) => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
const lerpA = (A, B, t) => A + wrapPi(B - A) * t;

/**
 * 一根手指 = 近節 + 遠節 + 指節環(三顆獨立零件,不是一坨方塊)。
 * dir = 指尖方向、nrm = 彎折平面法線(**都寫在手框座標裡**);spread/curl 繞的都是那條法線。
 * ⚠ 指根框由 makeBasis 直接組(finF 紀律 ③):方向與彎折若拆成尤拉角,three 的 'XYZ' 序
 * 會讓後寫的那一軸把前一軸的結果轉走 —— 四根手指全部歪向同一邊而每顆網格都「看起來對」。
 * 回傳遠節 Group。
 */
function digit(hand, { p, dir, nrm, spread = 0, l0, l1, w, t, curl, col, ring = INK }) {
  const ay = new THREE.Vector3(...dir).normalize();
  const az = new THREE.Vector3(...nrm).normalize();
  const ax = new THREE.Vector3().crossVectors(ay, az).normalize();
  az.crossVectors(ax, ay).normalize();
  const base = new THREE.Group();
  base.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az));
  base.position.set(p[0], p[1], p[2]);
  hand.add(base);
  const k = new THREE.Group();
  k.rotation.z = spread;
  base.add(k);
  finF(k, { len: l0, w0: w, w1: w * 0.88, t }, 0, 0, 0, col, { metalness: 0.6 });
  const rg = torusF(k, w * 0.60, t * 0.30, 0, l0, 0, ring, { metalness: 0.7 });
  rg.rotation.x = Math.PI / 2;                    // 環繞指軸(torusF 的環面在 XY ⇒ 軸轉到 y)
  rg.userData.noOutline = true;                   // 細管描邊會糊成黑塊(§2b)
  const j = new THREE.Group();
  j.position.y = l0;
  j.rotation.z = curl;
  k.add(j);
  finF(j, { len: l1, w0: w * 0.88, w1: w * 0.72, t: t * 0.86 }, 0, 0, 0, col, { metalness: 0.6 });
  return j;
}

/**
 * 右手 = 扣握把。手框 = 腕框再繞 x 傾 0.30(跟著握把的後傾 pg.rotation.x = 0.35)。
 * 腕點 = 槍局部 (0.10,−0.19,−0.09) ⇒ 手框座標 = 槍身座標減腕點再反傾;握把量體換算進手框:
 *   x −0.155…−0.045(掌貼在 +x 面外)、y −0.094…0.106、z −0.066…0.104(前緣);
 *   扳機護圈落在手框 (−0.10, 0.093, 0.097) ⇒ 食指要伸到那裡。
 * 四指**橫越握把前緣**(dir = −x)再繞回 −z 勾住背面 —— 這才是握住一根柱子的走法;
 * 讓指節沿 +z 前伸的話,近節會整根戳在握把前方 0.08m 的空氣裡。
 * 掌/指用 main/lite 階:INK 握把上放 deep 階的手 = 一團看不出來的黑(c1 實測)。
 */
function handGrip(wr, PAL) {
  const g = new THREE.Group();
  g.rotation.x = 0.3;
  wr.add(g);
  tboxF(g, { w0: 0.078, d0: 0.16, w1: 0.072, d1: 0.15, h: 0.19 }, -0.035, 0.005, 0.02, PAL.main, { metalness: 0.6 });   // 掌
  tboxF(g, { w0: 0.075, d0: 0.11, w1: 0.068, d1: 0.10, h: 0.11 }, 0.02, 0.0, 0.015, PAL.mid, { metalness: 0.7 });       // 掌背腕蓋
  // 食(伸進護圈,捲得最少)/ 中 / 無名 / 小:長度與捲角遞變(§2.3 索引函數,零亂數)
  // 指徑取到前臂殼的 1/3 —— c2 實測 0.04 的指節在正常鏡距只有幾個像素,整隻手被前臂吃掉
  const F = [[0.090, 0.122, 0.078, 0.72], [0.028, 0.118, 0.076, 1.15],
    [-0.030, 0.110, 0.070, 1.24], [-0.086, 0.098, 0.062, 1.32]];
  F.forEach(([hy, l0, l1, curl], i) => {
    digit(g, { p: [-0.052, hy, 0.118], dir: [-1, 0, 0.05], nrm: [0, -1, 0],
      spread: -0.10 + i * 0.06, l0, l1, w: 0.052 - i * 0.004, t: 0.049 - i * 0.004, curl, col: PAL.lite });
  });
  // 拇指:沿握把頂前緣往前,再勾向 −x 對握(nrm 取 +y ⇒ 負 curl 才是往 −x)
  digit(g, { p: [-0.038, 0.070, 0.030], dir: [0, -0.2, 1], nrm: [0, 1, 0],
    spread: 0.2, l0: 0.105, l1: 0.082, w: 0.058, t: 0.055, curl: -1.0, col: PAL.lite });
}

/**
 * 左手 = 掌心朝上托護木。手框 = 腕框繞 z 傾 0.12;腕點 = 槍局部 (−0.02,−0.15,0.58)。
 * 護木換算進手框:x −0.045…0.085、y 0.07…0.23(底面 0.07 = 掌板頂面貼上去)。
 * 四指自掌板中央往 +x **從底面下方穿過去**、越過外緣再往上捲貼側面(curl≈1.6);
 * 指根若擺在 +x 邊緣,近節一出手掌就離開護木、指尖懸空 6cm(c1 實測)。
 */
function handCradle(wr, PAL) {
  const g = new THREE.Group();
  g.rotation.z = 0.12;
  wr.add(g);
  tboxF(g, { w0: 0.16, d0: 0.20, w1: 0.15, d1: 0.19, h: 0.055 }, 0.018, 0.014, 0, PAL.main, { metalness: 0.6 });        // 掌板(朝上)
  tboxF(g, { w0: 0.09, d0: 0.13, w1: 0.082, d1: 0.12, h: 0.075 }, -0.058, -0.008, 0, PAL.mid, { metalness: 0.7 });      // 腕蓋
  const F = [[0.076, 0.112, 0.070, 1.66], [0.026, 0.116, 0.074, 1.60],
    [-0.026, 0.110, 0.068, 1.54], [-0.078, 0.100, 0.060, 1.48]];
  F.forEach(([hz, l0, l1, curl], i) => {
    digit(g, { p: [-0.012, 0.028, hz], dir: [1, 0.12, 0], nrm: [0, 0, 1],
      spread: -0.10 + i * 0.05, l0, l1, w: 0.050 - i * 0.004, t: 0.047 - i * 0.004, curl, col: PAL.lite });
  });
  // 拇指:沿護木 −x 側面立起、微捲向 +x 壓住(nrm 取 +z ⇒ 負 curl 是往 +x)
  digit(g, { p: [-0.058, 0.026, 0.020], dir: [0, 1, 0.15], nrm: [0, 0, 1],
    spread: -0.18, l0: 0.100, l1: 0.076, w: 0.056, t: 0.053, curl: -0.55, col: PAL.lite });
}

export default {
  label: '輓歌・凱隆式(s06 機甲・半人馬)', kind: 'quad', height: 5.2,
  frame: {
    hipY: 2.2, legX: 0.6, fz: 1.0, hz: -1.2,
    chest: [0, 0.1, 0.55],
    neck: [0, 0.62, 0.55],              // 騎士腰樞軸(馬肩正上方)
    head: [0, 0.3, 0],                  // rider 分支不用(head 由 D.rider 回傳)
    tailY: 0.05, tailZ: -1.62, tail2Z: 0.7,
  },
  // limb:馬 = **蹄行** —— 腕(膝)鎖得比犬更死(lock 0.55:馬的前肢是被動穩定的支柱),
  // 而遠端球節(fetlock)行程反而最大(reach 1.15,承重時下沉、蹬離時彈回)。
  // 這一組正是「同樣四足、換一種站姿就換一種讀法」的對照組(對照 t04 的犬)。
  gait: { gait: 'trot', gallopType: 'transverse', stride: 2.8, top: 7, bob: 0.09, pitchAmp: 0.08,
    limb: { fore: 'unguligrade', hind: 'unguligrade' } },
  moveSig: { poise: 0.97, idleF: 0.58, idleA: 0.35, launch: 0.48, spool: 0.55, brake: 0.55, settle: 0.70 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['馬軀(四足底盤)', 'tboxF 前後兩段殼+prismF 前胸六角擋甲+latheF 胸腹接合環+鞍側彈袋 ×2+側裙甲+腹下 cablesF 管束'],
    ['馬臀(heavy 圖)', 'finF 背脊鋸齒鰭 ×6(一片一件,索引遞變)+煙幕發射管束 ×4+排氣塔+斜臀殼'],
    ['馬腿 ×4(股→管骨→球節→蹄)', 'prismF 大六角股甲(latheF 圓盤徽+INK 槽線)+楔台股+hydCyl 阻尼+細楔台管骨+latheF 膝/球節圓盤+楔台蹄(COAL)'],
    ['騎士上身(腰→胸→頸→頭)', 'latheF 腰迴轉環+彈袋+慣性艙;tboxF 收分胸艙+prismF 雙胸甲+疊節腹甲;方稜盔+RED 橫縫視窗+背包塔雙天線(noOutline)'],
    ['穩定射擊台(stabYoke)', '雙臂與槍改掛陀螺頭節點下的中介框(對馬軀俯仰的世界殘量 0.20→0.0025 倍,實測槍口 p2p 10.5°→0.3°);肩軸座 ×2+前胸橫樑+台↔軀幹伸縮阻尼 ×2(外筒在軀幹、內桿在台上)'],
    ['雙臂兩態(armSh/armEl)', '據槍姿(雙持向前)↔ 放鬆姿(右手單持、左手離槍垂到腰甲)由 armPair() 兩姿聯解;肩自轉軸兩姿共用(locomotion 不寫 rotation.y)。latheF 肩/腕球節+楔台臂殼+前臂阻尼桿;腕框反轉據槍姿臂旋轉 ⇒ 手可直接寫槍身座標'],
    ['右腕俯仰樞軸(hold)', '手與槍一起掛在它下面(= rig.gunR.g):放鬆姿多壓一個腕俯仰 ψ 讓槍口朝下前方,後座上跳與蓄力反向仍疊在同一顆上'],
    ['右手・扣握把', '掌板+掌背腕蓋+食/中/無名/小四指(finF 兩節+指節環,長度與捲角遞變,食指伸進扳機護圈)+對握拇指壓後緣'],
    ['左手・托護木', '朝上掌板+腕蓋+四指自 −x 側越過護木底面往上捲(finF 兩節+指節環)+沿側面立起的拇指;護木下另加止滑鞍'],
    ['武裝(精準軌道步槍)', 'tboxF 機匣/收短槍托抵肩板/箱型制退器+latheF 瞄準鏡(物鏡=蓄力發光)+後移開槽護木+latheF 長管+摺疊腳架+下插彈匣;制退器葉片 ×2 走 heavyPivot(蓄力張開、擊發反向甩回)'],
    ['尾', 'chainF 五節收分短尾(垂掛)+latheF 尾根環'],
  ],
  body(c, spine, chest) {
    const { PAL, accent } = c;
    // ── 後軀(spine):主殼 + 斜臀殼(★ 臀部往尾根斜收)──
    tboxF(spine, { w0: 0.92, d0: 1.55, w1: 0.78, d1: 1.25, h: 0.78, sz: -0.10 }, 0, 0.02, -0.72, PAL.mid, { metalness: 0.55 });
    const rump = tboxF(spine, { w0: 0.72, d0: 0.5, w1: 0.52, d1: 0.34, h: 0.44, sz: -0.08 }, 0, 0.16, -1.48, PAL.mid, { metalness: 0.55 });
    rump.rotation.x = -0.62;
    // 背脊鋸齒鰭列(s06_heavy:臀背一排小鰭;一片一件、長度索引遞變)
    for (let i = 0; i < 6; i++) {
      const fn = finF(spine, { len: 0.13 + 0.05 * Math.sin(Math.PI * (i + 0.5) / 6), w0: 0.09, w1: 0.022, t: 0.032, sweep: 0.05 },
        0, 0.36, -0.38 - i * 0.19, PAL.deep, { metalness: 0.6 });
      fn.rotation.x = -0.85 - i * 0.05;
    }
    // 鞍掛備彈箱 ×2(後腿髖甲外上方)+ 蓋板 + 識別條
    for (const sx of [-1, 1]) {
      tboxF(spine, { w0: 0.2, d0: 0.82, w1: 0.18, d1: 0.74, h: 0.4 }, sx * 0.56, 0.14, -0.62, PAL.dark, { metalness: 0.5 });
      tboxF(spine, { w0: 0.22, d0: 0.86, w1: 0.18, d1: 0.78, h: 0.08 }, sx * 0.56, 0.38, -0.62, PAL.deep, { metalness: 0.6 });
      bxF(spine, 0.03, 0.05, 0.5, sx * 0.66, 0.2, -0.62, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.4 });
    }
    // 煙幕發射管束 ×4(heavy 圖臀右後;2×2 束、朝後上)+ 座
    const lb = tboxF(spine, { w0: 0.2, d0: 0.24, w1: 0.18, d1: 0.2, h: 0.2 }, 0.3, 0.3, -1.32, PAL.deep, { metalness: 0.6 });
    lb.rotation.x = -0.95;
    for (const [ox, oy] of [[-0.055, -0.05], [0.055, -0.05], [-0.055, 0.05], [0.055, 0.05]]) {
      const tb = cylF(spine, 0.042, 0.045, 0.4, 8, 0.3 + ox, 0.38 + oy * 0.4, -1.42 + oy, INK, { metalness: 0.7 });
      tb.rotation.x = -0.95;
    }
    // 排氣塔(heavy 圖臀左後:直立煙囪 + 頸環)
    const ex = cylF(spine, 0.055, 0.07, 0.46, 8, -0.33, 0.5, -1.26, IRON, { metalness: 0.75 });
    ex.rotation.x = -0.22;
    const exr = torusF(spine, 0.075, 0.018, -0.33, 0.68, -1.30, COAL, { metalness: 0.7 });
    exr.rotation.x = Math.PI / 2 - 0.22;
    // ── 前軀(chest):主殼 + prismF 前胸六角擋甲 + 接合環 + 鞍座 ──
    tboxF(chest, { w0: 1.0, d0: 1.35, w1: 0.88, d1: 1.1, h: 0.82, sz: 0.05 }, 0, 0.02, 0.05, PAL.mid, { metalness: 0.55 });
    const bp = prismF(chest, [[-0.45, -0.32], [0.45, -0.32], [0.59, 0.06], [0.38, 0.41], [-0.38, 0.41], [-0.59, 0.06]],
      0.1, 0, 0.05, 0.72, PAL.main, { metalness: 0.5 });
    bp.rotation.x = -0.12;
    // 鞍座(騎士腰 ring 與馬背之間的接坡;★ 上身自馬肩「長出來」不是懸空)
    tboxF(chest, { w0: 0.72, d0: 0.72, w1: 0.58, d1: 0.56, h: 0.26 }, 0, 0.5, 0.55, PAL.mid, { metalness: 0.55 });
    bxF(chest, 0.5, 0.05, 0.03, 0, 0.32, 0.79, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 胸腹接合環(蓋住脊椎波張縫;latheF 軸轉 z)
    const col = latheF(chest, [[0.55, -0.26], [0.60, -0.16], [0.60, 0.16], [0.55, 0.26]], 12, 0, 0.02, -0.6, dimF(PAL.main, 0.85), { metalness: 0.6 });
    col.rotation.x = Math.PI / 2;
    // 鞍側彈袋 ×2(★ 騎士腰前的馬背彈袋)+ 蓋扣
    for (const sx of [-1, 1]) {
      tboxF(chest, { w0: 0.3, d0: 0.42, w1: 0.26, d1: 0.36, h: 0.3, sz: 0.02 }, sx * 0.5, 0.56, 0.3, PAL.dark, { metalness: 0.45 });
      tboxF(chest, { w0: 0.32, d0: 0.44, w1: 0.26, d1: 0.38, h: 0.09 }, sx * 0.5, 0.74, 0.3, PAL.deep, { metalness: 0.55 });
    }
    // 側裙甲 ×2/側(腹側垂板,微外傾)
    for (const sx of [-1, 1]) for (const [zz, g] of [[0.35, chest], [-0.15, chest]]) {
      const sk = tboxF(g, { w0: 0.07, d0: 0.55, w1: 0.07, d1: 0.46, h: 0.42 }, sx * 0.56, -0.38, zz, PAL.mid, { metalness: 0.55 });
      sk.rotation.z = sx * 0.12;
    }
    // 腹下機構(GUNMETAL)+ 液壓管束(cablesF 一條一件,垂向後軀)
    tboxF(chest, { w0: 0.6, d0: 0.95, w1: 0.68, d1: 1.05, h: 0.3 }, 0, -0.55, 0.0, GUNMETAL, { metalness: 0.7 });
    cablesF(chest, { p0: [0, -0.5, 0.5], p1: [0, -0.45, -1.15], k: 3, r: 0.024, sag: 0.09, spread: 0.06 }, GUNMETAL, { metalness: 0.6 });
    // 前胸識別燈 ×2
    for (const sx of [-1, 1]) bxF(chest, 0.05, 0.05, 0.03, sx * 0.34, -0.2, 0.76, accent, { emissive: accent, emissiveIntensity: 0.6 });
  },
  neckHead() { /* rider 分支:上身住 D.rider */ },
  rider(c, neck) {
    const { PAL, accent } = c;
    // 放鬆度 0..1(1 = 放鬆姿):`rig._aim` 由 locomotion.stepCombatFx(:166)每幀寫入 ——
    // 開火/蓄力期間趨近 1、最後一發後 AIM_HOLD_S(1.5s)內維持 1,之後阻尼回 0
    // ⇒ 它就是「正在射擊」的定義。三處 getter(armBase ×2 + gunR)同吃這一支。
    // ⚠ MUST NOT 寫成 idle + _aim(gunPitch 的 aimF 是那樣算的)—— idle 站著不動時恆為 1,
    //   那會讓「站著」也算成射擊姿,正是這一輪要消掉的狀態。
    // ⚠ 從未開火過時 _aim 是 undefined ⇒ `?? 0` 保底(= 放鬆姿,與建構後第一幀一致)。
    const relaxF = () => 1 - Math.min(1, Math.max(0, c._rig?._aim ?? 0));
    // ── 腰(neck = 腰樞軸):迴轉環 + 腰塊 + 彈袋 + 慣性艙 ──
    latheF(neck, [[0.40, -0.05], [0.45, 0.0], [0.40, 0.06]], 12, 0, -0.02, 0, PAL.deep, { metalness: 0.75 });
    tboxF(neck, { w0: 0.56, d0: 0.46, w1: 0.64, d1: 0.52, h: 0.34 }, 0, 0.16, 0, PAL.mid, { metalness: 0.55 });
    for (const sx of [-1, 1]) tboxF(neck, { w0: 0.16, d0: 0.1, w1: 0.14, d1: 0.09, h: 0.22 }, sx * 0.26, 0.16, 0.26, PAL.dark, { metalness: 0.5 });
    const gy = cylF(neck, 0.09, 0.09, 0.24, 10, 0, 0.1, 0.3, INK, { metalness: 0.85 });
    gy.rotation.x = Math.PI / 2;
    const gr = cylF(neck, 0.095, 0.095, 0.04, 10, 0, 0.1, 0.3, accent, { emissive: accent, emissiveIntensity: 0.7 });
    gr.rotation.x = Math.PI / 2;
    // ── 胸(humChest):收分胸艙 + prismF 雙胸甲 + 疊節腹甲 + 領環 ──
    const humChest = new THREE.Group();
    humChest.position.y = 0.45;
    neck.add(humChest);
    tboxF(humChest, { w0: 0.6, d0: 0.48, w1: 0.88, d1: 0.6, h: 0.66, sz: 0.04 }, 0, 0.3, 0, PAL.main, { metalness: 0.5 });
    for (const sx of [-1, 1])
      prismF(humChest, [[-0.14, -0.16], [0.14, -0.13], [0.20, 0.02], [0.13, 0.16], [-0.13, 0.18], [-0.19, 0.03]].map(([x, y]) => [sx * x, y]),
        0.07, sx * 0.17, 0.42, 0.30, PAL.lite, { metalness: 0.5 });
    tboxF(humChest, { w0: 0.5, d0: 0.12, w1: 0.42, d1: 0.1, h: 0.12 }, 0, -0.0, 0.2, PAL.mid, { metalness: 0.55 });
    tboxF(humChest, { w0: 0.44, d0: 0.11, w1: 0.38, d1: 0.09, h: 0.1 }, 0, -0.11, 0.18, PAL.deep, { metalness: 0.6 });
    const cl = torusF(humChest, 0.16, 0.03, 0, 0.66, 0.02, PAL.deep, { metalness: 0.7 });
    cl.rotation.x = Math.PI / 2;
    bxF(humChest, 0.3, 0.05, 0.03, 0, 0.5, 0.33, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 背包塔(★ 頭後方雙層背包 + 高低雙天線)+ 纜線垂到槍側(cablesF 一條一件)
    tboxF(humChest, { w0: 0.55, d0: 0.28, w1: 0.5, d1: 0.24, h: 0.55, sz: -0.04 }, 0, 0.38, -0.38, PAL.mid, { metalness: 0.55 });
    tboxF(humChest, { w0: 0.4, d0: 0.24, w1: 0.34, d1: 0.2, h: 0.26 }, 0, 0.78, -0.36, PAL.deep, { metalness: 0.6 });
    bxF(humChest, 0.3, 0.05, 0.02, 0, 0.5, -0.51, RED, { emissive: RED, emissiveIntensity: 0.5 });
    for (const [ax, h0, az] of [[0.14, 0.6, -0.34], [0.24, 0.4, -0.42]]) {
      const an = cylF(humChest, 0.008, 0.008, h0, 5, ax, 0.9 + h0 / 2, az, IRON, { metalness: 0.8 });
      an.userData.noOutline = true;
    }
    cablesF(humChest, { p0: [0.2, 0.5, -0.3], p1: [0.16, 0.2, 0.4], k: 2, r: 0.018, sag: 0.12, spread: 0.02 }, GUNMETAL, { metalness: 0.5 });
    // ── 頸 + 頭(方稜盔;★ 紅色橫縫視窗)──
    const humNeck = new THREE.Group();
    humNeck.position.y = 0.72;
    humChest.add(humNeck);
    cylF(humNeck, 0.1, 0.12, 0.14, 8, 0, 0.03, 0, PAL.deep, { metalness: 0.7 });
    cablesF(humNeck, { p0: [0, 0.1, -0.06], p1: [0, -0.06, -0.12], k: 3, r: 0.012, sag: 0.01, spread: 0.04 }, GUNMETAL, { metalness: 0.6 });
    const head = new THREE.Group();
    head.position.y = 0.2;
    humNeck.add(head);
    tboxF(head, { w0: 0.3, d0: 0.3, w1: 0.36, d1: 0.32, h: 0.26, sz: 0.02 }, 0, 0.08, 0, PAL.main, { metalness: 0.5 });
    tboxF(head, { w0: 0.36, d0: 0.14, w1: 0.3, d1: 0.1, h: 0.07, sz: 0.03 }, 0, 0.225, 0.1, PAL.mid, { metalness: 0.55 });
    prismF(head, [[-0.13, -0.10], [0.13, -0.10], [0.15, 0.06], [-0.15, 0.06]], 0.05, 0, 0.05, 0.16, INK, { metalness: 0.4 });
    bxF(head, 0.22, 0.035, 0.02, 0, 0.09, 0.19, RED, { emissive: RED, emissiveIntensity: 1.6 });
    bxF(head, 0.18, 0.025, 0.02, 0, 0.035, 0.19, RED, { emissive: RED, emissiveIntensity: 1.1 });
    tboxF(head, { w0: 0.2, d0: 0.1, w1: 0.24, d1: 0.12, h: 0.1 }, 0, -0.07, 0.12, PAL.deep, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      bxF(head, 0.05, 0.12, 0.16, sx * 0.17, 0.02, 0.06, PAL.deep, { metalness: 0.6 });
      bxF(head, 0.04, 0.04, 0.02, sx * 0.16, 0.16, 0.14, RED, { emissive: RED, emissiveIntensity: 0.7 });
    }
    tboxF(head, { w0: 0.1, d0: 0.14, w1: 0.09, d1: 0.12, h: 0.05 }, 0, 0.245, -0.02, PAL.deep, { metalness: 0.6 });
    // ── 穩定射擊台(stabYoke):雙臂 + 槍的共同父節點,掛在**陀螺頭節點**之下 ──
    // 檔頭 ① 的落點。head 在 humChest 局部 (0, 0.72+0.20, 0) ⇒ 這裡回推 −0.92,
    // 靜姿框與 humChest 逐位元相同(肩/槍座標一格未改算),而世界朝向殘量由
    // 0.20·hp 掉到 0.0025·hp(實測槍口俯仰 p2p 10.51° → 0.3° 級)。
    const yoke = new THREE.Group();
    yoke.position.y = -0.92;
    head.add(yoke);
    // 台體:兩肩軸座 + 前胸橫樑(讓「雙臂與槍是同一副剛性台」看得出來)
    for (const sx of [-1, 1])
      tboxF(yoke, { w0: 0.2, d0: 0.24, w1: 0.16, d1: 0.2, h: 0.16 }, sx * 0.44, 0.6, 0, PAL.deep, { metalness: 0.7 });
    tboxF(yoke, { w0: 0.66, d0: 0.09, w1: 0.6, d1: 0.08, h: 0.08 }, 0, 0.3, 0.24, PAL.dark, { metalness: 0.65 });
    // 台↔軀幹的伸縮阻尼 ×2:外筒掛 humChest、內桿掛 yoke,重疊 0.10 ⇒ 兩者
    // 那 ~3cm 的相對行程有地方去(這是本輪唯一「看得見的緩衝機構」)
    for (const sx of [-1, 1]) {
      cylF(humChest, 0.055, 0.06, 0.22, 8, sx * 0.3, 0.12, 0.3, GUNMETAL, { metalness: 0.8 });
      cylF(yoke, 0.032, 0.032, 0.3, 6, sx * 0.3, 0.28, 0.3, IRON, { metalness: 0.9 });
    }
    // ── 雙臂(armSh/armEl;靜姿角一律由 armPair 反解,見其檔頭)──
    // 據槍姿目標點 = 槍身上的兩個握持點(stabYoke 框;槍原點 (0.10,0.46,0.25)):
    //   右 = 握把 pg 右側面(槍局部 0.10,−0.19,−0.09);左 = 護木底面托點(槍局部 −0.02,−0.15,0.58)。
    //   左手托點取「左肩構得到的最前端」—— 上臂+前臂 1.10,再往前就是硬拉直的假姿勢。
    // 放鬆姿目標點(2026-08-13 使用者「平時單手持槍放鬆」):
    //   右 = 右腰外側低位(槍跟著手下來,槍口朝下前方落在馬身右前方的空域);
    //   左 = **離開槍**,垂到左腰甲外上方(y 取在鞍掛彈袋頂面之上,否則手插進袋子裡)。
    const TGT = [[0.08, 0.31, 0.83], [0.20, 0.27, 0.16]];      // [sx −1 左(托護木), sx +1 右(扣握把)]
    const REL = [[-0.60, -0.30, 0.22], [0.70, -0.45, 0.56]];   // 同上兩側的放鬆姿腕點
    // 放鬆姿槍身朝向:俯 0.50 rad、微朝內。**內偏是被逼出來的不是選的** ——
    // 槍口往外偏(+x)會把托底往內帶進騎士胸腔(實測 lat +0.2 ⇒ 量體取樣 13~17 點穿模,
    // 而 lat −0.1 只有兩個托底角碰到墊肩)。右腕點因此改押到更外側 0.70,
    // 讓「內偏」之後的槍口仍落在馬身右半邊(muzzle x −0.24 → +0.13)。
    const CARRY = [-0.10, -Math.sin(0.50), Math.cos(0.50)];
    const armSh = [], armEl = [], armBase = [];
    let holdR = null;
    for (const sx of [-1, 1]) {
      const S = [sx * 0.46, 0.6, 0];
      const P = armPair(S, TGT[sx < 0 ? 0 : 1], REL[sx < 0 ? 0 : 1], 0.55, 0.55, sx, sx > 0 ? CARRY : null);
      const k = P.aim;
      // 墊肩仍掛 humChest(它是軀幹裝甲;肩軸座在 yoke 上,兩者的 ~3cm 相對位移被墊肩蓋住)
      const pd = tboxF(humChest, { w0: 0.32, d0: 0.36, w1: 0.24, d1: 0.3, h: 0.2, sx: sx * 0.04 }, sx * 0.54, 0.7, 0, PAL.main, { metalness: 0.5 });
      pd.rotation.z = -sx * 0.15;
      const sh = new THREE.Group();
      sh.position.set(S[0], S[1], S[2]);
      yoke.add(sh);
      const sb = latheF(sh, [[0.03, -0.13], [0.11, -0.09], [0.13, 0], [0.11, 0.09], [0.03, 0.13]], 10, 0, 0, 0, PAL.deep, { metalness: 0.8 });
      sb.rotation.z = Math.PI / 2;                              // 肩球節(軸沿 x)
      tboxF(sh, { w0: 0.15, d0: 0.17, w1: 0.2, d1: 0.22, h: 0.5 }, 0, -0.28, 0, PAL.mid, { metalness: 0.55 });
      const el = new THREE.Group();
      el.position.y = -0.55;
      sh.add(el);
      const ed = latheF(el, [[0.02, -0.03], [0.08, -0.024], [0.09, 0], [0.08, 0.024], [0.02, 0.03]], 10, sx * 0.09, 0, 0, PAL.deep, { metalness: 0.8 });
      ed.rotation.z = Math.PI / 2;
      tboxF(el, { w0: 0.11, d0: 0.13, w1: 0.15, d1: 0.17, h: 0.42 }, 0, -0.24, 0, PAL.mid, { metalness: 0.55 });
      cylF(el, 0.022, 0.022, 0.34, 6, -sx * 0.08, -0.24, 0.07, IRON, { metalness: 0.9 });   // 前臂阻尼桿
      const wb = latheF(el, [[0.02, -0.055], [0.06, -0.04], [0.07, 0], [0.06, 0.04], [0.02, 0.055]], 10, 0, -0.5, 0, PAL.deep, { metalness: 0.85 });
      wb.rotation.z = Math.PI / 2;                              // 腕球節
      // 腕框:反轉整條臂的**據槍姿**旋轉 ⇒ 它的軸與 yoke/槍身逐軸對齊,
      // 手部零件因此可以直接寫「槍身座標」而不必逐顆換框(開火時 rKick/rChg 讓它偏幾度 = 手腕給彈)
      const wr = new THREE.Group();
      wr.position.y = -0.55;
      wr.quaternion.copy(P.q).invert();
      el.add(wr);
      // 腕俯仰樞軸 hold:**手與槍一起**掛在它下面(手單獨掛腕、槍掛 hold 的話,ψ 一轉
      // 槍就在握緊的拳頭裡自己轉過去 = 手指穿過機匣)。它就是 rig.gunR.g,
      // 由 locomotion 的 gunPitch 每幀寫 rotation.x ⇒ 兩姿的腕俯仰 + 後座上跳都走這一顆。
      const hold = new THREE.Group();
      wr.add(hold);
      if (sx > 0) { holdR = hold; hold.rotation.x = P.psi; handGrip(hold, PAL); } else handCradle(wr, PAL);
      sh.rotation.set(k.shX, k.shY, k.shZ);
      el.rotation.x = k.elX;
      armSh.push(sh); armEl.push(el);
      // ⚠ armBase 從此是**計算屬性不是常數**:locomotion 的 rider 分支每幀重讀
      // b.shX/b.shZ/b.elX(:833-837)⇒ 這三個 getter 就是「放鬆 ↔ 據槍」的資料通道,
      // 一行 locomotion 都不必改。MUST NOT 把它整份 clone/展開成純值(那會讓兩態靜默失效)。
      armBase.push({
        get shX() { return lerpA(P.aim.shX, P.rel.shX, relaxF()); },
        get shZ() { return lerpA(P.aim.shZ, P.rel.shZ, relaxF()); },
        get elX() { return lerpA(P.aim.elX, P.rel.elX, relaxF()); },
      });
      if (sx > 0) c._psi = P.psi;
    }
    // ── 據槍(反器材軌道狙擊槍;槍身沿 +z)──
    // 2026-08-13:槍**改掛在右腕的 hold 樞軸之下**(檔頭 ⑤)。位置 = 握點的反向量:
    // 據槍姿的腕落在 TGT[1] = (0.20,0.27,0.16),而槍局部握點是 (0.10,−0.19,−0.09)
    // ⇒ 槍原點 = 腕 − 握點 = (−0.10, 0.19, 0.09),世界擺位與掛在 yoke (0.10,0.46,0.25)
    // 那一版**逐位元相同**(腕框朝向 = 據槍姿鏈旋轉的反轉 ⇒ 據槍姿下與 yoke 逐軸對齊)。
    const gun = new THREE.Group();
    gun.position.set(-0.10, 0.19, 0.09);
    holdR.add(gun);
    // 機匣 + 頂軌
    tboxF(gun, { w0: 0.16, d0: 1.1, w1: 0.14, d1: 1.05, h: 0.22 }, 0, 0, -0.05, GUNMETAL, { metalness: 0.8 });
    bxF(gun, 0.1, 0.05, 0.9, 0, 0.135, -0.1, INK, { metalness: 0.7 });
    // 槍托(托身 + 貼腮墊 + 抵肩板)—— 由 −1.10 收到 −0.76:舊制托底板伸到 yoke z −0.85,
    // 比騎士的背還後面 0.55m(整支穿過軀幹);收短後抵在胸前,「抵著肩」才讀得出來
    tboxF(gun, { w0: 0.12, d0: 0.4, w1: 0.1, d1: 0.34, h: 0.18 }, 0, -0.02, -0.56, PAL.deep, { metalness: 0.6 });
    bxF(gun, 0.09, 0.07, 0.26, 0, 0.12, -0.5, PAL.dark, { metalness: 0.5 });
    const bpl = tboxF(gun, { w0: 0.14, d0: 0.09, w1: 0.12, d1: 0.09, h: 0.3 }, 0.02, 0.0, -0.76, INK, { metalness: 0.6 });
    bpl.rotation.z = 0.16;                     // 抵肩板朝右肩窩微傾
    // 握把 + 護圈(薄件 noOutline)+ 下插彈匣
    // 握把加粗到 0.11×0.17×0.20:舊尺寸比騎士的手還小,四指一環就整隻穿過去
    const pg = tboxF(gun, { w0: 0.11, d0: 0.17, w1: 0.10, d1: 0.15, h: 0.20 }, 0, -0.19, -0.07, INK, { metalness: 0.5 });
    pg.rotation.x = 0.35;
    const tg = torusF(gun, 0.075, 0.014, 0, -0.13, 0.05, INK, { metalness: 0.5 });
    tg.rotation.y = Math.PI / 2;
    tg.userData.noOutline = true;
    const mg = tboxF(gun, { w0: 0.09, d0: 0.24, w1: 0.08, d1: 0.2, h: 0.24, sz: 0.05 }, 0, -0.2, 0.22, INK, { metalness: 0.6 });
    mg.rotation.x = 0.15;
    // 瞄準鏡(latheF 目鏡/鏡身/物鏡鐘;★ 圖鏡體粗大醒目)+ 環座 ×2 + 物鏡發光(= 蓄力發光)
    const sc = latheF(gun, [[0.068, 0], [0.068, 0.14], [0.052, 0.2], [0.052, 0.44], [0.082, 0.56], [0.082, 0.72]], 10, 0, 0.27, -0.15, INK, { metalness: 0.8 });
    sc.rotation.x = Math.PI / 2;
    for (const zz of [0.0, 0.28]) {
      const rg = torusF(gun, 0.06, 0.014, 0, 0.27, zz, GUNMETAL, { metalness: 0.8 });
      rg.userData.noOutline = true;
      bxF(gun, 0.045, 0.1, 0.06, 0, 0.2, zz, GUNMETAL, { metalness: 0.8 });
    }
    const sLens = cylF(gun, 0.072, 0.072, 0.02, 10, 0, 0.27, 0.58, accent, { emissive: accent, emissiveIntensity: 0.8 });
    sLens.rotation.x = Math.PI / 2;
    // 雷射測距儀(鏡右側小盒)
    bxF(gun, 0.06, 0.06, 0.14, 0.1, 0.2, 0.3, PAL.deep, { metalness: 0.7 });
    // 開槽護木(★ 長條散熱槽 = INK 嵌條 ×3/側)+ 摺疊腳架(收攏沿管前指)
    // 護木整段後移到 z 0.29…1.27:左臂(上臂+前臂 1.10)構得到的最前端只到槍局部 z≈0.6,
    // 舊制護木自 0.55 才開始 ⇒ 左手只能勾在它的最後緣;後移之後托點落在護木中段
    tboxF(gun, { w0: 0.13, d0: 0.98, w1: 0.11, d1: 0.92, h: 0.16 }, 0, 0.0, 0.78, GUNMETAL, { metalness: 0.75 });
    for (const sx of [-1, 1]) for (const zz of [0.45, 0.78, 1.11])
      bxF(gun, 0.015, 0.06, 0.17, sx * 0.062, 0.0, zz, INK, { metalness: 0.4 });
    // 托槍點的止滑鞍(左掌正下方;讓「手托在這裡」有個著力面)
    tboxF(gun, { w0: 0.15, d0: 0.16, w1: 0.14, d1: 0.15, h: 0.04 }, 0, -0.09, 0.58, INK, { metalness: 0.5 });
    for (const sx of [-1, 1]) {
      const bl = tboxF(gun, { w0: 0.035, d0: 0.035, w1: 0.03, d1: 0.03, h: 0.5 }, sx * 0.07, -0.09, 1.28, IRON, { metalness: 0.8 });
      bl.rotation.x = -1.35;
    }
    // 長管(latheF 兩階)→ 輕模式管口環 → 箱型制退器(側翼板 ×2)→ 重模式膛口環
    const br = latheF(gun, [[0.045, 0], [0.045, 0.55], [0.038, 0.6], [0.038, 1.15]], 10, 0, 0.02, 1.37, GUNMETAL, { metalness: 0.85 });
    br.rotation.x = Math.PI / 2;
    const lMuz = latheF(gun, [[0.036, -0.02], [0.05, -0.008], [0.05, 0.008], [0.036, 0.02]], 10, 0, 0.02, 2.54, accent, { emissive: accent, emissiveIntensity: 0.9 });
    lMuz.rotation.x = Math.PI / 2;
    tboxF(gun, { w0: 0.13, d0: 0.34, w1: 0.12, d1: 0.32, h: 0.16 }, 0, 0.02, 2.74, INK, { metalness: 0.8 });
    // 制退器葉片 ×2(真樞軸:後緣鉸鏈)—— 後座力的第二個出口。
    // stepCombatFx 每幀驅動 rig.heavy.pivot:蓄力朝 deploy 張開、擊發以 −0.85 反向甩回過衝;
    // 它動的是**葉片自己**的節點,與 gunPitch 唯一寫入 gun.rotation.x 不衝突(兩顆不同的物件)。
    const vanes = [];
    for (const s of [1, -1]) {
      const v = new THREE.Group();
      v.position.set(0, 0.02 + s * 0.075, 2.62);
      gun.add(v);
      bxF(v, 0.21, 0.045, 0.17, 0, 0, 0.085, COAL, { metalness: 0.8 });
      vanes.push({ obj: v, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -s * 0.6, y: 0, z: 0 } });
    }
    const hMuz = latheF(gun, [[0.034, -0.018], [0.054, -0.006], [0.054, 0.006], [0.034, 0.018]], 10, 0, 0.02, 2.93, accent, { emissive: accent, emissiveIntensity: 1.4 });
    hMuz.rotation.x = Math.PI / 2;
    c._gun = gun; c._lMuz = lMuz; c._hMuz = hMuz; c._sLens = sLens; c._vanes = vanes;
    // gunR.g = 腕俯仰樞軸 hold(不是槍本身):gunPitch 寫的 rotation.x 因此同時帶動手與槍。
    // rest ≡ aim ⇒ 那條 aimF 混成項恆為 0(aimF = min(1, idle + _aim) 站著不動時本來就是 1,
    // 拿它當「有沒有在射擊」正是這一輪要修掉的那個誤判)。兩姿的腕俯仰改由 _aim 內插,
    // **後座(−kick×0.14)與蓄力(+chg×hv.gun)一格未動**。
    const holdPitch = () => c._psi * relaxF();
    return { humChest, humNeck, head, armSh, armEl, armBase,
      gunR: { g: holdR, get rest() { return holdPitch(); }, get aim() { return holdPitch(); } } };
  },
  legF(c) { return this._leg(c, 1); },
  legH(c) { return this._leg(c, -1); },
  // 馬腿:股 → 管骨 → 球節 → 蹄(base/k/d 同 models.js centaur 分支;幾何照 ★ 圖:
  // 大六角股甲板 + 圓盤徽、細瘦深色管骨、圓盤球節、深色楔台蹄)
  _leg(c, S) {
    const { PAL, sx, front } = c;
    const ps = front ? 0.95 : 1.12;                                 // 後腿股甲更大(★ 臀甲)
    return [
      { len: 1.0, draw: (l) => {
        tboxF(l, { w0: 0.24, d0: 0.3, w1: 0.34, d1: 0.42, h: 0.95 }, 0, -0.48, front ? 0.02 : -0.04, PAL.mid, { metalness: 0.55 });
        const pl = prismF(l, [[-0.2, -0.36], [0.14, -0.4], [0.3, -0.1], [0.26, 0.24], [-0.06, 0.34], [-0.3, 0.14]].map(([x, y]) => [x * ps, y * ps]),
          0.07, sx * 0.26, -0.3, 0, PAL.main, { metalness: 0.5 });
        pl.rotation.y = sx * Math.PI / 2;
        const dk = latheF(l, [[0.02, -0.035], [0.11, -0.028], [0.125, 0], [0.11, 0.028], [0.02, 0.035]], 10, sx * 0.31, -0.28, 0.02, PAL.deep, { metalness: 0.8 });
        dk.rotation.z = Math.PI / 2;
        bxF(l, 0.012, 0.05, 0.16, sx * 0.345, -0.28, 0.02, INK, { metalness: 0.4 });
        hydCyl(l, 0.035, 0.5, -sx * 0.06, -0.62, front ? -0.17 : 0.17, front ? 0.3 : -0.3, BONE);
      } },
      { len: 0.66, base: S * 0.34, k: S * 0.5, d: 0.15, draw: (l) => {
        tboxF(l, { w0: 0.12, d0: 0.15, w1: 0.17, d1: 0.2, h: 0.62 }, 0, -0.33, front ? -0.02 : 0.03, GUNMETAL, { metalness: 0.7 });
        const kd = latheF(l, [[0.02, -0.03], [0.085, -0.024], [0.095, 0], [0.085, 0.024], [0.02, 0.03]], 10, sx * 0.1, -0.02, 0, PAL.deep, { metalness: 0.8 });
        kd.rotation.z = Math.PI / 2;
        const hy = cylF(l, 0.02, 0.02, 0.4, 6, -sx * 0.02, -0.3, front ? -0.1 : 0.1, IRON, { metalness: 0.85 });
        hy.rotation.x = front ? 0.25 : -0.25;
      } },
      { len: 0.2, base: -S * 0.22, k: -S * 0.34, d: 0.45, draw: (l) => {
        const fd = latheF(l, [[0.02, -0.03], [0.09, -0.025], [0.1, 0], [0.09, 0.025], [0.02, 0.03]], 10, sx * 0.02, -0.06, 0.01, PAL.mid, { metalness: 0.75 });
        fd.rotation.z = Math.PI / 2;
        cylF(l, 0.07, 0.085, 0.2, 8, 0, -0.1, 0.01, PAL.deep, { metalness: 0.6 });
      } },
      { len: 0, base: 0, k: S * 0.18, d: 0.66, draw: (l) => {
        const ar = latheF(l, [[0.085, -0.03], [0.1, -0.01], [0.1, 0.01], [0.085, 0.03]], 10, 0, -0.02, 0.02, IRON, { metalness: 0.8 });
        ar.rotation.x = 0;
        tboxF(l, { w0: 0.3, d0: 0.34, w1: 0.2, d1: 0.24, h: 0.3, sz: -0.05 }, 0, -0.18, 0.02, COAL, { metalness: 0.6 });
      } },
    ];
  },
  tail(c, tail) {
    const { PAL } = c;
    // 尾根環 + chainF 六節收分短尾。垂掛角住**靜態中介 Group**(root)——
    // whipTail 每幀覆寫 segs 的 rotation.x(rot0/rotD 會被吃掉),root 不在 segs 裡才留得住。
    const tc = latheF(tail, [[0.06, -0.04], [0.1, -0.015], [0.1, 0.015], [0.06, 0.04]], 10, 0, 0, 0.02, PAL.deep, { metalness: 0.8 });
    tc.rotation.x = Math.PI / 2;
    const root = new THREE.Group();
    root.rotation.x = -0.95;                                       // 垂掛:節鏈 −z 轉成下後方
    tail.add(root);
    const { segs } = chainF(root, {
      n: 6, len0: 0.24, len1: 0.14, r0: 0.06, r1: 0.028,
      rot0: 0, rotD: 0, ring: true, ringColor: IRON, seg: 8,
    }, PAL.deep, { metalness: 0.55 });
    return segs;
  },
  mount(c, F) {
    // 步槍(輕 = 管口環、重 = 制退器膛口)已在 rider() 隨雙臂建好 —— 一把雙模。
    // **槍身**俯仰唯一寫入者仍是 gunPitch(rig.gunR)⇒ heavyPivot MUST NOT 收 gun 本身;
    // 收的是制退器葉片那兩顆子節點(蓄力張開 / 擊發反向甩回),兩條通道各動各的物件。
    return {
      gunR: null, gunL: null,                                        // rig.gunR 由 rider 的回傳接手
      muzzles: { light: { n: c._lMuz, r: 0.08 }, heavy: { n: c._hMuz, r: 0.1 } },
      lightGlowM: [c._lMuz],
      heavyGlowM: [c._sLens, c._hMuz],                               // 蓄力:物鏡 + 膛口
      heavyPivot: c._vanes,
      weap: { light: 'B', heavy: 'B' },                              // 雙手持同一把(models.js centaur 同款)
      hvy: { armR: 0.06, armL: 0.06, chest: 0.05, gun: 0.07 },
      aimPose: null,
      wpn: {
        light: { nodes: [c._gun], ref: c._gun, muz: c._lMuz, fwd: 'z' },
        heavy: { nodes: [c._gun], ref: c._gun, muz: c._hMuz, fwd: 'z' },
      },
    };
  },
  // rider() 的三個 getter 要每幀讀 `rig._aim`,而 rig 是 rider 回傳之後才組出來的
  // ⇒ 由 extra(唯一拿得到 rig 的鉤子)把它交回 ctx。這裡**只存參照,不改 rig**。
  extra(c, F, rig) { c._rig = rig; },
};
