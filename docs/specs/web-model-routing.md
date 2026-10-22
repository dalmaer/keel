# Model choice and checkpoint continuation

Phase [106](../phases/106-model-routing-respects-capacity-and-policy.md), designed
2026-10-21. This extends the [fleet contract](web-fleet-operations.md),
[connections](web-connections.md) and [durable workers](web-workers.md).
It authorizes implementation, not a provider credential, data transfer, paid call,
database migration, permission expansion or production activation.

## The first executable operation

`project-evidence-brief-v1` is a tool-free planning operation: first summarize an
explicitly selected phase/evidence packet, then suggest owner next actions from
that saved summary. These are two separately reviewed stages with one task identity
and total allowance. A completed summary is reused, never regenerated during a
handoff. Output is advice, not an accepted decision, passed test, source edit or
published plan. Keep accepted owner decisions distinct from model suggestions.

Use a fixed server-side OpenAI Responses adapter for explicitly configured models
whose background, text, context and output-limit capabilities have dated evidence.
No default model or price is guessed. Candidate capability and pricing records
are operator assertions with source URLs and expiry; model-list access alone is
insufficient. Unsupported build, independent-review, routine or subscription
execution returns an explained wait. Another OpenAI model is not another provider
for an independent-review requirement. Existing robot/climb workflows keep their
own policy; this phase does not retrofit them with a dynamic model selector.

The model receives only the reviewed text packet and fixed instructions. No tools,
MCP, shell, code execution, remote images, attached URLs, automatic source fetching
or GitHub writes. No provider key enters existing Actions workers. Source text is
untrusted data; fixed instructions tell the model to analyze it, not obey it.
Render returned text escaped and validate any source reference against the packet.
A model response never becomes dispatch authority or a command.

## Private source and task identity

Private Git owns a strict, bounded `routing/workspace.json` policy and optional
`routing/projects/<project-id>.json` narrower overrides. Reuse reviewed conditional
Git delivery and original-receipt recovery. The form exposes task class, ordered
models, explicit fallback permission, destinations, capacity behavior and units,
maximum input/output and money; advanced details disclose exact source and hashes.
Do not make a JSON editor the primary setup flow. Project overrides can remove
candidates or narrow limits; they cannot broaden workspace grants or requirements.

A task pins numeric repository identity, default-branch revision, phase and source
paths/blobs, packet digest, owner instructions, accepted decisions separately from
proposals, current decision-context digest and initiating owner. Resolve decisions
from the actual source reader; a broken required reference refuses preparation.
`not-configured` stays explicit legacy coverage. The read-only adapter has no dirty
checkout or phase claim to transfer; its task-owner lease is its own authority.
An existing phase claim is context, never taken over by a model task.

Bound a packet to at most eight regular UTF-8 source files, 32 KiB total, and a
4 KiB authored instruction. No arbitrary filesystem path or cross-repository read.
Only phase/evidence/decision records within the selected authorized project can be
selected. Private workspace content needs its own explicit selection and current
intersection authorization; absent support, refuse it rather than export it.
Source visibility and exact provider destination are visible before transmission.

## Selection and capacity

Selection is deterministic under one immutable policy revision. For each approved
candidate in order, check current project grant, enabled connection and vault
generation, supported adapter/model, required capabilities/context, privacy and
billing mode, reviewer exclusions, capacity freshness, all applicable independent
limits, internal budget and cooldown. Return a reason for every rejection and the
selected model or an explained wait. Automatic fallback is opt-in. A changed
choice after review needs a new preview; a live attempt never changes its model.

Use `capacityModel` for normalization, with an additional exact verified model-
coverage check. Unknown account/workspace/pool identity cannot be replaced with a
connection label, email, key hash or guessed per-model bucket. A shared pool has
one reservation ledger across projects and duplicate connections. Do not add
percentages, tokens, money or composite limits. Expired resets require a new read.
A newer malformed or conflicting observation cannot restore older usable capacity.

