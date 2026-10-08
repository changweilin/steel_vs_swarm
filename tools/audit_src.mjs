// ============ Shared audit helper: read executed source and extract method blocks ============
// A group of audits (audit_minimap_view / audit_cc_flash and others) do not import client modules,
// they read the source text directly:
// game.js loads three through a CDN importmap which Node cannot resolve; copying a formula into
// the audit would always pass.
// This file collapses two cross-file duplications into a single seam:
//   1 readSrc -- read a file and normalize line endings to LF.
//      Why normalization is required: audits strip comments line by line with line.replace and
//      split on LF. JS dot does not match CR, and dollar without the m flag does not match before CR,
//      so in a CRLF checkout the whole comment-stripping rule silently stops working -- names mentioned
//      inside comments leak into single-seam counts of the form only N occurrences in the whole file,
//      and MM_NEAR followed by a line comment is fed into JSON.parse and throws.
//      The same code passes on LF and fails on CRLF, which is a portability bug in the audit itself,
//      not in the code under test.
//      Normalization happens only at audit entry and never writes files, so the verdict stays
//      identical regardless of checkout style.
//   2 grabMethod -- extract a class method source block by brace matching, for direct behavior
//      tests through new Function.
// Consumers MUST use these two helpers, MUST NOT call readFileSync directly or copy brace matching.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (this file lives under tools/) */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Read source text; line endings are always normalized to LF (CRLF and lone-CR checkouts verify identically) */
export const readSrc = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n?/g, '\n');

/** Brace-match from index i and return source up to block end (shared by grabMethod and grabFn, MUST NOT duplicate) */
const grabAt = (src, i) => {
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
};

/**
 * Extract the source of a class method (including its brace block).
 * @param {string} src  Normalized source text
 * @param {string} name Method name (located by newline plus two-space indent, which means class member)
 */
export const grabMethod = (src, name) => {
  const i = src.indexOf(`\n  ${name}(`);
  if (i < 0) throw new Error(`找不到 ${name}`);
  return grabAt(src, i);
};

/**
 * Extract the source of a top-level named function (including its brace block); for non-class
 * modules such as server.js and mobile.js.
 * Both export and async prefixes are accepted -- client top-level functions are almost always
 * export function, while an older matcher accepting only a bare function name form reports
 * not found for all of them, forcing the audit back to a whole-file regex over source text:
 * that can match across functions (the same string elsewhere counts as a pass) while still green.
 * The returned text always starts at function or async function with export stripped, so consumers
 * can still feed it directly into new Function.
 * @param {string} src  Normalized source text
 * @param {string} name Function name (anchored at line start -- zero indent means module top level)
 */
export const grabFn = (src, name) => {
  const m = new RegExp(`\\n(export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`找不到 function ${name}`);
  const start = m.index + 1 + (m[1]?.length ?? 0);
  // Brace matching MUST start at the function body brace: the parameter list may use destructuring
  // such as function f with an object pattern; starting at the function keyword would stop at the
  // closing brace of the parameter list, so the extracted source loses the whole body, and new Function
  // then reports Unexpected token return on the trailing line added by the caller, looking unrelated.
  let d = 0, i = src.indexOf('(', start);
  for (; i < src.length; i++) {
    if (src[i] === '(') d++;
    else if (src[i] === ')') { d--; if (d === 0) { i++; break; } }
  }
  const body = src.indexOf('{', i);
  return src.slice(start, body) + grabAt(src, body);
};

/**
 * Brace-match from an arbitrary marker and extract that block, for message-dispatch branches
 * such as an if branch on message type. Method, top-level function, and const extractors cannot
 * locate them -- without this helper consumers can only run a whole-file regex, which risks
 * cross-branch false hits (the same string in another branch counts as a pass) while still green.
 * Brace matching reuses the same grabAt implementation.
 * @param {string} src    Normalized source text
 * @param {string} marker Literal marker for the block start (first occurrence; match from the next brace)
 */
export const grabBlock = (src, marker) => {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`找不到區塊 ${marker}`);
  return grabAt(src, src.indexOf('{', i));
};

/**
 * Extract the source of a top-level const object literal (including its brace block), returning
 * a const assignment without export that can go directly into new Function.
 * Purpose: tables such as GIANT_DEFS, MEGALITHS, LANDMARK_COL in biomes.js and BEACON_KINDS in
 * beacons.js live in files importing three -- Node cannot import those files, and copying the numbers
 * into the audit would always pass. This helper feeds the audit the genuine source (closures such as
 * the build field are only defined, never evaluated, so lines referencing three never run).
 * Brace matching reuses the same grabAt implementation.
 * @param {string} src  Normalized source text
 * @param {string} name Const name (anchored at line start -- zero indent means module top level)
 */
export const grabConst = (src, name) => {
  const m = new RegExp(`\\n(export\\s+)?const\\s+${name}\\s*=\\s*[{[]`).exec(src);
  if (!m) throw new Error(`找不到 const ${name}`);
  const i = m.index + 1 + (m[1]?.length ?? 0);
  return `const ${name} = ${grabAt(src, src.indexOf('=', i) + 1)};`;
};
