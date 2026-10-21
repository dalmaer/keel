import { randomBytes } from "node:crypto";
import { WebError, hash, exact } from "./common.mjs";
import { digestOf } from "../feedback.mjs";
import { validateRaster } from "./media-raster.mjs";
import { createMediaStore } from "./media-store.mjs";
import {
  createMediaObjects,
  encryptMedia,
  decryptMedia,
  mediaObjectKey,
} from "./media-object.mjs";
const validId = (id) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id);
const stableId = (id) =>
  typeof id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(id);
const text = (v, n, empty = false) =>
  typeof v === "string" &&
  (empty || v.trim()) &&
  v.length <= n &&
  !/[\x00-\x1f]/.test(v);
const integer = (n, max = 2147483646) =>
  Number.isSafeInteger(n) && n >= 0 && n <= max;
export function mediaUploadInput(input, now = Date.now) {
  if (
    !exact(input, [
      "requestId",
      "sourceDigest",
      "slotDigest",
      "expectedRevision",
      "bytes",
      "confirmed",
      "provenance",
    ]) ||
    !validId(input.requestId) ||
    !validId(input.sourceDigest) ||
    !validId(input.slotDigest) ||
    !integer(input.expectedRevision) ||
    input.confirmed !== true ||
    typeof input.bytes !== "string" ||
    input.bytes.length > 2796204 ||
    !input.bytes.length ||
    input.bytes.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.bytes)
  )
    throw new WebError("invalid_media_upload", 400);
  const p = input.provenance;
  if (
    !exact(p, [
      "revision",
      "environment",
      "viewport",
      "viewportWidth",
      "viewportHeight",
      "scenario",
      "capturedAt",
      "caption",
      "alt",
    ]) ||
    typeof p.revision !== "string" ||
    !/^[a-f0-9]{40}$/.test(p.revision) ||
    !text(p.environment, 200) ||
    !["desktop", "mobile"].includes(p.viewport) ||
    !integer(p.viewportWidth, 8192) ||
    p.viewportWidth === 0 ||
    !integer(p.viewportHeight, 8192) ||
    p.viewportHeight === 0 ||
    !text(p.scenario, 500) ||
    !text(p.caption, 1000, true) ||
    !text(p.alt, 1000) ||
    typeof p.capturedAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.capturedAt) ||
    !Number.isFinite(Date.parse(p.capturedAt)) ||
    new Date(p.capturedAt).toISOString() !== p.capturedAt ||
    Date.parse(p.capturedAt) > now() + 300000
  )
    throw new WebError("invalid_media_provenance", 400);
  const bytes = Buffer.from(input.bytes, "base64");
  if (bytes.toString("base64") !== input.bytes)
    throw new WebError("invalid_media_upload", 400);
  return { bytes, info: validateRaster(bytes) };
}
export function createMedia(
  config,
  { fetcher = fetch, now = Date.now, inspectTarget } = {},
) {
  const store = createMediaStore(config, fetcher),
    objects = createMediaObjects(config, fetcher);
  const configured = () => {
    if (!config.media) throw new WebError("media_not_configured");
  };
  function authorize(access, project) {
    if (
      !Number.isSafeInteger(access.userId) ||
      access.workspace?.id !== config.workspace.id ||
      !access.projects?.some(
        (p) =>
          p.id === project.id &&
          p.repoId === project.repoId &&
          p.repo === project.repo,
      ) ||
      !config.ownerIds.includes(access.userId) ||
      config.projectRepoIds[project.id] !== project.repoId
    )
      throw new WebError("access_denied", 404);
  }
  const objectPurpose = (project, id) =>
    `media-object:${store.scope}:${store.projectKey(project)}:${id}`;
  const key = (project, id) =>
    mediaObjectKey(store.scope, store.projectKey(project), id);
  async function read(access, project, id) {
    authorize(access, project);
    configured();
    if (!validId(id)) throw new WebError("media_not_found", 404);
    const row = await store.read(access, project, id);
    if (!row) throw new WebError("media_not_found", 404);
    return row;
  }
  const baseAvailability = (row) =>
    row.state === "deleted"
      ? "deleted"
      : ["prepared", "uploading", "uncertain"].includes(row.state)
        ? "pending"
        : ["deleting", "delete-uncertain"].includes(row.state)
          ? "pending"
          : Date.parse(row.value.expiresAt) <= now()
            ? "expired"
            : "current";
  async function view(
    access,
    project,
    row,
    availability = baseAvailability(row),
    slot = undefined,
    objectCheck = "not-checked",
  ) {
    if (slot === undefined)
      slot = await store.slot(
        access,
        project,
        row.value.changeId,
        row.value.slotId,
      );
    const v = row.value;
    return {
      schema: 1,
      id: row.id,
      projectId: project.id,
      changeId: v.changeId,
      slotId: v.slotId,
      slotDigest: v.slotDigest,
      sourceDigest: v.sourceDigest,
      source: v.source,
      revision: row.revision,
      state: row.state,
      availability,
      objectCheck,
      checkedAt:
        objectCheck === "not-checked" ? null : new Date(now()).toISOString(),
      hash: v.hash,
      mime: v.mime,
      width: v.width,
      height: v.height,
      bytes: v.bytes,
      provenance: v.provenance,
      uploaderId: v.uploaderId,
      createdAt: v.createdAt,
      expiresAt: v.expiresAt,
      attached: slot?.artifact === row.id && slot.requirements === v.slotDigest,
      attachmentRevision: slot?.revision ?? 0,
      deleteDigest: store.deleteDigest(row),
      deliveryUrl: `/api/projects/${project.id}/media/${row.id}/bytes`,
      recoveryUrl: `/projects/${project.id}/media/${row.id}`,
    };
  }
  async function verifiedBytes(project, row) {
    const cipher = await objects.read(key(project, row.id));
    if (cipher === null) return null;
    if (
      cipher.length !== row.value.cipherBytes ||
      hash(cipher) !== row.value.cipherHash
    )
      throw new WebError("media_tampered", 409);
    const bytes = decryptMedia(
      cipher,
      config.encryptionKey,
      objectPurpose(project, row.id),
    );
    if (hash(bytes) !== row.value.hash || bytes.length !== row.value.bytes)
      throw new WebError("media_tampered", 409);
    return bytes;
  }
  async function observation(project, row) {
    if (baseAvailability(row) !== "current") return baseAvailability(row);
    try {
      return (await verifiedBytes(project, row)) ? "current" : "missing";
    } catch (error) {
      return error.code === "media_tampered" ? "tampered" : "unavailable";
    }
  }
  async function target(access, token, project, changeId, slotId) {
    if (
      !stableId(changeId) ||
      !stableId(slotId) ||
      typeof inspectTarget !== "function"
    )
      throw new WebError("media_source_unavailable", 409);
    const t = await inspectTarget(access, token, project, changeId, slotId);
    if (
      t.project.repoId !== project.repoId ||
      t.project.id !== project.id ||
      t.changeId !== changeId ||
      t.slotId !== slotId ||
      !validId(t.slotDigest) ||
      !validId(t.sourceDigest) ||
      t.source.repoId !== project.repoId
    )
      throw new WebError("media_source_unavailable", 409);
    return t;
  }
  async function attachRow(
    access,
    token,
    project,
    row,
    { slotDigest, expectedRevision },
  ) {
    if (row.state !== "verified" || baseAvailability(row) === "expired")
      throw new WebError("media_not_available", 409);
    const t = await target(
      access,
      token,
      project,
      row.value.changeId,
      row.value.slotId,
    );
    if (t.slotDigest !== slotDigest || slotDigest !== row.value.slotDigest)
      throw new WebError("media_source_changed", 409);
    const slot = await store.attach(
      access,
      project,
      row,
      slotDigest,
      expectedRevision,
    );
    return view(access, project, row, undefined, slot);
  }
  async function upload(access, token, project, changeId, slotId, input) {
    authorize(access, project);
    configured();
    const { bytes, info } = mediaUploadInput(input, now);
    await objects.bucket();
    const t = await target(access, token, project, changeId, slotId),
      p = input.provenance;
    if (
      t.sourceDigest !== input.sourceDigest ||
      t.slotDigest !== input.slotDigest
    )
      throw new WebError("media_source_changed", 409);
    if (
      p.revision !== t.slot.revision ||
      p.viewport !== t.slot.viewport ||
      p.scenario !== t.slot.scenario
    )
      throw new WebError("media_provenance_mismatch", 400);
    const id = store.artifactId(access, project, input.requestId),
      inputDigest = digestOf({
        ...input,
        bytes: hash(bytes),
        changeId,
        slotId,
      }),
      nonce = randomBytes(12),
      cipher = encryptMedia(
        bytes,
        config.encryptionKey,
        objectPurpose(project, id),
        nonce,
      );
    const value = {
      id,
      inputDigest,
      requestId: input.requestId,
      projectId: project.id,
      repoId: project.repoId,
      uploaderId: access.userId,
      changeId,
      slotId,
      slotDigest: t.slotDigest,
      sourceDigest: t.sourceDigest,
      source: t.source,
      expectedRevision: input.expectedRevision,
      hash: hash(bytes),
      ...info,
      bytes: bytes.length,
      provenance: p,
      createdAt: new Date(now()).toISOString(),
      expiresAt: new Date(
        now() + config.media.retentionDays * 86400000,
      ).toISOString(),
      nonce: nonce.toString("base64"),
      cipherHash: hash(cipher),
      cipherBytes: cipher.length,
    };
    let row = await store.reserve(access, project, value);
    if (!row) throw new WebError("media_not_found", 404);
    if (row.state !== "prepared") return recover(access, token, project, id);
    const storedCipher = encryptMedia(
      bytes,
      config.encryptionKey,
      objectPurpose(project, id),
      Buffer.from(row.value.nonce, "base64"),
    );
    if (hash(storedCipher) !== row.value.cipherHash)
      throw new WebError("media_conflict", 409);
    try {
      row = await store.transition(access, project, row, "uploading");
    } catch (error) {
      if (error.code === "media_conflict")
        return recover(access, token, project, id);
      throw error;
    }
    try {
      await objects.upload(key(project, id), storedCipher);
    } catch {
      try {
        row = await store.transition(access, project, row, "uncertain");
      } catch {
        /* The durable uploading state still forbids another POST. */
      }
      return recover(access, token, project, id);
    }
    return recover(access, token, project, id);
  }
  async function recover(access, token, project, id) {
    let row = await read(access, project, id);
    await objects.bucket();
    if (["uploading", "uncertain"].includes(row.state)) {
      try {
        if (await verifiedBytes(project, row))
          row = await store.transition(access, project, row, "verified");
        else return view(access, project, row, "pending");
      } catch (error) {
        if (error.code === "media_conflict")
          row = await read(access, project, id);
        else
          return view(
            access,
            project,
            row,
            error.code === "media_tampered" ? "tampered" : "unavailable",
          );
      }
    } else if (["deleting", "delete-uncertain"].includes(row.state)) {
      try {
        if ((await objects.read(key(project, id))) === null)
          row = await store.transition(access, project, row, "deleted");
      } catch (error) {
        if (error.code === "media_conflict")
          row = await read(access, project, id);
        else return view(access, project, row, "unavailable");
      }
    }
    if (row.state === "verified")
      try {
        const availability = await observation(project, row);
        if (availability !== "current")
          return view(access, project, row, availability);
        return await attachRow(access, token, project, row, {
          slotDigest: row.value.slotDigest,
          expectedRevision: row.value.expectedRevision,
        });
      } catch (error) {
        if ([401, 404].includes(error.status)) throw error;
        return {
          ...(await view(access, project, row)),
          attachmentError: error.code ?? "media_source_unavailable",
        };
      }
    return view(access, project, row);
  }
  async function attach(access, token, project, id, input) {
    if (
      !exact(input, ["slotDigest", "expectedRevision"]) ||
      !validId(input.slotDigest) ||
      !integer(input.expectedRevision)
    )
      throw new WebError("invalid_media_attachment", 400);
    const row = await read(access, project, id);
    await objects.bucket();
    if ((await observation(project, row)) !== "current")
      throw new WebError("media_not_available", 409);
    return attachRow(access, token, project, row, input);
  }
  async function remove(access, project, id, input) {
    let row = await read(access, project, id);
    if (
      !exact(input, ["expectedRevision", "confirmDigest"]) ||
      input.expectedRevision !== row.revision ||
      input.confirmDigest !== store.deleteDigest(row)
    )
      throw new WebError("media_conflict", 409);
    await objects.bucket();
    if (row.state !== "verified") throw new WebError("media_busy", 409);
    row = await store.transition(access, project, row, "deleting");
    try {
      await objects.remove(key(project, id));
    } catch {
      /* Only an absence proof can finish deletion. */
    }
    try {
      if ((await objects.read(key(project, id))) === null)
        row = await store.transition(access, project, row, "deleted");
      else
        row = await store.transition(access, project, row, "delete-uncertain");
    } catch {
      try {
        row = await store.transition(access, project, row, "delete-uncertain");
      } catch {
        /* Durable deleting still denies delivery. */
      }
    }
    return view(access, project, row);
  }
  async function detail(access, project, id) {
    const row = await read(access, project, id);
    await objects.bucket();
    const availability = await observation(project, row);
    return view(
      access,
      project,
      row,
      availability,
      undefined,
      availability === "current"
        ? "verified"
        : ["missing", "tampered", "unavailable"].includes(availability)
          ? availability
          : "not-checked",
    );
  }
  async function byRequest(access, project, requestId) {
    if (!validId(requestId)) throw new WebError("media_not_found", 404);
    return detail(
      access,
      project,
      store.artifactId(access, project, requestId),
    );
  }
  async function deliver(access, project, id) {
    const row = await read(access, project, id);
    await objects.bucket();
    if (row.state !== "verified")
      throw new WebError("media_not_available", 409);
    if (baseAvailability(row) === "expired")
      throw new WebError("media_expired", 410);
    const bytes = await verifiedBytes(project, row);
    if (!bytes) throw new WebError("media_missing", 404);
    // Deletion reserves before its object DELETE. Do not deliver a value checked before that reservation.
    const current = await read(access, project, id);
    if (
      current.state !== "verified" ||
      current.revision !== row.revision ||
      baseAvailability(current) === "expired"
    )
      throw new WebError("media_not_available", 409);
    return { bytes, mime: row.value.mime };
  }
  async function list(access, project, { after = null, limit = 30 } = {}) {
    authorize(access, project);
    if (!config.media)
      return {
        schema: 1,
        project,
        availability: "not-configured",
        items: [],
        nextCursor: null,
      };
    if (
      (after !== null && !validId(after)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 30
    )
      throw new WebError("invalid_media_page", 400);
    await objects.bucket();
    const rows = await store.list(access, project, { after, limit: limit + 1 }),
      selected = rows.slice(0, limit),
      items = [],
      slots = await store.slots(access, project);
    for (const row of selected)
      items.push(
        await view(
          access,
          project,
          row,
          undefined,
          slots.find(
            (s) =>
              s.slot === store.slotKey(row.value.changeId, row.value.slotId),
          ) ?? null,
        ),
      );
    return {
      schema: 1,
      project,
      availability: "configured",
      items,
      nextCursor: rows.length > limit ? selected.at(-1).id : null,
    };
  }
  async function enrich(access, project, changes) {
    authorize(access, project);
    const result = structuredClone(changes),
      items = Array.isArray(result)
        ? result
        : (result.items ?? (result.change ? [result.change] : []));
    if (items.some((change) => change.projectId !== project.id))
      throw new WebError("access_denied", 404);
    const slots = items.flatMap((change) =>
      (change.captures ?? []).map((slot) => ({ change, slot })),
    );
    let stored = [],
      rows = [],
      unavailable = false,
      metadataBytes = 0;
    if (config.media)
      try {
        stored = await store.slots(access, project);
        const wanted = new Set(
            slots.map(({ change, slot }) =>
              store.slotKey(change.changeId, slot.id),
            ),
          ),
          ids = [
            ...new Set(
              stored.filter((s) => wanted.has(s.slot)).map((s) => s.artifact),
            ),
          ].slice(0, 30);
        if (ids.length) rows = await store.batch(access, project, ids);
      } catch {
        unavailable = true;
      }
    for (const { change, slot } of slots) {
      slot.attachmentRevision = 0;
      slot.capture = null;
      slot.attachmentState = config.media ? "empty" : "not-configured";
      if (!config.media) continue;
      if (unavailable) {
        slot.attachmentState = "unavailable";
        continue;
      }
      const attached = stored.find(
        (s) => s.slot === store.slotKey(change.changeId, slot.id),
      );
      if (!attached) continue;
      slot.attachmentRevision = attached.revision;
      const row = rows.find((r) => r.id === attached.artifact);
      if (!row) {
        slot.attachmentState = "unavailable";
        slot.attachmentError = "media_enrichment_limit";
        continue;
      }
      const capture = await view(access, project, row, undefined, attached);
      const size = Buffer.byteLength(JSON.stringify(capture));
      if (metadataBytes + size > 204800) {
        slot.attachmentState = "unavailable";
        slot.attachmentError = "media_enrichment_limit";
        continue;
      }
      metadataBytes += size;
      slot.capture = capture;
      slot.attachmentState =
        attached.requirements === slot.slotDigest ? "current" : "stale";
    }
    return result;
  }
  return {
    list,
    detail,
    byRequest,
    upload,
    recover,
    attach,
    remove,
    deliver,
    enrich,
  };
}
