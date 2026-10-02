// ============ Campaign Storylines: Dual-Faction Dual-Narrative ============
// Client-side content module (mirrors lore.js, not imported by server). Holds narrative content and progress tracking only, no balance values.
//
// Structure:
// Six shared battlefields with dual perspective: selecting STEEL or SWARM determines the playable perspective.
// Each chapter maps to a shared battlefield/environment with mirrored rosters (allied heroes+mercs vs enemy heroes+mercs).
// Deployment reuses existing room/matchmaking flow (main.js launchStoryBattle): player selects pilot, teammates are designated AI wingmen,
// enemies are designated AI opponents. Clearing a chapter (destroying enemy base) unlocks the next chapter for that faction; progression is per-faction.
//
// Roster Allocation Invariants:
// - Faction pilots: 12 per faction. Chapters 1-5 have 2 pilots each + final chapter has 2 = 12 total (each appears exactly once).
// - Mercenaries: 8 total. Each joins both factions once (16 seats total = Ch 1-5 have 1 per side x 5 x 2 = 10 + final chapter has 3 per side x 2 = 6).
//   Within the same battle, both sides MUST have disjoint mercenaries.
// - teamSize: Ch 1-5 use 3 (3v3 -> lanesFor=L2), final chapter uses 5 (5v5 -> L3); all have pre-baked lanes.
// - Audit: verified by node script asserting unique faction pilots, merc count, and disjoint mercenaries per chapter.
//
// img = Briefing cutin portrait displayed before battle launch (assets/story/*, STEEL uses _steel, SWARM uses _swarm).
//
// Siege Progression:
// Story battles MUST follow strict sequence: frontline turret -> mid turret -> base core.
// Damage to subsequent tiers is locked until previous tier is destroyed (settled in sim.siegeLocked, tiers defined in data.js SIEGE;
// enabled via cfg.siege = true from main.startStoryChapter).
// Destroying a tier triggers dialogue cutscene (content in storytalk.js, presentation in dialogue.js).
// heroes/mercs in this file define the dialogue cast (checked by tools/audit_story_talk.mjs).

import { CHAPTER_SCENES } from './chapterScenes.js';
export { CHAPTER_SCENES };

const chapterIntro = (chId, side) =>
  CHAPTER_SCENES[chId]?.[side]?.map((s) => s.paragraphs.join('')).join('\n\n') || '';

export const WORLD = `這是一場誰都負擔得起的戰爭。

十五年前，一位德黑蘭的空氣動力學教授寫下一句乾淨得近乎無辜的命題：防禦的成本，必須低於攻擊。他想用經濟學終結戰爭——如果一枚攻擊比它摧毀的目標更便宜，理性的國家就不會再輕啟戰端。他錯得很徹底。他證明的不是「戰爭打不起」，而是「戰爭打不完」：當一架能擊沉坦克的自殺無人機只要四百八十美元，殺戮就成了全世界最廉價的商品，人人買得起，於是人人都在買。

烏克蘭的天空最先黑成一片。成群結隊、以千計數的廉價無人機像蜂群一樣撲向鋼鐵的軍隊，一種新的信仰隨之誕生——蜂群主義，「死的是機器，不是人。」把人從危險裡撤出來，躲在螢幕後面遙控，讓便宜的、可拋棄的機器去死。同盟由此集結：一群工程師、電競選手、音樂老師、退役感測官，用車庫改裝的六旋翼與跳頻晶片，把「用數量淹沒質量」寫成了整個時代的戰術。他們的旗幟是一位在馬里烏波爾失去弟弟的指揮官，她把六十架蜂群指揮得像一支管弦樂團，卻拒絕替任何一架機器取名：「哀悼留給人。機器，我們再印一台。」

而在鋼鐵的那一端，一位俄羅斯上將的獨子，一名普通的機槍手，死在了一件比步槍還便宜的東西手裡。屍體旁是一台造價四百八十美元的自殺無人機殘片。他無法接受自己人死得如此廉價。葬禮後第三天，他向總參提交重裝雙足平台的量產案，附言只有一句：「一枚四百八十美元的無人機，換走了我一場三百萬美元也買不回的葬禮。給我的士兵穿上鋼鐵。」協約由此成形——他們相信厚重的裝甲、相信把駕駛員包成一顆蛋的乘員艙、相信用鋼鐵的存量去換蜂群的消耗。他們笨重、昂貴、補充有冷卻，完全違背這個時代的邏輯，可他們偏要造。裡面的人，要活著回來。

兩種信仰，兩位各自失去至親的人，隔著陣營在戰報裡對照了整整三年，像照鏡子：一個失去弟弟，一個失去兒子，都死於對方陣營的同一種武器。

戰火從東亞的玻璃帷幕燒起，沿著沙漠的補給線、歐洲的濃霧密林，一路蔓延到大洋彼岸的金融心臟，最後折返回黑海北岸的那座半島，在一座要塞港市的暮色裡匯聚成決戰。而在兩軍之間，還有第三種人——傭兵。他們駕駛能在飛行與地面之間變形的機甲，不談立場，只認合約：「哪邊付錢都一樣快。」蜂群的錢和鋼鐵的錢在他們眼裡是同一種顏色，今天替你炸開一條路，明天可能就替出價更高的人炸你。他們是這場戰爭的潤滑油，也是它永遠停不下來的另一個理由。

從台北到克里米亞，這場征討繞了大半個地球，最後繞回了它開始的地方。你可以站在鋼鐵這一端，替沒能穿上裝甲的孩子補上那一層；也可以站在蜂群那一端，用數量與速度證明，便宜的東西一樣能贏。同一片戰場，兩種答案。而那位寫下命題的教授，如今每晚仍坐在帳篷裡，替敵我雙方陣亡的操作員，各寫一行不署名的哀悼詩。「我想造的是讓戰爭打不起的東西，結果造出了讓戰爭打不完的東西。」夜色沉沉，矛與盾的呼嘯，在戰線兩側永無休止地震顫。`;

