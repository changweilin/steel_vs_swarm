export function sampleCombatKeys(keys, time) {
  if (time <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (time > keys[i][0]) continue;
    const [start, value] = keys[i - 1], [end, target] = keys[i];
    return value + (target - value) * (time - start) / (end - start);
  }
  return keys[keys.length - 1][1];
}
