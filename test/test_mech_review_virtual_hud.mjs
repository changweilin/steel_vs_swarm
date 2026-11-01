import { chromiumOrNull, chromePath } from '../tools/pw.mjs';
import { serve } from '../tools/mech_prompt_review.mjs';

async function run() {
  console.log('--- 驗證機體審查台半透明虛擬按鍵 HUD 與動作仿照 ---');
  const server = serve(0, { threeModule: 'out/forest_review/three.module.js' });
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const port = server.address().port;

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
    // 1. 載入無人機 (s01 - drones)
    await page.goto(`http://127.0.0.1:${port}/?mech=s01`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit);

    // 驗證 HUD 存在於 3D 視口 (.view-viewport 包含 #cv3d) 內
    const hudInfo = await page.evaluate(() => {
      const hud = document.getElementById('virtualActionHud');
      const cv3d = document.getElementById('cv3d');
      const vp3d = cv3d?.parentElement;
      return {
        exists: !!hud,
        inside3DViewport: !!(vp3d && vp3d.contains(hud)),
        buttonsCount: hud ? hud.querySelectorAll('.btn-virtual-action').length : 0
      };
    });
    console.log('HUD 位置資訊:', hudInfo);
    if (!hudInfo.exists || !hudInfo.inside3DViewport) {
      throw new Error('virtualActionHud 不存在或未置於 3D 視口內！');
    }

    // 驗證無人機動作按鍵：無人機無跳躍、無大跳躍、無變形
    const droneButtons = await page.evaluate(() => {
      const getDisp = id => window.getComputedStyle(document.getElementById(id)).display;
      return {
        light: getDisp('btnActionLight'),
        attack: getDisp('btnActionAttack'),
        skill: getDisp('btnActionSkill'),
        ult: getDisp('btnActionUlt'),
        jump: getDisp('btnActionJump'),
        highJump: getDisp('btnActionHighJump'),
        morph: getDisp('btnMorphToggle'),
        slow: getDisp('btnSlowMotion')
      };
    });
    console.log('無人機按鈕顯示狀態:', droneButtons);
    if (droneButtons.jump !== 'none' || droneButtons.highJump !== 'none' || droneButtons.morph !== 'none') {
      throw new Error(`無人機不應顯示跳躍/大跳躍/變形按鈕！got: ${JSON.stringify(droneButtons)}`);
    }
    if (droneButtons.light === 'none' || droneButtons.attack === 'none' || droneButtons.slow === 'none') {
      throw new Error('無人機基礎動作與慢動作按鈕未正常顯示！');
    }

    // 2. 切換至機甲 (s06 - robots)
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s06'));
    await page.waitForTimeout(400);

    const robotButtons = await page.evaluate(() => {
      const getDisp = id => window.getComputedStyle(document.getElementById(id)).display;
      return {
        jump: getDisp('btnActionJump'),
        highJump: getDisp('btnActionHighJump'),
        morph: getDisp('btnMorphToggle')
      };
    });
    console.log('機甲按鈕顯示狀態:', robotButtons);
    if (robotButtons.jump === 'none' || robotButtons.highJump === 'none') {
      throw new Error('機甲應顯示跳躍與大跳躍按鈕！');
    }
    if (robotButtons.morph !== 'none') {
      throw new Error('機甲不應顯示變形按鈕！');
    }

    // 3. 切換至變形者 (s03 - morphers)
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s03'));
    await page.waitForTimeout(400);

    const morpherGround = await page.evaluate(() => {
      const getDisp = id => window.getComputedStyle(document.getElementById(id)).display;
      return {
        jump: getDisp('btnActionJump'),
        highJump: getDisp('btnActionHighJump'),
        morph: getDisp('btnMorphToggle')
      };
    });
    console.log('變形者地面型顯示狀態:', morpherGround);
    if (morpherGround.jump === 'none' || morpherGround.morph === 'none') {
      throw new Error('變形者地面型應顯示跳躍與變形按鈕！');
    }
    if (morpherGround.highJump !== 'none') {
      throw new Error('變形者不應顯示大跳躍按鈕！');
    }

    // 變形切換至飛行型
    await page.click('#btnMorphToggle');
    await page.waitForTimeout(300);

    const morpherFlight = await page.evaluate(() => {
      const getDisp = id => window.getComputedStyle(document.getElementById(id)).display;
      return {
        isFlight: window.__MECH_REVIEW.preview.morphTarget > 0.5,
        jump: getDisp('btnActionJump'),
        highJump: getDisp('btnActionHighJump'),
        morph: getDisp('btnMorphToggle')
      };
    });
    console.log('變形者飛行型顯示狀態:', morpherFlight);
    if (!morpherFlight.isFlight) {
      throw new Error('變形者未成功切換至飛行型！');
    }
    if (morpherFlight.jump !== 'none') {
      throw new Error('變形者飛行型不應顯示跳躍按鈕！');
    }

    // 4. 驗證慢動作按鍵與 KeyT 快捷鍵
    const slowInit = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const b = document.getElementById('btnSlowMotion');
      return {
        slowMotion: p.slowMotion,
        timeScale: p.timeScale,
        text: b.textContent.trim(),
        hasActive: b.classList.contains('active')
      };
    });
    console.log('慢動作初始狀態:', slowInit);
    if (slowInit.slowMotion || slowInit.timeScale !== 1) {
      throw new Error('慢動作初始狀態應為未啟用 (timeScale 1)！');
    }

    // 點擊慢動作按鈕
    await page.click('#btnSlowMotion');
    await page.waitForTimeout(100);

    const slowActive = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const b = document.getElementById('btnSlowMotion');
      return {
        slowMotion: p.slowMotion,
        timeScale: p.timeScale,
        text: b.textContent.trim(),
        hasActive: b.classList.contains('active')
      };
    });
    console.log('點擊慢動作後狀態:', slowActive);
    if (!slowActive.slowMotion || Math.abs(slowActive.timeScale - 0.3) > 0.01 || !slowActive.hasActive) {
      throw new Error('慢動作點擊後未正確啟用 0.3x！');
    }

    // 按 KeyT 鍵還原慢動作
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(100);

    const slowRestored = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const b = document.getElementById('btnSlowMotion');
      return {
        slowMotion: p.slowMotion,
        timeScale: p.timeScale,
        hasActive: b.classList.contains('active')
      };
    });
    console.log('KeyT 還原慢動作後狀態:', slowRestored);
    if (slowRestored.slowMotion || slowRestored.timeScale !== 1 || slowRestored.hasActive) {
      throw new Error('KeyT 快捷鍵未能切換還原慢動作！');
    }

    // 5. 驗證移動按鍵 (WASD / 方向鍵按住移動、放開停下) 與按鈕點擊切換
    const runInit = await page.evaluate(() => {
      const b = document.getElementById('btnRunMode');
      return {
        runMode: window.__MECH_REVIEW.preview.runMode,
        text: b.textContent.trim(),
        badge: b.querySelector('.key-badge')?.textContent.trim()
      };
    });
    console.log('移動模式初始狀態:', runInit);
    if (!runInit.text.includes('移動') || runInit.badge !== 'WASD') {
      throw new Error(`移動按鍵標籤或快捷鍵徽章不正確: text=${runInit.text}, badge=${runInit.badge}`);
    }

    // 按下 KeyW (keydown)：仿照遊戲操作，按住移動
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(100);
    const wDownState = await page.evaluate(() => {
      const b = document.getElementById('btnRunMode');
      return {
        runMode: window.__MECH_REVIEW.preview.runMode,
        hasActive: b.classList.contains('active')
      };
    });
    console.log('按住 KeyW 狀態:', wDownState);
    if (wDownState.runMode !== 'normal' || !wDownState.hasActive) {
      throw new Error('按住 KeyW 未能啟動移動！');
    }

    // 放開 KeyW (keyup)：放開即停下
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(100);
    const wUpState = await page.evaluate(() => {
      const b = document.getElementById('btnRunMode');
      return {
        runMode: window.__MECH_REVIEW.preview.runMode,
        hasActive: b.classList.contains('active')
      };
    });
    console.log('放開 KeyW 狀態:', wUpState);
    if (wUpState.runMode !== 'idle' || wUpState.hasActive) {
      throw new Error('放開 KeyW 未能停下移動！');
    }

    // 按住方向鍵 ArrowUp
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(100);
    const arrowDownState = await page.evaluate(() => window.__MECH_REVIEW.preview.runMode);
    if (arrowDownState !== 'normal') {
      throw new Error('按住 ArrowUp 方向鍵未能啟動移動！');
    }
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(100);
    const arrowUpState = await page.evaluate(() => window.__MECH_REVIEW.preview.runMode);
    if (arrowUpState !== 'idle') {
      throw new Error('放開 ArrowUp 方向鍵未能停下移動！');
    }

    // 點擊虛擬移動按鈕 (便利展示巡航切換)
    await page.click('#btnRunMode');
    await page.waitForTimeout(100);
    const runToggled = await page.evaluate(() => {
      return {
        runMode: window.__MECH_REVIEW.preview.runMode,
        text: document.getElementById('btnRunMode').textContent.trim()
      };
    });
    console.log('點擊虛擬按鈕切換後移動模式:', runToggled);
    if (runToggled.runMode !== 'normal') {
      throw new Error(`移動模式切換後應為 normal，得到 ${runToggled.runMode}`);
    }

    // 再次點擊還原靜止
    await page.click('#btnRunMode');
    await page.waitForTimeout(100);
    const runStopped = await page.evaluate(() => {
      return {
        runMode: window.__MECH_REVIEW.preview.runMode,
        text: document.getElementById('btnRunMode').textContent.trim()
      };
    });
    console.log('再次點擊還原靜止狀態:', runStopped);
    if (runStopped.runMode !== 'idle') {
      throw new Error(`再次點擊應回到 idle，得到 ${runStopped.runMode}`);
    }

    if (pageErrors.length > 0) {
      throw new Error(`頁面發生未預期錯誤: ${pageErrors.join('; ')}`);
    }

    console.log('✅ 機體審查台半透明虛擬按鍵與慢動作按鍵測試全部通過！');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
