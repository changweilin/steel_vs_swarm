export const MAP_SELECT_TEXT = {
  idle: '選一個場地，或在地圖上設定搜尋中心，自動尋找附近的兩座主堡與三條兵線。',
  center: '◎ 搜尋中心',
  setup: '預設場地，或設定搜尋中心，自動尋找附近符合兩主堡與三兵線的地圖',
  rules: '規則:兩主堡距離 ≥ 地圖對角線 80% ・ 兵線任兩條重合 ≤ 20% ・ 綠地／裸露地預設可一實兩生成 ・ 兵線寬容 4 台機甲並行',
  swarmBase: '◆ 蜂群主堡',
  steelBase: '◆ 鋼鐵主堡',
  lanes: ['上路', '中路', '下路'],
  noMatch: '此區域找不到符合兩座主堡與三條兵線條件的地圖，請換個搜尋中心。',
  failed: '地圖搜尋失敗，請重新選點。',
  verifying: '讀取真實道路來源證據…',
  missingSources: '道路來源資料不足，無法驗證三條真實兵線。可稍後重試或改用隨機模式。',
  missingElevation: '高程資料不足，無法驗證道路坡度。可稍後重試或改用隨機模式。',
  offlineUnavailable: '道路服務無法使用，真實模式不補造兵線。可稍後重試或改用隨機模式。',
  ranked: '附近地圖，依吻合程度排列',
  nextButton: '⟳ 下一個地圖',
  offline: '離線模擬',
  partial: '含模擬兵線',
  real: '真實道路',
  scanning: (done, total, found) => `搜尋附近地圖 ${done}/${total}，已找到 ${found} 組符合條件的地圖…`,
  candidate: (rank, score, distance, source) => `第 ${rank} 名 · 吻合 ${score.toFixed(1)}% · 距選點 ${Math.round(distance)} m · ${source}`,
  next: (rank, count) => `⟳ 下一個地圖 ${rank}/${count}`,
  summary: (rank, count, score, distance, cfg, source) =>
    `已選定第 ${rank}/${count} 名 · 吻合 ${score.toFixed(1)}% · 距選點 ${Math.round(distance)} m`
    + ` · 兩堡 ${(cfg.distM / 1000).toFixed(2)} km · ${cfg.laneCount} 條兵線`
    + ` · 最大重合 ${(cfg.maxOverlap * 100).toFixed(0)}% · ${source}`,
};

export const mapCandidateSource = candidate => candidate.offline
  ? MAP_SELECT_TEXT.offline : candidate.synthetic ? MAP_SELECT_TEXT.partial : MAP_SELECT_TEXT.real;

export const mapCandidateLabel = (candidate, index) => MAP_SELECT_TEXT.candidate(
  index + 1, candidate.match.score * 100, candidate.match.distanceM, mapCandidateSource(candidate),
);