export const STORY = [
  {
    id: 'ch1', act: '第一章', venueId: 'taipei101', teamSize: 3,
    env: { season: 'summer', time: 'day', weather: 'clear' },
    STEEL: {
      title: '星火・信義', heroes: ['t06', 't05'], mercs: ['m01'],
      img: 'assets/story/story_ch1_steel.png',
      objective: '摧毀蜂群設在信義計畫區的前線主堡。',
      intro: chapterIntro('ch1', 'STEEL'),
      victory: '第一座蜂巢在正午的反光裡熄滅。市街短暫地屬於鋼鐵,但無數光點,已從海的另一端次第亮起。',
      defeat: '蜂群守住了帷幕後的灘頭。重整、上彈,再壓上去。',
    },
    SWARM: {
      title: '玻璃帷幕的蜂巢', heroes: ['s03', 's04'], mercs: ['m05'],
      img: 'assets/story/story_ch1_swarm.png',
      objective: '守住信義的蜂巢,把協約的登陸機甲擋回灘頭。',
      intro: chapterIntro('ch1', 'SWARM'),
      victory: '協約的鋼鐵退回了海上。第一座蜂巢還亮著——牠證明了,便宜的東西,一樣守得住。',
      defeat: '帷幕後的蜂巢被踩熄了。但機器再印就有,總譜還在她腦子裡。',
    },
  },

  {
    id: 'ch2', act: '第二章', venueId: 'shibuya', teamSize: 3,
    env: { season: 'autumn', time: 'night', weather: 'heavy_rain' },
    STEEL: {
      title: '霓虹肅聲', heroes: ['t08', 't07'], mercs: ['m02'],
      img: 'assets/story/story_ch2_steel.png',
      objective: '在雨夜巷戰中拔除蜂群的東亞節點主堡。',
      intro: chapterIntro('ch2', 'STEEL'),
      victory: '看板全數熄滅,只剩雨聲。東亞節點被切斷,蜂群的訊號往沙漠退去。',
      defeat: '訊號淹沒了詠嘆調。壓低頻率,再唱一次。',
    },
    SWARM: {
      title: '跳頻搖籃曲', heroes: ['s05', 's10'], mercs: ['m06'],
      img: 'assets/story/story_ch2_swarm.png',
      objective: '用整片霓虹當掩護,唱垮協約的電戰,守住東亞節點。',
      intro: chapterIntro('ch2', 'SWARM'),
      victory: '協約的頻率被壓了下去。雨還在下,而蜂群的訊號,穩穩地留在了澀谷。',
      defeat: '高頻壓過了跳頻。收攏航跡,換一版韌體,再飛一次。',
    },
  },

  {
    id: 'ch3', act: '第三章', venueId: 'giza', teamSize: 3,
    env: { season: 'summer', time: 'dusk', weather: 'clear' },
    STEEL: {
      title: '黃沙證明', heroes: ['t09', 't10'], mercs: ['m03'],
      img: 'assets/story/story_ch3_steel.png',
      objective: '突破沙漠防線,摧毀蜂群的補給樞紐主堡。',
      intro: chapterIntro('ch3', 'STEEL'),
      victory: '補給線成了廢鐵。夕陽沉進沙丘時,詩人合上筆記本——今晚的詩,會很長。',
      defeat: '風沙掩護了牠們的撤退。補上彈藥,再算一輪軌跡。',
    },
    SWARM: {
      title: '補給線的星圖', heroes: ['s07', 's12'], mercs: ['m07'],
      img: 'assets/story/story_ch3_swarm.png',
      objective: '守住沙漠補給樞紐,掩護蜂群的補給線。',
      intro: chapterIntro('ch3', 'SWARM'),
      victory: '協約的突防被一枚枚攔下。埃坦在沙上寫下最後一行:證明完畢。',
      defeat: '防線被撕開了。星圖還在埃米爾腦裡,補給線可以重畫。',
    },
  },

  {
    id: 'ch4', act: '第四章', venueId: 'blackforest', teamSize: 3,
    env: { season: 'autumn', time: 'day', weather: 'fog' },
    STEEL: {
      title: '濃霧與關節', heroes: ['t02', 't11'], mercs: ['m04'],
      img: 'assets/story/story_ch4_steel.png',
      objective: '在濃霧密林中殲滅蜂群伏兵,拔除其藏匿主堡。',
      intro: chapterIntro('ch4', 'STEEL'),
      victory: '霧散時,林間只剩鋼鐵的呼吸。最堅固的巢穴,被最安靜的一擊掀開。',
      defeat: '霧比子彈更深。等下一陣風,再進林。',
    },
    SWARM: {
      title: '錶芯不休', heroes: ['s11', 's09'], mercs: ['m08'],
      img: 'assets/story/story_ch4_swarm.png',
      objective: '在濃霧中殲滅協約獵殺組,守住蜂群的藏匿主堡。',
      intro: chapterIntro('ch4', 'SWARM'),
      victory: '霧沒有散。協約的獵人一個個沉進林子,而錶芯,還在不休地走。',
      defeat: '一發不響的子彈,還是找到了錶芯。但關節可以重造,精密不死。',
    },
  },

  {
    id: 'ch5', act: '第五章', venueId: 'manhattan', teamSize: 3,
    env: { season: 'winter', time: 'night', weather: 'snow' },
    STEEL: {
      title: '鋼鐵之心', heroes: ['t03', 't12'], mercs: ['m05'],
      img: 'assets/story/story_ch5_steel.png',
      objective: '在雪夜市街突入蜂群主控核心,摧毀其中樞主堡。',
      intro: chapterIntro('ch5', 'STEEL'),
      victory: '核心在雪中崩解。蜂群的最後一道指令,只來得及發往一個地方——克里米亞。',
      defeat: '樓陣吞掉了突擊隊。重新編組,再踹一次門。',
    },
    SWARM: {
      title: '留白的攔截', heroes: ['s06', 's08'], mercs: ['m01'],
      img: 'assets/story/story_ch5_swarm.png',
      objective: '守住蜂群的西半球主控核心,擋下協約的突入。',
      intro: chapterIntro('ch5', 'SWARM'),
      victory: '核心還在跳動。悼歌在日誌上又畫下一整頁的橫線——沒有一枚,漏過去。',
      defeat: '突擊隊踹開了門。核心的最後一道指令,發往了克里米亞。',
    },
  },

  {
    id: 'ch6', act: '終章', venueId: 'crimea', teamSize: 5,
    env: { season: 'spring', time: 'dusk', weather: 'clear' },
    STEEL: {
      title: '王之詔令', heroes: ['t01', 't04'], mercs: ['m06', 'm07', 'm08'],
      img: 'assets/story/story_ch6_steel.png',
      objective: '擊潰蜂群主力,摧毀其設於塞瓦斯托波爾灣畔的女王巢——終結戰爭。',
      intro: chapterIntro('ch6', 'STEEL'),
      victory: '女王巢在雪崩齊射中傾覆。海面重新亮起,天空屬於鋼鐵。征討結束了。而抽屜裡那枚追授勳章,他終於拿了出來。',
      defeat: '蜂群的數量壓垮了防線。這是最後一戰,不能輸。',
    },
    SWARM: {
      title: '終樂章', heroes: ['s01', 's02'], mercs: ['m02', 'm03', 'm04'],
      img: 'assets/story/story_ch6_swarm.png',
      objective: '擋下協約主力,守住塞瓦斯托波爾灣畔的女王巢——終結戰爭。',
      intro: chapterIntro('ch6', 'SWARM'),
      victory: '協約的鋼鐵在終樂章裡散成噪音。海風散去硝煙,天空屬於蜂群。牠們證明了,死的只是機器。而那條回家的路線圖,終於走到了盡頭。',
      defeat: '女王巢在雪崩齊射中傾覆。但總譜還在她腦裡,而機器,再印就有。',
    },
  },
];

/** Retrieve chapter content for given faction (STEEL / SWARM). */
export const chapterSide = (ch, side) => (side === 'STEEL' ? ch.STEEL : ch.SWARM);

// ---- Progress Persistence (localStorage array of cleared chapter IDs per faction) ----
const KEY = (side) => 'svs_story_' + side;

export function loadStoryCleared(side) {
  try { return JSON.parse(localStorage.getItem(KEY(side))) || []; } catch { return []; }
}
export function isCleared(side, id) {
  return loadStoryCleared(side).includes(id);
}
/** Chapter 0 is always unlocked; subsequent chapters require the previous chapter cleared. */
export function chapterUnlocked(side, i) {
  if (i <= 0) return true;
  return loadStoryCleared(side).includes(STORY[i - 1].id);
}
export function markCleared(side, id) {
  const cur = loadStoryCleared(side);
  if (!cur.includes(id)) cur.push(id);
  localStorage.setItem(KEY(side), JSON.stringify(cur));
  return cur;
}
