import { requestJson, WebError } from './common.mjs';
import { createDecisionGitHub } from './decision-github.mjs';
import { validateWalk } from './walks-model.mjs';
import { CHANGE_LIMITS, changeId, validateChange, changeModel, slotRequirements } from './changes-model.mjs';
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const denied = error => [401, 404].includes(error.status);
const gap = (source, reason) => ({ source, reason });
// Both Home and the detail reader use their existing bounded GitHub transport.
export function createChangeRevisionReader(project, repositoryNodeId, query) {
    const cache = new Map();
    return async (revision, paths = []) => {
        const key = JSON.stringify([revision, paths]);
        if (cache.has(key))
            return cache.get(key);
        if (typeof repositoryNodeId !== 'string' || !repositoryNodeId)
            throw new WebError('identity_unavailable');
        const aliases = paths.map((_, i) => `p${i}:file(path:$p${i}){oid type mode}`).join(' '), vars = Object.fromEntries(paths.map((p, i) => [`p${i}`, p]));
        const data = await query(`query ChangeRevision($id:ID!,$oid:GitObjectID!${paths.map((_, i) => `,$p${i}:String!`).join('')}){node(id:$id){... on Repository{id databaseId nameWithOwner commit:object(oid:$oid){... on Commit{oid repository{id databaseId} ${aliases}}}}}}`, { id: repositoryNodeId, oid: revision, ...vars });
        const repo = data?.node, commit = repo?.commit;
        if (repo?.id !== repositoryNodeId || repo.databaseId !== project.repoId || repo.nameWithOwner !== project.repo || commit?.oid !== revision || commit.repository?.id !== repositoryNodeId || commit.repository.databaseId !== project.repoId)
            throw new WebError('revision_unavailable');
        for (let i = 0; i < paths.length; i++) {
            const entry = commit[`p${i}`];
            if (!/^[a-f0-9]{40}$/.test(entry?.oid ?? '') || entry.type !== 'blob' || ![33188, 33261].includes(entry.mode))
                throw new WebError('source_path_unavailable');
        }
        const result = Object.fromEntries(paths.map((path, i) => [path, commit[`p${i}`]]));
        cache.set(key, result);
        return result;
    };
}
export async function inspectChange({ project, source, path, read, resolveRevision, readHistorical }) {
    const definition = validateChange(JSON.parse(await read(path)));
    if (path !== `docs/changes/${definition.id}.json`)
        throw new WebError('invalid_change_definition', 400);
    const gaps = [], verifiedRevisions = [];
    for (const revision of new Set([definition.revision, ...definition.captures.map(s => s.revision)])) {
        try {
            await resolveRevision(revision, revision === definition.revision ? definition.paths : []);
            verifiedRevisions.push(revision);
        }
        catch (error) {
            if (denied(error))
                throw error;
            gaps.push(gap('revision', `Revision ${revision} or its source paths could not be verified.`));
        }
    }
    let walk = { id: definition.walk.id, url: null, state: 'missing', reason: definition.walk.reason };
    if (definition.walk.id) {
        try {
            const w = validateWalk(JSON.parse(await read(`docs/walks/${definition.walk.id}.json`)));
            const matches = w.id === definition.walk.id && w.result.sourceRevision === definition.revision && w.result.environment === definition.availability.environment;
            const verified = verifiedRevisions.includes(definition.revision);
            walk = {
                id: definition.walk.id,
                url: matches && verified ? `/projects/${project.id}/walks/${w.id}` : null,
                state: matches && verified ? 'matching' : 'stale',
                reason: !verified ? 'The implementation revision could not be verified.'
                    : matches ? 'Source-authored walk matches this revision and environment.'
                        : 'Walk revision or environment differs from this change.'
            };
        }
        catch (error) {
            if (denied(error))
                throw error;
            walk = { id: definition.walk.id, url: null, state: 'unavailable', reason: 'The authored walk could not be read or validated.' };
        }
        if (walk.state !== 'matching')
            gaps.push(gap('walk', walk.reason));
    }
    if (definition.availability.observedRevision !== definition.revision)
        gaps.push(gap('availability', 'Source availability does not identify this implementation revision as serving.'));
    if (definition.nonvisual?.excerpt) {
        try {
            const bytes = await readHistorical(definition.revision, definition.nonvisual.path);
            if (!utf8(bytes).includes(definition.nonvisual.excerpt))
                throw Error();
        }
        catch (error) {
            if (denied(error))
                throw error;
            gaps.push(gap('nonvisual', 'Supplied excerpt could not be verified in the named source revision.'));
        }
    }
    const model = changeModel(project, source, definition, { walk, gaps, verifiedRevisions });
    if (gaps.some(g => g.source === 'nonvisual'))
        model.nonvisual = { ...model.nonvisual, excerpt: null, reason: 'Supplied excerpt could not be verified in the named source revision.' };
    return model;
}
export async function collectChanges(options) {
    const names = options.paths.filter(path => path.startsWith('docs/changes/') && path.endsWith('.json')).sort(), items = [], gaps = [];
    if (names.length > 50)
        gaps.push(gap('changes', 'Change inventory exceeds the 50-package bound.'));
    for (const path of names.slice(0, 50)) {
        try {
            if (!/^docs\/changes\/[a-z][a-z0-9-]{0,63}\.json$/.test(path))
                throw Error();
            const item = await inspectChange({ ...options, path });
            items.push(item);
            gaps.push(...item.gaps);
        }
        catch (error) {
            if (denied(error))
                throw error;
            gaps.push(gap('changes', `${path}: change package could not be read or validated.`));
        }
    }
    items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.changeId.localeCompare(b.changeId));
    return { items, gaps };
}
export function createChanges(config, { fetcher = fetch, now = Date.now } = {}) {
    async function current(project, token) {
        const signal = AbortSignal.timeout(25000);
        let calls = 0, bytes = 0, files = 0;
        const loaded = new Map();
        const transport = async (url, options = {}) => {
            if (++calls > 200 || signal.aborted)
                throw new WebError('source_limit');
            return fetcher(url, { ...options, signal: AbortSignal.any([signal, ...(options.signal ? [options.signal] : [])]) });
        };
        const provider = createDecisionGitHub(token, { fetcher: transport }), snapshot = await provider.snapshot(project);
        const read = async (path) => {
            if (loaded.has(path))
                return loaded.get(path);
            const stat = await snapshot.reader.stat(path);
            if (stat.type !== 'file' || stat.size > CHANGE_LIMITS.bytes || ++files > 180)
                throw new WebError('source_limit');
            const value = await snapshot.reader.readFile(path);
            bytes += value.length;
            if (bytes > 5 * 1024 * 1024)
                throw new WebError('source_limit');
            const decoded = utf8(value);
            loaded.set(path, decoded);
            return decoded;
        };
        const query = async (query, variables) => {
            const result = await requestJson(async (url, options) => {
                const response = await transport(url, options);
                if ([401, 404].includes(response.status)) {
                    await response.body?.cancel();
                    throw new WebError('access_denied', 404);
                }
                return response;
            }, 'https://api.github.com/graphql', { method: 'POST', signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) }, 65536);
            if (result.errors?.length)
                throw new WebError('revision_unavailable');
            return result.data;
        };
        return {
            project, source: snapshot.source, paths: [...snapshot.entries.keys()], read, resolveRevision: createChangeRevisionReader(project, snapshot.source.repositoryNodeId, query), readHistorical: async (revision, path) => {
                if (++files > 180)
                    throw new WebError('source_limit');
                const result = await provider.readResult(project, revision, path);
                bytes += result.bytes.length;
                if (bytes > 5 * 1024 * 1024)
                    throw new WebError('source_limit');
                return result.bytes;
            }
        };
    }
    return {
        async list(access, token, project) {
            const input = await current(project, token), result = await collectChanges(input);
            return { schema: 1, project, source: input.source, ...result };
        },
        async detail(access, token, project, id) {
            if (!changeId(id))
                throw new WebError('invalid_change', 400);
            const input = await current(project, token), change = await inspectChange({ ...input, path: `docs/changes/${id}.json` });
            return {
                schema: 1, project, source: input.source, change, gaps: change.gaps
            };
        },
        async captureTarget(access, token, project, id, slotId) {
            if (!changeId(id) || !changeId(slotId))
                throw new WebError('invalid_capture_target', 400);
            const input = await current(project, token), change = await inspectChange({ ...input, path: `docs/changes/${id}.json` }), slot = change.captures.find(s => s.id === slotId);
            if (!slot)
                throw new WebError('capture_target_not_found', 404);
            if (!slot.revisionVerified)
                throw new WebError('capture_revision_unavailable', 409);
            return {
                project, changeId: id, slotId, slotDigest: slot.slotDigest, sourceDigest: change.sourceDigest, source: input.source, revision: slot.revision, slot: slotRequirements(slot)
            };
        },
    };
}
