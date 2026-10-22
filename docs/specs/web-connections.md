# Scoped connections and model capacity

Phase [103](../phases/103-connections-expose-scoped-model-capacity.md), designed
2026-10-21. This is the implementation contract, not approval to activate a
secret store, connect a provider or spend on inference.

## What the owner sees

Workspace and project Connections show configured accounts, effective project
access, key validation, capacity observations and their gaps. Creating a
connection first previews its nonsecret policy in the private workspace repo.
After that policy is committed and read back, the owner can set a key once.
Rotation replaces a key with a version check. “Remove key from Plates” removes
the copy held by Plates; it does not delete the provider's key. Link to provider key
management for that separate action. No form redisplays an existing key.

Subscription windows, API rate limits, billing/spend and runner availability
are separate groups. Missing capacity says unavailable, never a full bar.
Each reading shows its source, scope, observation time, expiry and model
coverage. One verified shared pool appears once, with links from its models.
Conflicting readings remain a conflict; unrelated units are never added.

Project views cannot broaden a grant. Connections granted to other projects
are not exposed. Editing a shared connection policy requires current access to
every project named by its existing and proposed policy; the project view links
to that workspace management flow rather than silently editing a shared grant.

## Dated provider capability matrix

Sources inspected on 2026-10-21. Documentation establishes an API contract;
live verification remains a separate activation requirement.

