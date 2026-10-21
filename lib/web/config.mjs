import { exact, numeric, projectId, record, WebError } from './common.mjs';

// Only explicit instance bindings; never discover a checkout, fleet or home directory.
export function webConfig(value, secrets) {
  const invalid = () => { throw new WebError('invalid_service_configuration'); };
  const fields = ['version', 'origin', 'ownerIds', 'appId', 'clientId', 'installationId', 'workspace', 'projectRepoIds'];
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
  if (!record(secrets) || typeof secrets.clientSecret !== 'string' || secrets.clientSecret.length < 16 || secrets.clientSecret.length > 512
    || typeof secrets.storageKey !== 'string' || secrets.storageKey.length < 16 || secrets.storageKey.length > 4096
    || typeof secrets.encryptionKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secrets.encryptionKey)) invalid();
  if (secrets.connectionEncryptionKey !== undefined && (typeof secrets.connectionEncryptionKey !== 'string'
    || !/^[A-Za-z0-9+/]{43}=$/.test(secrets.connectionEncryptionKey) || Buffer.from(secrets.connectionEncryptionKey,'base64').length !== 32 || Buffer.from(secrets.connectionEncryptionKey,'base64').equals(Buffer.from(secrets.encryptionKey,'base64')))) invalid();
  if (value.connections?.enabled && !secrets.connectionEncryptionKey) invalid();
  let storage;
  try { storage = new URL(secrets.storageUrl); } catch { invalid(); }
  if (storage.protocol !== 'https:' || storage.origin !== secrets.storageUrl || !storage.hostname.endsWith('.supabase.co') || storage.username || storage.password) invalid();
  return { ...structuredClone(value), ...secrets, encryptionKey: Buffer.from(secrets.encryptionKey, 'base64'), connectionEncryptionKey: secrets.connectionEncryptionKey ? Buffer.from(secrets.connectionEncryptionKey,'base64') : undefined };
}
export function configFromEnv(env = process.env) {
  // Preview builds must never accidentally become another production credential endpoint.
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') throw new WebError('preview_not_configured');
  let value; try { value = JSON.parse(env.KEEL_WEB_CONFIG); } catch { throw new WebError('invalid_service_configuration'); }
  return webConfig(value, { clientSecret: env.KEEL_GITHUB_CLIENT_SECRET, storageUrl: env.SUPABASE_URL,
    storageKey: env.SUPABASE_SERVICE_ROLE_KEY, encryptionKey: env.KEEL_SESSION_ENCRYPTION_KEY, connectionEncryptionKey: env.KEEL_CONNECTION_ENCRYPTION_KEY });
}

export function requireRuntime(version = process.versions.node) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (![major, minor, patch].every(value => Number.isSafeInteger(value) && value >= 0) || major < 24 || (major === 24 && (minor < 22 || (minor === 22 && patch < 1)))) throw new WebError('unsupported_runtime');
}
