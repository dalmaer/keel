import { createLearning } from "./learning.mjs";
import { createOperationStore } from "./operation-store.mjs";
import { hex, selectionList } from "./learning-model.mjs";
import { exact, hash, random, WebError } from "./common.mjs";

export function createExport(config, { fetcher = fetch, now = Date.now } = {}) {
  const learning = createLearning(config, { fetcher }),
    store = createOperationStore(config, fetcher);
  const scopeFor = (actor) =>
    hash(
      JSON.stringify([
        "export-v1",
        config.appId,
        config.installationId,
        config.workspace.repoId,
        config.workspace.id,
        actor,
      ]),
    );
  async function preview(access, token, input) {
    if (
      !exact(input, ["selection", "text"]) ||
      typeof input.text !== "string" ||
      Buffer.byteLength(input.text) > 65536 ||
      Buffer.from(input.text).toString("utf8") !== input.text
    )
      throw new WebError("invalid_export", 400);
    selectionList(input.selection);
    await learning.select(access, token, input.selection);
    const value = {
      schema: 1,
      kind: "export",
      id: hash(random()),
      expiresAt: new Date(now() + 900000).toISOString(),
      selection: input.selection,
      text: input.text,
      filename: "plates-reviewed-lessons.txt",
      mime: "text/plain; charset=utf-8",
    };
    value.digest = hash(JSON.stringify(value));
    if (
      !(await store.createPreview(value.id, scopeFor(access.userId), {
        ...value,
        actorId: access.userId,
      }))
    )
      throw new WebError("preview_unavailable");
    return value;
  }
  async function download(access, token, input, { reauthorize } = {}) {
    if (
      !exact(input, ["previewId", "digest"]) ||
      !hex(input.previewId) ||
      !hex(input.digest)
    )
      throw new WebError("invalid_export", 400);
    if (typeof reauthorize !== "function")
      throw new WebError("authorization_recheck_required", 403);
    const fresh = await reauthorize();
    if (fresh.userId !== access.userId)
      throw new WebError("access_denied", 404);
    const saved = await store.preview(input.previewId, scopeFor(fresh.userId));
    if (!saved || Date.parse(saved.value.expiresAt) <= now())
      throw new WebError("preview_expired", 410);
    const p = saved.value;
    if (
      p.kind !== "export" ||
      p.actorId !== fresh.userId ||
      p.digest !== input.digest
    )
      throw new WebError("stale_preview", 409);
    await learning.select(fresh, token, p.selection);
    return {
      filename: "plates-reviewed-lessons.txt",
      mime: "text/plain; charset=utf-8",
      bytes: Buffer.from(p.text, "utf8"),
    };
  }
  return { preview, download };
}
