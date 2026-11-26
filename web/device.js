import { newId, parseBackup } from './model.js';

const digest = /^[a-f0-9]{64}$/;
const normalized = payload => parseBackup(JSON.stringify(payload));

export function parseDevice(raw) {
  const data = JSON.parse(raw);
  if (data?.version !== 2) {
    return { payload: parseBackup(raw), binding: null, revision: raw, recovery: [], initialized: true };
  }
  if (typeof data.revision !== 'string' || !Array.isArray(data.recovery)
    || (data.binding !== null && (typeof data.binding?.accountId !== 'string'
      || typeof data.binding.clientId !== 'string'
      || typeof data.binding.snapshot !== 'string' || !digest.test(data.binding.snapshot)
      || typeof data.binding.hash !== 'string' || !digest.test(data.binding.hash)))) {
    throw new Error('Не удалось проверить локальную копию Tacta.');
  }
  return {
    payload: normalized(data.payload),
    binding: data.binding,
    revision: data.revision,
    recovery: data.recovery.map(entry => {
      if (!Number.isFinite(Date.parse(entry?.date))) throw new Error('Не удалось прочитать локальную резервную копию.');
      return { date: entry.date, payload: normalized(entry.payload) };
    }),
    initialized: true,
  };
}

export function encodeDevice(current, { payload = current.payload, binding = current.binding, preserve = false } = {}) {
  const recovery = [...current.recovery];
  if (preserve && current.initialized) recovery.unshift({ date: new Date().toISOString(), payload: current.payload });
  return JSON.stringify({ version: 2, revision: newId(), payload: normalized(payload), binding, recovery });
}
