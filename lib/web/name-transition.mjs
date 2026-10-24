import { nameRow, writeName } from '../names.mjs';
import { WebError } from './common.mjs';

// Explicit table identities only. Values (including credentials) never enter errors.
export function aliasValue(id, get) {
  const row = nameRow(id), current = get(row.plates), legacy = get(row.keel);
  if (current != null && legacy != null && current !== legacy)
    throw new WebError(`conflicting_names:${row.plates}:${row.keel}`, 400);
  return current ?? legacy;
}
export const webEnv = (env, legacy) => aliasValue(`web:${legacy}`, name => env[name]);
export const operationHeader = (headers, legacy = 'Keel-Operation') => aliasValue(`web:${legacy}`, name => headers.get(name));

export const operationMarker = (id, legacy = 'Keel-Operation') => `${writeName(`web:${legacy}`)}: ${id}`;
export function readOperationMarker(text, legacy = 'Keel-Operation') {
  const row = nameRow(`web:${legacy}`), values = new Map();
  for (const line of text.split('\n')) for (const name of [row.plates, row.keel]) {
    if (!line.startsWith(`${name}: `)) continue;
    if (values.has(name)) throw new WebError('duplicate_operation_marker', 400);
    values.set(name, line.slice(name.length + 2));
  }
  return aliasValue(row.id, name => values.get(name));
}
