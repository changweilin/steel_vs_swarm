// ============ Campaign Chapter Scenes & Cinematic Choreography ============
// Defines 5-section (Ch1-Ch5) and 8-section (Ch6) cinematic storyboards for each faction.
// Dual-perspective Rashomon structure: asymmetric information, opposing interpretations of shared battlegrounds.
// Camera keyframes adhere to Ken Burns pan/zoom bounds (1.05~1.25 scale, -10~+8 pan).

export const CHAPTER_SCENES = {
  ch1: {
    STEEL: [
      {
        id: 'ch1_steel_01', side: 'STEEL',
        img: 'assets/story/story_ch1_steel_01.png', fallbackImg: 'assets/story/story_ch1_steel.png',
        tag: 'TAIPEI, NOON // 台北・信義路碎玻璃', badge: '第一節【起】', title: '帷幕下的熔爐',
        paragraphs: [
          '信義計畫區的玻璃帷幕在夏日正午將整片天空熔成晃動的鏡面。協約前沿監聽哨截獲了一組頻率極高、完全不符合民用協議的跳頻序列——情資官判定，蜂群正將東亞的第一座全自動無人機組裝節點架設在 101 的基座之下。一旦數以萬計的自殺微型機藉由海風擴散，第一島鏈的海空走廊將徹底淪為死地。指揮部的指令只有冰冷的八個字：趁火還小，預先踩熄。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -8, y: -6 }, mid: { scale: 1.12, x: 0, y: -4 }, end: { scale: 1.05, x: 6, y: -2 } },
          portrait:  { start: { scale: 1.28, x: -6, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.10, x: 2, y: -2 } },
        },
      },
      {
        id: 'ch1_steel_02', side: 'STEEL',
        img: 'assets/story/story_ch1_steel.png', fallbackImg: 'assets/story/story_ch1_steel.png',
        tag: 'ROSTER // 總工程師・沈鶴鳴', badge: '第二節【承】', title: '兩百次跳躍的約定',
        paragraphs: [
          '雙足步行平台總設計師沈鶴鳴親自跨入原型機的操縱座。她設計的仿生反曲膝關節讓沉重的機甲擁有了在廢墟碎玻璃上奔跑的柔韌，但她從未忘記自己在驗收報告上的親筆簽名：「此關節將在第二百次跳躍極限時產生金屬疲勞，屆時乘員艙內是一條人命。」她推上主電源，冷靜地校準著受力傳感：「今天，我不打算讓它跳到第二百次。」',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: 6, y: -8 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.06, x: -6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: 4, y: -12 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: -2, y: -4 } },
        },
      },
      {
        id: 'ch1_steel_03', side: 'STEEL',
        img: 'assets/story/story_ch1_steel_03.png', fallbackImg: 'assets/story/story_ch1_steel.png',
        tag: 'ROSTER // 重慶少年王牌・陸小川', badge: '第三節【承】', title: '跳得掉的傷害',
        paragraphs: [
          '「沈工，放心，跳得掉的砲彈根本不需要硬扛！」僚機駕駛陸小川在頻道裡嚼著口香糖笑著。這個重慶職校出身的模擬器神童，駕駛著幾乎被剝光裝甲的特化機體，靠著掌行四足在瓦礫堆中騰挪，長臂借力一躍便甩開了蜂群的雷達鎖定。他把每一次出擊都當作必須通關的街機遊戲，而通關唯一的獎勵，是能多活一天回去吃那鍋滾燙的麻辣火鍋。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -6, y: -4 }, mid: { scale: 1.14, x: 2, y: -6 }, end: { scale: 1.06, x: 6, y: -2 } },
          portrait:  { start: { scale: 1.26, x: -4, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 2, y: -2 } },
        },
      },
      {
        id: 'ch1_steel_04', side: 'STEEL',
        img: 'assets/story/story_ch1_steel_04.png', fallbackImg: 'assets/story/story_ch1_steel.png',
        tag: 'CONTRACT // 變形傭兵・渡鴉', badge: '第四節【轉】', title: '第七條違約金',
        paragraphs: [
          '陰影在三十秒內準時覆蓋了世貿展館的屋頂。塞爾維亞傭兵渡鴉的變形者機甲展開三具掠空旋翼，金屬羽翼優雅地切碎了前沿的阻截雷達。他不問是非，只看合約第七條：延遲付款每小時加計複利。「哪邊付錢都一樣快，」他俯視著腳下翻滾的熱浪低笑，「今天，鋼鐵付得更乾脆。」',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -10, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: 8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: -8, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch1_steel_05', side: 'STEEL',
        img: 'assets/story/story_ch1_steel_05.png', fallbackImg: 'assets/story/story_ch1_steel.png',
        tag: 'ENGAGEMENT // 踏碎灘頭', badge: '第五節【合】', title: '第一把火',
        paragraphs: [
          '警報聲在信義路交錯的鋼骨間連成一片尖嘯。沈鶴鳴凝視著視角前方如烏雲般湧出的黑色旋翼群，她確信自己必須親手拔除這座可能吞噬東亞的殺戮蜂巢。重型機甲的液壓足掌踏碎路面，火光點燃了反光的玻璃天際——第一把火已經燒起，它將一路蔓延至世界的另一端。',
        ],
        camera: {
          landscape: { start: { scale: 1.10, x: 0, y: -8 }, mid: { scale: 1.16, x: 0, y: -4 }, end: { scale: 1.22, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.12, x: 0, y: -10 }, mid: { scale: 1.20, x: 0, y: -6 }, end: { scale: 1.26, x: 0, y: -2 } },
        },
      },
    ],
    SWARM: [
      {
        id: 'ch1_swarm_01', side: 'SWARM',
        img: 'assets/story/story_ch1_swarm_01.png', fallbackImg: 'assets/story/story_ch1_swarm.png',
        tag: 'HSINCHU TO TAIPEI // 新竹產線・黑糖珍奶', badge: '第一節【起】', title: '隨身硬碟的歸途',
        paragraphs: [
          '台海戰火初歇的深夜，林翎正帶著她從新竹晶圓廠搶救出來的非對稱跳頻演算法硬碟撤回台北。協約的登陸艦隊已經逼近基隆外海，將同盟設在 101 的民用防空預警與避難通信中繼站定性為「非法武裝蜂巢」。林翎太清楚對面想要什麼——那是能改寫整場戰爭成本結構的底層韌體，而她絕不容許外來的鋼鐵履帶踩碎這片哺育她的天際線。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -8, y: -6 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.06, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -6, y: -10 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch1_swarm_02', side: 'SWARM',
        img: 'assets/story/story_ch1_swarm.png', fallbackImg: 'assets/story/story_ch1_swarm.png',
        tag: 'ROSTER // 晶片工程師・半羽林翎', badge: '第二節【承】', title: '珍珠奶茶與良率表',
        paragraphs: [
          '「說我們是進攻蜂巢？我頻道換得比你們整支艦隊轉向還快。」林翎嘬了一口隨身保溫杯裡的黑糖珍奶，指尖在自製的強固型平板上化為殘影。她的可變巨象型機甲在天台展開共形天線，將整座城市的頻率雜訊編織成保護傘。在她的世界裡沒有玄學，只有良率：只要抗干擾成功率維持在 99.8%，空中的無人機群就能精確攔截每一枚襲向市區的火箭彈。',
        ],
        camera: {
          landscape: { start: { scale: 1.16, x: -6, y: -8 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.24, x: -4, y: -12 }, mid: { scale: 1.15, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch1_swarm_03', side: 'SWARM',
        img: 'assets/story/story_ch1_swarm_03.png', fallbackImg: 'assets/story/story_ch1_swarm.png',
        tag: 'ROSTER // 近接護衛教官・樫村蒼真', badge: '第三節【承】', title: '圖傳中斷之後的步兵',
        paragraphs: [
          '在地面替她守死樓宇入口的是樫村蒼真。這位前自衛隊近接護衛教官手持改裝了無人機旋翼動力的工兵鏟，渾身泥濘卻如磐石般釘在碎石瓦礫中。「通訊會斷，圖傳會黑，遙控器總有一刻會燒壞，」他在通訊中沉聲吼道，「那一刻，你就是最後的步兵。軟弱比敵人更致命。」',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: -6, y: -4 } },
          portrait:  { start: { scale: 1.24, x: 2, y: -10 }, mid: { scale: 1.15, x: 0, y: -8 }, end: { scale: 1.08, x: -2, y: -4 } },
        },
      },
      {
        id: 'ch1_swarm_04', side: 'SWARM',
        img: 'assets/story/story_ch1_swarm_04.png', fallbackImg: 'assets/story/story_ch1_swarm.png',
        tag: 'CONTRACT // 債務清算傭兵・熄燈', badge: '第四節【轉】', title: '先斷電，再算利息',
        paragraphs: [
          '南非傭兵「熄燈」的機甲無聲地自立體停車場的陰影中滑出。她的足部避震徹底吸收了撞擊聲，背脊的電磁脈衝刺針瞬間點亮。協約先鋒小隊的通訊頻段被硬生生掐斷，儀表在瞬間陷入盲區。「逾期違約，」她在切斷通訊的剎那輕聲說道，「利息翻倍。」',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 8, y: -6 }, mid: { scale: 1.12, x: 0, y: -8 }, end: { scale: 1.05, x: -6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: 6, y: -10 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: -4, y: -4 } },
        },
      },
      {
        id: 'ch1_swarm_05', side: 'SWARM',
        img: 'assets/story/story_ch1_swarm_05.png', fallbackImg: 'assets/story/story_ch1_swarm.png',
        tag: 'DEFENSE // 機器再印就有', badge: '第五節【合】', title: '總譜起拍',
        paragraphs: [
          '帷幕之後，數十架手作改裝的六旋翼在天空中連成了流動的星河。林翎抬頭望著聳入雲端的 101，她知道死去的機器明天就能在產線上重新組裝，但她身後這座城市只有一個。同盟的蜂群已然聽懂了同一份總譜，迎著呼嘯而來的鋼鐵巨獸，悍然升空。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
  },

  ch2: {
    STEEL: [
      {
        id: 'ch2_steel_01', side: 'STEEL',
        img: 'assets/story/story_ch2_steel_01.png', fallbackImg: 'assets/story/story_ch2_steel.png',
        tag: 'SHIBUYA, RAIN // 澀谷十字路口・霓虹光暈', badge: '第一節【起】', title: '雨夜的噪訊陷阱',
        paragraphs: [
          '澀谷十字路口的深秋冷雨將路面澆得發亮，整座商圈的數百塊巨型 LED 電子看板在雨幕中扭曲跳躍。協約情資分析顯示，蜂群的惡意程式正全面寄生於東京的民用電網，利用商場螢幕的動態廣告刷新率掩蓋巨量微型無人機的巡航指令。若不及時進行電磁物理淨空，半個關東的軍民指揮系統將在今夜徹底解體。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -6, y: -8 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -4, y: -12 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch2_steel_02', side: 'STEEL',
        img: 'assets/story/story_ch2_steel.png', fallbackImg: 'assets/story/story_ch2_steel.png',
        tag: 'ROSTER // 電波歌姬・韓雪', badge: '第二節【承】', title: '和聲走音的歌姬',
        paragraphs: [
          '平壤功勳藝術團台柱出身的韓雪戴上隔音耳機，將全頻段干擾車的發射頻率調準。在她耳中，敵人的頻譜編碼是一首漏洞百出的交響曲，跳頻則是急促的變奏。「這一段，請您安靜聽好。」她輕聲吟唱，以極度精準的高頻諧波強行介入敵方回路，讓整條街區盤旋的微型無人機像喝醉般接連撞碎在路燈柱上。',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: -6, y: -6 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.06, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: -4, y: -10 }, mid: { scale: 1.15, x: 0, y: -8 }, end: { scale: 1.08, x: 0, y: -4 } },
        },
      },
      {
        id: 'ch2_steel_03', side: 'STEEL',
        img: 'assets/story/story_ch2_steel_03.png', fallbackImg: 'assets/story/story_ch2_steel.png',
        tag: 'ROSTER // 反器材狙擊手・李正赫', badge: '第三節【承】', title: '無聲的妹妹',
        paragraphs: [
          '在看板頂端的高點，反器材狙擊手李正赫如同一具黑色的翼龍雕像。他操縱的滑翔機甲完全切斷了照明，雙爪鎖定狙擊槍架。他擊發的頻率極慢，因為他每一次扣動扳機前，都在瞄準鏡的微光中反覆確認那架無人機的操控端——他始終不敢去想，訊號那一頭是不是某個與妹妹年紀相仿的孩子。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: 4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: -4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: 2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: -2, y: -2 } },
        },
      },
      {
        id: 'ch2_steel_04', side: 'STEEL',
        img: 'assets/story/story_ch2_steel_04.png', fallbackImg: 'assets/story/story_ch2_steel.png',
        tag: 'CONTRACT // 押運傭兵・磐石', badge: '第四節【轉】', title: '一噸鋼鐵的押運',
        paragraphs: [
          '雨水順著土耳其傭兵「磐石」厚重的胸甲奔流而下。他駕駛的重型機甲如同一堵移動堡壘，毫不猶豫地橫擋在韓雪脆弱的電戰車前，硬生生彈開了三架俯衝自爆機的破片衝擊。「貨物完好，雇主第一，」他在震耳欲聾的爆鳴中悶聲吼道，「我排第二。」',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 8, y: -4 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: -8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: 6, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: -4, y: -4 } },
        },
      },
      {
        id: 'ch2_steel_05', side: 'STEEL',
        img: 'assets/story/story_ch2_steel_05.png', fallbackImg: 'assets/story/story_ch2_steel.png',
        tag: 'SILENCE // 歸於死寂的頻譜', badge: '第五節【合】', title: '全城靜音',
        paragraphs: [
          '韓雪的高音切入最後一個共振頻率，整座十字路口的霓虹看板在一瞬間集體黑屏熄滅。雨聲重新成為街道上唯一的聲音，被剝奪了導航訊號的蜂群無助地墜落在水窪中。協約的裝甲縱隊緩步推進，在肅穆的死寂中收緊包圍網。',
        ],
        camera: {
          landscape: { start: { scale: 1.08, x: 0, y: -6 }, mid: { scale: 1.15, x: 0, y: -4 }, end: { scale: 1.22, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.10, x: 0, y: -8 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
    SWARM: [
      {
        id: 'ch2_swarm_01', side: 'SWARM',
        img: 'assets/story/story_ch2_swarm_01.png', fallbackImg: 'assets/story/story_ch2_swarm.png',
        tag: 'SHIBUYA, RAIN // 澀谷電競冠軍・超頻視野', badge: '第一節【起】', title: '維持呼吸的信號',
        paragraphs: [
          '澀谷的雨夜是首爾電競冠軍河瑟琪最熟悉的地圖。協約電戰部隊以「反恐管制」為名，正試圖以大功率微波強行燒毀關東所有的民生基站。為了維持這座千萬人口都市基本的避難廣播與生命體徵監控，同盟被迫將通訊包拆解成微小的動態頻譜，隱藏在大型商用螢幕的色彩訊號之中——這不是進攻，這是守護這座城市不至於窒息的生命線。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -8, y: -6 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.26, x: -6, y: -10 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch2_swarm_02', side: 'SWARM',
        img: 'assets/story/story_ch2_swarm.png', fallbackImg: 'assets/story/story_ch2_swarm.png',
        tag: 'ROSTER // FPV 王牌・河瑟琪', badge: '第二節【承】', title: '四百 APM 的軌跡',
        paragraphs: [
          '「想拔我們的插頭？先跟上我的手速！」河瑟琪在座艙內飛速操作著微型搖桿，護目鏡上的數據流快得超出常人反應極限。她操控的輕型 FPV 在大樓夾縫以近乎直角變軌穿梭，在協約防空火力的死角反覆橫跳。出擊前，她習慣性摩挲著掛在胸前的加密晶片——那是海峽對岸那位工程師親手為她寫下的護身符。',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: 6, y: -8 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: -6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: 4, y: -12 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: -2, y: -4 } },
        },
      },
      {
        id: 'ch2_swarm_03', side: 'SWARM',
        img: 'assets/story/story_ch2_swarm_03.png', fallbackImg: 'assets/story/story_ch2_swarm.png',
        tag: 'ROSTER // 塔林網路民防・卡佳', badge: '第三節【承】', title: '白噪音裡的絕對音感',
        paragraphs: [
          '年僅十四歲的塔林駭客神童卡佳在螢幕後緊繃著小臉。她不發一語，卻能憑直覺聽出加密封包的「音準」。協約電戰部隊企圖強行覆蓋的白噪音在她眼中如同走調的噪音，她以驚人的天賦在噪聲深處替蜂群開闢出一條條隱密航道，讓每一次通訊都精確送達避難所。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: 4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: -2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: 2, y: -2 } },
        },
      },
      {
        id: 'ch2_swarm_04', side: 'SWARM',
        img: 'assets/story/story_ch2_swarm_04.png', fallbackImg: 'assets/story/story_ch2_swarm.png',
        tag: 'CONTRACT // 母艦傭兵・嘉年華', badge: '第四節【轉】', title: '里約的批發狂歡',
        paragraphs: [
          '雨幕上方傳來一陣狂放的桑巴舞曲。里約傭兵「嘉年華」駕駛的改裝母艦機甲自低空穿透雲層，雙臂掛架如煙火般噴射出大批外包採購的微型無人機。「全場大清倉！擊落鋼鐵一架，抽成三成！」他透過擴音器縱情狂呼，將整片戰場攪得混亂不堪。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -10, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: 8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: -8, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch2_swarm_05', side: 'SWARM',
        img: 'assets/story/story_ch2_swarm_05.png', fallbackImg: 'assets/story/story_ch2_swarm.png',
        tag: 'FREQUENCY // 撕碎鋼鐵的搖籃曲', badge: '第五節【合】', title: '撕碎覆蓋',
        paragraphs: [
          '鋼鐵的電戰矩陣試圖用高壓壓垮這條街，但牠們低估了街頭網絡的頑強生命力。卡佳重新鎖定波長，河瑟琪的無人機群伴隨著跳頻的節奏在雨中劃出耀眼的藍光，一首屬於蜂群的搖籃曲，正在霓虹的廢墟上空全面反撲。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
  },

  ch3: {
    STEEL: [
      {
        id: 'ch3_steel_01', side: 'STEEL',
        img: 'assets/story/story_ch3_steel_01.png', fallbackImg: 'assets/story/story_ch3_steel.png',
        tag: 'GIZA, DUSK // 吉薩・千年前的陰影', badge: '第一節【起】', title: '千年陰影下的陰謀',
        paragraphs: [
          '吉薩金字塔群在血色黃昏下投出綿延數公里的巨型陰影。協約高空偵察衛星在古蹟遮蔽區捕獲了一支規模空前的重載車隊，紅外線熱成像顯示大量高密度電池與彈藥箱正藉由沙塵掩護向蘇伊士運河秘密集結。戰略司令部判定這是一次意圖切斷全球補給動脈的致命伏擊，必須在日落前徹底摧毀其物資中樞。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -8, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -6, y: -10 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch3_steel_02', side: 'STEEL',
        img: 'assets/story/story_ch3_steel.png', fallbackImg: 'assets/story/story_ch3_steel.png',
        tag: 'ROSTER // 巡飛彈之父・達留什', badge: '第二節【承】', title: '詩人的自我審判',
        paragraphs: [
          '被譽為「廉價自殺無人機之父」的達留什教授站在移動發射軌旁，獵獵狂風掀起他滿是沙塵的學者風衣。他本想用經濟學讓戰爭因成本過高而終結，卻親手將殺戮變成了最廉價的連鎖商品。「防禦成本必須低於攻擊……」他撫摸著冰冷的巡飛彈導軌喃喃自語，每射出一枚，他就在筆記本上為一名即將死去的年輕人添上一行無名悼亡詩。',
        ],
        camera: {
          landscape: { start: { scale: 1.16, x: -6, y: -6 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.24, x: -4, y: -10 }, mid: { scale: 1.15, x: 0, y: -8 }, end: { scale: 1.08, x: 0, y: -4 } },
        },
      },
      {
        id: 'ch3_steel_03', side: 'STEEL',
        img: 'assets/story/story_ch3_steel_03.png', fallbackImg: 'assets/story/story_ch3_steel.png',
        tag: 'ROSTER // 應用數學副教授・蕾拉', badge: '第三節【承】', title: '被要挾的數學家',
        paragraphs: [
          '伊斯法罕大學最年輕的副教授蕾拉站在防空塔盾後方，眼神冷冽如冰。她計算的每一個攔截軌跡都精準至微秒級，但只有她自己知道，協約高層正用弟弟的徵召豁免權將她死死綁在這架戰車上。在黃沙對面，那個在國際論文期刊上與她爭辯了十年的學術對手，此刻正試圖突破她的算式。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: -4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: 2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: -2, y: -2 } },
        },
      },
      {
        id: 'ch3_steel_04', side: 'STEEL',
        img: 'assets/story/story_ch3_steel_04.png', fallbackImg: 'assets/story/story_ch3_steel.png',
        tag: 'CONTRACT // 後勤傭兵・雪線', badge: '第四節【轉】', title: '雪線以上的搶修帳單',
        paragraphs: [
          '瑞士傭兵「雪線」的搶修吊車在飛沙中急煞停步。她將受損機甲的散熱閥強行焊死，轉手將一份免責協議拍在駕駛員頭盔上。「先搶修，後結帳，這是雪線的規矩。」她看著滿天火雨冷靜地按下計費器，中立國的商譽在殘酷的戰場上依然分毫不差。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: 8, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: -8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: 6, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: -4, y: -4 } },
        },
      },
      {
        id: 'ch3_steel_05', side: 'STEEL',
        img: 'assets/story/story_ch3_steel_05.png', fallbackImg: 'assets/story/story_ch3_steel.png',
        tag: 'EQUATION // 算式終結於暮色', badge: '第五節【合】', title: '長詩的結尾',
        paragraphs: [
          '落日將沙丘燒成了焦黑的炭色，兩套源自同一學派的頂尖演算法在空中展開殘酷的互噬。巡飛彈群咆哮著扎入補給樞紐，火光照亮了千年前的法老石壁。達留什緩緩合上筆記本——方程式再次得到了證明，而世界又多了一片廢墟。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
    SWARM: [
      {
        id: 'ch3_swarm_01', side: 'SWARM',
        img: 'assets/story/story_ch3_swarm_01.png', fallbackImg: 'assets/story/story_ch3_swarm.png',
        tag: 'GIZA, NIGHT // 吉薩・無信號荒漠', badge: '第一節【起】', title: '人道走廊的孤注一擲',
        paragraphs: [
          '金字塔背陰處停泊的並非鋼鐵宣稱的進攻兵團，而是載滿抗生素、血液透析機與低溫電池的人道救濟車隊。克里米亞前線的平民醫院已斷電數週，這條穿越沙漠的隱密走廊是千萬難民唯一的生機。但在協約殘酷的封鎖體系下，任何未能向帝國報備的物資運輸，都會被無差別判定為「恐怖分子的補給中樞」。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -6, y: -8 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -4, y: -12 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch3_swarm_02', side: 'SWARM',
        img: 'assets/story/story_ch3_swarm.png', fallbackImg: 'assets/story/story_ch3_swarm.png',
        tag: 'ROSTER // 前導偵察・埃米爾', badge: '第二節【承】', title: '星光下的韃靼人',
        paragraphs: [
          '前導偵察組長埃米爾赤腳站在沙丘頂端，手持古老的黃銅六分儀。在電子設備全面被協約壓制的死寂區，衛星導航早已失真，但頭頂的北半球星象千百年來從不撒謊。他以驚人的耐心手繪出每一條避開雷達死角的隱密航跡，在荒漠中丈量著回家的路。',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: 6, y: -8 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: -6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: 4, y: -12 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: -2, y: -4 } },
        },
      },
      {
        id: 'ch3_swarm_03', side: 'SWARM',
        img: 'assets/story/story_ch3_swarm_03.png', fallbackImg: 'assets/story/story_ch3_swarm.png',
        tag: 'ROSTER // 防空總監・埃坦・沙哈', badge: '第三節【承】', title: '論文背後的知己',
        paragraphs: [
          '以色列防空總監埃坦・沙哈盯著空情雷達上的攔截網，壓力越大，他的冷笑話就越刻薄。他一眼就認出對面那套突防架構出自蕾拉之手——那是世上唯一能讀懂他演算法破綻的人。「每一枚被攔下的飛彈，都是一次完美的同行評審。」他咬緊牙關重新推演防空截擊角，誓要為身後的醫療車隊爭取最後三十分鐘。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: 4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: -2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: 2, y: -2 } },
        },
      },
      {
        id: 'ch3_swarm_04', side: 'SWARM',
        img: 'assets/story/story_ch3_swarm_04.png', fallbackImg: 'assets/story/story_ch3_swarm.png',
        tag: 'CONTRACT // 區域拒止・界碑', badge: '第四節【轉】', title: '焦痕為名的界碑',
        paragraphs: [
          '側翼沙丘轟然塌陷，墨西哥傭兵「界碑」展開了如重裝甲蟲般的鞘翅陣地。她從不掩飾左臉那塊醜陋的舊燒傷：「這是我活下來的證明。這片天空是我的責任區，誰踩過線，誰就留下命。」金屬鞘翅穩穩彈開了協約先鋒的巡飛彈雨。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -10, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: 8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: -8, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch3_swarm_05', side: 'SWARM',
        img: 'assets/story/story_ch3_swarm_05.png', fallbackImg: 'assets/story/story_ch3_swarm.png',
        tag: 'Q.E.D. // 守住回家的航路', badge: '第五節【合】', title: '星圖不滅',
        paragraphs: [
          '沙漠深處火光滔天，埃坦的防空演算法在極限重壓下爆發出最後的韌性，硬生生阻截了協約的精確打擊。車隊在星光的掩護下悄然滑入深邃的夜色，埃米爾收起星盤——只要天空依然清澈，生存的希望就不會斷絕。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
  },

  ch4: {
    STEEL: [
      {
        id: 'ch4_steel_01', side: 'STEEL',
        img: 'assets/story/story_ch4_steel_01.png', fallbackImg: 'assets/story/story_ch4_steel.png',
        tag: 'BLACK FOREST, DAWN // 黑森林・能見度零', badge: '第一節【起】', title: '門戶清理的密令',
        paragraphs: [
          '黑森林深處的白霧常年不散，潮濕的冷杉枝葉將一切雷達波吞沒。協約統帥部發布了最高級別的內部緝捕令：前首席機械師哈特曼被控竊取了協約最新雙足機甲的「關節動態母本」，並在密林深處建立非法游擊巢穴。一支由極限同步者與退役老兵組成的獵殺小隊受命深入林海，務必在技術外流前將叛徒就地正法。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -6, y: -8 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -4, y: -12 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch4_steel_02', side: 'STEEL',
        img: 'assets/story/story_ch4_steel.png', fallbackImg: 'assets/story/story_ch4_steel.png',
        tag: 'ROSTER // 加拉泰亞・薇拉', badge: '第二節【承】', title: '神經痛苦的加拉泰亞',
        paragraphs: [
          '身為「加拉泰亞計畫」唯一存活的生化機甲乘員，少女薇拉與機體的同步率高達驚人的百分之三百。在能見度不足五米的迷霧中，她不需要光學感測，森林中每一片落葉的顫動、每一根枯枝的折斷，都化為神經深處銳利的痛覺。「……目標就在前方兩百米，感覺清晰。」她毫無感情起伏的聲音回盪在頻道中。',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: -6, y: -6 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: -4, y: -10 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: 0, y: -4 } },
        },
      },
      {
        id: 'ch4_steel_03', side: 'STEEL',
        img: 'assets/story/story_ch4_steel_03.png', fallbackImg: 'assets/story/story_ch4_steel.png',
        tag: 'ROSTER // 老雪茄・拉斐爾', badge: '第三節【承】', title: '老兵與熄滅的雪茄',
        paragraphs: [
          '安哥拉戰爭老坦克兵「老雪茄」拉斐爾駕駛著重型火力機甲緊護在薇拉身側。他嘴裡叼著半截始終未點燃的雪茄，粗糙的大手穩穩按在主砲握把上。「丫頭，慢點走，聽聽周圍柴油機的聲音。」他拒絕晉升，只因軍銜高了就聽不見引擎的喘息，他要用老兵的血肉經驗，護住身邊這個像工具一樣被消耗的女孩。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: -4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: 2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: -2, y: -2 } },
        },
      },
      {
        id: 'ch4_steel_04', side: 'STEEL',
        img: 'assets/story/story_ch4_steel_04.png', fallbackImg: 'assets/story/story_ch4_steel.png',
        tag: 'CONTRACT // 偵獵幽靈・霧行者', badge: '第四節【轉】', title: '無影無蹤的阿爾泰馴鷹',
        paragraphs: [
          '密林頂端飄過一道連雷達截面都近乎飛鳥的幽靈。蒙古傭兵「霧行者」烏音嘎潛伏在古樹高處，她的塗裝完全融入了苔蘚與白霧。「合約生效前，我已核實過目標的死期。」她低語著射出一枚微型冷發射定位標籤，精確釘在前方掩蔽所的換氣閥上。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: 8, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: -8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: 6, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: -4, y: -4 } },
        },
      },
      {
        id: 'ch4_steel_05', side: 'STEEL',
        img: 'assets/story/story_ch4_steel_05.png', fallbackImg: 'assets/story/story_ch4_steel.png',
        tag: 'HUNT // 無聲子彈的落點', badge: '第五節【合】', title: '掀開綠色棺槨',
        paragraphs: [
          '柴油機的轟鳴打破了古老森林的寧靜，老雪茄的主砲撕碎了重重迷霧，薇拉的機甲如利刃般切入掩蔽所的核心。協約堅信自己正在清除一個出賣靈魂的叛徒，重裝鋼鐵踏碎青苔，直撲深處的機械心臟。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
    SWARM: [
      {
        id: 'ch4_swarm_01', side: 'SWARM',
        img: 'assets/story/story_ch4_swarm_01.png', fallbackImg: 'assets/story/story_ch4_swarm.png',
        tag: 'BLACK FOREST // 密林廠房・0.01mm 精密', badge: '第一節【起】', title: '逃離絞肉機的匠人',
        paragraphs: [
          '黑森林深處的隱蔽工坊內，齒輪與游標卡尺散發著冷冽的機油香氣。六十三歲的前巨頭首席工程師哈特曼並非叛徒，他出走只因無法容忍自己畢生追求的微米級精密，被協約高層塗抹上血跡，改造成將平民步兵碾碎在壕溝裡的殺人機器。他在這片林子裡要證明的，是一套能讓機械失去戰鬥力、卻不傷駕駛艙性命的非致死止戰架構。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -6, y: -8 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -4, y: -12 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch4_swarm_02', side: 'SWARM',
        img: 'assets/story/story_ch4_swarm.png', fallbackImg: 'assets/story/story_ch4_swarm.png',
        tag: 'ROSTER // 首席工程師・哈特曼', badge: '第二節【承】', title: '十萬次運轉的錶芯',
        paragraphs: [
          '「協約機甲那個仿生膝關節，當初是我親手校準的。」哈特曼推了推金絲眼鏡，手中的量規精確卡入攔截彈的核心軸承。「那具機甲在跳躍第二百次時，傳動軸會向右偏折三度——我造了它，我最知道該在哪個毫秒敲斷它。」在他看來，機械的尊嚴在於救人，而非屠戮。',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: 6, y: -8 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: -6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: 4, y: -12 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: -2, y: -4 } },
        },
      },
      {
        id: 'ch4_swarm_03', side: 'SWARM',
        img: 'assets/story/story_ch4_swarm_03.png', fallbackImg: 'assets/story/story_ch4_swarm.png',
        tag: 'ROSTER // 澳洲繼承人・獵場主', badge: '第三節【承】', title: '牧場主的獵槍',
        paragraphs: [
          '新南威爾斯內陸的牧場繼承人「獵場主」艾德蒙站在門口，手持反無人機近炸散彈槍，冷靜地警戒著林間動靜。他賣掉了家族的油畫換取機體，只因深知侵略者的鋼鐵踐踏不會放過任何安寧之地。「獵場裡闖進了野狼，主人不能只在屋裡發抖。」他扣上扳機，每一次擊發的停頓，都如他在澳洲荒原獵野鴨般沉穩。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: 4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: -2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: 2, y: -2 } },
        },
      },
      {
        id: 'ch4_swarm_04', side: 'SWARM',
        img: 'assets/story/story_ch4_swarm_04.png', fallbackImg: 'assets/story/story_ch4_swarm.png',
        tag: 'CONTRACT // 高山隱形狙擊・尾聲', badge: '第四節【轉】', title: '查無此人的尾聲',
        paragraphs: [
          '濃霧中傳來一陣連落葉都未驚動的微響。印度高山特種部隊出身的傭兵「尾聲」如幻影般掠過樹梢，她的飛行噪聲完全與林間風聲抵消。「尾款結清，查無此人。」她只留下一枚指示協約伏擊陣位的反光信標，隨即隱沒於虛無。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -10, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: 8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: -8, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch4_swarm_05', side: 'SWARM',
        img: 'assets/story/story_ch4_swarm_05.png', fallbackImg: 'assets/story/story_ch4_swarm.png',
        tag: 'PRECISION // 敲碎偽裝神經', badge: '第五節【合】', title: '第二百次的脆響',
        paragraphs: [
          '重裝履帶撕裂了最後一道灌木，協約前鋒機甲高高躍起。哈特曼手中的秒錶停在預定的刻度，獵場主的近炸散彈精準命中了機體右膝的受力點——一聲清脆的金屬崩裂聲在霧中炸響，巨獸轟然跪地，失去動力。哈特曼收起工具箱，林中的錶芯依然精準走動。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
  },

  ch5: {
    STEEL: [
      {
        id: 'ch5_steel_01', side: 'STEEL',
        img: 'assets/story/story_ch5_steel_01.png', fallbackImg: 'assets/story/story_ch5_steel.png',
        tag: 'MANHATTAN, NIGHT // 曼哈頓・垂直的水泥峽谷', badge: '第一節【起】', title: '雪夜先發制人',
        paragraphs: [
          '暴風雪將曼哈頓的摩天大樓群澆鑄成一座座冰冷的白色方碑。協約前沿信號站截獲了一段由曼哈頓伺服器群發往克里米亞的底層代碼，高層軍事智囊堅定地將其解讀為「蜂群在西半球集結、即將對協約本土後方發動無限制全自動空襲」的末日動員令。為了不讓本土的妻兒迎來火雨，協約突擊隊受命在暴風雪的掩護下強行破門，碾碎這顆西半球大腦。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -6, y: -8 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -4, y: -12 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch5_steel_02', side: 'STEEL',
        img: 'assets/story/story_ch5_steel.png', fallbackImg: 'assets/story/story_ch5_steel.png',
        tag: 'ROSTER // 突擊手・大鍋', badge: '第二節【承】', title: '懲戒營的鑄鐵大鍋',
        paragraphs: [
          '聖彼得堡米其林主廚出身的突擊手「大鍋」薩維利耶夫，嘴裡嚼著凍硬的列巴，左臂上赫然焊著一口巨大的粗糙鑄鐵鍋。「老子管它裡面裝的是什麼晶片，擋在門前的都是該下鍋的爛肉！」這口鍋是他自己加裝的反應裝甲，也是他歷經四十七次血戰生還的護身符。他咆哮著前進，每一步都將十噸的機甲自重化為狂暴的衝擊力。',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: -6, y: -6 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: -4, y: -10 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: 0, y: -4 } },
        },
      },
      {
        id: 'ch5_steel_03', side: 'STEEL',
        img: 'assets/story/story_ch5_steel_03.png', fallbackImg: 'assets/story/story_ch5_steel.png',
        tag: 'ROSTER // 測向通訊兵・螢火', badge: '第三節【承】', title: '無辜者的墓園簿',
        paragraphs: [
          '跟在大鍋身後的是被動測向兵「螢火」。她操縱的機體上插滿了密密麻麻的測向天線，像一隻沉默的刺蝟。她的職責是為大砲尋找座標，但她從不開火。在她的隨身掌上電腦裡，密密麻麻地記錄著每一個被她標定後炸平的位置，後面跟著同一句清秀的字跡：「那也是一個人。」',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: -4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: 2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: -2, y: -2 } },
        },
      },
      {
        id: 'ch5_steel_04', side: 'STEEL',
        img: 'assets/story/story_ch5_steel_04.png', fallbackImg: 'assets/story/story_ch5_steel.png',
        tag: 'CONTRACT // 債務清算傭兵・熄燈', badge: '第四節【轉】', title: '利滾利的電網切斷',
        paragraphs: [
          '百老匯街角的變電所突然爆發出耀眼的藍光。再次收受了協約高額佣金的傭兵「熄燈」割斷了大樓的應急冷卻回路，整座街區的電磁感應在幾秒內陷入全面短路。「逾期清算，」她踩在積雪的配電箱上輕聲嘲弄，「你們的核心今夜停擺了。」',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: 8, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: -8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: 6, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: -4, y: -4 } },
        },
      },
      {
        id: 'ch5_steel_05', side: 'STEEL',
        img: 'assets/story/story_ch5_steel_05.png', fallbackImg: 'assets/story/story_ch5_steel.png',
        tag: 'BREACH // 撞碎西半球樞紐', badge: '第五節【合】', title: '踹開大門',
        paragraphs: [
          '「都給老子讓開！開鍋了！」大鍋的鋼鐵機甲如同一頭瘋狂的野牛，正面撞碎了曼哈頓伺服器中心加固的防爆鋼門。狂風夾雜著暴雪灌入溫暖的機房，協約的士兵們深信自己拯救了家園，手中的重火器毫不猶豫地對準了核心終端。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
    SWARM: [
      {
        id: 'ch5_swarm_01', side: 'SWARM',
        img: 'assets/story/story_ch5_swarm_01.png', fallbackImg: 'assets/story/story_ch5_swarm.png',
        tag: 'MANHATTAN, SNOW // 曼哈頓・空空的掛架', badge: '第一節【起】', title: '被踐踏的和平信號',
        paragraphs: [
          '在摩天大樓頂層安靜運轉的曼哈頓算力中心，根本沒有發送任何攻擊動員。那段被協約破譯的加密代碼，實則是同盟技術團隊歷時半年草擬的《全自動武器停火與純防禦攔截協議》全球廣播公約。同盟企圖用底層架構約束無人機的攻擊性，卻被驚弓之鳥般的協約軍閥曲解為末日總攻的信號，引來了野蠻的破門毀滅。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -6, y: -8 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -4, y: -12 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch5_swarm_02', side: 'SWARM',
        img: 'assets/story/story_ch5_swarm.png', fallbackImg: 'assets/story/story_ch5_swarm.png',
        tag: 'ROSTER // 感測官・悼歌', badge: '第二節【承】', title: '只有防禦的懺悔者',
        paragraphs: [
          '前美軍 MQ-9 感測官「悼歌」靜立在狂風肆虐的天台邊緣。五年前的那場誤擊讓一支無辜的婚禮隊伍化為灰燼，那是她一生無法洗刷的血債。她重返駕駛座的唯一條件，是機甲上絕不裝填哪怕一枚對地航彈——她的掛架上全是最先進的動能攔截彈，四足機甲的全部平衡，只為了在飛彈下墜的最後一秒將其擊落。',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: 6, y: -8 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: -6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: 4, y: -12 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: -2, y: -4 } },
        },
      },
      {
        id: 'ch5_swarm_03', side: 'SWARM',
        img: 'assets/story/story_ch5_swarm_03.png', fallbackImg: 'assets/story/story_ch5_swarm.png',
        tag: 'ROSTER // 戰地醫療・聖燭', badge: '第三節【承】', title: '修女的白繃帶',
        paragraphs: [
          '克拉科夫修道院孤兒出身的「聖燭」佐菲亞在一旁調度著醫療無人機。她神情溫柔而堅毅，一邊為受損的機甲裝填止血泡沫與急救血漿，一邊透過目視引導同伴阻截暴徒。「我替你們包紮傷口，也替天主記錄行暴者的面孔。攻擊救護者的人，今夜得不到寬恕。」',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: 4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: -2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: 2, y: -2 } },
        },
      },
      {
        id: 'ch5_swarm_04', side: 'SWARM',
        img: 'assets/story/story_ch5_swarm_04.png', fallbackImg: 'assets/story/story_ch5_swarm.png',
        tag: 'CONTRACT // 變形傭兵・渡鴉', badge: '第四節【轉】', title: '渡鴉的金幣',
        paragraphs: [
          '三十秒前，另一筆高昂的資金轉入了瑞士匿名帳戶。變形傭兵渡鴉的機甲呼嘯著掠過第五大道，將一連串干擾鋁箔灑在大樓正面，硬生生阻斷了協約先鋒的火控鎖定。「哪邊出錢都一樣快，」渡鴉在通訊中狂妄大笑，「但今天，蜂群的錢保住了我的好奇心。」',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -10, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: 8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: -8, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch5_swarm_05', side: 'SWARM',
        img: 'assets/story/story_ch5_swarm_05.png', fallbackImg: 'assets/story/story_ch5_swarm.png',
        tag: 'SANCTUARY // 守護心臟的跳動', badge: '第五節【合】', title: '純白的留白',
        paragraphs: [
          '防爆門在巨響中向內崩塌，協約的機甲踩著碎雪闖入。悼歌深吸了一口氣，手指穩穩搭在攔截發射鈕上。在她身後，終端螢幕上那份未被世界聽見的和平協議仍在安靜地傳輸。她不會後退一步，因為她守護的不僅是核心，更是這個嗜血世界最後一絲理性的火種。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
  },

  ch6: {
    STEEL: [
      {
        id: 'ch6_steel_01', side: 'STEEL',
        img: 'assets/story/story_ch6_steel_01.png', fallbackImg: 'assets/story/story_ch6_steel.png',
        tag: 'CRIMEA, DUSK // 塞瓦斯托波爾・海風中的鹽味', badge: '第一節【起】', title: '兩百年的白色石灰岩',
        paragraphs: [
          '海風捲著黑海冰冷的鹽腥味抽打著要塞外牆。塞瓦斯托波爾——這座用白色石灰岩砌築了兩百年的要塞要塞港市，曾見證過沙俄的沉船與兩次慘絕人寰的圍城血戰。從台北信義區的玻璃碎屑、澀谷的暴雨霓虹、吉薩的黃沙，一路輾轉至曼哈頓的風雪，這場漫長的鋼鐵遠征在繞過大半個地球後，終究宿命般地折返回這一切的原點。情資官的終端螢幕被大片猩紅色的雷達信號覆蓋：同盟集結了殘存的所有兵工廠，將最後也是最龐大的「女王巢」死死錨定在船塢區的門式吊車之間。在協約將士眼中，只要將這座源源不絕傾瀉廉價殺戮的母體徹底碾碎，世界才能重回有尊嚴的鋼鐵秩序。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -6, y: -8 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -4, y: -12 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch6_steel_02', side: 'STEEL',
        img: 'assets/story/story_ch6_steel.png', fallbackImg: 'assets/story/story_ch6_steel.png',
        tag: 'ROSTER // 遠征軍總指揮・冬將軍', badge: '第二節【承】', title: '莫洛茲與未佩戴的勳章',
        paragraphs: [
          '遠征軍最高指揮官格羅莫夫上將踏上了港灣石階。他滿頭如雪的白髮在狂風中獵獵作響，左胸掛滿了二十五年戎馬生涯換來的功勳，卻唯獨將一枚追授給獨子的紅星勳章深鎖在最貼身的皮夾內。三年前，那個年輕的步兵機槍手在莫斯科郊外的壕溝裡，被一架造價四百八十美元的自殺微型機炸成焦黑的殘片，那一刻徹底擊碎了一位老父親對軍隊的全部信仰。「一枚廉價玩具，換走我一場三百萬美元也買不回的葬禮。」上將親自跨入重裝雙足旗艦「莫洛茲」，將乘員艙保護得如同一顆鋼鐵之卵。他握緊了戟刃內藏 152mm 榴彈重砲的儀仗戰戟，眼角刻滿了堅毅與滄桑。',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: -6, y: -6 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: -4, y: -10 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: 0, y: -4 } },
        },
      },
      {
        id: 'ch6_steel_03', side: 'STEEL',
        img: 'assets/story/story_ch6_steel_03.png', fallbackImg: 'assets/story/story_ch6_steel.png',
        tag: 'ROSTER // 格魯烏深層特工・灰雁', badge: '第三節【承】', title: '名單上的最後一行',
        paragraphs: [
          '跟隨在巨型機甲身後的是格魯烏資深特工灰雁。她操縱著高敏捷獵殺機甲，手中的戰術終端正閃爍著幽藍的微光。名單上那些曾縱橫戰場的王牌飛手已被她一筆筆劃去，如今名單的最末端只剩下最後兩個深紅色的代號——「蜂后」與「女王巢」。三年來，她無數次在加密情報中審視那個女人的檔案：同樣的失去至親、同樣的執拗狂熱。這不是一場單純的陣地爭奪，而是一場兩面鏡子之間的相互審判。「將軍，」灰雁在耳機中低聲說道，「風向確認，終點站到了。」',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: -4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: 2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: -2, y: -2 } },
        },
      },
      {
        id: 'ch6_steel_04', side: 'STEEL',
        img: 'assets/story/story_ch6_steel_04.png', fallbackImg: 'assets/story/story_ch6_steel.png',
        tag: 'BATTLEFIELD PUSH // 港灣外圍突破・火網合圍', badge: '第四節【中】', title: '外圍要塞防線的崩解',
        paragraphs: [
          '暮色降臨的剎那，外圍陣地的防空警報驟然撕裂海灣。協約前鋒的重裝裝甲連隊推進至防波堤，密集的穿甲彈與高爆燃燒彈在海面上拉出交錯的光痕，強行砸開了同盟布設在舊燈塔哨所的水雷與自爆艇防線。港池內燃起滔天黑煙，同盟的外圍偵察機群如折翼的黑鳥般接連墜入冰冷的海水，戰線被鋼鐵的履帶寸寸向內壓縮，直至將女王巢所在的最後三個船台徹底合圍。所有的通訊通道都被高功率壓制噪訊填滿，最後的決戰已退無可退。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -8, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.06, x: 8, y: -2 } },
          portrait:  { start: { scale: 1.26, x: -6, y: -10 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch6_steel_05', side: 'STEEL',
        img: 'assets/story/story_ch6_steel_05.png', fallbackImg: 'assets/story/story_ch6_steel.png',
        tag: 'CONTRACT // 嘉年華 ＆ 界碑', badge: '第五節【轉】', title: '里約狂歡與鋼鐵鞘翅',
        paragraphs: [
          '協約為這場終局之戰押上了國庫最後的儲備，雇來了整座傭兵市場最昂貴的火力組合。里約傭兵「嘉年華」將雙肩掛載的重裝火力點射程全面解禁，把成箱的導引火箭在半空中織成一張無差別的狂暴火網，火光將他的座艙映得通紅：「全額預付款已到帳！讓這片海灣燒得比狂歡節更亮！」與此同時，墨西哥傭兵「界碑」將兩面如巨岩般的重型鞘翅硬生生楔入防波堤岩石中，用龐大的合金裝甲截斷了蜂群企圖迂迴的所有側翼低空航線，冷酷地築起一道鋼鐵壁壘。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -10, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: 8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: -8, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch6_steel_06', side: 'STEEL',
        img: 'assets/story/story_ch6_steel_06.png', fallbackImg: 'assets/story/story_ch6_steel.png',
        tag: 'CONTRACT // 隱形狙擊手・尾聲', badge: '第六節【轉】', title: '百米高空的幽靈',
        paragraphs: [
          '在硝煙與烈焰的死角，百米高的門式起重機橫樑頂端，一具漆黑的機影宛如與夜色同化。印度高山特種部隊出身的傭兵「尾聲」將機體噪音降至環境底噪以下，熱成像狙擊鏡在熱浪翻滾的碼頭上無聲滑移。她的十字準星穿透層層煙霧，精確鎖定了船塢深處正在緊急調度總譜的核心信號源。「尾款結清，目標鎖定。」她在內部頻道中留下一句毫無感情的低語，修長的手指輕輕搭上電磁擊發閥，等待著致命的一擊。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 8, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: -8, y: -4 } },
          portrait:  { start: { scale: 1.25, x: 6, y: -10 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: -4, y: -2 } },
        },
      },
      {
        id: 'ch6_steel_07', side: 'STEEL',
        img: 'assets/story/story_ch6_steel_07.png', fallbackImg: 'assets/story/story_ch6_steel.png',
        tag: 'MIRROR // 跨越海峽的靈魂對視', badge: '第七節【轉】', title: '照了三年的鏡子',
        paragraphs: [
          '海風在兩軍對峙的死寂中呼嘯。冬將軍站在指揮塔前，遙望著船塢頂端那個在海風中高舉右臂的黑色剪影。三年來，他們隔著無數份陣亡名單與戰術簡報隔空交手，像是在凝視鏡子裡的自己——她失去了弟弟，他失去了兒子；她用數萬台廉價的機器證明人命不該輕易折損，他用數百噸昂貴的鋼鐵發誓不再讓孩子毫無保護地送命。兩種在苦難中誕生的極端信仰，在今夜終於正面相撞。彼此都清楚，這一戰過後，無論誰勝誰負，那座用血淚砌成的鏡子都將彻底粉碎。',
        ],
        camera: {
          landscape: { start: { scale: 1.16, x: -6, y: -6 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: -4, y: -10 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: 0, y: -4 } },
        },
      },
      {
        id: 'ch6_steel_08', side: 'STEEL',
        img: 'assets/story/story_ch6_steel_08.png', fallbackImg: 'assets/story/story_ch6_steel.png',
        tag: 'CLIMAX // 終結廉價殺戮的怒吼', badge: '第八節【合】', title: '雪崩，長戟揮下',
        paragraphs: [
          '女王巢在要塞船塢的暮色中驟然暴發出刺目的幽光，成千上萬架自殺機群的馬達嘯叫宛如海嘯席捲而來。冬將軍緩緩揚起那柄冰冷的儀仗戰戟，將 152mm 重型砲口徑直指向海天交界的母巢核心。「不再有士兵會死得如此廉價，不再有父親需要為四百八十美元的碎片流淚！」老將軍的怒吼如滾雷般壓過海潮，「雪崩，全線進攻！」數千門重裝火砲在這一刻爆發出山崩地裂的轟鳴，鋼鐵的怒潮向著最後的蜂巢鋪天蓋地碾壓而去。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
    SWARM: [
      {
        id: 'ch6_swarm_01', side: 'SWARM',
        img: 'assets/story/story_ch6_swarm_01.png', fallbackImg: 'assets/story/story_ch6_swarm.png',
        tag: 'CRIMEA, DUSK // 塞瓦斯托波爾・終點亦是起點', badge: '第一節【起】', title: '最後的避難所',
        paragraphs: [
          '黑海的落日將塞瓦斯托波爾的港灣熔成一片晃動的金箔。克里米亞是同盟退無可退的最後堡壘，更是這場反抗鋼鐵壟斷的悲壯戰役最初被點燃的原點。從台北信義區的產線撤離、澀谷的頻譜爭奪、吉薩沙漠的星圖偷渡，直至曼哈頓風雪中的阻擊，同盟的隊伍在長達三年的追獵中流盡了熱血，最終全數集結回這片離故鄉最近的廢棄船塢。在同盟戰士眼中，對面跨海逼近的龐大艦隊絕非文明的守護者，而是一群試圖用高昂造價與厚重裝甲將平民永遠踩在腳下的舊時代暴君。女王巢深沉的震顫在海灣間迴盪，迎接著最後的審判。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -6, y: -8 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.25, x: -4, y: -12 }, mid: { scale: 1.16, x: 0, y: -8 }, end: { scale: 1.08, x: 2, y: -4 } },
        },
      },
      {
        id: 'ch6_swarm_02', side: 'SWARM',
        img: 'assets/story/story_ch6_swarm.png', fallbackImg: 'assets/story/story_ch6_swarm.png',
        tag: 'ROSTER // 蜂群指揮官・蜂后', badge: '第二節【承】', title: '沒有名字的第六十架',
        paragraphs: [
          '站在船塢最高龍門吊挑樑上的卡特琳娜・薛甫琴科迎著冷冽的海風抬起右手。十年前，在馬里烏波爾焦黑的泥土裡，她親手掩埋了年僅十九歲的親弟弟，棺木裡除了一捧黑土，只有一台沒能修好的四軸微型飛行器。整整十年，她的作戰總譜裡從不替任何一架無人機命名，機庫裡只有冷酷的十六進制編號。「一旦替機器取了名字，你就會為它的墜毀而猶豫；那一秒的軟弱，足以讓一個真正活著的人替它去死。」她凝視著海灣外圍排山倒海壓來的鋼鐵巨獸，眼中沒有一絲畏懼：「哀悼留給人。機器，我們再印一台。」',
        ],
        camera: {
          landscape: { start: { scale: 1.15, x: 6, y: -8 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: -6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: 4, y: -12 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: -2, y: -4 } },
        },
      },
      {
        id: 'ch6_swarm_03', side: 'SWARM',
        img: 'assets/story/story_ch6_swarm_03.png', fallbackImg: 'assets/story/story_ch6_swarm.png',
        tag: 'ROSTER // 首席技師・鐵匠', badge: '第三節【承】', title: '拖拉機廠的電焊弧光',
        paragraphs: [
          '龍門吊下方的昏暗機棚內，哈爾科夫拖拉機廠的老技師「鐵匠」正操縱著一台比他年紀還大的改裝起重機。他的雙手布滿了老繭與電弧灼傷，手中的高壓焊槍爆發出刺眼的白光，將一具具從火線拖回的受損機體重新拼合。「只要落在這片地上的零件，老子敲敲打打換上新電池，它就還是一條好漢！」那些鏽跡斑斑的舊起重機依然在咆哮運轉。對鐵匠而言，機器的尊嚴從來不在於出廠時掛了多少鍍金勳章，而在於它第幾次被救活、又第幾次頑強地重返藍天。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: -4, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: 4, y: -4 } },
          portrait:  { start: { scale: 1.24, x: -2, y: -8 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: 2, y: -2 } },
        },
      },
      {
        id: 'ch6_swarm_04', side: 'SWARM',
        img: 'assets/story/story_ch6_swarm_04.png', fallbackImg: 'assets/story/story_ch6_swarm.png',
        tag: 'BATTLEFIELD PUSH // 外圍防波堤陷落・收攏防線', badge: '第四節【中】', title: '鋼鐵合圍下的船塢告急',
        paragraphs: [
          '重砲的轟鳴打碎了海灣的寧靜。協約的重型先鋒部隊如鐵幕般撕開了港灣入口，防波堤上的手動遙控機槍塔在巨彈轟擊下化為漫天燃燒的廢鐵。同盟的自動布防網被鋼鐵履帶一層層壓碎，退守至最後船塢的警報燈瘋狂閃爍紅光。通訊頻道裡充斥著前沿觀察員最後的告警與坐標回傳，海水被燃燒的柴油染成血紅，所有的退路都已被切斷，同盟所有的生機與信仰，全繫於女王巢核心尚在加速旋轉的充電矩陣。',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -8, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.06, x: 8, y: -2 } },
          portrait:  { start: { scale: 1.26, x: -6, y: -10 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch6_swarm_05', side: 'SWARM',
        img: 'assets/story/story_ch6_swarm_05.png', fallbackImg: 'assets/story/story_ch6_swarm.png',
        tag: 'CONTRACT // 磐石 ＆ 雪線', badge: '第五節【轉】', title: '土耳其重盾與瑞士搶修',
        paragraphs: [
          '蜂群的陣線同樣站立著以生命兌現合約的異邦人。土耳其押運傭兵「磐石」操縱著巨型重裝盾機，如同一根堅不可摧的鋼樁死死楔入船塢一號大閘，任由對方的穿甲砲火在盾面上轟出凹坑與火星，腳步紋絲不動：「只要老子還有一口氣，這扇門誰也別想跨過去！」在他身後，瑞士傭兵「雪線」在彈雨中熟練地調度搶修吊車，將低溫冷卻劑與備用電容成箱推入發燙的機庫：「先搶修後收費，信譽高於一切！」',
        ],
        camera: {
          landscape: { start: { scale: 1.22, x: -10, y: -4 }, mid: { scale: 1.14, x: 0, y: -6 }, end: { scale: 1.05, x: 8, y: -6 } },
          portrait:  { start: { scale: 1.26, x: -8, y: -8 }, mid: { scale: 1.16, x: 0, y: -6 }, end: { scale: 1.08, x: 4, y: -4 } },
        },
      },
      {
        id: 'ch6_swarm_06', side: 'SWARM',
        img: 'assets/story/story_ch6_swarm_06.png', fallbackImg: 'assets/story/story_ch6_swarm.png',
        tag: 'CONTRACT // 偵獵幽靈・霧行者', badge: '第六節【轉】', title: '迷霧中的阿爾泰飛鷹',
        paragraphs: [
          '在瀰漫的海面硝煙之上，蒙古傭兵「霧行者」烏音嘎正如幽靈般緊貼著水面無聲掠過。她操縱的滑翔機體將雷達反射面壓縮至極限，仿生鷹隼觀測鏡穿透了重裝護盾的間隙，精確捕捉到了協約指揮旗艦散熱護罩開合的微小週期。「坐標已同步進總譜網格。」她透過短波傳回一段冰冷的音頻，為蜂群標定出了直插心臟的最後航道。',
        ],
        camera: {
          landscape: { start: { scale: 1.20, x: 8, y: -6 }, mid: { scale: 1.12, x: 0, y: -6 }, end: { scale: 1.06, x: -8, y: -4 } },
          portrait:  { start: { scale: 1.25, x: 6, y: -10 }, mid: { scale: 1.15, x: 0, y: -6 }, end: { scale: 1.08, x: -4, y: -2 } },
        },
      },
      {
        id: 'ch6_swarm_07', side: 'SWARM',
        img: 'assets/story/story_ch6_swarm_07.png', fallbackImg: 'assets/story/story_ch6_swarm.png',
        tag: 'MIRROR // 同樣殘破的墓誌銘', badge: '第七節【轉】', title: '海潮兩端的共鳴',
        paragraphs: [
          '黑海的海浪沉重地拍打著堤岸。卡特琳娜隔著破碎的硝煙，凝視著那台在砲火中屹立的巨型鋼鐵機體。她比任何人都清楚對面那位老將軍的痛苦——一個為兒子復仇的父親，一個為弟弟守靈的姐姐，在同一個時代被同一種殘酷的武器剝奪了一切。他們隔著海灣對峙，如同照著一面被鮮血浸透的鏡子。他想用鋼鐵將世界包裹起來，她想用便宜的機器將特權擊得粉碎。兩條走投無路的信仰，終究要用最殘酷的方式為這個時代尋求一個解答。',
        ],
        camera: {
          landscape: { start: { scale: 1.16, x: -6, y: -6 }, mid: { scale: 1.10, x: 0, y: -6 }, end: { scale: 1.05, x: 6, y: -4 } },
          portrait:  { start: { scale: 1.22, x: -4, y: -10 }, mid: { scale: 1.14, x: 0, y: -8 }, end: { scale: 1.08, x: 0, y: -4 } },
        },
      },
      {
        id: 'ch6_swarm_08', side: 'SWARM',
        img: 'assets/story/story_ch6_swarm_08.png', fallbackImg: 'assets/story/story_ch6_swarm.png',
        tag: 'CLIMAX // 弱者的鋼鐵洪流', badge: '第八節【合】', title: '終樂章，沒有休止符',
        paragraphs: [
          '落日徹底沒入黑海，海面上升起第一道冷冽的月光。協約千門重砲齊射的火光將整片夜空照亮得如同白晝，砲彈的呼嘯聲撕裂了天際。卡特琳娜迎著鋪天蓋地的火雨，右臂如交響樂團指揮般悍然揮下。數萬架微型無人機的指示燈在要塞港上空同時點亮，如同一片由廉價零件鑄成的璀璨星海。「終樂章，起拍不留休止！」成群結隊的六旋翼發出震耳欲聾的尖嘯，以粉身碎骨的意志撲向協約的雪崩——這是屬於凡人與機器的鎮魂曲，向著命運，決死衝鋒。',
        ],
        camera: {
          landscape: { start: { scale: 1.06, x: 0, y: -6 }, mid: { scale: 1.14, x: 0, y: -4 }, end: { scale: 1.20, x: 0, y: 0 } },
          portrait:  { start: { scale: 1.08, x: 0, y: -10 }, mid: { scale: 1.18, x: 0, y: -6 }, end: { scale: 1.25, x: 0, y: -2 } },
        },
      },
    ],
  },
};
