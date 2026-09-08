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
    <button id="tab-btn-arch" class="cat-tab-btn active" type="button" data-tab="arch">🏛 建築生成 (Architecture)</button>
    <button id="tab-btn-geology" class="cat-tab-btn" type="button" data-tab="geology">🪨 地質生成 (Geology)</button>
    <button id="tab-btn-plant" class="cat-tab-btn" type="button" data-tab="plant">🌲 植物生成 (Plants & Forest)</button>
  </div>
  <div class="nav-extra">
    <button id="btn-nav-reset-cam" class="btn-nav-action" type="button" title="重設視角">🎥 重設視角</button>
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
          <label class="sample-input-wrap">維度A <input type="number" id="sample-dim-a" value="5" min="1" max="30"></label>
          <span>×</span>
          <label class="sample-input-wrap">維度B <input type="number" id="sample-dim-b" value="5" min="1" max="30"></label>
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
            <option value="shared_batch">每次改變種子但同陣列相同</option>
            <option value="per_building" selected>每一個建築每次都改變種子</option>
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
            <option value="auto">依環境加權抽樣</option>
            <optgroup label="自然地質">
              <option value="granite">花崗岩塊 (Granite)</option>
              <option value="mountain">褶皺山巒 (Mountain)</option>
              <option value="mound">土堆／崩積丘 (Mound)</option>
              <option value="dune">風成沙丘 (Sand Dune)</option>
              <option value="sandstone">層狀砂岩台地 (Sandstone)</option>
              <option value="cliff">斷層峭壁 (Cliff)</option>
              <option value="karst">石灰岩溶蝕峰 (Karst)</option>
              <option value="basalt" selected>玄武岩柱狀節理 (Basalt)</option>
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
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="geo-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="single" selected>單體細節檢驗</option>
            <option value="variants">16 組種子變體陣列</option>
            <option value="matrix">主要地質類型矩陣</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">氣候環境</label>
          <select id="geo-climate" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
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
            <option value="egypt">埃及 (Egypt)</option>
            <option value="greece_rome">希臘羅馬 (Greece/Rome)</option>
            <option value="maya">瑪雅 (Maya)</option>
            <option value="easter_island">復活節島 (Easter Island)</option>
            <option value="mesopotamia">美索不達米亞 (Mesopotamia)</option>
            <option value="east_asia">東亞 (East Asia)</option>
            <option value="uk_prehistoric">英國史前 (UK Prehistoric)</option>
          </select></label>
          <label>遺跡形式 <select id="geo-ruin-type" style="padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; font-size:11px;">
            <option value="auto">隨機遺跡形式</option>
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
        <button id="btn-geo-generate" class="btn-generate">⚡ 重新生成地質</button>
        <button id="btn-geo-random-seed" class="btn-randomize">🎲 隨機種子</button>
        <button id="btn-geo-next-seed" class="btn-randomize">⏭ 下一個種子</button>
        <button id="btn-geo-variants" class="btn-full-random">🎲 展開 16 組變體</button>
        <div class="seed-control">
          <label for="input-geo-seed">種子碼</label>
          <input type="number" id="input-geo-seed" value="42" min="1" max="999999">
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
            <option value="auto">依環境適生加權抽樣</option>
            <optgroup label="針葉樹巨木">
              <option value="redwood" selected>加州紅杉 (Redwood · 塔型 110m)</option>
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
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">展示模式</label>
          <select id="plant-view-mode" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="single" selected>單株解剖檢驗</option>
            <option value="variants">16 株種子變體陣列</option>
            <option value="grove">林相生態群落混交</option>
          </select>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #334155; display:block; margin-bottom: 3px;">物候季節</label>
          <select id="plant-season" style="width:100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; color: #1e293b; background: #fff;">
            <option value="summer" selected>夏季 (Summer · 繁茂枝葉)</option>
            <option value="spring">春季 (Spring · 開花花序)</option>
            <option value="autumn">秋季 (Autumn · 果實毬果)</option>
            <option value="winter">冬季 (Winter · 落葉休眠)</option>
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
        <button id="btn-plant-generate" class="btn-generate">⚡ 重新生成植物</button>
        <button id="btn-plant-random-seed" class="btn-randomize">🎲 隨機種子</button>
        <button id="btn-plant-next-seed" class="btn-randomize">⏭ 下一個種子</button>
        <button id="btn-plant-variants" class="btn-full-random">🎲 展開 16 株變體</button>
        <div class="seed-control">
          <label for="input-plant-seed">種子碼</label>
          <input type="number" id="input-plant-seed" value="1001" min="1" max="999999">
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

