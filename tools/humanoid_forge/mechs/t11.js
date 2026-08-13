// ============ t11 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// // ── t11「老兵」可變式戰術指導機(atlas):貨運掛架、指揮塔頭、旋翼盾、鉚接工業甲 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t11_ground_static.jpg / t11_flight_static.jpg
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// 語彙基調 = 「鉚接工業」:梯形楔台(tboxF)+ 鉚釘列 + 圓筒鼓(latheF)—— 2D 圖的每一塊
// 裝甲都是上寬下收(或上收下寬)的梯形斜面體,主殼一律楔台,圓件一律旋成體。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

export default {
  label: '老兵(t11 變形者・地面型)', hue: 0x8a9a5a,
  prop: { hips: 0.5, legSplay: 0.115, thigh: 0.46, shin: 0.42, shoulderY: 0.78, shoulderX: 0.2, upperArm: 0.175, foreArm: 0.16, head: 0.9, girth: 1.15 },
  gait: { strideF: 1.35, bob: 0.13, sway: 0.1, top: 7, armBase: 0.1 },
  moveSig: { poise: 0.42, idleF: 0.68, idleA: 1.4, launch: 0.08, spool: 0.8, brake: 0.18, settle: 1.7 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [['head', '梯形塔身(楔台前斜面)+並排雙觀察窗(一格裂痕貼膠帶)+帶簷頂圓塔(旋成體)+環列觀察鏡+鞭天線'], ['chest', '梯形鉚接大胸甲(楔台上寬下收)+六角面胸前板(稜柱斜切)+鉚釘列+豎直進氣柵+防滾籠'], ['rack ×2', '欄杆貨架:帆布捆(旋成體圓捆×2)+麻袋+油桶(帶箍環)+備胎(圓環體)+吊掛貨櫃+蜂群發射巢+無線電'], ['hips', '寬扁楔台骨盆+五角前擋板(稜柱)+後腰雙配重塊(警示條+圓環吊環)'], ['leg ×2', '短粗鉚接腿:楔台疊板(下段外擴)+圓筒膝鼓(旋成體)+六角螺栓蓋+大平足(楔台+趾板)'], ['arm ×2', '圓筒大肩甲(旋成體鼓+緣列鉚釘)+臂側主翼板(薄刃鰭片+前緣識別條)+外露液壓'], ['hand ×2', '梯形拳+旋翼盤圓盾:碟形盤面(旋成體)+輪緣環(圓環體)+槳轂圓頂+中心孔環+四徑肋(一肋一件)'], ['武裝', '右架雙聯機槍莢(旋成體砲管帶膛口套)+左架集束布撒器(楔台斜切箱+2×3 發光膛口+尾纜束)']],
  head(c, h) {
    const { PAL, accent, G } = c;
    // 梯形塔身:底寬頂收、頂面後移 ⇒ 前面自然成斜面(2D 車長塔的塔身)
    tboxF(h, { w0: 0.48 * G, d0: 0.5, w1: 0.37 * G, d1: 0.38, h: 0.42, sz: -0.04 }, 0, 0.06, 0, PAL.main, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      const win = bxF(h, 0.14, 0.11, 0.025, sx * 0.11 * G, 0.14, 0.2, 0x8fa8b8, { metalness: 0.3 });  // 並排雙觀察窗(不發光)
      win.rotation.x = -0.23;                                                    // 貼齊前斜面
    }
    const tape = bxF(h, 0.055, 0.016, 0.03, 0.11 * G, 0.14, 0.215, 0x3a3f45);    // 裂痕貼膠帶(斜條)
    tape.rotation.set(-0.23, 0, 0.6);
    latheF(h, [[0.21, 0], [0.22, 0.02], [0.175, 0.05], [0.175, 0.16], [0.13, 0.2], [0.0001, 0.23]],
      12, 0, 0.28, -0.04, PAL.mid, { metalness: 0.6 });                          // 帶簷頂圓塔(旋成體)
    for (let i = 0; i < 5; i++) {
      const th = i / 5 * Math.PI * 2 + 0.4;
      bxF(h, 0.035, 0.03, 0.02, Math.cos(th) * 0.16, 0.4, -0.04 + Math.sin(th) * 0.16, 0x8fa8b8, { metalness: 0.3 });  // 環列觀察鏡
    }
    const hatch = tboxF(h, { w0: 0.14, d0: 0.13, w1: 0.12, d1: 0.11, h: 0.025 }, 0.04, 0.52, -0.08, PAL.deep);
    hatch.rotation.x = -0.35;                                                    // 半開小艙蓋
    const whip = cylF(h, 0.008, 0.015, 0.85, 5, -0.16 * G, 0.7, -0.14, IRON, { metalness: 0.8 });
    whip.rotation.z = -0.08;                                                     // 鞭狀長天線(全機最高)
    sphF(h, 0.02, -0.195 * G, 1.12, -0.14, 0xd8d4c8, { metalness: 0.4 });        // 天線球端
    for (let i = 0; i < 4; i++)
      bxF(h, 0.03, 0.03, 0.02, -0.17 * G + i * 0.11 * G, -0.12, 0.245, PAL.deep, { metalness: 0.7 });  // 塔身下緣鉚釘列
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    // 主胸殼:上寬下收的梯形楔台(2D 胸甲肩線最寬、往腰收),頂面微前傾
    tboxF(ch, { w0: d.shoulderX * 1.18, d0: 0.72 * G, w1: d.shoulderX * 1.55, d1: 0.95 * G, h: top - bot + 0.3, sz: 0.04 },
      0, (top + bot) / 2 + 0.1, 0, PAL.main, { metalness: 0.6 });
    // 六角面胸前板(稜柱 + 斜切邊):2D 正面那塊有板縫的迷彩大甲板
    prismF(ch, [[-0.74, 0.5], [0.74, 0.5], [0.62, -0.1], [0.3, -0.52], [-0.3, -0.52], [-0.62, -0.1]],
      0.13, 0, (top + bot) / 2 + 0.15, 0.44 * G, PAL.mid, { metalness: 0.6, bevel: { t: 0.03, s: 0.03 } });
    bxF(ch, d.shoulderX * 1.1, 0.1, 0.05, 0, bot + 0.18, 0.44 * G, accent, { emissive: accent, emissiveIntensity: 1.0 });  // 胸前識別燈
    bxF(ch, d.shoulderX * 1.3, 0.03, 0.02, 0, (top + bot) / 2 - 0.28, 0.42 * G, PAL.deep);  // 橫向板縫
    for (const sx of [-1, 1])
      for (let i = 0; i < 4; i++)
        bxF(ch, 0.04, 0.04, 0.035, sx * 0.6, (top + bot) / 2 - 0.18 + i * 0.24, 0.44 * G + 0.075, PAL.deep, { metalness: 0.7 });  // 板縫鉚釘列(左右豎列)
    for (let i = 0; i < 4; i++)
      bxF(ch, 0.04, 0.04, 0.035, -0.45 + i * 0.3, (top + bot) / 2 + 0.58, 0.44 * G + 0.06, PAL.deep, { metalness: 0.7 });  // 胸板頂緣鉚釘橫列
    for (const sx of [-1, 1]) {                                                  // 豎直進氣柵(格框 + 三豎柵)
      tboxF(ch, { w0: 0.15, d0: 0.06, w1: 0.13, d1: 0.05, h: 0.44 }, sx * (d.shoulderX * 0.62), (top + bot) / 2 + 0.12, 0.46 * G, PAL.deep, { metalness: 0.5 });
      for (let i = 0; i < 3; i++)
        bxF(ch, 0.022, 0.38, 0.02, sx * (d.shoulderX * 0.62) + (i - 1) * 0.042, (top + bot) / 2 + 0.12, 0.48 * G, PAL.mid);
    }
    for (const sx of [-1, 1]) {                                                  // 防滾籠(駕駛位頂,斜撐)
      const bar = cylF(ch, 0.03, 0.03, 0.5, 6, sx * 0.18, top + 0.2, 0.1, IRON, { metalness: 0.8 });
      bar.rotation.x = 0.5;
      cylF(ch, 0.028, 0.028, 0.18, 6, sx * 0.18, top + 0.28, -0.12, IRON, { metalness: 0.8 });  // 後立柱
    }
    cylF(ch, 0.03, 0.03, 0.4, 6, 0, top + 0.3, 0.02, IRON, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 頂樑
    for (let i = 0; i < 3; i++)
      sphF(ch, 0.028, -0.12 + i * 0.12, top + 0.31, 0.05, 0xfff2b8, { emissive: 0xfff2b8, emissiveIntensity: 0.9 });  // 工作燈
    // 腰腹段(補上胸殼與骨盆之間的斷面;2D 的分段腰甲)
    tboxF(ch, { w0: 0.6 * G, d0: 0.46 * G, w1: 0.78 * G, d1: 0.58 * G, h: 0.52, sz: 0.02 }, 0, 0.44, 0, PAL.deep, { metalness: 0.6 });
    tboxF(ch, { w0: 0.52, d0: 0.5 * G, w1: 0.46, d1: 0.44 * G, h: 0.32 }, 0.08, top + 0.1, -0.4 * G, 0x6a6f5a, { metalness: 0.3 });  // 背馱貨箱
    const bk2 = tboxF(ch, { w0: 0.42, d0: 0.4 * G, w1: 0.36, d1: 0.34 * G, h: 0.26 }, -0.14, top + 0.04, -0.55 * G, 0x7a7360, { metalness: 0.3 });
    bk2.rotation.y = 0.12;                                                       // 第二箱(略歪)
    bxF(ch, 0.54, 0.03, 0.05, 0.08, top + 0.12, -0.4 * G, 0x3a3f45);             // 貨箱綁帶
    for (const sx of [-1, 1]) {                                                  // 雙側貨運掛架(滿載;長軸朝外 = 2D 的側伸托盤)
      const rack = new THREE.Group();
      rack.position.set(sx * (d.shoulderX * 1.35), top + 0.16, 0);
      rack.rotation.z = sx * 0.06;
      ch.add(rack);
      if (sx > 0) c.rackR = rack; else c.rackL = rack;                           // mount 消費(不靠 children 掃描)
      tboxF(rack, { w0: 1.3, d0: 0.6 * G, w1: 1.24, d1: 0.55 * G, h: 0.13 }, sx * 0.28, 0, 0, PAL.mid, { metalness: 0.6 });  // 掛架托盤(楔台,往外伸)
      for (const oz of [-0.32, 0.32]) {
        const rail = cylF(rack, 0.015, 0.015, 1.26, 6, sx * 0.28, 0.17, oz, IRON, { metalness: 0.8 });
        rail.rotation.z = Math.PI / 2;                                           // 前後長欄杆
        cylF(rack, 0.012, 0.012, 0.15, 5, sx * 0.86, 0.1, oz, IRON, { metalness: 0.8 });  // 外端立柱
      }
      const rl2 = cylF(rack, 0.014, 0.014, 0.62, 5, sx * 0.9, 0.17, 0, IRON, { metalness: 0.8 });
      rl2.rotation.x = Math.PI / 2;                                              // 外端橫欄
      bxF(rack, 0.1, 0.05, 0.55, sx * 0.9, 0.03, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 臂端警示條
      const roll = latheF(rack, [[0.0001, -0.21], [0.11, -0.18], [0.14, -0.11], [0.14, 0.11], [0.11, 0.18], [0.0001, 0.21]],
        10, sx * 0.12, 0.2, 0.13, 0x7a7360, { metalness: 0.25 });
      roll.rotation.z = Math.PI / 2;                                             // 帆布大圓捆(旋成體,軸沿托盤)
      const sack = sphF(rack, 0.11, sx * (sx > 0 ? 0.38 : 0.26), 0.15, sx > 0 ? 0.17 : -0.24, 0x6f6753, { metalness: 0.2 });
      sack.scale.set(1.25, 0.72, 1.05);                                          // 麻袋(壓扁;左架讓位給布撒器移後)
      for (const ox of [0.04, 0.26])
        bxF(rack, 0.035, 0.02, 0.56, sx * ox, 0.34, 0.1, 0x3a3f45);              // 綁帶 ×2 跨捆
      if (sx > 0) {
        const roll2 = latheF(rack, [[0.0001, -0.15], [0.09, -0.12], [0.11, -0.07], [0.11, 0.07], [0.09, 0.12], [0.0001, 0.15]],
          10, sx * 0.5, 0.18, -0.16, 0x8a8168, { metalness: 0.25 });
        roll2.rotation.z = Math.PI / 2;                                          // 第二捆(小)
        latheF(rack, [[0.0001, 0], [0.12, 0.01], [0.13, 0.05], [0.13, 0.21], [0.12, 0.25], [0.0001, 0.26]],
          10, sx * 0.62, 0.07, 0.16, 0x4a4f42, { metalness: 0.5 });              // 油桶(直立,旋成體)
        for (const oy of [0.12, 0.2])
          torusF(rack, 0.135, 0.012, sx * 0.62, 0.07 + oy, 0.16, 0x3a3f45, { metalness: 0.7 }, Math.PI * 2).rotation.x = Math.PI / 2;  // 箍環 ×2
        const tire = torusF(rack, 0.17, 0.065, sx * 0.86, 0.28, -0.06, 0x2e3138, { metalness: 0.3 });
        tire.rotation.y = Math.PI / 2;                                           // 備胎(圓環體,直立面朝外)
        cylF(rack, 0.075, 0.075, 0.14, 8, sx * 0.86, 0.28, -0.06, 0x4a4f52, { metalness: 0.6 }).rotation.z = Math.PI / 2;  // 輪轂
        const nest = tboxF(rack, { w0: 0.27, d0: 0.21, w1: 0.24, d1: 0.18, h: 0.24 }, sx * 0.62, 0.1, -0.22, PAL.deep, { metalness: 0.6 });  // 蜂群發射巢(管口朝後,右架限定)
        for (const oy of [-0.05, 0.05]) for (const ox of [-0.06, 0.06])
          cylF(nest, 0.04, 0.04, 0.06, 8, ox, oy, -0.12, COAL, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      } else {
        const crate = tboxF(rack, { w0: 0.32, d0: 0.42, w1: 0.28, d1: 0.38, h: 0.26 }, sx * 0.55, -0.36, 0.08, 0x8f7f4a, { metalness: 0.3 });
        crate.rotation.y = -0.06;                                                // 吊掛瓦楞貨櫃(懸空縫)
        for (const ox of [0.46, 0.66]) bxF(rack, 0.02, 0.24, 0.02, sx * ox, -0.14, 0.08, IRON, { metalness: 0.8 });  // 吊桿
        bxF(rack, 0.1, 0.16, 0.06, sx * 0.14, 0.17, -0.2, 0x2e3236, { metalness: 0.4 });  // 無線電機盒
        cylF(rack, 0.006, 0.006, 0.3, 5, sx * 0.14, 0.38, -0.22, IRON, { metalness: 0.8 });  // 無線電短天線
      }
    }
  },
  pelvis(c, hips, d) {
    const { PAL, accent, G } = c;
    // 寬扁楔台骨盆:頂寬底收(2D 腰甲往下收的梯形)
    tboxF(hips, { w0: 0.72 * G, d0: 0.52 * G, w1: 0.92 * G, d1: 0.66 * G, h: 0.4 }, 0, 0.02, 0, PAL.deep, { metalness: 0.6 });
    prismF(hips, [[-0.26, 0.13], [0.26, 0.13], [0.2, -0.08], [0, -0.17], [-0.2, -0.08]],
      0.08, 0, -0.06, 0.33 * G, PAL.mid, { metalness: 0.55 });                   // 五角前擋板(稜柱)
    for (const sx of [-1, 1]) {                                                  // 後腰雙配重塊
      const w = tboxF(hips, { w0: 0.26 * G, d0: 0.22, w1: 0.22 * G, d1: 0.18, h: 0.28 }, sx * 0.3 * G, 0.0, -0.34 * G, PAL.mid, { metalness: 0.6 });
      bxF(w, 0.2 * G, 0.04, 0.15, 0, 0.16, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 頂面警示條
      torusF(w, 0.035, 0.012, 0, -0.17, 0, IRON, { metalness: 0.8 });            // 下緣吊環(圓環體)
    }
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    const drum = latheF(l, [[0.0001, -0.09], [0.1 * G, -0.09], [0.14 * G, -0.055], [0.14 * G, 0.055], [0.1 * G, 0.09], [0.0001, 0.09]],
      10, 0, -0.08, 0, PAL.mid, { metalness: 0.65 });
    drum.rotation.z = Math.PI / 2;                                               // 髖部圓筒鼓(旋成體)
    tboxF(l, { w0: 0.5 * G, d0: 0.56 * G, w1: 0.42 * G, d1: 0.48 * G, h: d.len * 1.0, sz: 0.03 },
      0, -d.len * 0.52, 0.02, PAL.main, { metalness: 0.6 });                     // 大腿主殼(楔台,下端外擴)
    tboxF(l, { w0: 0.34 * G, d0: 0.07, w1: 0.38 * G, d1: 0.05, h: d.len * 0.5 }, 0, -d.len * 0.45, 0.28 * G, PAL.mid, { metalness: 0.6 });  // 前疊板
    for (let i = 0; i < 3; i++)
      bxF(l, 0.035, 0.035, 0.035, 0.1 * G, -d.len * (0.28 + i * 0.18), 0.32 * G, PAL.deep, { metalness: 0.7 });  // 鉚釘列
  },
  shin(c, l, d) {
    const { PAL, G, sx } = c;
    const knee = latheF(l, [[0.0001, -0.18], [0.11 * G, -0.18], [0.17 * G, -0.14], [0.17 * G, -0.05], [0.185 * G, -0.04], [0.185 * G, 0.04], [0.17 * G, 0.05], [0.17 * G, 0.14], [0.11 * G, 0.18], [0.0001, 0.18]],
      12, 0, -0.02, 0, PAL.mid, { metalness: 0.65 });
    knee.rotation.z = Math.PI / 2;                                               // 圓筒膝關節鼓(旋成體,帶中箍)
    for (const s of [-1, 1])
      cylF(l, 0.06, 0.06, 0.035, 6, s * 0.2 * G, -0.02, 0, COAL, { metalness: 0.85 }).rotation.z = Math.PI / 2;  // 六角螺栓蓋 ×2
    tboxF(l, { w0: 0.4 * G, d0: 0.46 * G, w1: 0.44 * G, d1: 0.5 * G, h: d.len * 0.5, sz: -0.02 },
      0, -d.len * 0.34, 0, PAL.main, { metalness: 0.6 });                        // 鉚接疊板(上,貼膝收窄)
    tboxF(l, { w0: 0.52 * G, d0: 0.54 * G, w1: 0.42 * G, d1: 0.46 * G, h: d.len * 0.5, sz: 0.02 },
      0, -d.len * 0.74, 0.01, PAL.mid, { metalness: 0.6 });                      // 疊板(下,往踝外擴)
    for (const s of [-1, 1])
      bxF(l, 0.035, 0.035, 0.035, s * 0.12 * G, -d.len * 0.8, 0.27 * G, PAL.deep, { metalness: 0.7 });  // 下板鉚釘
    hydCyl(l, 0.035, d.len * 0.4, 0, -d.len * 0.3, -0.22 * G, -0.15, PAL.lite);  // 小腿後液壓撐桿
  },
  foot(c, l, d) {
    const { PAL } = c;
    tboxF(l, { w0: 0.58, d0: d.footL * 1.15, w1: 0.46, d1: d.footL * 0.85, h: 0.2, sz: 0.06 },
      0, -d.clear * 0.5, d.footL * 0.12, PAL.deep);                              // 大平足掌(楔台,前傾)
    tboxF(l, { w0: 0.58, d0: 0.26, w1: 0.5, d1: 0.14, h: 0.11, sz: 0.1 }, 0, -d.clear * 0.44, d.footL * 0.62, PAL.mid);  // 趾板(斜切)
    tboxF(l, { w0: 0.48, d0: 0.2, w1: 0.4, d1: 0.13, h: 0.12, sz: -0.06 }, 0, -d.clear * 0.46, -d.footL * 0.28, PAL.mid);  // 踵板
  },
  armUp(c, a, d) {
    const { PAL, accent, G } = c;
    const pau = latheF(a, [[0.0001, -0.18 * G], [0.2 * G, -0.18 * G], [0.27 * G, -0.14 * G], [0.27 * G, -0.04], [0.29 * G, -0.03], [0.29 * G, 0.03], [0.27 * G, 0.04], [0.27 * G, 0.14 * G], [0.2 * G, 0.18 * G], [0.0001, 0.18 * G]],
      12, 0, 0.08, 0, PAL.main, { metalness: 0.6 });
    pau.rotation.z = Math.PI / 2;                                                // 圓筒大肩甲(旋成體鼓,帶中箍)
    for (let i = 0; i < 3; i++) {
      const th = 0.5 + i * 2.1;
      bxF(a, 0.03, 0.03, 0.03, c.sx * 0.19 * G, 0.08 + Math.cos(th) * 0.18, Math.sin(th) * 0.18, PAL.deep, { metalness: 0.7 });  // 肩甲外緣鉚釘
    }
    cylF(a, 0.05, 0.05, 0.05, 8, 0, 0.4, -0.1, COAL, { metalness: 0.7 });        // 肩頂排氣口
    tboxF(a, { w0: 0.26 * G, d0: 0.3 * G, w1: 0.29 * G, d1: 0.33 * G, h: d.len * 1.0, sz: 0.02 },
      0, -d.len * 0.5, 0, PAL.main, { metalness: 0.6 });                         // 上臂主殼(楔台)
    // 臂側主翼板(薄刃鰭片;寬面朝外、長軸沿臂)—— **飛行型的主翼就是這一片**:
    // 雙臂側伸之後片面法線轉成垂直 = 水平翼面,弦長 = 這裡的 w0/w1。
    // 弦太窄(舊制 0.36/0.5)在飛行型上讀不出翼,只剩兩根細手臂 ⇒ 加寬到接近 2D 圖的翼弦比例。
    const wing = finF(a, { len: d.len * 1.0, w0: 0.62, w1: 0.86, t: 0.08, sweep: 0 },
      c.sx * 0.18 * G, 0.0, -0.06, PAL.mid, { metalness: 0.6 });
    wing.rotation.set(0, Math.PI / 2, Math.PI);
    bxF(a, 0.03, d.len * 0.85, 0.05, c.sx * 0.18 * G, -d.len * 0.5, 0.33, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 翼前緣識別條
    hydCyl(a, 0.03, d.len * 0.42, c.sx * 0.04, -d.len * 0.3, 0.19 * G, -0.22, PAL.lite);  // 肩前液壓撐桿
  },
  armFore(c, a, d) {
    const { PAL, G } = c;
    hydCyl(a, 0.035, d.len * 0.5, 0, -d.len * 0.2, -0.16 * G, -0.25, PAL.lite);  // 肘內側液壓撐桿
    tboxF(a, { w0: 0.29 * G, d0: 0.33 * G, w1: 0.24 * G, d1: 0.27 * G, h: d.len * 1.0, sz: 0.02 },
      0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });                      // 前臂殼(楔台,往腕外擴)
    const wing = finF(a, { len: d.len * 0.92, w0: 0.8, w1: 0.5, t: 0.06, sweep: 0 },
      c.sx * 0.17 * G, -d.len * 0.06, -0.08, PAL.mid, { metalness: 0.6 });
    wing.rotation.set(0, Math.PI / 2, Math.PI);                                  // 前臂翼板段(外翼;弦往梢端收分)
    torusF(a, 0.16 * G, 0.028, 0, -d.len * 0.92, 0.02, PAL.mid, { metalness: 0.7 }).rotation.x = Math.PI / 2;  // 腕部束環
  },
  // 旋翼盤圓盾 —— **兩個型態的同一顆零件**:地面型握在拳側當圓盾、飛行型掛在翼端艙上當槳盤。
  // 盤面法線 = 回傳 g 的局部 +y(定向交給呼叫端:地面 Rz(∓90°) 朝外、飛行由反傾 Group 轉成水平)。
  // 自轉層 spin 另立:飛行檔把它登記進 userData.spin(viewer/game 同一份名冊推進 rotation.y)——
  // 直接轉 g 的話會與定向用的 rotation.z 在尤拉序 'XYZ' 下互相轉走(geo.js rotorF 檔頭同一個坑)。
  rotorDisc(c, parent, x, y, z) {
    const { PAL, accent } = c;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    torusF(g, 0.57, 0.04, 0, -0.005, 0, dimF(accent, 0.85), { emissive: accent, emissiveIntensity: 0.6 }).rotation.x = Math.PI / 2;  // accent 輪緣環(不轉:飛行型的槳環護框)
    const spin = new THREE.Group();
    g.add(spin);
    latheF(spin, [[0.55, -0.03], [0.57, -0.005], [0.55, 0.015], [0.37, 0.032], [0.18, 0.052], [0.0001, 0.07]],
      12, 0, 0, 0, PAL.mid, { metalness: 0.65 });                                // 碟形盤面(旋成體,外緣→中心微拱)
    cylF(spin, 0.53, 0.53, 0.03, 12, 0, -0.03, 0, PAL.deep, { metalness: 0.6 }); // 盤背板
    latheF(spin, [[0.13, 0], [0.12, 0.045], [0.075, 0.085], [0.0001, 0.105]], 10, 0, 0.05, 0, PAL.deep, { metalness: 0.8 });  // 槳轂圓頂
    torusF(spin, 0.16, 0.02, 0, 0.055, 0, COAL, { metalness: 0.8 }).rotation.x = Math.PI / 2;  // 中心孔環(2D 的中心圓)
    for (let i = 0; i < 4; i++) {
      const rib = bxF(spin, 0.05, 0.025, 1.07, 0, 0.022, 0, PAL.deep, { metalness: 0.7 });
      rib.rotation.y = i * Math.PI / 4;                                          // 四條徑肋(一肋一件;飛行型即槳葉)
    }
    return { g, spin };
  },
  mount(c, F) {
    const { PAL, accent, G, K } = c;
    // 雙拳 + 拳側旋翼盤圓盾(地面是盾、飛行旋轉)—— 2D:圓形迷彩盾、中心孔、徑向肋
    for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
      tboxF(g, { w0: 0.34, d0: 0.3, w1: 0.27, d1: 0.34, h: 0.32, sz: 0.04 }, 0, -0.15, 0.02, c.dark);  // 梯形拳
      bxF(g, 0.26, 0.1, 0.08, 0, -0.1, 0.19, PAL.mid, { metalness: 0.6 });       // 指節板
      const d = this.rotorDisc(c, g, sx * 0.26 * G, -0.14, 0.02);
      d.g.rotation.z = -sx * Math.PI / 2;                                        // 局部 +y = 朝外
      (c.discs || (c.discs = [])).push({ ...d, sx, hand: g });                   // 飛行型改定向成水平槳盤(t11_flight)
    }
    // 右架雙聯機槍莢(輕武器)—— 掛在右貨架下方
    const pod = new THREE.Group();
    pod.position.set(0.3, -0.24, 0.08);
    (c.rackR || F.chest).add(pod);
    const ML = 0.85 * K.barrelF;
    tboxF(pod, { w0: 0.32, d0: 0.54, w1: 0.26, d1: 0.46, h: 0.24, sz: -0.05 }, 0, 0, 0, PAL.deep, { metalness: 0.65 });  // 共構機匣(楔台後收)
    for (const ox of [-0.07, 0.07]) {
      const bar = latheF(pod, [[0.0001, 0], [0.03, 0], [0.03, ML * 0.5], [0.026, ML * 0.55], [0.026, ML * 0.8], [0.045, ML * 0.82], [0.045, ML * 0.96], [0.032, ML * 0.98], [0.0001, ML]],
        8, ox, 0, 0.2, GUNMETAL, { metalness: 0.85 });
      bar.rotation.x = Math.PI / 2;                                              // 砲管(旋成體:縮徑段+膛口套)
    }
    bxF(pod, 0.24, 0.1, 0.07, 0, 0, 0.2 + ML * 0.45, PAL.mid, { metalness: 0.7 });  // 雙管夾箍
    const lMuz = bxF(pod, 0.2, 0.06, 0.05, 0, 0, 0.24 + ML, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 槍口環燈
    for (const ox of [-0.07, 0.07])
      tboxF(pod, { w0: 0.09, d0: 0.14, w1: 0.07, d1: 0.1, h: 0.18, sz: 0.03 }, ox, -0.2, 0.05, PAL.mid);  // 下垂雙彈匣(楔台)
    // 左架集束布撒器(重武器):楔台斜切箱 + 2×3 發光膛口 + 俯仰樞軸(蓄力上仰)
    const piv = new THREE.Group();
    piv.position.set(-0.62, 0.32, 0);
    (c.rackL || F.chest).add(piv);
    tboxF(piv, { w0: 0.44, d0: 0.66, w1: 0.36, d1: 0.54, h: 0.3, sz: 0.06 }, 0, 0, 0, PAL.mid, { metalness: 0.6 });  // 布撒箱(楔台,前緣斜切)
    bxF(piv, 0.34, 0.05, 0.5, 0, 0.17, 0.02, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 頂蓋識別條
    tboxF(piv, { w0: 0.36, d0: 0.05, w1: 0.32, d1: 0.04, h: 0.24 }, 0, 0, 0.32, PAL.deep, { metalness: 0.6 });  // 膛口面板
    for (const s of [-1, 1]) {
      const pl = prismF(piv, [[-0.28, 0.12], [0.28, 0.12], [0.22, -0.14], [-0.28, -0.14]], 0.05,
        s * 0.23, 0, 0, PAL.deep, { metalness: 0.6 });
      pl.rotation.y = Math.PI / 2;                                               // 側裝甲板(稜柱)×2
    }
    cablesF(piv, { p0: [0.12, -0.08, -0.3], p1: [0.2, -0.36, -0.42], k: 3, r: 0.012, sag: 0.05, spread: 0.02 }, COAL, { metalness: 0.6 });  // 尾部纜束(供彈/訊號)
    const ports = [];
    for (let i = 0; i < 6; i++) {
      const px = (i % 3 - 1) * 0.11, py2 = (i < 3 ? 0.06 : -0.06);
      const p = cylF(piv, 0.045, 0.045, 0.05, 8, px, py2, 0.36, accent, { emissive: accent, emissiveIntensity: 0.9 });
      p.rotation.x = Math.PI / 2;
      ports.push(p);                                                             // 2×3 發光膛口
    }
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.08 }, heavy: { n: ports[1], r: 0.05 } },
      lightGlowM: [lMuz], heavyGlowM: ports,
      heavyPivot: [{ obj: piv, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.18, y: 0, z: 0 } }],  // 蓄力上仰、擊發反坐
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.06 },
      aimPose: null,
      wpn: { light: { nodes: [pod], ref: pod, muz: lMuz, fwd: 'z' }, heavy: { nodes: [piv], ref: piv, muz: ports[1], fwd: 'z' } },
    };
  },
};
