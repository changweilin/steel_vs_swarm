// ============ 海灘/沼澤與水中遺跡專屬預覽截圖 (無雜物純淨空間) ============
// 用法: node tools/shot_water_relics.mjs [--out DIR]
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, serve, skipNoPlaywright } from './pw.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', join(ROOT, 'tools', '.shots_water_relics')));
const PORT = +arg('--port', 8645);
fs.mkdirSync(OUT, { recursive: true });

const pw = await chromiumOrNull();
if (!pw) { skipNoPlaywright('shot_water_relics.mjs'); process.exit(0); }

const srv = await serve(PORT);
const browser = await pw.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const PROBE_URL = `${srv.url}public/__scene_probe_water.html`;
await page.route(`${PROBE_URL}**`, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="1280" height="720"></canvas></body></html>`,
}));
await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' });

const shots = await page.evaluate(async () => {
  const THREE = await import('three');
  const { toonMat, envMat, setSeaDepthField, updateCelLight, FOAM, stepCelWind, seaSoft, swampSoft } = await import('/public/js/toon.js');
  const { Pipeline } = await import('/public/js/postfx.js');

  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);

  const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.5, 300);
  const sunDir = new THREE.Vector3(0.65, 0.62, 0.44).normalize();
  stepCelWind(4.2);

  const results = {};

  // 2D SDF 計算距離函數
  function distToObstacle(px, pz, r) {
    const ox = px - r.x, oz = pz - r.z;
    const cs = r.ry ? Math.cos(r.ry) : 1, sn = r.ry ? -Math.sin(r.ry) : 0;
    const lx = ox * cs + oz * sn, lz = -ox * sn + oz * cs;

    if (r.type === 'cylinder') {
      return Math.max(0, Math.hypot(ox, oz) - r.r);
    } else if (r.type === 'box') {
      const dx = Math.max(0, Math.abs(lx) - r.w / 2);
      const dz = Math.max(0, Math.abs(lz) - r.d / 2);
      return Math.hypot(dx, dz);
    } else if (r.type === 'shipwreck') {
      // 沉船水平剖面 (膠囊形/流線型船身)
      const halfL = (r.d - r.w) / 2;
      const clz = Math.max(-halfL, Math.min(halfL, lz));
      return Math.max(0, Math.hypot(lx, lz - clz) - r.w / 2);
    }
    return Math.hypot(ox, oz);
  }

  // ==========================================
  // 場景 1: 純淨海灘 + 遠離海岸的水中遺跡 (距離分開、同心浪花完整)
  // ==========================================
  {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7ea8c8);
    scene.add(camera);

    const sun = new THREE.DirectionalLight(0xfffaed, 2.2);
    sun.position.copy(sunDir).multiplyScalar(100);
    scene.add(sun, new THREE.AmbientLight(0x7590a8, 0.7));

    const W = 140, H = 140, N = 80;
    const beachGeo = new THREE.PlaneGeometry(W, H, N - 1, N - 1);
    beachGeo.rotateX(-Math.PI / 2);
    const pos = beachGeo.attributes.position;

    // x < 0: 海灘沙坡 (y = 0 ~ +4m); x in [0, 8]: 入水斜坡; x > 8: 深海平台 (y = -3m)
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), pz = pos.getZ(i);
      const shoreCurve = Math.sin(pz * 0.07) * 2.5 + Math.cos(pz * 0.03) * 1.2;
      const distToShore = px - shoreCurve;
      let py = 0;
      if (distToShore < 0) {
        py = Math.min(4.5, -distToShore * 0.15 + Math.sin(pz * 0.1) * 0.15);
      } else {
        py = -Math.min(3.5, distToShore * 0.28);
      }
      pos.setY(i, py);
    }
    beachGeo.computeVertexNormals();
    const sandMat = envMat(0xdec89e, { wash: 0.45, cool: 0.35 });
    scene.add(new THREE.Mesh(beachGeo, sandMat));

    // 遺跡放置於遠端外海 (x = 32 ~ 46m，與海岸 x=0 完全分開，中間有深水無浪通道)
    const relics = [
      // ① 神廟石柱 1 (圓柱立體) @ (32, -10)
      { type: 'cylinder', x: 32, z: -10, r: 1.5, h: 6.0, extent: 5.5, kind: 'relic_pillar' },
      // ② 神廟石柱 2 (傾斜斷柱) @ (36, -4)
      { type: 'cylinder', x: 36, z: -4, r: 1.3, h: 5.0, extent: 5.5, tilt: 0.28, kind: 'relic_broken' },
      // ③ 神廟基座殘垣 (長方盒體) @ (34, -18)
      { type: 'box', x: 34, z: -18, w: 4.5, d: 7.0, h: 4.0, extent: 5.5, ry: 0.35, kind: 'relic_altar' },
      // ④ 水下沉船艙體 (水平面流線膠囊形剖面) @ (38, 10)
      { type: 'shipwreck', x: 38, z: 10, w: 4.5, d: 15.0, h: 4.5, extent: 6.0, ry: -0.4, kind: 'shipwreck' },
      // ⑤ 石砌橋墩 1 (外海深處，浪花範圍為遺跡一半) @ (32, 28)
      { type: 'cylinder', x: 32, z: 28, r: 1.5, h: 8.0, extent: 2.8, kind: 'pier' },
      // ⑥ 石砌橋墩 2 @ (44, 32)
      { type: 'cylinder', x: 44, z: 32, r: 1.5, h: 8.0, extent: 2.8, kind: 'pier' },
    ];

    const seaN = 256;
    const seaData = new Uint8Array(seaN * seaN);
    const tx = W / seaN, tz = H / seaN;

    for (let i = 0; i < seaN; i++) {
      const z = -H / 2 + tz * (i + 0.5);
      for (let j = 0; j < seaN; j++) {
        const x = -W / 2 + tx * (j + 0.5);
        const shoreCurve = Math.sin(z * 0.07) * 2.5 + Math.cos(z * 0.03) * 1.2;
        const distToShore = x - shoreCurve;

        // 海岸距離場 (x in [0, 8m] 為岸邊浪花帶，超過 8m 深度恆 2.4m = 無浪花通道)
        let dShore = FOAM.RANGE_M;
        if (distToShore <= 0) {
          dShore = 0;
        } else if (distToShore < 8.0) {
          dShore = (distToShore / 8.0) * FOAM.RANGE_M;
        }

        // 物件同心距離場 (依照各物件水平切面精準向外漸增至 RANGE_M)
        let dMinObstacle = FOAM.RANGE_M;
        for (const r of relics) {
          const dDist = distToObstacle(x, z, r);
          if (dDist < r.extent) {
            const dVal = (dDist / r.extent) * FOAM.RANGE_M;
            if (dVal < dMinObstacle) dMinObstacle = dVal;
          }
        }

        const dFinal = Math.min(dShore, dMinObstacle);
        seaData[i * seaN + j] = Math.min(255, Math.floor((dFinal / FOAM.RANGE_M) * 255));
      }
    }
    setSeaDepthField(seaData, seaN, { minX: -W / 2, minZ: -H / 2, w: W, h: H });

    const relicMat = toonMat(0x6e7874, { bands: 'soft' });
    const pierMat = envMat(0x5a6268, { wash: 0.4 });
    const wreckMat = toonMat(0x384a58, { celMetal: true });

    for (const r of relics) {
      let mesh = null;
      if (r.kind === 'relic_pillar') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r.r * 0.9, r.r, r.h, 20), relicMat);
        mesh.position.set(r.x, r.h / 2 - 2.5, r.z);
      } else if (r.kind === 'relic_broken') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r.r * 0.9, r.r, r.h, 20), relicMat);
        mesh.position.set(r.x, r.h / 2 - 2.8, r.z);
        mesh.rotation.z = r.tilt || 0.2;
      } else if (r.kind === 'relic_altar') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), relicMat);
        mesh.position.set(r.x, r.h / 2 - 2.2, r.z);
        mesh.rotation.y = r.ry || 0;
      } else if (r.kind === 'shipwreck') {
        const shipGeo = new THREE.CapsuleGeometry(r.w / 2, r.d - r.w, 8, 16);
        shipGeo.rotateX(Math.PI / 2);
        mesh = new THREE.Mesh(shipGeo, wreckMat);
        mesh.position.set(r.x, 0.6, r.z);
        mesh.rotation.set(0.08, r.ry || 0, 0.15, 'YXZ');
      } else if (r.kind === 'pier') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r.r * 0.9, r.r, r.h, 20), pierMat);
        mesh.position.set(r.x, r.h / 2 - 2.0, r.z);
      }
      if (mesh) scene.add(mesh);
    }

    const seaGeo = new THREE.PlaneGeometry(W, H, 160, 160);
    seaGeo.rotateX(-Math.PI / 2);
    const fadeArray = new Float32Array(seaGeo.attributes.position.count).fill(1.0);
    seaGeo.setAttribute('seaFade', new THREE.BufferAttribute(fadeArray, 1));
    const seaMat = toonMat(0x18465e, {
      transparent: true, opacity: 0.85, wash: 0.85, cool: 0.65, soft: seaSoft(),
    });
    scene.add(new THREE.Mesh(seaGeo, seaMat));

    const pipe = new Pipeline(renderer, scene, camera, { ink: true, fxaa: true });

    const beachStations = [
      {
        name: '01_beach_relics_far_aerial',
        p: [10, 42, 18],
        look: [34, 0, 0],
      },
      {
        name: '02_relic_temple_concentric_top',
        // 正上方俯瞰遠端神廟石柱與基座同心浪花
        p: [28, 26, -18],
        look: [34, 0, -10],
      },
      {
        name: '03_shipwreck_concentric_top',
        // 正上方俯瞰沉船流線切面同心浪花
        p: [32, 26, 10],
        look: [38, 0, 10],
      },
      {
        name: '04_pier_concentric_aerial',
        p: [26, 24, 26],
        look: [36, 0, 30],
      },
      {
        name: '05_beach_waterline_view',
        p: [-8, 3.5, -4],
        look: [34, 0, 0],
      }
    ];

    for (const st of beachStations) {
      camera.position.set(st.p[0], st.p[1], st.p[2]);
      camera.lookAt(st.look[0], st.look[1], st.look[2]);
      camera.updateMatrixWorld(true);
      updateCelLight(camera, sunDir);
      pipe.render();
      results[st.name] = canvas.toDataURL('image/png');
    }
  }

  // ==========================================
  // 場景 2: 泥濘沼澤 + 水中遺跡 (墨綠死水、青苔古柱、呼吸隱現微浪)
  // ==========================================
  {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x4a5a48);
    scene.add(camera);

    const sun = new THREE.DirectionalLight(0xe8f0d8, 1.8);
    sun.position.copy(sunDir).multiplyScalar(100);
    scene.add(sun, new THREE.AmbientLight(0x485844, 0.8));

    const W = 140, H = 140, N = 80;
    const swampGroundGeo = new THREE.PlaneGeometry(W, H, N - 1, N - 1);
    swampGroundGeo.rotateX(-Math.PI / 2);
    const pos = swampGroundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), pz = pos.getZ(i);
      const shoreCurve = Math.sin(pz * 0.08) * 3.0 + Math.cos(pz * 0.04) * 1.5;
      const distToShore = px - shoreCurve;
      let py = 0;
      if (distToShore < 0) {
        py = Math.min(3.5, -distToShore * 0.12 + Math.sin(pz * 0.12) * 0.2);
      } else {
        py = -Math.min(2.5, distToShore * 0.22);
      }
      pos.setY(i, py);
    }
    swampGroundGeo.computeVertexNormals();
    const mudMat = envMat(0x383e2e, { wash: 0.65, cool: 0.45, moss: { amount: 0.9 } });
    scene.add(new THREE.Mesh(swampGroundGeo, mudMat));

    // 沼澤遠端水中物件
    const swampRelics = [
      { type: 'cylinder', x: 30, z: -10, r: 1.5, h: 5.5, extent: 5.5, kind: 'relic_pillar' },
      { type: 'cylinder', x: 34, z: -4, r: 1.3, h: 4.8, extent: 5.5, tilt: 0.25, kind: 'relic_broken' },
      { type: 'box', x: 32, z: -16, w: 4.5, d: 6.5, h: 3.5, extent: 5.5, ry: 0.3, kind: 'relic_altar' },
      { type: 'shipwreck', x: 36, z: 10, w: 4.5, d: 14.5, h: 4.0, extent: 6.0, ry: -0.38, kind: 'shipwreck' },
      { type: 'cylinder', x: 30, z: 26, r: 1.5, h: 7.0, extent: 2.8, kind: 'pier' },
    ];

    const seaN = 256;
    const seaData = new Uint8Array(seaN * seaN);
    const tx = W / seaN, tz = H / seaN;

    for (let i = 0; i < seaN; i++) {
      const z = -H / 2 + tz * (i + 0.5);
      for (let j = 0; j < seaN; j++) {
        const x = -W / 2 + tx * (j + 0.5);
        const shoreCurve = Math.sin(z * 0.08) * 3.0 + Math.cos(z * 0.04) * 1.5;
        const distToShore = x - shoreCurve;

        let dShore = FOAM.RANGE_M;
        if (distToShore <= 0) {
          dShore = 0;
        } else if (distToShore < 7.0) {
          dShore = (distToShore / 7.0) * FOAM.RANGE_M;
        }

        let dMinObstacle = FOAM.RANGE_M;
        for (const r of swampRelics) {
          const dDist = distToObstacle(x, z, r);
          if (dDist < r.extent) {
            const dVal = (dDist / r.extent) * FOAM.RANGE_M;
            if (dVal < dMinObstacle) dMinObstacle = dVal;
          }
        }

        const dFinal = Math.min(dShore, dMinObstacle);
        seaData[i * seaN + j] = Math.min(255, Math.floor((dFinal / FOAM.RANGE_M) * 255));
      }
    }
    setSeaDepthField(seaData, seaN, { minX: -W / 2, minZ: -H / 2, w: W, h: H });

    const swampRelicMat = toonMat(0x485448, { bands: 'soft' });
    const swampPierMat = envMat(0x3e4840, { wash: 0.5 });
    const swampWreckMat = toonMat(0x283830, { celMetal: true });
    const reedMat = envMat(0x385226);

    for (const r of swampRelics) {
      let mesh = null;
      if (r.kind === 'relic_pillar') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r.r * 0.9, r.r, r.h, 20), swampRelicMat);
        mesh.position.set(r.x, r.h / 2 - 2.5, r.z);
      } else if (r.kind === 'relic_broken') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r.r * 0.9, r.r, r.h, 20), swampRelicMat);
        mesh.position.set(r.x, r.h / 2 - 2.8, r.z);
        mesh.rotation.z = r.tilt || 0.2;
      } else if (r.kind === 'relic_altar') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), swampRelicMat);
        mesh.position.set(r.x, r.h / 2 - 2.2, r.z);
        mesh.rotation.y = r.ry || 0;
      } else if (r.kind === 'shipwreck') {
        const shipGeo = new THREE.CapsuleGeometry(r.w / 2, r.d - r.w, 8, 16);
        shipGeo.rotateX(Math.PI / 2);
        mesh = new THREE.Mesh(shipGeo, swampWreckMat);
        mesh.position.set(r.x, 0.5, r.z);
        mesh.rotation.set(0.08, r.ry || 0, 0.15, 'YXZ');
      } else if (r.kind === 'pier') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r.r * 0.9, r.r, r.h, 20), swampPierMat);
        mesh.position.set(r.x, r.h / 2 - 2.0, r.z);
      }
      if (mesh) scene.add(mesh);
    }

    // 蘆葦叢
    const reedGeo = new THREE.CylinderGeometry(0.08, 0.12, 2.6, 6);
    const reedPos = [
      [2, 0.8, -8], [4, 0.7, -6], [3, 0.9, 10], [5, 0.8, 14],
      [14, 0.5, -14], [16, 0.4, 2], [18, 0.4, 12],
    ];
    for (const [rx, ry, rz] of reedPos) {
      const rm = new THREE.Mesh(reedGeo, reedMat);
      rm.position.set(rx, ry, rz);
      rm.rotation.set(0.1, Math.random() * 3, 0.1);
      scene.add(rm);
    }

    const swampSeaGeo = new THREE.PlaneGeometry(W, H, 160, 160);
    swampSeaGeo.rotateX(-Math.PI / 2);
    const fadeArray = new Float32Array(swampSeaGeo.attributes.position.count).fill(1.0);
    swampSeaGeo.setAttribute('seaFade', new THREE.BufferAttribute(fadeArray, 1));
    const swampWaterMat = toonMat(0x1a3824, {
      transparent: true, opacity: 0.88, wash: 0.85, cool: 0.65, soft: swampSoft(),
    });
    scene.add(new THREE.Mesh(swampSeaGeo, swampWaterMat));

    const pipe = new Pipeline(renderer, scene, camera, { ink: true, fxaa: true });

    const swampStations = [
      {
        name: '06_swamp_relics_aerial',
        p: [10, 40, 18],
        look: [32, 0, 0],
      },
      {
        name: '07_swamp_relics_top',
        p: [26, 24, -16],
        look: [32, 0, -10],
      },
      {
        name: '08_swamp_shipwreck_top',
        p: [30, 24, 10],
        look: [36, 0, 10],
      },
      {
        name: '09_swamp_relics_waterline',
        p: [-6, 3.0, -4],
        look: [30, 0, 0],
      }
    ];

    for (const st of swampStations) {
      camera.position.set(st.p[0], st.p[1], st.p[2]);
      camera.lookAt(st.look[0], st.look[1], st.look[2]);
      camera.updateMatrixWorld(true);
      updateCelLight(camera, sunDir);
      pipe.render();
      results[st.name] = canvas.toDataURL('image/png');
    }
  }

  return results;
});

for (const [name, dataUrl] of Object.entries(shots)) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  console.log(`  ✓ 截圖輸出: ${file}`);
}

await browser.close();
await srv.close();
console.log('\n✅ 海灘與沼澤純淨空間截圖完成！');
