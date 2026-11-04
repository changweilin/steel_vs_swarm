import { chromiumOrNull, chromePath } from '../tools/pw.mjs';
import { serve } from '../tools/mech_prompt_review.mjs';

async function run() {
  console.log('--- 驗證機體審查台：按鈕不遮擋、WSAD真實轉向、機體專屬彈藥直射 ---');
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
    await page.goto(`http://127.0.0.1:${port}/?mech=s01`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit);

    // ==========================================
    // 項目 1: 虛擬操作按鍵不可擋住其他按鍵
    // ==========================================
    console.log('1. 驗證按鍵無重疊遮擋...');
    const layoutCheck = await page.evaluate(() => {
      const hud = document.getElementById('virtualActionHud');
      const resetBtn = document.getElementById('btn3dReset');
      const spinBtn = document.getElementById('btn3dSpin');
      const gridBtn = document.getElementById('btn3dGrid');

      const hudBox = hud.getBoundingClientRect();
      const resetBox = resetBtn.getBoundingClientRect();
      const spinBox = spinBtn.getBoundingClientRect();
      const gridBox = gridBtn.getBoundingClientRect();

      // 檢查 hudBox 與下方按鍵在 Y 軸上是否完全分離 (HUD 在上方，控制鈕在下方)
      const clearReset = hudBox.bottom <= resetBox.top;
      const clearSpin = hudBox.bottom <= spinBox.top;
      const clearGrid = hudBox.bottom <= gridBox.top;

      return {
        hudBox: { top: hudBox.top, bottom: hudBox.bottom, height: hudBox.height },
        resetBox: { top: resetBox.top, bottom: resetBox.bottom },
        clearReset, clearSpin, clearGrid
      };
    });
    console.log('佈局間距資訊:', layoutCheck);
    if (!layoutCheck.clearReset || !layoutCheck.clearSpin || !layoutCheck.clearGrid) {
      throw new Error(`虛擬按鍵 HUD 仍遮擋底欄控制按鈕！${JSON.stringify(layoutCheck)}`);
    }

    // 驗證底欄按鈕可正常點擊並生效
    const spinInitial = await page.evaluate(() => window.__MECH_REVIEW.preview.spinScale ?? 1);
    await page.click('#btn3dSpin');
    const spinAfter = await page.evaluate(() => window.__MECH_REVIEW.preview.spinScale);
    console.log('自轉狀態切換驗證:', { spinInitial, spinAfter });
    if (spinAfter !== 0) {
      throw new Error('底欄暫停自轉按鈕點擊無效！');
    }

    // ==========================================
    // 項目 2: WSAD 方向鍵的方向要與實際遊戲相同
    // ==========================================
    console.log('2. 驗證 WSAD 方向與機體轉向...');
    // 切換至機甲 s06
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s06'));
    await page.waitForTimeout(400);

    // 2.1 測試 D 鍵 (右移)
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);
    const dMoveState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      return {
        moveRight: p.moveRight,
        moveFwd: p.moveFwd,
        bodyYaw: p.bodyYaw,
        holderRotY: p.holder.rotation.y,
        travelX: p.travelX,
        groundPosX: p.ground.position.x
      };
    });
    console.log('按住 D (右移) 狀態:', dMoveState);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(200);

    // D 鍵：moveRight=1, bodyYaw 應為負值 (約 -Math.PI / 2 ≈ -1.57rad), 地網位移應往左滾動讓機體向右跑
    if (dMoveState.bodyYaw >= -0.5 || dMoveState.holderRotY >= -0.5) {
      throw new Error(`D 鍵右移時機體未轉向右方！bodyYaw: ${dMoveState.bodyYaw}`);
    }

    // 2.2 測試 A 鍵 (左移)
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(300);
    const aMoveState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      return {
        moveRight: p.moveRight,
        moveFwd: p.moveFwd,
        bodyYaw: p.bodyYaw,
        holderRotY: p.holder.rotation.y
      };
    });
    console.log('按住 A (左移) 狀態:', aMoveState);
    await page.keyboard.up('KeyA');
    await page.waitForTimeout(200);

    // A 鍵：moveRight=-1, bodyYaw 應為正值 (約 Math.PI / 2 ≈ +1.57rad)
    if (aMoveState.bodyYaw <= 0.5 || aMoveState.holderRotY <= 0.5) {
      throw new Error(`A 鍵左移時機體未轉向左方！bodyYaw: ${aMoveState.bodyYaw}`);
    }

    // 2.3 測試 S 鍵 (後退)
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(300);
    const sMoveState = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      return {
        moveRight: p.moveRight,
        moveFwd: p.moveFwd,
        bodyYaw: p.bodyYaw,
        holderRotY: p.holder.rotation.y
      };
    });
    console.log('按住 S (後退) 狀態:', sMoveState);
    await page.keyboard.up('KeyS');
    await page.waitForTimeout(200);

    // S 鍵：moveFwd=-1, bodyYaw 應接近 Math.PI (約 ±3.14rad)
    if (Math.abs(sMoveState.bodyYaw) < 2.5) {
      throw new Error(`S 鍵後退時機體未調轉面向後退方向！bodyYaw: ${sMoveState.bodyYaw}`);
    }

    // 2.4 放開鍵盤靜止後應平滑回正 (bodyYaw 回到 0)
    await page.waitForTimeout(400);
    const idleYaw = await page.evaluate(() => window.__MECH_REVIEW.preview.holder.rotation.y);
    console.log('靜止後機體回正朝向:', idleYaw);
    if (Math.abs(idleYaw) > 0.15) {
      throw new Error(`靜止後機體未平滑回正朝向！got: ${idleYaw}`);
    }

    // ==========================================
    // 項目 3: 飛出的砲彈要使用機體自身設計的砲彈，不用另外丟出砲彈
    // ==========================================
    console.log('3. 驗證專屬設計砲彈直射飛出...');
    // 3.1 測試 s01 重型飛彈直射與專屬幾何
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s01'));
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.charId === 's01' && window.__MECH_REVIEW?.preview?.unit);
    await page.waitForTimeout(300);

    // 點擊重射擊
    await page.click('#btnActionAttack');
    await page.waitForFunction(() => window.__MECH_REVIEW.preview.effects.some(e => e.obj?.userData?.authoredProjectile), { timeout: 4000 });

    const s01HeavyProj = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const projEffect = p.effects.find(e => e.obj?.userData?.authoredProjectile);
      if (!projEffect) return { found: false };
      const obj = projEffect.obj;
      return {
        found: true,
        authored: obj.userData.authoredProjectile,
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
        posY: obj.position.y
      };
    });
    console.log('s01 重射擊專屬砲彈:', s01HeavyProj);
    if (!s01HeavyProj.found || s01HeavyProj.authored?.ch !== 's01') {
      throw new Error(`s01 重射擊未發射自身設計砲彈！got: ${JSON.stringify(s01HeavyProj)}`);
    }
    // 驗證 scale 未被惡意縮小成 0.09
    if (s01HeavyProj.scale.x < 0.5) {
      throw new Error(`s01 砲彈幾何 scale 異常被壓縮過小！scale: ${s01HeavyProj.scale.x}`);
    }

    // 3.2 測試 s10 重砲 (gun) 發射自身設計的砲彈 (fx_heavy_bullet)
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s10'));
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.charId === 's10' && window.__MECH_REVIEW?.preview?.unit);
    await page.waitForTimeout(300);

    await page.click('#btnActionAttack');
    await page.waitForFunction(() => window.__MECH_REVIEW.preview.effects.some(e => e.obj?.userData?.authoredProjectile), { timeout: 4000 });

    const s10HeavyProj = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const projEffect = p.effects.find(e => e.obj?.userData?.authoredProjectile);
      if (!projEffect) return { found: false, anim: p.anim ? { slot: p.anim.slot, t: p.anim.t, fired: p.anim.fired } : null };
      const obj = projEffect.obj;
      return {
        found: true,
        authored: obj.userData.authoredProjectile,
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
      };
    });
    console.log('s10 重砲專屬穿刺砲彈:', s10HeavyProj);
    if (!s10HeavyProj.found || s10HeavyProj.authored?.ch !== 's10') {
      throw new Error(`s10 重砲未發射自身設計的穿甲彈！got: ${JSON.stringify(s10HeavyProj)}`);
    }

    // 3.3 測試 s08 輕武器機槍 (fx_light_bullet) 正確發射專屬砲彈
    await page.evaluate(() => window.__MECH_REVIEW.selectMech('s08'));
    await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.charId === 's08' && window.__MECH_REVIEW?.preview?.unit);
    await page.waitForTimeout(300);

    await page.click('#btnActionLight');
    await page.waitForTimeout(150);

    const s08LightProj = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const projEffect = p.effects.find(e => e.obj?.userData?.authoredProjectile);
      if (!projEffect) return { found: false, anim: p.anim ? { slot: p.anim.slot, t: p.anim.t, fired: p.anim.fired } : null };
      const obj = projEffect.obj;
      return {
        found: true,
        authored: obj.userData.authoredProjectile
      };
    });
    console.log('s08 輕機槍專屬子彈:', s08LightProj);
    if (!s08LightProj.found || s08LightProj.authored?.ch !== 's08') {
      throw new Error(`s08 輕機槍未正確發射自身設計的 fx_light_bullet 砲彈！got: ${JSON.stringify(s08LightProj)}`);
    }

    console.log('✅ 全部三項審查台需求 (無遮擋、WSAD方向、專屬砲彈直射) 驗證通過！');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
