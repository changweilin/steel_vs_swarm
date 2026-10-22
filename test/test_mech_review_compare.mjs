import { chromiumOrNull, chromePath } from '../tools/pw.mjs';
import { serve } from '../tools/mech_prompt_review.mjs';

async function run() {
  console.log('--- 開始驗證機體審查台整併功能 ---');
  const server = serve(0, { threeModule: 'out/forest_review/three.module.js' });
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const port = server.address().port;
  console.log(`測試伺服器端口: ${port}`);

  const chromium = await chromiumOrNull();
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/?mech=s01`, { waitUntil: 'domcontentloaded' });

    // 1. 驗證標題與更名
    const title = await page.title();
    console.log(`頁面標題: ${title}`);
    if (!title.includes('機體審查台')) throw new Error(`標題未更名為機體審查台: ${title}`);

    const brand = await page.textContent('.brand-title span');
    console.log(`品牌標題: ${brand}`);
    if (brand !== '機體審查台') throw new Error(`導航列未更名為機體審查台: ${brand}`);

    // 等待 3D 初始化完成
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit);
    console.log('✓ 3D 核心模型 (preview.unit) 成功加載');

    // 2. 驗證 2D 立繪預設向左收合，以及邊界懸停按鍵
    const is2DCollapsedInitial = await page.evaluate(() => {
      const el = document.getElementById('standeeSubpanel');
      return el.classList.contains('collapsed') && getComputedStyle(el).display === 'none';
    });
    console.log(`2D 立繪預設收合狀態: ${is2DCollapsedInitial}`);
    if (!is2DCollapsedInitial) throw new Error('2D 立繪未預設收合！');

    // 驗證未懸停時邊界按鍵透明度為 0
    await page.mouse.move(500, 500);
    const initialEdgeOp = await page.evaluate(() => {
      const bLeft = getComputedStyle(document.getElementById('btnEdgeToggle2D')).opacity;
      const bRight = getComputedStyle(document.getElementById('btnEdgeToggleWorkbench')).opacity;
      return { bLeft, bRight };
    });
    console.log('未懸停邊界時按鍵透明度:', initialEdgeOp);
    if (initialEdgeOp.bLeft !== '0' || initialEdgeOp.bRight !== '0') {
      throw new Error('未懸停邊界時收合按鍵未隱藏！');
    }

    // 滑鼠懸停至左側 3D 邊界熱區 (#edgeZoneLeft)
    await page.hover('#edgeZoneLeft');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('btnEdgeToggle2D')).opacity === '1');
    const hoverLeftOp = await page.evaluate(() => {
      return getComputedStyle(document.getElementById('btnEdgeToggle2D')).opacity;
    });
    console.log(`懸停左邊界按鍵透明度: ${hoverLeftOp}`);
    if (hoverLeftOp !== '1') throw new Error('懸停左邊界時按鍵未顯現！');

    // 點擊邊界按鍵展開 2D
    await page.click('#btnEdgeToggle2D');
    const is2DExpanded = await page.evaluate(() => {
      const el = document.getElementById('standeeSubpanel');
      return !el.classList.contains('collapsed') && getComputedStyle(el).display !== 'none';
    });
    console.log(`邊界按鍵點擊展開後狀態: ${is2DExpanded}`);
    if (!is2DExpanded) throw new Error('點擊展開 2D 立繪失敗！');

    // 展開後 3D 邊界位置平移，重新懸停新邊界熱區並收合 2D
    await page.hover('#edgeZoneLeft');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('btnEdgeToggle2D')).opacity === '1');
    await page.click('#btnEdgeToggle2D');
    const is2DCollapsedAgain = await page.evaluate(() => {
      const el = document.getElementById('standeeSubpanel');
      return el.classList.contains('collapsed') && getComputedStyle(el).display === 'none';
    });
    console.log(`邊界按鍵點擊收合後狀態: ${is2DCollapsedAgain}`);
    if (!is2DCollapsedAgain) throw new Error('點擊收合 2D 立繪失敗！');

    // 3. 驗證 Prompt / 規格工作台預設向右收合，以及邊界懸停按鍵
    const isWbCollapsedInitial = await page.evaluate(() => {
      const ws = document.getElementById('appWorkspace');
      const wb = document.querySelector('.spec-workbench-pane');
      return ws.classList.contains('workbench-collapsed') && getComputedStyle(wb).display === 'none';
    });
    console.log(`規格/Prompt 工作區預設收合狀態: ${isWbCollapsedInitial}`);
    if (!isWbCollapsedInitial) throw new Error('規格/Prompt 工作區未預設收合！');

    // 滑鼠懸停至右側 3D 邊界熱區 (#edgeZoneRight)
    await page.hover('#edgeZoneRight');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('btnEdgeToggleWorkbench')).opacity === '1');
    const hoverRightOp = await page.evaluate(() => {
      return getComputedStyle(document.getElementById('btnEdgeToggleWorkbench')).opacity;
    });
    console.log(`懸停右邊界按鍵透明度: ${hoverRightOp}`);
    if (hoverRightOp !== '1') throw new Error('懸停右邊界時按鍵未顯現！');

    // 點擊邊界按鍵展開工作台
    await page.click('#btnEdgeToggleWorkbench');
    const isWbExpanded = await page.evaluate(() => {
      const ws = document.getElementById('appWorkspace');
      const wb = document.querySelector('.spec-workbench-pane');
      return !ws.classList.contains('workbench-collapsed') && getComputedStyle(wb).display !== 'none';
    });
    console.log(`邊界按鍵點擊展開後狀態: ${isWbExpanded}`);
    if (!isWbExpanded) throw new Error('點擊展開規格/Prompt 工作區失敗！');

    // 展開後 3D 右邊界位置平移，重新懸停新邊界熱區並收合工作台
    await page.hover('#edgeZoneRight');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('btnEdgeToggleWorkbench')).opacity === '1');
    await page.click('#btnEdgeToggleWorkbench');
    const isWbCollapsedAgain = await page.evaluate(() => {
      const ws = document.getElementById('appWorkspace');
      const wb = document.querySelector('.spec-workbench-pane');
      return ws.classList.contains('workbench-collapsed') && getComputedStyle(wb).display === 'none';
    });
    console.log(`邊界按鍵點擊收合後狀態: ${isWbCollapsedAgain}`);
    if (!isWbCollapsedAgain) throw new Error('點擊收合規格/Prompt 工作區失敗！');

    // 4. 驗證三版本多選與並排展示
    console.log('開始測試三版本多選...');
    // 勾選 steel_v_swarm
    await page.click('#chkVerSteel');
    // 勾選 argon blender vfx
    await page.click('#chkVerArgon');

    // 等待所有模型異步載入完成
    await page.waitForFunction(() => {
      const p = window.__MECH_REVIEW?.preview;
      // 確保場景內已掛載 compareGroup 且包含 2 個額外模型 + 3 個 banner
      return p && p.scene.children.some(c => c.isGroup && c.children.length >= 2);
    }, { timeout: 8000 });

    const compareState = await page.evaluate(() => {
      const chk1 = document.getElementById('chkVerCurrent').checked;
      const chk2 = document.getElementById('chkVerSteel').checked;
      const chk3 = document.getElementById('chkVerArgon').checked;
      const p = window.__MECH_REVIEW.preview;
      return {
        chk1, chk2, chk3,
        currentPosX: p.holder.position.x,
        wantR: p.wantR,
        fitR: p.fitR,
      };
    });
    console.log('三版本勾選與並排佈局狀態:', compareState);
    if (!compareState.chk1 || !compareState.chk2 || !compareState.chk3) {
      throw new Error('三版本勾選框狀態不正確！');
    }
    if (compareState.currentPosX >= 0) {
      throw new Error('三版本並排時本專案模型未偏移至左側 (x < 0)！');
    }

    // 5. 驗證動作同步播放 (輕射擊、重射擊、防守、大招、跑步模式)
    console.log('測試動作同步控制...');
    await page.click('#btnActionLight');
    await page.waitForTimeout(200);

    await page.click('#btnActionAttack');
    await page.waitForTimeout(200);

    await page.click('#btnActionSkill');
    await page.waitForTimeout(200);

    await page.click('#btnActionUlt');
    await page.waitForTimeout(200);

    await page.click('#btnRunMode');
    const runModeText = await page.textContent('#btnRunMode');
    console.log(`運動模式切換: ${runModeText}`);

    // 6. 驗證切換機體
    console.log('切換機體至變形者 s03...');
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s03'));
    await page.waitForFunction(() => {
      const p = window.__MECH_REVIEW?.preview;
      return p && p.charId === 's03' && p.scene.children.some(c => c.isGroup && c.children.length >= 2);
    }, { timeout: 8000 });
    console.log('✓ s03 三版本切換與載入成功');

    // 測試變形切換
    await page.click('#btnMorphToggle');
    const morphLabel = await page.textContent('#morphPoseLabel');
    console.log(`變形切換標籤: ${morphLabel}`);
    if (!morphLabel.includes('飛行型')) throw new Error('變形切換未生效！');

    // 7. 驗證建模組成複雜度彈窗
    console.log('測試建模組成複雜度彈窗...');
    await page.click('#btnComplexity');
    await page.waitForSelector('#complexityModal table.comp-table', { timeout: 5000 });

    const compData = await page.evaluate(() => {
      const table = document.querySelector('#complexityModal table.comp-table');
      const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        return { metric: cells[0], v1: cells[1], v2: cells[2], v3: cells[3] };
      });
      return rows;
    });
    console.log('複雜度比對表格維度總數:', compData.length);
    console.log('前 3 筆比對數據:', compData.slice(0, 3));
    if (compData.length < 5) throw new Error('複雜度表格列數不足！');

    // 關閉複雜度彈窗
    await page.click('#btnCloseCompModal');
    const isModalClosed = await page.evaluate(() => {
      return document.getElementById('complexityModal').style.display === 'none';
    });
    console.log(`複雜度彈窗關閉狀態: ${isModalClosed}`);
    if (!isModalClosed) throw new Error('複雜度彈窗未關閉！');

    // 8. 驗證舊按鍵徹底自 DOM 移除
    console.log('驗證舊展開/收合按鈕已自 DOM 移除...');
    const oldBtnsExist = await page.evaluate(() => {
      return {
        btnToggle2D: !!document.getElementById('btnToggle2D'),
        btnCollapse2D: !!document.getElementById('btnCollapse2D'),
        btnToggleWorkbench: !!document.getElementById('btnToggleWorkbench'),
        btnCloseWorkbench: !!document.getElementById('btnCloseWorkbench'),
      };
    });
    console.log('舊按鈕存在狀況:', oldBtnsExist);
    if (oldBtnsExist.btnToggle2D || oldBtnsExist.btnCollapse2D || oldBtnsExist.btnToggleWorkbench || oldBtnsExist.btnCloseWorkbench) {
      throw new Error(`舊按鈕未徹底移除: ${JSON.stringify(oldBtnsExist)}`);
    }

    // 9. 驗證邊界滑鼠拖曳調整寬度
    console.log('驗證邊界滑鼠拖曳調整寬度...');
    // 展開 2D 面板
    await page.evaluate(() => window.__MECH_REVIEW.toggle2DStandee(true));
    await page.waitForTimeout(200);
    const initStandeeWidth = await page.evaluate(() => {
      return document.getElementById('standeeSubpanel').getBoundingClientRect().width;
    });
    console.log(`2D 初始寬度: ${initStandeeWidth}px`);

    // 取得 #edgeZoneLeft 的 bounding box
    const edgeLeftBox = await page.evaluate(() => {
      const rect = document.getElementById('edgeZoneLeft').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + 100 };
    });

    // 拖曳向右移動 80px
    await page.mouse.move(edgeLeftBox.x, edgeLeftBox.y);
    await page.mouse.down();
    await page.mouse.move(edgeLeftBox.x + 80, edgeLeftBox.y, { steps: 5 });
    await page.mouse.up();

    const afterStandeeWidth = await page.evaluate(() => {
      const w = document.getElementById('standeeSubpanel').getBoundingClientRect().width;
      const stored = localStorage.getItem('mech_review_standee_width');
      return { w, stored };
    });
    console.log(`2D 拖曳後寬度: ${afterStandeeWidth.w}px, LocalStorage: ${afterStandeeWidth.stored}`);
    if (Math.abs(afterStandeeWidth.w - (initStandeeWidth + 80)) > 20) {
      throw new Error(`2D 拖曳寬度未正確變更！期望 ~${initStandeeWidth + 80}px, 實際 ${afterStandeeWidth.w}px`);
    }
    if (!afterStandeeWidth.stored) {
      throw new Error('2D 拖曳後寬度未儲存至 localStorage！');
    }

    // 收合 2D 面板以便測試 Workbench
    await page.evaluate(() => window.__MECH_REVIEW.toggle2DStandee(false));
    await page.waitForTimeout(200);

    // 展開 Prompt 規格工作台
    await page.evaluate(() => window.__MECH_REVIEW.toggleWorkbench(true));
    await page.waitForTimeout(200);
    const initWbWidth = await page.evaluate(() => {
      return document.querySelector('.spec-workbench-pane').getBoundingClientRect().width;
    });
    console.log(`Workbench 初始寬度: ${initWbWidth}px`);

    // 取得 #edgeZoneRight 的 bounding box
    const edgeRightBox = await page.evaluate(() => {
      const rect = document.getElementById('edgeZoneRight').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + 100 };
    });

    // 拖曳向左移動 100px (使右側 workbench 變寬 100px)
    await page.mouse.move(edgeRightBox.x, edgeRightBox.y);
    await page.mouse.down();
    await page.mouse.move(edgeRightBox.x - 100, edgeRightBox.y, { steps: 5 });
    await page.mouse.up();

    const afterWbWidth = await page.evaluate(() => {
      const w = document.querySelector('.spec-workbench-pane').getBoundingClientRect().width;
      const stored = localStorage.getItem('mech_review_wb_width');
      return { w, stored };
    });
    console.log(`Workbench 拖曳後寬度: ${afterWbWidth.w}px, LocalStorage: ${afterWbWidth.stored}`);
    if (Math.abs(afterWbWidth.w - (initWbWidth + 100)) > 15) {
      throw new Error(`Workbench 拖曳寬度未正確變更！期望 ~${initWbWidth + 100}px, 實際 ${afterWbWidth.w}px`);
    }
    if (!afterWbWidth.stored) {
      throw new Error('Workbench 拖曳後寬度未儲存至 localStorage！');
    }

    // 10. 驗證建模版本勾選持久化記憶
    console.log('驗證版本勾選持久化記憶...');
    // 取消本專案勾選，只留 steel_v_swarm 與 argon
    await page.click('#chkVerCurrent');
    const checkedBeforeReload = await page.evaluate(() => {
      return {
        current: document.getElementById('chkVerCurrent').checked,
        steel: document.getElementById('chkVerSteel').checked,
        argon: document.getElementById('chkVerArgon').checked,
        stored: localStorage.getItem('mech_review_checked_versions'),
      };
    });
    console.log('重載前勾選與儲存狀態:', checkedBeforeReload);
    if (checkedBeforeReload.current !== false || checkedBeforeReload.steel !== true || checkedBeforeReload.argon !== true) {
      throw new Error('勾選設定未如預期！');
    }

    // 重新載入頁面
    console.log('重新載入頁面以測試記憶還原...');
    await page.goto(`http://127.0.0.1:${port}/?mech=s01`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit);

    const checkedAfterReload = await page.evaluate(() => {
      return {
        current: document.getElementById('chkVerCurrent').checked,
        steel: document.getElementById('chkVerSteel').checked,
        argon: document.getElementById('chkVerArgon').checked,
      };
    });
    console.log('重載後還原狀態:', checkedAfterReload);
    if (checkedAfterReload.current !== false || checkedAfterReload.steel !== true || checkedAfterReload.argon !== true) {
      throw new Error(`版本勾選記憶還原失敗: ${JSON.stringify(checkedAfterReload)}`);
    }

    // 驗證全取消防呆（全取消應自動回退勾選本專案）
    await page.evaluate(() => {
      document.getElementById('chkVerSteel').checked = false;
      document.getElementById('chkVerArgon').checked = false;
      document.getElementById('chkVerSteel').dispatchEvent(new Event('change'));
    });
    const fallbackCheck = await page.evaluate(() => {
      return document.getElementById('chkVerCurrent').checked;
    });
    console.log(`全取消時自動回退本專案勾選狀態: ${fallbackCheck}`);
    if (!fallbackCheck) throw new Error('全取消時未回退勾選本專案！');

    if (pageErrors.length > 0) {
      throw new Error(`頁面出現錯誤:\n${pageErrors.join('\n')}`);
    }

    console.log('✅ 所有機體審查台驗證全部通過，0 錯誤！');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
