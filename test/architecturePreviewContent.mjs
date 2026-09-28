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
