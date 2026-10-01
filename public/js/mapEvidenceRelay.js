// Stateless, browser/Node-safe envelope. The room stores a detached immutable observation,
// never the typed arrays used by a client's worker or persistent cache.
import { MAP_EVIDENCE, evidenceFrameKey, validateEvidence } from './mapEvidence.js';

export function encodeEvidenceRelay(pack) {
  if (!validateEvidence(pack)) return null;
  let raw = '';
  for (let i = 0; i < pack.data.length; i += 8192) raw += String.fromCharCode(...pack.data.subarray(i, i + 8192));
  return { t: 'mapEvidence', key: evidenceFrameKey(pack.frame), version: pack.version,
    frame: structuredClone(pack.frame), data: btoa(raw), checksum: pack.checksum,
    inputId: pack.inputId, priorDigest: pack.priorDigest, complete: pack.complete };
}

export function decodeEvidenceRelay(message) {
  const max = Math.ceil(MAP_EVIDENCE.MAX_SIDE ** 2 * MAP_EVIDENCE.CHANNELS / 3) * 4;
  if (message?.t !== 'mapEvidence' || typeof message.data !== 'string' || message.data.length > max) return null;
  try {
    const raw = atob(message.data), data = Uint8Array.from(raw, c => c.charCodeAt(0));
    const pack = { version: message.version, frame: structuredClone(message.frame), data,
      checksum: message.checksum, inputId: message.inputId, priorDigest: message.priorDigest, complete: message.complete };
    return validateEvidence(pack) && message.key === evidenceFrameKey(pack.frame) ? pack : null;
  } catch { return null; }
}

export function sanitizeEvidenceRelay(message) {
  const pack = decodeEvidenceRelay(message);
  return pack ? encodeEvidenceRelay(pack) : null;
}
