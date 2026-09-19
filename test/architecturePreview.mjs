// 本機視覺驗收：僅測試伺服器，正式遊戲不包含此路由。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../public/js/', import.meta.url));
const page = `<!doctype html><meta charset="utf-8"><title>建模隨機生成器 · 建築 / 地質 / 植物立體視覺工作室</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: #cdd9e2; color: #273649; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; user-select: none; }

  /* 頂部全寬頁籤導航列 */
  .top-nav-bar {
    position: fixed; top: 0; left: 0; right: 0; height: 50px; z-index: 50;
    display: flex; align-items: center; justify-content: space-between; padding: 0 20px;
    background: rgba(15, 23, 42, 0.94); backdrop-filter: blur(14px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    color: #f8fafc;
  }
  .nav-brand { display: flex; align-items: center; gap: 8px; }
  .brand-title { font-size: 15px; font-weight: 800; color: #f8fafc; letter-spacing: 0.5px; }
  .brand-tag { font-size: 10px; background: rgba(59, 130, 246, 0.25); border: 1px solid rgba(96, 165, 250, 0.4); color: #93c5fd; padding: 2px 7px; border-radius: 4px; font-weight: 600; }
  .cat-tabs-row { display: flex; gap: 8px; align-items: center; }
  .cat-tab-btn {
    background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(148, 163, 184, 0.3); color: #94a3b8;
    font-weight: 700; font-size: 13px; padding: 7px 18px; border-radius: 8px; cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); display: inline-flex; align-items: center; gap: 8px;
  }
  .cat-tab-btn:hover { background: rgba(51, 65, 85, 0.95); color: #f8fafc; border-color: rgba(148, 163, 184, 0.5); transform: translateY(-1px); }
  .cat-tab-btn.active {
    background: linear-gradient(135deg, #2563eb, #1d4ed8); border-color: #3b82f6; color: #ffffff;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45);
  }
  .btn-nav-action {
    background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18);
    color: #cbd5e1; font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 6px; cursor: pointer;
    transition: all 0.15s;
  }
  .btn-nav-action:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
  /* 頂部環境模擬控制列 */
  .env-sim-bar {
    display: flex; align-items: center; gap: 8px; background: rgba(15, 23, 42, 0.7);
    padding: 3px 10px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.14);
  }
  .env-sim-group { display: flex; align-items: center; gap: 4px; }
  .env-sim-label { font-size: 11px; font-weight: 700; color: #94a3b8; }
  .env-sim-select {
    background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc;
    padding: 2px 6px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer; outline: none;
  }
  .env-time-btns { display: flex; gap: 2px; }
  .env-time-btn {
    background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(148, 163, 184, 0.3);
    color: #cbd5e1; font-size: 11px; padding: 2px 5px; border-radius: 4px; cursor: pointer;
  }
  .env-time-btn.active {
    background: #2563eb; border-color: #60a5fa; color: #fff;
  }
  .env-hour-slider { width: 55px; height: 4px; accent-color: #3b82f6; cursor: pointer; }
  .env-hour-text { font-size: 11px; font-weight: 700; color: #38bdf8; min-width: 32px; font-variant-numeric: tabular-nums; }
  .btn-sim-play {
    background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399;
    font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 5px; cursor: pointer; transition: all 0.15s;
  }
  .btn-sim-play:hover { background: rgba(16, 185, 129, 0.35); }
  .btn-sim-play.playing {
    background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171;
  }
  .btn-sim-play.playing:hover { background: rgba(239, 68, 68, 0.35); }


  header {
    position: absolute; top: 62px; left: 20px; z-index: 20;
    background: rgba(255, 255, 255, 0.96); padding: 14px 18px; border-radius: 12px;
    box-shadow: 0 6px 24px rgba(15, 23, 42, 0.16); backdrop-filter: blur(10px);
    max-width: 680px; max-height: calc(100vh - 80px); overflow-y: auto;
  }
  header::-webkit-scrollbar { width: 6px; }
  header::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
  header::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
  .cat-title { font-size: 15px; margin: 0 0 2px; color: #0f172a; font-weight: 700; }
  .cat-desc { font-size: 11px; color: #64748b; margin-bottom: 8px; line-height: 1.4; }
  
  .dim-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
  .dim-title { font-size: 11px; font-weight: 700; color: #334155; text-transform: uppercase; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
  .dim-title .badge { font-size: 11px; color: #2563eb; font-weight: 600; text-transform: none; }
  .dim-options { display: flex; flex-wrap: wrap; gap: 8px; }
  .dim-cb-label { display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; color: #334155; cursor: pointer; transition: all 0.15s; }
  .dim-cb-label:hover { border-color: #94a3b8; background: #f1f5f9; }
  .dim-cb-label.checked { background: #eff6ff; border-color: #3b82f6; color: #1d4ed8; font-weight: 600; box-shadow: 0 1px 3px rgba(59, 130, 246, 0.2); }
  .dim-cb-label input { margin: 0; accent-color: #2563eb; cursor: pointer; }

  .action-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .btn-generate { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border: none; padding: 7px 18px; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.2s; box-shadow: 0 3px 10px rgba(37, 99, 235, 0.35); display: inline-flex; align-items: center; gap: 6px; }
  .btn-generate:hover { background: linear-gradient(135deg, #1d4ed8, #1e40af); box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45); transform: translateY(-1px); }
  .btn-generate:active { transform: translateY(0); }
  .btn-generate.btn-variant { background: linear-gradient(135deg, #059669, #047857); box-shadow: 0 3px 10px rgba(5, 150, 105, 0.35); }
  .btn-generate.btn-variant:hover { background: linear-gradient(135deg, #047857, #065f46); }
  .btn-randomize { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 6px 13px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; transition: all 0.15s; }
  .btn-randomize:hover { background: #e2e8f0; border-color: #94a3b8; }
  .btn-filter { background: #f8fafc; color: #1e293b; border: 1px solid #cbd5e1; padding: 6px 13px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; transition: all 0.15s; }
  .btn-filter:hover { background: #f1f5f9; border-color: #94a3b8; }
  .btn-full-random { background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: 0 3px 10px rgba(139, 92, 246, 0.35); transition: all 0.2s; }
  .btn-full-random:hover { background: linear-gradient(135deg, #7c3aed, #5b21b6); transform: translateY(-1px); }

  .sample-control { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #334155; font-weight: 600; background: #fff; padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; }
  .sample-label { color: #1e293b; font-weight: 700; }
  .sample-input-wrap { display: inline-flex; align-items: center; gap: 3px; font-weight: 500; color: #475569; }
  .sample-input-wrap input { width: 38px; padding: 2px 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 700; color: #2563eb; text-align: center; }
  .sample-all-wrap { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: #64748b; margin-left: 4px; cursor: pointer; }
  .sample-all-wrap input { accent-color: #2563eb; cursor: pointer; margin: 0; }
  .seed-control { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #475569; font-weight: 600; background: #fff; padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; }
  .seed-control input { width: 65px; padding: 2px 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; font-weight: 600; color: #1e293b; text-align: center; }
  .seed-mode-control { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #334155; font-weight: 600; background: #fff; padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; }
  .seed-mode-select { padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; font-weight: 600; color: #1d4ed8; background: #f8fafc; cursor: pointer; outline: none; }

  .nav-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
  .nav-status { font-size: 12px; color: #1e293b; font-weight: 600; }
  .btn-back { display: none; background: #dc2626; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 6px rgba(220, 38, 38, 0.3); }
  .btn-back:hover { background: #b91c1c; }
  .toggles { display: flex; gap: 12px; font-size: 11px; color: #475569; align-items: center; }
  .toggles label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }

  .hint { position: absolute; bottom: 16px; left: 20px; z-index: 20; background: rgba(15, 23, 42, 0.78); color: #f8fafc; padding: 7px 14px; border-radius: 8px; font-size: 12px; backdrop-filter: blur(4px); pointer-events: none; line-height: 1.5; }
  .hint kbd { background: rgba(255, 255, 255, 0.22); padding: 1px 5px; border-radius: 4px; font-size: 11px; }

  #labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .badge-label { position: absolute; font-weight: 600; font-size: 11px; background: rgba(255, 255, 255, 0.94); color: #1e293b; padding: 3px 8px; border-radius: 5px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12); border-left: 3px solid #2563eb; white-space: nowrap; transform: translate(-50%, -100%); margin-top: -6px; pointer-events: none; transition: opacity 0.15s; }
  .badge-label .cat { color: #2563eb; font-weight: 700; margin-right: 3px; }
  .badge-label .height { color: #059669; font-weight: 700; margin-left: 3px; }

  /* 懸停詳細檢驗面板 */
  .inspector-card { position: absolute; z-index: 40; width: 340px; background: rgba(15, 23, 42, 0.92); color: #e2e8f0; padding: 14px 16px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); border: 1px solid rgba(59, 130, 246, 0.4); backdrop-filter: blur(10px); pointer-events: none; transition: opacity 0.1s ease, transform 0.1s ease; font-size: 12px; line-height: 1.4; }
  .inspector-card h3 { margin: 0 0 6px; font-size: 15px; color: #60a5fa; display: flex; align-items: center; justify-content: space-between; }
  .inspector-card .sub { font-size: 11px; color: #94a3b8; margin-bottom: 10px; }
  .prop-group { border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 6px; margin-top: 6px; }
  .prop-title { font-size: 10px; font-weight: 700; color: #38bdf8; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; }
  .prop-row { display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 11px; }
  .prop-row .k { color: #94a3b8; }
  .prop-row .v { color: #f1f5f9; font-weight: 600; text-align: right; }
  .color-bar { display: flex; gap: 8px; margin-top: 4px; }
  .color-chip { flex: 1; display: flex; align-items: center; gap: 4px; font-size: 10px; color: #cbd5e1; }
  .color-chip .dot { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.4); display: inline-block; }
  .parts-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .part-pill { background: rgba(37, 99, 235, 0.25); border: 1px solid rgba(96, 165, 250, 0.4); color: #bfdbfe; font-size: 10px; padding: 2px 6px; border-radius: 4px; }
  .inspector-hint { margin-top: 8px; font-size: 10px; color: #f59e0b; background: rgba(245, 158, 11, 0.12); padding: 4px 8px; border-radius: 4px; text-align: center; }

  /* 類別篩選模態視窗 */
  .filter-modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(6px); z-index: 100; display: none; align-items: center; justify-content: center; padding: 20px; }
  .filter-modal-card { background: #ffffff; width: 100%; max-width: 1060px; max-height: 88vh; border-radius: 14px; box-shadow: 0 24px 50px rgba(0, 0, 0, 0.35); display: flex; flex-direction: column; overflow: hidden; }
  .filter-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  .filter-modal-title { font-size: 15px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; }
  .filter-modal-desc { font-size: 11px; color: #64748b; margin-top: 2px; }
  .btn-close-modal { background: #e2e8f0; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; color: #334155; }
  .btn-close-modal:hover { background: #cbd5e1; }
  .filter-modal-body { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .filter-modal-grid { display: grid; grid-template-columns: repeat(5, minmax(170px, 1fr)); gap: 12px; }
  .filter-cat-col { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .filter-cat-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .filter-cat-name { font-size: 12px; font-weight: 700; color: #1e293b; }
  .filter-cat-actions { display: flex; gap: 4px; }
  .btn-cat-act { font-size: 10px; padding: 1px 6px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; color: #2563eb; cursor: pointer; }
  .btn-cat-act:hover { background: #eff6ff; }
  .filter-cat-list { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; padding-right: 4px; }
  .filter-item-cb { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #334155; cursor: pointer; padding: 2px 4px; border-radius: 4px; user-select: none; }
  .filter-item-cb:hover { background: #e2e8f0; }
  .filter-item-cb.selected { color: #1d4ed8; font-weight: 600; }
  .filter-item-cb input { accent-color: #2563eb; cursor: pointer; margin: 0; }
  .filter-modal-footer { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
  .filter-stat-text { font-size: 12px; color: #475569; font-weight: 600; }

  canvas { display: block; width: 100vw; height: 100vh; cursor: grab; }
  canvas:active { cursor: grabbing; }
</style>
<nav class="top-nav-bar">
  <div class="nav-brand">
    <span class="brand-title">🏛 建模隨機生成器</span>
    <span class="brand-tag">Procedural Studio</span>
  </div>
  <div class="cat-tabs-row">
    <button id="tab-btn-arch" class="cat-tab-btn active" type="button" data-tab="arch">🏛 建築</button>
    <button id="tab-btn-geology" class="cat-tab-btn" type="button" data-tab="geology">🪨 地質</button>
    <button id="tab-btn-plant" class="cat-tab-btn" type="button" data-tab="plant">🌲 植物</button>
    <button id="tab-btn-vehicle" class="cat-tab-btn" type="button" data-tab="vehicle">🚗 車輛</button>
    <button id="tab-btn-vessel" class="cat-tab-btn" type="button" data-tab="vessel">🚢 船隻</button>
    <button id="tab-btn-industry" class="cat-tab-btn" type="button" data-tab="industry">🏭 產業設施</button>
    <button id="tab-btn-ice" class="cat-tab-btn" type="button" data-tab="ice">❄️ 冰雪</button>
    <button id="tab-btn-infrastructure" class="cat-tab-btn" type="button" data-tab="infrastructure">⚙️ 能源與工程</button>
    <button id="tab-btn-env" class="cat-tab-btn" type="button" data-tab="env">🌐 邊界構造</button>
  </div>
  <div class="env-sim-bar">
    <div class="env-sim-group">
      <label class="env-sim-label" title="四季色溫與植被物候">季節</label>
      <select id="sim-season" class="env-sim-select">
        <option value="spring">🌸 春</option>
        <option value="summer" selected>☀️ 夏</option>
        <option value="autumn">🍁 秋</option>
        <option value="winter">❄️ 冬</option>
      </select>
    </div>
    <div class="env-sim-group">
      <label class="env-sim-label" title="時段與太陽天球軌道">時段</label>
      <div class="env-time-btns">
        <button class="env-time-btn" type="button" data-time="dawn" title="清晨 06:00">🌅</button>
        <button class="env-time-btn active" type="button" data-time="day" title="白天 12:00">☀️</button>
        <button class="env-time-btn" type="button" data-time="dusk" title="黃昏 18:00">🌇</button>
        <button class="env-time-btn" type="button" data-time="night" title="夜晚 00:00">🌙</button>
      </div>
      <input id="sim-hour" type="range" min="0" max="24" step="0.25" value="12" class="env-hour-slider" title="連續小時調節">
      <span id="sim-hour-val" class="env-hour-text">12:00</span>
    </div>
    <div class="env-sim-group">
      <label class="env-sim-label" title="多元天氣預設">天氣</label>
      <select id="sim-weather" class="env-sim-select">
        <option value="clear" selected>☀️ 晴朗</option>
        <option value="cloudy">☁️ 陰天</option>
        <option value="heavy_rain">🌧️ 大雨</option>
        <option value="storm">⚡ 暴風雨</option>
        <option value="windy">💨 強風</option>
        <option value="sandstorm">🏜️ 沙暴</option>
        <option value="fog">🌫️ 濃霧</option>
        <option value="snow">❄️ 降雪</option>
      </select>
    </div>
    <div class="env-sim-group">
      <button id="btn-sim-toggle" class="btn-sim-play" type="button" title="開啟/暫停時間流逝與天氣演化">▶ 模擬</button>
      <select id="sim-speed" class="env-sim-select" title="模擬演化倍率" style="width: 48px;">
        <option value="1">1×</option>
        <option value="5" selected>5×</option>
        <option value="20">20×</option>
      </select>
    </div>
  </div>
  <div class="nav-extra">
    <button id="btn-nav-reset-cam" class="btn-nav-action" type="button" title="重設視角">🎥 視角</button>
  </div>
</nav>

<header>
  <div class="header-info-row">
    <h2 id="cat-title" class="cat-title">🏛 建築分類與隨機參數展開</h2>
    <div id="cat-desc" class="cat-desc">多維度文化與功能陣列 · 點擊展開 16 組隨機變體 · 懸停數值檢驗</div>
  </div>

  <!-- 建築類別控制面板 -->
  <div id="panel-arch" class="cat-panel">
    <div class="dim-panel">
      <div class="dim-title">
        <span>建築分類維度（最多任選兩個）</span>
        <span class="badge" id="dim-count-badge">已選 2 / 2 維度</span>
      </div>
      <div class="dim-options" id="dim-options">
        <label class="dim-cb-label checked"><input type="checkbox" value="func" checked> 地點與功能 (13)</label>
        <label class="dim-cb-label checked"><input type="checkbox" value="style" checked> 文化建築風格 (21)</label>
        <label class="dim-cb-label"><input type="checkbox" value="roof"> 屋頂立體造型 (12)</label>
        <label class="dim-cb-label"><input type="checkbox" value="facade"> 牆面立面材質 (7)</label>
        <label class="dim-cb-label"><input type="checkbox" value="region"> 世界文化大區 (7)</label>
      </div>
      <div class="action-row">
        <button id="btn-generate" class="btn-generate">⚡ 生成建築陣列</button>
        <button id="btn-randomize" class="btn-randomize">🎲 隨機種子生成</button>
        <button id="btn-open-filter" class="btn-filter">⚙ 類別篩選設定</button>
        <button id="btn-full-random" class="btn-full-random">🎲 全類別隨機混搭</button>
        <div class="sample-control">
          <span class="sample-label">取樣規模:</span>
          <label class="sample-input-wrap">X欄 <input type="number" id="sample-dim-a" value="5" min="1" max="30"></label>
          <span>×</span>
          <label class="sample-input-wrap">Y列 <input type="number" id="sample-dim-b" value="5" min="1" max="30"></label>
          <label class="sample-all-wrap"><input type="checkbox" id="chk-sample-all"> 全量不取樣</label>
        </div>
        <div class="seed-control">
          <label for="input-seed">種子碼</label>
          <input type="number" id="input-seed" value="5000" min="1" max="999999">
        </div>
        <div class="seed-mode-control">
          <span class="sample-label">生成種子規則:</span>
          <select id="select-seed-mode" class="seed-mode-select">
            <option value="fixed">固定種子</option>
            <option value="shared_batch">陣列種子</option>
            <option value="per_building" selected>獨立種子</option>
          </select>
        </div>
        <button id="btn-regen-variants" class="btn-generate btn-variant" style="display: none;">🎲 重新隨機生成 16 組變體</button>
      </div>
    </div>
  </div>

  <!-- 地質類別控制面板 -->
  <div id="panel-geology" class="cat-panel" style="display: none;">
    <div class="dim-panel">
      <div class="dim-title">
        <span>地質結構類型與成因</span>
        <span class="badge" id="geo-info-badge">自然地質 / 不穩定 / 特殊現象 / 古蹟石材</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">結構類型</label>
          <select id="geo-type" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="all" selected>全部類型輪播 (All Types)</option>
            <option value="auto">依環境加權抽樣</option>
            <optgroup label="自然地質">
              <option value="granite">花崗岩塊 (Granite)</option>
              <option value="mountain">褶皺山巒 (Mountain)</option>
              <option value="mound">土堆／崩積丘 (Mound)</option>
              <option value="dune">風成沙丘 (Sand Dune)</option>
              <option value="sandstone">層狀砂岩台地 (Sandstone)</option>
              <option value="cliff">斷層峭壁 (Cliff)</option>
              <option value="karst">石灰岩溶蝕峰 (Karst)</option>
              <option value="basalt">玄武岩柱狀節理 (Basalt)</option>
              <option value="crater">火山口 (Crater)</option>
              <option value="reef">淺海珊瑚礁 (Coral Reef)</option>
              <option value="island">海蝕島礁 (Island)</option>
              <option value="river">河床沖積灘 (Riverbed)</option>
              <option value="moraine">冰磧碎石丘 (Moraine)</option>
            </optgroup>
            <optgroup label="不穩定地質">
              <option value="debris_flow">土石流 (Debris Flow)</option>
              <option value="landslide">山體滑坡 (Landslide)</option>
              <option value="landslide_lake">堰塞湖 (Landslide Lake)</option>
              <option value="slope_creep">邊坡潛移 (Slope Creep)</option>
              <option value="badlands">惡地侵蝕 (Badlands)</option>
            </optgroup>
            <optgroup label="特殊現象與地熱">
              <option value="hot_spring">溫泉熱泉 (Hot Spring)</option>
              <option value="mud_volcano">泥火山 (Mud Volcano)</option>
              <option value="geyser">間歇泉 (Geyser)</option>
              <option value="eruption">火山口噴發 (Eruption)</option>
              <option value="fountain">噴泉噴流 (Fountain)</option>
              <option value="geothermal">地熱孔 (Geothermal)</option>
              <option value="impact_crater">隕石撞擊坑 (Impact Crater)</option>
            </optgroup>
            <optgroup label="人造石材 / 歷史古蹟">
              <option value="monument">地區古蹟 (Monument)</option>
              <option value="ruins">廢棄歷史遺跡 (Ancient Ruins)</option>
            </optgroup>
            <optgroup label="場景獨立物件">
              <option value="boulder">巨石巨礫 (Boulder · 場景)</option>
            </optgroup>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="geo-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="array" selected>陣列規模檢驗 (Array X×Y)</option>
            <option value="single">單體細節檢驗 (Single Object)</option>
            <option value="matrix">全類型目錄陳列 (All Catalog)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">排列方式</label>
          <select id="layout-geo" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="scene" selected>場景散布 (Scene Scatter)</option>
            <option value="boundary">邊界沿邊排列＋緩衝區＋透明牆 (Boundary Run)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">氣候環境</label>
          <select id="geo-climate" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="all" selected>全部氣候輪播 (All Climates)</option>
            <option value="temperate">溫帶 (Temperate)</option>
            <option value="tropical">熱帶 (Tropical)</option>
            <option value="arid">乾旱 (Arid)</option>
            <option value="alpine">高山 (Alpine)</option>
            <option value="boreal">寒帶 (Boreal)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">水域類型</label>
          <select id="geo-water" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="all" selected>全部水域輪播 (All Waters)</option>
            <option value="none">陸地 (None)</option>
            <option value="stream">溪流 (Stream)</option>
            <option value="river">河流 (River)</option>
            <option value="lake">湖泊 (Lake)</option>
            <option value="sea">海岸 (Sea)</option>
          </select>
        </div>
      </div>
      <div id="geo-ancient-box" style="display:none; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; margin-bottom: 8px;">
        <div style="display:flex; gap: 10px; align-items:center; flex-wrap:wrap; font-size: 11px; font-weight: 600;">
          <span>古蹟與人造石設定：</span>
          <label>地區 <select id="geo-region" style="padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; font-size:11px;">
            <option value="all" selected>全部地區輪播</option>
            <option value="egypt">埃及 (Egypt)</option>
            <option value="greece_rome">希臘羅馬 (Greece/Rome)</option>
            <option value="maya">瑪雅 (Maya)</option>
            <option value="easter_island">復活節島 (Easter Island)</option>
            <option value="mesopotamia">美索不達米亞 (Mesopotamia)</option>
            <option value="east_asia">東亞 (East Asia)</option>
            <option value="uk_prehistoric">英國史前 (UK Prehistoric)</option>
          </select></label>
          <label>遺跡形式 <select id="geo-ruin-type" style="padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; font-size:11px;">
            <option value="all" selected>全部形式輪播 (All Forms)</option>
            <option value="auto">隨機形式 (Random)</option>
            <option value="temple">神廟 (Temple)</option>
            <option value="stronghold">要塞 (Stronghold)</option>
            <option value="settlement">聚落 (Settlement)</option>
            <option value="aqueduct">引水道 (Aqueduct)</option>
          </select></label>
          <label>等比例倍率 <input type="number" id="geo-scale" value="1.0" min="0.1" max="10" step="0.1" style="width:48px; padding:2px; border:1px solid #cbd5e1; border-radius:4px; text-align:center; font-weight:700;"></label>
        </div>
      </div>
      <details style="margin-bottom:8px; font-size: 11px; color:#475569;">
        <summary style="cursor:pointer; font-weight:600; color:#2563eb;">▸ 展開進階環境滑桿 (植被 / 侵蝕 / 地熱 / 坡度 / 斷層)</summary>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px; margin-top: 6px; background:#fff; padding:8px; border-radius:6px; border:1px solid #e2e8f0;">
          <label>濕度 <input type="range" id="geo-moisture" min="0" max="1" step="0.05" value="0.65"></label>
          <label>植被覆蓋 <input type="range" id="geo-vegetation" min="0" max="1" step="0.05" value="0.6"></label>
          <label>針葉林比 <input type="range" id="geo-conifers" min="0" max="1" step="0.05" value="0.3"></label>
          <label>表面侵蝕 <input type="range" id="geo-exposure" min="0" max="1" step="0.05" value="0.5"></label>
          <label>坡度 ° <input type="range" id="geo-slope" min="0" max="90" step="1" value="35"></label>
          <label>斷層作用 <input type="range" id="geo-fault" min="0" max="1" step="0.05" value="0.2"></label>
          <label>火山作用 <input type="range" id="geo-volcanic" min="0" max="1" step="0.05" value="0.2"></label>
          <label>溶蝕程度 <input type="range" id="geo-dissolution" min="0" max="1" step="0.05" value="0.6"></label>
          <label>地熱作用 <input type="range" id="geo-geothermal" min="0" max="1" step="0.05" value="0.5"></label>
          <label>活動強度 <input type="range" id="geo-activity" min="0" max="1" step="0.05" value="0.7"></label>
        </div>
      </details>
      <div class="action-row">
        <button id="btn-geo-generate" class="btn-generate">⚡ 生成地質陣列</button>
        <button id="btn-geo-random-seed" class="btn-randomize">🎲 隨機種子生成</button>
        <div class="sample-control">
          <span class="sample-label">取樣規模:</span>
          <label class="sample-input-wrap">X欄 <input type="number" id="sample-cols-geo" value="4" min="1" max="20"></label>
          <span>×</span>
          <label class="sample-input-wrap">Y列 <input type="number" id="sample-rows-geo" value="4" min="1" max="20"></label>
        </div>
        <div class="seed-control">
          <label for="input-geo-seed">種子碼</label>
          <input type="number" id="input-geo-seed" value="42" min="1" max="999999">
        </div>
        <div class="seed-mode-control">
          <span class="sample-label">生成種子規則:</span>
          <select id="select-seed-mode-geo" class="seed-mode-select">
            <option value="fixed">固定種子</option>
            <option value="shared_batch">陣列種子</option>
            <option value="per_building" selected>獨立種子</option>
          </select>
        </div>
      </div>
    </div>
  </div>


  <!-- 車輛類別控制面板 -->
  <div id="panel-vehicle" class="cat-panel" style="display: none;">
    <div class="dim-panel">
      <div class="dim-title">
        <span>車輛分類結構與編組</span>
        <span class="badge" id="veh-info-badge">真實米制 · 模組化底盤 · 聯結車與列車編組</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示型態</label>
          <select id="veh-formation" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="all">全部型態輪播 (All Formations)</option>
            <option value="single" selected>單車／車廂</option>
            <option value="rail">整列貨運列車</option>
            <option value="semi">完整聯結車</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">用途領域</label>
          <select id="veh-purpose" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="">全部用途</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">結構體系</label>
          <select id="veh-type" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="">全部結構</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">動力單元</label>
          <select id="veh-power" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="">全部動力</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">車輛原型</label>
          <select id="veh-profile" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="veh-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="array" selected>陣列規模檢驗 (Array X×Y)</option>
            <option value="single">單車細節檢驗 (Single Vehicle)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">排列方式</label>
          <select id="layout-veh" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="scene" selected>場景散布 (Scene Scatter)</option>
            <option value="boundary">邊界沿邊排列＋緩衝區＋透明牆 (Boundary Run)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">場景散布尺寸</label>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:6px 0; cursor:pointer;">
            <input type="checkbox" id="chk-veh-scene-fit" style="accent-color:#2563eb;"> 套用場景汽車包絡 4.8×1.8×2.2m
          </label>
        </div>
      </div>
      <div id="veh-coupling-box" style="display:none; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; margin-bottom: 8px;">
        <div style="display:flex; gap: 10px; align-items:center; flex-wrap:wrap; font-size: 11px; font-weight: 600;">
          <span>編組接合設定：</span>
          <label>牽引車 <select id="veh-leader" style="padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; font-size:11px;"></select></label>
          <label>車廂 <select id="veh-wagon" style="padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; font-size:11px;"></select></label>
          <label>節數 <input type="number" id="veh-count" min="2" max="6" value="3" style="width:44px; padding:2px; border:1px solid #cbd5e1; border-radius:4px; text-align:center; font-weight:700;"></label>
        </div>
      </div>
      <div class="action-row">
        <button id="btn-veh-generate" class="btn-generate">⚡ 生成車輛陣列</button>
        <button id="btn-veh-random-seed" class="btn-randomize">🎲 隨機種子生成</button>
        <div class="sample-control">
          <span class="sample-label">取樣規模:</span>
          <label class="sample-input-wrap">X欄 <input type="number" id="sample-cols-veh" value="4" min="1" max="20"></label>
          <span>×</span>
          <label class="sample-input-wrap">Y列 <input type="number" id="sample-rows-veh" value="4" min="1" max="20"></label>
        </div>
        <div class="seed-control">
          <label for="input-veh-seed">種子碼</label>
          <input type="number" id="input-veh-seed" value="42" min="1" max="999999">
        </div>
        <div class="seed-mode-control">
          <span class="sample-label">生成種子規則:</span>
          <select id="select-seed-mode-veh" class="seed-mode-select">
            <option value="fixed">固定種子</option>
            <option value="shared_batch">陣列種子</option>
            <option value="per_building" selected>獨立種子</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- 船隻類別控制面板 -->
  <div id="panel-vessel" class="cat-panel" style="display: none;">
    <div class="dim-panel">
      <div class="dim-title">
        <span>船隻艦艇與水運載具</span>
        <span class="badge" id="vessel-info-badge">真實米制 · 動態吃水 · 裝載與武器系統</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">船型分類</label>
          <select id="vessel-type" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="all" selected>全部船型輪播 (All Vessels)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">用途任務</label>
          <select id="vessel-purpose" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="">全部用途</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">航行水域</label>
          <select id="vessel-water" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="">全部水域</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">動力系統</label>
          <select id="vessel-power" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="">全部動力</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="vessel-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="array" selected>陣列規模檢驗 (Array X×Y)</option>
            <option value="single">單艦細節檢驗 (Single Vessel)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">排列方式</label>
          <select id="layout-vessel" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="scene" selected>場景散布 (Scene Scatter)</option>
            <option value="boundary">邊界沿邊排列＋緩衝區＋透明牆 (Boundary Run)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">水面環境</label>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:6px 0; cursor:pointer;">
            <input type="checkbox" id="chk-vessel-water" checked style="accent-color:#2563eb;"> 顯示透光水面
          </label>
        </div>
      </div>
      <div class="action-row">
        <button id="btn-vessel-generate" class="btn-generate">⚡ 生成船隻陣列</button>
        <button id="btn-vessel-random-seed" class="btn-randomize">🎲 隨機種子生成</button>
        <div class="sample-control">
          <span class="sample-label">取樣規模:</span>
          <label class="sample-input-wrap">X欄 <input type="number" id="sample-cols-vessel" value="4" min="1" max="20"></label>
          <span>×</span>
          <label class="sample-input-wrap">Y列 <input type="number" id="sample-rows-vessel" value="4" min="1" max="20"></label>
        </div>
        <div class="seed-control">
          <label for="input-vessel-seed">種子碼</label>
          <input type="number" id="input-vessel-seed" value="42" min="1" max="999999">
        </div>
        <div class="seed-mode-control">
          <span class="sample-label">生成種子規則:</span>
          <select id="select-seed-mode-vessel" class="seed-mode-select">
            <option value="fixed">固定種子</option>
            <option value="shared_batch">陣列種子</option>
            <option value="per_building" selected>獨立種子</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- 產業設施控制面板 -->
  <div id="panel-industry" class="cat-panel" style="display: none;">
    <div class="dim-panel">
      <div class="dim-title">
        <span>場景建物與產業設施簡模</span>
        <span class="badge" id="industry-info-badge">住宅 1 · 高樓 2 · 工業 3 · 採掘 2 · 農牧 2</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">設施款式</label>
          <select id="industry-kind" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="all" selected>全部款式輪播 (All Kinds)</option>
            <optgroup label="住宅 / 高樓">
              <option value="house">住家 (House)</option>
              <option value="skyscraper">摩天樓 (Skyscraper)</option>
              <option value="skyfall">倒塌高樓 (Fallen Tower)</option>
            </optgroup>
            <optgroup label="工業設施">
              <option value="factory">工廠 (Factory)</option>
              <option value="powerplant">電廠 (Power Plant)</option>
              <option value="incinerator">焚化廠 (Incinerator)</option>
            </optgroup>
            <optgroup label="採掘設施">
              <option value="mine">礦場 (Mine)</option>
              <option value="oilfield">油田 (Oilfield)</option>
            </optgroup>
            <optgroup label="農牧設施">
              <option value="greenhouse">溫室 (Greenhouse)</option>
              <option value="ranch">牧場 (Ranch)</option>
            </optgroup>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="industry-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="array" selected>陣列規模檢驗 (Array X×Y)</option>
            <option value="single">單體細節檢驗 (Single Object)</option>
            <option value="catalog">全分類目錄陳列 (All Catalog)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">排列方式</label>
          <select id="layout-industry" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="scene" selected>場景散布 (Scene Scatter)</option>
            <option value="boundary">邊界沿邊排列＋緩衝區＋透明牆 (Boundary Run)</option>
          </select>
        </div>
      </div>
      <div class="action-row">
        <button id="btn-industry-generate" class="btn-generate">⚡ 生成設施陣列</button>
        <button id="btn-industry-random-seed" class="btn-randomize">🎲 隨機種子生成</button>
        <div class="sample-control">
          <span class="sample-label">取樣規模:</span>
          <label class="sample-input-wrap">X欄 <input type="number" id="sample-cols-industry" value="4" min="1" max="20"></label>
          <span>×</span>
          <label class="sample-input-wrap">Y列 <input type="number" id="sample-rows-industry" value="4" min="1" max="20"></label>
        </div>
        <div class="seed-control">
          <label for="input-industry-seed">種子碼</label>
          <input type="number" id="input-industry-seed" value="42" min="1" max="999999">
        </div>
        <div class="seed-mode-control">
          <span class="sample-label">生成種子規則:</span>
          <select id="select-seed-mode-industry" class="seed-mode-select">
            <option value="fixed">固定種子</option>
            <option value="shared_batch">陣列種子</option>
            <option value="per_building" selected>獨立種子</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- 冰雪控制面板 -->
  <div id="panel-ice" class="cat-panel" style="display: none;">
    <div class="dim-panel">
      <div class="dim-title">
        <span>浮冰與冰山 · 水線與種子</span>
        <span class="badge" id="ice-info-badge">海冰 1 · 冰川冰 1 · 透光水面</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">冰體款式</label>
          <select id="ice-kind" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="all" selected>全部款式輪播 (All Kinds)</option>
            <option value="icefloe">浮冰群 (Sea Ice Floe)</option>
            <option value="iceberg">極地冰山 (Glacial Iceberg)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="ice-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="array" selected>陣列規模檢驗 (Array X×Y)</option>
            <option value="single">單體細節檢驗 (Single Object)</option>
            <option value="catalog">全分類目錄陳列 (All Catalog)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">排列方式</label>
          <select id="layout-ice" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="scene" selected>場景散布 (Scene Scatter)</option>
            <option value="boundary">邊界沿邊排列＋緩衝區＋透明牆 (Boundary Run)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">水面環境</label>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:6px 0; cursor:pointer;">
            <input type="checkbox" id="chk-ice-water" checked style="accent-color:#2563eb;"> 顯示透光水面
          </label>
        </div>
      </div>
      <div class="action-row">
        <button id="btn-ice-generate" class="btn-generate">⚡ 生成冰體陣列</button>
        <button id="btn-ice-random-seed" class="btn-randomize">🎲 隨機種子生成</button>
        <div class="sample-control">
          <span class="sample-label">取樣規模:</span>
          <label class="sample-input-wrap">X欄 <input type="number" id="sample-cols-ice" value="4" min="1" max="20"></label>
          <span>×</span>
          <label class="sample-input-wrap">Y列 <input type="number" id="sample-rows-ice" value="4" min="1" max="20"></label>
        </div>
        <div class="seed-control">
          <label for="input-ice-seed">種子碼</label>
          <input type="number" id="input-ice-seed" value="42" min="1" max="999999">
        </div>
        <div class="seed-mode-control">
          <span class="sample-label">生成種子規則:</span>
          <select id="select-seed-mode-ice" class="seed-mode-select">
            <option value="fixed">固定種子</option>
            <option value="shared_batch">陣列種子</option>
            <option value="per_building" selected>獨立種子</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- 環境與邊界控制面板 -->
  <div id="panel-env" class="cat-panel" style="display: none;">
    <div class="dim-panel">
      <div class="dim-title">
        <span id="env-panel-title">邊界固定構造 · 連續陡坡接縫</span>
        <span class="badge" id="env-info-badge">56 款邊界障礙 · 連續陡坡</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">大分類模式</label>
          <select id="env-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="module">獨立構造模組 (Single Module)</option>
            <option value="all">全部邊界輪播 (All Boundaries)</option>
            <option value="edge" selected>邊界固定構造 (Edge Boundaries)</option>
            <option value="slope">連續陡坡接縫 (Slope Boundary Joint)</option>
            <option value="mid">緩坡障礙帶 (Mid Slope)</option>
            <option value="flat">平地障礙帶 (Flat Ground)</option>
            <option value="water">水域障礙物 (Water Obstacles)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">物件款式</label>
          <select id="env-kind" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="env-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="array" selected>陣列規模檢驗 (Array X×Y)</option>
            <option value="single">單體細節檢驗 (Single Object)</option>
            <option value="catalog">全分類目錄陳列 (All Catalog)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">緩衝區與透明牆</label>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:6px 0; cursor:pointer;">
            <input type="checkbox" id="chk-env-buffer" checked style="accent-color:#2563eb;"> 顯示緩衝區填實（邊界透明牆常駐）
          </label>
        </div>
      </div>
      <div class="action-row">
        <button id="btn-env-generate" class="btn-generate">⚡ 生成環境陣列</button>
        <button id="btn-env-random-seed" class="btn-randomize">🎲 隨機種子生成</button>
        <div class="sample-control">
          <span class="sample-label">取樣規模:</span>
          <label class="sample-input-wrap">X欄 <input type="number" id="sample-cols-env" value="4" min="1" max="20"></label>
          <span>×</span>
          <label class="sample-input-wrap">Y列 <input type="number" id="sample-rows-env" value="4" min="1" max="20"></label>
        </div>
        <div class="seed-control">
          <label for="input-env-seed">種子碼</label>
          <input type="number" id="input-env-seed" value="42" min="1" max="999999">
        </div>
        <div class="seed-mode-control">
          <span class="sample-label">生成種子規則:</span>
          <select id="select-seed-mode-env" class="seed-mode-select">
            <option value="fixed">固定種子</option>
            <option value="shared_batch">陣列種子</option>
            <option value="per_building" selected>獨立種子</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- 植物類別控制面板 -->
  <div id="panel-plant" class="cat-panel" style="display: none;">
    <div class="dim-panel">
      <div class="dim-title">
        <span>植物形態與生態季候</span>
        <span class="badge" id="plant-info-badge">21 種林木形態 · 獨立季節器官</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">植物樹種</label>
          <select id="plant-species" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="all" selected>全部樹種輪播 (All Species)</option>
            <option value="auto">依環境適生加權抽樣</option>
            <optgroup label="針葉樹巨木">
              <option value="redwood">加州紅杉 (Redwood · 塔型 110m)</option>
              <option value="sequoia">巨杉 (Sequoia · 塔型 92m)</option>
              <option value="dougfir">花旗松 (Douglas Fir · 塔型 100m)</option>
              <option value="sitka">錫特卡雲杉 (Sitka Spruce · 塔型 90m)</option>
              <option value="taiwania">台灣杉 (Taiwania · 塔型 90m)</option>
              <option value="alerce">智利柏 (Alerce · 階層 60m)</option>
              <option value="klinki">克林基南洋杉 (Araucaria · 階層 88m)</option>
            </optgroup>
            <optgroup label="闊葉巨木">
              <option value="euc">澳洲杏仁尤加利 (Eucalyptus · 開展 98m)</option>
              <option value="meranti">婆羅洲娑羅雙 (Shorea · 傘型 96m)</option>
              <option value="dinizia">巴西巨木 (Angelim · 傘型 86m)</option>
              <option value="tualang">巨型甘巴豆 (Tualang · 傘型 88m)</option>
            </optgroup>
            <optgroup label="溫帶與地中海">
              <option value="banyan">孟加拉榕樹 (Banyan · 氣生支柱根)</option>
              <option value="willow">垂柳 (Willow · 下垂枝柔荑花序)</option>
              <option value="holmOak">地中海冬青櫟 (Holm Oak · 耐乾傘冠)</option>
            </optgroup>
            <optgroup label="灌叢與冷涼生態">
              <option value="scrubOak">矮灌木櫟 (Scrub Oak · 多幹密灌)</option>
              <option value="rhododendron">高山杜鵑 (Rhododendron · 花簇酸土)</option>
              <option value="juniper">刺柏 (Juniper · 多幹漿果狀球果)</option>
            </optgroup>
            <optgroup label="特殊生態形態">
              <option value="forestBamboo">叢生竹叢 (Bamboo · 竹節地下莖)</option>
              <option value="mangroveGrey">海茄苳紅樹 (Mangrove · 呼吸根潮灘)</option>
              <option value="coconut">可可椰子 (Coconut · 羽狀葉椰果)</option>
              <option value="baobab">猴麵包樹 (Baobab · 膨大幹)</option>
            </optgroup>
            <optgroup label="場景獨立物件">
              <option value="gianttree">神木巨木 (Scene Giant Tree)</option>
              <option value="fallentree">倒木橫幹 (Scene Fallen Tree)</option>
            </optgroup>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="plant-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="array" selected>陣列規模檢驗 (Array X×Y)</option>
            <option value="single">單株解剖檢驗 (Single Tree)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">排列方式</label>
          <select id="layout-plant" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="scene" selected>場景散布 (Scene Scatter)</option>
            <option value="boundary">邊界沿邊排列＋緩衝區＋透明牆 (Boundary Run)</option>
          </select>
        </div>
        
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">公稱縮放倍率</label>
          <input type="number" id="plant-scale" value="1.0" min="0.1" max="3" step="0.1" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 700; color: #1e293b; background: #fff;">
        </div>
      </div>
      <details style="margin-bottom:8px; font-size: 11px; color:#475569;">
        <summary style="cursor:pointer; font-weight:600; color:#2563eb;">▸ 展開生態環境參數 (氣候 / 緯度 / 海拔 / 濕度 / 土壤 pH / 鹽度)</summary>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px; margin-top: 6px; background:#fff; padding:8px; border-radius:6px; border:1px solid #e2e8f0;">
          <label>氣候 <select id="plant-climate" style="font-size:11px; width:100%;">
            <option value="all" selected>全部氣候輪播 (All Climates)</option>
            <option value="temperate">溫帶 (Temperate)</option>
            <option value="tropical">熱帶 (Tropical)</option>
            <option value="boreal">寒帶 (Boreal)</option>
            <option value="arid">乾旱 (Arid)</option>
            <option value="mediterranean">地中海 (Mediterranean)</option>
            <option value="alpine">高山 (Alpine)</option>
          </select></label>
          <label>緯度 ° <input type="range" id="plant-lat" min="0" max="90" step="1" value="35"></label>
          <label>海拔 m <input type="range" id="plant-altitude" min="-200" max="4000" step="50" value="500"></label>
          <label>濕度 <input type="range" id="plant-moisture" min="0" max="1" step="0.05" value="0.6"></label>
          <label>土壤 pH <input type="range" id="plant-ph" min="3.5" max="8.5" step="0.1" value="6.5"></label>
          <label>鹽度 <input type="range" id="plant-salinity" min="0" max="0.15" step="0.01" value="0"></label>
        </div>
      </details>
      <div class="action-row">
        <button id="btn-plant-generate" class="btn-generate">⚡ 生成植物陣列</button>
        <button id="btn-plant-random-seed" class="btn-randomize">🎲 隨機種子生成</button>
        <div class="sample-control">
          <span class="sample-label">取樣規模:</span>
          <label class="sample-input-wrap">X欄 <input type="number" id="sample-cols-plant" value="4" min="1" max="20"></label>
          <span>×</span>
          <label class="sample-input-wrap">Y列 <input type="number" id="sample-rows-plant" value="4" min="1" max="20"></label>
        </div>
        <div class="seed-control">
          <label for="input-plant-seed">種子碼</label>
          <input type="number" id="input-plant-seed" value="1001" min="1" max="999999">
        </div>
        <div class="seed-mode-control">
          <span class="sample-label">生成種子規則:</span>
          <select id="select-seed-mode-plant" class="seed-mode-select">
            <option value="fixed">固定種子</option>
            <option value="shared_batch">陣列種子</option>
            <option value="per_building" selected>獨立種子</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <div class="nav-bar">
    <button id="btn-back" class="btn-back">← 返回分類矩陣</button>
    <div class="nav-status" id="nav-status">目前展示：【建築分類與變體】</div>
    <div class="toggles">
      <label><input type="checkbox" id="chk-roads" checked> 道路 / 地面網格</label>
      <label><input type="checkbox" id="chk-labels" checked> 懸浮標籤</label>
      <label><button id="btn-reset-cam" style="background:#e2e8f0;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;">視角重置</button></label>
    </div>
  </div>
</header>
<div class="hint">
  <kbd>左鍵拖曳</kbd> 旋轉視角 · <kbd>右鍵拖曳</kbd> 平移中心 · <kbd>滾輪</kbd> 縮放 · <kbd>點擊物件</kbd> 展開 16 組隨機變體 / 聚焦觀察
</div>
<div id="labels"></div>
<div id="inspector-card" class="inspector-card" style="display: none;"></div>

<div id="filter-modal" class="filter-modal-backdrop">
  <div class="filter-modal-card">
    <div class="filter-modal-header">
      <div>
        <div class="filter-modal-title">⚙ 建築類別與維度選項篩選池</div>
        <div class="filter-modal-desc">自訂隨機生成與陣列循環時納入的特徵項目（未勾選之項目將從隨機抽選與矩陣循環中排除）</div>
      </div>
      <button id="btn-close-filter" class="btn-close-modal">✕ 關閉</button>
    </div>
    <div class="filter-modal-body">
      <div id="filter-grid" class="filter-modal-grid"></div>
    </div>
    <div class="filter-modal-footer">
      <div id="filter-stat" class="filter-stat-text">已啟用項目：60 / 60 款</div>
      <div style="display: flex; gap: 8px;">
        <button id="btn-filter-reset" class="btn-randomize">全部重設啟用</button>
        <button id="btn-filter-apply" class="btn-generate">套用並重新生成</button>
      </div>
    </div>
  </div>
</div>

<script type="importmap">{"imports":{"three":"/three.mjs","three/addons/utils/BufferGeometryUtils.js":"/utils.mjs","three/addons/postprocessing/Pass.js":"/pass.mjs"}}</script>
<script type="module">
import * as THREE from 'three';
import { buildOsmPolygonBuildings } from '/js/osmBuilding.js';
import {
  ARCHITECTURE_STYLES, ROOF_FORMS, FACADE_TYPES, BUILDING_FUNCTION_RANGES,
  CULTURAL_REGIONS, APPURTENANCE_RULES, calculateFootprintMetrics,
} from '/js/architectureStyles.js';
import { inferBuildingFunction, sampleBuildingHeight, architectureHash } from '/js/buildingDiversity.js';
import { sceneObjectMat } from '/js/toon.js';
import { Pipeline } from '/js/postfx.js';

// 地質生成模組
import { GEOLOGY_TYPES, GEOLOGY_SURFACES, geologyBackgroundObject, generateGeology, geologyDistribution } from '/js/geology.js';
import { ANCIENT_REGIONS, ANCIENT_RUINS, RUIN_ACTIVITIES, ancientStoneDistribution } from '/js/ancientStone.js';
import { runtimeMeshDataGeometry } from '/js/runtimePartModel.js';
import { mulberry32 } from '/js/rng.js';

// 植物生成模組
import { TREE_SPECIES, createForestTree, treeDistribution, treeHabitatWeight, treeSections, treeBend, forestEnvironment } from '/js/forest.js';
// 車輛生成模組
import { VEHICLE_AXES, VEHICLE_PROFILES, VEHICLE_PART_NAMES, vehicleCandidates } from '/js/vehicleCatalog.js';
import { makeProceduralVehicle } from '/js/vehicleModels.js';
import { VEHICLE_CONSISTS, CONSIST_PREFIX } from '/js/vehicleConsists.js';
import { RIM_NAMES } from '/js/vehicleVariants.js';

// 船隻生成模組
import { VESSEL_AXES, VESSEL_TYPES, VESSEL_MATERIALS, generateVessel } from '/js/vesselCatalog.js';
import { VESSEL_EQUIPMENT } from '/js/vesselLayout.js';
import { buildGeneratedVesselMesh } from '/js/vesselModels.js';
import { disposeTree } from '/js/toon.js';

// 環境物件與邊界生成模組
import { environmentParts } from '/js/environmentParts.js';
import { WALL_KINDS, wallParts, buildBoundaryRunParts, BOUNDARY_OBJECT_CATEGORIES } from '/js/edgewall.js';
import { boundaryGrid } from '/js/objectLayout.js';
import { edgeWallHM } from '/js/data.js';
import { SLOPE_BOUNDARIES, buildSlopeBoundary } from '/js/edgeSlope.js';

// 環境模擬系統 (四季 × 日夜 × 多元天氣)
import { applyEnvironment } from '/js/environment.js';
import { clockHour, clockLabel, DAYCLOCK } from '/js/data.js';


// ---- Three.js 核心場景初始化 ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = false;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcdd9e2);

// 環境模擬狀態 (四季 × 日夜太陽軌道 × 多元天氣粒子與閃電)
const currentEnv = {
  season: 'summer',
  time: 'day',
  weather: 'clear',
  hour: 12,
  playing: false,
  speed: 5,
};
let envHandle = null;
let simElapsedS = 0;

function initEnvironment() {
  if (envHandle) {
    try { envHandle.dispose(); } catch (e) { console.warn(e); }
    envHandle = null;
  }
  const simTerrain = {
    worldW: 2400,
    worldH: 2400,
    center: { lat: 25.0, lng: 121.5 },
    heightAt: () => 0,
  };
  envHandle = applyEnvironment(scene, simTerrain, {
    season: currentEnv.season,
    time: currentEnv.time,
    weather: currentEnv.weather,
  }, {
    shadow: false,
    backgroundOnly: false,
  });
  syncEnvironmentHour(currentEnv.hour);
}

function syncEnvironmentHour(targetHour) {
  currentEnv.hour = targetHour;
  const h0 = DAYCLOCK.START_H[currentEnv.time] ?? DAYCLOCK.START_H.day;
  const rate = DAYCLOCK.GAME_H / DAYCLOCK.REAL_S;
  const diffH = ((targetHour - h0) % 24 + 24) % 24;
  simElapsedS = diffH / rate;
  const slider = document.querySelector('#sim-hour');
  if (slider) slider.value = targetHour;
  const valText = document.querySelector('#sim-hour-val');
  if (valText) valText.textContent = clockLabel(targetHour);
  document.querySelectorAll('.env-time-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.time === currentEnv.time);
  });
}

const aspect = innerWidth / innerHeight;
const camera = new THREE.PerspectiveCamera(38, aspect, 0.5, 4000);

let camDist = 320, camTheta = 0.85, camPhi = 0.62;
const camTarget = new THREE.Vector3(0, 6, 0);
let isLeftDragging = false, isRightDragging = false, prevMouse = { x: 0, y: 0 };
let mouseDownPos = { x: 0, y: 0 };

function updateCamera() {
  camPhi = Math.max(0.08, Math.min(Math.PI / 2 - 0.05, camPhi));
  camera.position.x = camTarget.x + camDist * Math.sin(camPhi) * Math.sin(camTheta);
  camera.position.y = camTarget.y + camDist * Math.cos(camPhi);
  camera.position.z = camTarget.z + camDist * Math.sin(camPhi) * Math.cos(camTheta);
  camera.lookAt(camTarget);
}
updateCamera();

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (e.target.closest('header, nav, .top-nav-bar, .modal, .badge-label, select, input, button, label')) return;
  if (e.button === 0) isLeftDragging = true;
  if (e.button === 2) isRightDragging = true;
  prevMouse = { x: e.clientX, y: e.clientY };
  mouseDownPos = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mousemove', (e) => {
  if ((isLeftDragging && (e.buttons & 1) === 0) || (isRightDragging && (e.buttons & 2) === 0)) {
    isLeftDragging = false;
    isRightDragging = false;
  }
  if (!isLeftDragging && !isRightDragging) {
    handleHover(e);
    prevMouse = { x: e.clientX, y: e.clientY };
    return;
  }
  const dx = e.clientX - prevMouse.x, dy = e.clientY - prevMouse.y;
  if (isLeftDragging) {
    camTheta -= dx * 0.007;
    camPhi += dy * 0.007;
    updateCamera(); render();
  } else if (isRightDragging) {
    const forward = new THREE.Vector3().subVectors(camTarget, camera.position);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const panSpeed = camDist * 0.0016;
    camTarget.addScaledVector(right, -dx * panSpeed);
    camTarget.addScaledVector(forward, dy * panSpeed);
    updateCamera(); render();
  }
  prevMouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mouseup', (e) => {
  const moved = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
  if (moved < 5 && e.button === 0 && !e.target.closest('header, nav, .top-nav-bar, .modal, .badge-label, select, input, button, label')) {
    handleClick(e);
  }
  isLeftDragging = false;
  isRightDragging = false;
});
window.addEventListener('wheel', (e) => {
  camDist = Math.max(10, Math.min(1800, camDist + e.deltaY * 0.35));
  updateCamera(); render();
}, { passive: true });

// 底板與各類別群組
const floor = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshLambertMaterial({ color: 0xbed0bd }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.05;
scene.add(floor);

let buildingGroup = new THREE.Group();
scene.add(buildingGroup);

let roadGroup = new THREE.Group();
scene.add(roadGroup);

let geologyGroup = new THREE.Group();
scene.add(geologyGroup);

let plantGroup = new THREE.Group();
scene.add(plantGroup);

let vehicleGroup = new THREE.Group();
scene.add(vehicleGroup);

let vesselGroup = new THREE.Group();
scene.add(vesselGroup);

let envGroup = new THREE.Group();
scene.add(envGroup);

let industryGroup = new THREE.Group();
scene.add(industryGroup);

let iceGroup = new THREE.Group();
scene.add(iceGroup);

const waterMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(3200, 3200),
  new THREE.MeshStandardMaterial({
    color: 0x367e9c,
    transparent: true,
    opacity: 0.72,
    roughness: 0.35,
    side: THREE.DoubleSide,
  })
);
waterMesh.rotation.x = -Math.PI / 2;
waterMesh.position.y = 0;
waterMesh.visible = false;
scene.add(waterMesh);

const labels = [];
const labelContainer = document.querySelector('#labels');
const inspectorCard = document.querySelector('#inspector-card');

// 懸停高亮指示框
const highlightMesh = new THREE.Mesh(
  new THREE.RingGeometry(1, 1.4, 32),
  new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
);
highlightMesh.rotation.x = -Math.PI / 2;
highlightMesh.position.y = 0.2;
highlightMesh.visible = false;
scene.add(highlightMesh);

// ---- 建築分類維度定義集 ----
const FUNCTION_DIM = [
  { key: 'commercial_skyscraper', label: '商業摩天樓', kind: 'commercial', w: 24, d: 22, defaultStyle: 'modern', tags: { building: 'skyscraper' } },
  { key: 'commercial_office',     label: '商辦大樓',   kind: 'commercial', w: 22, d: 18, defaultStyle: 'deco', tags: { building: 'office' } },
  { key: 'commercial_retail',     label: '商場賣場',   kind: 'commercial', w: 25, d: 20, defaultStyle: 'modern', tags: { building: 'retail', shop: 'supermarket' } },
  { key: 'residential_detached',  label: '獨棟住宅',   kind: 'residential', w: 16, d: 14, defaultStyle: 'suburban', tags: { building: 'house' } },
  { key: 'residential_multifamily', label: '集合公寓', kind: 'residential', w: 22, d: 18, defaultStyle: 'modern', tags: { building: 'apartments' } },
  { key: 'residential_terrace',   label: '連棟街屋',   kind: 'residential', w: 14, d: 20, defaultStyle: 'shophouse', tags: { building: 'terrace' } },
  { key: 'civic_administrative',  label: '市政機關',   kind: 'civic', w: 24, d: 20, defaultStyle: 'classical', tags: { building: 'civic', amenity: 'townhall' } },
  { key: 'civic_cultural',        label: '文化場館',   kind: 'civic', w: 25, d: 22, defaultStyle: 'modern', tags: { building: 'museum', amenity: 'theatre' } },
  { key: 'industrial_warehouse',  label: '物流倉庫',   kind: 'industrial', w: 25, d: 20, defaultStyle: 'industrial', tags: { building: 'warehouse' } },
  { key: 'industrial_light',      label: '精密廠房',   kind: 'industrial', w: 24, d: 20, defaultStyle: 'industrial', tags: { building: 'industrial' } },
  { key: 'religious_shrine',      label: '宮廟神殿',   kind: 'religious', w: 20, d: 18, defaultStyle: 'shrine', tags: { amenity: 'place_of_worship' } },
  { key: 'hospitality_hotel',     label: '觀光飯店',   kind: 'commercial', w: 24, d: 20, defaultStyle: 'modern', tags: { tourism: 'hotel' } },
  { key: 'mixed_commercial_res',  label: '住商混合樓', kind: 'commercial', w: 20, d: 18, defaultStyle: 'shophouse', tags: { building: 'commercial', shop: 'convenience' } },
];

const STYLE_DIM = Object.entries(ARCHITECTURE_STYLES).map(([key, style]) => ({
  key,
  label: style.label,
  style,
}));

const ROOF_DIM = Object.entries(ROOF_FORMS).map(([key, rf]) => ({
  key,
  label: rf.label,
  form: rf,
}));

const FACADE_DIM = Object.entries(FACADE_TYPES).map(([key, ft]) => ({
  key,
  label: ft.label,
  facade: ft,
}));

const REGION_DIM = Object.entries(CULTURAL_REGIONS).map(([key, reg]) => ({
  key,
  label: reg.label,
  region: reg,
}));

const DIM_COLLECTIONS = {
  func:   { name: '地點功能', items: FUNCTION_DIM },
  style:  { name: '文化風格', items: STYLE_DIM },
  roof:   { name: '屋頂立體', items: ROOF_DIM },
  facade: { name: '立面材質', items: FACADE_DIM },
  region: { name: '文化大區', items: REGION_DIM },
};

const enabledDimItems = {
  func:   new Set(FUNCTION_DIM.map((it) => it.key)),
  style:  new Set(STYLE_DIM.map((it) => it.key)),
  roof:   new Set(ROOF_DIM.map((it) => it.key)),
  facade: new Set(FACADE_DIM.map((it) => it.key)),
  region: new Set(REGION_DIM.map((it) => it.key)),
};

function getActiveDimItems(dimKey) {
  const col = DIM_COLLECTIONS[dimKey];
  if (!col) return [];
  const enabled = enabledDimItems[dimKey];
  const list = col.items.filter((it) => enabled.has(it.key));
  return list.length > 0 ? list : col.items;
}

let currentTab = 'arch'; // 'arch' | 'geology' | 'plant' | 'vehicle' | 'vessel' | 'industry' | 'ice' | 'env'
let currentMode = 'matrix'; // 'matrix' | 'variants' | 'random'
let selectedDims = ['func', 'style'];
const clickableObjects = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredBuilding = null;
let variantTargetMeta = null;
const dimCycleOffsets = { func: 0, style: 0, roof: 0, facade: 0, region: 0 };

function pickPreviewObject(e) {
  if (e.target.closest('header, nav, .top-nav-bar, .modal, .badge-label, select, input, button, label')) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2);
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObjects(clickableObjects, false)[0] || null;
}

function handleHover(e) {
  const hit = pickPreviewObject(e);
  hoveredBuilding = hit?.object || null;
  renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
  const meta = hit && Object.entries(hit.object.userData).find(([key]) => key.endsWith('Meta'))?.[1];
  renderer.domElement.title = meta ? (meta.label || meta.kind || '模型') + ' · 種子 ' + meta.seed : '';
}

function handleClick(e) {
  const hit = pickPreviewObject(e);
  if (!hit) return;
  const meta = hit.object.userData.buildingMeta;
  if (meta && currentTab === 'arch') { buildVariantsMode(meta); return; }
  camTarget.copy(hit.point);
  updateCamera();
  render();
}

// ---- 零件預估與統計輔助函式 ----
function estimateAppurtenances(poly, arch, heightInfo, seed) {
  const parts = [];
  const metrics = calculateFootprintMetrics(poly);
  const area = metrics ? metrics.area : 100;
  const idBase = (arch.id || 'bld') + '|' + (metrics?.outer?.[0]?.[0] || 0) + '|' + (metrics?.outer?.length || 0);
  const cat = arch.functionInfo?.category || 'residential';
  const height = heightInfo.height;

  if (cat === 'commercial' && height >= 28 && area >= 450) parts.push('停機坪直升機棚');
  if ((architectureHash(idBase, 'tank') % 100) < 85 && area >= 30) parts.push('白鐵不銹鋼水塔 ×' + ((seed % 3) + 1));
  if ((architectureHash(idBase, 'antenna') % 100) < 60) parts.push('魚骨電視天線');
  if ((architectureHash(idBase, 'cell') % 100) < 35 && height >= 24) parts.push('通訊基地台塔');
  if ((architectureHash(idBase, 'solar') % 100) < 45 && area >= 80) parts.push('光伏太陽能板 ×' + ((seed % 3) + 2));
  if ((architectureHash(idBase, 'chimney') % 100) < 55) parts.push('排煙煙囪');
  if ((architectureHash(idBase, 'roof_board') % 100) < 40 && cat === 'commercial' && height >= 18) parts.push('屋頂大型廣告架');
  if ((architectureHash(idBase, 'canopy') % 100) < 75) parts.push('門頭遮雨棚');
  if ((architectureHash(idBase, 'pots') % 100) < 70) parts.push('迎賓景觀盆栽 ×2');
  if ((architectureHash(idBase, 'ac') % 100) < 85) parts.push('冷氣室外機 ×' + (Math.floor(height / 4) * 2 + 2));
  if ((architectureHash(idBase, 'sign') % 100) < 80 && (cat === 'commercial' || cat === 'residential')) parts.push('側懸店鋪招牌 ×2');
  if ((architectureHash(idBase, 'fire') % 100) < 40 && height >= 12) parts.push('外露鋼構逃生梯');
  if (parts.length === 0) parts.push('正門標準門框', '換氣導流槽');
  return parts;
}

// ---- 清除與重設 ----
function clearScene() {
  for (const group of [buildingGroup, roadGroup, geologyGroup, plantGroup, vehicleGroup, vesselGroup, envGroup, industryGroup, iceGroup]) disposeTree(group);
  scene.remove(buildingGroup);
  buildingGroup = new THREE.Group();
  scene.add(buildingGroup);

  scene.remove(roadGroup);
  roadGroup = new THREE.Group();
  scene.add(roadGroup);

  scene.remove(geologyGroup);
  geologyGroup = new THREE.Group();
  scene.add(geologyGroup);

  scene.remove(plantGroup);
  plantGroup = new THREE.Group();
  scene.add(plantGroup);

  scene.remove(vehicleGroup);
  vehicleGroup = new THREE.Group();
  scene.add(vehicleGroup);

  scene.remove(vesselGroup);
  vesselGroup = new THREE.Group();
  scene.add(vesselGroup);

  scene.remove(envGroup);
  envGroup = new THREE.Group();
  scene.add(envGroup);

  scene.remove(industryGroup);
  industryGroup = new THREE.Group();
  scene.add(industryGroup);

  scene.remove(iceGroup);
  iceGroup = new THREE.Group();
  scene.add(iceGroup);

  labels.length = 0;
  labelContainer.innerHTML = '';
  clickableObjects.length = 0;
  highlightMesh.visible = false;
  inspectorCard.style.display = 'none';
}

// ---- 隨機道路與十字路口系統 ----
function buildRoadGrid(cols, rows, startX, startZ, stepX, stepZ) {
  roadGroup.clear();
  if (!document.querySelector('#chk-roads').checked) return;

  const vertXs = [];
  for (let c = 0; c <= cols; c++) vertXs.push(startX + (c - 0.5) * stepX);
  const horizZs = [];
  for (let r = 0; r <= rows; r++) horizZs.push(startZ + (r - 0.5) * stepZ);

  const ROAD_PALETTE = [0x2c3036, 0x3a3f47, 0x484f58, 0x5a544c];
  const MARK_YELLOW = 0xf59e0b;

  for (let ci = 0; ci < vertXs.length; ci++) {
    for (let rj = 0; rj < horizZs.length; rj++) {
      const cx = vertXs[ci], cz = horizZs[rj];
      const rSeed = Math.abs(Math.sin(ci * 37 + rj * 73)) * 10000;
      const roadW = 10 + (Math.floor(rSeed) % 3) * 2;
      const color = ROAD_PALETTE[Math.floor(rSeed) % ROAD_PALETTE.length];

      const junc = new THREE.Mesh(
        new THREE.PlaneGeometry(roadW, roadW),
        new THREE.MeshLambertMaterial({ color })
      );
      junc.rotation.x = -Math.PI / 2;
      junc.position.set(cx, 0.015, cz);
      roadGroup.add(junc);
    }
  }

  for (let ci = 0; ci < vertXs.length; ci++) {
    const cx = vertXs[ci];
    for (let rj = 0; rj < horizZs.length - 1; rj++) {
      const z1 = horizZs[rj], z2 = horizZs[rj + 1];
      const roadW = 10, segLen = (z2 - z1) - roadW - 7.0;
      if (segLen <= 1) continue;
      const cz = (z1 + z2) / 2;
      const sSeed = Math.abs(Math.sin(ci * 91 + rj * 43)) * 10000;
      const color = ROAD_PALETTE[Math.floor(sSeed) % ROAD_PALETTE.length];

      const roadSeg = new THREE.Mesh(new THREE.PlaneGeometry(roadW, segLen), new THREE.MeshLambertMaterial({ color }));
      roadSeg.rotation.x = -Math.PI / 2;
      roadSeg.position.set(cx, 0.015, cz);
      roadGroup.add(roadSeg);

      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, segLen), new THREE.MeshLambertMaterial({ color: 0x94a3b8 }));
        sw.position.set(cx + side * (roadW / 2 + 0.8), 0.08, cz);
        roadGroup.add(sw);
      }
    }
  }

  for (let rj = 0; rj < horizZs.length; rj++) {
    const cz = horizZs[rj];
    for (let ci = 0; ci < vertXs.length - 1; ci++) {
      const x1 = vertXs[ci], x2 = vertXs[ci + 1];
      const roadW = 10, segLen = (x2 - x1) - roadW - 7.0;
      if (segLen <= 1) continue;
      const cx = (x1 + x2) / 2;
      const sSeed = Math.abs(Math.sin(ci * 61 + rj * 89)) * 10000;
      const color = ROAD_PALETTE[Math.floor(sSeed) % ROAD_PALETTE.length];

      const roadSeg = new THREE.Mesh(new THREE.PlaneGeometry(segLen, roadW), new THREE.MeshLambertMaterial({ color }));
      roadSeg.rotation.x = -Math.PI / 2;
      roadSeg.position.set(cx, 0.015, cz);
      roadGroup.add(roadSeg);

      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.16, 1.6), new THREE.MeshLambertMaterial({ color: 0x94a3b8 }));
        sw.position.set(cx, 0.08, cz + side * (roadW / 2 + 0.8));
        roadGroup.add(sw);
      }
    }
  }
}

// ---- 建構建築實例與中繼資料 ----
function spawnBuilding({ x, z, w, d, funcItem, styleItem, roofForm, facadeType, regionId, seed, variantIdx = 0, customPoly = null, maxW = 26, maxD = 22 }) {
  const fItem = funcItem || FUNCTION_DIM[0];
  const sItem = styleItem || (ARCHITECTURE_STYLES[fItem.defaultStyle] ? { key: fItem.defaultStyle, label: ARCHITECTURE_STYLES[fItem.defaultStyle].label, style: ARCHITECTURE_STYLES[fItem.defaultStyle] } : STYLE_DIM[0]);
  const style = { ...sItem.style };

  if (facadeType && FACADE_TYPES[facadeType]) style.defaultFacade = facadeType;
  if (roofForm && ROOF_FORMS[roofForm]) style.allowedRoofs = [roofForm];

  const rawW = w + ((architectureHash(seed + '|w') % 7) - 3) * 1.5;
  const rawD = d + ((architectureHash(seed + '|d') % 7) - 3) * 1.5;
  const actualW = customPoly ? w : Math.min(maxW, Math.max(10, rawW));
  const actualD = customPoly ? d : Math.min(maxD, Math.max(10, rawD));

  let poly;
  if (customPoly) {
    poly = customPoly;
  } else {
    const hw = actualW / 2, hd = actualD / 2;
    poly = {
      outer: [[x - hw, z - hd], [x + hw, z - hd], [x + hw, z + hd], [x - hw, z + hd]],
      holes: [],
    };
  }

  const functionInfo = inferBuildingFunction({ tags: fItem.tags || { building: 'yes' }, w: actualW, d: actualD }, poly, { urban: true });
  const heightInfo = sampleBuildingHeight(fItem.key, seed, 'bld_' + seed + '_' + variantIdx);

  const arch = {
    id: 'bld_' + seed + '_' + variantIdx,
    poly,
    seed,
    style,
    styleId: sItem.key,
    culturalRegion: regionId || (sItem.style?.regions?.[0] || 'east_asia'),
    functionInfo,
  };

  const appurtenances = estimateAppurtenances(poly, arch, heightInfo, seed);

  const subGroup = new THREE.Group();

  const area = {
    sourceId: 'bld_' + seed + '_' + variantIdx,
    tags: { building: 'yes', ...fItem.tags },
    classification: { kind: fItem.kind || 'house', generator: 'polygonBuilding' },
    worldPolygons: [poly],
  };

  const archConfig = {
    ...style,
    id: sItem.key,
    variant: variantIdx,
    profile: 'plain',
    functionInfo,
    targetHeight: heightInfo.height,
    levels: heightInfo.levels,
    floorH: heightInfo.floorH,
  };

  buildOsmPolygonBuildings(subGroup, [area], {
    terrain: { heightAt: () => 0 },
    architectureOf: () => archConfig,
    materialOf: () => ({
      wall: sceneObjectMat(0xffffff, { vertexColors: true }),
      roof: sceneObjectMat(0xffffff, { vertexColors: true }),
    }),
  });

  const bldMesh = subGroup;

  const hitGeo = new THREE.BoxGeometry(actualW * 1.05, heightInfo.height, actualD * 1.05);
  hitGeo.translate(x, heightInfo.height / 2, z);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);

  const meta = {
    x, z,
    w: actualW.toFixed(1),
    d: actualD.toFixed(1),
    height: heightInfo.height.toFixed(1),
    levels: heightInfo.levels,
    seed,
    funcKey: fItem.key,
    funcLabel: fItem.label,
    styleKey: sItem.key,
    styleLabel: sItem.label,
    roofKey: roofForm || 'auto',
    roofLabel: roofForm && ROOF_FORMS[roofForm] ? ROOF_FORMS[roofForm].label : '自動結構適配',
    facadeKey: facadeType || style.defaultFacade || 'brick',
    facadeLabel: facadeType && FACADE_TYPES[facadeType] ? FACADE_TYPES[facadeType].label : (FACADE_TYPES[style.defaultFacade]?.label || '標準砌體磚'),
    regionKey: arch.culturalRegion,
    regionLabel: CULTURAL_REGIONS[arch.culturalRegion]?.label || arch.culturalRegion,
    appurtenances,
    colorScheme: style.colorScheme || { primary: [0.8, 0.8, 0.8], trim: [0.3, 0.3, 0.3], roof: [0.5, 0.2, 0.2] },
    mesh: bldMesh,
    hitMesh,
    position: new THREE.Vector3(x, heightInfo.height, z),
    centerPos: new THREE.Vector3(x, 0, z),
    sizeDiag: Math.hypot(actualW, actualD) * 0.55,
  };

  bldMesh.userData.buildingMeta = meta;
  hitMesh.userData.buildingMeta = meta;
  clickableObjects.push(hitMesh);
  buildingGroup.add(bldMesh);
  buildingGroup.add(hitMesh);

  const badge = document.createElement('div');
  badge.className = 'badge-label';
  badge.innerHTML = '<span class="cat">【' + meta.funcLabel + '】</span>' + meta.styleLabel + ' · ' + meta.roofLabel + '<span class="height">' + meta.height + 'm (' + meta.levels + 'F)</span>';
  labelContainer.append(badge);
  labels.push({ element: badge, point: meta.position });

  return meta;
}

function getCyclicItems(items, count, offset) {
  if (!items || items.length === 0) return { items: [], range: '無啟用項目' };
  if (!count || count >= items.length) {
    return { items: [...items], range: '全量 1~' + items.length + ' / 啟用 ' + items.length + ' 款' };
  }
  const result = [];
  const start = ((offset % items.length) + items.length) % items.length;
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % items.length;
    result.push(items[idx]);
  }
  const end = (start + count - 1) % items.length;
  let rangeStr = '';
  if (start + count <= items.length) {
    rangeStr = '第 ' + (start + 1) + '~' + (start + count) + ' / 啟用 ' + items.length + ' 款';
  } else {
    rangeStr = '第 ' + (start + 1) + '~' + items.length + ' 接 1~' + (end + 1) + ' / 啟用 ' + items.length + ' 款';
  }
  return { items: result, range: rangeStr };
}

// ---- 1. 建築雙維度/單維度分類陣列模式 (Matrix Mode) ----

// 共享全域自適應相機取景與網格種子運算
let activeCamDist = 120;
let activeCamTarget = new THREE.Vector3(0, 8, 0);

function resetCameraFocus() {
  camTarget.copy(activeCamTarget);
  camDist = activeCamDist;
  camTheta = 0.85;
  camPhi = 0.62;
  updateCamera();
  render();
}

function getGridSeed(baseSeed, seedMode, col, row, cols, rows, idx) {
  if (seedMode === 'fixed' || seedMode === 'shared_batch') {
    return baseSeed;
  }
  // 獨立種子：各物件擁有各自獨立的相異隨機種子
  return (baseSeed + (col * 179 + row * 383) + idx * 71) % 999999 || 1001;
}

function buildMatrixMode({ advance = false } = {}) {
  clearScene();
  currentMode = 'matrix';
  document.querySelector('#btn-back').style.display = 'none';
  document.querySelector('#btn-generate').style.display = 'inline-flex';
  document.querySelector('#btn-randomize').style.display = 'inline-flex';
  document.querySelector('#btn-regen-variants').style.display = 'none';

  floor.material.color.setHex(0xbed0bd);

  const dimKeyA = selectedDims[0];
  const dimKeyB = selectedDims.length > 1 ? selectedDims[1] : null;

  const dimA = DIM_COLLECTIONS[dimKeyA];
  const dimB = dimKeyB ? DIM_COLLECTIONS[dimKeyB] : null;

  const activeItemsA = getActiveDimItems(dimKeyA);
  const activeItemsB = dimKeyB && dimB ? getActiveDimItems(dimKeyB) : null;

  const seedMode = document.querySelector('#select-seed-mode')?.value || 'per_building';
  let baseSeed = parseInt(document.querySelector('#input-seed')?.value, 10) || 5000;
  const isAll = document.querySelector('#chk-sample-all')?.checked;
  const sampleCountA = isAll ? activeItemsA.length : Math.min(activeItemsA.length, Math.max(1, parseInt(document.querySelector('#sample-dim-a')?.value, 10) || 5));
  const sampleCountB = isAll ? (activeItemsB ? activeItemsB.length : 1) : Math.min(activeItemsB ? activeItemsB.length : 1, Math.max(1, parseInt(document.querySelector('#sample-dim-b')?.value, 10) || 5));

  if (advance) {
    if (seedMode === 'shared_batch' || seedMode === 'per_building') {
      baseSeed = Math.floor(Math.random() * 90000) + 1000;
      const input = document.querySelector('#input-seed');
      if (input) input.value = baseSeed;
    }
    dimCycleOffsets[dimKeyA] = (dimCycleOffsets[dimKeyA] + sampleCountA) % activeItemsA.length;
    if (dimKeyB && activeItemsB) {
      dimCycleOffsets[dimKeyB] = (dimCycleOffsets[dimKeyB] + sampleCountB) % activeItemsB.length;
    }
  }

  const offsetA = ((dimCycleOffsets[dimKeyA] || 0) % activeItemsA.length + activeItemsA.length) % activeItemsA.length;
  const offsetB = (dimKeyB && activeItemsB ? (((dimCycleOffsets[dimKeyB] || 0) % activeItemsB.length + activeItemsB.length) % activeItemsB.length) : 0);

  const cycleA = getCyclicItems(activeItemsA, sampleCountA, offsetA);
  const cycleB = activeItemsB ? getCyclicItems(activeItemsB, sampleCountB, offsetB) : null;

  const itemsA = cycleA.items;
  const itemsB = cycleB ? cycleB.items : null;

  let cols, rows;

  if (dimB) {
    cols = itemsA.length;
    rows = itemsB.length;
    document.querySelector('#nav-status').textContent = '雙維度循環矩陣：【' + dimA.name + ' (' + cycleA.range + ')】×【' + dimB.name + ' (' + cycleB.range + ')】（共 ' + (cols * rows) + ' 棟）';
  } else {
    cols = Math.min(5, Math.ceil(Math.sqrt(itemsA.length)));
    rows = Math.ceil(itemsA.length / cols);
    document.querySelector('#nav-status').textContent = '單維度循環展示：【' + dimA.name + ' (' + cycleA.range + ')】（共 ' + itemsA.length + ' 棟）';
  }

  const stepX = 52, stepZ = 48;
  const startX = -(cols - 1) * stepX / 2;
  const startZ = -(rows - 1) * stepZ / 2;

  buildRoadGrid(cols, rows, startX, startZ, stepX, stepZ);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const idx = r * cols + c;
      const x = startX + c * stepX;
      const z = startZ + r * stepZ;

      let funcItem = null, styleItem = null, roofForm = null, facadeType = null, regionId = null;

      const itA = itemsA[c];
      if (selectedDims[0] === 'func') funcItem = itA;
      else if (selectedDims[0] === 'style') styleItem = itA;
      else if (selectedDims[0] === 'roof') roofForm = itA.key;
      else if (selectedDims[0] === 'facade') facadeType = itA.key;
      else if (selectedDims[0] === 'region') regionId = itA.key;

      if (dimB) {
        const itB = itemsB[r];
        if (selectedDims[1] === 'func') funcItem = itB;
        else if (selectedDims[1] === 'style') styleItem = itB;
        else if (selectedDims[1] === 'roof') roofForm = itB.key;
        else if (selectedDims[1] === 'facade') facadeType = itB.key;
        else if (selectedDims[1] === 'region') regionId = itB.key;
      } else {
        if (idx >= itemsA.length) continue;
        const itSingle = itemsA[idx];
        if (selectedDims[0] === 'func') funcItem = itSingle;
        else if (selectedDims[0] === 'style') styleItem = itSingle;
        else if (selectedDims[0] === 'roof') roofForm = itSingle.key;
        else if (selectedDims[0] === 'facade') facadeType = itSingle.key;
        else if (selectedDims[0] === 'region') regionId = itSingle.key;
      }

      let seed;
      if (seedMode === 'fixed' || seedMode === 'shared_batch') {
        seed = baseSeed;
      } else {
        seed = baseSeed + (c * 179 + r * 383);
      }

      const w = funcItem ? funcItem.w : 22;
      const d = funcItem ? funcItem.d : 18;

      spawnBuilding({ x, z, w, d, funcItem, styleItem, roofForm, facadeType, regionId, seed, maxW: 26, maxD: 22 });
    }
  }

  const totalW = (cols - 1) * stepX + 26;
  const totalD = (rows - 1) * stepZ + 22;
  camTarget.set(0, 8, 0);
  camDist = Math.max(totalW, totalD, 35) * 1.25 + 20;
  activeCamTarget.copy(camTarget);
  activeCamDist = camDist;
  updateCamera();
  render();
}

// ---- 2. 建築展開 16 組隨機變體模式 (Variants Mode) ----
function buildVariantsMode(meta) {
  clearScene();
  currentMode = 'variants';
  variantTargetMeta = meta;

  document.querySelector('#btn-back').style.display = 'inline-block';
  document.querySelector('#btn-generate').style.display = 'none';
  document.querySelector('#btn-randomize').style.display = 'none';
  document.querySelector('#btn-regen-variants').style.display = 'inline-flex';
  document.querySelector('#nav-status').textContent = '展開 16 組隨機參數：【' + meta.funcLabel + '】×【' + meta.styleLabel + '】變體矩陣';

  const cols = 4, rows = 4;
  const stepX = 46, stepZ = 42;
  const startX = -(cols - 1) * stepX / 2;
  const startZ = -(rows - 1) * stepZ / 2;

  buildRoadGrid(cols, rows, startX, startZ, stepX, stepZ);

  const baseW = parseFloat(meta.w) || 20;
  const baseD = parseFloat(meta.d) || 16;
  const fItem = FUNCTION_DIM.find((f) => f.key === meta.funcKey) || FUNCTION_DIM[0];
  const sItem = STYLE_DIM.find((s) => s.key === meta.styleKey) || STYLE_DIM[0];

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const idx = r * cols + c;
      const x = startX + c * stepX;
      const z = startZ + r * stepZ;
      const seed = meta.seed + idx * 7919;

      const varW = Math.min(23, Math.max(10, baseW + ((architectureHash(seed, 'w') % 9) - 4) * 1.6));
      const varD = Math.min(19, Math.max(10, baseD + ((architectureHash(seed, 'd') % 9) - 4) * 1.6));

      spawnBuilding({
        x, z,
        w: varW,
        d: varD,
        funcItem: fItem,
        styleItem: sItem,
        roofForm: meta.roofKey !== 'auto' ? meta.roofKey : null,
        facadeType: meta.facadeKey,
        regionId: meta.regionKey,
        seed,
        variantIdx: idx,
        maxW: 23,
        maxD: 19,
      });
    }
  }

  camTarget.set(0, 6, 0);
  camDist = 260;
  updateCamera();
  render();
}

// ---- 3. 建築全類別隨機混搭模式 ----
function buildFullRandomMode() {
  clearScene();
  currentMode = 'random';
  document.querySelector('#btn-back').style.display = 'none';
  document.querySelector('#btn-generate').style.display = 'inline-flex';
  document.querySelector('#btn-randomize').style.display = 'inline-flex';
  document.querySelector('#btn-regen-variants').style.display = 'none';

  const cols = 5, rows = 5;
  const stepX = 50, stepZ = 46;
  const startX = -(cols - 1) * stepX / 2;
  const startZ = -(rows - 1) * stepZ / 2;

  buildRoadGrid(cols, rows, startX, startZ, stepX, stepZ);

  const activeFuncs = getActiveDimItems('func');
  const activeStyles = getActiveDimItems('style');
  const activeRoofs = getActiveDimItems('roof');
  const activeFacades = getActiveDimItems('facade');
  const activeRegions = getActiveDimItems('region');

  let baseSeed = Math.floor(Math.random() * 900000) + 1000;
  document.querySelector('#input-seed').value = baseSeed;
  document.querySelector('#nav-status').textContent = '🎲 全類別篩選池隨機混搭：' + (cols * rows) + ' 棟全特徵隨機展開';

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const idx = r * cols + c;
      const x = startX + c * stepX;
      const z = startZ + r * stepZ;
      const seed = baseSeed + idx * 3571;

      const fItem = activeFuncs[Math.floor(Math.random() * activeFuncs.length)];
      const sItem = activeStyles[Math.floor(Math.random() * activeStyles.length)];
      const roofItem = activeRoofs[Math.floor(Math.random() * activeRoofs.length)];
      const facadeItem = activeFacades[Math.floor(Math.random() * activeFacades.length)];
      const regionItem = activeRegions[Math.floor(Math.random() * activeRegions.length)];

      spawnBuilding({
        x, z,
        w: fItem.w,
        d: fItem.d,
        funcItem: fItem,
        styleItem: sItem,
        roofForm: roofItem.key,
        facadeType: facadeItem.key,
        regionId: regionItem.key,
        seed,
        maxW: 25,
        maxD: 21,
      });
    }
  }

  camTarget.set(0, 6, 0);
  camDist = 280;
  updateCamera();
  render();
}

// ==========================================
// 地質生成邏輯 (Geology Generation Mode)
// ==========================================
let geologyInitialized = false;
function initGeologyOptions() {
  if (geologyInitialized) return;
  geologyInitialized = true;
  const regSel = document.querySelector('#geo-region');
  if (regSel) {
    regSel.innerHTML = '<option value="all" selected>全部地區輪播</option>';
    for (const [key, name] of Object.entries(ANCIENT_REGIONS)) {
      regSel.add(new Option(name, key));
    }
  }
  const ruinSel = document.querySelector('#geo-ruin-type');
  if (ruinSel) {
    ruinSel.innerHTML = '<option value="all" selected>全部形式輪播 (All Forms)</option><option value="auto">隨機形式 (Random)</option>';
    for (const [key, name] of Object.entries(ANCIENT_RUINS)) {
      const act = RUIN_ACTIVITIES[key] ? (RUIN_ACTIVITIES[key] + ' · ') : '';
      ruinSel.add(new Option(act + name, key));
    }
  }
}

function getGeologyInputs(seed = 0, idx = 0) {
  const climates = ['temperate', 'tropical', 'arid', 'alpine', 'boreal'];
  const waters = ['none', 'stream', 'river', 'lake', 'sea'];
  const climateVal = document.querySelector('#geo-climate').value;
  const waterVal = document.querySelector('#geo-water').value;
  const input = {
    climate: climateVal === 'all' ? climates[idx % climates.length] : climateVal,
    water: waterVal === 'all' ? waters[idx % waters.length] : waterVal,
    moisture: parseFloat(document.querySelector('#geo-moisture').value) || 0.65,
    vegetation: parseFloat(document.querySelector('#geo-vegetation').value) || 0.6,
    conifers: parseFloat(document.querySelector('#geo-conifers').value) || 0.3,
    exposure: parseFloat(document.querySelector('#geo-exposure').value) || 0.5,
    slope: parseFloat(document.querySelector('#geo-slope').value) || 35,
    fault: parseFloat(document.querySelector('#geo-fault').value) || 0.2,
    volcanic: parseFloat(document.querySelector('#geo-volcanic').value) || 0.2,
    dissolution: parseFloat(document.querySelector('#geo-dissolution').value) || 0.6,
    geothermal: parseFloat(document.querySelector('#geo-geothermal').value) || 0.5,
    activity: parseFloat(document.querySelector('#geo-activity').value) || 0.7,
  };
  return input;
}

function pickAutoGeologyType(seed, input) {
  const dist = geologyDistribution(input);
  if (!dist.length) return 'basalt';
  let roll = mulberry32((seed ^ 0x47454f) >>> 0)();
  for (const row of dist) {
    roll -= row.weight;
    if (roll < 0) return row.type;
  }
  return dist[dist.length - 1].type;
}

function createSceneBoulderMesh(seed, posX = 0, posZ = 0) {
  try {
    const season = document.querySelector('#sim-season')?.value || 'summer';
    const rows = environmentParts('boulder', { seed, season });
    const mesh = assembleEnvironmentParts(rows, false);
    mesh.position.set(posX, 0, posZ);

    const bounds3 = new THREE.Box3().setFromObject(mesh);
    const size3 = bounds3.getSize(new THREE.Vector3());
    const entry = {
      name: '巨石巨礫',
      bounds: { size: [size3.x, size3.y, size3.z], min: [0, 0, 0], max: [size3.x, size3.y, size3.z] },
      parts: rows,
    };
    const spec = { group: '場景岩石', name: '巨石巨礫' };

    const r = Math.max(size3.x, size3.y, size3.z);
    const hitGeo = new THREE.BoxGeometry(r * 1.1, size3.y, r * 1.1);
    hitGeo.translate(0, size3.y / 2, 0);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.set(posX, 0, posZ);

    const meta = {
      type: 'boulder',
      spec,
      seed,
      entry,
      input: { sceneKind: true },
      posX, posZ,
      bounds: entry.bounds,
      name: entry.name,
      isAncient: false,
      sceneKind: true,
    };

    mesh.userData.geologyMeta = meta;
    hitMesh.userData.geologyMeta = meta;
    clickableObjects.push(hitMesh);
    geologyGroup.add(mesh);
    geologyGroup.add(hitMesh);

    const badge = document.createElement('div');
    badge.className = 'badge-label';
    badge.innerHTML = '<span class="cat">【' + entry.name + '】</span>場景岩石 · <span class="height">' + size3.y.toFixed(1) + 'm</span>';
    labelContainer.append(badge);
    const labelObj = { element: badge, point: new THREE.Vector3(posX, size3.y + 1.5, posZ) };
    labels.push(labelObj);

    return { mesh, hitMesh, meta, entry, labelObj };
  } catch (err) {
    console.error('場景巨礫生成失敗:', err);
    return null;
  }
}

function createGeologyMesh(type, seed, input, posX = 0, posZ = 0) {
  try {
    if (type === 'boulder') {
      return createSceneBoulderMesh(seed, posX, posZ);
    }
    let actualType = type;
    if (type === 'auto') {
      actualType = pickAutoGeologyType(seed, input);
    }
    const spec = GEOLOGY_TYPES[actualType] || GEOLOGY_TYPES.basalt;
    const isAncient = spec?.lithology === 'manufactured';

    const fullInput = { ...input };
    if (isAncient) {
      const regVal = document.querySelector('#geo-region')?.value || 'all';
      const regions = Object.keys(ANCIENT_REGIONS);
      fullInput.region = regVal === 'all' ? regions[Math.abs(seed) % regions.length] : regVal;
      const ruinType = document.querySelector('#geo-ruin-type')?.value;
      const ruinTypes = Object.keys(ANCIENT_RUINS);
      if (ruinType === 'all') {
        fullInput.ruinType = ruinTypes[Math.abs(seed) % ruinTypes.length];
      } else if (ruinType && ruinType !== 'auto' && Object.hasOwn(ANCIENT_RUINS, ruinType)) {
        fullInput.ruinType = ruinType;
      }
      fullInput.uniformScale = parseFloat(document.querySelector('#geo-scale')?.value) || 1.0;
    }

    const entry = geologyBackgroundObject(actualType, seed, fullInput);
    if (!entry || !entry.meshData) return null;
    const geom = runtimeMeshDataGeometry(entry.meshData, entry.parts);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(posX, 0, posZ);

    const r = Math.max(...entry.bounds.size);
    const hitGeo = new THREE.BoxGeometry(r * 1.1, entry.bounds.max[1], r * 1.1);
    hitGeo.translate(0, entry.bounds.max[1] / 2, 0);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.set(posX, 0, posZ);

    const meta = {
      type: actualType,
      spec,
      seed,
      entry,
      input: fullInput,
      posX, posZ,
      bounds: entry.bounds,
      name: entry.name,
      isAncient,
    };

    mesh.userData.geologyMeta = meta;
    hitMesh.userData.geologyMeta = meta;
    clickableObjects.push(hitMesh);
    geologyGroup.add(mesh);
    geologyGroup.add(hitMesh);

    const badge = document.createElement('div');
    badge.className = 'badge-label';
    badge.innerHTML = '<span class="cat">【' + entry.name + '】</span>' + (spec.group || (isAncient ? '古蹟石材' : '自然地質')) + ' · <span class="height">' + entry.bounds.max[1].toFixed(1) + 'm</span>';
    labelContainer.append(badge);
    const labelObj = { element: badge, point: new THREE.Vector3(posX, entry.bounds.max[1] + 1.5, posZ) };
    labels.push(labelObj);

    return { mesh, hitMesh, meta, entry, labelObj };
  } catch (err) {
    console.error('地質生成失敗:', err);
    return null;
  }
}

function buildGeologyMode() {
  clearScene();
  currentMode = 'geology';
  document.querySelector('#btn-back').style.display = 'none';
  floor.material.color.setHex(0x223038);

  initGeologyOptions();

  const type = document.querySelector('#geo-type').value;
  const viewMode = document.querySelector('#geo-view-mode').value;
  let seed = parseInt(document.querySelector('#input-geo-seed').value, 10) || 42;
  const seedMode = document.querySelector('#select-seed-mode-geo')?.value || 'per_building';
  const climateVal = document.querySelector('#geo-climate').value;
  const waterVal = document.querySelector('#geo-water').value;

  const isAncient = GEOLOGY_TYPES[type]?.lithology === 'manufactured' || type === 'monument' || type === 'ruins';
  const ancientBox = document.querySelector('#geo-ancient-box');
  if (ancientBox) ancientBox.style.display = isAncient ? 'block' : 'none';

  const allTypes = [...Object.keys(GEOLOGY_TYPES), 'boulder'];
  const boundaryGeo = boundaryLayoutOf('geo') === 'boundary';
  const boundaryNote = boundaryGeo ? ' · 邊界沿邊排列（含緩衝區＋透明牆包絡）' : '';
  let pool = allTypes;
  if (climateVal !== 'all' || waterVal !== 'all') {
    const dist = geologyDistribution(getGeologyInputs(seed, 0));
    if (dist.length > 0) pool = [...dist.map(d => d.type), 'boulder'];
  }

  if (viewMode === 'single') {
    const curInput = getGeologyInputs(seed, 0);
    const actType = (type === 'auto'
      ? pickAutoGeologyType(seed, curInput)
      : (type === 'all' ? pool[seed % pool.length] : type));
    const res = withObjectLayout(createGeologyMesh(actType, seed, curInput, 0, 0), 'geo');
    if (!res || !res.entry) return;
    const entry = res.entry;
    const r = Math.max(...entry.bounds.size);
    document.querySelector('#nav-status').textContent = '地質單體檢驗：【' + entry.name + '】（種子碼 ' + seed + boundaryNote + '）';
    camTarget.set(0, entry.bounds.max[1] * 0.4, 0);
    camDist = Math.max(20, r * 1.8);
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  } else {
    const isMatrix = viewMode === 'matrix';
    const matrixPool = (type !== 'all' && type !== 'auto') ? [type] : pool;
    const cols = isMatrix
      ? Math.min(8, Math.max(2, Math.ceil(Math.sqrt(matrixPool.length))))
      : Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-cols-geo')?.value, 10) || 4));
    const rows = isMatrix
      ? Math.ceil(matrixPool.length / cols)
      : Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-rows-geo')?.value, 10) || 4));
    const count = isMatrix ? matrixPool.length : cols * rows;

    const items = [];
    let maxObjW = 10, maxObjD = 10, maxObjH = 6;
    for (let idx = 0; idx < count; idx++) {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const curSeed = getGridSeed(seed, seedMode, c, r, cols, rows, idx);
      const curInput = getGeologyInputs(curSeed, idx);
      const curType = isMatrix
        ? matrixPool[idx]
        : (type === 'all' ? pool[idx % pool.length] : (type === 'auto' ? pickAutoGeologyType(curSeed, curInput) : type));
      const res = withObjectLayout(createGeologyMesh(curType, curSeed, curInput, 0, 0), 'geo');
      if (res && res.entry) {
        const szX = res.entry.bounds.size[0] || 15;
        const szY = res.entry.bounds.size[1] || 8;
        const szZ = res.entry.bounds.size[2] || 15;
        if (szX > maxObjW) maxObjW = szX;
        if (szZ > maxObjD) maxObjD = szZ;
        if (szY > maxObjH) maxObjH = szY;
        items.push({ c, r, res });
      }
    }

    const stepX = Math.max(20, Math.ceil(maxObjW * 1.35 + 8));
    const stepZ = Math.max(20, Math.ceil(maxObjD * 1.35 + 8));
    const startX = -(cols - 1) * stepX / 2;
    const startZ = -(rows - 1) * stepZ / 2;

    for (const it of items) {
      const posX = startX + it.c * stepX;
      const posZ = startZ + it.r * stepZ;
      it.res.mesh.position.set(posX, 0, posZ);
      if (it.res.hitMesh) {
        it.res.hitMesh.position.set(posX, 0, posZ);
      }
      it.res.meta.posX = posX;
      it.res.meta.posZ = posZ;
      if (it.res.labelObj) {
        it.res.labelObj.point.set(posX, it.res.entry.bounds.max[1] + 1.5, posZ);
      }
    }

    document.querySelector('#nav-status').textContent = (isMatrix ? '地質全型錄陳列' : '地質陣列檢驗') + ' (' + cols + '×' + rows + ' 共 ' + items.length + ' 處）：【' + (boundaryGeo ? '巨石巨礫邊界排列' : (type === 'all' ? '全部地質輪播' : type === 'boulder' ? '巨石巨礫' : GEOLOGY_TYPES[type]?.name || '地質陣列')) + '】（基底種子 ' + seed + boundaryNote + '）';
    const totalW = (cols - 1) * stepX + maxObjW;
    const totalD = (rows - 1) * stepZ + maxObjD;
    camTarget.set(0, maxObjH * 0.4, 0);
    camDist = Math.max(totalW, totalD, maxObjH * 1.5) * 1.25 + 15;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  }
  updateCamera();
  render();
}

// ==========================================
// 植物生成邏輯 (Plants & Forest Generation Mode)
// ==========================================
const PLANT_NAMES = {
  redwood: '加州紅杉', sequoia: '巨杉', euc: '杏仁尤加利', dougfir: '花旗松',
  spruce: '錫特卡雲杉', shorea: '娑羅雙', taiwania: '台灣杉', angelim: '巴西巨木',
  araucaria: '南洋杉', tualang: '甘巴豆', alerce: '智利柏', forestBamboo: '叢生竹林',
  rhododendron: '高山杜鵑', banyan: '孟加拉榕樹', scrubOak: '灌木櫟', holmOak: '冬青櫟',
  willow: '垂柳', juniper: '刺柏', mangroveGrey: '海茄苳紅樹', coconut: '可可椰子', baobab: '猴麵包樹',
  gianttree: '神木巨木', fallentree: '倒木橫幹',
};

const cylGeoFactory = (rt, rb, h, n, sec) => new THREE.CylinderGeometry(rt, rb, h, Math.max(5, n || 6), Math.max(1, sec || 1));
const icoGeoFactory = (radius) => new THREE.IcosahedronGeometry(Math.max(0.1, radius), 1);

function createSceneTreeObject(type, seed, season = 'summer', posX = 0, posZ = 0) {
  const rows = environmentParts(type, { seed, season });
  const group = assembleEnvironmentParts(rows, false);
  group.position.set(posX, 0, posZ);
  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const tree = { h: size.y, footprint: Math.max(size.x, size.z) / 2, parts: [] };
  const spec = { form: '場景獨立物件', name: PLANT_NAMES[type] || type };

  const hitH = Math.max(4, tree.h);
  const hitR = Math.max(2, tree.footprint);
  const hitGeo = new THREE.CylinderGeometry(hitR * 0.9, hitR, hitH, 8);
  hitGeo.translate(0, hitH / 2, 0);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  group.add(hitMesh);

  const meta = {
    type,
    name: PLANT_NAMES[type] || type,
    spec,
    tree,
    seed,
    season,
    scale: 1,
    posX, posZ,
    sceneKind: true,
  };

  group.userData.plantMeta = meta;
  hitMesh.userData.plantMeta = meta;
  clickableObjects.push(hitMesh);
  plantGroup.add(group);

  const badge = document.createElement('div');
  badge.className = 'badge-label';
  badge.innerHTML = '<span class="cat">【' + (PLANT_NAMES[type] || type) + '】</span>場景巨木 · <span class="height">' + tree.h.toFixed(1) + 'm</span>';
  labelContainer.appendChild(badge);
  const labelObj = { element: badge, point: new THREE.Vector3(posX, tree.h + 1.5, posZ) };
  labels.push(labelObj);

  return { group, tree, spec, meta, labelObj };
}

function createPlantObject(type, seed, scale = 1, season = 'summer', posX = 0, posZ = 0) {
  if (type === 'gianttree' || type === 'fallentree') {
    return createSceneTreeObject(type, seed, season, posX, posZ);
  }
  let actualType = type;
  if (type === 'auto') {
    const lat = parseFloat(document.querySelector('#plant-lat').value) || 35;
    const alt = parseFloat(document.querySelector('#plant-altitude').value) || 500;
    const climVal = document.querySelector('#plant-climate')?.value || 'all';
    const climPool = ['temperate', 'tropical', 'boreal', 'arid', 'mediterranean', 'alpine'];
    const clim = climVal === 'all' ? climPool[Math.abs(seed) % climPool.length] : climVal;
    const env = forestEnvironment(lat, alt, {
      climate: clim,
      moisture: parseFloat(document.querySelector('#plant-moisture').value) || 0.6,
      ph: parseFloat(document.querySelector('#plant-ph').value) || 6.5,
      salinity: parseFloat(document.querySelector('#plant-salinity').value) || 0,
    });
    const dist = treeDistribution(lat, alt, 0.5, env);
    actualType = dist.length ? dist[Math.abs(seed) % dist.length].type : 'redwood';
  }

  const spec = TREE_SPECIES[actualType] || TREE_SPECIES.redwood;
  const tree = createForestTree(actualType, seed, cylGeoFactory, icoGeoFactory, scale, season);

  const group = new THREE.Group();
  group.position.set(posX, 0, posZ);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });

  for (const part of tree.parts) {
    const geom = part.g.clone();
    const count = geom.attributes.position.count;
    const col = new THREE.Color(part.c || 0x3d6642);
    const colors = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      colors[k * 3] = col.r;
      colors[k * 3 + 1] = col.g;
      colors[k * 3 + 2] = col.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const partMesh = new THREE.Mesh(geom, mat);
    partMesh.position.set(part.px || 0, part.y || 0, part.pz || 0);
    partMesh.rotation.set(part.rx || 0, part.ry || 0, part.rz || 0);
    partMesh.scale.set(part.sx || 1, part.sy || 1, part.sz || 1);
    group.add(partMesh);
  }

  // 射線偵測代理盒
  const hitH = Math.max(4, tree.h);
  const hitR = Math.max(2, tree.footprint);
  const hitGeo = new THREE.CylinderGeometry(hitR * 0.9, hitR, hitH, 8);
  hitGeo.translate(0, hitH / 2, 0);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  group.add(hitMesh);

  const meta = {
    type: actualType,
    name: PLANT_NAMES[actualType] || actualType,
    spec,
    tree,
    seed,
    season,
    scale,
    posX, posZ,
  };

  group.userData.plantMeta = meta;
  hitMesh.userData.plantMeta = meta;
  clickableObjects.push(hitMesh);
  plantGroup.add(group);

  const badge = document.createElement('div');
  badge.className = 'badge-label';
  badge.innerHTML = '<span class="cat">【' + (PLANT_NAMES[actualType] || actualType) + '】</span>' + spec.form + ' · <span class="height">' + tree.h.toFixed(1) + 'm</span>';
  labelContainer.append(badge);
  const labelObj = { element: badge, point: new THREE.Vector3(posX, tree.h + 1.5, posZ) };
  labels.push(labelObj);

  return { group, tree, spec, meta, labelObj };
}

function buildPlantMode() {
  clearScene();
  currentMode = 'plant';
  document.querySelector('#btn-back').style.display = 'none';
  floor.material.color.setHex(0x324738);

  const type = document.querySelector('#plant-species').value;
  const viewMode = document.querySelector('#plant-view-mode').value;
  const season = document.querySelector('#sim-season')?.value || 'summer';
  const scale = parseFloat(document.querySelector('#plant-scale').value) || 1.0;
  let seed = parseInt(document.querySelector('#input-plant-seed').value, 10) || 1001;
  const seedMode = document.querySelector('#select-seed-mode-plant')?.value || 'per_building';
  const boundaryPlant = boundaryLayoutOf('plant') === 'boundary';
  const boundaryNote = boundaryPlant ? ' · 邊界沿邊排列（含緩衝區＋透明牆包絡）' : '';
  const allSpecies = [...Object.keys(TREE_SPECIES), 'gianttree', 'fallentree'];

  if (viewMode === 'single') {
    const actType = type === 'all' ? allSpecies[Math.abs(seed) % allSpecies.length] : type;
    const { tree, meta } = withObjectLayout(createPlantObject(actType, seed, scale, season, 0, 0), 'plant');
    document.querySelector('#nav-status').textContent = '植物單株形態檢驗：【' + meta.name + '】（' + season + '季，種子 ' + seed + boundaryNote + '）';
    camTarget.set(0, tree.h * 0.4, 0);
    camDist = Math.max(16, tree.h * 1.5, tree.footprint * 3);
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  } else {
    const cols = Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-cols-plant')?.value, 10) || 4));
    const rows = Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-rows-plant')?.value, 10) || 4));

    // 第一階段：生成所有林木物件，量測最大冠幅與高度 (以最大的為主)
    const items = [];
    let maxObjW = 8, maxObjD = 8, maxObjH = 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const curType = type === 'all' ? allSpecies[idx % allSpecies.length] : type;
        const curSeed = getGridSeed(seed, seedMode, c, r, cols, rows, idx);
        const res = withObjectLayout(createPlantObject(curType, curSeed, scale, season, 0, 0), 'plant');
        if (res && res.tree) {
          const szW = (res.tree.footprint || 4) * 2;
          const szH = res.tree.h || 12;
          if (szW > maxObjW) maxObjW = szW;
          if (szW > maxObjD) maxObjD = szW;
          if (szH > maxObjH) maxObjH = szH;
          items.push({ c, r, res });
        }
      }
    }

    // 第二階段：以最大林木尺寸自適應配置陣列間距
    const stepX = Math.max(16, Math.ceil(maxObjW * 1.3 + 6));
    const stepZ = Math.max(16, Math.ceil(maxObjD * 1.3 + 6));
    const startX = -(cols - 1) * stepX / 2;
    const startZ = -(rows - 1) * stepZ / 2;

    for (const it of items) {
      const posX = startX + it.c * stepX;
      const posZ = startZ + it.r * stepZ;
      it.res.group.position.set(posX, 0, posZ);
      it.res.meta.posX = posX;
      it.res.meta.posZ = posZ;
      if (it.res.labelObj) {
        it.res.labelObj.point.set(posX, it.res.tree.h + 1.5, posZ);
      }
    }

    document.querySelector('#nav-status').textContent = '植物陣列檢驗 (' + cols + '×' + rows + ' 共 ' + items.length + ' 株）：【' + (type === 'all' ? '全部樹種輪播' : TREE_SPECIES[type]?.name || type) + '】（' + season + '季 · 基底種子 ' + seed + boundaryNote + '）';
    const totalW = (cols - 1) * stepX + maxObjW;
    const totalD = (rows - 1) * stepZ + maxObjD;
    camTarget.set(0, Math.min(25, maxObjH * 0.35), 0);
    camDist = Math.max(totalW, totalD, maxObjH * 1.5) * 1.25 + 15;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  }
  updateCamera();
  render();
}

function switchTab(tabKey) {
  if (currentTab === tabKey) return;
  currentTab = tabKey;

  document.querySelectorAll('.cat-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });
  document.querySelectorAll('.cat-panel').forEach((panel) => {
    panel.style.display = 'none';
  });

  const titleEl = document.querySelector('#cat-title');
  const descEl = document.querySelector('#cat-desc');
  if (tabKey === 'arch') {
    if (titleEl) titleEl.textContent = '🏛 建築分類與隨機參數展開';
    if (descEl) descEl.textContent = '多維度文化與功能陣列 · 點擊展開 16 組隨機變體 · 懸停數值檢驗';
  } else if (tabKey === 'geology') {
    if (titleEl) titleEl.textContent = '🪨 地質結構與古代遺跡生成';
    if (descEl) descEl.textContent = '21 種地質成因與歷史古蹟結構 · 侵蝕氣候環境模擬 · 16 變體陣列';
  } else if (tabKey === 'plant') {
    if (titleEl) titleEl.textContent = '🌲 林木植物生態與四季物候生成';
    if (descEl) descEl.textContent = '21 種林木形態 · 四季器官物候 · 微氣候適應與群落生態';
  } else if (tabKey === 'vehicle') {
    if (titleEl) titleEl.textContent = '🚗 載具結構與編組試車場';
    if (descEl) descEl.textContent = '單車／整列列車／半聯結車 · 多元用途動力輪圈 · 16 變體陣列';
  } else if (tabKey === 'vessel') {
    if (titleEl) titleEl.textContent = '🚢 艦艇水運與裝載圖鑑';
    if (descEl) descEl.textContent = '真實米制航域船型 · 動態吃水裝載與武器 · 透光水面環境';
  } else if (tabKey === 'industry') {
    if (titleEl) titleEl.textContent = '🏭 場景建物與產業設施簡模';
    if (descEl) descEl.textContent = '住宅高樓 3 · 工業 3 · 採掘 2 · 農牧 2 · 同一種子與陣列規則';
  } else if (tabKey === 'ice') {
    if (titleEl) titleEl.textContent = '❄️ 浮冰與冰山 · 水線與種子';
    if (descEl) descEl.textContent = '海冰冰川冰 2 款 · 簡化水線造型 · 透光水面環境';
  } else if (tabKey === 'infrastructure') {
    if (titleEl) titleEl.textContent = '⚙️ 能源、水產與工程構造';
    if (descEl) descEl.textContent = '風機、光伏、水產養殖、海岸與防護工程 · 同源模組與邊界排列';
  } else if (tabKey === 'env') {
    if (titleEl) titleEl.textContent = '🌐 邊界構造 · 連續陡坡接縫';
    if (descEl) descEl.textContent = '56 款邊界障礙 · 固定尺寸權威碰撞 · 陡坡緩坡平地水域';
  }

  const activePanel = document.querySelector('#panel-' + (tabKey === 'infrastructure' ? 'env' : tabKey));
  if (activePanel) activePanel.style.display = 'block';

  if (tabKey === 'arch') {
    buildMatrixMode({ advance: false });
  } else if (tabKey === 'geology') {
    buildGeologyMode();
  } else if (tabKey === 'plant') {
    buildPlantMode();
  } else if (tabKey === 'vehicle') {
    buildVehicleMode();
  } else if (tabKey === 'vessel') {
    buildVesselMode();
  } else if (tabKey === 'industry') {
    buildIndustryMode();
  } else if (tabKey === 'ice') {
    buildIceMode();
  } else if (tabKey === 'env' || tabKey === 'infrastructure') {
    buildEnvironmentMode();
  }
}

document.querySelectorAll('.cat-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelector('#btn-nav-reset-cam')?.addEventListener('click', resetCameraFocus);
document.querySelector('#btn-reset-cam')?.addEventListener('click', resetCameraFocus);

// 地質控制器事件
document.querySelector('#btn-geo-generate')?.addEventListener('click', () => {
  const mode = document.querySelector('#select-seed-mode-geo')?.value;
  if (mode === 'shared_batch') {
    document.querySelector('#input-geo-seed').value = Math.floor(Math.random() * 90000) + 1000;
  }
  buildGeologyMode();
});
document.querySelector('#btn-geo-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-geo-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildGeologyMode();
});
['#geo-type', '#geo-view-mode', '#geo-climate', '#geo-water', '#geo-region', '#geo-ruin-type', '#geo-scale', '#sample-cols-geo', '#sample-rows-geo', '#select-seed-mode-geo', '#input-geo-seed'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('change', () => {
    const typeVal = document.querySelector('#geo-type')?.value;
    const isAncient = GEOLOGY_TYPES[typeVal]?.lithology === 'manufactured' || typeVal === 'monument' || typeVal === 'ruins';
    const ancientBox = document.querySelector('#geo-ancient-box');
    if (ancientBox) ancientBox.style.display = isAncient ? 'block' : 'none';
    buildGeologyMode();
  });
});
['#geo-scale', '#geo-moisture', '#geo-vegetation', '#geo-conifers', '#geo-exposure', '#geo-slope', '#geo-fault', '#geo-volcanic', '#geo-dissolution', '#geo-geothermal', '#geo-activity'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('input', () => {
    buildGeologyMode();
  });
});

// 植物控制器事件
document.querySelector('#btn-plant-generate')?.addEventListener('click', () => {
  const mode = document.querySelector('#select-seed-mode-plant')?.value;
  if (mode === 'shared_batch') {
    document.querySelector('#input-plant-seed').value = Math.floor(Math.random() * 90000) + 1000;
  }
  buildPlantMode();
});
document.querySelector('#btn-plant-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-plant-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildPlantMode();
});
['#plant-species', '#plant-view-mode', '#plant-season', '#plant-scale', '#plant-climate'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('change', buildPlantMode);
});
['#plant-lat', '#plant-altitude', '#plant-moisture', '#plant-ph', '#plant-salinity'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('input', () => {
    if (document.querySelector('#plant-species').value === 'auto' || document.querySelector('#plant-view-mode').value === 'grove') {
      buildPlantMode();
    }
  });
});

// 建築 UI 控制事件
const dimLabels = document.querySelectorAll('.dim-cb-label');
dimLabels.forEach((label) => {
  const cb = label.querySelector('input');
  cb.addEventListener('change', () => {
    const val = cb.value;
    if (cb.checked) {
      if (selectedDims.length >= 2) {
        const unselected = selectedDims.shift();
        const uncheckCb = document.querySelector('.dim-cb-label input[value="' + unselected + '"]');
        if (uncheckCb) {
          uncheckCb.checked = false;
          uncheckCb.parentElement.classList.remove('checked');
        }
      }
      selectedDims.push(val);
      label.classList.add('checked');
    } else {
      if (selectedDims.length <= 1) {
        cb.checked = true;
        return;
      }
      selectedDims = selectedDims.filter((d) => d !== val);
      label.classList.remove('checked');
      dimCycleOffsets[val] = 0;
    }
    document.querySelector('#dim-count-badge').textContent = '已選 ' + selectedDims.length + ' / 2 維度';
    buildMatrixMode({ advance: false });
  });
});

document.querySelector('#btn-generate').addEventListener('click', () => {
  const btn = document.querySelector('#btn-generate');
  btn.textContent = '⚡ 生成中...';
  setTimeout(() => {
    try {
      buildMatrixMode({ advance: true });
    } catch (err) {
      console.error('生成建築陣列失敗:', err);
      alert('生成建築陣列時發生錯誤: ' + (err.message || err));
    } finally {
      btn.textContent = '⚡ 生成建築陣列';
    }
  }, 10);
});

document.querySelector('#btn-randomize').addEventListener('click', () => {
  const newSeed = Math.floor(Math.random() * 90000) + 1000;
  const input = document.querySelector('#input-seed');
  if (input) input.value = newSeed;
  Object.keys(dimCycleOffsets).forEach((k) => {
    dimCycleOffsets[k] = Math.floor(Math.random() * (DIM_COLLECTIONS[k]?.items.length || 10));
  });
  try {
    buildMatrixMode({ advance: false });
  } catch (err) {
    console.error('隨機種子生成失敗:', err);
  }
});

document.querySelector('#input-seed').addEventListener('change', () => {
  if (currentMode === 'matrix') {
    buildMatrixMode({ advance: false });
  } else if (variantTargetMeta) {
    variantTargetMeta.seed = parseInt(document.querySelector('#input-seed').value, 10) || 5000;
    buildVariantsMode(variantTargetMeta);
  }
});

['#sample-dim-a', '#sample-dim-b', '#chk-sample-all', '#select-seed-mode'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('change', () => {
    if (currentMode === 'matrix') buildMatrixMode({ advance: false });
  });
});

document.querySelector('#btn-regen-variants').addEventListener('click', () => {
  if (variantTargetMeta) {
    variantTargetMeta.seed = Math.floor(Math.random() * 90000) + 1000;
    const input = document.querySelector('#input-seed');
    if (input) input.value = variantTargetMeta.seed;
    buildVariantsMode(variantTargetMeta);
  }
});

document.querySelector('#btn-back').addEventListener('click', () => {
  if (currentTab === 'arch') buildMatrixMode({ advance: false });
  else if (currentTab === 'geology') buildGeologyMode();
  else if (currentTab === 'plant') buildPlantMode();
});

document.querySelector('#chk-roads').addEventListener('change', () => {
  roadGroup.visible = document.querySelector('#chk-roads').checked;
  render();
});

document.querySelector('#chk-labels').addEventListener('change', () => {
  const checked = document.querySelector('#chk-labels').checked;
  labelContainer.style.display = checked ? 'block' : 'none';
  render();
});

document.querySelector('#btn-reset-cam')?.addEventListener('click', resetCameraFocus);

// 篩選池功能
function setupFilterModal() {
  const grid = document.querySelector('#filter-grid');
  const stat = document.querySelector('#filter-stat');
  if (!grid || !stat) return;

  grid.innerHTML = '';
  let totalItems = 0;
  const colInputs = {};

  const updateStat = () => {
    let enabledCount = 0;
    Object.values(enabledDimItems).forEach((set) => { enabledCount += set.size; });
    stat.textContent = '已啟用特徵項目：' + enabledCount + ' / ' + totalItems + ' 款';
  };

  Object.entries(DIM_COLLECTIONS).forEach(([dimKey, col]) => {
    colInputs[dimKey] = [];
    const colDiv = document.createElement('div');
    colDiv.className = 'filter-cat-col';

    const header = document.createElement('div');
    header.className = 'filter-cat-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'filter-cat-name';
    nameSpan.textContent = col.name + ' (' + col.items.length + ')';
    header.appendChild(nameSpan);

    const actions = document.createElement('div');
    actions.className = 'filter-cat-actions';

    const btnAll = document.createElement('button');
    btnAll.className = 'btn-cat-act';
    btnAll.textContent = '全選';
    btnAll.addEventListener('click', () => {
      col.items.forEach((it) => enabledDimItems[dimKey].add(it.key));
      colInputs[dimKey].forEach(({ cb, label }) => {
        cb.checked = true;
        label.classList.add('selected');
      });
      updateStat();
    });

    const btnClear = document.createElement('button');
    btnClear.className = 'btn-cat-act';
    btnClear.textContent = '全清';
    btnClear.addEventListener('click', () => {
      enabledDimItems[dimKey].clear();
      colInputs[dimKey].forEach(({ cb, label }) => {
        cb.checked = false;
        label.classList.remove('selected');
      });
      updateStat();
    });

    actions.appendChild(btnAll);
    actions.appendChild(btnClear);
    header.appendChild(actions);
    colDiv.appendChild(header);

    const list = document.createElement('div');
    list.className = 'filter-cat-list';

    col.items.forEach((it) => {
      totalItems++;
      const isChecked = enabledDimItems[dimKey].has(it.key);

      const label = document.createElement('label');
      label.className = 'filter-item-cb' + (isChecked ? ' selected' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          enabledDimItems[dimKey].add(it.key);
          label.classList.add('selected');
        } else {
          enabledDimItems[dimKey].delete(it.key);
          label.classList.remove('selected');
        }
        updateStat();
      });

      label.appendChild(cb);
      label.appendChild(document.createTextNode(it.label));
      list.appendChild(label);
      colInputs[dimKey].push({ cb, label, key: it.key });
    });

    colDiv.appendChild(list);
    grid.appendChild(colDiv);
  });

  updateStat();

  document.querySelector('#btn-filter-reset')?.addEventListener('click', () => {
    Object.entries(DIM_COLLECTIONS).forEach(([k, col]) => {
      col.items.forEach((it) => enabledDimItems[k].add(it.key));
      colInputs[k]?.forEach(({ cb, label }) => {
        cb.checked = true;
        label.classList.add('selected');
      });
    });
    updateStat();
  });
}

const filterModal = document.querySelector('#filter-modal');
document.querySelector('#btn-open-filter')?.addEventListener('click', () => {
  if (filterModal) filterModal.style.display = 'flex';
});
document.querySelector('#btn-close-filter')?.addEventListener('click', () => {
  if (filterModal) filterModal.style.display = 'none';
});
filterModal?.addEventListener('click', (e) => {
  if (e.target === filterModal) filterModal.style.display = 'none';
});
document.querySelector('#btn-filter-apply')?.addEventListener('click', () => {
  if (filterModal) filterModal.style.display = 'none';
  buildMatrixMode({ advance: false });
});
document.querySelector('#btn-full-random')?.addEventListener('click', () => {
  buildFullRandomMode();
});


// ==========================================
// 車輛生成器邏輯
// ==========================================
let vehicleInitialized = false;
function initVehicleOptions() {
  if (vehicleInitialized) return;
  vehicleInitialized = true;
  for (const [key, label] of Object.entries(VEHICLE_AXES.purpose)) {
    document.querySelector('#veh-purpose').add(new Option(label, key));
  }
  for (const [key, label] of Object.entries(VEHICLE_AXES.type)) {
    document.querySelector('#veh-type').add(new Option(label, key));
  }
  for (const [key, label] of Object.entries(VEHICLE_AXES.power)) {
    document.querySelector('#veh-power').add(new Option(label, key));
  }
  updateVehicleFilter();
}

function updateVehicleFilter() {
  const mode = document.querySelector('#veh-formation').value;
  const couplingBox = document.querySelector('#veh-coupling-box');
  if (couplingBox) couplingBox.style.display = mode === 'single' ? 'none' : 'block';
  document.querySelector('#veh-type').disabled = mode !== 'single';
  document.querySelector('#veh-power').disabled = mode !== 'single';

  const filters = {};
  const pur = document.querySelector('#veh-purpose').value;
  const typ = document.querySelector('#veh-type').value;
  const pow = document.querySelector('#veh-power').value;
  if (pur) filters.purpose = pur;
  if (typ) filters.type = typ;
  if (pow) filters.power = pow;

  const profSelect = document.querySelector('#veh-profile');
  const prevVal = profSelect.value;
  profSelect.innerHTML = '';

  if (mode === 'single') {
    profSelect.add(new Option('全部車型輪播 (All Models)', 'all'));
    const candidates = vehicleCandidates(filters);
    for (const key of candidates) {
      profSelect.add(new Option(VEHICLE_PROFILES[key].name, key));
    }
  } else {
    profSelect.add(new Option('全部編組輪播 (All Consists)', 'all'));
    for (const [k, p] of Object.entries(VEHICLE_CONSISTS)) {
      if (p.mode === mode && (!filters.purpose || p.purpose === filters.purpose)) {
        profSelect.add(new Option(p.name, CONSIST_PREFIX + k));
      }
    }
  }
  if (prevVal && [...profSelect.options].some(o => o.value === prevVal)) {
    profSelect.value = prevVal;
  } else {
    profSelect.value = 'all';
  }
  updateVehicleCoupling();
}

function updateVehicleCoupling() {
  const profKey = document.querySelector('#veh-profile').value;
  if (!profKey || !profKey.startsWith(CONSIST_PREFIX)) return;
  const recipe = VEHICLE_CONSISTS[profKey.slice(CONSIST_PREFIX.length)];
  if (recipe) {
    const leaderSel = document.querySelector('#veh-leader');
    leaderSel.innerHTML = '';
    for (const k of recipe.leaders) leaderSel.add(new Option(VEHICLE_PROFILES[k].name, k));
    const wagonSel = document.querySelector('#veh-wagon');
    wagonSel.innerHTML = '';
    wagonSel.add(new Option('按產業配方自動編組', ''));
    for (const k of recipe.wagons) wagonSel.add(new Option(VEHICLE_PROFILES[k].name, k));
    const countInput = document.querySelector('#veh-count');
    countInput.min = recipe.count[0];
    countInput.max = recipe.count[1];
    countInput.disabled = recipe.mode === 'semi';
    countInput.value = Math.min(recipe.count[1], Math.max(recipe.count[0], Number(countInput.value)));
  }
}

function createVehicleInstance(profileKey, seed, options, posX = 0, posZ = 0) {
  try {
    const sceneFit = !options.leaderKey && document.querySelector('#chk-veh-scene-fit')?.checked;
    const model = makeProceduralVehicle(profileKey, seed, sceneFit ? { ...options, fit: { L: 4.8, H: 1.8, W: 2.2 } } : options);
    model.position.set(posX, 0, posZ);
    vehicleGroup.add(model);
    const v = model.userData.vehicle;
    const meta = {
      posX, posZ,
      seed,
      vehicle: v,
      name: v.name,
      formation: options.leaderKey ? 'consist' : 'single',
      length: v.length,
      width: v.width,
      height: v.height,
    };
    model.traverse((o) => {
      if (o.isMesh) {
        o.userData.vehicleMeta = meta;
        clickableObjects.push(o);
      }
    });
    const badge = document.createElement('div');
    badge.className = 'badge-label';
    badge.innerHTML = '<span class="cat">🚗</span>' + v.name + (sceneFit ? ' · 場景包絡' : '') + ' <span class="height">' + v.length.toFixed(1) + 'm</span>';
    labelContainer.appendChild(badge);
    const labelObj = { element: badge, point: new THREE.Vector3(posX, (v.height || 2) + 1.2, posZ) };
    labels.push(labelObj);
    return { model, meta, vehicle: v, labelObj };
  } catch (err) {
    console.error('車輛生成失敗:', err);
    return null;
  }
}

function buildVehicleMode() {
  clearScene();
  currentMode = 'vehicle';
  document.querySelector('#btn-back').style.display = 'none';
  floor.material.color.setHex(0x273649);

  initVehicleOptions();

  const formation = document.querySelector('#veh-formation').value;
  const profileKey = document.querySelector('#veh-profile').value;
  const viewMode = document.querySelector('#veh-view-mode').value;
  const seed = parseInt(document.querySelector('#input-veh-seed').value, 10) || 42;
  const seedMode = document.querySelector('#select-seed-mode-veh')?.value || 'per_building';
  const boundaryVeh = boundaryLayoutOf('veh') === 'boundary';
  const boundaryNote = boundaryVeh ? ' · 邊界沿邊排列（含緩衝區＋透明牆包絡）' : '';

  const allProfiles = Object.keys(VEHICLE_PROFILES);
  const candidates = (formation === 'single' || formation === 'all') ? vehicleCandidates(
    Object.fromEntries(['purpose', 'type', 'power'].filter(k => document.querySelector('#veh-' + k).value).map(k => [k, document.querySelector('#veh-' + k).value]))
  ) : [];
  const pool = candidates.length > 0 ? candidates : allProfiles;
  const consistPool = Object.keys(VEHICLE_CONSISTS).filter(k => VEHICLE_CONSISTS[k].mode === formation);

  let actProf = profileKey;
  if (profileKey === 'all' || !profileKey) {
    if (formation === 'single' || formation === 'all') {
      actProf = pool[seed % pool.length];
    } else {
      actProf = consistPool.length > 0 ? CONSIST_PREFIX + consistPool[seed % consistPool.length] : allProfiles[seed % allProfiles.length];
    }
  }

  const recipe = actProf.startsWith(CONSIST_PREFIX) ? VEHICLE_CONSISTS[actProf.slice(CONSIST_PREFIX.length)] : null;
  const options = (formation === 'single' || formation === 'all' || !recipe)
    ? Object.fromEntries(['purpose', 'type', 'power'].filter(k => document.querySelector('#veh-' + k).value).map(k => [k, document.querySelector('#veh-' + k).value]))
    : {
        leaderKey: document.querySelector('#veh-leader').value || recipe.leaders[0],
        wagonCount: Number(document.querySelector('#veh-count').value) || recipe.count[0],
        wagonKey: document.querySelector('#veh-wagon').value || undefined,
      };

  if (viewMode === 'single') {
    const res = withObjectLayout(createVehicleInstance(actProf, seed, options, 0, 0), 'veh');
    if (!res) return;
    const v = res.vehicle;
    document.querySelector('#nav-status').textContent = '車輛單體檢驗：【' + v.name + '】（種子碼 ' + seed + ' · 長 ' + v.length.toFixed(1) + 'm 寬 ' + v.width.toFixed(1) + 'm 高 ' + v.height.toFixed(1) + 'm' + boundaryNote + '）';
    camTarget.set(0, v.height * 0.4, 0);
    camDist = Math.max(...(res.layoutSize || [v.length, v.width, v.height])) * 2.2 + 6;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  } else {
    const cols = Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-cols-veh')?.value, 10) || 4));
    const rows = Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-rows-veh')?.value, 10) || 4));
    clearScene();
    floor.visible = true;

    // 第一階段：生成所有車輛實例，量測最大長度與寬度 (以最大的為主)
    const items = [];
    let maxObjW = 2.4, maxObjD = 5.0, maxObjH = 2.0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const curSeed = getGridSeed(seed, seedMode, c, r, cols, rows, idx);
        let curProf = actProf;
        let curOptions = options;
        if (profileKey === 'all' || !profileKey) {
          if (formation === 'single' || formation === 'all') {
            curProf = pool[idx % pool.length];
          } else if (consistPool.length > 0) {
            curProf = CONSIST_PREFIX + consistPool[idx % consistPool.length];
            const cRecipe = VEHICLE_CONSISTS[curProf.slice(CONSIST_PREFIX.length)];
            curOptions = {
              leaderKey: document.querySelector('#veh-leader').value || (cRecipe ? cRecipe.leaders[0] : undefined),
              wagonCount: Number(document.querySelector('#veh-count').value) || (cRecipe ? cRecipe.count[0] : 1),
              wagonKey: document.querySelector('#veh-wagon').value || undefined,
            };
          }
        }
        const res = withObjectLayout(createVehicleInstance(curProf, curSeed, curOptions, 0, 0), 'veh');
        if (res && res.vehicle) {
          const v = res.vehicle;
          maxObjW = Math.max(maxObjW, res.layoutSize?.[0] || v.width);
          maxObjD = Math.max(maxObjD, res.layoutSize?.[2] || v.length);
          if (v.height > maxObjH) maxObjH = v.height;
          items.push({ c, r, res });
        }
      }
    }

    // 第二階段：以最大車輛尺寸為基準配置網格步距
    const stepX = Math.max(10, Math.ceil(maxObjW * 1.8 + 6));
    const stepZ = Math.max(14, Math.ceil(maxObjD * 1.25 + 8));
    const startX = -(cols - 1) * stepX / 2;
    const startZ = -(rows - 1) * stepZ / 2;

    for (const it of items) {
      const posX = startX + it.c * stepX;
      const posZ = startZ + it.r * stepZ;
      it.res.model.position.set(posX, 0, posZ);
      it.res.meta.posX = posX;
      it.res.meta.posZ = posZ;
      if (it.res.labelObj) {
        it.res.labelObj.point.set(posX, (it.res.vehicle.height || 2) + 1.2, posZ);
      }
    }

    document.querySelector('#nav-status').textContent = '車輛陣列檢驗 (' + cols + '×' + rows + ' 共 ' + items.length + ' 輛）：【' + (profileKey === 'all' ? '全部車型輪播' : VEHICLE_PROFILES[actProf]?.name || actProf) + '】（基底種子 ' + seed + boundaryNote + '）';
    const totalW = (cols - 1) * stepX + maxObjW;
    const totalD = (rows - 1) * stepZ + maxObjD;
    camTarget.set(0, Math.min(15, maxObjH * 0.4), 0);
    camDist = Math.max(totalW, totalD, maxObjH * 1.8) * 1.25 + 12;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  }
  updateCamera();
  render();
}

let vesselInitialized = false;
function initVesselOptions() {
  if (vesselInitialized) return;
  vesselInitialized = true;
  for (const [key, label] of Object.entries(VESSEL_AXES.purpose)) {
    document.querySelector('#vessel-purpose').add(new Option(label, key));
  }
  for (const [key, label] of Object.entries(VESSEL_AXES.waters)) {
    document.querySelector('#vessel-water').add(new Option(label, key));
  }
  for (const [key, label] of Object.entries(VESSEL_AXES.power)) {
    document.querySelector('#vessel-power').add(new Option(label, key));
  }
  updateVesselFilter();
}

function updateVesselFilter() {
  const pur = document.querySelector('#vessel-purpose')?.value || '';
  const wat = document.querySelector('#vessel-water')?.value || '';
  const pow = document.querySelector('#vessel-power')?.value || '';

  const candidates = VESSEL_TYPES.filter(t =>
    (!pur || t.purpose === pur) &&
    (!wat || t.waters.includes(wat)) &&
    (!pow || t.power.includes(pow))
  );

  const typeSel = document.querySelector('#vessel-type');
  if (!typeSel) return;
  const prevVal = typeSel.value;
  typeSel.innerHTML = '';
  typeSel.add(new Option('全部船型輪播 (All Vessels)', 'all'));
  for (const t of candidates) {
    typeSel.add(new Option(t.name, t.id));
  }
  if (![...typeSel.options].some(o => o.value === 'strandedship')) {
    typeSel.add(new Option('擱淺船 (場景簡模)', 'strandedship'));
  }
  if (prevVal && [...typeSel.options].some(o => o.value === prevVal)) {
    typeSel.value = prevVal;
  } else {
    typeSel.value = 'all';
  }
}

function createStrandedShipInstance(seed, posX = 0, posZ = 0) {
  const rows = environmentParts('strandedship', { seed });
  const model = assembleEnvironmentParts(rows, false);
  model.position.set(posX, 0, posZ);
  vesselGroup.add(model);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const v = {
    name: '擱淺船', registry: '場景簡模',
    length: size.x, beam: size.z, height: size.y,
    draft: 0, freeboard: size.y, displacementTonnes: 0, speedKnots: 0,
    sceneKind: true,
  };
  const meta = {
    posX, posZ,
    seed,
    vessel: v,
    name: v.name,
    length: v.length,
    beam: v.beam,
    draft: v.draft,
    displacement: 0,
    speed: 0,
    sceneKind: true,
  };
  model.traverse((o) => {
    if (o.isMesh) {
      o.userData.vesselMeta = meta;
      clickableObjects.push(o);
    }
  });
  const badge = document.createElement('div');
  badge.className = 'badge-label';
  badge.innerHTML = '<span class="cat">🚢</span>' + v.name + ' · 場景簡模 <span class="height">' + v.length.toFixed(1) + 'm</span>';
  labelContainer.appendChild(badge);
  const labelObj = { element: badge, point: new THREE.Vector3(posX, size.y + 2, posZ) };
  labels.push(labelObj);
  return { model, meta, vessel: v, labelObj };
}

function createVesselInstance(seed, options, posX = 0, posZ = 0) {
  try {
    if (options.id === 'strandedship') {
      return createStrandedShipInstance(seed, posX, posZ);
    }
    const v = generateVessel(seed, options);
    if (!v) return null;
    const model = buildGeneratedVesselMesh(v, { wake: false });
    model.position.set(posX, 0, posZ);
    vesselGroup.add(model);
    const meta = {
      posX, posZ,
      seed,
      vessel: v,
      name: v.name,
      length: v.length,
      beam: v.beam,
      draft: v.draft,
      displacement: v.displacementTonnes,
      speed: v.speedKnots,
    };
    model.traverse((o) => {
      if (o.isMesh) {
        o.userData.vesselMeta = meta;
        clickableObjects.push(o);
      }
    });
    const badge = document.createElement('div');
    badge.className = 'badge-label';
    badge.innerHTML = '<span class="cat">🚢</span>' + v.name + ' <span class="height">' + v.length.toFixed(1) + 'm</span>';
    labelContainer.appendChild(badge);
    const vesselTopY = Math.max(v.beam * 0.5 + 2, (v.freeboard || 2) + (v.beam || 5) * 0.4 + 2);
    const labelObj = { element: badge, point: new THREE.Vector3(posX, vesselTopY, posZ) };
    labels.push(labelObj);
    return { model, meta, vessel: v, labelObj };
  } catch (err) {
    console.error('船隻生成失敗:', err);
    return null;
  }
}

function buildVesselMode() {
  clearScene();
  currentMode = 'vessel';
  document.querySelector('#btn-back').style.display = 'none';

  initVesselOptions();

  const type = document.querySelector('#vessel-type').value;
  const viewMode = document.querySelector('#vessel-view-mode').value;
  const seed = parseInt(document.querySelector('#input-vessel-seed').value, 10) || 42;
  const seedMode = document.querySelector('#select-seed-mode-vessel')?.value || 'per_building';
  const showWater = document.querySelector('#chk-vessel-water').checked;
  const boundaryVessel = boundaryLayoutOf('vessel') === 'boundary';
  const boundaryNote = boundaryVessel ? ' · 邊界沿邊排列（含緩衝區＋透明牆包絡）' : '';

  const options = Object.fromEntries(
    ['purpose', 'water', 'power']
      .filter(k => document.querySelector('#vessel-' + k).value)
      .map(k => [k, document.querySelector('#vessel-' + k).value])
  );

  const allVesselTypes = VESSEL_TYPES.map(t => t.id);
  const candidates = VESSEL_TYPES.filter(t =>
    (!options.purpose || t.purpose === options.purpose) &&
    (!options.water || t.waters.includes(options.water)) &&
    (!options.power || t.power.includes(options.power))
  ).map(t => t.id);

  const pool = candidates.length > 0 ? candidates : allVesselTypes;
  if ((type === 'all' || !type) && !pool.includes('strandedship')) pool.push('strandedship');

  if (viewMode === 'single') {
    const actType = ((type === 'all' || !type) ? pool[seed % pool.length] : type);
    const actOptions = { ...options, id: actType };
    let res = createVesselInstance(seed, actOptions, 0, 0);
    if (!res) res = createVesselInstance(seed, { id: actType }, 0, 0);
    res = withObjectLayout(res, 'vessel');
    if (!res) return;
    const v = res.vessel;
    document.querySelector('#nav-status').textContent = '艦船單體檢驗：【' + v.name + ' · ' + v.registry + '】（種子 ' + seed + ' · 長 ' + v.length.toFixed(1) + 'm 寬 ' + v.beam.toFixed(1) + 'm 吃水 ' + v.draft.toFixed(2) + 'm · ' + v.displacementTonnes.toFixed(1) + 't' + boundaryNote + '）';
    camTarget.set(0, v.beam * 0.3, 0);
    camDist = Math.max(...(res.layoutSize || [v.length]), 30) * 1.8 + 10;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  } else {
    const cols = Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-cols-vessel')?.value, 10) || 4));
    const rows = Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-rows-vessel')?.value, 10) || 4));
    clearScene();
    waterMesh.visible = showWater;
    floor.visible = !showWater;

    // 第一階段：生成所有船隻實例，量測最大艦長與船寬 (以最大的為主)
    const items = [];
    let maxObjW = 8, maxObjD = 35, maxObjH = 15;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const curSeed = getGridSeed(seed, seedMode, c, r, cols, rows, idx);
        const curType = ((type === 'all' || !type) ? pool[idx % pool.length] : type);
        const curOptions = { ...options, id: curType };
        let res = createVesselInstance(curSeed, curOptions, 0, 0);
        if (!res) {
          // 若複合條件無完全符合者，放寬為單純依類型生成，確保物件正常陳列
          res = createVesselInstance(curSeed, { id: curType }, 0, 0);
        }
        res = withObjectLayout(res, 'vessel');
        if (res && res.vessel) {
          const v = res.vessel;
          maxObjW = Math.max(maxObjW, res.layoutSize?.[0] || v.beam);
          maxObjD = Math.max(maxObjD, res.layoutSize?.[2] || v.length);
          if ((v.height || v.beam) > maxObjH) maxObjH = (v.height || v.beam);
          items.push({ c, r, res });
        }
      }
    }

    // 第二階段：以最大艦長與船寬配置網格步距
    const stepX = Math.max(25, Math.ceil(maxObjW * 2.2 + 12));
    const stepZ = Math.max(35, Math.ceil(maxObjD * 1.35 + 16));
    const startX = -(cols - 1) * stepX / 2;
    const startZ = -(rows - 1) * stepZ / 2;

    for (const it of items) {
      const posX = startX + it.c * stepX;
      const posZ = startZ + it.r * stepZ;
      it.res.model.position.set(posX, 0, posZ);
      it.res.meta.posX = posX;
      it.res.meta.posZ = posZ;
      if (it.res.labelObj) {
        const v = it.res.vessel;
        const vesselTopY = Math.max(v.beam * 0.5 + 2, (v.freeboard || 2) + (v.beam || 5) * 0.4 + 2);
        it.res.labelObj.point.set(posX, vesselTopY, posZ);
      }
    }

    document.querySelector('#nav-status').textContent = '艦船陣列檢驗 (' + cols + '×' + rows + ' 共 ' + items.length + ' 艘）：【' + (type && type !== 'all' ? (type === 'strandedship' ? '擱淺船' : VESSEL_TYPES.find(t => t.id === type)?.name) : '全部船型輪播') + '】（基底種子 ' + seed + boundaryNote + '）';
    const totalW = (cols - 1) * stepX + maxObjW;
    const totalD = (rows - 1) * stepZ + maxObjD;
    camTarget.set(0, Math.min(25, maxObjH * 0.4), 0);
    camDist = Math.max(totalW, totalD, maxObjH * 1.5) * 1.25 + 20;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  }
  updateCamera();
  render();
}

// ==========================================
// 場景建物與產業設施 (Industry Mode)
// ==========================================
// 收容 environmentCatalog 10 種人造物：住宅 1、高樓 2、工業 3、採掘 2、農牧 2。
// 生成器與遊戲共用 environmentParts 單一入口；此處僅套用與各頁籤一致的
// 種子規則 (getGridSeed)、陣列/單體/目錄展示與兩階段量測佈局。
const INDUSTRY_KINDS = ['house', 'skyscraper', 'skyfall', 'factory', 'powerplant', 'incinerator', 'mine', 'oilfield', 'greenhouse', 'ranch'];
const INDUSTRY_LABELS = {
  house: '住家', skyscraper: '摩天樓', skyfall: '倒塌高樓',
  factory: '工廠', powerplant: '電廠', incinerator: '焚化廠',
  mine: '礦場', oilfield: '油田', greenhouse: '溫室', ranch: '牧場',
};
const ICE_KINDS = ['icefloe', 'iceberg'];
const ICE_LABELS = { icefloe: '浮冰群', iceberg: '極地冰山' };

function createIndustryInstance(kind, seed, posX = 0, posZ = 0) {
  const season = document.querySelector('#sim-season')?.value || 'summer';
  const bb = boundaryLayoutOf('industry') === 'boundary';
  const rows = environmentParts(kind, { seed, season });
  const model = withObjectLayout({ model: assembleEnvironmentParts(rows, false), meta: { seed } }, 'industry').model;
  model.position.set(posX, 0, posZ);
  industryGroup.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const meta = {
    posX, posZ,
    seed,
    kind,
    label: INDUSTRY_LABELS[kind] || kind,
    partsCount: rows.length,
    size: [size.x, size.y, size.z],
    sceneKind: !bb,
  };

  model.traverse((o) => {
    if (o.isMesh) {
      o.userData.industryMeta = meta;
      clickableObjects.push(o);
    }
  });

  const badge = document.createElement('div');
  badge.className = 'badge-label';
  badge.innerHTML = '<span class="cat">🏭</span>' + meta.label + (bb ? ' · 邊界' : '') + ' <span class="height">' + size.y.toFixed(1) + 'm</span>';
  labelContainer.appendChild(badge);
  labels.push({ element: badge, point: new THREE.Vector3(posX, bounds.max.y + 1.5, posZ) });

  return { model, meta, size, bounds };
}

function buildIndustryMode() {
  clearScene();
  currentMode = 'industry';
  document.querySelector('#btn-back').style.display = 'none';
  waterMesh.visible = false;
  floor.visible = true;
  floor.material.color.setHex(0xbed0bd);

  const kind = document.querySelector('#industry-kind').value;
  const viewMode = document.querySelector('#industry-view-mode').value;
  const seed = parseInt(document.querySelector('#input-industry-seed').value, 10) || 42;
  const seedMode = document.querySelector('#select-seed-mode-industry')?.value || 'per_building';
  const boundaryNote = boundaryLayoutOf('industry') === 'boundary' ? ' · 邊界沿邊排列（含緩衝區＋透明牆包絡）' : '';

  if (viewMode === 'single') {
    const actKind = (kind === 'all' || !kind) ? INDUSTRY_KINDS[seed % INDUSTRY_KINDS.length] : kind;
    const res = createIndustryInstance(actKind, seed, 0, 0);
    if (!res) return;
    document.querySelector('#nav-status').textContent = '設施單體檢驗：【' + res.meta.label + '】（種子碼 ' + seed + ' · ' + res.meta.partsCount + ' 零件 · 尺寸 ' + res.size.x.toFixed(1) + '×' + res.size.y.toFixed(1) + '×' + res.size.z.toFixed(1) + 'm' + boundaryNote + '）';
    camTarget.set(0, res.size.y * 0.4, 0);
    camDist = Math.max(res.size.x, res.size.y, res.size.z) * 2.2 + 8;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  } else {
    const isCatalog = viewMode === 'catalog';
    const listPool = (kind === 'all' || !kind) ? INDUSTRY_KINDS : [kind];
    const cols = isCatalog
      ? Math.min(8, Math.max(2, Math.ceil(Math.sqrt(listPool.length))))
      : Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-cols-industry')?.value, 10) || 4));
    const rows = isCatalog
      ? Math.ceil(listPool.length / cols)
      : Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-rows-industry')?.value, 10) || 4));
    const count = isCatalog ? listPool.length : cols * rows;
    clearScene();
    waterMesh.visible = false;
    floor.visible = true;

    // 第一階段：生成所有設施實例，量測最大長寬高 (以最大的為主)
    const items = [];
    let maxObjW = 10, maxObjD = 10, maxObjH = 8;
    for (let idx = 0; idx < count; idx++) {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const curSeed = getGridSeed(seed, seedMode, c, r, cols, rows, idx);
      const curKind = listPool[idx % listPool.length];
      const season = document.querySelector('#sim-season')?.value || 'summer';
      const curBb = boundaryLayoutOf('industry') === 'boundary';
      const partRows = environmentParts(curKind, { seed: curSeed, season });
      const model = withObjectLayout({ model: assembleEnvironmentParts(partRows, false), meta: { seed: curSeed } }, 'industry').model;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (size.x > maxObjW) maxObjW = size.x;
      if (size.z > maxObjD) maxObjD = size.z;
      if (size.y > maxObjH) maxObjH = size.y;
      items.push({ c, r, idx, curKind, curSeed, model, bounds, size, partRows, curBb });
    }

    // 第二階段：依據最大物件尺寸配置間距
    const stepX = Math.max(20, Math.ceil(maxObjW * 1.35 + 8));
    const stepZ = Math.max(20, Math.ceil(maxObjD * 1.35 + 8));
    const startX = -(cols - 1) * stepX / 2;
    const startZ = -(rows - 1) * stepZ / 2;

    for (const it of items) {
      const posX = startX + it.c * stepX;
      const posZ = startZ + it.r * stepZ;
      it.model.position.set(posX, 0, posZ);
      industryGroup.add(it.model);

      const meta = {
        posX, posZ,
        seed: it.curSeed,
        kind: it.curKind,
        label: INDUSTRY_LABELS[it.curKind] || it.curKind,
        partsCount: it.partRows.length,
        size: [it.size.x, it.size.y, it.size.z],
        sceneKind: !it.curBb,
      };
      it.model.traverse((o) => {
        if (o.isMesh) {
          o.userData.industryMeta = meta;
          clickableObjects.push(o);
        }
      });

      const badge = document.createElement('div');
      badge.className = 'badge-label';
      badge.innerHTML = '<span class="cat">🏭</span>' + meta.label + (it.curBb ? ' · 邊界' : '') + ' <span class="height">' + it.size.y.toFixed(1) + 'm</span>';
      labelContainer.appendChild(badge);
      labels.push({ element: badge, point: new THREE.Vector3(posX, it.bounds.max.y + 1.5, posZ) });
    }

    document.querySelector('#nav-status').textContent = (isCatalog ? '設施全分類目錄陳列' : '設施陣列檢驗') + ' (' + cols + '×' + rows + ' 共 ' + items.length + ' 件）：【' + (kind === 'all' ? '全部款式輪播' : INDUSTRY_LABELS[kind] || kind) + '】（基底種子 ' + seed + boundaryNote + '）';
    const totalW = (cols - 1) * stepX + maxObjW;
    const totalD = (rows - 1) * stepZ + maxObjD;
    camTarget.set(0, Math.min(25, maxObjH * 0.4), 0);
    camDist = Math.max(totalW, totalD, maxObjH * 1.5) * 1.25 + 15;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  }
  updateCamera();
  render();
}

// ==========================================
// 浮冰與冰山 (Ice Mode)
// ==========================================
// 收容 environmentCatalog 海冰/冰川冰 2 款，生成器經 environmentParts 直通 iceParts；
// 水線偏移由 assembleEnvironmentParts 統一處理，水面顯示規則與船隻頁籤一致。
function createIceInstance(kind, seed, posX = 0, posZ = 0) {
  const season = document.querySelector('#sim-season')?.value || 'summer';
  const bb = boundaryLayoutOf('ice') === 'boundary';
  const rows = environmentParts(kind, { seed, season });
  const model = withObjectLayout({ model: assembleEnvironmentParts(rows, true), meta: { seed } }, 'ice').model;
  model.position.set(posX, 0, posZ);
  iceGroup.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const meta = {
    posX, posZ,
    seed,
    kind,
    label: ICE_LABELS[kind] || kind,
    partsCount: rows.length,
    size: [size.x, size.y, size.z],
    sceneKind: !bb,
  };

  model.traverse((o) => {
    if (o.isMesh) {
      o.userData.iceMeta = meta;
      clickableObjects.push(o);
    }
  });

  const badge = document.createElement('div');
  badge.className = 'badge-label';
  badge.innerHTML = '<span class="cat">❄️</span>' + meta.label + (bb ? ' · 邊界' : '') + ' <span class="height">' + size.y.toFixed(1) + 'm</span>';
  labelContainer.appendChild(badge);
  labels.push({ element: badge, point: new THREE.Vector3(posX, bounds.max.y + 1.5, posZ) });

  return { model, meta, size, bounds };
}

function buildIceMode() {
  clearScene();
  currentMode = 'ice';
  document.querySelector('#btn-back').style.display = 'none';
  const showWater = document.querySelector('#chk-ice-water')?.checked ?? true;
  waterMesh.visible = showWater;
  floor.visible = !showWater;

  const kind = document.querySelector('#ice-kind').value;
  const viewMode = document.querySelector('#ice-view-mode').value;
  const seed = parseInt(document.querySelector('#input-ice-seed').value, 10) || 42;
  const seedMode = document.querySelector('#select-seed-mode-ice')?.value || 'per_building';
  const boundaryNote = boundaryLayoutOf('ice') === 'boundary' ? ' · 邊界沿邊排列（含緩衝區＋透明牆包絡）' : '';

  if (viewMode === 'single') {
    const actKind = (kind === 'all' || !kind) ? ICE_KINDS[seed % ICE_KINDS.length] : kind;
    const res = createIceInstance(actKind, seed, 0, 0);
    if (!res) return;
    document.querySelector('#nav-status').textContent = '冰體單體檢驗：【' + res.meta.label + '】（種子碼 ' + seed + ' · ' + res.meta.partsCount + ' 零件 · 尺寸 ' + res.size.x.toFixed(1) + '×' + res.size.y.toFixed(1) + '×' + res.size.z.toFixed(1) + 'm' + boundaryNote + '）';
    camTarget.set(0, res.size.y * 0.4, 0);
    camDist = Math.max(res.size.x, res.size.y, res.size.z) * 2.2 + 8;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  } else {
    const isCatalog = viewMode === 'catalog';
    const listPool = (kind === 'all' || !kind) ? ICE_KINDS : [kind];
    const cols = isCatalog
      ? Math.min(8, Math.max(2, Math.ceil(Math.sqrt(listPool.length))))
      : Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-cols-ice')?.value, 10) || 4));
    const rows = isCatalog
      ? Math.ceil(listPool.length / cols)
      : Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-rows-ice')?.value, 10) || 4));
    const count = isCatalog ? listPool.length : cols * rows;
    clearScene();
    waterMesh.visible = showWater;
    floor.visible = !showWater;

    // 第一階段：生成所有冰體實例，量測最大長寬高 (以最大的為主)
    const items = [];
    let maxObjW = 10, maxObjD = 10, maxObjH = 8;
    for (let idx = 0; idx < count; idx++) {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const curSeed = getGridSeed(seed, seedMode, c, r, cols, rows, idx);
      const curKind = listPool[idx % listPool.length];
      const season = document.querySelector('#sim-season')?.value || 'summer';
      const curBb = boundaryLayoutOf('ice') === 'boundary';
      const partRows = environmentParts(curKind, { seed: curSeed, season });
      const model = withObjectLayout({ model: assembleEnvironmentParts(partRows, true), meta: { seed: curSeed } }, 'ice').model;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (size.x > maxObjW) maxObjW = size.x;
      if (size.z > maxObjD) maxObjD = size.z;
      if (size.y > maxObjH) maxObjH = size.y;
      items.push({ c, r, idx, curKind, curSeed, model, bounds, size, partRows, curBb });
    }

    // 第二階段：依據最大物件尺寸配置間距
    const stepX = Math.max(20, Math.ceil(maxObjW * 1.35 + 8));
    const stepZ = Math.max(20, Math.ceil(maxObjD * 1.35 + 8));
    const startX = -(cols - 1) * stepX / 2;
    const startZ = -(rows - 1) * stepZ / 2;

    for (const it of items) {
      const posX = startX + it.c * stepX;
      const posZ = startZ + it.r * stepZ;
      it.model.position.set(posX, 0, posZ);
      iceGroup.add(it.model);

      const meta = {
        posX, posZ,
        seed: it.curSeed,
        kind: it.curKind,
        label: ICE_LABELS[it.curKind] || it.curKind,
        partsCount: it.partRows.length,
        size: [it.size.x, it.size.y, it.size.z],
        sceneKind: !it.curBb,
      };
      it.model.traverse((o) => {
        if (o.isMesh) {
          o.userData.iceMeta = meta;
          clickableObjects.push(o);
        }
      });

      const badge = document.createElement('div');
      badge.className = 'badge-label';
      badge.innerHTML = '<span class="cat">❄️</span>' + meta.label + (it.curBb ? ' · 邊界' : '') + ' <span class="height">' + it.size.y.toFixed(1) + 'm</span>';
      labelContainer.appendChild(badge);
      labels.push({ element: badge, point: new THREE.Vector3(posX, it.bounds.max.y + 1.5, posZ) });
    }

    document.querySelector('#nav-status').textContent = (isCatalog ? '冰體全分類目錄陳列' : '冰體陣列檢驗') + ' (' + cols + '×' + rows + ' 共 ' + items.length + ' 件）：【' + (kind === 'all' ? '全部款式輪播' : ICE_LABELS[kind] || kind) + '】（基底種子 ' + seed + boundaryNote + '）';
    const totalW = (cols - 1) * stepX + maxObjW;
    const totalD = (rows - 1) * stepZ + maxObjD;
    camTarget.set(0, Math.min(25, maxObjH * 0.4), 0);
    camDist = Math.max(totalW, totalD, maxObjH * 1.5) * 1.25 + 15;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  }
  updateCamera();
  render();
}

function initEnvOptions() {
  const mode = document.querySelector('#env-mode').value;
  const kindSel = document.querySelector('#env-kind');
  const prevKind = kindSel.value;
  kindSel.innerHTML = '';

  const categories = ['energy', 'aquaculture', 'fortification', 'military', 'bridge', 'levee', 'coastal'];
  const kinds = Object.keys(WALL_KINDS).filter(k => currentTab !== 'infrastructure'
    || categories.includes(BOUNDARY_OBJECT_CATEGORIES[k]));
  if (mode === 'edge' || mode === 'all' || mode === 'module') {
    for (const k of kinds) {
      kindSel.add(new Option(WALL_KINDS[k].label || k, k));
    }
  } else if (['slope', 'mid', 'flat', 'water'].includes(mode)) {
    const slopeKinds = kinds.filter(k =>
      mode === 'water' ? WALL_KINDS[k].dom === 'water' :
      WALL_KINDS[k].dom === 'land' && WALL_KINDS[k].slope === (mode === 'slope' ? 'steep' : mode)
    );
    for (const k of slopeKinds) {
      kindSel.add(new Option(WALL_KINDS[k].label || k, k));
    }
  }
  document.querySelector('#env-panel-title').textContent = currentTab === 'infrastructure' ? '能源、水產與工程構造' : '邊界固定構造 · 連續陡坡接縫';
  document.querySelector('#env-info-badge').textContent = kinds.length + ' 款 · 同源生成與排列';
  if ([...kindSel.options].some(o => o.value === prevKind)) {
    kindSel.value = prevKind;
  }
}

function meshGeometry(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
  if (data.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  g.setIndex(data.faces);
  g.computeVertexNormals();
  return g;
}

function assembleEnvironmentParts(rows, isIce = false) {
  const group = new THREE.Group();
  for (const p of rows) {
    const [t, a, b, c, n] = p.g;
    const geo = t === 'mesh' ? meshGeometry(a)
      : t === 'box' ? new THREE.BoxGeometry(a, b, c)
      : t === 'cyl' ? new THREE.CylinderGeometry(a, b, c, n || 6)
      : t === 'cone' ? new THREE.ConeGeometry(a, b, c || 6)
      : new THREE.IcosahedronGeometry(a, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: p.c ?? 0xffffff,
      vertexColors: t === 'mesh' && !!a.colors,
      roughness: 0.85,
      flatShading: true,
      transparent: p.mat === 'glass',
      opacity: p.mat === 'glass' ? 0.72 : 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.fromArray(p.p || [0, 0, 0]);
    if (isIce) mesh.position.y -= (p.waterline || 0);
    mesh.rotation.set(...(p.r || [0, 0, 0]));
    mesh.scale.fromArray(p.s || [1, 1, 1]);
    group.add(mesh);
  }
  return group;
}

// 邊界列組裝單一入口：單體與陣列共用同一段長、同一坡度取樣與同一端面規則。
function boundaryRows(kind, def, mode, seed) {
  const season = document.querySelector('#sim-season').value;
  const heightAt = (x, z) => mode === 'water' || mode === 'flat' ? 0 : x * (mode === 'mid' ? 0.15 : 0.85) + Math.sin(x / 13 + seed) * (mode === 'mid' ? 1 : 4) + z * 0.2;
  if (!['slope', 'mid', 'flat', 'water'].includes(mode)) {
    return wallParts(kind, { len: 30, depth: def.depth, h: def.h, seed, season });
  }
  return [-30, 0, 30].flatMap((x) => (
    def.terrainFit
      ? buildSlopeBoundary(kind, { len: 30, depth: def.depth, h: def.h, x, z: 0, seed, season, waterY: mode === 'water' ? 0 : null, heightAt }).parts
      : wallParts(kind, { len: 30, depth: def.depth, h: def.h, seed, season }).map((p) => ({ ...p, p: [p.p[0], p.p[1] + heightAt(x, 0), p.p[2]] }))
  ).map((p) => ({ ...p, p: [p.p[0] + x, p.p[1], p.p[2]] })));
}

// 獨立物件 ↔ 邊界物件共用隨機生成管線：同一個生成器，只差放置與排列。
// 場景散布走 environmentParts（各頁籤既有路徑）；邊界沿邊排列走 buildBoundaryRunParts
//（遊戲 buildEdgeWall 同一入口，含緩衝區填實，種子規則與陣列／單體／目錄展示不變）。
// 透明牆（權威碰撞環）遊戲內本就連續封閉，此處僅以透明包絡盒視覺化提醒，不新增遊戲邏輯。
const PREVIEW_BOUNDARY_SEG_LEN = 30;
const PREVIEW_BOUNDARY_BUFFER_DEPTH = 32;
function previewBoundaryBatch(boundaryKind, seed, season) {
  const def = WALL_KINDS[boundaryKind];
  const batch = buildBoundaryRunParts(boundaryKind, {
    len: PREVIEW_BOUNDARY_SEG_LEN, depth: def.depth, bufferDepth: PREVIEW_BOUNDARY_BUFFER_DEPTH,
    h: def.h, seed, season,
  });
  return { def, parts: batch.parts, bufferParts: batch.bufferParts, rows: [...batch.parts, ...batch.bufferParts] };
}
function boundaryLayoutOf(prefix) {
  return document.querySelector('#layout-' + prefix)?.value || 'scene';
}

// A generated model is immutable input to layout. Changing layout keeps species,
// vehicle equipment, vessel loading, geometry, materials and the selected seed.
function withObjectLayout(result, prefix) {
  if (!result || boundaryLayoutOf(prefix) !== 'boundary') return result;
  const key = result.model ? 'model' : result.mesh ? 'mesh' : 'group';
  const source = result[key];
  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Invalid model bounds');
  const gap = Math.max(1, size.x * .08);
  const depth = Math.max(6, size.z + Math.max(1, size.z * .08));
  const len = (size.x + gap) * 3;
  const grid = boundaryGrid({ len, depth, bufferDepth: depth, pitchX: size.x + gap, pitchZ: depth });
  const root = new THREE.Group();
  root.position.copy(source.position);
  const parent = source.parent;
  parent?.remove(source);
  parent?.add(root);
  const center = bounds.getCenter(new THREE.Vector3()).sub(root.position);
  source.position.set(-center.x, 0, -center.z);
  for (let row = 0; row <= grid.maxBufferRows; row++) {
    for (let col = 0; col < grid.numCols; col++) {
      const instance = source.clone(true);
      instance.position.x += (col + .5) * grid.colStep - len / 2;
      instance.position.z -= row * grid.rowStep;
      root.add(instance);
      instance.traverse(o => { if (o.isMesh) clickableObjects.push(o); });
    }
  }
  // Discard the original picking proxy; copies retain the same metadata.
  const obsolete = new Set();
  source.traverse(o => obsolete.add(o));
  if (result.hitMesh) { obsolete.add(result.hitMesh); result.hitMesh.parent?.remove(result.hitMesh); }
  for (let i = clickableObjects.length - 1; i >= 0; i--) if (obsolete.has(clickableObjects[i])) clickableObjects.splice(i, 1);
  result[key] = root;
  const laidOut = new THREE.Box3().setFromObject(root);
  const extent = laidOut.getSize(new THREE.Vector3());
  result.layoutSize = [extent.x, extent.y, extent.z];
  root.userData.objectLayout = { seed: result.meta?.seed, sourceSize: [size.x, size.y, size.z], columns: grid.numCols, rows: 1 + grid.maxBufferRows };
  if (result.entry) result.entry = { ...result.entry, bounds: { size: result.layoutSize,
    min: laidOut.min.toArray(), max: laidOut.max.toArray() } };
  if (result.tree) result.tree = { ...result.tree, footprint: Math.max(extent.x, extent.z) / 2 };
  const wallHeight = Math.max(edgeWallHM(), size.y);
  addTransparentWallEnvelope(root, len, wallHeight, depth, bounds.min.y + wallHeight / 2);
  return result;
}
function showBoundaryBuffer() {
  return document.querySelector('#chk-env-buffer')?.checked ?? true;
}
function addTransparentWallEnvelope(model, w, h, d, cy) {
  const geo = new THREE.BoxGeometry(Math.max(0.5, w), Math.max(0.5, h), Math.max(0.5, d));
  const box = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x38bdf8, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide,
  }));
  box.position.set(0, cy ?? h / 2, 0);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55 }));
  edge.position.copy(box.position);
  model.add(box);
  model.add(edge);
}

function createEnvironmentInstance(mode, kind, seed, posX = 0, posZ = 0) {
  const def = WALL_KINDS[kind];
  if (!def) return null;

  const rows = boundaryRows(kind, def, mode, seed);
  const wantBuffer = showBoundaryBuffer() && mode !== 'module';
  const bb = mode === 'edge' ? previewBoundaryBatch(kind, seed, document.querySelector('#sim-season').value) : null;
  const useBuffer = !!(wantBuffer && bb?.bufferParts.length);
  const body = bb?.parts || rows;
  const model = assembleEnvironmentParts(useBuffer ? [...body, ...bb.bufferParts] : body, false);
  model.position.set(posX, 0, posZ);
  envGroup.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const meta = {
    posX, posZ,
    seed,
    mode,
    kind,
    label: def.label || kind,
    partsCount: body.length,
    size: [size.x, size.y, size.z],
    ...(useBuffer ? { bufferCount: bb.bufferParts.length } : {}),
  };

  model.traverse((o) => {
    if (o.isMesh) {
      o.userData.envMeta = meta;
      clickableObjects.push(o);
    }
  });

  const badge = document.createElement('div');
  badge.className = 'badge-label';
  badge.innerHTML = '<span class="cat">🌐</span>' + (def.label || kind) + (useBuffer ? ' · 緩衝 ' + bb.bufferParts.length + ' 件' : '') + ' <span class="height">' + size.y.toFixed(1) + 'm</span>';
  labelContainer.appendChild(badge);
  labels.push({ element: badge, point: new THREE.Vector3(posX, bounds.max.y + 1.5, posZ) });
  if (mode !== 'module') {
    if (mode === 'edge') addTransparentWallEnvelope(model, PREVIEW_BOUNDARY_SEG_LEN, def.h, def.depth);
    else addTransparentWallEnvelope(model, size.x, size.y, size.z, bounds.getCenter(new THREE.Vector3()).y);
  }

  return { model, meta, def, size, bounds };
}

function buildEnvironmentMode() {
  clearScene();
  currentMode = 'env';
  document.querySelector('#btn-back').style.display = 'none';

  initEnvOptions();

  const mode = document.querySelector('#env-mode').value;
  const kind = document.querySelector('#env-kind').value;
  const viewMode = document.querySelector('#env-view-mode').value;
  const seed = parseInt(document.querySelector('#input-env-seed').value, 10) || 42;
  const seedMode = document.querySelector('#select-seed-mode-env')?.value || 'per_building';
  const wantBuffer = showBoundaryBuffer();
  const bufferNote = wantBuffer ? '（含緩衝區填實＋透明牆包絡；坡度接縫模式僅包絡）' : '（不含緩衝區）';

  const boundaryModes = ['edge', 'slope', 'mid', 'flat', 'water'];
  const allKinds = [...document.querySelector('#env-kind').options].map(o => o.value).filter(v => v !== 'all');
  if (!allKinds.length) {
    document.querySelector('#nav-status').textContent = '此分類沒有符合地形的構造';
    render();
    return;
  }

  const actMode = mode === 'all' ? boundaryModes[seed % boundaryModes.length] : mode;
  const actKind = (kind === 'all' || !kind) ? (allKinds[seed % allKinds.length] || allKinds[0]) : kind;

  const isWaterMode = actMode === 'water';

  if (viewMode === 'single') {
    waterMesh.visible = isWaterMode;
    floor.visible = !isWaterMode;
    const res = createEnvironmentInstance(actMode, actKind, seed, 0, 0);
    if (!res) return;
    document.querySelector('#nav-status').textContent = '邊界單體檢驗：【' + res.def.label + '】（種子碼 ' + seed + ' · ' + res.meta.partsCount + ' 零件 · 尺寸 ' + res.size.x.toFixed(1) + '×' + res.size.y.toFixed(1) + '×' + res.size.z.toFixed(1) + 'm' + bufferNote + '）';
    camTarget.set(0, res.size.y * 0.4, 0);
    camDist = Math.max(res.size.x, res.size.y, res.size.z) * 2.2 + 8;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  } else {
    const cols = Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-cols-env')?.value, 10) || 4));
    const rows = Math.max(1, Math.min(20, parseInt(document.querySelector('#sample-rows-env')?.value, 10) || 4));
    clearScene();
    waterMesh.visible = isWaterMode;
    floor.visible = !isWaterMode;

    // 第一階段：計算陣列中所有邊界物件規格尺寸，找出最大長寬高 (以最大的為主)
    const items = [];
    let maxObjW = 10, maxObjD = 10, maxObjH = 8;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const curSeed = getGridSeed(seed, seedMode, c, r, cols, rows, idx);
        const curMode = mode === 'all' ? boundaryModes[idx % boundaryModes.length] : actMode;
        const validKinds = curMode === 'edge' || curMode === 'all' || curMode === 'module'
          ? allKinds
          : allKinds.filter(k =>
              curMode === 'water' ? WALL_KINDS[k].dom === 'water' :
              WALL_KINDS[k].dom === 'land' && WALL_KINDS[k].slope === (curMode === 'slope' ? 'steep' : curMode));
        const curKind = (kind === 'all' || !kind || !validKinds.includes(kind))
          ? (validKinds[idx % validKinds.length] || validKinds[0] || kind)
          : kind;
        const def = WALL_KINDS[curKind] || { label: curKind, h: 6, depth: 8 };

        const partRows = boundaryRows(curKind, def, curMode, curSeed);
        const curBb = (curMode === 'edge' && WALL_KINDS[curKind]) ? previewBoundaryBatch(curKind, curSeed, document.querySelector('#sim-season').value) : null;
        const useBuffer = !!(wantBuffer && curBb?.bufferParts.length);
        const body = curBb?.parts || partRows;
        const merged = useBuffer ? [...body, ...curBb.bufferParts] : body;

        const model = assembleEnvironmentParts(merged, false);
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        if (size.x > maxObjW) maxObjW = size.x;
        if (size.z > maxObjD) maxObjD = size.z;
        if (size.y > maxObjH) maxObjH = size.y;
        items.push({ c, r, idx, curMode, curKind, curSeed, def, model, bounds, size, partRows, useBuffer, curBb });
      }
    }

    // 第二階段：依據最大物件尺寸配置間距
    const stepX = Math.max(20, Math.ceil(maxObjW * 1.35 + 8));
    const stepZ = Math.max(20, Math.ceil(maxObjD * 1.35 + 8));
    const startX = -(cols - 1) * stepX / 2;
    const startZ = -(rows - 1) * stepZ / 2;

    for (const it of items) {
      const posX = startX + it.c * stepX;
      const posZ = startZ + it.r * stepZ;
      it.model.position.set(posX, 0, posZ);
      envGroup.add(it.model);

      const meta = {
        posX, posZ,
        seed: it.curSeed,
        mode: it.curMode,
        kind: it.curKind,
        label: it.def.label || it.curKind,
        partsCount: (it.curBb?.parts || it.partRows).length,
        size: [it.size.x, it.size.y, it.size.z],
        ...(it.useBuffer ? { bufferCount: it.curBb.bufferParts.length } : {}),
      };
      it.model.traverse((o) => {
        if (o.isMesh) {
          o.userData.envMeta = meta;
          clickableObjects.push(o);
        }
      });

      const badge = document.createElement('div');
      badge.className = 'badge-label';
      badge.innerHTML = '<span class="cat">🌐</span>' + (it.def.label || it.curKind) + (it.useBuffer ? ' · 緩衝 ' + it.curBb.bufferParts.length + ' 件' : '') + ' <span class="height">' + it.size.y.toFixed(1) + 'm</span>';
      labelContainer.appendChild(badge);
      labels.push({ element: badge, point: new THREE.Vector3(posX, it.bounds.max.y + 1.5, posZ) });
      if (it.curMode !== 'module') {
        if (it.curMode === 'edge' && WALL_KINDS[it.curKind]) addTransparentWallEnvelope(it.model, PREVIEW_BOUNDARY_SEG_LEN, WALL_KINDS[it.curKind].h, WALL_KINDS[it.curKind].depth);
        else addTransparentWallEnvelope(it.model, it.size.x, it.size.y, it.size.z, it.bounds.getCenter(new THREE.Vector3()).y);
      }
    }

    document.querySelector('#nav-status').textContent = '邊界陣列檢驗 (' + cols + '×' + rows + ' 共 ' + items.length + ' 件）：【' + (kind === 'all' ? '全部款式輪播' : actKind) + '】（基底種子 ' + seed + bufferNote + '）';
    const totalW = (cols - 1) * stepX + maxObjW;
    const totalD = (rows - 1) * stepZ + maxObjD;
    camTarget.set(0, Math.min(25, maxObjH * 0.4), 0);
    camDist = Math.max(totalW, totalD, maxObjH * 1.5) * 1.25 + 15;
    activeCamTarget.copy(camTarget);
    activeCamDist = camDist;
  }
  updateCamera();
  render();
}

// 統一陣列規模、種子模式、種子碼與排列方式監聽
['geo', 'plant', 'veh', 'vessel', 'env', 'industry', 'ice'].forEach((prefix) => {
  ['cols', 'rows'].forEach((dim) => {
    document.querySelector('#sample-' + dim + '-' + prefix)?.addEventListener('change', () => {
      rebuildActiveTab();
    });
  });
  document.querySelector('#select-seed-mode-' + prefix)?.addEventListener('change', () => {
    rebuildActiveTab();
  });
  document.querySelector('#input-' + prefix + '-seed')?.addEventListener('change', () => {
    rebuildActiveTab();
  });
  document.querySelector('#layout-' + prefix)?.addEventListener('change', () => {
    rebuildActiveTab();
  });
});

// 車輛事件
document.querySelector('#btn-veh-generate')?.addEventListener('click', () => {
  const mode = document.querySelector('#select-seed-mode-veh')?.value;
  if (mode === 'shared_batch') {
    document.querySelector('#input-veh-seed').value = Math.floor(Math.random() * 90000) + 1000;
  }
  buildVehicleMode();
});
document.querySelector('#btn-veh-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-veh-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildVehicleMode();
});
['#veh-formation', '#veh-purpose', '#veh-type', '#veh-power'].forEach((id) => {
  document.querySelector(id)?.addEventListener('change', () => {
    updateVehicleFilter();
    buildVehicleMode();
  });
});
['#veh-profile', '#veh-view-mode', '#veh-leader', '#veh-wagon', '#veh-count', '#chk-veh-scene-fit'].forEach((id) => {
  document.querySelector(id)?.addEventListener('change', buildVehicleMode);
});

// 船隻事件
document.querySelector('#btn-vessel-generate')?.addEventListener('click', () => {
  const mode = document.querySelector('#select-seed-mode-vessel')?.value;
  if (mode === 'shared_batch') {
    document.querySelector('#input-vessel-seed').value = Math.floor(Math.random() * 90000) + 1000;
  }
  buildVesselMode();
});
document.querySelector('#btn-vessel-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-vessel-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildVesselMode();
});
['#vessel-purpose', '#vessel-water', '#vessel-power'].forEach((id) => {
  document.querySelector(id)?.addEventListener('change', () => {
    updateVesselFilter();
    buildVesselMode();
  });
});
['#vessel-type', '#vessel-view-mode', '#sample-cols-vessel', '#sample-rows-vessel', '#select-seed-mode-vessel', '#input-vessel-seed'].forEach((id) => {
  document.querySelector(id)?.addEventListener('change', buildVesselMode);
});
document.querySelector('#chk-vessel-water')?.addEventListener('change', () => {
  const showWater = document.querySelector('#chk-vessel-water').checked;
  waterMesh.visible = showWater;
  floor.visible = !showWater;
  render();
});

// 環境事件
document.querySelector('#btn-env-generate')?.addEventListener('click', () => {
  const mode = document.querySelector('#select-seed-mode-env')?.value;
  if (mode === 'shared_batch') {
    document.querySelector('#input-env-seed').value = Math.floor(Math.random() * 90000) + 1000;
  }
  buildEnvironmentMode();
});
document.querySelector('#btn-env-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-env-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildEnvironmentMode();
});
document.querySelector('#env-mode')?.addEventListener('change', () => {
  initEnvOptions();
  buildEnvironmentMode();
});
['#env-kind', '#env-view-mode', '#chk-env-buffer'].forEach((id) => {
  document.querySelector(id)?.addEventListener('change', buildEnvironmentMode);
});

// 產業事件
document.querySelector('#btn-industry-generate')?.addEventListener('click', () => {
  const mode = document.querySelector('#select-seed-mode-industry')?.value;
  if (mode === 'shared_batch') {
    document.querySelector('#input-industry-seed').value = Math.floor(Math.random() * 90000) + 1000;
  }
  buildIndustryMode();
});
document.querySelector('#btn-industry-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-industry-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildIndustryMode();
});
['#industry-kind', '#industry-view-mode'].forEach((id) => {
  document.querySelector(id)?.addEventListener('change', buildIndustryMode);
});

// 冰雪事件
document.querySelector('#btn-ice-generate')?.addEventListener('click', () => {
  const mode = document.querySelector('#select-seed-mode-ice')?.value;
  if (mode === 'shared_batch') {
    document.querySelector('#input-ice-seed').value = Math.floor(Math.random() * 90000) + 1000;
  }
  buildIceMode();
});
document.querySelector('#btn-ice-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-ice-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildIceMode();
});
['#ice-kind', '#ice-view-mode'].forEach((id) => {
  document.querySelector(id)?.addEventListener('change', buildIceMode);
});
document.querySelector('#chk-ice-water')?.addEventListener('change', () => {
  const showWater = document.querySelector('#chk-ice-water').checked;
  waterMesh.visible = showWater;
  floor.visible = !showWater;
  render();
});

// ==========================================
// 頂部環境模擬控制列事件 (四季 × 日夜 × 多元天氣)
// ==========================================
function rebuildActiveTab() {
  if (currentTab === 'arch') buildMatrixMode({ advance: false });
  else if (currentTab === 'geology') buildGeologyMode();
  else if (currentTab === 'plant') buildPlantMode();
  else if (currentTab === 'vehicle') buildVehicleMode();
  else if (currentTab === 'vessel') buildVesselMode();
  else if (currentTab === 'industry') buildIndustryMode();
  else if (currentTab === 'ice') buildIceMode();
  else if (currentTab === 'env' || currentTab === 'infrastructure') buildEnvironmentMode();
}

document.querySelector('#sim-season')?.addEventListener('change', (e) => {
  currentEnv.season = e.target.value;
  initEnvironment();
  rebuildActiveTab();
});

document.querySelectorAll('.env-time-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentEnv.time = btn.dataset.time;
    const hourMap = { dawn: 6, day: 12, dusk: 18, night: 0 };
    currentEnv.hour = hourMap[currentEnv.time] ?? 12;
    initEnvironment();
    render();
  });
});

document.querySelector('#sim-hour')?.addEventListener('input', (e) => {
  const targetHour = parseFloat(e.target.value);
  syncEnvironmentHour(targetHour);
  if (envHandle) {
    envHandle.update(0, camera, simElapsedS);
  }
  render();
});

document.querySelector('#sim-weather')?.addEventListener('change', (e) => {
  currentEnv.weather = e.target.value;
  initEnvironment();
  render();
});

document.querySelector('#btn-sim-toggle')?.addEventListener('click', () => {
  currentEnv.playing = !currentEnv.playing;
  const btn = document.querySelector('#btn-sim-toggle');
  btn.textContent = currentEnv.playing ? '⏸ 暫停' : '▶ 模擬';
  btn.classList.toggle('playing', currentEnv.playing);
});

document.querySelector('#sim-speed')?.addEventListener('change', (e) => {
  currentEnv.speed = parseFloat(e.target.value) || 5;
});

// ---- 飄浮標籤投影更新與渲染循環 ----
function updateLabels() {
  if (!document.querySelector('#chk-labels').checked) return;
  const halfW = innerWidth / 2, halfH = innerHeight / 2;
  for (let i = 0; i < labels.length; i++) {
    const { element, point } = labels[i];
    const p = point.clone().project(camera);
    if (p.z > -1 && p.z < 1) {
      element.style.display = 'block';
      element.style.left = ((p.x + 1) * halfW) + 'px';
      element.style.top = ((-p.y + 1) * halfH) + 'px';
    } else {
      element.style.display = 'none';
    }
  }
}

let pipeline = null;
try {
  pipeline = new Pipeline(renderer, scene, camera, { dof: false, grade: false });
} catch (err) {
  console.warn('後製管線初始化回退為原生 WebGL 渲染:', err);
}

function render() {
  if (pipeline) {
    pipeline.render();
  } else {
    renderer.render(scene, camera);
  }
  updateLabels();
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  render();
});

// 初次建構與環境初始化
try {
  setupFilterModal();
  initEnvironment();
  initVehicleOptions();
  initVesselOptions();
  initGeologyOptions();
  buildMatrixMode();
} catch (err) {
  console.error('初次建構失敗:', err);
}

// 實時動態渲染循環 (雲漂移、天氣粒子、閃電打雷強光與連續日夜流逝)
let lastAnimTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, (now - lastAnimTime) / 1000);
  lastAnimTime = now;
  if (currentEnv.playing) {
    simElapsedS += dt * currentEnv.speed;
    const curH = clockHour(currentEnv.time, simElapsedS);
    currentEnv.hour = curH;
    const slider = document.querySelector('#sim-hour');
    if (slider) slider.value = curH;
    const valText = document.querySelector('#sim-hour-val');
    if (valText) valText.textContent = clockLabel(curH);
  }
  if (envHandle) {
    envHandle.update(dt, camera, simElapsedS);
  }
  render();
}
requestAnimationFrame(animate);

document.body.dataset.ready = 'true';
</script>`;

