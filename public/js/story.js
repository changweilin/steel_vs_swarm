// ============ 劇情戰役:鋼鐵軍團的征討 ============
// 客戶端專用內容模組(比照 lore.js,伺服器不 import)。
// 每章 = 一個真實戰場(綁 venues.js 的 venueId)+ 固定主角(STEEL t0x)+ 環境 + 敘事;
// 玩家一律指揮鋼鐵機甲(side:'STEEL'),敵方 = 蜂群 bot。通關(擊毀敵主堡)解鎖下一章。
// 出戰完全複用既有房間/開戰流程(main.js launchStoryBattle),此檔只住「內容 + 進度」,
// 不含平衡數值(teamSize/diff 皆為 room 設定,非 data.js 平衡值)。

export const STORY = [
  {
    id: 'ch1', act: '第一章', title: '星火肅清', name: '星火肅清作戰',
    venueId: 'taipei101', side: 'STEEL', ch: 't01', teamSize: 1, diff: 'novice',
    env: { season: 'summer', time: 'day', weather: 'clear' },
    intro: '蜂群的第一個蜂巢在信義計畫區的玻璃帷幕間點亮。指揮部把「莫洛茲」重機甲直接空投到 101 腳下——冬將軍瓦列里下車時只說了一句:趁火還小,踩熄它。',
    objective: '摧毀蜂群設在信義區的前線主堡。',
    victory: '第一座蜂巢熄滅。市街重回鋼鐵的秩序,但無數光點正從海的另一端亮起。',
    defeat: '蜂群守住了灘頭。重整後再壓上去。',
  },
  {
    id: 'ch2', act: '第二章', title: '霓虹鎮壓', name: '澀谷鎮壓行動',
    venueId: 'shibuya', side: 'STEEL', ch: 't08', teamSize: 1, diff: 'low',
    env: { season: 'autumn', time: 'night', weather: 'rain' },
    intro: '澀谷十字路口的雨夜裡,蜂群用整片電子看板當誘餌。電波歌姬韓雪駕著「詠嘆調」踏進霓虹——她要用比敵人更高的頻率,把整條街的無人機唱到當機。',
    objective: '在雨夜巷戰中拔除蜂群的東亞節點主堡。',
    victory: '看板全數熄滅,只剩雨聲。東亞節點被切斷,蜂群的訊號往沙漠退去。',
    defeat: '訊號淹沒了詠嘆調。壓低頻率,再唱一次。',
  },
  {
    id: 'ch3', act: '第三章', title: '黃沙遠征', name: '吉薩遠征',
    venueId: 'giza', side: 'STEEL', ch: 't04', teamSize: 3, diff: 'low',
    env: { season: 'summer', time: 'dusk', weather: 'clear' },
    intro: '蜂群把補給樞紐藏進金字塔群的陰影。灰雁娜傑日達帶著獵殺小隊踏過黃沙——落日把每一架無人機的輪廓都拉得老長,而她的消音 DMR,只認名單上的目標。',
    objective: '突破沙漠防線,摧毀蜂群的補給樞紐主堡。',
    victory: '名單一個個劃掉。夕陽沉入沙丘時,蜂群的補給線已成廢鐵。',
    defeat: '風沙掩護了牠們的撤退。補上彈藥,再獵一輪。',
  },
  {
    id: 'ch4', act: '第四章', title: '濃霧獵殺', name: '黑森林獵殺',
    venueId: 'blackforest', side: 'STEEL', ch: 't07', teamSize: 3, diff: 'medium',
    env: { season: 'autumn', time: 'day', weather: 'fog' },
    intro: '黑森林的濃霧裡,誰先看見誰,誰就活。無聲李正赫關掉所有燈號,讓「無聲」融進霧與樹——在這裡,一發子彈的射程,取決於你能看多遠。',
    objective: '在濃霧密林中殲滅蜂群伏兵,拔除其藏匿主堡。',
    victory: '霧散時,林間只剩鋼鐵的呼吸。蜂群最堅固的巢穴,被一發不響的子彈掀開。',
    defeat: '霧比子彈更深。等下一陣風,再進林。',
  },
  {
    id: 'ch5', act: '第五章', title: '鋼鐵之心', name: '曼哈頓突入',
    venueId: 'manhattan', side: 'STEEL', ch: 't03', teamSize: 5, diff: 'medium',
    env: { season: 'winter', time: 'night', weather: 'snow' },
    intro: '蜂群的主控核心藏在曼哈頓的摩天樓陣裡。雪夜,大鍋阿爾喬姆一腳踹開街區——「開鍋!」全自動霰彈的火光,是這座鋼鐵森林裡唯一的暖意。',
    objective: '在雪夜市街突入蜂群主控核心,摧毀其中樞主堡。',
    victory: '核心在雪中崩解。蜂群的最後指令,只來得及發往一個地方——巴黎。',
    defeat: '樓陣吞掉了突擊隊。重新編組,再踹一次門。',
  },
  {
    id: 'ch6', act: '終章', title: '王之詔令', name: '巴黎決戰',
    venueId: 'paris', side: 'STEEL', ch: 't01', teamSize: 5, diff: 'high',
    env: { season: 'spring', time: 'dusk', weather: 'clear' },
    intro: '鐵塔下,蜂群傾巢而出,天空黑成一片。冬將軍瓦列里再次踏上前線——從 101 到艾菲爾,這場征討走了半個地球。他抬起「莫洛茲」的砲口:雪崩,該落下了。',
    objective: '擊潰蜂群主力,摧毀其設於艾菲爾鐵塔的女王巢——終結戰爭。',
    victory: '女王巢在雪崩齊射中傾覆。天空重新亮起,屬於鋼鐵。征討,結束了。',
    defeat: '蜂群的數量壓垮了防線。這是最後一戰,不能輸。',
  },
];

// ---- 進度(localStorage;存已通關的章節 id 陣列)----
const KEY = 'svs_story';

export function loadStoryCleared() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
export function isCleared(id) {
  return loadStoryCleared().includes(id);
}
/** 第 0 章恆解鎖;其後需前一章已通關 */
export function chapterUnlocked(i) {
  if (i <= 0) return true;
  return loadStoryCleared().includes(STORY[i - 1].id);
}
export function markCleared(id) {
  const cur = loadStoryCleared();
  if (!cur.includes(id)) cur.push(id);
  localStorage.setItem(KEY, JSON.stringify(cur));
  return cur;
}
