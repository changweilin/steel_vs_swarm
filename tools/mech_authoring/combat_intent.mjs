import { createHash } from 'node:crypto';
import { CHARACTERS, heroWeapon, heroAbility, aoeClass, lanceR, fanArcHalf, fanSubs, fanBinRangeF } from '../../public/js/data.js';
import { characterCombatStyle } from '../../public/js/characterStyle.js';

/** Pre: complete art_gen tables. Post: prose owns art direction; shared definitions own every combat measure. */
export function combatIntent(source) {
  const rows = new Map();
  let headers = [];
  const clean = value => value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/\*\*|`/g, '').trim();
  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(clean);
    if (cells[0] === '機體編號') { headers = cells; continue; }
    if (!/^[stm]\d{2}$/.test(cells[0])) continue;
    if (cells.length !== headers.length || rows.has(cells[0])) throw new Error(`Invalid art row: ${cells[0]}`);
    rows.set(cells[0], Object.fromEntries(headers.map((key, i) => [key, cells[i]])));
  }
  const artHash = createHash('sha256').update(source).digest('hex');
  return Object.fromEntries(Object.keys(CHARACTERS).map(id => {
    const row = rows.get(id);
    if (!row) throw new Error(`Missing art direction: ${id}`);
    const art = {
      prototype: row['主原型與核心外觀'] || [row['主要型態（70%）'], row['次要型態（30%）']].join('\n'),
      emblem: row['徽記／圖騰／旗幟與位置'] || row['徽記／圖騰／位置'],
      traits: row['機體特性'], mounting: row['其他注意事項'],
    };
    if (Object.values(art).some(value => !value)) throw new Error(`Incomplete art direction: ${id}`);
    const weapons = Object.fromEntries(['light', 'heavy'].map(slot => {
      const weapon = heroWeapon(id, slot);
      const description = row[slot === 'light' ? '輕武器' : '重武器'];
      if (!description) throw new Error(`Missing weapon direction: ${id}/${slot}`);
      const count = weapon.fan ? fanSubs(weapon) : 0;
      return [slot, { description, type: weapon.type, charge: weapon.charge, fan: weapon.fan,
        rate: weapon.rate, range: weapon.range, radius: weapon.r || 0, arc: fanArcHalf(weapon),
        footprint: aoeClass(weapon), lanceRadius: lanceR(weapon),
        bins: Array.from({ length: count }, (_, i) => fanBinRangeF(weapon, i)) }];
    }));
    const abilities = Object.fromEntries(['def', 'atk'].map(slot => [slot, {
      ...heroAbility(id, slot), description: row[slot === 'def' ? '守招' : '攻招'],
    }]));
    return [id, { ...characterCombatStyle(id), artHash, art, weapons, abilities }];
  }));
}
