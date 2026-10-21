import { createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

export class WebError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
export const deny = () => { throw new WebError('access_denied', 404); };
export const random = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length <= 4096 && b.length <= 4096
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const numeric = value => Number.isSafeInteger(value) && value > 0;
export const record = value => value && typeof value === 'object' && !Array.isArray(value);
export const exact = (value, fields) => record(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
export const projectId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export function seal(value, key, purpose) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
}
export function unseal(value, key, purpose) {
  try {
    const [iv, tag, data, extra] = value.split('.');
    if (extra !== undefined) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8'));
  } catch { throw new WebError('invalid_stored_record'); }
}
export async function boundedJson(response, limit = 2 * 1024 * 1024) {
  if (!response.ok) { await response.body?.cancel(); throw new WebError('upstream_unavailable'); }
  const reader = response.body?.getReader();
  if (!reader) throw new WebError('upstream_unavailable');
  let length = 0; const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) throw new WebError('upstream_limit'); chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new WebError('upstream_unavailable'); }
  finally { await reader.cancel().catch(() => {}); }
}
export async function requestJson(fetcher, url, options = {}, limit) {
  try {
    return await boundedJson(await fetcher(url, { ...options, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) }), limit);
  } catch (error) { if (error instanceof WebError) throw error; throw new WebError('upstream_unavailable'); }
}
