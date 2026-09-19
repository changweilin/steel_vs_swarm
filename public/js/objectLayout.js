// Layout only: never chooses or regenerates the model and never consumes randomness.
export function boundaryGrid({ len, depth, bufferDepth = 0, pitchX, pitchZ }) {
  if (![len, depth, pitchX, pitchZ].every(n => Number.isFinite(n) && n > 0)
    || !Number.isFinite(bufferDepth) || bufferDepth < 0) throw new RangeError('Invalid boundary grid');
  const numCols = Math.max(1, Math.round(len / pitchX));
  const colStep = len / numCols;
  const rowStep = Math.max(depth, pitchZ);
  return {
    numCols, colStep, rowStep,
    unitW: colStep * .94,
    unitD: Math.min(depth * .94, rowStep * .92),
    maxBufferRows: bufferDepth >= 6 ? Math.floor(bufferDepth / rowStep) : 0,
  };
}
