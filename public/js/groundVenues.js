// Reference dimensions describe markings, not certified competition installations.
// A single uniform game scale applies to the pitch and its equipment.
const sport = (label, length, width, marking, regions, equipment = []) => ({
  label, length, width, marking, regions, category: 'sport', color: 0x63845b, equipment,
});
export const VENUES = {
  tennis: sport('網球', 23.77, 10.97, 'tennis', ['global'], [['tennisnet', 0, 0, 0]]),
  badminton: sport('羽球', 13.4, 6.1, 'badminton', ['global'], [['badmintonnet', 0, 0, 0]]),
  pickleball: sport('匹克球', 13.4112, 6.096, 'pickleball', ['North America'], [['picklenet', 0, 0, 0]]),
  volleyball: sport('排球', 18, 9, 'volleyball', ['global'], [['volleynet', 0, 0, 0]]),
  beachvolley: sport('沙灘排球', 16, 8, 'beach', ['coastal'], [['beachnet', 0, 0, 0]]),
  soccer: sport('足球', 105, 68, 'soccer', ['global']),
  futsal: sport('五人制足球', 40, 20, 'futsal', ['global']),
  handball: sport('手球', 40, 20, 'handball', ['Europe']),
  fieldhockey: sport('曲棍球', 91.4, 55, 'hockey', ['South Asia', 'Europe', 'Oceania']),
  rugby: sport('橄欖球', 120, 70, 'rugby', ['Oceania', 'Europe', 'Southern Africa']),
  americanfootball: sport('美式足球', 109.728, 48.768, 'football', ['North America']),
  netball: sport('籃網球', 30.5, 15.25, 'netball', ['Oceania', 'Commonwealth']),
  cricket: sport('板球', 120, 110, 'cricket', ['South Asia', 'Commonwealth']),
  baseball: sport('棒球', 110, 110, 'baseball', ['East Asia', 'Americas']),
  softball: sport('壘球', 75, 75, 'softball', ['global']),
  kabaddi: sport('卡巴迪', 13, 10, 'kabaddi', ['South Asia']),
  sepaktakraw: sport('藤球', 13.4, 6.1, 'takraw', ['Southeast Asia'], [['takrawnet', 0, 0, 0]]),
  petanque: sport('法式滾球', 15, 4, 'boules', ['France', 'Mediterranean']),
  bocce: sport('義式滾球', 26.5, 4, 'bocce', ['Italy']),
  gateball: sport('門球', 20, 15, 'gateball', ['Japan', 'East Asia']),
  sumo: sport('相撲土俵', 6.7, 6.7, 'sumo', ['Japan']),
  wrestling: sport('摔角墊', 12, 12, 'wrestling', ['global']),
  archery: sport('射箭練習場', 50, 20, 'archery', ['global']),
  longjump: sport('跳遠助跑與沙坑', 48, 8, 'longjump', ['global']),
  taiwanTemple: { label: '臺灣廟埕', length: 28, width: 22, marking: 'forecourt', regions: ['Taiwan'], category: 'culture', color: 0xb39378, equipment: [['incenseurn', .18, 0, 0], ['lantern', -.3, -.3, 0], ['lantern', -.3, .3, 0]] },
  japaneseGarden: { label: '日本枯山水庭園', length: 24, width: 16, marking: 'raked', regions: ['Japan'], category: 'culture', color: 0xc5c0ad, equipment: [['boulder', .16, .12, 0], ['rockflat', -.17, -.2, 0], ['stonelantern', .3, -.3, 0]] },
  chineseCourtyard: { label: '華人庭院', length: 26, width: 22, marking: 'courtyard', regions: ['East Asia'], category: 'culture', color: 0x96948a, equipment: [['planter', -.3, -.3, 0], ['planter', .3, .3, 0], ['bench', 0, .33, 0]] },
  mediterraneanPlaza: { label: '地中海噴泉廣場', length: 30, width: 24, marking: 'plaza', regions: ['Mediterranean'], category: 'culture', color: 0xc5b496, equipment: [['fountain', 0, 0, 0], ['bench', .3, .3, 0], ['planter', -.3, -.3, 0]] },
  northAfricanCourt: { label: '北非中庭', length: 24, width: 20, marking: 'courtyard', regions: ['North Africa'], category: 'culture', color: 0xc1a17c, equipment: [['fountain', 0, 0, 0], ['planter', -.3, .3, 0], ['planter', .3, -.3, 0]] },
  latinPlaza: { label: '拉丁美洲市集廣場', length: 30, width: 24, marking: 'market', regions: ['Latin America'], category: 'culture', color: 0xb98970, equipment: [['marketstall', -.28, -.28, 0], ['marketstall', .28, -.28, 0], ['bench', 0, .32, 0]] },
  southAsianMaidan: { label: '南亞公共活動空地', length: 38, width: 28, marking: 'commons', regions: ['South Asia'], category: 'culture', color: 0xb3a279, equipment: [['bench', -.3, -.32, 0], ['marketstall', .3, .3, 0]] },
  nordicSquare: { label: '北歐公共廣場', length: 28, width: 24, marking: 'plaza', regions: ['Northern Europe'], category: 'culture', color: 0x959b99, equipment: [['bench', -.3, .3, 0], ['planter', .3, -.3, 0], ['marketstall', .3, .3, 0]] },
};
for (const [id, goal] of Object.entries({soccer:'soccergoal', futsal:'smallgoal', handball:'smallgoal', fieldhockey:'hockeygoal', rugby:'rugbypost', americanfootball:'footballpost', netball:'netballpost'})) {
  const u = id === 'rugby' ? .4 * (VENUES[id].length - 20) / VENUES[id].length : .4;
  VENUES[id].equipment.push([goal, -u, 0, Math.PI / 2], [goal, u, 0, -Math.PI / 2]);
}
VENUES.cricket.equipment.push(['wicket', -20.12 / 120 * .4, 0, Math.PI / 2], ['wicket', 20.12 / 120 * .4, 0, Math.PI / 2]);
VENUES.gateball.equipment.push(['gate', -.25, -.2, 0], ['gate', 0, .2, Math.PI / 2], ['gate', .25, -.2, 0]);
for (const z of [-.25, 0, .25]) VENUES.archery.equipment.push(['target', .35, z, Math.PI / 2]);
for (const id of ['beachvolley', 'petanque', 'bocce', 'sumo', 'longjump']) VENUES[id].color = 0xc3aa7b;
for (const id of ['tennis', 'pickleball', 'netball']) VENUES[id].color = 0x547e99;
for (const id of ['volleyball', 'handball', 'wrestling', 'kabaddi']) VENUES[id].color = 0xb58263;
export const TRACK = { straight: 84.39, radius: 36.5, lane: 1.22, lanes: 8, margin: 12, lineWidth: .45 };
export const TRACK_WIDTH = TRACK.straight + 2 * (TRACK.radius + TRACK.lanes * TRACK.lane + TRACK.margin);
export const TRACK_DEPTH = 2 * (TRACK.radius + TRACK.lanes * TRACK.lane + TRACK.margin);
