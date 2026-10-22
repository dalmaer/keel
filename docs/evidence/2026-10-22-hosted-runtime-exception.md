# Temporary hosted runtime exception

On 2026-10-22 the owner explicitly accepted the remaining runtime risk to finish
the Plates rollout while Vercel's managed Node patch rollout was incomplete.
This is an exception, not evidence that Node 24.21.0 is patched or safe.

The official Vercel advisory describes an inbound WAF mitigation that does not
cover malicious responses fetched by an application. Node 24.22.1 is the patched
24.x baseline. A new protected function at 16:33 UTC still reported 24.21.0 through
two uncached request-time observations. Local and CI Node requirements remain
24.22.1 or later; no package engine, local startup guard, or workflow pin changes.

## Scope

Only the Vercel HTTP entry point calls `requireHostedRuntime`. The exception needs
all three deployment environment values, and exactly runtime `24.21.0`:

- `VERCEL=1`
- `VERCEL_ENV=production`
- `PLATES_HOSTED_RUNTIME_EXCEPTION=node-24.21.0-until-vercel-patched`

Set the opt-in only on the explicitly approved application deployment, not as a
shared project or local environment default. No request, cookie, query, or stored
workspace record can enable it. Missing/wrong values keep the normal refusal.
Preview/development deployments cannot opt in. The normal configuration checks,
preview isolation, authentication, exact origin/CSRF checks, permission scopes,
recovery quarantine and feature activation gates remain in force.

## Removal

As soon as a fresh protected Vercel function verifies a runtime meeting the normal
patched baseline, remove the opt-in from the replacement production deployment
and remove this branch of `requireHostedRuntime` through normal review. Verify
the exact serving revision and actual function runtime, plus sign-in and access
checks, after promotion. Preserve this dated exception record as history.
Patched runtimes already pass without the opt-in. There is no automatic renewal
or expansion to another old version. Continued use after patch availability
does not follow this approval. Do not set a silent clock-based shutdown that
could take production offline while the provider is still rolling out.

## Verification boundary

Tests cover the exact version/environment matrix and confirm strict local and
configuration boundaries. The focused test first failed with
`unsupported_runtime` before the exception branch was added. A protected preview
can exercise a synthetic production context with no real credentials; it is not
proof of live production configuration because previews intentionally refuse
that configuration. Actual hosted startup and live acceptance must be recorded
after the reviewed deployment, with the verified prior deployment retained for
rollback. Do not use a production-target diagnostic as a non-promoted preview:
the earlier attempt unexpectedly reassigned the secondary platform alias.

Sources: [Vercel advisory](https://vercel.com/kb/bulletin/node-js-security-advisory),
[Node 24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1).
