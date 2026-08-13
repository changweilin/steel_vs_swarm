// ============ m02 逐機零件檔(dev-only;獸型雙足 biped + tinyArms + 重尾)============
// ── m02「壓艙石」重型突擊機甲(trex 暴龍):水平體軸、巨顎藏無後座砲、重尾配重、退化短前臂 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m02_static.jpg(★ = m02_static)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 照 ★ 定案圖逐部位重建:
//   頭 = prismF 側剖顱殼(稜面楔形)+ 逐顆齒列 + 鉤形前獠牙;顎鉸是真樞軸(mount 的
//   heavyPivot 驅動「張口 = 射擊姿勢」);口腔藏四管旋管砲束(輕/重同膛:lMuz 管束小環、
//   hMuz 充能大環)。頸 = 芯柱 + latheF 收分環 + 喉管纜束。
//   軀幹 = 斜置深胸艙 + 外凸肋甲環;背甲大蓋板覆在骨盆與尾根之上(★ 圖語彙)。
//   尾 = chainF 收分節鏈 + 背脊板。圖騰紅黃帶紋 / 鏽蝕補丁 = paint 層。
// 2026-08-12 v3 依暴龍正模骨架照調姿(★ 仍管機械外觀,骨架照管姿態比例):脊線壓平、頭前伸、
//   尾加長加粗、腿改趾行深屈(legBase −0.28 股前傾 + 膝 0.62 深屈 + 踝 −0.32 補償)。
// 2026-08-13 v4 使用者:「暴龍:身體再向前延伸長一點,補上兩隻前爪」——
//   軀幹沿體軸串成兩段(前端 z 1.15 → 1.75)、頭只前移 +0.15、補兩指前爪。
//
// ── 2026-08-13 v5 使用者手繪稿(側視):「暴龍頭應該要從身體前方延伸,脊椎是橫向的,
//    前爪在更前面的位置,脖子和尾巴都加長一點」──
// 手繪稿讀數:頭 → 頸 → 軀幹 → 尾 幾乎連成一條水平線,頭與尾尖落在同一個高度帶,骨盆是支點。
// 本輪的四條改動與**它們各自的自由度在哪裡**(這一段是本檔最容易被日後改壞的地方):
//
//  ⓪ **rig 的兩條硬約束**(逐項在 forge.js / locomotion.js 原文核對過,MUST NOT 憑記憶重建):
//    ㋐ `locomotion.js:482` 每幀寫 `rig.head.position.y = rig.headY0 + …` ——
//       **只寫 y**。⇒ 頭**節點**的執行期胸腔高度恆 = `neckAt[1] + headYl` = `neckAt[1] + 0.90`,
//       forge 為 neckAt 做的 −neckAt[1] 補償整個被蓋掉。反過來說 **`neckAt[1]` 就是頭高的旋鈕**
//       (降 0.48 → 頭節點降 0.48),而它**不動 z**:forge 給的 `head.position.z = 0.04 − neckAt[2]`
//       加上頸樞軸自己的 neckAt[2] ⇒ 頭節點胸腔 z **恆為 0.04**,與 neckAt 無關。
//    ㋑ 頭幾何因此只能靠靜態中介 Group `hh` 往前送,而 `hh.z` **就是凝視/roar 的槓桿臂**
//       (頭節點在 z 0.04)。v4 檔頭那條「槓桿臂 MUST NOT 等量長大」仍然成立:本輪 hh.z
//       1.50 → 2.20(+47%),而 roar 的 −0.90 rad(head −0.55 + neck −0.35)會把顱殼抬起
//       ≈1.5(v4 是 ≈1.00)⇒ **上頸套筒改掛在 hh 上**(隨頭走,不隨頸走),張口仰頭時
//       頸柱與顱殼之間不再整段裂開。再往前送 MUST 先看 cast 那一張。
//
//  ① **脊椎橫向化 = 把「頸根 → 骨盆」這條線壓平**,而它 MUST 靠幾何做(prop/pose/gait 是
//     對 locomotion 校準的,一格不准動)。舊制 collar(頸根)在胸腔 (0, 0.95, 0.95)、尾根在
//     (0, 0.42, −1.00) ⇒ 這條線 **−15°**;新制頸根 (0, 0.60, 1.02)、尾根 (0, 0.55, −1.00)
//     ⇒ **−1.4°**,近水平。做法是三件事一起:㋐頭下修 0.60(neckAt[1] 0.86 → 0.38 給 0.48、
//     hh.y −0.30 → −0.52 給 0.22)㋑尾根抬 0.42 → 0.55 且尾幾乎不再下垂 ㋒喉艙前端面下修
//     (h 0.95 → 0.70)讓頸自**軀幹前緣**長出來而不是自頂面直上(手繪稿 ㋑)。
//  ② **頸加長**:可用的自由度只有「軀幹前緣往回收」+「頭往前送」兩邊夾出來的那一段 ——
//     軀幹前端 z 1.75 → 1.49(前端面上緣 1.44)、顱殼後緣 z 1.28 → 1.98 ⇒ 露出來的頸
//     0(貼著)→ **0.54 淨空 + 0.98 長的芯柱四環**,側視讀得出是一段有長度的頸。
//     軀幹全長只從 2.13 收到 1.88(−12%):v4 的「身體向前延伸」用**整體剪影**保住
//     (吻端 z 3.04 → 3.74),而不是靠喉艙那一截。
//  ③ **前爪再往前**:肩/肘/腕三個樞軸仍是 forge 凍結的 (±0.6, 0.42, 0) / (±0.6, −0.18, 0) /
//     (±0.6, −0.64, 0.282),前置**一律逐點反算**(v4 就是拿錯樞軸讓爪縮回前臂裡):
//     視覺肘 z 0.62 → 0.76(上臂 sz −0.38 → −0.48)、視覺腕 (0,−0.55,1.00) → (0,−0.58,1.15)
//     (前臂在肘局部框重解 h 0.545 / sz −0.123)、手掌基準 B = R(+0.70)(視覺腕 − 腕樞軸)
//     = (0, −0.513, 0.703)(v4 是 (0,−0.394,0.607))⇒ **爪尖胸腔 z 1.42 → 1.57**,
//     落到軀幹前端面(z 1.44~1.54)**之下**,與新頸根同一個 z 帶(手繪稿 ㋓)。
//  ④ **尾加長**:節數契約 `n = 11`(`rig.tailSegs` 的長度)一格不准動 ⇒ 只加節長帶
//     (len0 0.66 → 0.70、len1 0.26 → 0.30 ⇒ 全長 5.06 → 5.50 ≈ 軀幹+頸+頭 4.74)。
//     **下垂整組壓平**:tailRoot.rotation.x −0.12 → −0.02、rot0 −0.03 → −0.012、
//     rotD 0.006 → 0.0024(累積角 Σ 仍收斂回 0)⇒ 尾尖胸腔 y −0.51 → **+0.29**,
//     與顱殼(y 0.58~1.15)落在同一個高度帶。**MUST 記得 whipTail 逐幀覆寫節樞軸**,
//     基礎姿勢只能住 tailRoot 這個中介 Group 與 chainF 的 rot0/rotD。
//  ⑤ 側視實測跨距(Box3 於執行期量,見回傳):吻端 z 3.77 → 尾錐 z −6.86 = **水平 10.63**;
//     最高點(背甲頂蓋 world 4.50)→ 最低點(足爪 world −0.21)= **垂直 4.71**
//     ⇒ 橫向 : 縱向 = **2.26**(手繪稿要的「橫向遠大於縱向」;v4 是 9.4 : 4.7 = 2.0,
//     而那 9.4 有一大截是「頭高高在上」撐出來的**垂直**距離,不是橫向)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:齒列亮灰 / 口腔暗紅 / 爪鋼 / 活塞亮桿
const TEETH = 0xcfd4d9, MAWRED = 0x6e1a1a, CLAWSTEEL = 0xb9c0c8, PISTON = 0xd8dde2;

