import { chromiumOrNull, chromePath } from '../tools/pw.mjs';
import { serve } from '../tools/mech_prompt_review.mjs';

async function run() {
  console.log('--- 驗證機體審查台跳躍長按對應蹲下動作 ---');
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
    // 1. 載入機甲 (s06)
    await page.goto(`http://127.0.0.1:${port}/?mech=s06`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit);

    // 檢查初始狀態無下蹲
    const initCrouch = await page.evaluate(() => window.__MECH_REVIEW.preview.getCrouch());
    console.log('機甲初始下蹲幅度:', initCrouch);
    if (initCrouch !== 0) throw new Error(`初始下蹲應為 0，得到 ${initCrouch}`);

    // 2. 按住 Space 鍵 (長按跳躍)
    console.log('按下 Space 鍵長按...');
    await page.keyboard.down('Space');
    await page.waitForTimeout(150);

    // 驗證按鍵高亮與下蹲幅度 > 0
    const midHold = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const btn = document.getElementById('btnActionJump');
      const rig = p.unit?.userData?.rig;
      return {
        crouch: p.getCrouch(),
        btnActive: btn?.classList.contains('active'),
        entCrouch: p._ent?.crouch,
        hipsY: rig?.hips?.position?.y,
        kneeLX: rig?.legChainL?.[0]?.g?.rotation?.x
      };
    });
    console.log('按住 Space 150ms 狀態:', midHold);
    if (midHold.crouch <= 0 || !midHold.btnActive) {
      throw new Error(`長按 Space 期間下蹲幅度應 > 0 且按鍵需為 active！got: ${JSON.stringify(midHold)}`);
    }

    // 繼續按住達 300ms (超過 0.25s 滿蓄)
    await page.waitForTimeout(200);
    const fullHold = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      return {
        crouch: p.getCrouch(),
        entCrouch: p._ent?.crouch,
      };
    });
    console.log('按住 Space 350ms 滿蓄下蹲狀態:', fullHold);
    if (fullHold.crouch < 0.99) {
      throw new Error(`滿蓄時下蹲幅度應接近 1.0！got: ${fullHold.crouch}`);
    }

    // 放開 Space 鍵 -> 應觸發大跳躍，下蹲幅度立即歸 0，機體離地彈升
    console.log('放開 Space 鍵...');
    await page.keyboard.up('Space');
    await page.waitForTimeout(100);

    const jumpState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const btn = document.getElementById('btnActionJump');
      return {
        crouch: p.getCrouch(),
        hasJump: !!p._jump,
        isHigh: !!p._jump?.high,
        holderY: p.holder?.position?.y,
        btnActive: btn?.classList.contains('active')
      };
    });
    console.log('放開 Space 彈射跳躍狀態:', jumpState);
    if (jumpState.crouch !== 0) {
      throw new Error(`跳躍起跳後下蹲幅度應重置為 0！got: ${jumpState.crouch}`);
    }
    if (!jumpState.hasJump || !jumpState.isHigh) {
      throw new Error('長按放開後應觸發大跳躍 (highJump)！');
    }
    if (jumpState.btnActive) {
      throw new Error('放開後跳躍按鈕 active 樣式應移除！');
    }

    // 等待跳躍落地
    await page.waitForFunction(() => !window.__MECH_REVIEW.preview._jump, { timeout: 3000 });

    // 3. 測試短按 Space 鍵 (< 0.25s) -> 觸發普通小跳 (high=false)
    console.log('短按 Space 鍵...');
    await page.keyboard.down('Space');
    await page.waitForTimeout(60);
    await page.keyboard.up('Space');
    await page.waitForTimeout(60);

    const tapState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      return {
        hasJump: !!p._jump,
        isHigh: !!p._jump?.high,
        crouch: p.getCrouch()
      };
    });
    console.log('短按 Space 跳躍狀態:', tapState);
    if (!tapState.hasJump || tapState.isHigh) {
      throw new Error('短按 Space 應觸發普通跳躍 (非大跳躍)！');
    }

    // 等待落地
    await page.waitForFunction(() => !window.__MECH_REVIEW.preview._jump, { timeout: 2000 });

    // 4. 測試虛擬按鈕 pointerdown 長按下蹲
    console.log('測試虛擬跳躍按鈕 pointerdown 長按...');
    const btnRect = await page.evaluate(() => {
      const b = document.getElementById('btnActionJump');
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    await page.mouse.move(btnRect.x, btnRect.y);
    await page.mouse.down();
    await page.waitForTimeout(200);

    const btnHoldState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      return {
        crouch: p.getCrouch(),
        btnActive: document.getElementById('btnActionJump')?.classList.contains('active')
      };
    });
    console.log('滑鼠按住跳躍按鈕狀態:', btnHoldState);
    if (btnHoldState.crouch <= 0 || !btnHoldState.btnActive) {
      throw new Error(`滑鼠按住虛擬跳躍按鈕時下蹲幅度應 > 0！got: ${JSON.stringify(btnHoldState)}`);
    }

    await page.mouse.up();
    await page.waitForTimeout(100);

    const btnReleaseState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      return {
        crouch: p.getCrouch(),
        hasJump: !!p._jump
      };
    });
    console.log('放開滑鼠按鈕狀態:', btnReleaseState);
    if (btnReleaseState.crouch !== 0 || !btnReleaseState.hasJump) {
      throw new Error('放開滑鼠應重置下蹲並起跳！');
    }

    // 等待落地
    await page.waitForFunction(() => !window.__MECH_REVIEW.preview._jump, { timeout: 3000 });

    // 5. 測試變形者 (s03 地面型) 長按下蹲與彈射變形
    console.log('切換至變形者 s03...');
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s03'));
    await page.waitForTimeout(300);

    console.log('變形者地面型按住 Space 長按...');
    await page.keyboard.down('Space');
    await page.waitForTimeout(300);

    const morphCrouch = await page.evaluate(() => window.__MECH_REVIEW.preview.getCrouch());
    console.log('變形者長按中下蹲幅度:', morphCrouch);
    if (morphCrouch <= 0) {
      throw new Error(`變形者地面型長按時下蹲幅度應 > 0！got: ${morphCrouch}`);
    }

    await page.keyboard.up('Space');
    await page.waitForTimeout(400);

    const morphFlightState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      return {
        crouch: p.getCrouch(),
        isFlight: p.morphTarget > 0.5
      };
    });
    console.log('變形者放開後切換飛行型狀態:', morphFlightState);
    if (morphFlightState.crouch !== 0 || !morphFlightState.isFlight) {
      throw new Error('變形者地面型長按放開應重置下蹲並切換為飛行型！');
    }

    if (pageErrors.length > 0) {
      throw new Error(`頁面發生未預期錯誤: ${pageErrors.join('; ')}`);
    }

    console.log('✅ 機體審查台跳躍長按對應蹲下動作驗證全部通過！');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
