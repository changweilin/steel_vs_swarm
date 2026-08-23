// ============ AI 零件庫(docs/ai3d_runbook.md §0.2 的唯一縫)============
// 定位:image→3D 產出的**零件形狀**(不是整件成品)以 GLB 入庫,由既有組裝程式
// (beacons `KIND_PARTS` → 後續階段 biomes / models)按名字取用。零件庫只提供幾何;
// 「選哪件、擺哪裡、轉多少、抖多少、上什麼顏色、怎麼動」全部留在既有程式碼 ——
// 烤整棵樹/整棟樓會把逐實例變化(seed / stretch / partJitter)整層丟掉,而畫面上
// 只表現成「整片森林長得一模一樣」,沒有任何錯誤訊息。
//
// ---- 四條紀律 ----
//   ① **保險絲(fuse)**:載入失敗/查無此名 ⇒ `libGeo` 回 null,呼叫端一律以自己的
//      程序生成 primitive 收尾(與 `MODEL_MANIFEST` 同一套降級語意,原則 6)。
//      本檔任何路徑 MUST NOT throw 到呼叫端。
//   ② **共用幾何一律 `markShared()`**(A25):同一份庫幾何會被多個 InstancedMesh /
//      合併桶引用,`disposeTree` 依註冊表跳過。**會就地 `applyMatrix4` 的消費端
//      MUST 先 `.clone()`**(beacons 的合併烘焙就是),否則第二件開始幾何是壞的。
//   ③ **只有幾何 + 底色可覆蓋**:GLB 進庫前已在匯出端剝掉貼圖;顏色仍由零件表的
//      `c:` 決定(CLAUDE.md §1:法線貼圖 MUST 刪除)。本檔不碰材質。
//   ④ **零共享亂數消耗**(§2.3):查表是純函式,MUST NOT 抽任何 `rnd()`。
//
// 離線外廓契約(audit_beacons 為什麼仍然可信):`['lib', name, fallback]` 描述子的
// 離線外廓 = fallback primitive 的外廓;匯出工具(tools/ai3d)MUST 驗「GLB 零件外廓
// ≤ fallback 外廓」才准入庫 ⇒ Node 端不用 three 也量得到保守上界,執行期碰撞柱仍走
// `beaconCollider` 實測(A30 兩邊都成立)。
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { markShared } from './toon.js';

// 家族清單 = 額度:每族一支 GLB(`assets/models/parts/{family}.glb`),按需再加。
// P2c 首族 rock(2026-08-05:SF3D 冰川漂礫 + 裂面裁切 → collapse_a/facet_a/facet_b,
// 消費端 = beacons cairn);第二族 tree(2026-08-05:SF3D 孤立闊葉樹 → 12 顆冠簇節點,
// 尺寸階梯 10/8/7/6/5/4.5/3.5 對齊 GIANT_DEFS 的 ico 冠簇半徑,消費端 = biomes 神木)。
// 載入失敗整族走 fallback = 舊畫面(保險絲,原則 6)。
// 第三族 building(2026-08-06 使用者定案「大量下載不同國家、城市、小鎮、風格的建築物照片
// 再 img→3D;無視舊有物件直接畫,禁止使用原版重繪」:SF3D 磚砌煙囪/商辦量體 →
// chimney_a/ac_a,消費端 = biomes 屋頂配件 InstancedMesh 桶,BLD_LIB 呼叫點守衛)。
// 舊 building.glb 已退出場景建模；正式建築改吃 runtimeParts.js 的 v5/v6 宣告目錄。
export const PART_LIBS = ['rock', 'tree'];

const _geos = new Map();   // 'family/nodeName' -> BufferGeometry(已 markShared)
let _loaded = null;        // 單航班(與 main.js warmModels 同一套守衛語意)

/** 依名取零件幾何;查無 ⇒ null(呼叫端 MUST 以程序生成 primitive 收尾) */
export function libGeo(name) { return _geos.get(name) || null; }

/**
 * 這一次真的載進來的節點名(唯讀快照)。**只給離線量測/出圖工具用** —— 遊戲路徑一律
 * 走 `libGeo(具名節點)`,MUST NOT 拿這一支去枚舉「有什麼就畫什麼」(那會讓畫面隨
 * GLB 的內容漂移,而消費端的零件表才是真相)。
 * 存在的理由:`shot_scene` 的「載到幾顆」讀數與 `mass_near` 機位原本各**手寫一份節點清單**,
 * 名冊一擴充就悄悄過期(同 `% 3` 輪替除數那個坑:檔案在、intake 綠,而工具永遠看不到新節點)。
 */
export function libNames() { return [..._geos.keys()]; }

/**
 * 載入全部零件庫(戰鬥預載階段呼叫,與 `preloadModels` 並行)。
 * 個別家族失敗只印警告、該族全部查 null ⇒ 該族零件全數走 fallback,絕不 reject。
 */
export function loadPartLibs() {
  if (_loaded) return _loaded;
  _loaded = (async () => {
    if (!PART_LIBS.length) return;
    const loader = new GLTFLoader();
    await Promise.all(PART_LIBS.map(async (family) => {
      try {
        const gltf = await new Promise((res, rej) =>
          loader.load(`assets/models/parts/${family}.glb`, res, undefined, rej));
        gltf.scene.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          // 節點命名即鍵;匯出端已把原點對齊接合面、+Y 朝上(skill §2),這裡不再變換
          _geos.set(`${family}/${o.name}`, markShared(o.geometry));
        });
      } catch (e) {
        console.warn(`零件庫載入失敗,該族退回程序生成:${family}`, e?.message || e);
      }
    }));
  })();
  return _loaded;
}