// 頸軸(胸腔框):自 (0, 0.60, 1.02) 至 (0, 0.80, 1.98);長 0.98、傾角 1.3654 rad。
// 頸樞軸 neckAt = (0, 0.38, 0.90) ⇒ 頸幾何(neckG)與上頸套筒(掛 hh)共用這一個角度,
// 少了共用就是「頸柱與套筒各指一個方向」,而靜態三視圖看起來只是「接縫怪怪的」。
const NECK_ROT = 1.3654;

export default {
  label: '壓艙石(m02 機甲・暴龍)', hue: 0x9aa3ad, height: 6.0,
  prop: { hips: 0.5, legSplay: 0.1, thigh: 0.52, shin: 0.5, shoulderY: 0.57, shoulderX: 0.1, upperArm: 0.1, foreArm: 0.09, head: 0.65, girth: 1.1 },
  gait: { strideF: 1.25, bob: 0.12, sway: 0.08, top: 7, legBase: -0.34, armBase: 0 },   // legBase 股前傾(趾行)
  pose: {
    knee: { base: 0.72, k: 0.62, d: 0.15 }, ankle: { base: -0.36, k: -0.34, d: 0.55 },  // 膝深屈+踝補償(足底放平)
    elbow: { base: -0.55, k: -0.3, d: 0.3 }, wrist: { base: -0.15, k: 0.12, d: 0.5 },   // 短前臂深屈在胸前(暴龍招牌)
  },
  neckAt: [0, 0.38, 0.90],                                      // 頸樞軸;[1] = 頭高旋鈕(檔頭 ⓪㋐),[2] 不影響頭節點 z
  moveSig: { poise: 0.70, idleF: 0.48, idleA: 1.62, launch: 0.14, spool: 0.85, brake: 0.20, settle: 1.90 },
  castSig: { omni: 'roar', dir: 'jab' },
  doc: [
    ['頭(巨顎藏無後座砲)', 'prismF 側剖稜面顱殼+頰甲 ×2+怒眉稜+逐顆齒列(上 10 下 8)+鉤形前獠牙 ×2+latheF 文氏尾噴(壓在顱頂後段的頂邊上)'],
    ['顎鉸+口腔砲', '下顎 prismF 側剖+軸桿+鉸盤 ×2;四管旋管砲束(cylF ×4+芯)+lMuz 管束環+hMuz 充能環;heavyPivot 充能張顎 = 射擊姿勢'],
    ['頸(水平長頸・兩段)', 'cylF 芯柱 0.98(自軀幹前緣 z 1.02 前伸到顱後 z 1.98,近水平)+latheF 收分環 ×4 沿頸軸(半徑吃芯柱在該處的收分值)+cablesF 喉管 ×3+頸背鱗板 ×2(貼芯柱表面);**上頸套筒掛在頭的靜態 Group** ⇒ 張口仰頭時頸不斷開'],
    ['軀幹(橫向脊線)', 'tboxF 肋腔桶(h 1.18)+tboxF 收分喉艙(h 0.70,sz 0.24 前端面下推 ⇒ 頸自前緣長出)沿同一體軸串成 1.88 長的水平艙體+latheF 外凸肋甲環 ×4(逐段中心線)+prismF 胸甲 ×2+頸根領環+腹龍骨+cablesF 腹管+側百葉'],
    ['背甲(水平脊背蓋板)', 'prismF 側剖蓋板放平(肩後覆至尾根 = 脊背線,髖最高向肩微下斜)+頂板+INK 百葉 ×4+側鉸座 ×2+後支柱+後排氣 ×2'],
    ['退化短前臂 ×2(tinyArms)', '球肩+肩甲+剪切前傾上臂殼(視覺肘推到 z 0.76)+hydCyl 活塞 ×2+latheF 肘盤/腕帽+**兩指**鉤爪(每指 tboxF 指節 ×2+finF 弧爪;爪尖 z 1.57 落在軀幹前端面 1.44~1.54 之下)'],
    ['強健後腿 ×2(趾行深屈)', '巨股楔殼(legBase 前傾+膝深屈,踝落髖正下)+prismF 前甲板+latheF 髖盤/膝盤+hydCyl 腱活塞 ×2+脛前甲+踝環'],
    ['足 ×2', '楔台足身+踝前斜甲+三趾(tboxF 指節+finF 弧爪)+後距爪 —— 爪一趾一件'],
    ['重尾(chainF 十一節配重)', '十一節收分節鏈(全長 5.50 ≈ 頭頸軀幹合計;尾根抬到脊線高 y 0.55、下垂壓到 −1.1° ⇒ 尾尖與顱殼同高度帶)+節環+背脊板 ×7(索引遞減)+coneF 尾梢錐'],
  ],
  head(c, h) {
    const { PAL, accent } = c;
    // 靜態中介 Group:頭幾何整組前移下修(檔頭 ⓪㋑ —— 頭**節點**的執行期胸腔位置恆為
    // (0, neckAt[1] + 0.90, 0.04) = (0, 1.28, 0.04),樞軸不動,只推幾何)。
    // v5:z 1.50 → 2.20(顱殼 z 1.98~3.74,自軀幹前緣 1.44 前伸出 0.54 的淨空 = 頸的位置;
    //     d1 那一輪只推到 2.05 ⇒ 淨空 0.29,側視特寫實測「顱殼後緣直接壓在肋環上」)、
    //     y −0.30 → −0.52(顱殼 y 0.58~1.15,落在尾尖 0.29 與背甲線 1.38 之間 = 手繪稿的水平線)。
    // jawG / tg 吃同一組偏移(−0.70 / −0.86 系,見 mount)。
    const hh = new THREE.Group();
    hh.position.set(0, -0.52, 2.20);
    h.add(hh);
    // 上頸套筒(**掛 hh = 隨頭走**):自顱殼後緣(z 1.98)往回蓋到 1.68,與 neckG 芯柱前端
    // (z 1.98)重疊 0.30。roar 把顱殼抬 ≈1.5 時套筒跟著走 ⇒ 顱殼底下不會空出一截。
    const sleeve = cylF(hh, 0.27, 0.31, 0.32, 10, 0, 0.03, -0.40, PAL.dark, { metalness: 0.65 });
    sleeve.rotation.x = NECK_ROT;
    // 側剖稜面顱殼(prismF 剖面 = (前,上) 平面,rotation.y = −π/2 讓剖面 x → +z 前伸)——
    // 水平體軸機種:頭幾何自樞軸往前懸伸(★ 圖:楔形吻部、眉峰隆起、後顱收圓)
    const skull = prismF(hh, [
      [-0.22, -0.02], [0.33, -0.15], [1.19, -0.18], [1.47, -0.11], [1.50, 0.04],
      [1.21, 0.18], [0.57, 0.33], [0.26, 0.39], [-0.11, 0.33], [-0.26, 0.13],
    ], 0.76, 0, 0, 0, PAL.main, { metalness: 0.55 });
    skull.rotation.y = -Math.PI / 2;
    // 頰甲板 ×2(prismF 六角側貼;★ 圖眼下層疊頰甲)
    for (const sx of [-1, 1]) {
      const cheek = prismF(hh, [
        [0.06, -0.13], [0.44, -0.18], [0.68, -0.02], [0.61, 0.15], [0.22, 0.22], [0.00, 0.09],
      ], 0.10, sx * 0.435, 0, 0, PAL.mid, { metalness: 0.6 });
      cheek.rotation.y = -Math.PI / 2;
      // 怒眉稜(內端下壓的斜楔 = ★ 圖的兇相)+ 眼(眉下暗窩發光)
      const brow = tboxF(hh, { w0: 0.22, d0: 0.22, w1: 0.16, d1: 0.14, h: 0.10, sz: 0.02 }, sx * 0.28, 0.35, 0.46, PAL.deep, { metalness: 0.6 });
      brow.rotation.z = -sx * 0.28;
      brow.rotation.x = -0.08;
      bxF(hh, 0.055, 0.08, 0.13, sx * 0.385, 0.15, 0.42, accent, { emissive: accent, emissiveIntensity: 1.5 });
      // 鼻孔排氣(吻頂小孔 = 引擎排氣的生物機械雙關)
      cylF(hh, 0.03, 0.03, 0.05, 6, sx * 0.12, 0.24, 1.34, INK, { metalness: 0.7 }).rotation.x = 0.4;
      // 鉤形前獠牙(sz 剪切:根前傾、尖端下勾 —— ★ 圖吻端鉤喙)
      tboxF(hh, { w0: 0.035, d0: 0.042, w1: 0.10, d1: 0.11, h: 0.29, sz: 0.065 }, sx * 0.175, -0.29, 1.36, TEETH, { metalness: 0.35 });
    }
    // 上齒列(一齒一件:根寬在上、尖端在下,前大後小索引遞變)
    for (let i = 0; i < 5; i++) {
      const th = 0.22 - i * 0.022;
      for (const sx of [-1, 1])
        tboxF(hh, { w0: 0.028, d0: 0.033, w1: 0.095, d1: 0.11, h: th }, sx * 0.315, -0.165 - th / 2, 1.15 - i * 0.165, TEETH, { metalness: 0.35 });
    }
    // 口腔頂板(暗紅;張口時從顎縫看得到)
    bxF(hh, 0.50, 0.05, 0.80, 0, -0.19, 0.80, MAWRED, { metalness: 0.2 });
    // 文氏尾噴(無後座砲識別:後噴抵銷後座)—— 落點 MUST 貼**顱殼那一段的頂邊**:
    // 上頸套筒佔住了顱後下角,尾噴不能留在原位(會整顆埋進套筒);但推到顱後上緣 (0.36, −0.24)
    // 又太後面 —— 顱殼頂邊在 x −0.24 只有 y 0.157,尾噴整顆浮在殼外 0.20,45° 特寫讀成
    // 一塊獨立的深色方塊(d1b 實測)。改落在 x 0.02(頂邊 y 0.351)、基部壓進去 0.07。
    const vent = latheF(hh, [[0.06, 0], [0.09, 0.10], [0.125, 0.21]], 10, 0, 0.28, 0.02, GUNMETAL, { metalness: 0.8 });
    vent.rotation.x = -Math.PI / 2;
  },
  neck(c, nk) {
    const { PAL } = c;
    // ── 水平長頸(v5)。樞軸 neckAt = 胸腔 (0, 0.38, 0.90);頭節點恆在胸腔 (0, 1.28, 0.04)。
    // 芯柱兩端(胸腔框)= (0, 0.60, 1.02) → (0, 0.80, 1.98):長 0.98、rot.x = 1.3654(近水平前伸)。
    //   起點壓在軀幹前端面(上緣 z 1.44)**之內** ⇒ 頸是自軀幹前緣長出來的(手繪稿 ㋑),
    //   終點插進顱殼後緣(z 1.98)⇒ 與掛在 hh 的上頸套筒重疊 0.30,兩截各自黏在自己那一端。
    // 頸局部 = 胸腔 − (0, 0.38, 0.90) ⇒ 芯中心 (0, 0.32, 0.60)。
    const core = cylF(nk, 0.30, 0.42, 0.98, 10, 0, 0.32, 0.60, PAL.dark, { metalness: 0.65 });
    core.rotation.x = NECK_ROT;                                  // rt(前/頭端)0.30 < rb(後/體端)0.42:往頭收分
    // 分節頸甲環 ×4(latheF 沿頸軸 t = 0.16/0.38/0.60/0.82 收分;半徑吃芯柱在該處的收分值
    // (0.42 → 0.30 線性)—— 手寫一組固定半徑就會在頭端整圈飄在芯柱外)
    const rings = [[0.252, 0.274, 0.404, PAL.main], [0.296, 0.485, 0.377, PAL.mid],
      [0.340, 0.696, 0.351, PAL.main], [0.384, 0.907, 0.325, PAL.mid]];
    for (const [ry, rz, rr, col] of rings) {
      const ring = latheF(nk, [[rr * 0.86, -0.075], [rr, -0.035], [rr, 0.035], [rr * 0.86, 0.075]], 10, 0, ry, rz, col, { metalness: 0.55 });
      ring.rotation.x = NECK_ROT;
      ring.scale.z = 1.05;
    }
    // 喉側管束(cablesF 一條一件,沿頸腹面伸向顎根)+ 頸背鱗板 ×2
    // 鱗板落點 MUST 貼**芯柱在該處的表面**(t 0.35 / 0.65 各解一次),而且要壓進去一點:
    // d1 那一輪拿中心線 + 固定高度擺,兩片整個飄在頸背上方 = 側視特寫讀成兩塊碎片。
    cablesF(nk, { p0: [0, 0.02, 0.10], p1: [0, 0.17, 1.00], k: 3, r: 0.035, sag: 0.035, spread: 0.075 }, GUNMETAL, { metalness: 0.75 });
    for (const [py, pz] of [[0.620, 0.390], [0.645, 0.685]]) {
      const sc = tboxF(nk, { w0: 0.26, d0: 0.22, w1: 0.16, d1: 0.12, h: 0.14, sz: -0.03 }, 0, py, pz, PAL.deep, { metalness: 0.6 });
      sc.rotation.x = 0.90;
    }
  },
  chest(c, ch, d) {
    const { PAL, accent } = c;
    // ── 橫向長軀幹(v5:手繪稿「脊椎是橫向的」)──
    // 體軸 u = rot.x 1.42 的 +y 像 = (0, 0.1502, 0.9887),自骨盆前緣往前伸;兩段串接:
    //   ①肋腔桶 h 1.18(不動;sz 0.10 ⇒ 深胸落肩後)前端面中心 = (0, 0.528, 0.761)
    //   ②收分喉艙 h 0.70(v4 是 0.95),底面接在 ①的前端面上 ⇒ 置點 = (0, 0.528, 0.761) + 0.35u
    //     = (0, 0.580, 1.107);斷面 1.20×1.24 收到 **0.68×0.72**(v4 是 0.86×0.92);
    //     sz 0.24 ⇒ 前端面中心 (0, 0.396, 1.489)、上緣 (0.751, 1.435)、下緣 (0.040, 1.543)。
    // 兩段共 1.88(v4 是 2.13,−12%)—— 收掉的那 0.25 **不是把身體變短**,是讓出頸的位置:
    // 顱殼後緣同時自 z 1.28 推到 1.98 ⇒ 軀幹前緣與顱殼之間開出 **0.54** 的淨空(v4 是貼著的,
    // 側視完全看不出有頸),而整體剪影反而更長(吻端 3.04 → 3.74)。
    const body = tboxF(ch, { w0: 1.00, d0: 1.02, w1: 1.20, d1: 1.24, h: 1.18, sz: 0.10 }, 0, 0.538, 0.163, PAL.main, { metalness: 0.55 });
    body.rotation.x = 1.42;
    const fore = tboxF(ch, { w0: 1.20, d0: 1.24, w1: 0.68, d1: 0.72, h: 0.70, sz: 0.24 }, 0, 0.580, 1.107, PAL.main, { metalness: 0.55 });
    fore.rotation.x = 1.42;
    // 外凸肋甲環 ×4(latheF 鼓環貼各段中心線;環心壓在中心線下緣、凸在腹側 = ★ 圖的一圈圈裝甲帶)
    //   ①段中心線緩升、②段因剪切往前下走 ⇒ 前兩環 rot.x 1.42、後兩環跟著轉平/轉負;
    //   第 4 環半徑隨新的收分喉艙一起收(0.60 → 0.54),否則整圈飄在艙壁外面。
    const hoops = [[0.30, -0.15, 0.64, 1.42, PAL.mid], [0.37, 0.28, 0.70, 1.42, PAL.main],
      [0.34, 0.72, 0.68, 1.50, PAL.mid], [0.26, 1.12, 0.50, 1.62, PAL.main]];
    for (const [hy, hz, hr, hrot, col] of hoops) {
      const hp = latheF(ch, [[hr * 0.92, -0.08], [hr, -0.035], [hr, 0.035], [hr * 0.92, 0.08]], 12, 0, hy, hz, col, { metalness: 0.55 });
      hp.rotation.x = hrot;
      hp.scale.z = 0.92;
    }
    // 左右胸甲板(prismF 六角,貼收分喉艙的前上側)+ 側百葉(散熱開口)
    for (const sx of [-1, 1]) {
      const pec = prismF(ch, [[-0.17, -0.24], [0.17, -0.24], [0.28, 0], [0.17, 0.22], [-0.17, 0.22], [-0.28, 0]]
        .map(([x, y]) => [sx * x, y]), 0.10, sx * 0.24, 0.44, 1.32, PAL.lite, { metalness: 0.55 });
      pec.rotation.x = -0.15;
      bxF(ch, 0.06, 0.26, 0.44, sx * 0.58, 0.42, 0.52, INK, { metalness: 0.7 }).rotation.y = sx * 0.1;
    }
    // 頸根領環(套在頸芯柱的體端,壓在軀幹前端面內側 —— 與頸軸同一個角度,見 NECK_ROT)
    const collar = latheF(ch, [[0.40, -0.06], [0.45, -0.02], [0.45, 0.02], [0.40, 0.06]], 12, 0, 0.64, 1.10, PAL.mid, { metalness: 0.6 });
    collar.rotation.x = NECK_ROT;
    collar.scale.z = 1.1;
    // 腹龍骨(深胸下緣長楔,沿腹線 z 0.21 → 1.51)+ 腹側管束
    const keel = tboxF(ch, { w0: 0.62, d0: 0.46, w1: 0.40, d1: 0.30, h: 1.30 }, 0, -0.11, 0.86, PAL.dark, { metalness: 0.65 });
    keel.rotation.x = 1.55;
    cablesF(ch, { p0: [0, -0.26, 1.45], p1: [0, -0.12, 0.30], k: 3, r: 0.03, sag: 0.03, spread: 0.09 }, IRON, { metalness: 0.8 });
    // ── 背甲大蓋板(放平 = 脊背線:髖最高、向肩微下斜,肩後覆至尾根)──
    // 尾根抬到 y 0.55 之後,尾首節(r 0.54)整段仍收在蓋板的寬度(±0.725)與高度之內 ⇒ 不露餡;
    // 蓋板後緣 (−1.92, 1.06) 恰好在尾管上緣(y 1.02)之上 —— **改尾根高或 r0 MUST 回頭核這一條**。
    const slab = prismF(ch, [
      [0.95, 0.84], [0.52, 1.20], [-0.40, 1.38], [-1.30, 1.34], [-1.92, 1.06], [-1.72, 0.84], [-0.70, 0.78], [0.35, 0.70],
    ], 1.45, 0, 0, 0, PAL.mid, { metalness: 0.6 });
    slab.rotation.y = -Math.PI / 2;
    const cap = tboxF(ch, { w0: 1.00, d0: 0.88, w1: 0.86, d1: 0.72, h: 0.08 }, 0, 1.42, -0.72, PAL.main, { metalness: 0.55 });
    cap.rotation.x = 0.02;
    // 前斜面散熱百葉 ×4(INK 橫柵,索引沿前斜面 (0.95,0.84)→(0.52,1.20) 爬升;斜面向後升 ⇒ 負仰角)
    for (let i = 0; i < 4; i++)
      bxF(ch, 0.78, 0.04, 0.15, 0, 0.90 + i * 0.075, 0.86 - i * 0.09, INK, { metalness: 0.7 }).rotation.x = -0.70;
    // 側鉸座 ×2 + 後支柱(蓋板落在骨盆上的結構件)+ 後排氣 ×2
    for (const sx of [-1, 1]) {
      tboxF(ch, { w0: 0.09, d0: 0.58, w1: 0.075, d1: 0.44, h: 0.32 }, sx * 0.70, 0.90, -0.90, PAL.deep, { metalness: 0.6 });
      cylF(ch, 0.08, 0.08, 0.18, 8, sx * 0.30, 1.00, -1.88, INK, { metalness: 0.75 }).rotation.x = Math.PI / 2 + 0.3;
    }
    const strut = tboxF(ch, { w0: 0.50, d0: 0.70, w1: 0.44, d1: 0.75, h: 0.80, sz: -0.10 }, 0, 0.45, -0.85, PAL.deep, { metalness: 0.6 });
    strut.rotation.x = -0.12;
    // 脊背識別燈
    bxF(ch, 0.42, 0.05, 0.26, 0, 1.41, -0.45, accent, { emissive: accent, emissiveIntensity: 0.8 });
  },
  pelvis(c, hips) {
    const { PAL } = c;
    // 骨盆塊(拉高接脊背線,後傾收分接尾根 —— 骨架照:髖是全身最高的支點)+ 下腹護板 + 尾根座環
    const block = tboxF(hips, { w0: 1.05, d0: 1.15, w1: 0.92, d1: 0.95, h: 0.85, sz: -0.08 }, 0, 0.18, -0.20, PAL.mid, { metalness: 0.6 });
    block.rotation.x = -0.10;
    tboxF(hips, { w0: 0.75, d0: 0.75, w1: 0.62, d1: 0.58, h: 0.32 }, 0, -0.32, -0.15, GUNMETAL, { metalness: 0.7 });
    const tr = latheF(hips, [[0.36, -0.06], [0.42, -0.02], [0.42, 0.02], [0.36, 0.06]], 10, 0, 0.55, -0.92, IRON, { metalness: 0.8 });
    tr.rotation.x = Math.PI / 2;                                 // 尾根座環:隨尾根抬到脊線高(y 0.42 → 0.55)
  },
  thigh(c, l, d) {
    const { PAL } = c;
    // 巨股楔殼(★ 圖後腿全機最大肌群:上寬下收)
    tboxF(l, { w0: 0.62, d0: 0.85, w1: 0.36, d1: 0.48, h: d.len }, 0, -d.len * 0.5, 0.08, PAL.main, { metalness: 0.55 });
    // 前甲板(prismF 圓角六角,層疊在股前 —— 黃紋歸 paint 層)
    const plate = prismF(l, [[-0.23, -0.63], [0.23, -0.63], [0.34, -0.11], [0.21, 0.32], [-0.21, 0.32], [-0.34, -0.11]],
      0.12, 0, -d.len * 0.42, 0.47, PAL.lite, { metalness: 0.55 });
    plate.rotation.x = 0.06;
    // 髖側大圓盤關節(latheF;★ 圖髖部醒目圓盤,盤面圖騰歸 paint)+ 軸帽
    const hd = latheF(l, [[0.06, -0.06], [0.29, -0.05], [0.34, 0], [0.29, 0.05], [0.06, 0.06]], 12, c.sx * 0.36, -0.08, 0.06, PAL.mid, { metalness: 0.7 });
    hd.rotation.z = Math.PI / 2;
    const hub = cylF(l, 0.09, 0.09, 0.06, 10, c.sx * 0.40, -0.08, 0.06, PAL.deep, { metalness: 0.8 });
    hub.rotation.z = Math.PI / 2;
    // 後側腱活塞(hydCyl 亮桿芯)+ 膝前護楔
    hydCyl(l, 0.05, d.len * 0.5, -c.sx * 0.16, -d.len * 0.58, -0.34, 0.12, PISTON);
    const kg = tboxF(l, { w0: 0.32, d0: 0.13, w1: 0.25, d1: 0.10, h: 0.28, sz: 0.04 }, 0, -d.len * 0.94, 0.30, PAL.deep, { metalness: 0.6 });
    kg.rotation.x = -0.15;
  },
  shin(c, l, d) {
    const { PAL } = c;
    // 細瘦趾行小腿(踝端收分,後掠剪影)
    tboxF(l, { w0: 0.32, d0: 0.46, w1: 0.21, d1: 0.27, h: d.len }, 0, -d.len * 0.5, -0.02, PAL.mid, { metalness: 0.6 });
    // 膝側圓盤(latheF)+ 軸帽
    const kd = latheF(l, [[0.04, -0.05], [0.19, -0.038], [0.23, 0], [0.19, 0.038], [0.04, 0.05]], 10, c.sx * 0.21, -0.05, 0.02, PAL.mid, { metalness: 0.7 });
    kd.rotation.z = Math.PI / 2;
    const hub = cylF(l, 0.065, 0.065, 0.05, 8, c.sx * 0.25, -0.05, 0.02, PAL.deep, { metalness: 0.8 });
    hub.rotation.z = Math.PI / 2;
    // 脛前甲(細長楔)+ 後側腱活塞 + 踝座環
    const greave = tboxF(l, { w0: 0.25, d0: 0.11, w1: 0.18, d1: 0.08, h: 0.60 }, 0, -d.len * 0.42, 0.22, PAL.lite, { metalness: 0.55 });
    greave.rotation.x = -0.06;
    hydCyl(l, 0.038, d.len * 0.48, -c.sx * 0.08, -d.len * 0.55, -0.24, 0.1, PISTON);
    latheF(l, [[0.14, -0.05], [0.17, -0.02], [0.17, 0.02], [0.14, 0.05]], 10, 0, -d.len * 0.94, -0.01, IRON, { metalness: 0.8 });
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 足身楔台 + 踝前斜甲(★ 圖深色踝甲圈)—— v3 足印放大(骨架照:三大趾承重)
    tboxF(l, { w0: 0.55, d0: d.footL, w1: 0.44, d1: d.footL * 0.7, h: 0.18, sz: 0.06 }, 0, -d.clear * 0.45, d.footL * 0.15, PAL.deep, { metalness: 0.55 });
    const guard = tboxF(l, { w0: 0.32, d0: 0.09, w1: 0.25, d1: 0.07, h: 0.30 }, 0, 0.05, 0.16, PAL.mid, { metalness: 0.6 });
    guard.rotation.x = 0.5;
    // 三趾:tboxF 指節 + finF 弧爪(一趾一件;中趾索引放大)
    for (let i = -1; i <= 1; i++) {
      const k = 1 - Math.abs(i) * 0.16;
      const kn = tboxF(l, { w0: 0.19, d0: 0.16, w1: 0.13 * k, d1: 0.12, h: 0.34 * k }, i * 0.22, -d.clear * 0.45, d.footL * 0.5, PAL.mid, { metalness: 0.6 });
      kn.rotation.x = Math.PI / 2;
      const claw = finF(l, { len: 0.38 * k, w0: 0.13, w1: 0.026, t: 0.10, sweep: 0.05, camber: 0.045 },
        i * 0.22, -d.clear * 0.5, d.footL * 0.72, CLAWSTEEL, { metalness: 0.7 });
      claw.rotation.x = Math.PI / 2 + 0.5;
    }
    // 後距爪(finF 朝後下)
    const spur = finF(l, { len: 0.22, w0: 0.09, w1: 0.022, t: 0.075, sweep: 0.04, camber: 0.035 }, 0, -d.clear * 0.3, -d.footL * 0.28, CLAWSTEEL, { metalness: 0.7 });
    spur.rotation.x = -(Math.PI / 2 + 0.4);
  },
  armUp(c, a, d) {
    const { PAL } = c;
    // ── 退化短前臂 ①上臂(v5:手繪稿「前爪在更前面的位置」)──
    // 肩樞軸是 forge 凍結的胸腔局部 (±0.6, 0.42, 0);前置只能靠幾何,樞軸鏈一格都不知道。
    // 上臂用剪切表達 肩端 (y 0, z 0.28) → **視覺肘 (y −d.len, z 0.76)**(v4 是 0.62):
    //   tboxF 的頂面 = 肩端、底面 = 肘端 ⇒ 置於 z 0.76(底面 z)、sz = 0.28 − 0.76 = −0.48。
    sphF(a, 0.20, 0, 0.03, 0.26, PAL.mid, { metalness: 0.65 });
    const pad = tboxF(a, { w0: 0.32, d0: 0.36, w1: 0.22, d1: 0.26, h: 0.20, sz: -0.05 }, c.sx * 0.04, 0.02, 0.28, PAL.mid, { metalness: 0.6 });
    pad.rotation.z = -c.sx * 0.18;
    tboxF(a, { w0: 0.28, d0: 0.32, w1: 0.21, d1: 0.24, h: d.len, sz: -0.48 }, 0, -d.len * 0.5, 0.76, PAL.lite, { metalness: 0.55 });
    // 屈肌活塞:沿上臂斜軸 (0, −0.60, +0.48) 正規化 (0, −0.781, 0.625) ⇒ tilt = atan2(−0.48, 0.60) = −0.675
    hydCyl(a, 0.030, d.len * 0.60, c.sx * 0.15, -0.30, 0.50, -0.675, PISTON);
  },
  armFore(c, a, d) {
    const { PAL } = c;
    // ── ②前臂:肘樞軸 (±0.6, −0.18, 0) 且肘屈 pose.elbow.base = −0.55 ⇒ 這個框已整組前傾 31.5°。
    // 目標(胸腔框):視覺肘 (0, −0.18, 0.76) → 視覺腕 (0, −0.58, 1.15)(v4 是 0.62 / 1.00)。
    // 換回肘局部 = 繞 x 轉 +0.55(cos 0.8525 / sin 0.5227):
    //   肘端 R(+0.55)(0, 0, 0.76)          = (0, −0.397, 0.648)
    //   腕端 R(+0.55)(0, −0.40, 1.15)      = (0, −0.942, 0.771)
    // ⇒ tboxF h 0.545、中心 y −0.670、底面(腕端)z 0.771、sz = 0.648 − 0.771 = −0.123。
    const ed = latheF(a, [[0.05, -0.06], [0.15, -0.048], [0.175, 0], [0.15, 0.048], [0.05, 0.06]], 10, c.sx * 0.13, -0.397, 0.648, PAL.mid, { metalness: 0.75 });
    ed.rotation.z = Math.PI / 2;
    tboxF(a, { w0: 0.24, d0: 0.27, w1: 0.19, d1: 0.21, h: 0.545, sz: -0.123 }, 0, -0.670, 0.771, PAL.lite, { metalness: 0.6 });
    hydCyl(a, 0.024, 0.34, -c.sx * 0.11, -0.66, 0.60, -0.222, PISTON);   // tilt = atan2(−0.123, 0.545)
  },
  mount(c, F) {
    const { PAL, accent } = c;
    // ── 顎鉸 + 下顎(真樞軸:heavyPivot 充能張顎 = 射擊姿勢;rest 常開 0.36 露砲)──
    const jawG = new THREE.Group();
    jawG.position.set(0, -0.70, 2.33);                          // 吃 head hh 偏移(−0.52/+2.20)+ (−0.18/+0.13)
    jawG.rotation.x = 0.36;
    F.head.add(jawG);
    const axle = cylF(jawG, 0.06, 0.06, 0.64, 8, 0, 0.02, 0, IRON, { metalness: 0.85 });
    axle.rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const hd = latheF(jawG, [[0.045, -0.038], [0.11, -0.03], [0.125, 0], [0.11, 0.03], [0.045, 0.038]], 10, sx * 0.34, 0.02, 0, PAL.deep, { metalness: 0.8 });
      hd.rotation.z = Math.PI / 2;
    }
    const jaw = prismF(jawG, [
      [-0.07, -0.18], [0.61, -0.24], [1.05, -0.18], [1.19, -0.02], [1.12, 0.07], [0.88, 0.02], [0.17, 0.02], [-0.11, -0.02],
    ], 0.52, 0, 0, 0, PAL.mid, { metalness: 0.6 });
    jaw.rotation.y = -Math.PI / 2;
    // 下齒列(一齒一件,尖端朝上、前大後小)+ 口腔底板(暗紅)
    for (let i = 0; i < 4; i++) {
      const th = 0.14 - i * 0.016;
      for (const sx of [-1, 1])
        tboxF(jawG, { w0: 0.065, d0: 0.08, w1: 0.022, d1: 0.028, h: th }, sx * 0.21, 0.02 + th / 2, 1.0 - i * 0.19, TEETH, { metalness: 0.35 });
    }
    bxF(jawG, 0.38, 0.05, 0.80, 0, 0.02, 0.55, MAWRED, { metalness: 0.2 });
    // ── 口腔四管旋管砲束(輕/重同膛:lMuz 管束小環、hMuz 充能大環;藏在顎裡,張口才見)──
    const tg = new THREE.Group();
    tg.position.set(0, -0.86, 2.53);                            // 吃 head hh 偏移(−0.52/+2.20)+ (−0.34/+0.33)
    F.head.add(tg);
    const breech = tboxF(tg, { w0: 0.28, d0: 0.26, w1: 0.24, d1: 0.22, h: 0.32 }, 0, 0, 0.02, GUNMETAL, { metalness: 0.8 });
    breech.rotation.x = Math.PI / 2;
    cylF(tg, 0.08, 0.08, 0.80, 8, 0, 0, 0.46, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a2 = i * Math.PI / 2 + Math.PI / 4;
      cylF(tg, 0.045, 0.045, 0.86, 8, Math.cos(a2) * 0.09, Math.sin(a2) * 0.09, 0.52, INK, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    }
    const hMuz = latheF(tg, [[0.13, -0.038], [0.17, -0.014], [0.17, 0.014], [0.13, 0.038]], 10, 0, 0, 0.84, accent, { emissive: accent, emissiveIntensity: 1.5 });
    hMuz.rotation.x = Math.PI / 2;
    const lMuz = latheF(tg, [[0.065, -0.026], [0.095, -0.011], [0.095, 0.011], [0.065, 0.026]], 10, 0, 0, 1.02, accent, { emissive: accent, emissiveIntensity: 1.3 });
    lMuz.rotation.x = Math.PI / 2;
    cylF(tg, 0.058, 0.058, 0.05, 8, 0, 0, 1.0, INK, { metalness: 0.3 }).rotation.x = Math.PI / 2;
    // ── ③兩指鉤爪 ×2(暴龍前肢就是**兩指**;F.hand:腕帽 + 每指兩節指骨 + finF 鉤爪,一件一件)──
    // 腕樞軸(forge)在胸腔 (±0.6, −0.64, 0.282) —— **它在 z 0.282 而不是視覺肘的 z 0.76**:
    // 前置量是幾何加上去的,樞軸鏈一格都不知道。armFore 定的視覺腕在 (±0.6, −0.58, 1.15)
    //   ⇒ 相對腕樞軸差 (0, +0.060, +0.868);腕累積旋轉 = 肘 −0.55 + 腕 −0.15 = −0.70
    //   ⇒ 手局部基準 B = R(+0.70)(0, 0.060, 0.868) = (0, −0.513, 0.703)(v4 是 (0,−0.394,0.607))。
    //   手掌零件一律自 B 起算 ⇒ **爪尖回到胸腔框 = (±0.6, −0.769, 1.565)**(v4 是 1.42),
    //   落在收分喉艙前端面(z 1.54~1.65)之下 = 手繪稿 ㋓ 的「軀幹前段下方」。
    // 指節朝向:手局部 rot.x = π/2 + ψ 的長軸 = (0, −sinψ, cosψ),再繞 x 轉 −0.70 回胸腔框:
    //   ψ 0.75 水平前伸 / ψ 1.00 中節下傾 / 爪 ψ 1.45 下鉤。逐節首尾相接(節長 0.14 / 0.11 / 爪 0.22)。
    for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
      const cap = latheF(g, [[0.07, -0.05], [0.115, -0.025], [0.115, 0.025], [0.07, 0.05]], 10, 0, -0.513, 0.703, PAL.deep, { metalness: 0.7 });
      cap.rotation.x = Math.PI / 2 + 0.75;
      for (const i of [-1, 1]) {
        const fx = i * 0.085 - sx * 0.02;                        // 兩指並列,整組略偏體側內緣
        // 指節取 PAL.deep(暗)、爪刃取 CLAWSTEEL(亮):正面視角前爪疊在**亮色巨股**前面,
        // 同色系會整組讀不出來(m02_c3_front 實測);★ 圖的爪本來也是暗色金屬。
        const k1 = tboxF(g, { w0: 0.095, d0: 0.10, w1: 0.078, d1: 0.082, h: 0.14 }, fx, -0.577, 0.771, PAL.deep, { metalness: 0.7 });
        k1.rotation.x = Math.PI / 2 + 0.75;
        k1.rotation.z = -i * 0.10;                              // 張指(Rz 先作用 ⇒ x 分量保留,不與 Rx 互轉)
        const k2 = tboxF(g, { w0: 0.078, d0: 0.082, w1: 0.060, d1: 0.064, h: 0.11 }, fx, -0.664, 0.845, PAL.deep, { metalness: 0.7 });
        k2.rotation.x = Math.PI / 2 + 1.00;
        k2.rotation.z = -i * 0.10;
        const claw = finF(g, { len: 0.22, w0: 0.068, w1: 0.014, t: 0.060, sweep: 0.03, camber: 0.03 }, fx, -0.706, 0.872, CLAWSTEEL, { metalness: 0.7 });
        claw.rotation.x = Math.PI / 2 + 1.45;
        claw.rotation.z = -i * 0.10;
      }
    }
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.095 }, heavy: { n: hMuz, r: 0.17 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz],
      heavyPivot: [{ obj: jawG, rest: { x: 0.36, y: 0, z: 0 }, deploy: { x: 0.68, y: 0, z: 0 } }],   // 充能張顎
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.06 },
      aimPose: null,
      wpn: { light: { nodes: [tg], ref: tg, muz: lMuz, fwd: 'z' }, heavy: { nodes: [tg, jawG], ref: tg, muz: hMuz, fwd: 'z' } },
    };
  },
  extra(c, F, rig) {
    const { PAL } = c;
    // 重尾(chainF 十一節收分)—— whipTail 逐幀「覆寫」節樞軸旋轉 ⇒ 基礎姿勢 MUST 住幾何:
    // 掛在近水平的尾根 Group 上(whipTail 摸不到它)。v5(手繪稿「脊椎是橫向的 / 尾巴加長」):
    //   ㋐尾根抬到與頸根同高(y 0.42 → 0.55 ⇒ 「頸根 → 骨盆 → 尾根」這條線 −1.4°,近水平);
    //   ㋑下垂整組壓平(tailRoot −0.12 → −0.02、rot0 −0.03 → −0.012、rotD 0.006 → 0.0024;
    //      累積角 Σ_{i<11}(rot0 + rotD·i) 仍恰好收斂回 0 ⇒ 尾梢回正、不翹不垂)
    //      ⇒ 尾尖胸腔 y −0.51 → **+0.29**,與顱殼(0.58~1.15)落在同一個高度帶;
    //   ㋒加長只准動節長帶(**n = 11 是 rig.tailSegs 的契約,一格不准動**):
    //      len0 0.66 → 0.70、len1 0.26 → 0.30 ⇒ 全長 5.06 → 5.50,背脊板 6 → 7 片。
    // 節間分隔 = 深色窄環(INK,v2 實測定案)。
    const tailRoot = new THREE.Group();
    tailRoot.position.set(0, 0.55, -1.00);
    tailRoot.rotation.x = -0.02;
    F.hips.add(tailRoot);
    const { segs, tip } = chainF(tailRoot, {
      n: 11, y: 0, z: 0,
      len0: 0.70, len1: 0.30, r0: 0.54, r1: 0.11,
      rot0: -0.012, rotD: 0.0024, ring: false, seg: 10,
      drawSeg: (t, i, { r, len }) => {
        const sep = cylF(t, r * 1.02, r * 1.02, r * 0.18, 10, 0, 0, -0.015, INK, { metalness: 0.7 });
        sep.rotation.x = Math.PI / 2;
        if (i < 7) tboxF(t, { w0: r * 0.55, d0: len * 0.5, w1: r * 0.3, d1: len * 0.32, h: 0.15 - i * 0.017 },
          0, r * 0.9, -len * 0.5, PAL.deep, { metalness: 0.6 });
      },
    }, PAL.main, { metalness: 0.55 });
    // 尾梢錐(coneF 朝後;★ 圖尾端收尖微翹)
    const tipCone = coneF(tip, 0.09, 0.42, 6, 0, 0, -0.46, PAL.deep, { metalness: 0.6 });
    tipCone.rotation.x = -Math.PI / 2;
    rig.tailSegs = segs;
    rig.tailUp = 0.3;
    rig.tinyArms = 1;      // 退化短前臂:不套一般雙足擺臂公式(locomotion)
    rig.leanF = 0.3;       // 水平體軸:加速不再壓頭,改抬尾配平
  },
};
