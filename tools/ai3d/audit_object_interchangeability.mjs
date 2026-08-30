#!/usr/bin/env node
/**
 * Luna 功能替換群稽核：物件用途、零件介面與語意配色必須逐欄吻合。
 * 反向驗證：--break-object / --break-part / --break-palette / --break-appearance。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../audit_src.mjs';
import {
  objectCompatibility,
  paletteCompatibility,
  partCompatibility,
} from './object_classification_policy.mjs';

const FILE = path.join(ROOT, 'tools', 'ai3d', 'object_interchangeability.json');
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const classificationDir = path.join(ROOT, 'tools', 'ai3d', 'object_classifications');
const items = new Map();
for (const file of fs.readdirSync(classificationDir).filter((name) => name.endsWith('.json'))) {
  const family = JSON.parse(fs.readFileSync(path.join(classificationDir, file), 'utf8'));
  for (const item of family.items || []) items.set(item.id, item);
}

const has = (flag) => process.argv.includes(flag);
if (has('--break-object')) doc.objectGroups[0].members.push(doc.objectGroups.at(-1).members[0]);
if (has('--break-part')) doc.partGroups[0].interfaceFamily = '__broken_interface__';
if (has('--break-palette')) doc.paletteGroups[0].operationalMarking = ['__broken_marking__'];
if (has('--break-appearance')) doc.objectGroups[0].shapeSimilarity = 1;

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
const sameArray = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
const unique = (values) => new Set(values).size === values.length;
const objectGroupByMember = new Map();

ok('判定器為 gpt-5.6-luna/max', doc.schemaVersion === 1
  && doc.classifier?.model === 'gpt-5.6-luna'
  && doc.classifier?.reasoningEffort === 'max');
ok('三種替換群皆存在', doc.objectGroups?.length > 0
  && doc.partGroups?.length > 0 && doc.paletteGroups?.length > 0);

let objectGroupsValid = true;
for (const group of doc.objectGroups || []) {
  if (!group.id || group.members?.length < 2 || !unique(group.members) || !group.rationale) objectGroupsValid = false;
  const rows = (group.members || []).map((id) => items.get(id));
  if (rows.some((row) => !row)) objectGroupsValid = false;
  for (const row of rows.filter(Boolean)) {
    if (row.objectType !== group.objectType
      || row.functionalProfile?.workingMedium !== group.workingMedium
      || row.functionalProfile?.operationMode !== group.operationMode
      || row.functionalProfile?.safetyClass !== group.safetyClass) objectGroupsValid = false;
    if (objectGroupByMember.has(row.id)) objectGroupsValid = false;
    objectGroupByMember.set(row.id, group.id);
  }
  for (let index = 1; index < rows.length; index++) {
    if (!objectCompatibility(rows[0], rows[index]).compatible
      || !objectCompatibility(rows[index], rows[0]).compatible) objectGroupsValid = false;
  }
}
ok('物件群只含雙向用途相容成員', objectGroupsValid,
  `groups=${doc.objectGroups?.length || 0}`);

const partFields = [
  'role', 'interfaceFamily', 'kinematicClass', 'loadClass', 'workingMedium',
  'handedness', 'materialClass', 'paletteSlot', 'mountCount',
];
let partGroupsValid = true;
const partRefs = [];
for (const group of doc.partGroups || []) {
  if (!group.id || group.members?.length < 2 || !group.rationale) partGroupsValid = false;
  const resolved = [];
  for (const member of group.members || []) {
    const item = items.get(member.objectId);
    const part = item?.parts?.[member.partIndex];
    const ref = `${member.objectId}#${member.partIndex}`;
    partRefs.push(ref);
    if (!part || item.decompositionStatus !== 'decomposed' || part.role === 'unresolved_detail') {
      partGroupsValid = false;
      continue;
    }
    if (partFields.some((field) => part[field] !== group[field])) partGroupsValid = false;
    resolved.push({ item, part });
  }
  if (resolved.some(({ item }) => objectGroupByMember.get(item.id) !== objectGroupByMember.get(resolved[0]?.item.id))) {
    partGroupsValid = false;
  }
  for (let index = 1; index < resolved.length; index++) {
    if (!partCompatibility(resolved[0].part, resolved[index].part).compatible) partGroupsValid = false;
  }
}
ok('零件群先通過物件用途，再逐欄通過現實介面', partGroupsValid && unique(partRefs),
  `groups=${doc.partGroups?.length || 0}`);

let paletteGroupsValid = true;
const paletteRefs = [];
for (const group of doc.paletteGroups || []) {
  if (!group.id || group.members?.length < 2 || !unique(group.members) || !group.rationale) paletteGroupsValid = false;
  const rows = (group.members || []).map((id) => items.get(id));
  if (rows.some((row) => !row)) paletteGroupsValid = false;
  for (const row of rows.filter(Boolean)) {
    paletteRefs.push(row.id);
    const slots = [...new Set(row.parts.map((part) => part.paletteSlot))].sort();
    if (row.paletteDomain !== group.paletteDomain
      || !sameArray(row.operationalMarking, group.operationalMarking)
      || !sameArray(slots, group.slots)
      || objectGroupByMember.get(row.id) !== objectGroupByMember.get(rows[0]?.id)) paletteGroupsValid = false;
  }
  for (let index = 1; index < rows.length; index++) {
    if (!paletteCompatibility(rows[0], rows[index]).compatible
      || !paletteCompatibility(rows[index], rows[0]).compatible) paletteGroupsValid = false;
  }
}
ok('配色群只按語意域、標記與槽位替換', paletteGroupsValid && unique(paletteRefs),
  `groups=${doc.paletteGroups?.length || 0}`);

const forbiddenKeys = new Set([
  'appearance', 'shape', 'shapeSimilarity', 'primitive', 'geometrySimilarity',
  'colorDistance', 'dominantColor', 'visualStyle',
]);
const keys = [];
const walk = (value) => {
  if (Array.isArray(value)) return value.forEach(walk);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { keys.push(key); walk(child); }
};
walk(doc);
ok('判定資料沒有外觀、形狀或色差資格欄', !keys.some((key) => forbiddenKeys.has(key)));

const exclusionScopes = new Set((doc.exclusions || []).map((row) => row.scope));
ok('拒絕案例涵蓋功能、介面、作業標記與未拆件',
  ['object-function', 'part-interface', 'palette-marking', 'decomposition'].every((scope) => exclusionScopes.has(scope))
  && doc.exclusions.every((row) => row.left && row.right && row.reason));

for (const check of checks) console.log(`${check.pass ? '✓' : '✗'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
