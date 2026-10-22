// Explicit source -> count -> quote -> one send. No implicit provider polling.
import { createModelRegistry, modelEnabled } from './model-registry.mjs';
import { createModelStore } from './model-store.mjs';
import { selectModel, quoteModel } from './model-selection.mjs';
import { modelRequestInput, createModelProvider } from './model-provider.mjs';
import { validateModelCheckpoint, assertModelContinuation } from './model-checkpoint.mjs';
import { digestId } from './model-policy.mjs';
import { exact, hash, random, WebError } from './common.mjs';
const terminal = ['completed', 'failed', 'cancelled', 'incomplete', 'refused'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createModelTasks(config, { fetcher = fetch, now = Date.now } = {}) {
    const registry = createModelRegistry(config, { fetcher, now }), store = createModelStore(config, fetcher), provider = createModelProvider({ fetcher, now });
    const url = (project, id) => `/projects/${project.id}/model-tasks/${id}`;
    async function auth(access, token, project, reauthorize) { if (typeof reauthorize !== 'function')
        throw new WebError('authorization_recheck_required', 403); const a = await reauthorize(); if (a.userId !== access.userId)
        throw new WebError('access_denied', 404); registry.authorize(a, project); return a; }
    async function loaded(access, token, project, id) { registry.authorize(access, project); await registry.inspect(access, token, project); if (!digestId(id))
        throw new WebError('invalid_model_attempt', 400); const r = await store.read(id, access.userId, project); if (!r || r.conflict)
        throw new WebError('model_attempt_not_found', 404); return r.row; }
    const taskBudget = (ledger, taskId) => { const a = ledger.attempts.filter(x => x.task === taskId); return { spent: a.filter(x => x.settled).reduce((n, x) => n + x.charged, 0), held: a.filter(x => !x.settled).reduce((n, x) => n + x.charged, 0) }; };
    function selection(r, ledger, inputTokens) {
        const unresolved = new Set(ledger.attempts.filter(x => ['sending', 'uncertain'].includes(x.state)).map(x => x.connection));
        const cooldowns = ledger.cooldowns.flatMap(c => { const record = r.records.find(x => store.connectionFor(x.descriptor.id) === c.connection); return record ? [{ connectionId: record.descriptor.id, until: Date.parse(c.blocked_until), observedAt: Date.parse(c.observed_at) }] : []; });
        // No live inference observation adapter exists. All normalized claims originate
        // in the selector, and final SQL still reserves them atomically.
        if (r.observations.length)
            throw new WebError('model_observation_adapter_unsupported', 409);
        const result = selectModel({ policy: r.routing.policy, models: r.models, connections: r.records.map(c => ({ ...c.projection, enabled: c.projection.enabled && !unresolved.has(store.connectionFor(c.descriptor.id)) })), observations: r.observations, reservations: [], cooldowns, inputTokens, now: now() });
        result.rejections = result.rejections.map(x => { const candidate = r.routing.policy.candidates.find(c => c.id === x.candidateId); return candidate && unresolved.has(store.connectionFor(candidate.connectionId)) ? { ...x, code: "model_connection_uncertain" } : x; });
        return result;
    }
    function sourceFor(p) { return { repoId: p.source.repoId, repositoryNodeId: p.source.repositoryNodeId, revision: p.source.head, packetDigest: p.packet.digest, contextDigest: p.context.digest, contextState: p.context.state }; }
    function checkpoint(row, ledger) {
        const p = row.value.preview, b = taskBudget(ledger, row.task), text = row.result?.text;
        if (row.stage !== 1 || row.state !== 'completed' || typeof text !== 'string')
            throw new WebError('model_checkpoint_unavailable', 409);
        return validateModelCheckpoint({ version: 1, taskId: row.task, stage: 1, nextStage: 2, predecessor: { attemptId: row.id, responseId: row.response_id, provider: 'openai', model: p.selection.selected.model, status: 'completed' }, artifact: { hash: hash(text), text }, source: sourceFor(p), decisions: p.packet.decisions, ownership: { actor: row.actor, leaseId: row.task }, effects: [{ id: row.id, state: 'terminal', receiptHash: hash(JSON.stringify(row.result)) }], usage: { inputTokens: row.result.usage?.inputTokens ?? null, outputTokens: row.result.usage?.outputTokens ?? null, costMicroUsd: row.settled ? row.charged : null }, budget: { ceilingMicroUsd: row.value.taskAllowance, spentMicroUsd: b.spent, heldMicroUsd: b.held, remainingMicroUsd: row.value.taskAllowance - b.spent - b.held }, phaseClaim: null });
    }
    async function overview(access, token, project, { after = null } = {}) { const history = await store.list(access.userId, project, after); const r = await registry.inspect(access, token, project), catalogue = await registry.catalogue(access, token, project); return { schema: 1, project, policy: r.routing.policy, policyDigest: r.routing.digest, source: catalogue.source, capabilities: { prepare: !!r.routing.policy }, reason: r.routing.policy ? null : 'Routing policy is not configured.', gaps: [{ code: 'model_live_capacity_unavailable' }], attempts: history.rows.map(x => ({ id: x.id, taskId: x.task, stage: x.stage, state: x.state, reservedMicroUsd: x.ceiling, chargedMicroUsd: x.charged, createdAt: x.created_at, operationUrl: url(project, x.id) })), nextCursor: history.nextCursor, phases: catalogue.phases, files: catalogue.files }; }
    async function prepare(access, token, project, input) {
        const continuation = exact(input, ['taskId']) && digestId(input.taskId);
        if (!continuation && (!exact(input, ['phase', 'paths', 'instructions', 'taskId']) || input.taskId !== null))
            throw new WebError('invalid_model_preparation', 400);
        const r = await registry.inspect(access, token, project);
        if (!r.routing.policy)
            throw new WebError('model_policy_missing', 409);
        const taskId = continuation ? input.taskId : hash(random()), ledger = await store.ledger(access.userId, project, taskId, hash('none'));
        let sourceInput, predecessor = null, cp = null, stage = 1, taskAllowance = r.routing.policy.limits.taskMicroUsd;
        if (continuation) {
            const first = ledger.attempts.find(x => x.task === taskId && x.stage === 1);
            if (!first || ledger.attempts.some(x => x.task === taskId && x.stage === 2))
                throw new WebError('model_checkpoint_unavailable', 409);
            predecessor = await loaded(access, token, project, first.id);
            cp = checkpoint(predecessor, ledger);
            sourceInput = predecessor.value.preview.sourceInput;
            stage = 2;
            taskAllowance = predecessor.value.taskAllowance;
        }
        else
            sourceInput = { phase: input.phase, paths: input.paths, instructions: input.instructions };
        const packet = await registry.packet(access, token, project, sourceInput);
        if (cp) {
            const b = taskBudget(ledger, taskId);
            assertModelContinuation(cp, { taskId, source: sourceFor(packet), decisions: packet.packet.decisions, ownership: { actor: access.userId, leaseId: taskId }, ceilingMicroUsd: taskAllowance, spentMicroUsd: b.spent, heldMicroUsd: b.held, phaseClaim: null });
            if (taskAllowance > r.routing.policy.limits.taskMicroUsd)
                throw new WebError('model_policy_narrowed', 409);
        }
        const selected = selection(r, ledger, r.routing.policy.limits.maxInputTokens);
        const text = JSON.stringify({ project: { id: project.id, repoId: project.repoId }, phase: sourceInput.phase, sourceRevision: packet.source.head, sourceFiles: packet.packet.files, ownerInstructions: packet.packet.instructions, acceptedOwnerDecisions: packet.packet.decisions.ownerChoices, proposalsNotAccepted: packet.packet.decisions.suggestions, ...(cp ? { completedSummary: { hash: cp.artifact.hash, text: cp.artifact.text }, remainingGoal: 'Suggest owner next actions from the retained summary. Do not repeat the summary stage.' } : {}) });
        const request = modelRequestInput(stage, text), id = hash(random());
        const p = { schema: 1, id, taskId, stage, project, checkpoint: cp ? { predecessorId: predecessor.id, artifactHash: cp.artifact.hash, taskAllowanceMicroUsd: taskAllowance, spentMicroUsd: cp.budget.spentMicroUsd, heldMicroUsd: cp.budget.heldMicroUsd, remainingMicroUsd: cp.budget.remainingMicroUsd } : null, source: packet.source, context: packet.context, packet: packet.packet, selection: selected, outbound: { ...request, model: selected.selected?.model ?? null, provider: 'openai', retention: 'Background processing uses temporary provider retention; store:false.' }, expiresAt: new Date(now() + 900000).toISOString(), canCount: r.activation && !!selected.selected, reason: !r.activation ? 'Model routing is disabled pending activation proof.' : selected.selected ? null : 'No eligible model; inspect the selection reasons.' };
        p.digest = hash(JSON.stringify(p));
        const saved = { ...p, sourceInput, text, policyDigest: r.routing.digest, workspaceSource: r.routing.snapshot.source, taskAllowance, checkpointRecord: cp, predecessorId: predecessor?.id ?? null, actorId: access.userId };
        if (!await store.save('preview', id, access.userId, project, saved))
            throw new WebError('preview_unavailable');
        return p;
    }
    async function check(access, token, project, p, { inputTokens, reservedId = null } = {}) {
        if (p.actorId !== access.userId || p.project.repoId !== project.repoId || p.project.id !== project.id || Date.parse(p.expiresAt) <= now())
            throw new WebError('model_preview_expired', 409);
        const r = await registry.inspect(access, token, project);
        if (!r.activation)
            throw new WebError('model_routing_disabled', 403);
        if (!r.routing.policy || r.routing.digest !== p.policyDigest || !same(r.routing.snapshot.source, p.workspaceSource))
            throw new WebError('model_policy_changed', 409);
        const packet = await registry.packet(access, token, project, p.sourceInput);
        if (!same(packet.source, p.source) || packet.packet.digest !== p.packet.digest || packet.context.digest !== p.context.digest)
            throw new WebError('model_source_changed', 409);
        const ledger = await store.ledger(access.userId, project, p.taskId, hash('none'));
        if (p.stage === 2) {
            const first = await loaded(access, token, project, p.predecessorId), priorLedger = { ...ledger, attempts: ledger.attempts.filter(x => x.id !== reservedId) }, cp = checkpoint(first, priorLedger), b = taskBudget(priorLedger, p.taskId);
            if (!same(cp.artifact, p.checkpointRecord.artifact))
                throw new WebError('model_checkpoint_changed', 409);
            assertModelContinuation(p.checkpointRecord, { taskId: p.taskId, source: sourceFor(packet), decisions: packet.packet.decisions, ownership: { actor: access.userId, leaseId: p.taskId }, ceilingMicroUsd: p.taskAllowance, spentMicroUsd: b.spent, heldMicroUsd: b.held, phaseClaim: null });
        }
        const selected = selection(r, ledger, inputTokens ?? r.routing.policy.limits.maxInputTokens), old = p.selection.selected, c = selected.selected;
        if (!old || !c || !['candidateId', 'connectionId', 'model', 'connectionVersion', 'connectionPolicyDigest'].every(k => old[k] === c[k]))
            throw new WebError('model_selection_changed', 409);
        return { ...r, ledger, selected: c, connection: r.records.find(x => x.descriptor.id === c.connectionId) };
    }
    async function quote(access, token, project, input, { reauthorize } = {}) {
        if (!exact(input, ['previewId', 'digest']) || ![input.previewId, input.digest].every(digestId))
            throw new WebError('invalid_model_quote', 400);
        const p = (await store.load('preview', input.previewId, access.userId, project))?.value;
        if (!p || p.digest !== input.digest)
            throw new WebError('stale_preview', 409);
        let a = await auth(access, token, project, reauthorize), r = await check(a, token, project, p);
        const key = await registry.vault.readKey(r.connection.descriptor, { policyDigest: r.connection.policyDigest, expectedVersion: r.selected.connectionVersion });
        const counted = await provider.count({ key, scope: r.connection.descriptor.scope, model: r.selected.model, stage: p.stage, text: p.text });
        if (counted.model !== r.selected.model || counted.inputDigest !== hash(JSON.stringify(modelRequestInput(p.stage, p.text))))
            throw new WebError('model_count_mismatch', 409);
        a = await auth(access, token, project, reauthorize);
        r = await check(a, token, project, p, { inputTokens: counted.inputTokens });
        const price = r.selected.quote, b = taskBudget(r.ledger, p.taskId);
        if (price.totalMicroUsd < 1 || b.spent + b.held + price.totalMicroUsd > p.taskAllowance)
            throw new WebError('model_task_budget', 409);
        const id = hash(random()), q = { schema: 1, id, previewId: p.id, taskId: p.taskId, stage: p.stage, model: price.model, inputTokens: counted.inputTokens, maxOutputTokens: price.maxOutputTokens, ceilingMicroUsd: price.totalMicroUsd, expiresAt: new Date(Math.min(now() + 900000, Date.parse(p.expiresAt), Date.parse(price.expiresAt))).toISOString(), canRun: true, reason: null };
        q.digest = hash(JSON.stringify(q));
        if (!await store.save('quote', id, access.userId, project, { ...q, preview: p, priceDigest: price.priceDigest, actorId: access.userId }))
            throw new WebError('quote_unavailable');
        return q;
    }
    async function view(row, ledger) {
        const p = row.value.preview, b = taskBudget(ledger, row.task), remaining = row.value.taskAllowance - b.spent - b.held;
        let canContinue = false;
        if (row.state === 'completed' && row.stage === 1 && !ledger.attempts.some(a => a.task === row.task && a.stage === 2) && remaining > 0) {
            try {
                checkpoint(row, ledger);
                canContinue = true;
            }
            catch { /* A bounded artifact may remain readable but not checkpointable. */ }
        }
        return { schema: 1, id: row.id, taskId: row.task, stage: row.stage, project: row.value.project, state: row.state, model: p.selection.selected.model, reason: row.state === 'uncertain' || row.state === 'sending' ? 'The original request may have been sent. Keep its charge; do not resend.' : null, responseId: row.response_id, output: row.result?.text ?? null, usage: row.result?.usage ? { ...row.result.usage, calculatedMicroUsd: row.settled ? row.charged : null } : null, reservedMicroUsd: row.ceiling, taskAllowanceMicroUsd: row.value.taskAllowance, taskChargedMicroUsd: b.spent + b.held, predecessorId: p.predecessorId, operationUrl: url(row.value.project, row.id), capabilities: { reconcile: !!row.response_id && !terminal.includes(row.state), cancel: !!row.response_id && !terminal.includes(row.state) && !row.cancel_sent, continue: canContinue }, limitations: ['Model output is advice, not acceptance.', 'Provider capacity remains unknown unless explicitly observed.', 'No automatic polling or wall-clock cancellation is scheduled.'] };
    }
    async function receipt(access, token, project, id) { const row = await loaded(access, token, project, id); return view(row, await store.ledger(access.userId, project, row.task, row.connection)); }
    async function result(row, response) {
        const p = row.value.preview, q = row.value.quote;
        if (response.model !== q.model || response.id !== row.response_id && row.response_id !== null)
            throw new WebError('model_response_mismatch', 409);
        let actual = null;
        if (response.terminal && response.usage) {
            const u = response.usage;
            if (u.inputTokens > q.inputTokens || u.outputTokens > q.maxOutputTokens)
                throw new WebError('model_usage_exceeds_quote', 409);
            const n = BigInt(u.inputTokens) * BigInt(row.value.evidence.inputMicroUsdPerMillion) + BigInt(u.outputTokens) * BigInt(row.value.evidence.outputMicroUsdPerMillion);
            actual = Number((n + 999999n) / 1000000n);
            if (actual > row.ceiling)
                throw new WebError('model_usage_exceeds_quote', 409);
        }
        if (response.status === 'completed') {
            if (typeof response.text !== 'string' || Buffer.byteLength(response.text) > 65536)
                throw new WebError('model_artifact_limit', 409);
            const refs = response.text.match(/docs\/(?:phases|evidence|decisions)\/[A-Za-z0-9_./-]+\.md/g) ?? [];
            if (refs.some(path => !p.packet.files.some(f => f.path === path)))
                throw new WebError('model_source_reference_invalid', 409);
        }
        const record = { text: response.text ?? null, usage: response.usage, providerId: response.id, model: response.model, status: response.status };
        const updated = await store.transition('update', row, { state: response.status, responseId: response.id, result: record, actual });
        if (!updated || updated.conflict)
            throw new WebError('model_attempt_conflict', 409);
        return updated.row;
    }
    async function run(access, token, project, input, { reauthorize } = {}) {
        if (!exact(input, ['quoteId', 'digest', 'requestId']) || !Object.values(input).every(digestId))
            throw new WebError('invalid_model_run', 400);
        const existing = await store.read(input.requestId, access.userId, project);
        if (existing?.conflict)
            throw new WebError('model_attempt_conflict', 409);
        if (existing) {
            const a = await auth(access, token, project, reauthorize);
            await registry.inspect(a, token, project);
            if (existing.row.digest !== input.digest || existing.row.quote !== input.quoteId)
                throw new WebError('model_attempt_conflict', 409);
            return receipt(a, token, project, input.requestId);
        }
        const q = (await store.load('quote', input.quoteId, access.userId, project))?.value;
        if (!q || q.digest !== input.digest || Date.parse(q.expiresAt) <= now())
            throw new WebError('model_quote_expired', 409);
        const p = q.preview;
        let a = await auth(access, token, project, reauthorize), r = await check(a, token, project, p, { inputTokens: q.inputTokens });
        if (r.selected.quote.priceDigest !== q.priceDigest || r.selected.quote.totalMicroUsd !== q.ceilingMicroUsd || r.selected.model !== q.model)
            throw new WebError('model_quote_changed', 409);
        const l = r.routing.policy.limits, connection = store.connectionFor(r.selected.connectionId), fence = hash(random());
        const vaultScope = hash(JSON.stringify(['connection-vault-v1', config.appId, config.installationId, config.workspace.id, config.workspace.repoId]));
        const credential = { scope: vaultScope, connection: hash(JSON.stringify([r.connection.descriptor.id, r.connection.descriptor.secretRef])), policy: r.connection.policyDigest, version: r.selected.connectionVersion };
        const windows = r.selected.claims.filter(c => c.amount > 0).map(c => ({ pool: hash(c.poolId), amount: c.amount, available: c.remaining - Math.ceil(c.limit * r.routing.policy.capacity.reservePercent / 100), expiresAt: new Date(Math.min(Date.parse(c.resetAt), Date.parse(c.observedAt) + r.routing.policy.capacity.maxAgeSeconds * 1000)).toISOString() }));
        const value = { id: input.requestId, taskId: p.taskId, stage: p.stage, actorId: access.userId, project, digest: q.digest, preview: p, quote: q, evidence: r.models.find(m => m.model === q.model), taskAllowance: p.taskAllowance };
        const reserved = await store.reserve(input.requestId, access.userId, project, { task: p.taskId, stage: p.stage, connection, digest: q.digest, quote: q.id, fence, value, ceiling: q.ceilingMicroUsd, taskLimit: p.taskAllowance, workspaceLimit: l.workspaceMicroUsd, projectLimit: l.projectMicroUsd, connectionLimit: l.connectionMicroUsd, concurrency: l.concurrency, windows, credential });
        if (!reserved || reserved.conflict)
            throw new WebError(`model_admission_${reserved?.conflict ?? 'unavailable'}`, 409);
        let row = reserved.row;
        if (!reserved.changed)
            return receipt(a, token, project, row.id);
        let key;
        try {
            a = await auth(access, token, project, reauthorize);
            r = await check(a, token, project, p, { inputTokens: q.inputTokens, reservedId: row.id });
            if (Date.parse(q.expiresAt) <= now() || r.selected.quote.priceDigest !== q.priceDigest)
                throw new WebError('model_quote_expired', 409);
            key = await registry.vault.readKey(r.connection.descriptor, { policyDigest: r.connection.policyDigest, expectedVersion: r.selected.connectionVersion });
        }
        catch (error) {
            await store.transition('refuse', row);
            throw error;
        }
        const begun = await store.transition('begin', row);
        if (begun?.conflict === 'credential') {
            await store.transition('refuse', row);
            throw new WebError('model_connection_changed', 409);
        }
        if (!begun || begun.conflict || !begun.granted)
            throw new WebError('model_send_unconfirmed', 409);
        row = begun.row;
        try {
            const response = await provider.create({ key, scope: r.connection.descriptor.scope, model: q.model, stage: p.stage, text: p.text, maxOutputTokens: q.maxOutputTokens, store: false });
            const pinned = await store.transition('update', row, { state: 'queued', responseId: response.id, result: null, actual: null });
            if (!pinned || pinned.conflict)
                throw new WebError('model_response_pin_uncertain');
            row = pinned.row;
            row = await result(row, response);
        }
        catch (error) {
            if (error.code === 'model_provider_throttled')
                await store.cooldown(access.userId, project, connection, r.routing.policy.capacity.cooldownSeconds).catch(() => { });
            const changed = await store.transition('update', row, { state: 'uncertain', responseId: row.response_id, result: null, actual: null }).catch(() => null);
            if (changed?.row)
                row = changed.row;
        }
        a = await auth(access, token, project, reauthorize);
        await registry.inspect(a, token, project);
        return receipt(a, token, project, row.id);
    }
    async function follow(access, token, project, id, reauthorize, cancel) {
        let a = await auth(access, token, project, reauthorize), row = await loaded(a, token, project, id);
        if (terminal.includes(row.state) || !row.response_id)
            return receipt(a, token, project, id);
        const r = await registry.inspect(a, token, project), p = row.value.preview, c = r.records.find(x => x.descriptor.id === p.selection.selected.connectionId);
        if (!r.activation || !c?.projection.authorized || !c.descriptor.enabled || c.projection.version !== p.selection.selected.connectionVersion || c.policyDigest !== p.selection.selected.connectionPolicyDigest)
            throw new WebError('model_connection_changed', 409);
        const key = await registry.vault.readKey(c.descriptor, { policyDigest: c.policyDigest, expectedVersion: c.projection.version });
        if (cancel) {
            const requested = await store.transition('cancel', row);
            if (!requested || requested.conflict || !requested.granted)
                return receipt(a, token, project, id);
            row = requested.row;
        }
        try {
            const response = await provider[cancel ? 'cancel' : 'retrieve']({ key, scope: c.descriptor.scope, model: p.selection.selected.model, responseId: row.response_id });
            row = await result(row, response);
        }
        catch (e) {
            if ([401, 403, 404].includes(e.status))
                throw e; /* Original receipt and charge remain. */
        }
        a = await auth(access, token, project, reauthorize);
        await registry.inspect(a, token, project);
        return receipt(a, token, project, id);
    }
    return { overview, prepare, quote, run, receipt, reconcile: (a, t, p, id, { reauthorize } = {}) => follow(a, t, p, id, reauthorize, false), cancel: (a, t, p, id, { reauthorize } = {}) => follow(a, t, p, id, reauthorize, true) };
}
