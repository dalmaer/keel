import { exact, hash, numeric, requestJson, seal, unseal, WebError } from './common.mjs';
import { digestId } from './model-policy.mjs';
const states = ['reserved', 'sending', 'uncertain', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete', 'refused'];
const integer = v => Number.isSafeInteger(v) && v >= 0;
const time = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function createModelStore(config, fetcher = fetch) {
    const scope = hash(JSON.stringify(['model-routing-v1', config.appId, config.installationId, config.workspace.id, config.workspace.repoId]));
    const projectFor = p => hash(JSON.stringify([scope, p.id, p.repoId]));
    const connectionFor = id => hash(JSON.stringify([scope, id]));
    const encrypt = (kind, id, value) => seal(value, config.encryptionKey, `${kind}:${scope}:${id}`);
    const decrypt = (kind, id, value) => unseal(value, config.encryptionKey, `${kind}:${scope}:${id}`);
    function row(v, actor, project, id) {
        if (!exact(v, ['scope', 'id', 'actor', 'project', 'task', 'stage', 'connection', 'digest', 'quote', 'fence', 'credential', 'value', 'result', 'version', 'state', 'response_id', 'settled', 'ceiling', 'charged', 'cancel_sent', 'created_at', 'terminal_at'])
            || !exact(v.credential, ['scope', 'connection', 'policy', 'version']) || ![v.credential.scope, v.credential.connection, v.credential.policy].every(digestId) || !numeric(v.credential.version) || v.credential.version > 2147483647
            || v.scope !== scope || v.id !== id || v.actor !== actor || v.project !== project || ![v.id, v.project, v.task, v.connection, v.digest, v.quote, v.fence].every(digestId)
            || ![1, 2].includes(v.stage) || !numeric(v.version) || !states.includes(v.state) || typeof v.settled !== 'boolean' || typeof v.cancel_sent !== 'boolean'
            || !numeric(v.ceiling) || !integer(v.charged) || v.charged > v.ceiling || !time(v.created_at) || !(v.terminal_at === null || time(v.terminal_at))
            || !(v.response_id === null || typeof v.response_id === 'string' && /^resp_[A-Za-z0-9_-]{1,200}$/.test(v.response_id)) || typeof v.value !== 'string' || !(v.result === null || typeof v.result === 'string'))
            throw new WebError('invalid_model_store');
        if (['completed', 'failed', 'cancelled', 'incomplete', 'refused'].includes(v.state) !== (v.terminal_at !== null) || v.state === 'completed' && (!v.result || !v.response_id))
            throw new WebError('invalid_model_store');
        const value = decrypt('model-attempt', id, v.value), result = v.result === null ? null : decrypt('model-result', id, v.result);
        if (!exact(value,['id','taskId','stage','actorId','project','digest','preview','quote','evidence','taskAllowance']) || !numeric(value.taskAllowance) || !value.project || !value.preview || !value.quote || value.quote.digest !== v.digest || value.quote.id !== v.quote || value.quote.ceilingMicroUsd !== v.ceiling || value.preview.taskId !== v.task || value.preview.stage !== v.stage || value.preview.actorId !== actor || value.preview.selection?.selected?.connectionVersion !== v.credential.version || value.preview.selection?.selected?.connectionPolicyDigest !== v.credential.policy || value.id !== id || value.taskId !== v.task || value.actorId !== actor || value.project.repoId !== config.projectRepoIds[value.project.id] || projectFor(value.project) !== project || value.stage !== v.stage || value.digest !== v.digest)
            throw new WebError('invalid_model_store');
        if (result !== null && (!exact(result,['text','usage','providerId','model','status']) || result.providerId !== v.response_id || result.model !== value.quote.model || result.status !== v.state || !(result.text === null || typeof result.text === 'string' && Buffer.byteLength(result.text) <= 65536) || result.usage !== null && (!exact(result.usage,['inputTokens','outputTokens','totalTokens']) || !Object.values(result.usage).every(integer) || result.usage.inputTokens + result.usage.outputTokens !== result.usage.totalTokens)))
            throw new WebError('invalid_model_store');
        return { ...v, value, result };
    }
    async function rpc(operation, id, actor, project, data = {}) {
        if (!digestId(id) || !numeric(actor) || !digestId(project))
            throw new WebError('invalid_model_identity', 400);
        return requestJson(fetcher, `${config.storageUrl}/rest/v1/rpc/keel_model_rpc`, { method: 'POST', headers: { apikey: config.storageKey, Authorization: `Bearer ${config.storageKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_operation: operation, p_scope: scope, p_id: id, p_actor: actor, p_project: project, p_data: data }) }, 4 * 1024 * 1024);
    }
    async function attempt(operation, id, actor, project, data = {}) {
        const value = await rpc(operation, id, actor, projectFor(project), data);
        if (value === null)
            return null;
        if (exact(value, ['conflict']) && ['identity', 'quote', 'task', 'checkpoint', 'stage', 'concurrency', 'cooldown', 'budget', 'stale-capacity', 'capacity', 'storage', 'version', 'state', 'response', 'credential', 'unresolved-connection'].includes(value.conflict))
            return value;
        if (!exact(value, ['row', 'changed', 'granted']) || typeof value.changed !== 'boolean' || typeof value.granted !== 'boolean' || value.granted && !['begin', 'cancel'].includes(operation))
            throw new WebError('invalid_model_store');
        const parsed = row(value.row, actor, projectFor(project), id);
        if (value.granted && (!value.changed || parsed.version !== data.version + 1 || operation === 'begin' && parsed.state !== 'sending' || operation === 'cancel' && (!parsed.cancel_sent || !parsed.response_id || parsed.terminal_at !== null)))
            throw new WebError('invalid_model_store');
        return { ...value, row: parsed };
    }
    async function record(operation, kind, id, actor, project, value) {
        const result = await rpc(operation, id, actor, projectFor(project), { kind, ...(value ? { value: encrypt(`model-${kind}`, id, value) } : {}) });
        if (result === null)
            return null;
        if (!exact(result, ['scope', 'id', 'actor', 'project', 'kind', 'value', 'expires_at']) || result.scope !== scope || result.id !== id || result.actor !== actor || result.project !== projectFor(project) || result.kind !== kind || typeof result.value !== 'string' || !time(result.expires_at))
            throw new WebError('invalid_model_store');
        return { value: decrypt(`model-${kind}`, id, result.value), expiresAt: result.expires_at };
    }
    return { scope, projectFor, connectionFor,
        save: (kind, id, actor, project, value) => record('record-create', kind, id, actor, project, value), load: (kind, id, actor, project) => record('record-read', kind, id, actor, project),
        read: (id, actor, project) => attempt('read', id, actor, project),
        async list(actor, project, after = null) {
            if (!(after === null || digestId(after)))
                throw new WebError('invalid_model_cursor', 400);
            const result = await rpc('list', hash('list'), actor, projectFor(project), { after });
            if (!exact(result, ['rows']) || !Array.isArray(result.rows) || result.rows.length > 21)
                throw new WebError('invalid_model_store');
            let previous = null;
            for (const r of result.rows) {
                if (!exact(r, ['id', 'task', 'stage', 'state', 'ceiling', 'charged', 'created_at']) || ![r.id, r.task].every(digestId) || previous !== null && (Date.parse(r.created_at) > Date.parse(previous.created_at) || Date.parse(r.created_at) === Date.parse(previous.created_at) && r.id >= previous.id) || ![1, 2].includes(r.stage) || !states.includes(r.state) || !numeric(r.ceiling) || !integer(r.charged) || r.charged > r.ceiling || !time(r.created_at))
                    throw new WebError('invalid_model_store');
                previous = r;
            }
            return { rows: result.rows.slice(0, 20), nextCursor: result.rows.length > 20 ? result.rows[19].id : null };
        },
        reserve: (id, actor, project, data) => attempt('reserve', id, actor, project, { ...data, value: encrypt('model-attempt', id, data.value) }),
        transition: (operation, row, data = {}) => attempt(operation, row.id, row.actor, row.value.project, { fence: row.fence, version: row.version, ...data, ...(operation === 'update' ? { result: data.result === null ? null : encrypt('model-result', row.id, data.result) } : {}) }),
        async cooldown(actor, project, connection, seconds) { const result = await rpc('cooldown', hash(connection), actor, projectFor(project), { connection, seconds }); if (!exact(result, ['recorded']) || result.recorded !== true)
            throw new WebError('invalid_model_store'); },
        async ledger(actor, project, task, connection) {
            const result = await rpc('ledger', task, actor, projectFor(project), { task, connection });
            if (!exact(result, ['attempts', 'cooldowns', 'reservations']) || !Array.isArray(result.attempts) || result.attempts.length > 5000 || !Array.isArray(result.cooldowns) || result.cooldowns.length > 1000 || !Array.isArray(result.reservations) || result.reservations.length > 80000)
                throw new WebError('invalid_model_store');
            for (const r of result.attempts)
                if (!exact(r, ['id', 'project', 'task', 'connection', 'stage', 'state', 'ceiling', 'charged', 'settled', 'terminal_at']) || ![r.id, r.project, r.task, r.connection].every(digestId) || ![1, 2].includes(r.stage) || !states.includes(r.state) || !numeric(r.ceiling) || !integer(r.charged) || r.charged > r.ceiling || typeof r.settled !== 'boolean' || !(r.terminal_at === null || time(r.terminal_at)))
                    throw new WebError('invalid_model_store');
            for (const c of result.cooldowns)
                if (!exact(c, ['scope', 'connection', 'blocked_until', 'observed_at']) || c.scope !== scope || !digestId(c.connection) || !time(c.blocked_until) || !time(c.observed_at))
                    throw new WebError('invalid_model_store');
            for (const r of result.reservations)
                if (!exact(r, ['scope', 'attempt', 'pool', 'amount']) || r.scope !== scope || ![r.attempt, r.pool].every(digestId) || !numeric(r.amount))
                    throw new WebError('invalid_model_store');
            return result;
        }
    };
}
