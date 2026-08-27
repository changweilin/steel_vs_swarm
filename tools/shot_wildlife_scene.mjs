// ============ 生態動物群 (魚群 / 貓 / 狗 / 鳥) 實機環境場景截圖工具 ============
import { chromiumOrNull, serve } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = path.resolve(join(ROOT, 'tools', '.shots_wildlife_scene'));
fs.mkdirSync(OUT, { recursive: true });

const chromium = await chromiumOrNull();
if (!chromium) {
  console.log('未安裝 playwright,跳過');
  process.exit(0);
}

const server = await serve(8636);
const WIDTH = 1280;
const HEIGHT = 720;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(server.url, { waitUntil: 'networkidle' });

const shots = await page.evaluate(async ({ WIDTH, HEIGHT }) => {
  const THREE = await import('three');
  const { birdParts, fishParts, catParts, dogParts, tailAngle, bounceOffset, wingAngle } = await import('/public/js/wildlife.js');
  const { envMat, setCelSun } = await import('/public/js/toon.js');

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x76b8df, 1); // 晴朗動漫天藍底色

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 500);

  // 日照與賽璐璐光影
  const SUN = new THREE.Vector3(-0.55, 0.65, -0.52).normalize();
  setCelSun(SUN);
  const dirLight = new THREE.DirectionalLight(0xfffaed, 2.4);
  dirLight.position.copy(SUN).multiplyScalar(100);
  scene.add(dirLight);
  scene.add(new THREE.HemisphereLight(0xdcf0ff, 0x485240, 1.3));

  // 輔助幾何生成器
  const buildMeshGroup = (partsList, overrides = {}) => {
    const grp = new THREE.Group();
    for (const p of partsList) {
      const [t, a, b, c, sg] = p.g;
      const geo = t === 'box' ? new THREE.BoxGeometry(a, b, c)
        : t === 'cyl' ? new THREE.CylinderGeometry(a, b, c, sg || 8)
          : t === 'cone' ? new THREE.ConeGeometry(a, b, sg || 8)
            : new THREE.IcosahedronGeometry(a, 1);
      const color = overrides.color ?? p.c;
      const mat = envMat(color, { vertexColors: false, wash: 0.25, cool: 0.35, rim: 0.15 });
      const mesh = new THREE.Mesh(geo, mat);
      const [px = 0, py = 0, pz = 0] = p.p || [];
      const [rx = 0, ry = 0, rz = 0] = p.r || [];
      mesh.position.set(px, py, pz);
      mesh.rotation.set(rx, ry, rz);
      mesh.userData = { key: p.key, p, wing: p.wing, tail: p.tail };
      grp.add(mesh);
    }
    return grp;
  };

  const results = [];

  // ==========================================
  // 場景 1: 水下魚群迴游 (Fish in Shallow Water)
  // ==========================================
  {
    const scene1 = new THREE.Scene();
    scene1.add(dirLight.clone());
    scene1.add(new THREE.HemisphereLight(0xbbe6f7, 0x224440, 1.5));

    // 沙質水底地形
    const sandGeo = new THREE.PlaneGeometry(60, 60, 32, 32);
    sandGeo.rotateX(-Math.PI / 2);
    const sandMat = envMat(0xd4c29a, { wash: 0.3, cool: 0.4 });
    const sand = new THREE.Mesh(sandGeo, sandMat);
    sand.position.y = -2.2;
    scene1.add(sand);

    // 水岸石塊與水草
    for (let i = 0; i < 16; i++) {
      const r = 0.6 + (i % 5) * 0.3;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), envMat(0x68707a, { wash: 0.2 }));
      rock.position.set(-6 + (i * 1.5) % 15, -2.2 + r * 0.6, -10 + Math.sin(i * 1.3) * 6);
      scene1.add(rock);
    }

    // 半透明清澈水面
    const waterGeo = new THREE.PlaneGeometry(60, 60);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x33aabb, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0;
    scene1.add(water);

    // 水岸泥土與綠意邊坡
    const shoreGeo = new THREE.BoxGeometry(60, 3, 20);
    const shoreMat = envMat(0x567d46, { wash: 0.25 });
    const shore = new THREE.Mesh(shoreGeo, shoreMat);
    shore.position.set(0, -0.5, -18);
    scene1.add(shore);

    // 實例化魚群 (24 隻魚沿 S 曲線洄游，各帶不同擺尾角度)
    const fishGroup = new THREE.Group();
    const fishList = fishParts();
    for (let i = 0; i < 28; i++) {
      const t = i / 28;
      const u = t * Math.PI * 2;
      const posX = Math.sin(u) * 9 + Math.cos(u * 2) * 2 + (i % 3) * 0.4;
      const posZ = Math.cos(u) * 6 + ((i * 7) % 5) * 0.3;
      const posY = -1.2 + Math.sin(u * 3) * 0.4;

      const f = buildMeshGroup(fishList, { color: i % 4 === 0 ? 0xffaa55 : (i % 3 === 0 ? 0xff7766 : 0x55bbdd) });
      f.position.set(posX, posY, posZ);

      // 朝向前進切線
      const du = u + 0.05;
      const nextX = Math.sin(du) * 9 + Math.cos(du * 2) * 2;
      const nextZ = Math.cos(du) * 6;
      f.lookAt(nextX, posY, nextZ);

      // 擺尾姿態
      const tailMesh = f.children.find((c) => c.userData.tail === 1);
      if (tailMesh) {
        tailMesh.rotation.y = Math.sin(i * 0.8 + 2.5) * 0.65;
      }
      fishGroup.add(f);
    }
    scene1.add(fishGroup);

    camera.position.set(3, 1.2, 8);
    camera.lookAt(0, -1.0, 0);
    renderer.render(scene1, camera);
    results.push({ name: 'scene_fish_shoal', png: canvas.toDataURL('image/png') });
  }

  // ==========================================
  // 場景 2: 聚落與石牆貓咪漫步 (Cats on Wall & Village)
  // ==========================================
  {
    const scene2 = new THREE.Scene();
    scene2.add(dirLight.clone());
    scene2.add(new THREE.HemisphereLight(0xffeedd, 0x556644, 1.3));

    // 石板路面
    const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), envMat(0xa59f93, { wash: 0.2 }));
    road.rotation.x = -Math.PI / 2;
    scene2.add(road);

    // 綠色庭院草皮
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), envMat(0x6ca34e, { wash: 0.3 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(-15, 0.02, 0);
    scene2.add(grass);

    // 低矮石牆 (貓咪站立與漫步處)
    const wallGeo = new THREE.BoxGeometry(0.8, 1.2, 28);
    const wall = new THREE.Mesh(wallGeo, envMat(0x8a8478, { wash: 0.2 }));
    wall.position.set(-2.5, 0.6, 0);
    scene2.add(wall);

    const wallCap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.15, 28), envMat(0x6e685c, { wash: 0.2 }));
    wallCap.position.set(-2.5, 1.25, 0);
    scene2.add(wallCap);

    // 背景鄉村房屋 (木造柱樑 + 磚紅屋頂)
    const bldGroup = new THREE.Group();
    const bldWall = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 8), envMat(0xdfd8c7, { wash: 0.15 }));
    bldWall.position.set(-8, 2.25, -2);
    bldGroup.add(bldWall);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.5, 2.5, 4), envMat(0xbc4e36, { wash: 0.2 }));
    roof.position.set(-8, 5.75, -2);
    roof.rotation.y = Math.PI / 4;
    bldGroup.add(roof);

    // 門窗與木柱
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 1.3), envMat(0x5a3d28));
    door.position.set(-4.95, 1.1, -1.5);
    bldGroup.add(door);
    scene2.add(bldGroup);

    // 實例化貓咪 (一隻在矮牆上走、一隻在牆頂坐看、一隻在庭院門口)
    const catList = catParts();

    // 貓 1: 走在牆頂
    const cat1 = buildMeshGroup(catList, { color: 0xdf8d45 }); // 橘白貓
    cat1.position.set(-2.5, 1.32, 2.0);
    cat1.rotation.y = Math.PI;
    const cat1Tail = cat1.children.find((c) => c.userData.tail === 1);
    if (cat1Tail) cat1Tail.rotation.x = 0.5;
    scene2.add(cat1);

    // 貓 2: 停在牆前端回望
    const cat2 = buildMeshGroup(catList, { color: 0x3a3835 }); // 黑貓
    cat2.position.set(-2.5, 1.32, -2.5);
    cat2.rotation.y = Math.PI * 0.85;
    scene2.add(cat2);

    // 貓 3: 庭院小徑漫步
    const cat3 = buildMeshGroup(catList, { color: 0xf5f3ee }); // 白貓
    cat3.position.set(-5.5, 0.05, 3.5);
    cat3.rotation.y = 0.4;
    scene2.add(cat3);

    camera.position.set(-0.8, 2.1, 5.5);
    camera.lookAt(-2.8, 1.4, 0.5);
    renderer.render(scene2, camera);
    results.push({ name: 'scene_cats_village', png: canvas.toDataURL('image/png') });
  }

  // ==========================================
  // 場景 3: 街道公園狗狗小跑 (Dogs Trotting on Street)
  // ==========================================
  {
    const scene3 = new THREE.Scene();
    scene3.add(dirLight.clone());
    scene3.add(new THREE.HemisphereLight(0xdff0ff, 0x556040, 1.3));

    // 道路與人行道
    const road = new THREE.Mesh(new THREE.PlaneGeometry(30, 50), envMat(0x45484f, { wash: 0.2 }));
    road.rotation.x = -Math.PI / 2;
    road.position.x = 6;
    scene3.add(road);

    const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(6, 50), envMat(0xc4beaf, { wash: 0.25 }));
    sidewalk.rotation.x = -Math.PI / 2;
    sidewalk.position.set(0, 0.1, 0);
    scene3.add(sidewalk);

    const parkLawn = new THREE.Mesh(new THREE.PlaneGeometry(24, 50), envMat(0x63a34a, { wash: 0.3 }));
    parkLawn.rotation.x = -Math.PI / 2;
    parkLawn.position.set(-15, 0.05, 0);
    scene3.add(parkLawn);

    // 人行道欄杆與路燈
    for (let z = -20; z <= 20; z += 6) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.8, 6), envMat(0x2a323a));
      lamp.position.set(2.8, 1.9, z);
      scene3.add(lamp);

      const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), envMat(0xfffaaa));
      lampHead.position.set(2.8, 3.8, z);
      scene3.add(lampHead);
    }

    // 公園樹木
    for (let i = 0; i < 6; i++) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 6), envMat(0x5c4230));
      trunk.position.set(-8 - (i % 2) * 3, 1.5, -15 + i * 7);
      scene3.add(trunk);

      const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), envMat(0x3e8a3a, { cool: 0.4 }));
      foliage.position.set(-8 - (i % 2) * 3, 4.2, -15 + i * 7);
      scene3.add(foliage);
    }

    // 實例化狗狗 (一隻在人行道上歡快小跑、一隻在草地上奔跑、一隻在長椅旁)
    const dogList = dogParts();

    // 狗 1: 人行道上小跑 (帶彈跳高度與搖尾)
    const dog1 = buildMeshGroup(dogList, { color: 0xc87d3a }); // 金黃柴犬色
    dog1.position.set(0.5, 0.15 + 0.08, 0);
    dog1.rotation.y = Math.PI * 0.95;
    const dog1Tail = dog1.children.find((c) => c.userData.tail === 1);
    if (dog1Tail) dog1Tail.rotation.y = 0.5;
    scene3.add(dog1);

    // 狗 2: 草地邊緣奔跑
    const dog2 = buildMeshGroup(dogList, { color: 0x4a453f }); // 深色犬
    dog2.position.set(-4.5, 0.15 + 0.05, -5.0);
    dog2.rotation.y = 0.3;
    scene3.add(dog2);

    // 狗 3: 人行道遠處
    const dog3 = buildMeshGroup(dogList, { color: 0xe6e0d0 }); // 白犬
    dog3.position.set(-1.0, 0.15, 8.0);
    dog3.rotation.y = Math.PI * 1.1;
    scene3.add(dog3);

    camera.position.set(3.2, 1.6, 4.8);
    camera.lookAt(0.2, 0.7, 0);
    renderer.render(scene3, camera);
    results.push({ name: 'scene_dogs_street', png: canvas.toDataURL('image/png') });
  }

  // ==========================================
  // 場景 4: 生態動物群全景 (Ecosystem Pan: Birds, Fish, Cats, Dogs)
  // ==========================================
  {
    const scene4 = new THREE.Scene();
    scene4.add(dirLight.clone());
    scene4.add(new THREE.HemisphereLight(0xdff4ff, 0x4d5540, 1.4));

    // 地面、水體、橋樑
    const land = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), envMat(0x6ca34e, { wash: 0.3 }));
    land.rotation.x = -Math.PI / 2;
    scene4.add(land);

    const river = new THREE.Mesh(new THREE.BoxGeometry(16, 2, 80), new THREE.MeshStandardMaterial({
      color: 0x3399aa, transparent: true, opacity: 0.6,
    }));
    river.position.set(-15, -0.8, 0);
    scene4.add(river);

    // 石橋跨越河流
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 8), envMat(0x9a9488));
    bridge.position.set(-15, 0.6, 0);
    scene4.add(bridge);

    // 水中魚群
    const fishList = fishParts();
    for (let i = 0; i < 12; i++) {
      const f = buildMeshGroup(fishList, { color: 0xff8844 });
      f.position.set(-15 + Math.sin(i) * 3, -1.2, -18 + i * 3);
      f.lookAt(-15, -1.2, 20);
      scene4.add(f);
    }

    // 橋上狗狗
    const dogList = dogParts();
    const dog = buildMeshGroup(dogList, { color: 0xc87d3a });
    dog.position.set(-14, 1.3, 0);
    dog.rotation.y = Math.PI / 2;
    scene4.add(dog);

    // 橋頭石牆貓咪
    const catList = catParts();
    const cat = buildMeshGroup(catList, { color: 0xdf8d45 });
    cat.position.set(-3.5, 1.2, 3.5);
    cat.rotation.y = -Math.PI / 4;
    scene4.add(cat);

    // 天空飛鳥群
    const birdList = birdParts();
    for (let i = 0; i < 16; i++) {
      const b = buildMeshGroup(birdList);
      b.position.set(-20 + (i % 4) * 4 + Math.sin(i) * 2, 12 + Math.cos(i) * 2, -10 + i * 2.5);
      b.rotation.y = 0.5;
      scene4.add(b);
    }

    camera.position.set(12, 14, 22);
    camera.lookAt(-8, 2, 0);
    renderer.render(scene4, camera);
    results.push({ name: 'scene_wildlife_panorama', png: canvas.toDataURL('image/png') });
  }

  return results;
}, { WIDTH, HEIGHT });

for (const s of shots) {
  const buf = Buffer.from(s.png.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, `${s.name}.png`), buf);
  console.log(`✓ 實機渲染生態環境截圖:${s.name}.png`);
}

await browser.close();
console.log(`\n全部實機場景截圖完成! 輸出至:${OUT}`);
