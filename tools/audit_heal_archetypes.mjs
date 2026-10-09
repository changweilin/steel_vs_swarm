// Execute healing archetype differentiation audit:
// 1. Single-target heavy burst heal + status cleanse (m03.def)
// 2. Area team heal (s02.atk, t12.def, s08.atk, m03.atk)
// 3. Aura continuous mobile heal over time (s08.def)
// 4. Recovery enhancement state (multi-charge/stackable) + CC immunity (t05.def)
// 5. Verification of canonical 5 support mechs balanced across factions:
//    SWARM: s02, s08 (2)
//    STEEL: t05, t12 (2)
//    MERC:  m03      (1)
import assert from 'node:assert/strict';
import { BattleSim } from '../server/sim.js';
import { MAPGEO, heroAbility, CHARACTERS } from '../public/js/data.js';
import { readSrc, grabFn } from './audit_src.mjs';

const config = new Function('MAPGEO', `${grabFn(readSrc('test', 'e2e.mjs'), 'fakeBattleConfig')}; return fakeBattleConfig(1);`)(MAPGEO);
const sim = new BattleSim(config);

// 1. Single-target strong heal + cleanse abnormal status (M-03 def)
{
  const h1 = sim.addHero('SWARM', 'h1_m', 'm03');
  h1.x = 0; h1.z = 0;
  h1.hp = 100;
  h1.stunUntil = sim.t + 5;
  h1.slowUntil = sim.t + 5;
  h1.confUntil = sim.t + 5;
  h1.empUntil = sim.t + 5;
  h1.bleed = { dps: 25, until: sim.t + 5 };
  h1._psnStacks = 4;
  h1._sonicStacks = 3;
  h1._staggerStacks = 2;
  h1._elemBuildup = { fire: 80, frost: 60 };
  h1._elemLastHit = { fire: sim.t, frost: sim.t };

  const A1 = heroAbility('m03', 'def', 1);
  assert(A1.cleanse, 'm03 def has cleanse enabled');
  assert(A1.heal >= 120, 'm03 def is a high single burst heal');
  sim._castEffect(h1, A1, h1.x, h1.z, 1, null, true);

  assert.equal(h1.stunUntil, 0, 'm03 cleanse clears stun');
  assert.equal(h1.slowUntil, 0, 'm03 cleanse clears slow');
  assert.equal(h1.confUntil, 0, 'm03 cleanse clears conf');
  assert.equal(h1.empUntil, 0, 'm03 cleanse clears emp');
  assert.equal(h1.bleed, null, 'm03 cleanse clears bleed/burn/poison DoT');
  assert.equal(h1._psnStacks, 0, 'm03 cleanse clears poison stacks');
  assert.equal(h1._sonicStacks, 0, 'm03 cleanse clears sonic stacks');
  assert.equal(h1._staggerStacks, 0, 'm03 cleanse clears stagger stacks');
  assert.equal(h1._elemBuildup, null, 'm03 cleanse clears elemental buildup gauges');
  assert(h1.hp >= 220, 'm03 single target burst heal restored massive HP');
}

// 2. Area heal (S-02 atk, T-12 def)
{
  // S-02 area armor repair & engineering supply
  const caster = sim.addHero('SWARM', 'h2_c', 's02');
  const ally = sim.addHero('SWARM', 'h2_a', 's03');
  caster.x = 0; caster.z = 0;
  ally.x = 30; ally.z = 30;
  caster.hp = 150; caster.sp = 50;
  ally.hp = 120; ally.sp = 40;

  const A2 = heroAbility('s02', 'atk', 1);
  assert.equal(A2.target, 'team', 's02 atk targets team');
  assert(A2.r >= 200, 's02 atk covers wide area');
  sim._castEffect(caster, A2, caster.x, caster.z, 1, null, true);

  assert(caster.hp > 150, 's02 caster received area heal');
  assert(ally.hp > 120, 's03 ally in area received area heal');
  assert(caster.sp > 50, 's02 caster shield replenished');
  assert(ally.sp > 40, 's03 ally shield replenished');

  // T-12 team lifeline support (spectrum harmonic link)
  const t12 = sim.addHero('STEEL', 'h2_t12', 't12');
  const tMate = sim.addHero('STEEL', 'h2_tmate', 't01');
  t12.x = 50; t12.z = 50;
  tMate.x = 60; tMate.z = 60;
  t12.hp = 200; t12.sp = 20;
  tMate.hp = 200; tMate.sp = 20;

  const At12 = heroAbility('t12', 'def', 1);
  assert.equal(At12.fx, 'heal', 't12 def fx is heal');
  assert.equal(At12.target, 'team', 't12 def targets team');
  assert(At12.r >= 150, 't12 def covers team radius');
  assert(At12.spRegenHit, 't12 def activates uninterrupted shield recharge');
  sim._castEffect(t12, At12, t12.x, t12.z, 1, null, true);

  assert(t12.hp > 200, 't12 self HP repaired');
  assert(tMate.hp > 200, 'tMate ally HP repaired');
  assert(t12.sp > 20, 't12 self SP replenished');
  assert(tMate.sp > 20, 'tMate ally SP replenished');
  assert(t12.spRegenHitUntil > sim.t, 't12 gained uninterrupted SP regen');
  assert(tMate.spRegenHitUntil > sim.t, 'tMate gained uninterrupted SP regen');
}

