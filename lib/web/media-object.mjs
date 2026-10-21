import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requestJson, hash, WebError } from "./common.mjs";
export function encryptMedia(bytes, key, purpose, nonce = randomBytes(12)) {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([
    Buffer.from("KEELM1"),
    nonce,
    cipher.getAuthTag(),
    data,
  ]);
}
export function decryptMedia(bytes, key, purpose) {
  try {
    if (bytes.length < 34 || bytes.subarray(0, 6).toString() !== "KEELM1")
      throw Error();
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(6, 18));
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(bytes.subarray(18, 34));
    return Buffer.concat([cipher.update(bytes.subarray(34)), cipher.final()]);
  } catch {
    throw new WebError("media_tampered", 409);
  }
}
async function bounded(response, limit) {
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new WebError("media_unavailable");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new WebError("media_tampered", 409);
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function createMediaObjects(config, fetcher = fetch) {
  const base = `${config.storageUrl}/storage/v1`,
    headers = {
      apikey: config.storageKey,
      Authorization: `Bearer ${config.storageKey}`,
    };
  async function bucket() {
    if (!config.media) throw new WebError("media_not_configured", 503);
    const b = await requestJson(
      fetcher,
      `${base}/bucket/${config.media.bucket}`,
      { headers },
      65536,
    );
    if (
      b.id !== config.media.bucket ||
      b.name !== config.media.bucket ||
      b.public !== false
    )
      throw new WebError("media_bucket_not_private", 503);
  }
  async function call(path, options = {}) {
    try {
      return await fetcher(`${base}${path}`, {
        ...options,
        headers: { ...headers, ...options.headers },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new WebError("media_unavailable");
    }
  }
  const objectPath = (key) => `/object/${config.media.bucket}/${key}`;
  return {
    bucket,
    async upload(key, bytes) {
      const r = await call(objectPath(key), {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-upsert": "false",
          "Cache-Control": "no-store",
        },
        body: bytes,
      });
      await r.body?.cancel();
      if (!r.ok) throw new WebError("media_unavailable");
    },
    async read(key) {
      const r = await call(objectPath(key), { method: "GET" });
      if (r.status === 404) {
        // A gateway/authentication 404 is not an object-absence proof.
        let error;
        try {
          error = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              await bounded(r, 16384),
            ),
          );
        } catch {
          throw new WebError("media_unavailable");
        }
        if (
          error?.code === "NoSuchKey" ||
          error?.error === "NoSuchKey" ||
          (error?.error === "not_found" &&
            error?.message === "Object not found")
        )
          return null;
        throw new WebError("media_unavailable");
      }
      if (!r.ok) {
        await r.body?.cancel();
        throw new WebError("media_unavailable");
      }
      return bounded(r, 4194304);
    },
    async remove(key) {
      const r = await call(`/object/${config.media.bucket}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }),
      });
      await r.body?.cancel();
      if (!r.ok) throw new WebError("media_unavailable");
    },
  };
}
export const mediaObjectKey = (scope, project, id) =>
  hash(JSON.stringify([scope, project, id])) + ".enc";
