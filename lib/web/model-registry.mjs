import { featureRestoreReady } from './recovery.mjs';
import { createModelPolicy, digestId } from './model-policy.mjs';
import { createConnectionPolicy } from './connection-policy.mjs';
import { createConnectionStore } from './connection-store.mjs';
import { createLearning, learningTransport } from './learning.mjs';
import { createDecisionGitHub, sourcePath } from './decision-github.mjs';
import { decisionContext } from '../../practices/reconciliation/files/scripts/plates/decision-context.mjs';
import { exact, hash, WebError } from './common.mjs';
const utf8 = v => new TextDecoder('utf-8', { fatal: true }).decode(v);
const eligiblePath = p => sourcePath(p) && /^docs\/(phases|evidence|decisions)\/[A-Za-z0-9_./-]+\.md$/.test(p);
export function modelEnabled(config, now = Date.now()) { const c = config.modelRouting; return c?.enabled === true && typeof c.verifiedAt === 'string' && Number.isFinite(Date.parse(c.verifiedAt)) && typeof c.restoreReconciledAt === 'string' && Number.isFinite(Date.parse(c.restoreReconciledAt)) && featureRestoreReady(config, c.restoreReconciledAt, now) && config.connections?.enabled === true && !!config.connectionEncryptionKey; }
export function createModelRegistry(config, { fetcher = fetch, now = Date.now } = {}) {
    const policy = createModelPolicy(config, { fetcher, now }), connections = createConnectionPolicy(config, { fetcher, now }), vault = createConnectionStore(config, fetcher), learning = createLearning(config, { fetcher });
    async function inspect(access, token, project) {
        learning.authorizedProject(access, project);
        const routing = await policy.read(access, token, project), c = await connections.read(access, token);
        if (c.gaps.length)
            throw new WebError('connection_source_incomplete', 409);
        const records = [];
        for (const record of c.records) {
            const descriptor = record.descriptor;
            let authorized = true;
            try {
                connections.authorize(access, descriptor);
            }
            catch {
                authorized = false;
            }
            authorized = authorized && descriptor.projects.some(p => p.id === project.id && p.repoId === project.repoId);
            const metadata = authorized ? await vault.metadata(descriptor) : null;
            records.push({ ...record, metadata, projection: { id: descriptor.id, provider: descriptor.provider, enabled: descriptor.enabled, authorized, version: metadata?.state === 'present' && metadata.policy === record.policyDigest ? metadata.version : 0, policyDigest: record.policyDigest, capacityIdentity: null } });
        }
        return { routing, records, models: config.modelRouting?.models ?? [], observations: [], activation: modelEnabled(config, now()) };
    }
    async function snapshot(access, token, project) { learning.authorizedProject(access, project); return createDecisionGitHub(token, { fetcher: learningTransport(fetcher) }).snapshot(project); }
    async function catalogue(access, token, project) {
        const s = await snapshot(access, token, project), phases = [], files = [];
        for (const [path, entry] of s.entries) {
            if (!eligiblePath(path) || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || entry.size > 32768)
                continue;
            if (files.length >= 500)
                throw new WebError('model_source_catalogue_limit', 409);
            files.push({ path, bytes: entry.size });
            const match = /^docs\/phases\/(\d+)-([a-z0-9-]+)\.md$/.exec(path);
            if (match)
                phases.push({ id: match[1], path, title: match[2].replaceAll('-', ' ') });
        }
        return { source: s.source, phases: phases.sort((a, b) => Number(a.id) - Number(b.id)), files: files.sort((a, b) => a.path.localeCompare(b.path)) };
    }
    async function packet(access, token, project, input) {
        if (!exact(input, ['phase', 'paths', 'instructions']) || typeof input.phase !== 'string' || !/^\d{1,8}$/.test(input.phase) || !Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 8 || new Set(input.paths).size !== input.paths.length || !input.paths.every(eligiblePath) || typeof input.instructions !== 'string' || Buffer.byteLength(input.instructions) > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.instructions))
            throw new WebError('invalid_model_packet', 400);
        const s = await snapshot(access, token, project), context = await decisionContext({ reader: s.reader, phase: input.phase });
        if (context.gaps.length || !['complete', 'not-configured'].includes(context.state))
            throw new WebError('decision_context_unavailable', 409);
        const phasePaths = [...s.entries.keys()].filter(p => new RegExp(`^docs/phases/0*${Number(input.phase)}-[a-z0-9-]+\\.md$`).test(p));
        if (phasePaths.length !== 1 || !input.paths.includes(phasePaths[0]) || input.paths.some(p => p.startsWith('docs/phases/') && p !== phasePaths[0]))
            throw new WebError('phase_selection_required', 400);
        let bytes = 0;
        const files = [];
        for (const path of [...input.paths].sort()) {
            const stat = await s.reader.stat(path);
            if (stat.type !== 'file' || stat.size > 32768 || bytes + stat.size > 32768)
                throw new WebError('model_packet_limit', 413);
            const raw = await s.reader.readFile(path);
            let text;
            try {
                text = utf8(raw);
            }
            catch {
                throw new WebError('model_source_utf8', 409);
            }
            bytes += raw.length;
            files.push({ path, blob: s.entries.get(path).sha, text });
        }
        // Required decision records are explicitly visible in the exact reviewed text,
        // without widening the selected source packet. Require their paths selected.
        const decisionPaths = [...new Set([...context.decisions.flatMap(d => [d.ref, ...d.chain]), ...context.proposals.flatMap(d => [d.ref, ...d.supersedes])].map(ref => ref.split('#')[0]))].filter(path => path !== phasePaths[0]);
        if (decisionPaths.some(p => !eligiblePath(p) || p.startsWith('docs/phases/') && p !== phasePaths[0]))
            throw new WebError('model_decision_source_unsupported', 409);
        if (decisionPaths.some(p => !input.paths.includes(p)))
            throw new WebError('select_required_decision_sources', 409);
        const decisions = { ownerChoices: context.decisions.map(x => JSON.stringify(x)), suggestions: context.proposals.map(x => JSON.stringify(x)) };
        const value = { files, instructions: input.instructions, phase: input.phase, decisions };
        const digest = hash(JSON.stringify(value));
        return { source: s.source, context: { state: context.state, digest: context.digest, decisions: context.decisions, proposals: context.proposals, gaps: context.gaps }, packet: { ...value, digest }, input: structuredClone(input) };
    }
    return { inspect, catalogue, packet, authorize: learning.authorizedProject, policy, vault };
}
