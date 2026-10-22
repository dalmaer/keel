# Choose a model for project planning

Model planning turns explicitly selected project records into an evidence summary,
then separately reviewed suggestions for next actions. It does not edit source,
accept a phase, execute commands or publish a plan. Build, independent review,
routine execution and subscription execution remain unsupported by this adapter.
The implementation is disabled until the operator completes the activation proof;
shipping the UI does not enable provider calls.

## Set a private policy

Open **Connections → Model policy**. The workspace policy lives in the private
workspace repository at `routing/workspace.json`. A project may inherit it or use
`routing/projects/<project-id>.json` to narrow its candidates and limits. An override
cannot add a provider destination, broaden an allowance or relax a requirement.

The form names the preferred connection/model and ordered approved alternatives.
Automatic alternatives are opt-in. Choose whether each API candidate waits for
verified capacity or may use explicitly bounded billed API work while provider
capacity is unknown. Review the task requirements, temporary provider retention,
input/output ceilings, attempt/task allowances, rolling seven-day allowances and
concurrency. Capacity age, protected reserve, cooldown and reentry headroom are
explicit values; Plates does not invent them. Monetary policy fields use integer
micro-USD: 1,000,000 equals $1 USD. Preview the exact private files and commit before
saving. Saving policy does not send project text or start a model.

A model-list validation is historical metadata access, not available inference
quota. Subscription allowance, API rate limits, money and runner minutes remain
separate. Current metadata probes supply no usable inference pool. An observed-
capacity policy therefore waits without a supported reporter. Missing readings
never become zero usage or a full allowance. An explicitly allowed billed API
candidate still says **provider capacity unknown**.

## Review the packet, check cost, then run

From a project, open **Plan from evidence** and select a real phase. Choose up to
eight source files, including the phase, from its phase/evidence/decision records
(32 KiB total), and add instructions (up to 4 KiB). No arbitrary filesystem or
cross-repository path is read. Required linked decisions outside `docs/phases/`,
`docs/evidence/` or `docs/decisions/` are unsupported by this adapter; preparation
explains the gap rather than exporting an inventory or adding hidden sources.
Required owner decisions are resolved separately from proposals; legacy decision coverage remains explicit when not configured.

Review the exact fixed instructions, text packet, source visibility, provider,
model and retention behavior. **Check cost sends that text to the provider** for
input-token counting; it does not generate a response. Reading the page does
neither. A supported, unexpired model/price record converts the count plus the full
output ceiling into an upper-bound quote. Output limits include reasoning tokens.
The quote is not an invoice.

Review the quote and explicitly approve **Run this stage**. Plates rechecks source,
policy, connection generation, model evidence and allowance. A change requires new
review. The attempt pins one model. Its receipt URL exists before submission: keep
it if the response is lost. Do not create a replacement request because a browser
failed to receive a response. Opening the receipt reads stored state; **Check
original attempt** explicitly reads the known provider response without sending
another generation request. Previous attempts are listed newest first by request
creation time, in bounded pages.

The provider runs with fixed instructions, no tools, no shell, no automatic source
fetching and no GitHub writes. Source text is untrusted data. Returned text is
rendered as text and remains advice. Background execution may temporarily retain
data at the provider even with `store:false`; a strict no-retention policy cannot
use this adapter. Closing the browser does not cancel work. Cancellation remains a
request until provider terminal evidence confirms it; no automatic wall-clock
cancellation or scheduler is promised.

## Continue from saved work

A completed first-stage summary can support **Review suggested next actions**.
Plates retains the summary and original task allowance. The second stage reviews its
exact prompt, obtains a fresh count/quote and needs a separate Run approval. It
links to the completed summary attempt; there is no live model swap or repeated
first stage. Changed required source, decisions, ownership or uncertain effects
prevent continuation.

Receipts distinguish measured tokens, calculated cost and reserved ceiling. An
unknown result or usage keeps its ceiling held; timeout, lease expiry and reset do
not refund it. A completed known charge remains in rolling accounting for seven
days after observed completion. The task's cumulative ceiling never resets at a
handoff. After a throttle, show the waiting period. Once it ends, observed-capacity
mode still needs fresh evidence; explicit unknown-capacity API mode may allow a
new review under retained charges, without claiming quota has recovered.

## Operator setup and activation boundary

This feature extends the [authentication service](web-auth-service.md) and
[scoped connections](web-connections.md). Provider keys stay in the private vault;
they never enter Git, browser storage, packets, URLs, logs or existing Actions
workers. Runtime records and response artifacts are encrypted in the private
service store. Browser roles have no table/RPC access.

Optional instance configuration starts off:

```json
{
  "modelRouting": {
    "enabled": false,
    "verifiedAt": null,
    "restoreReconciledAt": null,
    "models": []
  }
}
```

Configured model evidence must explicitly name the supported immutable model,
context/output limits, uncached input and output prices in micro-USD per million
tokens, an official source URL, observation/expiry dates, and verified text,
background and counting capabilities. No model or price is assumed. Expired or
malformed evidence refuses activation/use; a model catalogue alone is insufficient.

Before enabling, obtain owner approval for migration 011, prove hosted independent-
connection admission/concurrency and service-role restrictions, verify the separate
vault binding, reconcile prior stored work after any restore, and record dated
provider/model/price evidence. Approve the exact data/retention policy and a small
monetary allowance for the real exercise. Activation flags are operator assertions
of that evidence, not substitutes for it. A synthetic browser demonstration does
not prove live entitlement, actual cost or owner acceptance.

See the [model-routing contract](../specs/web-model-routing.md) for exact protocol
bounds and the pending live run/checkpoint proof. This phase adds no subscription
scraping, copied managed credentials or paid fallback by default.

## Restore and reconnect trial

After a configured workspace restore, new runs and checkpoint continuations
require a model restore assertion at or after `recovery.startedAt` and completed
global reconciliation. Disabling execution does not block current-authorized
readback of an original known response ID; current credential/policy checks still
apply. An unknown response ID remains uncertain and charged, without a resend.
See the [fleet trial worksheet](web-fleet-trial.md) for real device and recovery
observations, including terminal detours and unavailable costs.
