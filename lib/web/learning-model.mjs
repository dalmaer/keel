import { exact, hash, numeric, WebError } from "./common.mjs";
import { sourcePath } from "./decision-github.mjs";
import { lessonFingerprint } from "../../practices/night/files/scripts/keel/lib.mjs";

export const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const revision = (value) =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export const lessonId = (source) =>
  `lesson-${hash(JSON.stringify([source.repoId, source.path, source.fingerprint])).slice(0, 40)}`;
export const textFields = ["shape", "cost", "guard", "where"];
export const validText = (value) =>
  typeof value === "string" && Buffer.byteLength(value) <= 8192;
export function validateLesson(value) {
  const bad = () => {
    throw new WebError("invalid_lesson", 400);
  };
  if (
    !exact(value, ["version", "id", ...textFields, "source", "imported"]) ||
    value.version !== 1 ||
    !textFields.every((key) => validText(value[key])) ||
    !value.shape.trim()
  )
    bad();
  const s = value.source,
    imported = value.imported;
  if (
    !exact(s, [
      "repoId",
      "repo",
      "path",
      "revision",
      "blob",
      "row",
      "fingerprint",
    ]) ||
    !numeric(s.repoId) ||
    typeof s.repo !== "string" ||
    !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(s.repo) ||
    s.repo.length > 200 ||
    !sourcePath(s.path) ||
    !revision(s.revision) ||
    !revision(s.blob) ||
    !numeric(s.row) ||
    s.fingerprint !==
      lessonFingerprint(s.repo, { n: s.row, shape: value.shape }) ||
    value.id !== lessonId(s)
  )
    bad();
  if (
    !exact(imported, ["actorId", "at"]) ||
    !numeric(imported.actorId) ||
    typeof imported.at !== "string" ||
    !Number.isFinite(Date.parse(imported.at)) ||
    new Date(imported.at).toISOString() !== imported.at
  )
    bad();
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) bad();
  return value;
}
export function decodeJson(bytes) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new WebError("invalid_lesson_source", 400);
  }
}
export function selectionList(selection, projectOnly = false) {
  if (!Array.isArray(selection) || selection.length < 1 || selection.length > 3)
    throw new WebError("invalid_selection", 400);
  const keys = new Set();
  for (const item of selection) {
    const project = item?.kind === "project";
    if (
      (!project && (projectOnly || item?.kind !== "shared")) ||
      !exact(
        item,
        project
          ? ["kind", "projectId", "id", "sourceDigest"]
          : ["kind", "id", "sourceDigest"],
      ) ||
      typeof item.id !== "string" ||
      !/^lesson-[a-f0-9]{40}$/.test(item.id) ||
      !hex(item.sourceDigest) ||
      (project &&
        (typeof item.projectId !== "string" ||
          !/^[a-z][a-z0-9-]{0,63}$/.test(item.projectId)))
    )
      throw new WebError("invalid_selection", 400);
    const key = `${item.kind}:${item.projectId ?? ""}:${item.id}`;
    if (keys.has(key)) throw new WebError("duplicate_selection", 400);
    keys.add(key);
  }
  return selection;
}
export function sameLesson(a, b) {
  return (
    textFields.every((key) => a[key] === b[key]) &&
    ["repoId", "repo", "path", "revision", "blob", "row", "fingerprint"].every(
      (key) => a.source[key] === b.source[key],
    )
  );
}
