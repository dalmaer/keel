// Source-authored change packages are declarations, never acceptance or serving proof.
import { fields, digestOf, safeLink } from '../feedback.mjs';
import { WebError } from './common.mjs';
export const CHANGE_LIMITS = Object.freeze({ packages: 50, bytes: 131072, slots: 12, paths: 8 });
export const changeId = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const text = (x, max = 2000) => typeof x === 'string' && x.trim() && x.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);
const path = x => typeof x === 'string' && x.length <= 500 && /^[A-Za-z0-9_. /-]+$/.test(x) && x.split('/').every(p => p && p !== '.' && p !== '..') && !x.startsWith('.');
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const stamp = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === (x.includes('.') ? x : x.replace('Z', '.000Z'));
export function validateChange(value) {
    try {
        fields(value, ['version', 'id', 'title', 'outcome', 'kind', 'publishedAt', 'revision', 'paths', 'pr', 'availability', 'preview', 'explore', 'walk', 'captures', 'nonvisual']);
        if (Buffer.byteLength(JSON.stringify(value)) > CHANGE_LIMITS.bytes || value.version !== 1 || !changeId(value.id) || !text(value.title, 180) || !text(value.outcome) || !['ui', 'nonvisual'].includes(value.kind) || !date(value.publishedAt) || !sha(value.revision))
            throw Error();
        if (!Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 8 || !value.paths.every(path) || new Set(value.paths).size !== value.paths.length || !(value.pr === null || Number.isSafeInteger(value.pr) && value.pr > 0))
            throw Error();
        const a = value.availability;
        fields(a, ['state', 'environment', 'observedAt', 'observedRevision', 'reason']);
        if (!['source-only', 'preview', 'awaiting-deploy', 'serving', 'verified'].includes(a.state) || !text(a.environment, 200) || !stamp(a.observedAt) || !(a.observedRevision === null || sha(a.observedRevision)) || !text(a.reason))
            throw Error();
        const p = value.preview;
        fields(p, ['url', 'reason']);
        if (!(p.url === null || safeLink(p.url)) || !(p.reason === null || text(p.reason)) || p.url === null && !text(p.reason))
            throw Error();
        if (!Array.isArray(value.explore) || value.explore.length < 1 || value.explore.length > 8 || !value.explore.every(x => text(x, 1000)))
            throw Error();
        const w = value.walk;
        fields(w, ['id', 'reason']);
        if (!(w.id === null || changeId(w.id)) || !(w.reason === null || text(w.reason)) || w.id === null && !text(w.reason))
            throw Error();
        if (!Array.isArray(value.captures) || value.captures.length > 12 || new Set(value.captures.map(s => s.id)).size !== value.captures.length)
            throw Error();
        for (const s of value.captures) {
            fields(s, ['id', 'role', 'revision', 'viewport', 'scenario', 'reason']);
            if (!changeId(s.id) || !['before', 'after'].includes(s.role) || !sha(s.revision) || s.role === 'after' && s.revision !== value.revision || !['desktop', 'mobile'].includes(s.viewport) || !text(s.scenario, 500) || !text(s.reason))
                throw Error();
        }
        if (value.kind === 'ui') {
            if (value.nonvisual !== null || !['desktop', 'mobile'].every(v => value.captures.some(s => s.viewport === v && s.role === 'after')))
                throw Error();
        }
        else {
            const n = value.nonvisual;
            fields(n, ['path', 'excerpt', 'reason']);
            if (!(n.path === null || path(n.path)) || !(n.excerpt === null || text(n.excerpt, 4000)) || !(n.reason === null || text(n.reason)) || !(n.path && n.excerpt) && !text(n.reason) || !!n.path !== !!n.excerpt || n.path && !value.paths.includes(n.path))
                throw Error();
        }
        return structuredClone(value);
    }
    catch {
        throw new WebError('invalid_change_definition', 400);
    }
}
export const slotRequirements = slot => Object.fromEntries(['id', 'role', 'revision', 'viewport', 'scenario'].map(key => [key, slot[key]]));
export const slotDigest = (project, id, slot) => digestOf([project.repoId, id, slotRequirements(slot)]);
export const sourceLink = (project, revision, path) => `https://github.com/${project.repo}/blob/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
export function changeModel(project, source, definition, { walk, gaps = [], verifiedRevisions = [] } = {}) {
    const d = definition, sourceDigest = digestOf({ source, definition: d }), detailUrl = `/projects/${project.id}/changes/${d.id}`;
    const captures = d.captures.map(s => ({
        ...s, slotDigest: slotDigest(project, d.id, s), sourceDigest, revisionVerified: verifiedRevisions.includes(s.revision), attachmentRevision: 0, capture: null
    }));
    const comparisons = captures.filter(s => s.role === 'before').flatMap(before => captures.filter(after => after.role === 'after' && after.viewport === before.viewport && after.scenario === before.scenario).map(after => ({ before: before.id, after: after.id, viewport: before.viewport, scenario: before.scenario })));
    return {
        id: `${project.id}:change:${d.id}`, changeId: d.id,
        projectId: project.id, projectName: project.name ?? project.id,
        title: d.title, outcome: d.outcome, kind: 'change', changeKind: d.kind,
        date: d.publishedAt, publishedAt: d.publishedAt, revision: d.revision,
        expectedSourceVersion: source.head, link: detailUrl, detailUrl,
        sourceUrl: sourceLink(project, source.head, `docs/changes/${d.id}.json`),
        commitUrl: `https://github.com/${project.repo}/commit/${d.revision}`,
        prUrl: d.pr ? `https://github.com/${project.repo}/pull/${d.pr}` : null,
        paths: d.paths.map(path => ({ path, url: sourceLink(project, d.revision, path) })),
        source, sourceDigest,
        availability: { ...d.availability, attribution: 'source-declaration', matchesRevision: d.availability.observedRevision === d.revision },
        preview: d.preview, previewUrl: d.preview.url, explore: d.explore,
        walk: walk ?? { id: d.walk.id, url: null, state: d.walk.id ? 'unavailable' : 'missing', reason: d.walk.reason ?? 'Matching walk has not been verified.' },
        captures, comparisons, nonvisual: d.nonvisual,
        media: null, acceptance: 'not established', gaps
    };
}