// 植物生成模組
import { TREE_SPECIES, createForestTree, treeDistribution, treeHabitatWeight, treeSections, treeBend, forestEnvironment } from '/js/forest.js';

// ---- Three.js 核心場景初始化 ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = false;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcdd9e2);
scene.add(new THREE.HemisphereLight(0xffffff, 0x889bb0, 2.4));
const light = new THREE.DirectionalLight(0xfff3e0, 2.3);
light.position.set(-100, 200, 120);
scene.add(light);

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
  if (e.button === 0) isLeftDragging = true;
  if (e.button === 2) isRightDragging = true;
  prevMouse = { x: e.clientX, y: e.clientY };
  mouseDownPos = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mousemove', (e) => {
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
  } else {
    handleHover(e);
  }
  prevMouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mouseup', (e) => {
  const moved = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
  if (moved < 5 && e.button === 0) {
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

let currentTab = 'arch'; // 'arch' | 'geology' | 'plant'
let currentMode = 'matrix'; // 'matrix' | 'variants' | 'random'
let selectedDims = ['func', 'style'];
const clickableObjects = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredBuilding = null;
let variantTargetMeta = null;
const dimCycleOffsets = { func: 0, style: 0, roof: 0, facade: 0, region: 0 };

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

  camTarget.set(0, 6, 0);
  camDist = Math.max(120, Math.max(cols * stepX, rows * stepZ) * 1.15);
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
function getGeologyInputs() {
  const input = {
    climate: document.querySelector('#geo-climate').value,
    water: document.querySelector('#geo-water').value,
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

function createGeologyMesh(type, seed, input, posX = 0, posZ = 0) {
  let actualType = type;
  if (type === 'auto') {
    const dist = geologyDistribution(input);
    actualType = dist.length ? dist[Math.abs(seed) % dist.length].type : 'basalt';
  }
  const spec = GEOLOGY_TYPES[actualType] || GEOLOGY_TYPES.basalt;
  const isAncient = spec?.lithology === 'manufactured';

  const fullInput = { ...input };
  if (isAncient) {
    fullInput.region = document.querySelector('#geo-region')?.value || 'egypt';
    const ruinType = document.querySelector('#geo-ruin-type')?.value;
    if (ruinType && ruinType !== 'auto') fullInput.ruinType = ruinType;
    fullInput.uniformScale = parseFloat(document.querySelector('#geo-scale')?.value) || 1.0;
  }

  const entry = geologyBackgroundObject(actualType, seed, fullInput);
  const geom = runtimeMeshDataGeometry(entry.meshData, entry.parts);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(posX, 0, posZ);

  const r = Math.max(...entry.bounds.size);
  const hitGeo = new THREE.BoxGeometry(r * 1.1, entry.bounds.max[1], r * 1.1);
  hitGeo.translate(posX, entry.bounds.max[1] / 2, posZ);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);

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
  labels.push({ element: badge, point: new THREE.Vector3(posX, entry.bounds.max[1] + 1.5, posZ) });

  return { mesh, meta, entry };
}

function buildGeologyMode() {
  clearScene();
  currentMode = 'geology';
  document.querySelector('#btn-back').style.display = 'none';
  floor.material.color.setHex(0x223038);

  const type = document.querySelector('#geo-type').value;
  const viewMode = document.querySelector('#geo-view-mode').value;
  let seed = parseInt(document.querySelector('#input-geo-seed').value, 10) || 42;
  const input = getGeologyInputs();

  const isAncient = GEOLOGY_TYPES[type]?.lithology === 'manufactured';
  const ancientBox = document.querySelector('#geo-ancient-box');
  if (ancientBox) ancientBox.style.display = isAncient ? 'block' : 'none';

  if (viewMode === 'single') {
    const { entry } = createGeologyMesh(type, seed, input, 0, 0);
    const r = Math.max(...entry.bounds.size);
    document.querySelector('#nav-status').textContent = '地質單體檢驗：【' + entry.name + '】（種子碼 ' + seed + '）';
    camTarget.set(0, entry.bounds.max[1] * 0.4, 0);
    camDist = Math.max(20, r * 1.8);
  } else if (viewMode === 'variants') {
    const cols = 4, rows = 4;
    const step = 45;
    const startX = -(cols - 1) * step / 2;
    const startZ = -(rows - 1) * step / 2;
    document.querySelector('#nav-status').textContent = '地質 16 組種子變體陣列：【' + (GEOLOGY_TYPES[type]?.name || '環境抽樣') + '】';

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = startX + c * step;
        const z = startZ + r * step;
        const s = seed + (r * cols + c) * 31;
        createGeologyMesh(type, s, input, x, z);
      }
    }
    camTarget.set(0, 10, 0);
    camDist = 260;
  } else if (viewMode === 'matrix') {
    const sampleTypes = [
      'basalt_columnar', 'karst_cave', 'dune', 'shale_cliff',
      'debris_flow', 'landslide_lake', 'talus_cone', 'hot_spring',
      'mud_volcano', 'geyser', 'eruption', 'impact_crater',
      'megalith', 'obelisk', 'moai', 'ruins'
    ];
    const cols = 4, rows = 4;
    const step = 48;
    const startX = -(cols - 1) * step / 2;
    const startZ = -(rows - 1) * step / 2;
    document.querySelector('#nav-status').textContent = '主要地質類型矩陣展開（16 款地形／現象／古蹟對照）';

    for (let i = 0; i < sampleTypes.length; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x = startX + c * step, z = startZ + r * step;
      createGeologyMesh(sampleTypes[i], seed + i * 13, input, x, z);
    }
    camTarget.set(0, 12, 0);
    camDist = 280;
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
  willow: '垂柳', juniper: '刺柏', mangroveGrey: '海茄苳紅樹', coconut: '可可椰子', baobab: '猴麵包樹'
};

const cylGeoFactory = (rt, rb, h, n, sec) => new THREE.CylinderGeometry(rt, rb, h, Math.max(5, n || 6), Math.max(1, sec || 1));
const icoGeoFactory = (radius) => new THREE.IcosahedronGeometry(Math.max(0.1, radius), 1);

function createPlantObject(type, seed, scale = 1, season = 'summer', posX = 0, posZ = 0) {
  let actualType = type;
  if (type === 'auto') {
    const lat = parseFloat(document.querySelector('#plant-lat').value) || 35;
    const alt = parseFloat(document.querySelector('#plant-altitude').value) || 500;
    const env = forestEnvironment(lat, alt, {
      climate: document.querySelector('#plant-climate').value,
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
  labels.push({ element: badge, point: new THREE.Vector3(posX, tree.h + 1.5, posZ) });

  return { group, tree, spec, meta };
}

function buildPlantMode() {
  clearScene();
  currentMode = 'plant';
  document.querySelector('#btn-back').style.display = 'none';
  floor.material.color.setHex(0x324738);

  const type = document.querySelector('#plant-species').value;
  const viewMode = document.querySelector('#plant-view-mode').value;
  const season = document.querySelector('#plant-season').value;
  const scale = parseFloat(document.querySelector('#plant-scale').value) || 1.0;
  let seed = parseInt(document.querySelector('#input-plant-seed').value, 10) || 1001;

  if (viewMode === 'single') {
    const { tree, meta } = createPlantObject(type, seed, scale, season, 0, 0);
    document.querySelector('#nav-status').textContent = '植物單株形態檢驗：【' + meta.name + '】（' + season + '季，種子 ' + seed + '）';
    camTarget.set(0, tree.h * 0.4, 0);
    camDist = Math.max(16, tree.h * 1.5);
  } else if (viewMode === 'variants') {
    const cols = 4, rows = 4;
    const step = 50;
    const startX = -(cols - 1) * step / 2;
    const startZ = -(rows - 1) * step / 2;
    document.querySelector('#nav-status').textContent = '植物 16 株種子變體陣列：【' + (PLANT_NAMES[type] || '環境抽樣') + '】（' + season + '）';

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = startX + c * step;
        const z = startZ + r * step;
        const s = seed + (r * cols + c) * 47;
        createPlantObject(type, s, scale, season, x, z);
      }
    }
    camTarget.set(0, 18, 0);
    camDist = 280;
  } else if (viewMode === 'grove') {
    const speciesList = [
      'redwood', 'sequoia', 'dougfir', 'spruce',
      'euc', 'shorea', 'angelim', 'banyan',
      'willow', 'holmOak', 'rhododendron', 'juniper',
      'forestBamboo', 'mangroveGrey', 'coconut', 'baobab'
    ];
    const cols = 4, rows = 4;
    const step = 52;
    const startX = -(cols - 1) * step / 2;
    const startZ = -(rows - 1) * step / 2;
    document.querySelector('#nav-status').textContent = '林相生態群落混交展示（16 樹種綜合分布）';

    for (let i = 0; i < speciesList.length; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x = startX + c * step, z = startZ + r * step;
      createPlantObject(speciesList[i], seed + i * 23, scale, season, x, z);
    }
    camTarget.set(0, 20, 0);
    camDist = 300;
  }

  updateCamera();
  render();
}

// ==========================================
// 統一互動懸停檢驗 (Hover & Click Inspector)
// ==========================================
function handleHover(e) {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(clickableObjects, false);

  if (intersects.length > 0) {
    const obj = intersects[0].object;
    
    // 1. 建築懸停卡片
    if (obj.userData.buildingMeta) {
      const meta = obj.userData.buildingMeta;
      hoveredBuilding = meta;

      highlightMesh.position.set(meta.centerPos.x, 0.2, meta.centerPos.z);
      highlightMesh.scale.set(meta.sizeDiag, meta.sizeDiag, 1);
      highlightMesh.visible = true;

      const colors = meta.colorScheme;
      const rgbToHex = (rgb) => {
        if (!rgb) return '#888888';
        const r = Math.floor(rgb[0] * 255), g = Math.floor(rgb[1] * 255), b = Math.floor(rgb[2] * 255);
        return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
      };

      const cPrimary = rgbToHex(colors.primary);
      const cTrim    = rgbToHex(colors.trim);
      const cRoof    = rgbToHex(colors.roof);

      const pillsHtml = meta.appurtenances.length > 0
        ? meta.appurtenances.map((p) => '<span class="part-pill">' + p + '</span>').join('')
        : '<span class="part-pill" style="color:#94a3b8">無特殊外掛構件</span>';

      const hintText = currentMode === 'matrix' ? '💡 點擊此建築可展開 16 組隨機參數變體' : '💡 目前處於 16 組隨機展開模式';

      inspectorCard.innerHTML =
        '<h3>' + meta.funcLabel + ' <span style="font-size:11px;color:#94a3b8">#' + meta.seed + '</span></h3>' +
        '<div class="sub">' + meta.styleLabel + ' · ' + meta.regionLabel + ' · ' + meta.roofLabel + '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">📐 物理尺度與量體</div>' +
          '<div class="prop-row"><span class="k">基地占地</span><span class="v">' + meta.w + ' m × ' + meta.d + ' m</span></div>' +
          '<div class="prop-row"><span class="k">量測高度</span><span class="v">' + meta.height + ' m (' + meta.levels + ' 層樓)</span></div>' +
          '<div class="prop-row"><span class="k">外牆材質</span><span class="v">' + meta.facadeLabel + '</span></div>' +
        '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">🎨 文化配色方案</div>' +
          '<div class="color-bar">' +
            '<div class="color-chip"><span class="dot" style="background:' + cPrimary + '"></span>主體</div>' +
            '<div class="color-chip"><span class="dot" style="background:' + cTrim + '"></span>飾邊</div>' +
            '<div class="color-chip"><span class="dot" style="background:' + cRoof + '"></span>屋頂</div>' +
          '</div>' +
        '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">⚙ 外部構件組合 (' + meta.appurtenances.length + ' 項)</div>' +
          '<div class="parts-badges">' + pillsHtml + '</div>' +
        '</div>' +
        '<div class="inspector-hint">' + hintText + '</div>';

      positionInspectorCard(e);
      render();
      return;
    }

    // 2. 地質懸停卡片
    if (obj.userData.geologyMeta) {
      const meta = obj.userData.geologyMeta;
      const entry = meta.entry;
      const p = entry.generation.parameters;
      const r = Math.max(...entry.bounds.size);

      highlightMesh.position.set(meta.posX, 0.15, meta.posZ);
      highlightMesh.scale.set(r * 0.6, r * 0.6, 1);
      highlightMesh.visible = true;

      const surfacePills = Object.entries(entry.generation.surfaceCounts || {})
        .map(([k, count]) => '<span class="part-pill">' + (GEOLOGY_SURFACES[k]?.name || k) + ': ' + count + '面</span>')
        .join('') || '<span class="part-pill">自然岩基面</span>';

      inspectorCard.innerHTML =
        '<h3>🪨 ' + entry.name + ' <span style="font-size:11px;color:#94a3b8">#' + meta.seed + '</span></h3>' +
        '<div class="sub">' + (meta.spec.group || (meta.isAncient ? '人造古蹟石材' : '自然地質成因')) + ' · ' + (p.ageMa ? p.ageMa.toFixed(1) + ' Ma' : '地質構造') + '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">📐 幾何尺度與構型</div>' +
          '<div class="prop-row"><span class="k">構造長寬高</span><span class="v">' + p.width.toFixed(1) + 'm × ' + (p.width * p.depthRatio).toFixed(1) + 'm × ' + entry.bounds.max[1].toFixed(1) + 'm</span></div>' +
          '<div class="prop-row"><span class="k">地層傾角 / 層數</span><span class="v">' + (p.dip ? p.dip.toFixed(0) + '°' : '—') + ' / ' + (p.layers || '—') + ' 層</span></div>' +
          '<div class="prop-row"><span class="k">表面粗糙度</span><span class="v">' + (p.roughness ? p.roughness.toFixed(2) : '—') + '</span></div>' +
          '<div class="prop-row"><span class="k">幾何面數與頂點</span><span class="v">' + (entry.meshData.faces.length / 3) + ' 面 / ' + (entry.meshData.vertices.length / 3) + ' 頂點</span></div>' +
        '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">🌿 岩面質地分佈</div>' +
          '<div class="parts-badges">' + surfacePills + '</div>' +
        '</div>' +
        '<div class="inspector-hint">💡 點擊物件可平移視角並聚焦觀察</div>';

      positionInspectorCard(e);
      render();
      return;
    }

    // 3. 植物懸停卡片
    if (obj.userData.plantMeta) {
      const meta = obj.userData.plantMeta;
      const tree = meta.tree;
      const spec = meta.spec;

      highlightMesh.position.set(meta.posX, 0.15, meta.posZ);
      highlightMesh.scale.set(tree.footprint, tree.footprint, 1);
      highlightMesh.visible = true;

      const rootNames = {
        surface: '地表側根', lateral: '橫向側根', buttress: '板根巨柱',
        pneumatophore: '呼吸根系', aerial: '氣生支柱根', fibrous: '鬚根系',
        shallow: '淺根系', rhizome: '地下走莖'
      };

      const flowers = tree.parts.filter((p) => p.role === 'flower' && !p.organStem).length;
      const fruits = tree.parts.filter((p) => p.role === 'fruit' && !p.organStem).length;
      const organBadges = [];
      if (flowers > 0) organBadges.push('<span class="part-pill" style="background:rgba(236,72,153,0.25);border-color:#f472b6;color:#fbcfe8">🌸 開花數 ×' + flowers + '</span>');
      if (fruits > 0) organBadges.push('<span class="part-pill" style="background:rgba(245,158,11,0.25);border-color:#fbbf24;color:#fef3c7">🍊 著果數 ×' + fruits + '</span>');
      if (organBadges.length === 0) organBadges.push('<span class="part-pill" style="color:#94a3b8">常態葉簇休眠</span>');

      inspectorCard.innerHTML =
        '<h3>🌲 ' + meta.name + ' <span style="font-size:11px;color:#94a3b8">#' + meta.seed + '</span></h3>' +
        '<div class="sub"><i>' + spec.scientific + '</i> · ' + spec.form + '形 · ' + meta.season + '季</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">📐 植物形態尺度</div>' +
          '<div class="prop-row"><span class="k">實生樹高 / 幹圍</span><span class="v">' + tree.h.toFixed(1) + ' m / ' + tree.girth.toFixed(1) + ' m</span></div>' +
          '<div class="prop-row"><span class="k">主枝數 / 冠幅占地</span><span class="v">' + tree.branchCount + ' 枝 / 徑 ' + (tree.footprint * 2).toFixed(1) + ' m</span></div>' +
          '<div class="prop-row"><span class="k">根系機制 / 幹數</span><span class="v">' + (rootNames[spec.roots] || spec.roots) + ' / ' + tree.stems.length + ' 幹</span></div>' +
          '<div class="prop-row"><span class="k">立體構件總數</span><span class="v">' + tree.parts.length + ' 件 (葉簇 ' + tree.parts.filter((p) => p.role === 'leaf').length + ' 團)</span></div>' +
        '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">🌸 季候器官與特徵</div>' +
          '<div class="parts-badges">' + organBadges.join('') + '</div>' +
        '</div>' +
        '<div class="inspector-hint">💡 點擊樹木可平移視角並聚焦觀察</div>';

      positionInspectorCard(e);
      render();
      return;
    }
  }

  highlightMesh.visible = false;
  inspectorCard.style.display = 'none';
  render();
}

function positionInspectorCard(e) {
  const cardW = 340, cardH = 320;
  let left = e.clientX + 16;
  let top = e.clientY + 16;
  if (left + cardW > innerWidth) left = e.clientX - cardW - 16;
  if (top + cardH > innerHeight) top = innerHeight - cardH - 16;
  inspectorCard.style.left = left + 'px';
  inspectorCard.style.top = top + 'px';
  inspectorCard.style.display = 'block';
}

function handleClick(e) {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(clickableObjects, false);
  if (intersects.length > 0) {
    const obj = intersects[0].object;
    if (obj.userData.buildingMeta && currentMode === 'matrix') {
      buildVariantsMode(obj.userData.buildingMeta);
    } else if (obj.userData.geologyMeta) {
      const meta = obj.userData.geologyMeta;
      camTarget.set(meta.posX, meta.entry.bounds.max[1] * 0.4, meta.posZ);
      updateCamera();
      render();
    } else if (obj.userData.plantMeta) {
      const meta = obj.userData.plantMeta;
      camTarget.set(meta.posX, meta.tree.h * 0.4, meta.posZ);
      updateCamera();
      render();
    }
  }
}

// ==========================================
// 頁籤切換與整體事件綁定
// ==========================================
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
  }

  const activePanel = document.querySelector('#panel-' + tabKey);
  if (activePanel) activePanel.style.display = 'block';

  if (tabKey === 'arch') {
    buildMatrixMode({ advance: false });
  } else if (tabKey === 'geology') {
    buildGeologyMode();
  } else if (tabKey === 'plant') {
    buildPlantMode();
  }
}