**Current live scope is limited.** Metadata probes expose no usable inference
pool. This phase may retain allowlisted response limits as endpoint observations,
but cannot infer provider-wide pool identity or shared-model coverage from them.
No browser quota submission, subscription scraping, managed OAuth extraction or
unauthenticated local reporter is added. An observed-capacity policy therefore
waits unless a supported adapter supplies every required identity/coverage fact;
tests of normalized observations do not claim a live subscription reporter.

Default unknown-capacity behavior is `wait`. An owner may explicitly allow a
particular billed API candidate to run with unknown provider capacity under hard
internal token/call/money limits. Show **provider capacity unknown** beside that
choice; it is policy eligibility, not observed quota. Unknown pricing, unenforceable
bounds or revoked access always refuses. This is never implicit permission to move
subscription work to a billed API. A provider throttle blocks the affected candidate
and conservatively its connection when shared scope is unknown; do not cycle through
aliases/accounts to evade a limit. Record cooldown durably. A known reset is a time
to check again, not a promise of capacity; stale success cannot shorten cooldown.
After expiry, observed-capacity mode needs fresh post-throttle evidence and reentry
headroom. Explicit unknown-budgeted mode may offer a new reviewed attempt while
still displaying unknown capacity and retaining earlier charges; this is not an
automatic retry or a claim that provider quota recovered.

Thresholds, freshness, cooldown and reentry headroom are explicit policy values
with units and bounded integers, not invented recommendations. The policy evaluator
covers verified shared pools and denial cases; unsupported live observations stay
visible as a gap. Global internal budget still coordinates unknown-capacity calls
across all configured connections.

## Review, quote and dispatch

First show the exact outbound text, provider, model and retention behavior. The
owner's **Check cost** action authorizes only the fixed input-token counting
request for that packet/model. Counting sends data too; rendering never does it.
Then use the documented count and a dated, unexpired price record to quote the
uncached input plus the full output ceiling, with integer micro-USD rounded up.
The quote is an upper bound under that price record, not the provider's invoice.
Unknown or incompatible counts refuse. Output ceilings include reasoning tokens.
Pin exact model, input hash, token count, maximum output, quote and expiry.

The subsequent Run approval pins that quote, policy, connection generation and
source. Revalidate all of them immediately before atomically reserving and again
before the single send grant. A stale source/model/price/connection/capacity result
requires new review. Limits include a per-attempt ceiling, immutable total task
ceiling, workspace rolling-seven-day ceiling, narrower project/connection ceilings,
at most two stages, one active attempt per task/project and a configured workspace
concurrency cap. No amount is inferred from an existing runner-minute budget.

A browser-known random request identity and durable URL precede POST. Exact repeats
recover the same attempt; mismatched payload, actor or digest refuses. Persist
single-send intent before provider creation. A lost begin or create response never
permits another send. Record the returned response identity immediately; if it is
lost, report uncertainty and hold the reservation. No undocumented provider
idempotency or lookup-by-metadata guarantee is assumed.

## Provider and secret boundary

Only the server can read a current vault generation, after current owner/project,
connection policy, task policy and budget authorization. Add a narrowly scoped
service-role-only vault read bound to connection, policy digest and expected
version; authenticate/decrypt with the existing connection-vault purpose binding.
The browser, model output, existing workers and metadata endpoints cannot request
plaintext. Rotation/removal invalidates new sends, without erasing old receipts.
Sanitize upstream bodies and errors; never echo credentials or request headers.

Fixed HTTPS endpoints only: token count, Responses create, retrieve and cancel.
No redirects or arbitrary proxy URL. Bound every request and response body, validate
identifiers/fields, and keep raw model output only as encrypted private runtime
artifacts. Use `background:true`, explicit retention policy and no tools. Record
resolved response model and refuse unsupported identity changes. No mutable alias
is represented as an immutable model version; require a configured supported pin
or disclose/refuse the alias limitation before activation.

Background execution may outlive the browser and a Vercel request. Status/reconnect
reconciles the known response ID. This phase adds no scheduler and promises no
automatic wall-clock cancellation. Token/call ceilings bound the approved request;
a requested cancellation is not completion until provider terminal readback.
Document that background polling can involve temporary provider retention even
with `store:false`, and that response expiry can leave an unresolved result. A
strict no-provider-retention policy cannot silently use this adapter.

