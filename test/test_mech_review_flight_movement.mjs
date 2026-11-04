// ============ 機體審查台：飛行移動呈現與動作同步測試 ============
import { chromiumOrNull, chromePath } from '../tools/pw.mjs';
import { serve } from '../tools/mech_prompt_review.mjs';

async function run() {
  console.log('--- 驗證機體審查台飛行移動呈現與多版本比對動作同步 ---');
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

  try {
    console.log('1. 測試無人機 (s01) 飛行移動與比對動作...');
    await page.goto(`http://127.0.0.1:${port}/?mech=s01`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.charId === 's01' && window.__MECH_REVIEW?.preview?.unit);

    // 勾選三版本比對
    await page.evaluate(() => {
      document.getElementById('chkVerCurrent').checked = true;
      document.getElementById('chkVerSteel').checked = true;
      document.getElementById('chkVerArgon').checked = true;
      document.getElementById('chkVerSteel').dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.externalUnits?.length === 2);
    await page.waitForTimeout(300);

    // 檢查無人機移動按鈕文字包含 ✈
    const btnRunText = await page.$eval('#btnRunMode', el => el.textContent);
    console.log('無人機初始按鈕文字:', btnRunText.trim());
    if (!btnRunText.includes('✈')) {
      throw new Error(`無人機移動按鈕未顯示飛行圖標 ✈！got: ${btnRunText}`);
    }

    // 按下 W 前進
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);

    const droneMoveW = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const svs = p.externalUnits.find(u => u.verKey === 'steel_v_swarm');
      const argon = p.externalUnits.find(u => u.verKey === 'argon_vfx');
      return {
        moving: p.moving,
        speed: p.speed,
        moveFwd: p.moveFwd,
        moveRight: p.moveRight,
        svsClip: svs?.getCurrentClip?.(),
        argonClip: argon?.getCurrentClip?.(),
      };
    });
    console.log('無人機 W 前進狀態:', droneMoveW);
    if (!droneMoveW.moving || droneMoveW.speed <= 0) {
      throw new Error('無人機按 W 未進入移動狀態！');
    }
    if (droneMoveW.svsClip !== 'run' || droneMoveW.argonClip !== 'run') {
      throw new Error(`無人機移動比對模型動作錯誤！svs: ${droneMoveW.svsClip}, argon: ${droneMoveW.argonClip}`);
    }

    await page.keyboard.up('KeyW');
    await page.waitForTimeout(200);

    // 按下 S 後退 (Argon VFX 具備 move_backward)
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(300);

    const droneMoveS = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const argon = p.externalUnits.find(u => u.verKey === 'argon_vfx');
      return {
        moveFwd: p.moveFwd,
        argonClip: argon?.getCurrentClip?.(),
      };
    });
    console.log('無人機 S 後退狀態:', droneMoveS);
    if (droneMoveS.moveFwd !== -1 || droneMoveS.argonClip !== 'move_backward') {
      throw new Error(`無人機後退動作錯誤！moveFwd: ${droneMoveS.moveFwd}, argon: ${droneMoveS.argonClip}`);
    }

    await page.keyboard.up('KeyS');
    await page.waitForTimeout(200);

    // 按下 D 右移 (Argon VFX 具備 strafe_right)
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);

    const droneMoveD = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const argon = p.externalUnits.find(u => u.verKey === 'argon_vfx');
      return {
        moveRight: p.moveRight,
        argonClip: argon?.getCurrentClip?.(),
      };
    });
    console.log('無人機 D 右移狀態:', droneMoveD);
    if (droneMoveD.moveRight !== 1 || droneMoveD.argonClip !== 'strafe_right') {
      throw new Error(`無人機右移動作錯誤！moveRight: ${droneMoveD.moveRight}, argon: ${droneMoveD.argonClip}`);
    }

    await page.keyboard.up('KeyD');
    await page.waitForTimeout(200);

    console.log('2. 測試變形者 (s03) 飛行型移動與離地懸停...');
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s03'));
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.charId === 's03' && window.__MECH_REVIEW?.preview?.unit);
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.externalUnits?.length === 2);
    await page.waitForTimeout(300);

    // 切換至飛行型
    await page.click('#btnMorphToggle');
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.morphM > 0.85, { timeout: 4000 });
    await page.waitForTimeout(400);

    // 驗證本體與比對機體離地懸停
    const hoverState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const argon = p.externalUnits.find(u => u.verKey === 'argon_vfx');
      return {
        holderY: p.holder.position.y,
        argonY: argon?.group?.position?.y,
      };
    });
    console.log('變形者飛行型懸停高度:', hoverState);
    if (hoverState.holderY <= 0.3 || hoverState.argonY <= 0.3) {
      throw new Error(`變形者飛行型未正確離地懸停！holderY: ${hoverState.holderY}, argonY: ${hoverState.argonY}`);
    }

    // 按下 W 前進
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);

    const morphMoveW = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const argon = p.externalUnits.find(u => u.verKey === 'argon_vfx');
      return {
        moving: p.moving,
        speed: p.speed,
        argonClip: argon?.getCurrentClip?.(),
      };
    });
    console.log('變形者 W 飛行移動狀態:', morphMoveW);
    if (!morphMoveW.moving || morphMoveW.speed <= 0) {
      throw new Error('變形者飛行按 W 未進入移動狀態！');
    }
    if (morphMoveW.argonClip !== 'flight_move') {
      throw new Error(`變形者飛行前進動作錯誤！got: ${morphMoveW.argonClip}`);
    }

    await page.keyboard.up('KeyW');
    await page.waitForTimeout(200);

    // 按下 S 後退 (Argon VFX 具備 flight_backward)
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(300);

    const morphMoveS = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const argon = p.externalUnits.find(u => u.verKey === 'argon_vfx');
      return {
        argonClip: argon?.getCurrentClip?.(),
      };
    });
    console.log('變形者 S 飛行後退狀態:', morphMoveS);
    if (morphMoveS.argonClip !== 'flight_backward') {
      throw new Error(`變形者飛行後退動作錯誤！got: ${morphMoveS.argonClip}`);
    }

    await page.keyboard.up('KeyS');
    await page.waitForTimeout(200);

    console.log('✅ 飛行移動與比對動作呈現驗證全部通過！');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