export const DEFAULT_PORT = 8644;

export function serve(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let body, type = 'text/javascript';
      if (url.pathname === '/') {
        body = page; type = 'text/html';
      } else if (url.pathname === '/three.mjs' || url.pathname === '/three.js') {
        if (process.env.THREE_MODULE) {
          body = await readFile(process.env.THREE_MODULE);
        } else {
          res.writeHead(302, { Location: 'https://unpkg.com/three@0.160.0/build/three.module.js' });
          res.end(); return;
        }
      } else if (url.pathname === '/pass.mjs') {
        if (process.env.THREE_PASS) {
          body = await readFile(process.env.THREE_PASS);
        } else {
          res.writeHead(302, { Location: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/Pass.js' });
          res.end(); return;
        }
      } else if (url.pathname === '/utils.mjs') {
        if (process.env.THREE_BUFFER_UTILS) {
          body = await readFile(process.env.THREE_BUFFER_UTILS);
        } else {
          res.writeHead(302, { Location: 'https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js' });
          res.end(); return;
        }
      } else if (url.pathname.startsWith('/js/')) {
        const file = path.resolve(root, url.pathname.slice(4));
        if (!file.startsWith(root)) throw new Error('路徑不在模組目錄內');
        body = await readFile(file);
      } else {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      res.end(body);
    } catch (error) {
      res.writeHead(500); res.end(String(error));
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`建模隨機生成器：http://127.0.0.1:${port}`));
  return server;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  serve();
}
