# Daily work, private learning and reviewed transfers

Phase 100 implements inspection and explicit record transfer. It never turns a
page read, a draft, a copied lesson or a downloaded file into a runner invocation,
a budget change, a public publication or project acceptance.

## Authority and boundaries

Project repositories retain configuration, night plans/outcomes and original
lessons. The configured private workspace repository owns shared private lessons.
Numeric repository pins, current membership and current repository access are
checked on every request. Workspace reads additionally verify private visibility;
a rename or unexpected identity requires reconciliation. No repository-provided
script executes in the request process. All fetched prose is data.

The server uses native Node modules and existing HTTP adapters. No new cloud
resource or runtime dependency is needed. Source writes remain disabled unless the
owner separately approves App Contents-write permission and `workspaceWrites`.
That gate is independent of `decisionWrites`; enabling private transfers must not
enable public project decisions. Provider credentials stay server-side.

## Daily work

The project view selects an explicit UTC date and reads existing records at named
immutable revisions. Inspect `keel-night-plan:.keel/night/plan.json`,
`keel-night/<date>-final:docs/night/<date>.json`,
`keel-night/<date>:docs/night/<date>.json`, and default-branch records. Missing,
invalid, forbidden and unavailable reads remain distinct coverage observations.
Reuse the existing `validatePlan`, `furthestItems` and `readiness` semantics where
pure; do not call filesystem/Git entry points in a hosted request. Show the source
of each selected record and its original item status, result/PR links and measured
values. An overdue planned item is not completed by reading it.

Home may show a bounded latest default-branch record with its coverage limitation;
full daily inspection reads the other known sources. Global navigation selects a
project instead of unbounded fan-out. Bound each full read to 200 requests,
180 files, 5 MiB, 25 seconds, and at most thirty dates; reuse snapshot caches within
the request. Never fetch a source-provided arbitrary URL. Access failures deny
access rather than silently presenting partial authorized data.

Configured allowance, allocated plan minutes and observed actual cost are separate.
Missing usage is unknown. Preserve disabled lanes, absent runners, unresolved
receipts and budget ceilings. An evening draft is an explicitly unsaved browser
preview of the authored plan: validate existing shape and configured lane budgets,
preserve source context and never save sensitive plan text in localStorage.
Drafting does not publish or schedule anything. Unsupported publication/execution
links to the existing explicit CLI workflow with a clear reason; phases 102–108
own the runner and expanded operating controls.

**2026-10-21 implementation decision:** The climb template imports companions
that exist only after practice assembly. The hosted reader must not assemble or
execute project scripts to derive an allowance. It therefore displays an explicit
source `climb.budget.minutes` and listed jobs as declarations, with unresolved
defaults or invalid values unavailable. Draft validation refuses climb work whose
explicit allowance or job cannot be established; it does not claim full runner
configuration validation. Canonical night-plan validation and morning merge and
readiness functions remain reused directly. This preserves package portability
without changing the practice merely to support a read-only projection.

## Private learning

Read configured project lesson tables with the existing parser and bounded source
reader; retain row identity, exact immutable source/path/blob and shape provenance.
Read shared records only from the pinned private workspace. An absent catalogue is
an explicit absence; a failed read is unavailable. Keep duplicates and provenance
visible rather than silently treating two similar descriptions as one accepted
lesson. Never automatically ingest instructions from a lesson.

The strict schema for `lessons/<id>.json` is:

```json
{"version":1,"id":"lesson-<40 hex>","shape":"...","cost":"...","guard":"...","where":"...","source":{"repoId":1,"repo":"acme/studio","path":"docs/lessons.md","revision":"<40 hex>","blob":"<40 hex>","row":1,"fingerprint":"acme/studio/lesson/1/<8 hex>"},"imported":{"actorId":1,"at":"<canonical UTC ISO>"}}
```

All keys are exact. The ID is `lesson-` plus the first forty hex characters of
SHA-256 over the canonical JSON array `[repoId,path,fingerprint]`. Preserve the
existing `lessonFingerprint(repo,row)` contract. Text fields are bounded to 8 KiB
each, shape is nonempty, rows/actor/repository IDs are positive safe integers,
source paths are safe relative files and revisions/blobs are immutable 40-hex IDs.
Dates are canonical UTC ISO. Files are at most 64 KiB, with at most fifty shared
records and a 1 MiB catalogue read budget; extra or invalid records remain gaps.
A shared record carries the selected shape/cost/guard/where and exact original
source coordinates/fingerprint, plus declared import attribution. Source
attribution is not authentication; a verified operation receipt establishes a
server-observed transfer separately. Bound record count/bytes and reject malformed
or unsupported records with explicit coverage. The catalogue owns no copied phase
acceptance, credentials, membership or budgets.

## Migration is a reviewed copy with readback

Select one to three source lesson records for a transfer to new typed lesson files
in the private workspace. The application does not scan arbitrary local paths or
move/delete originals. Manifest, membership, setup/secrets, runtime state, phase
acceptance and arbitrary source files are forbidden destinations. Other migration
kinds remain explicitly unsupported rather than implied by a generic write route.

Preview the source revision/row, private destination repository/path, complete
before/after bytes, visibility and digest. Existing destinations refuse overwrite;
original-operation recovery may recognize the exact already-written result.
A stale source, destination head, visibility, member or permission requires a new
review. Identical source/destination content is a read-only no-op, not another POST.

Reuse the durable encrypted intent/single-dispatch/conditional-commit/readback
mechanics of phase 97 with an explicit migration domain and workspace scope.
Preserve existing decision and walk limits and recovery semantics. Reserve before
any external write, reauthorize source and destination immediately before dispatch,
then verify the original operation marker and every intended file at the resulting
commit. Response loss recovers that intent; it never dispatches again or chooses a
new destination. Uncertain writes retain reservations. A verified copy is not an
approval to remove the original and is not a project acceptance event.

## Explicit export

The owner selects records and prepares an editable outbound text draft. Show the
entire exact file before confirmation, including any identifiers/citations it will
contain. Do not automatically include private source URLs, raw feedback, images,
credentials or hidden metadata. Do not claim automatic anonymization.

An authenticated, CSRF-protected download requires approval of the exact draft
digest and current authorized source selection. Changed inputs invalidate approval;
use a bounded expiry and safe fixed filename. Download as an attachment with
no-store headers, never as executable HTML or a reusable public URL. No remote
post, issue, repository publication or recurring action follows a download.
Publishing remains a separate explicitly authorized action. This phase's export is
a reviewed file, not evidence that the material has been published.

## Diagnostics and experience

Provide project Daily work and Learning links and a workspace Learning view. Keep
mobile forms usable, source details expandable, original-operation recovery
reachable and unavailable capabilities understandable. Setup diagnostics expose
only nonsecret capability/coverage information: current connection, selected
projects, read/write gates, migration availability, media configuration and missing
runner support. No secret values or credentials enter HTML, JSON, logs or exports.

Tests must exercise actual adapters/routes and malicious cross-project/workspace,
stale-source, visibility-change, duplicate-submit and lost-response cases. Use
synthetic Acme fixtures. Independently inspect the browser on desktop/mobile and
compare actual GitHub nightly source records. Hosted transfer remains unverified
until an owner selects real records and approves the required permission. Keep
implementation, integration, deployment, owner acceptance and lived-in use separate.
