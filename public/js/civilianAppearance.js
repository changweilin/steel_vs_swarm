import { mulberry32 } from './rng.js';
import { civilianBody } from './data.js';
import { CIVILIAN_OCCUPATIONS, CIVILIAN_OPTIONS as O } from './civilianContent.js';

// Separate streams keep appearance edits from changing collision or world scatter.
export function generateCivilian(seed = 0, profession = 0) {
  const random = mulberry32((seed >>> 0) ^ 0x63766170);
  const pick = list => list[Math.floor(random() * list.length)];
  const family = ((profession | 0) % CIVILIAN_OCCUPATIONS.length + CIVILIAN_OCCUPATIONS.length) % CIVILIAN_OCCUPATIONS.length;
  const gender = pick(O.gender);
  const age = 18 + Math.floor(random() * 68);
  const ethnicity = pick(O.ethnicity);
  // Background never determines allegiance, spy status, rewards or body shape.
  const skinColor = pick(O.skinColor);
  const hairColor = age >= 60 && random() < 0.7 ? pick([0x827874, 0xc9c7c2]) : pick(O.hairColor);
  return {
    seed: seed >>> 0, family, occupation: pick(CIVILIAN_OCCUPATIONS[family]),
    gender, age, ethnicity, skinColor, hairColor,
    hairStyle: pick(O.hairStyle), clothing: pick(O.clothing), bottoms: pick(O.bottoms),
    headwear: pick(O.headwear), accessory: pick(O.accessory), footwear: pick(O.footwear),
    facialHair: gender === 'female' ? 'none' : pick(O.facialHair),
    clothColor: pick(O.palette), trouserColor: pick(O.palette), accentColor: pick(O.palette),
    shoulderScale: 0.88 + random() * 0.24,
    headScale: 0.92 + random() * 0.16,
    ...civilianBody(seed),
  };
}
