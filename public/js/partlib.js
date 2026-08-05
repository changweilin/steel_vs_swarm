// ============ AI 零件庫(docs/ai3d_asset_plan.md §2.1 的唯一縫)============
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
// 消費端 = beacons cairn);載入失敗整族走 fallback = 舊畫面(保險絲,原則 6)。
export const PART_LIBS = ['rock'];

const _geos = new Map();   // 'family/nodeName' -> BufferGeometry(已 markShared)
let _loaded = null;        // 單航班(與 main.js warmModels 同一套守衛語意)

/** 依名取零件幾何;查無 ⇒ null(呼叫端 MUST 以程序生成 primitive 收尾) */
export function libGeo(name) { return _geos.get(name) || null; }

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
