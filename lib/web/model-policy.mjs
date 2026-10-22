// Private routing policy. Source declarations authorize no provider request by themselves.
import { createConnectionPolicy } from './connection-policy.mjs';
import { createLearning } from './learning.mjs';
import { createOperationStore } from './operation-store.mjs';
import { exact, hash, numeric, projectId, random, WebError } from './common.mjs';
const integer = (v, a, b) => Number.isSafeInteger(v) && v >= a && v <= b;
export const modelId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v);
export const digestId = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function validateModelPolicy(value, project = false) {
    const fields = ['version', 'enabled', 'taskClass', 'adapter', 'automaticFallback', 'candidates', 'requirements', 'limits', 'capacity'];
    if (project)
        fields.push('projectId', 'repoId');
    const fail = () => { throw new WebError('invalid_model_policy', 400); };
    if (!exact(value, fields) || value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.automaticFallback !== 'boolean'
        || !['planning', 'review', 'build', 'routine'].includes(value.taskClass) || value.adapter !== 'project-evidence-brief-v1'
        || project && (!projectId(value.projectId) || !numeric(value.repoId)) || !Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > 8)
        fail();
    const ids = new Set();
    for (const c of value.candidates) {
        if (!exact(c, ['id', 'connectionId', 'model', 'unknownCapacity']) || !projectId(c.id) || ids.has(c.id) || !projectId(c.connectionId) || !modelId(c.model) || !['wait', 'allow-budgeted'].includes(c.unknownCapacity))
            fail();
        ids.add(c.id);
    }
    const r = value.requirements, l = value.limits, c = value.capacity;
    if (!exact(r, ['minimumContext', 'privacy', 'independentReview']) || !integer(r.minimumContext, 1, 2000000) || !['allow-temporary-provider-retention', 'no-provider-retention'].includes(r.privacy) || typeof r.independentReview !== 'boolean')
        fail();
    if (!exact(l, ['maxInputTokens', 'maxOutputTokens', 'attemptMicroUsd', 'taskMicroUsd', 'workspaceMicroUsd', 'projectMicroUsd', 'connectionMicroUsd', 'concurrency'])
        || !integer(l.maxInputTokens, 1, 2000000) || !integer(l.maxOutputTokens, 1, 100000) || !integer(l.concurrency, 1, 20)
        || !['attemptMicroUsd', 'taskMicroUsd', 'workspaceMicroUsd', 'projectMicroUsd', 'connectionMicroUsd'].every(k => integer(l[k], 1, 1000000000000))
        || l.attemptMicroUsd > l.taskMicroUsd || l.taskMicroUsd > l.projectMicroUsd || l.projectMicroUsd > l.workspaceMicroUsd || l.attemptMicroUsd > l.connectionMicroUsd)
        fail();
    if (!exact(c, ['maxAgeSeconds', 'reservePercent', 'cooldownSeconds', 'reentryPercent']) || !integer(c.maxAgeSeconds, 1, 86400) || !integer(c.reservePercent, 0, 99) || !integer(c.reentryPercent, c.reservePercent, 99) || !integer(c.cooldownSeconds, 1, 86400))
        fail();
    return structuredClone(value);
}
export function narrowModelPolicy(base, override) {
    if (!override)
        return base;
    validateModelPolicy(base);
    validateModelPolicy(override, true);
    if (override.enabled && !base.enabled || override.automaticFallback && !base.automaticFallback || override.taskClass !== base.taskClass || override.adapter !== base.adapter
        || override.requirements.minimumContext < base.requirements.minimumContext || base.requirements.independentReview && !override.requirements.independentReview
        || base.requirements.privacy === 'no-provider-retention' && override.requirements.privacy !== 'no-provider-retention'
        || Object.keys(base.limits).some(k => override.limits[k] > base.limits[k])
        || override.capacity.maxAgeSeconds > base.capacity.maxAgeSeconds || ['reservePercent', 'cooldownSeconds', 'reentryPercent'].some(k => override.capacity[k] < base.capacity[k]))
        throw new WebError('routing_override_widens', 409);
    let position = -1;
    for (const candidate of override.candidates) {
        const i = base.candidates.findIndex(c => c.id === candidate.id);
        const original = base.candidates[i];
        if (i <= position || !original || original.model !== candidate.model || original.connectionId !== candidate.connectionId || original.unknownCapacity === 'wait' && candidate.unknownCapacity !== 'wait')
            throw new WebError('routing_override_widens', 409);
        position = i;
    }
    return override;
}
export function createModelPolicy(config, { fetcher = fetch, now = Date.now } = {}) {
    const learning = createLearning(config, { fetcher }), store = createOperationStore(config, fetcher);
    const domain = ['model-policy-v1', config.appId, config.installationId, config.workspace.id, config.workspace.repoId];
    const scope = actor => hash(JSON.stringify([...domain, actor])), projectKey = hash(JSON.stringify(domain));
    async function read(access, token, project = null) {
        if (project)
            learning.authorizedProject(access, project);
        const workspace = await learning.workspace(access, token), { reader } = workspace.snapshot;
        async function record(path, isProject) {
            let bytes;
            try {
                bytes = await reader.readFile(path);
            }
            catch (e) {
                if (e.code === 'ENOENT')
                    return null;
                throw e;
            }
            if (bytes.length > 32768)
                throw new WebError('routing_source_limit', 409);
            let content, policy;
            try {
                content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                policy = validateModelPolicy(JSON.parse(content), isProject);
            }
            catch {
                throw new WebError('invalid_model_policy', 409);
            }
            return { path, content, policy, digest: hash(content), blob: workspace.snapshot.entries.get(path).sha };
        }
        const base = await record('routing/workspace.json', false), override = project ? await record(`routing/projects/${project.id}.json`, true) : null;
        if (override && (override.policy.projectId !== project.id || override.policy.repoId !== project.repoId))
            throw new WebError('routing_project_changed', 409);
        if (override && !base)
            throw new WebError('routing_workspace_missing', 409);
        return { ...workspace, base, override, policy: base ? narrowModelPolicy(base.policy, override?.policy) : null, digest: hash(JSON.stringify([base?.digest ?? null, override?.digest ?? null])) };
    }
    async function overview(access, token, project = null) { const r = await read(access, token, project), cp = createConnectionPolicy(config, { fetcher, now }), cr = await cp.read(access, token); const choices = cr.records.filter(x => { try {
        cp.authorize(access, x.descriptor);
        return !project || x.descriptor.projects.some(p => p.id === project.id && p.repoId === project.repoId);
    }
    catch {
        return false;
    } }).map(x => ({ id: x.descriptor.id, label: x.descriptor.label, provider: x.descriptor.provider, enabled: x.descriptor.enabled, projects: x.descriptor.projects })); return { schema: 1, project, policy: r.policy, policyDigest: r.digest, expectedPolicyDigest: (project ? r.override : r.base)?.digest ?? null, source: r.snapshot.source, records: [r.base, r.override].filter(Boolean), inherited: !!project && !r.override, models: config.modelRouting?.models ?? [], connections: choices, connectionGaps: cr.gaps, capabilities: { policyWrite: config.workspaceWrites === true && access.contentsPermission === 'write' && r.snapshot.canWrite }, reason: r.policy ? null : 'Routing policy is not configured.' }; }
    async function planned(access, token, input) {
        if (!exact(input, ['projectId', 'policy', 'expectedPolicyDigest']) || !(input.projectId === null || projectId(input.projectId)) || !(input.expectedPolicyDigest === null || digestId(input.expectedPolicyDigest)))
            throw new WebError('invalid_policy_preview', 400);
        const project = input.projectId === null ? null : access.projects.find(p => p.id === input.projectId);
        if (input.projectId && !project)
            throw new WebError('access_denied', 404);
        const r = await read(access, token, project), policy = validateModelPolicy(input.policy, !!project), old = project ? r.override : r.base;
        if ((old?.digest ?? null) !== input.expectedPolicyDigest)
            throw new WebError('stale_policy', 409);
        if (project) {
            if (policy.projectId !== project.id || policy.repoId !== project.repoId)
                throw new WebError('routing_project_changed', 409);
            if (!r.base)
                throw new WebError('routing_workspace_missing', 409);
            narrowModelPolicy(r.base.policy, policy);
        }
        const content = JSON.stringify(policy, null, 2) + '\n', path = project ? `routing/projects/${project.id}.json` : 'routing/workspace.json';
        if (content === old?.content)
            throw new WebError('policy_unchanged', 409);
        return { ...r, project, files: [{ path, before: old?.content ?? null, content, originalBlob: old?.blob ?? null }] };
    }
    const allowed = (access, r) => config.workspaceWrites === true && access.contentsPermission === 'write' && r.snapshot.canWrite;
    async function preview(access, token, input) {
        const r = await planned(access, token, input), id = hash(random()), operationId = hash(random());
        const p = { schema: 1, id, operationId, operationUrl: `/model-policy/operations/${operationId}`, source: r.snapshot.source, files: r.files, project: r.project, commitMessage: `Update Plates model routing policy\n\nKeel-Operation: ${operationId}`, expiresAt: new Date(now() + 900000).toISOString(), canApply: allowed(access, r) };
        p.digest = hash(JSON.stringify(p));
        if (!await store.createPreview(id, scope(access.userId), { ...p, input, actorId: access.userId }))
            throw new WebError('preview_unavailable');
        return p;
    }
    const view = row => ({ schema: 1, id: row.id, state: row.state, reason: row.value.reason ?? null, receipt: row.value.receipt ?? null, operationUrl: `/model-policy/operations/${row.id}` });
    async function fresh(access, token, reauthorize, project) { if (typeof reauthorize !== 'function')
        throw new WebError('authorization_recheck_required', 403); const a = await reauthorize(); if (a.userId !== access.userId)
        throw new WebError('access_denied', 404); await learning.workspace(a, token); if (project)
        learning.authorizedProject(a, project); return a; }
    async function loaded(access, token, id) { if (!digestId(id))
        throw new WebError('invalid_operation', 400); await learning.workspace(access, token); const row = await store.read(id, scope(access.userId)); if (!row || row.value.kind !== 'model-policy')
        throw new WebError('operation_not_found', 404); if (row.value.project)
        learning.authorizedProject(access, row.value.project); return row; }
    async function apply(access, token, id, { digest, reauthorize } = {}) {
        if (!digestId(id) || !digestId(digest))
            throw new WebError('invalid_preview', 400);
        const p = (await store.preview(id, scope(access.userId)))?.value;
        if (!p || p.digest !== digest || p.actorId !== access.userId || Date.parse(p.expiresAt) <= now())
            throw new WebError('stale_preview', 409);
        let a = await fresh(access, token, reauthorize, p.project), r = await planned(a, token, p.input);
        if (!allowed(a, r))
            throw new WebError('submission_disabled', 403);
        if (JSON.stringify(r.files) !== JSON.stringify(p.files) || JSON.stringify(r.snapshot.source) !== JSON.stringify(p.source))
            throw new WebError('stale_preview', 409);
        const fence = hash(random()), intent = { id: p.operationId, repo: r.repository.repo, ...p.source, files: p.files.map(({ path, content, originalBlob }) => ({ path, content, originalBlob })), commitMessage: p.commitMessage, marker: `Keel-Operation: ${p.operationId}` };
        let value = { kind: 'model-policy', project: p.project, fence, intent, reason: null, receipt: null };
        let row = await store.reserve(p.operationId, scope(access.userId), projectKey, id, fence, value);
        if (!row || row.conflict)
            throw new WebError('operation_conflict', 409);
        if (row.created) {
            try {
                a = await fresh(access, token, reauthorize, p.project);
                r = await planned(a, token, p.input);
                if (!allowed(a, r) || JSON.stringify(r.files) !== JSON.stringify(p.files) || JSON.stringify(r.snapshot.source) !== JSON.stringify(p.source) || Date.parse(p.expiresAt) <= now())
                    throw new WebError('stale_preview', 409);
                await r.provider.recheck(r.repository, p.source);
            }
            catch (e) {
                await store.transition('refused', p.operationId, scope(access.userId), fence, { ...value, reason: 'Fresh policy validation refused.' });
                throw e;
            }
            row = await store.transition('dispatched', p.operationId, scope(access.userId), fence);
            if (!row)
                throw new WebError('operation_conflict', 409);
            try {
                const commit = await r.provider.dispatch(intent), receipt = await r.provider.recover(intent, commit);
                if (!receipt)
                    throw new WebError('remote_uncertain');
                row = await store.transition('committed', p.operationId, scope(access.userId), fence, { ...value, receipt }) ?? row;
            }
            catch {
                row = await store.transition('uncertain', p.operationId, scope(access.userId), fence, { ...value, reason: 'Check this original receipt; do not resubmit.' }) ?? row;
            }
        }
        await fresh(access, token, reauthorize, p.project);
        return view(row);
    }
    async function recover(access, token, id, { reauthorize } = {}) { const a = await fresh(access, token, reauthorize, null); let row = await loaded(a, token, id); if (['dispatched', 'uncertain'].includes(row.state)) {
        const r = await learning.workspace(a, token);
        try {
            const receipt = await r.provider.recover(row.value.intent);
            if (receipt)
                row = await store.transition('committed', id, scope(a.userId), row.value.fence, { ...row.value, receipt, reason: null }) ?? row;
        }
        catch (e) {
            if ([401, 404].includes(e.status))
                throw e;
        }
    } await fresh(access, token, reauthorize, row.value.project); return view(row); }
    return { read, overview, preview, apply, operation: async (...args) => view(await loaded(...args)), recover };
}
