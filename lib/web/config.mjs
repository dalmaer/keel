import { webEnv } from './name-transition.mjs';
import { validateModelEvidence } from './model-selection.mjs';
import { exact, numeric, projectId, record, WebError } from './common.mjs';

// Only explicit instance bindings; never discover a checkout, fleet or home directory.
export function webConfig(value, secrets) {
  const invalid = () => { throw new WebError('invalid_service_configuration'); };
  const fields = ['version', 'origin', 'ownerIds', 'appId', 'clientId', 'installationId', 'workspace', 'projectRepoIds'];
  if (Object.hasOwn(value ?? {}, 'recovery')) {
    fields.push('recovery');
    const recovery = value.recovery;
    const past = v => typeof v === 'string' && Number.isFinite(Date.parse(v))
      && new Date(v).toISOString() === v && Date.parse(v) <= Date.now();
    if (!exact(recovery, ['epoch', 'startedAt', 'reconciledAt'])
      || typeof recovery.epoch !== 'string' || !/^[a-f0-9]{32}$/.test(recovery.epoch)
      || !past(recovery.startedAt)
      || !(recovery.reconciledAt === null || past(recovery.reconciledAt)
        && Date.parse(recovery.reconciledAt) >= Date.parse(recovery.startedAt))) invalid();
  }
  if (Object.hasOwn(value ?? {}, 'drafts')) {
    fields.push('drafts');const d=value.drafts;
    if(!exact(d,['enabled','verifiedAt'])||typeof d.enabled!=='boolean'||!(d.verifiedAt===null||typeof d.verifiedAt==='string'&&Number.isFinite(Date.parse(d.verifiedAt))&&new Date(d.verifiedAt).toISOString()===d.verifiedAt&&Date.parse(d.verifiedAt)<=Date.now())||d.enabled&&!d.verifiedAt)invalid();
  }
  if (Object.hasOwn(value ?? {}, 'nightOperations')) {
    fields.push('nightOperations');
    const night = value.nightOperations;
    const proof = v => v === null || typeof v === 'string' && Number.isFinite(Date.parse(v))
      && new Date(v).toISOString() === v && Date.parse(v) <= Date.now();
    if (!exact(night, ['retryEnabled', 'planWrites', 'verifiedAt', 'restoreReconciledAt', 'profiles'])
      || typeof night.retryEnabled !== 'boolean' || typeof night.planWrites !== 'boolean'
      || !proof(night.verifiedAt) || !proof(night.restoreReconciledAt)
      || !Array.isArray(night.profiles) || night.profiles.length > 100
      || !night.profiles.every(projectId) || new Set(night.profiles).size !== night.profiles.length
      || (night.retryEnabled || night.planWrites) && (!night.verifiedAt || !night.restoreReconciledAt)) invalid();
  }
  if (Object.hasOwn(value ?? {}, 'modelRouting')) {
    fields.push('modelRouting');
    const routing=value.modelRouting;
    const proof=v=>v===null||typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v&&Date.parse(v)<=Date.now();
    if (!exact(routing,['enabled','verifiedAt','restoreReconciledAt','models']) || typeof routing.enabled!=='boolean'
      || !proof(routing.verifiedAt) || !proof(routing.restoreReconciledAt) || !Array.isArray(routing.models) || routing.models.length>100
      || new Set(routing.models.map(m=>m?.model)).size!==routing.models.length) invalid();
    try { for(const model of routing.models) validateModelEvidence(model,{allowExpired:true}); } catch { invalid(); }
    if(routing.enabled&&(!routing.verifiedAt||!routing.restoreReconciledAt||!routing.models.length)) invalid();
  }
  if (Object.hasOwn(value ?? {}, 'media')) {
    fields.push('media');const m=value.media;
    if(!exact(m,['bucket','retentionDays','capacityBytes'])||typeof m.bucket!=='string'||!/^[a-z][a-z0-9-]{0,62}$/.test(m.bucket)||!Number.isInteger(m.retentionDays)||m.retentionDays<1||m.retentionDays>365||!Number.isSafeInteger(m.capacityBytes)||m.capacityBytes<1||m.capacityBytes>268435456)invalid();
  }
  if (Object.hasOwn(value ?? {}, 'connections')) {
    fields.push('connections');
    const c = value.connections;
    const date = v => v === null || typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
    if (!exact(c,['enabled','vaultVerifiedAt','providers']) || typeof c.enabled !== 'boolean' || !date(c.vaultVerifiedAt)
      || !exact(c.providers,['openai','anthropic']) || !Object.values(c.providers).every(date)) invalid();
  }
  if (Object.hasOwn(value ?? {}, 'fleetUpdates')) {
    fields.push('fleetUpdates');
    const f = value.fleetUpdates, t = f?.target;
    if (!exact(f,['enabled','publishEnabled','target']) || typeof f.enabled !== 'boolean' || typeof f.publishEnabled !== 'boolean'
      || !exact(t,['repoId','repositoryNodeId','repo','commit','cliVersion','practiceVersion','bundleDigest'])
      || !numeric(t.repoId) || typeof t.repositoryNodeId !== 'string' || !/^[!-~]{1,200}$/.test(t.repositoryNodeId)
      || typeof t.repo !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]{1,100}$/.test(t.repo)
      || !/^[a-f0-9]{40}$/.test(t.commit ?? '') || !/^[a-f0-9]{64}$/.test(t.bundleDigest ?? '')
      || ![t.cliVersion,t.practiceVersion].every(v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v))) invalid();
  }
  if(Object.hasOwn(value ?? {},'jobs')) {
    fields.push('jobs');
    const jobs=value.jobs;
    const proof=value=>value===null||typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value));
    if(!exact(jobs,['enabled','verifiedAt','restoreReconciledAt','weeklyMinutes','scheduleWrites'])
      ||typeof jobs.enabled!=='boolean'||typeof jobs.scheduleWrites!=='boolean'
      ||!proof(jobs.verifiedAt)||!proof(jobs.restoreReconciledAt)
      ||!Number.isSafeInteger(jobs.weeklyMinutes)||jobs.weeklyMinutes<1||jobs.weeklyMinutes>10080)invalid();
  }
  if (Object.hasOwn(value ?? {}, 'workspaceWrites')) fields.push('workspaceWrites');
  if (value?.workspaceWrites !== undefined && typeof value.workspaceWrites !== 'boolean') invalid();
  if (Object.hasOwn(value ?? {}, 'decisionWrites')) fields.push('decisionWrites');
  if (value?.decisionWrites !== undefined && typeof value.decisionWrites !== 'boolean') invalid();
  if (!exact(value, fields) || value.version !== 1) invalid();
  let origin;
  try { origin = new URL(value.origin); } catch { invalid(); }
  if (origin.protocol !== 'https:' || origin.origin !== value.origin || origin.username || origin.password) invalid();
  if (!Array.isArray(value.ownerIds) || !value.ownerIds.length || value.ownerIds.length > 20 || !value.ownerIds.every(numeric)
    || new Set(value.ownerIds).size !== value.ownerIds.length || !numeric(value.appId) || !numeric(value.installationId)
    || typeof value.clientId !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value.clientId)) invalid();
  if (!exact(value.workspace, ['id', 'repoId', 'manifestPath', 'membersPath']) || !projectId(value.workspace.id) || !numeric(value.workspace.repoId)) invalid();
  for (const path of [value.workspace.manifestPath, value.workspace.membersPath]) {
    if (typeof path !== 'string' || path.length > 200 || !path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !['.', '..'].includes(part))) invalid();
  }
  if (value.workspace.manifestPath === value.workspace.membersPath || !record(value.projectRepoIds) || Object.keys(value.projectRepoIds).length > 100
    || !Object.entries(value.projectRepoIds).every(([id, repo]) => projectId(id) && numeric(repo))
    || new Set(Object.values(value.projectRepoIds)).size !== Object.keys(value.projectRepoIds).length
    || Object.values(value.projectRepoIds).includes(value.workspace.repoId)) invalid();
  if (value.nightOperations?.profiles.some(id => !Object.hasOwn(value.projectRepoIds, id))) invalid();
  if (!record(secrets) || typeof secrets.clientSecret !== 'string' || secrets.clientSecret.length < 16 || secrets.clientSecret.length > 512
    || typeof secrets.storageKey !== 'string' || secrets.storageKey.length < 16 || secrets.storageKey.length > 4096
    || typeof secrets.encryptionKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secrets.encryptionKey)) invalid();
  if (secrets.connectionEncryptionKey !== undefined && (typeof secrets.connectionEncryptionKey !== 'string'
    || !/^[A-Za-z0-9+/]{43}=$/.test(secrets.connectionEncryptionKey) || Buffer.from(secrets.connectionEncryptionKey,'base64').length !== 32 || Buffer.from(secrets.connectionEncryptionKey,'base64').equals(Buffer.from(secrets.encryptionKey,'base64')))) invalid();
  if (value.connections?.enabled && !secrets.connectionEncryptionKey) invalid();
  if (value.modelRouting?.enabled && (!value.connections?.enabled || !value.connections?.vaultVerifiedAt || !value.connections?.providers?.openai || !secrets.connectionEncryptionKey)) invalid();
  let storage;
  try { storage = new URL(secrets.storageUrl); } catch { invalid(); }
  if (storage.protocol !== 'https:' || storage.origin !== secrets.storageUrl || !storage.hostname.endsWith('.supabase.co') || storage.username || storage.password) invalid();
  return { ...structuredClone(value), ...secrets, encryptionKey: Buffer.from(secrets.encryptionKey, 'base64'), connectionEncryptionKey: secrets.connectionEncryptionKey ? Buffer.from(secrets.connectionEncryptionKey,'base64') : undefined };
}
export function configFromEnv(env = process.env) {
  // Preview builds must never accidentally become another production credential endpoint.
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') throw new WebError('preview_not_configured');
  const rawConfig = webEnv(env, 'KEEL_WEB_CONFIG');
  let value; try { value = JSON.parse(rawConfig); } catch { throw new WebError('invalid_service_configuration'); }
  return webConfig(value, { clientSecret: webEnv(env, 'KEEL_GITHUB_CLIENT_SECRET'), storageUrl: env.SUPABASE_URL,
    storageKey: env.SUPABASE_SERVICE_ROLE_KEY, encryptionKey: webEnv(env, 'KEEL_SESSION_ENCRYPTION_KEY'),
    connectionEncryptionKey: webEnv(env, 'KEEL_CONNECTION_ENCRYPTION_KEY'),
    deploymentRevision: typeof env.VERCEL_GIT_COMMIT_SHA === 'string' && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA) ? env.VERCEL_GIT_COMMIT_SHA : null });
}

export function requireRuntime(version = process.versions.node) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (![major, minor, patch].every(value => Number.isSafeInteger(value) && value >= 0) || major < 24 || (major === 24 && (minor < 22 || (minor === 22 && patch < 1)))) throw new WebError('unsupported_runtime');
}
