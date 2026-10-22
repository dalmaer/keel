import { requireRuntime } from './config.mjs';

// Only the Vercel entry point uses this boundary. Local/CLI startup stays strict.
export function requireHostedRuntime(env = process.env, version = process.versions.node) {
  // Temporary owner-approved exception, 2026-10-22. Remove when a fresh Vercel
  // function meets the patched baseline; this is not a claim that WAF patches Node.
  // Explicit deployment opt-in, exact version, and production Vercel only.
  // See docs/evidence/2026-10-22-hosted-runtime-exception.md.
  if (version === '24.21.0' && env.VERCEL === '1' && env.VERCEL_ENV === 'production'
    && env.PLATES_HOSTED_RUNTIME_EXCEPTION === 'node-24.21.0-until-vercel-patched') return;
  requireRuntime(version);
}