## Durable accounting and checkpoints

Migration011 adds service-only model task/attempt, quote, reservation, cooldown and
artifact records plus transactional operations. Browser roles have no direct table
or RPC access. Validate null/missing/extra fields and all external rows. Scope all
records to instance/workspace/numeric project/actor; private payloads are encrypted.
Use database locks/CAS, never an in-process mutex, for admission and one-send grants.
If an adapter ever uses a104 runner, its runner and model admission must become one
transaction before activation; this server adapter consumes no runner minutes.

Atomically reserve every applicable capacity window and money limit, or none.
Subtract held and not-yet-reflected reservations conservatively. A newer quota
snapshot alone cannot prove a prior charge is included. Unsent refusals can release
only a provably unused reservation. Unknown delivery, result or usage retains its
ceiling; leases/timeouts/reset cannot refund it. Keep measured tokens, calculated
cost and reserved ceiling distinct. Known terminal cost is charged for seven days
after its observed completion; unresolved charges remain held. Task cumulative
allowance never resets during handoff. A restore must be reconciled before sends
are reenabled; an empty restored table is not a fresh budget.

Only a provider-terminal first stage with an immutable retained artifact can form
a checkpoint. It binds completed-stage hashes, remaining goal, owner decisions and
proposals, source/context, task ownership, outstanding effects and their terminal
receipts, measured/unknown usage, retained charges, total remaining allowance and
exact next stage. Revalidate source, required decisions, current owner access and
policy before continuation. Changed required facts or uncertain effects refuse;
no implicit restart or transfer of a phase claim. Unknown cost may stay charged at
its original proven ceiling; it must never be relabeled zero.

Stage two previews its exact prompt including the saved summary, obtains its own
count/quote, and selects an eligible approved model under the original task ceiling.
Its new attempt links to the predecessor. A new review cannot silently enlarge the
original task allowance, regenerate stage one, lower capability or bypass required
review independence. Unsupported checkpoint types explain why continuation waits.

## UX and proof

Lead with the task, selected model or wait reason, and next action. Put source IDs,
policy hashes and accounting detail in disclosures. Keep money, rate limits and
subscription usage separate. Model policies link from Connections; project pages
show inherited policy and narrower overrides. A supported planning entry starts
from a real phase. Receipts preserve the original attempt on reload and across
devices; only one active set of controls remains. Replace the primary view/title/
focus when moving to a receipt. Never put keys or private packets in browser
storage, URLs, logs, public Git or screenshots of real user content.

Named tests must cover unknown and stale capacity, shared-pool races, required
review independence, provider/privacy restrictions, atomic all-window admission,
rotated/revoked credentials, source/policy changes, exact data/count/run approvals,
price expiry/rounding, response/model mismatch, one-send uncertainty, cancellation,
retained charges, cooldown and checkpoint continuity/refusal. Exercise actual
PostgreSQL role/type/CAS rules separately from transport fixtures; hosted independent
connections remain a separate activation proof. Walk authenticated desktop/mobile
routes with synthetic external transports, then an explicitly approved bounded
real provider call and stage-boundary handoff. Fixtures cannot tick the real walk.

Activation needs approved migration011, hosted concurrency/role proof, selected
provider credential and model/price evidence, exact data/retention policy and a
small monetary allowance in the existing service. No live call is approved by this
design. Future local subscription execution requires its own authenticated device
bridge, stable pool identity and supported checkpoint adapter; do not copy managed
credentials or call a metadata probe that implementation.

## Dated provider references

Inspected 2026-10-21:

- [Responses background](https://developers.openai.com/api/docs/guides/background):
  creation, polling, cancellation and retention constraints.
- [Counting tokens](https://developers.openai.com/api/docs/guides/token-counting):
  exact input count endpoint and output-token ceiling semantics.
- [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits):
  organization/project and shared-model scope; headers are not billing credits.
- [App server](https://learn.chatgpt.com/docs/app-server): future local execution
  option; not a hosted auth or enrolled reporter implementation.
