import { chromiumOrNull, chromePath } from '../tools/pw.mjs';
import { serve } from '../tools/mech_prompt_review.mjs';

async function run() {
  console.log('--- 驗證多版本特效同步播放 ---');
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

    // 勾選三版本
    await page.click('#chkVerSteel');
    await page.click('#chkVerArgon');

    await page.waitForFunction(() => {
      const p = window.__MECH_REVIEW?.preview;
      return p && p.externalUnits && p.externalUnits.length === 2;
    }, { timeout: 8000 });

    console.log('✓ 三版本載入完成, externalUnits.length = 2');

    // 1. 測試輕射擊特效多版本同步
    await page.click('#btnActionLight');
    await page.waitForTimeout(300);
    const lightFxInfo = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const xPositions = p.effects.map(e => e.obj?.position?.x).filter(x => x !== undefined);
      return {
        effectsCount: p.effects.length,
        hasMultipleX: new Set(xPositions.map(x => Math.round(x))).size >= 2
      };
    });
    console.log('輕射擊特效資訊:', lightFxInfo);
    if (lightFxInfo.effectsCount === 0 || !lightFxInfo.hasMultipleX) {
      throw new Error('輕射擊特效未同步於多個版本模型位置產生！');
    }

    // 等待輕射擊結束
    await page.waitForTimeout(1500);

    // 2. 測試重射擊特效多版本同步
    await page.click('#btnActionAttack');
    await page.waitForTimeout(600);
    const heavyFxInfo = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const xPositions = p.effects.map(e => e.obj?.position?.x).filter(x => x !== undefined);
      return {
        effectsCount: p.effects.length,
        hasMultipleX: new Set(xPositions.map(x => Math.round(x))).size >= 2
      };
    });
    console.log('重射擊特效資訊:', heavyFxInfo);
    if (heavyFxInfo.effectsCount === 0 || !heavyFxInfo.hasMultipleX) {
      throw new Error('重射擊特效未同步於多個版本模型位置產生！');
    }

    await page.waitForTimeout(1500);

    // 3. 測試防守招式特效多版本同步
    await page.click('#btnActionSkill');
    await page.waitForTimeout(500);
    const skillFxInfo = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const xPositions = p.effects.map(e => e.obj?.position?.x).filter(x => x !== undefined);
      return {
        effectsCount: p.effects.length,
        hasMultipleX: new Set(xPositions.map(x => Math.round(x))).size >= 2
      };
    });
    console.log('防守招式特效資訊:', skillFxInfo);
    if (skillFxInfo.effectsCount === 0 || !skillFxInfo.hasMultipleX) {
      throw new Error('防守招式特效未同步於多個版本模型位置產生！');
    }

    await page.waitForTimeout(1500);

    // 4. 測試攻擊招式 (大招) 特效多版本同步
    await page.click('#btnActionUlt');
    await page.waitForTimeout(600);
    const ultFxInfo = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const xPositions = p.effects.map(e => e.obj?.position?.x).filter(x => x !== undefined);
      return {
        effectsCount: p.effects.length,
        hasMultipleX: new Set(xPositions.map(x => Math.round(x))).size >= 2
      };
    });
    console.log('攻擊大招特效資訊:', ultFxInfo);
    if (ultFxInfo.effectsCount === 0 || !ultFxInfo.hasMultipleX) {
      throw new Error('大招特效未同步於多個版本模型位置產生！');
    }

    // 5. 驗證取消勾選本專案模型時，僅勾選的外部版本發動特效
    await page.click('#chkVerCurrent'); // 取消本專案
    await page.waitForTimeout(500);

    await page.click('#btnActionAttack');
    await page.waitForTimeout(600);
    const uncheckCurrentInfo = await page.evaluate(() => {
      const p = window.__MECH_REVIEW.preview;
      const currentX = p.holder.position.x;
      const xPositions = p.effects.map(e => e.obj?.position?.x).filter(x => x !== undefined);
      // 確認沒有特效是從隱藏的 currentX 產生的
      const hasCurrentX = xPositions.some(x => Math.abs(x - currentX) < 0.1);
      return {
        effectsCount: p.effects.length,
        hasCurrentX,
        visibleActors: p._getActiveActors().length
      };
    });
    console.log('取消本專案後重擊特效資訊:', uncheckCurrentInfo);
    if (uncheckCurrentInfo.effectsCount === 0) {
      throw new Error('取消本專案後外部版本未產生特效！');
    }
    if (uncheckCurrentInfo.visibleActors !== 2) {
      throw new Error(`取消本專案後活躍 actor 數應為 2，實為: ${uncheckCurrentInfo.visibleActors}`);
    }

    if (pageErrors.length > 0) {
      throw new Error(`測試期間出現頁面錯誤:\n${pageErrors.join('\n')}`);
    }

    console.log('✅ 多版本特效同步測試全部通過！');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