| Connection | Initial read | Meaning and limitations |
| --- | --- | --- |
| OpenAI API key | Fixed `GET https://api.openai.com/v1/models`, with optional explicit organization/project headers | Metadata access only; not proof of generation entitlement, billing health or remaining inference capacity. Bearer credential stays server-side. [API overview](https://developers.openai.com/api/reference/overview) |
| OpenAI API limits | Allowlisted applicable response headers | Request and token limits have organization/project and shared-model scope. A model-list response is not a measurement of each model's inference allowance. Preserve the observed endpoint scope; do not invent model coverage. [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits) |
| Anthropic API key | Fixed `GET https://api.anthropic.com/v1/models`, required version header and explicit workspace scope where supported | Metadata validation only. Preserve authoritative workspace identity when returned; an owner-entered label is not that identity. [API overview](https://platform.claude.com/docs/en/api/overview) |
| Anthropic API limits | Allowlisted applicable response headers | Requests, input tokens and output tokens stay distinct. Rounded readings retain that limitation. A most-restrictive token reading is not another additive pool. [Rate limits](https://platform.claude.com/docs/en/api/rate-limits) |
| Anthropic organization limits and cost | Not enabled | Configured limit groups require an Admin credential and do not establish remaining quota. Historical usage/cost is not subscription capacity. No Admin credential is requested by this phase. [Limits API](https://platform.claude.com/docs/en/manage-claude/rate-limits-api), [usage and cost](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) |
| Codex subscription | Future approved local reporter | Local `account/rateLimits/read` supports a pool map and window durations. Prefer that map over its legacy duplicate. Do not assume primary means five hours. Local app-server authentication is not a hosted-service auth mechanism; never copy managed OAuth credentials into Plates. Account labels/email do not establish a stable pool identity. [App server](https://learn.chatgpt.com/docs/app-server) |
| Claude subscription | Future approved local reporter | Statusline input can supply five-hour/seven-day usage and reset observations after a response. Windows may independently be absent or expired. No auth-token extraction or automatic statusline installation. [Statusline](https://code.claude.com/docs/en/statusline) |

The initial web adapter performs no generation request to discover quota.
Unknown account identity or pool coverage stays unknown. No arbitrary provider
URL, generic HTTP proxy, provider Admin key, or browser-submitted capacity
observation is accepted. Local reporting needs phase104's authenticated transport;
the app's own connected usage tool is not that transport.

## Storage and source authority

Private Git owns `connections/<id>.json`: a bounded, exact-schema descriptor
with provider type, display label, opaque secret reference, explicit project
IDs plus numeric repository IDs, enabled state and optional provider scope.
Provider scope entered by an owner is labeled as a claim until the adapter can
verify it. The descriptor never contains a key, a key fingerprint, raw provider
response or a mutable usage mirror. Maximum 50 descriptors, 16 KiB each and
256 KiB total. Duplicate IDs/references and malformed or incomplete listings
refuse mutation and remain coverage gaps.

The selected optional secret store is an encrypted vault in the existing
private runtime database. Vercel injects a separate 32-byte
`PLATES_CONNECTION_ENCRYPTION_KEY` (the old `KEEL_CONNECTION_ENCRYPTION_KEY` is
accepted only when the canonical key is absent); the session key is not reused. This deliberately
extends the workspace's initial storage division: the deployment store owns the
wrapping key, while the external runtime owns authenticated ciphertext. Keys
never enter Git, frontend bundles, URLs, browser storage, logs or exports.
The vault accepts no arbitrary environment-variable names.

Migration008 creates a service-role-only transactional adapter; anonymous and
authenticated client roles have no table or RPC access. Bind each encrypted
record to this workspace, connection identity, policy digest and key generation.
Metadata and vault versions have strict bounds. Use database compare-and-swap,
not a process-local lock, for installation, replacement and removal. Removal
retains a nonsecret tombstone/version so an older validation cannot restore a
revoked key. No plaintext secret is placed in an operation receipt.

## Two separate mutations

1. **Policy:** preview exact private Git changes, current source and project
   scope; apply only the reviewed digest through conditional Git writes and
   durable receipts. Recheck access and source before dispatch. After an
   uncertain response, recover the original operation; never create a second
   commit automatically. Reuse the established Git/operation adapters, with a
   distinct connection domain. Create the policy before requesting a secret.
2. **Credential:** for an existing policy, validate the supplied key through the
   documented fixed metadata endpoint, then recheck membership, exact policy
   digest and projects before a versioned vault write. A changed policy renders
   the old vault binding unusable; explicit key validation against the new
   policy is required. Failed rotation retains the preceding version. Uncertain
   database completion is reconciled by reading the intended generation, not by
   repeating a blind write. Removal needs the same current authorization and
   expected version; it does not require a successful provider call.

Credential probes allow one bounded request, at most 1 MiB and eight seconds,
no redirects or arbitrary endpoints. Model metadata is truncated with explicit
coverage, not silently complete. Reject malformed identity fields and unknown
input fields. Error details are fixed codes; discard upstream bodies on errors.
Validation results allowlist only safe fields and never echo a submitted key.
The browser clears secret inputs after submission and never caches their value.

No execution API receives a credential in this phase. Later workers must
revalidate the same current policy, project intersection, vault generation and
provider budget before use; a successful metadata probe grants no spend.

## Capacity contract

Normalize observations into provider, authoritative account/workspace identity
when known, pool identity and provenance, kind, units, model coverage and its
provenance, measured used/remaining/limit, window/reset, observedAt, expiresAt,
source and confidence. Validate numeric ranges, timestamps and required fields.
Invalid or incomplete observations cannot become eligible capacity.

Capacity identity explicitly distinguishes `account`, `workspace` and `unknown`
scope. A missing workspace identifier alone never proves an account-wide pool.
Unknown scope stays separate and ineligible. A newer malformed observation must
invalidate earlier usable evidence in its attributable scope; an unassignable
malformed read makes its batch unavailable rather than restoring stale allowance.

Deduplicate only an established provider/account/workspace/pool/kind/unit/window
tuple; serialize tuples unambiguously. Unknown identities stay separate, not
grouped by labels, emails or key hashes. Conflicting simultaneous observations
produce an explicit conflict. Do not combine a composite limit with its inputs.
Use actual reported window duration. Expired readings never refresh themselves
at reset; a fresh observation is required. Provider documentation does not make
a synthetic example or an owner-entered number authoritative.

## Activation and proof

Without explicit configuration, connection reads explain unsupported setup and
all credential mutations are disabled. Per-provider activation requires a dated
live validation and secret-store injection/role/concurrency proof before a
credential form is enabled. Configuration is an operator assertion of that
proof, not a substitute for recording it. Required approvals: migration008 and
wrapping-key binding in existing approved services, current App Contents-write
for private policy edits, and the chosen provider credentials. No paid upgrade,
Admin access, inference request or workflow execution is part of activation.

Named tests cover final authorization changes, CSRF/origin checks, source
conflicts, uncertain commit recovery, absent storage, secret reflection and
malformed responses, redirected/oversized/timed-out probes, CAS rotation/removal
races, scope changes and revocation. Capacity tests cover missing and expired
windows, pool aliasing, conflicting observations and distinct units. Run the
actual authenticated routes in desktop/mobile browser layouts, including an
unavailable provider and denied project. Execute the SQL against PostgreSQL;
isolated SQL does not claim hosted concurrency or owner acceptance.