document.querySelectorAll('.cat-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelector('#btn-nav-reset-cam')?.addEventListener('click', () => {
  if (currentTab === 'arch') {
    resetFocus();
  } else if (currentTab === 'geology') {
    camTarget.set(0, 4, 0);
    camDist = document.querySelector('#geo-view-mode').value === 'variants' ? 140 : 45;
    camPhi = 1.05;
    camTheta = 0.55;
    updateCamera();
    render();
  } else if (currentTab === 'plant') {
    camTarget.set(0, 5, 0);
    const mode = document.querySelector('#plant-view-mode').value;
    camDist = mode === 'forest' ? 120 : (mode === 'variants' ? 95 : 35);
    camPhi = 1.1;
    camTheta = 0.6;
    updateCamera();
    render();
  }
});

// 地質控制器事件
document.querySelector('#btn-geo-generate')?.addEventListener('click', buildGeologyMode);
document.querySelector('#btn-geo-next-seed')?.addEventListener('click', () => {
  const input = document.querySelector('#input-geo-seed');
  input.value = (parseInt(input.value, 10) || 42) + 1;
  buildGeologyMode();
});
document.querySelector('#btn-geo-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-geo-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildGeologyMode();
});
document.querySelector('#btn-geo-variants')?.addEventListener('click', () => {
  document.querySelector('#geo-view-mode').value = 'variants';
  buildGeologyMode();
});
['#geo-type', '#geo-view-mode', '#geo-climate', '#geo-water', '#geo-region', '#geo-ruin-type', '#geo-scale'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('change', () => {
    const isAncient = GEOLOGY_TYPES[document.querySelector('#geo-type').value]?.lithology === 'manufactured';
    document.querySelector('#geo-ancient-box').style.display = isAncient ? 'block' : 'none';
    buildGeologyMode();
  });
});
['#geo-moisture', '#geo-vegetation', '#geo-conifers', '#geo-exposure', '#geo-slope', '#geo-fault', '#geo-volcanic', '#geo-dissolution', '#geo-geothermal', '#geo-activity'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('input', () => {
    if (document.querySelector('#geo-view-mode').value === 'single') buildGeologyMode();
  });
});

// 植物控制器事件
document.querySelector('#btn-plant-generate')?.addEventListener('click', buildPlantMode);
document.querySelector('#btn-plant-next-seed')?.addEventListener('click', () => {
  const input = document.querySelector('#input-plant-seed');
  input.value = (parseInt(input.value, 10) || 1001) + 1;
  buildPlantMode();
});
document.querySelector('#btn-plant-random-seed')?.addEventListener('click', () => {
  document.querySelector('#input-plant-seed').value = Math.floor(Math.random() * 90000) + 1000;
  buildPlantMode();
});
document.querySelector('#btn-plant-variants')?.addEventListener('click', () => {
  document.querySelector('#plant-view-mode').value = 'variants';
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

document.querySelector('#btn-reset-cam').addEventListener('click', () => {
  camDist = currentTab === 'plant' ? 120 : currentTab === 'geology' ? 140 : 320;
  camTheta = 0.85;
  camPhi = 0.62;
  camTarget.set(0, 6, 0);
  updateCamera();
  render();
});

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

// 初次建構
try {
  setupFilterModal();
  buildMatrixMode();
} catch (err) {
  console.error('初次建構失敗:', err);
}

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
      } else if (url.pathname === '/three.mjs') {
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
