# Scoped connections and capacity

Connections separates a private policy from a usable credential. Open All plates
Connections view to manage a policy; a project's Connections view shows only its
effective connections. Access is checked against current membership and numeric
repository identities. Editing a shared grant requires access to every project
in both its existing and proposed policy.

## Review the policy first

Choose a supported API provider, a display label and explicit project grants.
Optional provider organization, project or workspace IDs are owner-entered claims
until the provider can establish them. Review the exact private repository files,
source revision, project scope and commit message before approving the digest.
The server assigns an opaque secret reference. The descriptor contains no key,
key fingerprint or mutable capacity mirror.

Private policy delivery uses the existing conditional commit and durable receipt
flow. Bookmark its original receipt before submitting. A response lost after
submission is not permission to submit another commit. Inspect that same receipt;
only verified readback establishes that the policy was recorded. Project views
cannot widen grants or edit shared policy in place.

## Set or rotate a key separately

Credential forms remain unavailable until the deployment explicitly records live
provider validation and secret-store verification. Private Git writes and vault
activation are separate capabilities. A source implementation or synthetic test
is not live activation proof.

For an existing policy with verified activation, enter a key once. Plates validates
it with one fixed provider model-metadata request, then rechecks current access,
policy digest and vault version before storing authenticated ciphertext. The
input clears after submission; no existing value is redisplayed or saved in
browser storage, a URL, Git or an export. A failed rotation retains the preceding
usable version. A changed policy requires explicit validation against its new
binding.

Before sending a key or removal request, the page changes to a bookmarkable
recovery address containing only its request ID, intended version, policy digest
and action. Keep this address if the page closes or the response is lost. Opening
it reads authorized metadata; its explicit check inspects only that original
request. No key is stored in the address or resent during recovery.

After an uncertain database response, inspect the intended generation. Do not
repeat a blind set or rotate request. Version checks and a retained removal
record prevent an older validation from restoring a removed key.

**Remove key from Plates** removes the copy held by Plates. It does not delete the
provider's credential. Use the provider's separate key-management surface to
revoke it there. No generation request, workflow execution or inference spending
is part of setup, rotation or removal.

## Read validation and capacity accurately

The initial OpenAI and Anthropic adapters read only their fixed model-catalogue
endpoint. A successful response is historical metadata-access evidence, not
proof of current health, billing availability or inference entitlement. The
observed timestamp remains visible. A missing expiry does not mean evergreen
capacity.

Any applicable response-limit headers are labeled for **GET /v1/models** only.
They cannot become a model inference bar. Requests, input tokens, output tokens
and composite token limits are distinct, nonadditive observations. Truncation,
missing identity, missing windows and rounded values retain their limitations.

Subscription windows, inference allowance, actual spend and runner capacity each
show their own unavailable state until a supported source supplies them. No
hosted subscription reporter is connected in this phase. Plates does not extract
managed OAuth tokens, install a statusline or reuse the assistant application's
own usage connection as a reporting bridge.

For supported trusted observations, shared pools are deduplicated only by verified
provider/account/workspace/pool/kind/unit/window identity. Labels and key hashes
do not establish that identity. Conflicting readings stay conflicts; expired
readings require a fresh observation and never refill themselves at reset.

## Deployment and proof

This guide describes the phase 103 source implementation. Its deployment and live
provider exercise remain separate evidence. All credential mutations default to
disabled. Activation requires owner approval for the selected provider, the
service-role-only vault migration, production wrapping-key injection and actual
provider/store validation. The vault wrapping key is separate from the session
encryption key. No paid upgrade, provider Admin key or inference probe is needed.

Application code remains in the public repository. Only nonsecret connection
policies belong in the private workspace repository. Encrypted provider keys live
in the external runtime database; its wrapping key lives in the production
secret store. Never paste a key into a policy, task record, screenshot or evidence
file. Record outcomes and safe timestamps, not credential material.

See the [connection contract](../specs/web-connections.md),
[phase status](../phases/103-connections-expose-scoped-model-capacity.md) and
[authentication setup](web-auth-service.md). Browser and synthetic adapter checks
cannot establish an owner's real credential injection, permissions or quota.
