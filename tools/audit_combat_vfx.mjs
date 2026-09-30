// Runtime VFX regression: real shaders, every cast profile, saturation and resource recovery.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';
import { readSrc, grabMethod } from './audit_src.mjs';
const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('戰鬥特效瀏覽器量測');
const server = process.env.SVS_URL ? { url: process.env.SVS_URL, close() {} } : await serve(8647);
const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  for (const [env, pattern] of [['THREE_MODULE', '**/three@0.160.0/build/three.module.js'], ['THREE_GEOMETRY_UTILS', '**/utils/BufferGeometryUtils.js'], ['THREE_GLTF_LOADER', '**/loaders/GLTFLoader.js'], ['THREE_SKELETON_UTILS', '**/utils/SkeletonUtils.js']]) {
    if (!process.env[env]) continue;
    const body = await readFile(process.env[env], 'utf8');
    await page.route(pattern, route => route.fulfill({ contentType: 'text/javascript', body }));
  }
  await page.route('**/__vfx_audit', route => route.fulfill({ contentType: 'text/html', body: '<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>' }));
  await page.goto(server.url + '/__vfx_audit', { waitUntil: 'domcontentloaded' });
  const game = readSrc('public', 'js', 'game.js');
  const methods = ['_onEvent', '_npcMuzzle', '_arcTracer', '_lobSolve', '_lobVel'].map(name => grabMethod(game, name));
  const result = await page.evaluate(async methods => {
    const T = await import('three');
    const { fireUnitMotion } = await import('/public/js/unitMotion.js');
    const { CHARACTERS, heroAbility, UNITS, WEAPONS, BALLISTIC } = await import('/public/js/data.js');
    const { spawnCastFx } = await import('/public/js/castfx.js');
    const { disposeTree } = await import('/public/js/toon.js');
    const V = await import('/public/js/vfx.js');
    const { setLowPower } = await import('/public/js/mobile.js');
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(45, 1.5, 0.1, 300);
    camera.position.set(18, 20, 26); camera.lookAt(0, 2, 0);
    const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(240, 160); scene.background = new T.Color(0x101822);
    const grid = new T.GridHelper(36, 12, 0x40586e, 0x243648); scene.add(grid);
    const atlas = document.createElement('canvas'); atlas.width = 8 * 240; atlas.height = 8 * 3 * 184;
    const ctx = atlas.getContext('2d'); ctx.fillStyle = '#101822'; ctx.fillRect(0, 0, atlas.width, atlas.height);
    const effects = [];
    const check = (value, message) => { if (!value) throw new Error(message); };
    const clear = () => { for (const e of effects) { scene.remove(e.obj); e.dispose ? e.dispose() : disposeTree(e.obj); } effects.length = 0; };
    const tick = (dt, render = true) => {
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]; e.age = (e.age || 0) + dt; e.ttl -= dt;
        e.fade?.(e.obj, Math.max(0, e.ttl / (e.age + e.ttl)), dt);
        if (e.ttl <= 0) { scene.remove(e.obj); e.dispose ? e.dispose() : disposeTree(e.obj); effects.splice(i, 1); }
      }
      scene.traverse(o => { check([...o.position, ...o.scale, ...o.quaternion].every(Number.isFinite), 'Non-finite transform');
        if (o.isInstancedMesh) check(o.instanceMatrix.array.every(Number.isFinite), 'Non-finite instances'); });
      if (render) renderer.render(scene, camera);
    };
    const cast = (ch, slot) => {
      const a = heroAbility(ch, slot);
      spawnCastFx(scene, effects, { ch, slot, fx: a.fx, r: Math.min(12, a.r || 8), dur: a.dur, scale: 5,
        at: new T.Vector3(), casterPos: () => new T.Vector3(0, 3, -2), groundY: () => 0, rvCap: 12 });
    };
    let peakCalls = 0, index = 0;
    for (const ch of Object.keys(CHARACTERS)) for (const slot of ['def', 'atk']) {
      cast(ch, slot); check(effects.some(e => e.obj.userData.castPresentation), `${ch}.${slot} missing`);
      for (let beat = 0; beat < 3; beat++) {
        tick(beat ? 0.16 : 0.08);
        peakCalls = Math.max(peakCalls, renderer.info.render.calls);
        const x = index % 8 * 240, y = (Math.floor(index / 8) * 3 + beat) * 184;
        ctx.drawImage(renderer.domElement, x, y); ctx.fillStyle = '#dcecff'; ctx.font = '13px monospace';
        ctx.fillText(`${ch}.${slot} ${['tell', 'release', 'contact'][beat]}`, x + 8, y + 176);
      }
      for (let i = 0; i < 200 && effects.length; i++) tick(1 / 60, false);
      check(effects.length === 0, `${ch}.${slot} did not expire`);
      index++;
    }
    const from = new T.Vector3(-10, 3, 0), to = new T.Vector3(10, 3, 0);
    const unitKinds = [...Object.keys(UNITS).filter(k => UNITS[k].wid), 'tower', 'base'];
    const unitAtlas = document.createElement('canvas'); unitAtlas.width = 7 * 240; unitAtlas.height = Math.ceil(unitKinds.length / 7) * 3 * 184;
    const uc = unitAtlas.getContext('2d'); uc.fillStyle = '#101822'; uc.fillRect(0, 0, unitAtlas.width, unitAtlas.height);
    const client = new Function('THREE', 'UNITS', 'BALLISTIC', 'unitShotStyle', 'unitShotFx', 'fireUnitMotion',
      `return new (class { ${methods.join('\n')} })()`)(T, UNITS, BALLISTIC, V.unitShotStyle, V.unitShotFx, fireUnitMotion);
    Object.assign(client, { scene, effects, terrain: { heightAt: () => 0 }, ents: new Map(),
      _shotCols: () => ({ col: 0x4fc3f7, hot: 0xffffff }), _clipBeam: (a, b) => ({ to: b, cut: false }) });
    let unitPeakCalls = 0;
    for (let k = 0; k < unitKinds.length; k++) {
      const kind = unitKinds[k];
      client._onEvent({ e: 'shot', kind, from: [-10, 0], to: [10, 0], side: 'STEEL', ty: 1 });
      check(effects.length > 0, `${kind}: shot event omitted`);
      for (let beat = 0; beat < 3; beat++) {
        tick(beat ? 0.065 : 0.02);
        scene.traverse(o => check(Math.max(...o.scale.toArray().map(Math.abs)) < 100, `${kind}: oversized effect`));
        unitPeakCalls = Math.max(unitPeakCalls, renderer.info.render.calls);
        const x = k % 7 * 240, y = (Math.floor(k / 7) * 3 + beat) * 184;
        uc.drawImage(renderer.domElement, x, y); uc.fillStyle = '#dcecff'; uc.font = '13px monospace';
        uc.fillText(kind, x + 8, y + 176);
      }
      if (kind === 'base') check(!effects.some(e => e.obj.userData.projectileFx), 'Duplicate base missile');
      clear();
    }
    // A blocker must terminate both straight rockets and the sampled artillery path.
    const barrier = (a, b) => a.x < 0 && b.x >= 0
      ? { to: a.clone().lerp(b, -a.x / (b.x - a.x)), cut: true } : { to: b, cut: false };
    for (const kind of ['rocketeer', 'howitzer', 'heli_squad', 'carnival_heli']) {
      V.unitShotFx(scene, effects, from, to, { kind, clip: barrier });
      const moving = effects.find(e => e.obj.userData.projectileFx);
      check(moving, `${kind}: missing projectile`);
      moving.fade(moving.obj, 0);
      check(Math.abs(moving.obj.position.x) < 0.05, `${kind}: passed through blocker`);
      clear();
    }
    const weapons = document.createElement('canvas'); weapons.width = 8 * 240; weapons.height = 3 * 184;
    const wc = weapons.getContext('2d'); wc.fillStyle = '#101822'; wc.fillRect(0, 0, weapons.width, weapons.height);
    const types = ['gun', 'rail', 'missile', 'launcher', 'beam', 'ion', 'explosion', 'impact'];
    for (let col = 0; col < types.length; col++) {
      const type = types[col];
      let projectile;
      if (col < 4) {
        projectile = V.projectileMesh({ type }, { heavy: col > 0 });
        projectile.scale.setScalar(3); projectile.position.set(0, 3, 0); scene.add(projectile);
      } else if (type === 'beam') V.gundamBeam(scene, effects, from, to, 0x44bbff, { r: 1 });
      else if (type === 'ion') V.ionBreath(scene, effects, from, to, 0x66ffbb, { r: 1 });
      else if (type === 'explosion') V.explosionBurst(scene, effects, 0, 2, 0, 8, 0xff7722);
      else V.impactBurst(scene, effects, new T.Vector3(0, 2, 0), { r: 4, heavy: true });
      for (let beat = 0; beat < 3; beat++) {
        if (projectile) V.stepProjectileFx(projectile, beat * 0.1, 250);
        tick(beat ? 0.08 : 0.02);
        wc.drawImage(renderer.domElement, col * 240, beat * 184);
        wc.fillStyle = '#dcecff'; wc.font = '13px monospace'; wc.fillText(type, col * 240 + 8, beat * 184 + 176);
      }
      if (projectile) { scene.remove(projectile); disposeTree(projectile); }
      clear();
    }
    for (const low of [false, true]) {
      setLowPower(low);
      for (let i = 0; i < 100; i++) cast('s01', 'def');
      check(effects.filter(e => e.obj.userData.castPresentation).length === (low ? 6 : 12), 'Cast saturation cap');
      clear();
      const systems = scene.children.filter(o => o.geometry?.getAttribute('aColor'));
      check(systems.every(o => o.geometry.getAttribute('aColor').array.every((v, i) => i % 4 !== 3 || v === 0)), 'Particle ghost after clear');
      for (let i = 0; i < 200; i++) V.unitShotFx(scene, effects, from, to, { kind: unitKinds[i % unitKinds.length] });
      check(effects.length <= (low ? 96 : 186), 'NPC effects unbounded');
      tick(1 / 60);
      clear();
      for (const type of ['gun', 'rail', 'missile', 'launcher']) for (const heavy of [false, true]) {
        const mesh = V.projectileMesh({ type }, { heavy }); scene.add(mesh);
        for (let i = 0; i < 60; i++) V.stepProjectileFx(mesh, i / 60, i * 20);
        tick(1 / 60); scene.remove(mesh); disposeTree(mesh);
      }
      let baseline;
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 40; i++) {
          V.gundamBeam(scene, effects, from, to, 0x49bbff);
          V.ionBreath(scene, effects, from, to, 0x88ffcc);
          V.explosionBurst(scene, effects, 0, 2, 0, 8, 0xff7722);
        }
        check(effects.length <= (low ? 96 : 186), 'Weapon effects unbounded');
        for (let i = 0; i < 60; i++) tick(1 / 60, i % 15 === 0);
        // Destruction must remain batched, including simultaneous building deaths.
        clear();
        for (let i = 0; i < 8; i++) {
          V.debrisBurst(scene, effects, 0, 3, 0, { big: true, accent: 0xffaa33 });
          check(effects.at(-1).obj.children.length === (low ? 2 : 4), 'Debris draw budget');
        }
        for (let i = 0; i < 60; i++) tick(1 / 60, i % 15 === 0);
        clear(); renderer.render(scene, camera);
        const memory = JSON.stringify(renderer.info.memory);
        if (round === 0) baseline = memory;
        else check(memory === baseline, `GPU resources grew: ${baseline} -> ${memory}`);
      }
    }
    setLowPower(false);
    const memory = { ...renderer.info.memory };
    check(peakCalls <= 7, `Cast draw budget exceeded: ${peakCalls}`);
    renderer.dispose();
    const { CharPreview } = await import('/public/js/charPreview.js');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:480px;height:320px'; document.body.append(canvas);
    const preview = new CharPreview(canvas);
    let showcasePlays = 0;
    for (const [ch, info] of Object.entries(CHARACTERS)) {
      preview.setChar(ch, info.side === 'MERC' ? 'STEEL' : info.side);
      for (const slot of ['def', 'atk', 'light', 'heavy']) {
        preview.play(slot);
        let visible = false;
        for (let i = 0; i < 240; i++) {
          preview.clockT += 1 / 60;
          preview._stepAnim(1 / 60);
          preview._stepLoco(1 / 60, preview.clockT);
          preview._updateEffects(1 / 60);
          visible ||= preview.effects.length > 0;
          if (i === 35) preview.renderer.render(preview.scene, preview.camera);
        }
        check(visible && !preview.anim && !preview.effects.length, `Showcase lifecycle: ${ch}.${slot}`);
        showcasePlays++;
      }
    }
    let unitShowcasePlays = 0;
    for (const kind of unitKinds) for (const side of ['STEEL', 'SWARM']) {
      preview.setUnit(kind, side);
      preview.playUnitWeapon(WEAPONS[UNITS[kind]?.wid] || UNITS[kind]);
      let visible = false;
      for (let i = 0; i < 720; i++) {
        preview.clockT += 1 / 60;
        preview._stepAnim(1 / 60); preview._stepLoco(1 / 60, preview.clockT); preview._updateEffects(1 / 60);
        visible ||= preview.effects.length > 0;
        if (i === 15) preview.renderer.render(preview.scene, preview.camera);
        if (!preview.anim && !preview.effects.length) break;
      }
      check(visible && !preview.anim && !preview.effects.length, `Unit showcase lifecycle: ${kind}/${side}`);
      unitShowcasePlays++;
    }
    preview.dispose(); canvas.remove();
    return { profiles: index, showcasePlays, unitKinds: unitKinds.length, unitShowcasePlays, unitPeakCalls, peakCalls, memory,
      atlas: atlas.toDataURL('image/png'), weapons: weapons.toDataURL('image/png'), units: unitAtlas.toDataURL('image/png') };
  }, methods);
  assert.deepEqual(errors, [], 'Browser or shader errors');
  await mkdir('out/combat_review', { recursive: true });
  await writeFile('out/combat_review/casts.png', Buffer.from(result.atlas.split(',')[1], 'base64'));
  await writeFile('out/combat_review/weapons.png', Buffer.from(result.weapons.split(',')[1], 'base64'));
  await writeFile('out/combat_review/units.png', Buffer.from(result.units.split(',')[1], 'base64'));
  delete result.atlas; delete result.weapons; delete result.units;
  await writeFile('out/combat_review/runtime.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); server.close(); }
