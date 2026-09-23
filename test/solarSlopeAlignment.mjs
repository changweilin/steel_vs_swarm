import assert from 'node:assert/strict';
import { register } from 'node:module';

const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s, c, next) { return modules[s] ? { url: modules[s], shortCircuit: true } : next(s, c); }`), import.meta.url);

const THREE = await import('three');
const { generateBuildingAppurtenances, calculateRoofMetrics } = await import('../public/js/buildingAppurtenances.js');
const { optimalSolarTiltRad } = await import('../public/js/data.js');

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          width: 256, height: 256,
          getContext: () => new Proxy({
            fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
            font: '', textAlign: '',
            getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            createLinearGradient: () => ({ addColorStop() {} }),
          }, {
            get: (target, prop) => (prop in target ? target[prop] : () => {}),
          }),
        };
      }
      return {};
    },
  };
}

const { buildGroundCover } = await import('../public/js/ground.js');

console.log('=== 1. 斜屋頂太陽能板順坡佈署且面向傾角恆定測試 ===');
{
  const poly = { outer: [[-10, -10], [10, -10], [10, 10], [-10, 10]], holes: [] };
  const metrics = calculateRoofMetrics(poly);
  const edges = [
    { hw2: 10, len: 20, nx: 0, nz: -1, x: 0, z: -10, sourceId: 888 },
  ];
  const arch = {
    id: 'sloped_solar_bld',
    category: 'industrial',
    style: 'modern',
    roofForm: 'gabled',
    actualRoofForm: 'gabled',
  };
  const latDeg = 25.0;
  const terrain = { center: { lat: latDeg, lng: 121.5 }, worldW: 1000, worldH: 1000 };

  let foundSolar = false;
  for (let seed = 0; seed < 30; seed++) {
    arch.id = `sloped_solar_${seed}`;
    const geos = generateBuildingAppurtenances(poly, edges, 0, 15, arch, 0.28, 'gabled', metrics, terrain);
    const panels = geos.filter(g => g.userData?.partType === 'solar_panel');
    if (panels.length >= 2) {
      foundSolar = true;
      const yCoords = panels.map(p => {
        p.computeBoundingBox();
        return (p.boundingBox.min.y + p.boundingBox.max.y) / 2;
      });
      const minY = Math.min(...yCoords), maxY = Math.max(...yCoords);
      assert.ok(maxY - minY > 0.3, `斜屋頂上的太陽能板必須順著屋頂傾斜高低佈署 (最大高差 ${(maxY - minY).toFixed(2)}m)`);

      // 驗證每一片太陽能板的朝向與傾角：取頂面法向量
      const expTilt = optimalSolarTiltRad(latDeg);
      for (const p of panels) {
        const norm = p.getAttribute('normal');
        // 檢查法向量中是否存在指向日照方向的天頂傾斜（Y > 0, Z > 0 偏南）
        let maxDotZ = -1, maxDotY = -1;
        for (let i = 0; i < norm.count; i++) {
          const ny = norm.getY(i), nz = norm.getZ(i);
          if (ny > maxDotY) { maxDotY = ny; maxDotZ = nz; }
        }
        // 頂面法線在 YZ 平面的傾角應為 expTilt (法向量 ny = cos(expTilt), nz = sin(expTilt))
        const angle = Math.atan2(maxDotZ, maxDotY);
        assert.ok(Math.abs(angle - expTilt) < 0.05, `太陽能板頂面傾角 (${(angle * 180 / Math.PI).toFixed(1)}°) 必須符合日照傾角 (${(expTilt * 180 / Math.PI).toFixed(1)}°)，不隨屋面坡度改變`);
      }
      break;
    }
  }
  assert.ok(foundSolar, '斜屋頂應能成功生成太陽能板');
  console.log('✅ 斜屋頂太陽能板成功順著傾斜佈署，且太陽能板面向與傾角保持不變！');
}

console.log('\n=== 2. 斜棚架太陽能板順坡佈署且面向傾角恆定測試 ===');
{
  const poly = { outer: [[-12, -12], [12, -12], [12, 12], [-12, 12]], holes: [] };
  const metrics = calculateRoofMetrics(poly);
  const edges = [
    { hw2: 12, len: 24, nx: 0, nz: -1, x: 0, z: -12, sourceId: 999 },
  ];
  const latDeg = 35.0; // 東京
  const terrain = { center: { lat: latDeg, lng: 139.7 }, worldW: 1000, worldH: 1000 };

  let foundCanopySolar = false;
  for (let seed = 0; seed < 40; seed++) {
    const arch = {
      id: `canopy_solar_${seed}`,
      category: 'commercial',
      style: 'modern',
      roofForm: 'flat',
      actualRoofForm: 'flat',
    };
    const geos = generateBuildingAppurtenances(poly, edges, 0, 20, arch, 0.28, 'flat', metrics, terrain);
    const panels = geos.filter(g => g.userData?.partType === 'solar_panel');
    // 當有棚架時，面板會佈署在棚架頂部 (panelY > 20 + 2.4 = 22.4)
    if (panels.length >= 4) {
      const topPanels = panels.filter(p => {
        p.computeBoundingBox();
        return p.boundingBox.min.y >= 22.2;
      });
      if (topPanels.length >= 2) {
        foundCanopySolar = true;
        const yCoords = topPanels.map(p => (p.boundingBox.min.y + p.boundingBox.max.y) / 2);
        const diffY = Math.max(...yCoords) - Math.min(...yCoords);
        assert.ok(diffY > 0.05, `斜棚架上的太陽能板必須順著棚架傾斜佈署 (高差 ${(diffY * 100).toFixed(1)}cm)`);

        const expTilt = optimalSolarTiltRad(latDeg);
        for (const p of topPanels) {
          const norm = p.getAttribute('normal');
          let maxDotZ = -1, maxDotY = -1;
          for (let i = 0; i < norm.count; i++) {
            const ny = norm.getY(i), nz = norm.getZ(i);
            if (ny > maxDotY) { maxDotY = ny; maxDotZ = nz; }
          }
          const angle = Math.atan2(maxDotZ, maxDotY);
          assert.ok(Math.abs(angle - expTilt) < 0.05, `棚架太陽能板頂面傾角 (${(angle * 180 / Math.PI).toFixed(1)}°) 必須符合日照傾角 (${(expTilt * 180 / Math.PI).toFixed(1)}°)`);
        }
        break;
      }
    }
  }
  assert.ok(foundCanopySolar, '棚架應能生成順坡太陽能板');
  console.log('✅ 斜棚架太陽能板成功順著傾斜佈署，且太陽能板面向與傾角保持不變！');
}

console.log('\n=== 3. 斜坡/起伏地面太陽能板順坡佈署且面向傾角恆定測試 ===');
{
  // 建立具備 15% 坡度的地形
  const slopeTerrain = {
    worldW: 500, worldH: 500,
    minX: -250, maxX: 250, minZ: -250, maxZ: 250,
    center: { lat: 25.0, lng: 121.5 },
    heightAt: (x, z) => 10 + 0.08 * z, // 沿 z 軸傾斜 (坡度 0.08，大於平地 0.03 門檻且在光電場上限 0.12 內)
  };

  const group = new THREE.Group();
const { mulberry32 } = await import('../public/js/rng.js');

  const mockOptions = {
    isBlocked: () => false,
    classifyAt: () => 'bare',
    classifyPureAt: () => 'bare',
    zoneAt: () => 'bare',
    encAt: () => ({ style: { feats: ['solarfarm'] } }),
    blockers: [],
    reservedFootprints: [],
    patchPolys: [],
    roadPolys: [
      [[[-200, 0], [200, 0]], 4],
    ],
    roadDirAt: () => 0,
    roadClear: () => false,
    seed: 12345,
    rnd: mulberry32(12345),
  };

  buildGroundCover(group, slopeTerrain, mockOptions);

  const solarMeshes = group.children.filter(c => c.userData?.proceduralGroundPart?.type === 'solarpanel');
  assert.ok(solarMeshes.length > 0, '地面應鋪設太陽能板 InstancedMesh');

  const expTilt = optimalSolarTiltRad(25.0);
  const targetWorldAz = 0; // 北半球南向

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();

  let totalInstances = 0;
  const yVals = [];
  for (const m of solarMeshes) {
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, m4);
      m4.decompose(pos, rot, scl);
      yVals.push(pos.y);
      totalInstances++;

      // 取得 Euler 角
      euler.setFromQuaternion(rot);
      // 驗證面向傾角：tx 應與 targetWorldAz 結合之 sciTilt 一致，絕不吃 -Math.atan(glz)
      const relAz = targetWorldAz - euler.y;
      const expTx = expTilt * Math.cos(relAz);
      const expTz = expTilt * Math.sin(relAz);
      assert.ok(Math.abs(euler.x - expTx) < 1e-3, `太陽能板 x 傾角 (${euler.x.toFixed(4)}) 必須精確維持日照傾角 (${expTx.toFixed(4)})，不隨地形坡度改變`);
      assert.ok(Math.abs(euler.z - expTz) < 1e-3, `太陽能板 z 傾角 (${euler.z.toFixed(4)}) 必須精確維持日照傾角 (${expTz.toFixed(4)})，不隨地形坡度改變`);
    }
  }

  assert.ok(totalInstances > 0, '地面應生成太陽能板實例');
  const zDiff = Math.max(...yVals) - Math.min(...yVals);
  assert.ok(zDiff > 1.0, `起伏地形太陽能板位置應順著地形坡度落高 (高差 ${zDiff.toFixed(2)}m)`);
  console.log(`✅ 地面光電場在 15% 斜坡上成功順坡落高 (高差 ${zDiff.toFixed(2)}m)，${totalInstances} 塊太陽能板角度面向角度完全恆定！`);
}

console.log('\n🎉 斜坡／斜屋頂／斜棚架太陽能板順坡佈署且角度面向不變全數測試通過！');
