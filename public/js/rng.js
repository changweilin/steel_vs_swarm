// ============ 決定性亂數(mulberry32;全專案唯一縫)============
// §2.3:跨客戶端的場景一致靠這一支(戰場中心為種子),散布路徑 MUST NOT 用 `Math.random()`。
// 為什麼獨立成一支**沒有任何 import** 的模組:離線稽核要在 Node 端跑同一份序列,
// 而 `hazards.js` / `biomes.js` 都 import three(CDN importmap,Node 端載不進來)——
// 亂數與 three 綁在同一個檔,等於逼每一支工具再抄一份 mulberry32,那就不是同一條序列了。
// `hazards.js` re-export 舊入口保持相容。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