// 3. Aura continuous heal (S-08 def)
{
  const medic = sim.addHero('SWARM', 'h3_m', 's08');
  const patient = sim.addHero('SWARM', 'h3_p', 's04');
  medic.x = 100; medic.z = 100;
  patient.x = 110; patient.z = 100; // 10m away, inside 28m aura
  patient.hp = 100; patient.sp = 20;

  const A3 = heroAbility('s08', 'def', 1);
  assert(A3.aura, 's08 def has aura enabled');
  assert(A3.hot > 0, 's08 def has HoT rate');
  sim._castEffect(medic, A3, medic.x, medic.z, 1, null, true);

  assert(medic.healAura, 'medic active heal aura initialized');
  assert.equal(medic.healAura.r, 28, 'aura has 28m radius');

  const hp0 = patient.hp;
  const sp0 = patient.sp;
  sim._tickHealAuras(1.0);

  assert(patient.hp > hp0, 'patient inside aura received continuous HP tick');
  assert(patient.sp > sp0, 'patient inside aura received continuous SP tick');

  // Move patient outside aura
  patient.x = 200; patient.z = 200;
  const hp1 = patient.hp;
  sim._tickHealAuras(1.0);
  assert.equal(patient.hp, hp1, 'patient outside aura received no healing');
}

// 4. Recovery enhancement state (multi-charge/stackable) + CC immunity (T-05 def)
{
  const t05 = sim.addHero('STEEL', 'h4_t', 't05');
  const enemy = sim.addHero('SWARM', 'h4_e', 's01');
  t05.x = 300; t05.z = 300;
  enemy.x = 300; enemy.z = 320;
  t05.hp = 100;

  const A4 = heroAbility('t05', 'def', 1);
  assert.equal(A4.charges, 2, 't05 def has 2 charges');
  assert(A4.stackable, 't05 def is stackable');
  assert(A4.ccImm, 't05 def grants cc immunity');
  assert(A4.healAmp > 0, 't05 def has heal amplification');

  // 1st cast
  sim._castEffect(t05, A4, t05.x, t05.z, 1, null, true);
  assert(sim._buffVal(t05, 'ccImm') > 0, 't05 gained cc immunity');
  assert(t05.spRegenHitUntil > sim.t, 't05 gained uninterrupted shield regen');

  const amp1 = sim._buffMul(t05, 'healAmp');
  const rgn1 = sim._buffMul(t05, 'regen');
  assert(amp1 > 1.0, `t05 healAmp active: ${amp1}`);
  assert(rgn1 > 1.0, `t05 regen active: ${rgn1}`);

  // While immune, incoming CC & elemental buildup are blocked
  sim._applyHitElem(enemy, { elem: 'frost', elemBuildup: 50 }, t05);
  sim._applyCC(enemy, { fx: 'stun', dur: 2.0 }, t05.x, t05.z, 5);
  assert.equal(t05.stunUntil, 0, 'stun blocked by CC immunity');
  assert.equal(t05._elemBuildup, null, 'elemental buildup blocked by CC immunity');

  // 2nd cast (stacking before expiry)
  sim._castEffect(t05, A4, t05.x, t05.z, 1, null, true);
  const amp2 = sim._buffMul(t05, 'healAmp');
  const rgn2 = sim._buffMul(t05, 'regen');
  assert(amp2 > amp1, `healAmp stacked: ${amp2} > ${amp1}`);
  assert(rgn2 > rgn1, `regen multiplier stacked: ${rgn2} > ${rgn1}`);

  // Verify healAmp scales incoming heals
  const hpBefore = t05.hp;
  const healed = sim._healBody(t05, 50, 'def');
  assert(Math.abs(healed - 50 * amp2) < 1e-4, `healed ${healed} scaled by stacked amp ${amp2}`);
}

// 5. Verification of canonical 5 support mechs balanced across factions
{
  const healMechs = Object.entries(CHARACTERS)
    .filter(([_, c]) => c.atk?.fx === 'heal' || c.def?.fx === 'heal')
    .map(([id]) => id)
    .sort();

  const expectedMechs = ['m03', 's02', 's08', 't05', 't12'].sort();
  assert.deepEqual(healMechs, expectedMechs, `healing roster is strictly the 5 canonical mechs: ${healMechs.join(', ')}`);

  const swarmCount = healMechs.filter((id) => CHARACTERS[id].side === 'SWARM').length;
  const steelCount = healMechs.filter((id) => CHARACTERS[id].side === 'STEEL').length;
  const mercCount = healMechs.filter((id) => CHARACTERS[id].side === 'MERC').length;

  assert.equal(swarmCount, 2, 'SWARM has exactly 2 healing mechs (s02, s08)');
  assert.equal(steelCount, 2, 'STEEL has exactly 2 healing mechs (t05, t12)');
  assert.equal(mercCount, 1, 'MERC has exactly 1 healing mech (m03)');
}

console.log('✅ Healing archetypes differentiation audit passed all assertions');
