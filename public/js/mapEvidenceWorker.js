import { buildEvidence } from './mapEvidence.js';
self.onmessage = event => {
  try {
    const pack = buildEvidence(event.data);
    self.postMessage({ pack }, [pack.data.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
