export const GEOGRAPHIC_CONTROLS = `
  <div id="panel-geographic" class="cat-panel" style="display:none;">
    <div class="controls-row">
      <label>實景場地 <select id="geographic-venue"></select></label>
      <button id="btn-geographic-build" class="btn-generate" type="button">建立融合場景</button>
      <button id="btn-geographic-export" class="btn-randomize" type="button" disabled>匯出 Blender 場景</button>
    </div>
    <p id="geographic-status" role="status">選擇場地後建立：建築、林相、植被、地表與水域。</p>
    <p>衛星與 OSM 提供覆蓋、輪廓及標籤；未測繪的建物高度、樹種與岩性仍為程序推定或未知。</p>
    <p>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> ·
      <a href="https://esa-worldcover.org/en/data-access" target="_blank" rel="noopener">ESA WorldCover 2021</a> · CC BY 4.0</p>
  </div>`;

export const GEOLOGY_ENVIRONMENT_CONTROLS = `
  <label>緯度 °（南緯為負）<input type="number" id="geo-latitude" min="-90" max="90" step="1" value="25"></label>
  <label>海拔 m<input type="number" id="geo-altitude" min="-11000" max="9000" step="50" value="100"></label>
  <label>地質基底<select id="geo-substrate">
    <option value="unknown">自動／未指定</option>
    <option value="granite">花崗岩</option>
    <option value="basalt">玄武岩</option>
    <option value="limestone">石灰岩</option>
    <option value="sandstone">砂岩</option>
    <option value="alluvium">沖積層</option>
  </select></label>`;
