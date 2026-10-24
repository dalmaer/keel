# Evaluated learning records — phase 121 contract, 24 October 2026

Implementation contract settled by source inspection for phase 121. Extends
[review learning](review-learning-evaluation.md) using existing inbox, review and
harness records. Implementation and its proof remain separate from this design.
No paid execution, provider activation or promotion is authorized.

## Deliverable and boundary

Selected real findings form deduplicated, scoped hypotheses with append-only
transitions and frozen comparison references in existing `docs/inbox/<id>.md`
records. Phase 121 implements selected native intake/capture, proposal and proposal
revision, plan binding, inspection, rejection and supersession. It does not execute an experiment, assess measured
benefit, distribute a lesson, mutate the catalogue, publish a PR, or activate a
rule. No new task store, scheduler, polling loop or agent invocation is added.

The lifecycle section is authoritative; the existing front-matter status is a
compatibility projection written in the same file replacement. Untagged records
retain current behavior. Source existence and byte identity are verified facts;
defect classification, actor attribution and causal hypotheses remain explicitly
attributed statements. A comment's existence does not prove its diagnosis.

## CLI and request grammar

All operations accept `--json`. Unknown/duplicate flags and fields refuse.
`--manifest` and `--state` are common options on capture/propose/plan whenever
retained harness sources or baseline configurations must be resolved.

```
plates learn evaluate inspect <slug>
plates learn evaluate propose <slug> --input <absolute-request.json>
plates learn evaluate plan <slug> --input <absolute-request.json> --manifest <absolute-workspace.json> --state <absolute-private-state>
plates learn evaluate decide <slug> --input <absolute-request.json>
plates learn evaluate follow-up <slug> --input <absolute-request.json>
```

Mutation commands preview with exit 3 and no filesystem writes or outbound
mutations. Apply repeats the command with `--yes --digest <previewDigest>`.
An approval approves only the exact local inbox change. A fresh source read may
contact GitHub during preview/apply; neither operation posts or invokes a model.
`inspect` is local/read-only and reports retained verification attribution, not
new GitHub freshness. It does not invoke a mutating legacy `render` command.

Every request has EXACT fields:

```
{
  schemaVersion: 1,
  operationId: <UUID>,
  expected: {fileDigest: <SHA256 or null for create>, generation: <integer >= 0>},
  actor: <nonempty attributed actor>,
  at: <canonical ISO UTC timestamp>,
  reason: <nonempty plain text>,
  action: "capture" | "propose" | "revise" | "bind-plan" | "reject" | "supersede",
  payload: <action-specific object>
}
```

Address records using existing validated inbox date/slug rules; no arbitrary
destination path. Capture may tag an existing inbox record or create a native
record for an explicitly selected source. For creation, require the full
`YYYY-MM-DD-slug`, `expected.fileDigest=null`, `generation=0`, and the date from
request `at`; refuse any existing destination rather than allocate another name.
For tagging, require its actual file digest and generation zero. When tagging, preserve its existing title/claim/prose and require
`inbox:null`; when creating, use the explicitly approved inbox fields. An absent file
is not an empty existing record. All later actions require a real file digest.

Native intake uses the existing `docs/inbox` layout and `formatProposal` grammar;
it is an explicit new source adapter into that mechanism, not invented evidence.
`learn.gather()` currently ingests labelled lesson issues and moved upstream
sources; it does NOT import arbitrary selected PR findings. Do not route PR 216
through a fabricated issue/claim or ask the owner to manually manufacture a file.
The new selected-intake adapter constructs the first inbox file only AFTER the
actual selected review/retained artifact has passed verification. Its envelope
uses `kind:lesson`, `status:untriaged`, a stable `from:selected:<source-set-digest>`,
and NO issue number or implicit issue-close intent. Title and sanitized claim
are supplied for exact approval; verified source identities live in Evaluation.
Use existing instruction-shaped marking where applicable. A matching selected
source set already captured elsewhere is reported as a duplicate with its actual
record reference; do not create another file or silently overwrite it.

Stable request `at` is manual transition attribution, NOT an authenticated
execution/fetch timestamp. Request bytes, destination, expected absence/file
digest and operation identity participate in preview. `--digest` without `--yes`
refuses.

Action payloads (all fields required; absent optional values use explicit null):

* `capture`: `{inbox, selections, lesson}`. `inbox` is `{title,sanitizedClaim}`
  for native creation and null when tagging an existing record. `selections` contains the typed selectors
  below. `lesson` is `{failure, scope, applicability, reviewCondition,
  existingProtections, hypothesisOfFailure, related}`. Scope is
  `{repositories, paths, taskClasses}`. Protections are explicit
  `{repo, revision, path, sha256, assessment}` entries; assessment is attributed.
  `related` entries are `{recordRef, relation, reason}`, with relation
  `related|duplicate`. Exact-source duplicates are deduplicated by verifier;
  semantic duplicates are manual attribution, not machine-established facts.
* `propose`: `{lessonRef, hypothesis, candidate, expectedBenefit, downside,
  mechanism, owner, baselineSelection}`. `baselineSelection` is
  `{experimentId,expectedPlanDigest,configurationRef}` and resolves the baseline
  through existing authorized frozen-ledger inspection. Candidate request is
  `{kind:"scoped-material-overlay-v1",repository,baseRevision,changes,scope}`;
  each change is `{path,contentPath,expectedContentSha256}`. Read the exact UTF-8
  material bytes at private regular contentPath; never serialize that locator
  into the public record. Candidate repository and protection-inspection
  repository match the current learn home config; resolve Git bases from that
  checkout only. The algorithm below derives the before bytes, patch identity
  and expected ordered overlay identity; caller hashes are only consistency
  assertions. No arbitrary unified diff, runtime-code patch, deletion, mode
  change or context-list change is supported by this initial candidate adapter.
  Mechanism is one of `check|context|workflow|acceptance-case|specification`, an
  attributed description which never relaxes the overlay-only byte contract.
  Protection entries and decision context must be current for candidate scope.
* `revise`: `{supersedesRef, proposal, scopeChangeReason}`. `proposal` has the
  same fields as the propose payload, including the existing `lessonRef` and baselineSelection. Append
  a new immutable version of the same proposal ID with version incremented by
  one and its own candidate/configuration digests. Its record contains
  `supersedesRef` to the old proposal version. This action reuses the verified
  lesson and source records; it does NOT require new intake or duplicate capture.
  Reverify the existing sources/protection/decision references before applying.
  No attached old plan or evaluated result transfers to the new version.
* `bind-plan`: `{proposalRef, experimentId, expectedPlanDigest,
  targetCaseIds, controlCaseIds, heldOutCaseIds}`. Workspace arguments are local
  locators; neither paths nor private acceptance bytes enter the inbox.
* `reject`: `{evidenceRefs}`; the top-level reason is mandatory and preserved.
* `supersede`: `{replacementRef, scopeChangeReason}`. The replacement must already
  exist and resolve to another evaluated-learning record/version. Use `revise`
  for an atomically created replacement version in the same record. Standalone
  supersede performs no cross-file mutation, circular relation or self-reference.

`evaluate propose` accepts capture/propose/revise only, `plan` bind-plan only, and
`decide` reject/supersede only. No action can be selected through a legacy
`outcome`, `kind`, arbitrary state name or undocumented alias.

For this slice `follow-up` and requests to evaluated, ready-for-review, promoted
or rolled-back return exit 2, `verification_interface_unavailable`, without
writes. They are reserved surfaces, not working capabilities. Do not accept a
caller-supplied `verified`, `accepted`, `approved`, `merged` or metric field.

## Source selection and verification boundary

A selector is a request to READ authority, never proof. Two selector variants:

```
{kind:"github-review", repo, prNumber, reviewId, threadId, commentId,
 reviewedHead, expectedBodySha256}

{kind:"harness-artifact", experimentId, planDigest, slot, intentDigest,
 artifactDigest, verdictDigest, checkId}
```

`selections` entries have EXACT fields `{selector, classification}`. `selector`
is one of the two variants above; `classification` has the attributed shape
specified below. No verification-result fields are legal in a selection.

All identities are full identities, not prefixes. GitHub selection supports an
actual review body (`threadId:null, commentId:null`) or an actual inline review
comment (both IDs present). The selector's `reviewedHead` names the historical
commit reviewed, not the PR's current head. A finding from PR 216 is eligible
when its actual source identities/commit membership are verified; it is NOT
required to have been authored against today's head. Arbitrary issue prose,
push-review summaries, head inference from prose, and unavailable membership are
unsupported and refuse rather than being coerced into a review finding.

GitHub verifier: factor a narrow unfiltered selected-source reader from the
existing bounded `readPr`/`readReviews` transport/pagination machinery in
`lib/review.mjs`. Select BEFORE display, current-head or configured-reviewer
filters; do not add a second pagination implementation. The existing mapped
`readReviews` return drops review IDs: preserve the needed raw review identities
in this helper, without changing legacy display semantics. Extend only necessary
query fields or use a bounded exact-ID read through existing `ghJson` when the
current query omits membership fields. Never use a truncated displayed body.

Resolve repo/PR/review identity and require the review's provider `commit_id` to
equal selector `reviewedHead`. For an inline comment, independently establish
its review membership (`pull_request_review_id` or equivalent typed provider
relationship), PR/thread membership, and complete exact body; retain its actual
current/original comment commits and current/original path/range. Do not infer
membership from matching prose, author or timestamp. Record comment commits
separately: line provenance may differ from the containing review commit. For a
review-body selection, use that actual review body and nullable comment fields.

Read and retain `currentPrHead` separately. Set `reviewCoversCurrentHead` solely
from equality of actual reviewed commit and observed current head. A mismatch
is a visible historical-source limitation, NOT a capture refusal. Historical
source remains eligible after later pushes or force-pushes if provider membership
is available; do not invent a current-branch ancestry requirement. Current head
changes between preview and apply require a new exact preview because an approved
observation changed; a stable but different current head does not invalidate the
historical finding. Capture never asserts that the defect still exists today.
When later proposing/revising from a retained source, its original currentPrHead
is a historical observation, not a permanent equality precondition. Reverify the
same reviewed commit/member/body identities; bind the newly observed current
head in that operation's preview/sourceDigest without rewriting the source
record. Only a change DURING that preview/apply approval window requires another
preview. Different current heads across separate operations are expected.

Compute `bodySha256` over exact UTF-8 body bytes; the existing `contentOf` hash is
a DIFFERENT metadata-plus-content tuple and must retain a distinct name. Reject
body edits changing the selected hash, ambiguous/mismatched commit or review
membership, incomplete reads and inaccessible evidence. Merely outdated or
resolved comments are not rejected when their historical membership is verified.

Reuse an existing `plates review` raw-content read receipt when it retains the
selected historical finding's identity; do not require its filtered `ids` display
list to contain that finding. If existing receipts omit the selected raw identity,
extend the explicit selected-source read in the SAME review receipt/cache lane;
no separate intake store and no current-head-only prerequisite. This prerequisite
is an explicit read of the real source, not manual construction of evidence. Bind its recorded read timestamp and content identity in preview, then
independently re-fetch selected authority at apply. Cache JSON alone is never
verification. The receipt's `at` is retained as `fetchedAt` with attribution
`review-read-receipt`; it is not proof of historic time or current freshness.
The fresh verifier's actual check time is returned as response diagnostics and
must not change the approved output bytes. If the read receipt changes between
preview/apply, require a new preview. The new selected-finding reader must not
write or refresh review caches during preview. A missing receipt yields a
specific instruction to perform the existing explicit review read first.

This solves deterministic approval without silently regenerating timestamps.
An allegedly old receipt cannot establish freshness: success always requires
fresh API comparison at apply, regardless of its timestamp. No TTL shortcut.

Harness verifier: invoke `evaluations({action:"inspect", experiment, manifest,
state, appRoot})` in `lib/evaluation-ledger.mjs`, retaining its workspace,
plan/attachment and `inspectExecutions` validations. Resolve the exact planned
slot, intent, artifact, verdict and named check from the validated projection;
verify their reference chain and retained bytes. A missing artifact, unavailable
record or uncertain identity is a gap/refusal, not a valid captured artifact.
A terminal operation with unknown acceptance may be described as unknown; it
cannot be labelled a verified defect from that fact alone. A hash provided by
the caller must match the controller's retained record, not merely its own JSON.
No paths supplied in an artifact selector are followed. Workspace flags are
required when any local source or comparison is selected.

No new private source archive is required in 121. GitHub bodies are processed
in memory and never echoed, persisted in inbox text, or copied to public preview
output. Existing private receipts/artifacts retain their ownership. The user
supplies sanitized lesson text and explicitly approves the exact public bytes;
that approval is not an automatic PII classifier. Capturing a private source
into an existing inbox whose legacy claim already contains raw private content
must refuse and identify the need for a separately reviewed sanitization; never
silently replace prior words.

Verified source output fields, EXACT common envelope:

```
{schemaVersion:1, kind:"learning-source", id, version:1,
 source:<github|harness variant below>, classification,
 incidentKey, verification, digest}
```

`classification` is `{value, attribution:"manual", actor, rationale}` where value
is `reviewer-statement|preference|unresolved|verified-defect`; the last requires
independently verified failing behavioral evidence, not just review prose. Classification and rationale are attributed input,
separate from the selector object above. Do not infer root cause automatically.

GitHub source: `{repo,prNumber,reviewId,threadId,commentId,reviewedHead,
currentPrHead,reviewCoversCurrentHead,commentCommit,originalCommentCommit,path,
lineRange,originalPath,originalLineRange,bodySha256,fetchedAt}`. Nullable locations
are explicit. Verification:
`{method:"fresh-review-v1",receiptContentDigest,receiptAt,sourceIdentityDigest}`. Historical membership is verified independently of
`reviewCoversCurrentHead`; the latter never becomes an acceptance assertion.
Harness source: `{repository,experimentId,planDigest,slot,intentDigest,
artifactDigest,verdictDigest,checkId,startingCommit}`. Verification:
`{method:"retained-harness-v1",sourceIdentityDigest}`.

`incidentKey` is verifier-derived for harness sources from repository + plan +
original intent (linked repair attempts are one incident family). GitHub-only
sources have null incidentKey unless independently bound to a retained execution;
a PR, head, or comment is NOT automatically an independent incident. Deduplicate
exact GitHub IDs/retained artifact selectors first. Recurrence counts only
verified distinct incident keys; unknown keys stay an explicit unknown count.
No recurrence rate without an eligible-execution denominator.

## Exact append-only section

One top-level `## Evaluation`, after the existing Decision section, containing
exactly one `json` fence with EXACT fields:

```
{schemaVersion:1, kind:"evaluated-learning", id, records:[], events:[]}
```

Reject duplicate sections/JSON keys, malformed fences, trailing payload text,
unknown fields, noncanonical digests, unsupported versions and projection
mismatches. The parser must understand Markdown fence boundaries so headings
inside the fenced legacy Claim cannot impersonate the section. Serialization
must round-trip evaluation fields and preserve all existing prose. Legacy
rewriters that cannot preserve a tagged file must refuse before writes.

Every `records` item has `{schemaVersion:1,kind,id,version,data,digest}` except
`learning-source`, whose exact envelope is specified above. Learning-record refs use
`{kind,id,version,digest}`. Native harness schema-2 refs retain their existing
`{kind,id,digest}` shape; do not invent a version field on those refs. SHA256 is computed with the harness canonical JSON
routine over the object excluding its `digest`. IDs use the existing bounded
lowercase evaluation-ID grammar. No cycles or unresolved references.

Record data shapes:

* `learning-lesson`: `{sourceRefs,failure,scope,applicability,reviewCondition,
  existingProtections,hypothesisOfFailure,related,recurrence}`. Recurrence is
  derived `{distinctVerifiedIncidents,unknownIncidentSources,established,
  eligibleExposure:null}`. Established requires at least two verified distinct
  incidents; not a causal claim. Protection evidence digests are verified against
  existing local Git objects, while assessments remain manually attributed.
* `learning-proposal`: `{lessonRef,hypothesis,candidate,expectedBenefit,downside,
  mechanism,owner,baselineRef,supersedesRef}`. `supersedesRef` is null for the
  first version, otherwise the prior proposal ref. Persisted candidate is
  `{kind:"scoped-material-overlay-v1",repository,baseRevision,scope,patch,
  patchDigest,baselineDeliveryDigest,candidateDeliveryDigest}`. Exact patch and
  delivery fields/algorithms follow below. Content input paths are not stored.
* `learning-plan-link`: `{proposalRef,comparisonRef,planDigest,targetCaseIds,
  controlCaseIds,heldOutCaseIds,caseRefs,baselineRef,candidateRef,binding,limitations}`.
  Binding is `{method:"scoped-material-overlay-v1",patchDigest,
  baselineDeliveryDigest,candidateDeliveryDigest,baselineConfigurationDigest,
  candidateConfigurationDigest}`; every value is recomputed from verified bytes
  and refs, not accepted from the request. Verify phase-120 case IDs/digests and
  exposure using the existing corpus catalog. Five-pair target/control coverage
  may be reported; no efficacy/readiness claim. Zero held-out inventory stays zero.

### Implementable candidate-to-configuration binding

Existing schema-2 configuration has `harnessCommit`, nullable `dirtyOverlay`,
`context` and `overlays` entries `{path,material}`. It has NO patch field. Do not
add one, invent a patch receipt, or use equality with a caller's hash as proof.
Initial candidate support is deliberately a scoped material overlay: a public
instruction or check material added/replaced in `configuration.overlays`, with
an explicit Git-base observation. This is trial material, not an applied Git
patch or a production change. Other candidate shapes return
`unsupported_candidate_shape` with this scope limitation.

Hash definitions: `H(bytes)` is existing `byteDigest` over exact bytes;
`F(value)` is existing `fingerprint` over canonical JSON. No newline, Unicode,
line-ending or whitespace normalization. A material's schema-2 `digest` seals its
entire record and is distinct from `H(UTF8(material.content))`. All material refs
must resolve by kind, ID AND record digest through the validated frozen bundle;
its attachments must pass existing ledger inspection. For this slice additionally
require round-trip valid UTF-8 and no lone surrogate content in changed material.

At proposal preview/apply:

1. Inspect baselineSelection through `evaluations(action:"inspect")`. Require
   its configurationRef to be the frozen comparison's actual baseline. Verify
   its full record/material references and retain its schema-2 ref. Require
   `baseRevision === baseline.harnessCommit`, both full local Git commits, and
   baseline `dirtyOverlay === null`. Existing dirtyOverlay is not a verified
   arbitrary-diff interface. Use actual Git objects, not checkout working bytes.
2. Resolve baseline `context` then `overlays` in the executor's existing order.
   For this initial adapter require unique paths ACROSS the two lists (schema 2
   itself checks uniqueness per list only). Reject aliases, unsafe paths,
   exclusions, `requirements.json`, and a changed path in context. Keep all
   noncandidate delivery materials, including public probes, unchanged.
3. Sort changed paths lexicographically; require 1–16 unique exact scope paths.
   Each change is either replacement of a baseline overlay at the same index,
   or addition of a previously absent path. Read new bytes from contentPath and
   compute H; compare expectedContentSha256 to that computation, not vice versa.
   For replacements resolve the old baseline overlay bytes and require a real
   content change. Additions require absence from both baseline lists AND the
   Git base tree. Refuse deletion, rename, file-mode change or executable mode.
4. Independently inspect each changed path at baseRevision with safe Git
   object reads. A present path must be a regular 100644 blob; retain its Git
   blob OID and H(blob bytes), even when a baseline overlay already differed
   from it. A missing path records explicit absence. Reject symlinks/gitlinks
   and missing/unreadable commits. A replacement's effective BEFORE is the
   baseline material, NOT an assumption that Git bytes were delivered. Record
   both Git base and effective baseline observations to expose that distinction.
5. Derive the patch object below. Construct expected candidate overlay order by
   replacing changed baseline overlay entries in place, keeping other entries
   untouched, then appending additions in sorted path order. Context stays
   exactly unchanged. Compute both ordered delivery digests below. No patch is
   applied to Git or the working tree. Preview shows the exact proposed new
   public material bytes and old/new byte hashes alongside the public record
   output; those bytes participate in approval. Private acceptance/source bodies
   do not enter that preview. Locators remain local diagnostics only.

Exact derived patch schema (persisted inside the proposal candidate):

```
{schemaVersion:1, kind:"material-overlay-patch", repository, baseRevision,
 baselineConfigurationDigest,
 changes:[
   {path, operation:"add"|"replace", mode:"100644",
    gitBase: null | {blobOid,mode:"100644",contentSha256},
    before: null | {materialRef,contentSha256},
    after:{contentSha256,bytes}}
 ]}
```

Null gitBase is verified absence; null before is an addition. `patchDigest =
F(patch)`. This is the exact canonical replacement manifest, not the SHA256 of
some independently authored unified diff. Request fields do not supply patch,
patchDigest, before hashes, Git-base observations or delivery digests: the
verifier constructs them. Revised proposal versions rerun this derivation.

For each arm, form this ordered array from resolved `context` followed by
`overlays`, retaining array order:

```
[{layer:"context"|"overlay", index:<zero-based index within that layer>,
  path, mode:"100644", contentSha256:H(UTF8(material.content)),
  bytes:Buffer.byteLength(material.content,"utf8")}, ...]
```

`deliveryDigest = F({schemaVersion:1,kind:"ordered-material-delivery",
entries:<array>})`. This digest intentionally identifies delivery bytes/order,
not material names or timestamps; actual material record refs and configuration
record digests are separately verified and retained. It does NOT equal the
executor's `input.deliveredDigest`, which additionally contains task source and
requirements. Name it only `baselineDeliveryDigest`/`candidateDeliveryDigest`
under this explicitly versioned material-delivery method; do not claim complete
execution identity or actual runtime delivery from plan binding alone.

At `bind-plan`:

1. Inspect the selected frozen comparison through the existing authorized ledger.
   Its baseline ref must equal the proposal's retained baseline ref exactly.
   Recompute baselineDeliveryDigest from actual baseline material bytes; reread
   baseRevision and each changed Git base blob/absence and compare the stored
   observations. A stale/missing base or altered baseline is a refusal.
2. Require candidate.harnessCommit equal baseline.harnessCommit and both
   dirtyOverlay null. All nonheader fields other than overlays must be canonically
   identical: provider, runtime, model, context, exclusions, tools, routing,
   policy and environment. Header identity/timestamps/digests may differ, as
   schema 2 already requires distinct configuration IDs. Candidate overlays must
   have EXACTLY the expected paths/order, with no hidden additions/removals.
3. Resolve every actual candidate material by its real sealed ref. Unchanged
   entries must retain the exact baseline material ref and bytes. Changed entries
   must have exactly the recorded after byte count and SHA256; compare actual
   content with the canonical expected descriptor. Recompute the expected patch
   from the verified Git base, actual baseline bytes and actual candidate bytes;
   require its F to match retained patchDigest. Recompute candidateDeliveryDigest
   and compare. Thus the link is derived from source/material observations on
   both sides, not a nonexistent configuration.patch field or unverified input.
4. Verify ALL selected case identities against phase-120 corpus definitions and
   source inventories. Changed paths must be outside every task sourcePaths set,
   corpus protected probe/support path, configured acceptance driver path,
   `requirements.json` and exclusions. Exact private acceptance material content
   remains forbidden by existing schema-2 validation. This initial scope may
   introduce a public check/instruction alongside tasks, not replace source under
   evaluation, weaken the oracle or alter the runtime adapter. Unsupported cases
   with unknown inventory refuse rather than assume no path collision.
5. Append learning-plan-link with the computed binding and explicit limitation
   `material-plan-binding-only; actual delivery/execution unverified`. Preserve
   target/control/held-out IDs, plan identities and declared null promotion
   criteria. Unresolved model aliases, unknown costs and offline scripted runtime
   are reportable execution/effectiveness gaps, NOT reasons to refuse an otherwise
   valid plan-binding operation. Binding is not readiness, spend or execution.

Concrete positive fixture/acceptance path: use the existing valid Acme schema-2
frozen comparison with five target pairs and five control pairs. Baseline and
candidate share a real local harnessCommit, null dirtyOverlay, identical context,
probe/support overlays, tools, model/runtime, routing and environment. Candidate
only appends `{path:"acme-checks/package-entry.mjs", material:<sealed ref>}` whose
UTF-8 content is the separately authored public check. Verify that path absent
from the Git base, both cases' source inventories and protected paths. Propose
using those actual local content bytes and the comparison's baselineSelection;
then bind that SAME frozen comparison. Require a successful proposed-state
plan-link with reproduced patch/delivery digests, without dispatching anything.
This requires no nonexistent phase-122 verifier, patch field, paid provider or
nonnull promotion criteria. Wrong bytes, moved overlay order, changed runtime,
hidden path, non-null dirtyOverlay, false absence, or touched protected source
must each fail a distinct negative control. The baseline and new check can be
frozen before learning proposal creation; there is no circular authorization.

Events have EXACT fields:

```
{schemaVersion:1,kind:"learning-event",id,sequence,operationId,
 requestDigest,previousDigest,action,from,to,actor,at,reason,
 sourceDigest,decisionContextDigest,recordRefs,evidenceRefs,
 duplicateSearchDigest,subjectRef,replacementRef,digest}
```

`sourceDigest` binds sorted verified-source identities plus all current retained
refs read for this operation. `duplicateSearchDigest` binds the complete bounded
inbox inventory searched for capture/semantic relations, otherwise null.
`subjectRef` names the affected lesson/proposal version (capture names its new
lesson; initial propose its new proposal; revise its old proposal; plan/reject
its active proposal or observed lesson). `replacementRef` is non-null for
supersede/revise. For revise it resolves to the newly appended proposal version
in the same atomic mutation; the new record points back through supersedesRef. Evidence is typed retained refs,
not embedded proof JSON. `recordRefs` names exactly records appended by this
event; records append in event order and cannot be orphaned. An operation with
no new typed records has an empty recordRefs array. `generation=events.length`
and current lifecycle are derived, never separately editable. Earlier events,
records, IDs, words and digests must be identical to the existing prefix when
applying a mutation. Digests detect inconsistency; they are not signatures and
cannot prove that a manually rewritten entire repository history never changed.

Allowed 121 transitions:

| Action | Transition | Required local evidence |
| --- | --- | --- |
| capture | new → observed | verified selected sources, scope, duplicate inventory; native creation or existing-record tagging |
| propose | observed → proposed | current protection/decision inspection, bounded exact candidate, falsifiable hypothesis, downside |
| revise | proposed → proposed | old version superseded, new version proposed; same retained lesson, reverified source/protection context, new exact candidate |
| bind-plan | proposed → proposed | frozen plan/config/case binding; append plan link, no execution |
| reject | observed/proposed → rejected | nonempty rationale and preserved source refs |
| supersede | observed/proposed → superseded | resolvable replacement and scope-change reason |

A revised hypothesis/candidate appends a new immutable proposal version and one
`revise` event. Its active-state projection is proposed → proposed; replay marks
the old subject version superseded by the replacement version. This is an atomic
version replacement, not an assertion that the original hypothesis changed in
place. Prior rationale, lesson versions, source records, plan links and decisions
remain accessible. The active proposal ref derives from event history, not a
second editable pointer. The new proposal may cite the identical lessonRef;
there is no artificial `new → observed` or source-recapture requirement.

For a materially revised lesson, a separately approved append of a lesson version
must pass the same capture/source checks; it is not an implicit effect of proposal
revision. Initial 121 implementation can refuse lesson edits while still fully
supporting proposal versions against the retained lesson. Do not automatically
copy a prior plan link to a replacement proposal: `bind-plan` revalidates the new
candidate against a frozen comparison under its exact identity. Later evaluated/
promoted history cannot be rewritten or bypassed through revision.

Compatibility projections: observed=untriaged; proposed/evaluated/ready-for-review
=proposed; promoted=accepted; rejected=declined; superseded=linked;
rolled-back=proposed with an explicit rollback banner. Names for later states
are reserved: phase 121 cannot create them and refuses unsupported schema/history
rather than pretending their evidence has been validated.

## Atomic/CAS, previews, limits and recovery

Preview returns `{action,preview:true,operationId,requestDigest,currentDigest,
expectedGeneration,destination,sourceDigest,decisionContextDigest,duplicateSearchDigest,
outputDigest,outputBytes,candidatePreview,changes,limitations,digest}`. This is a proposal, not a
verification receipt callers can replay as proof. `digest` binds all fields
except itself. `candidatePreview` is null except propose/revise, where it is a sorted array
`[{path,content,contentSha256}]` of the exact newly supplied public material bytes;
its content/hash is independently computed and included in previewDigest.
`outputBytes` contains only approved public Markdown, never raw
selected bodies, private paths, acceptance manifests or credential material.

Recomputing an identical preview must produce identical bytes and digest:
request `at` is stable, receipt timestamps are bound inputs, arrays are ordered,
and fresh-check wall time remains response diagnostics outside the preview.
Reject changed source/receipt/decision/inventory/request bytes at apply.

Use one cooperating writer lock for evaluated inbox mutations and evaluated
legacy writes, located adjacent to the existing inbox, not in a new task store.
Exclude lock/pending names from proposal discovery. Use exclusive no-follow
creation, record lock ownership, and verify lock file identity before release.
No age/PID-based automatic reclaim. Reuse safe path checks/durable write patterns;
`lib/lock.mjs` manages installed-file hashes and is NOT a writer mutex.

Apply ordering:

1. Obtain lock; re-read target as a bounded regular unlinked file with safe parent
   paths (or verify target absence for native creation). First detect an already-applied identical operationId/requestDigest
   and return its existing result without a new transition. Otherwise compare
   file digest and generation with request expectations.
2. Revalidate selected source authority, retained references, duplicate inventory
   and decision context; regenerate the exact reviewed output. Any discrepancy
   refuses. Fresh external facts cannot be globally locked: report observation
   semantics, not atomicity with GitHub.
3. Write complete approved bytes to a same-directory exclusive `.pending` file,
   mode 0600; fsync it. Immediately recheck target bytes/inode (or expected absence) and lock identity.
4. For an existing target, rename over it and fsync its directory. For native
   creation, publish the complete temporary file by exclusive hard-link/no-replace
   publication as in shaping; a racing destination refuses without replacement.
   Remove only this operation's temporary link after confirmed publication and
   fsync the directory. The section and
   compatibility status are one atomic file change. Never implement this through
   the existing unguarded `learn.save()`.
5. Release the owned lock. Generated INBOX views are rebuildable and not part of
   acceptance; a failed post-write refresh must report committed record plus
   stale-view gap, not encourage mutation replay. Prefer leave refresh explicit.

This serializes cooperating CLI writers. Ordinary editors do not honor the lock;
rechecks detect observed edits but POSIX rename is not a kernel compare-and-swap
against arbitrary concurrent editors. Document this limit; never claim universal
CAS. All in-process learn/distill mutation entrances must use the shared guard.

After an uncertain write, `inspect` checks the original operationId/requestDigest
in retained history and reports committed, not-found, conflict or unavailable.
An exact existing operation is returned as already applied without a new event,
network publication or re-execution. Same operation ID with different request
bytes refuses. A pending file/lock is preserved for operator inspection; missing
operation alone does not authorize deleting it or retrying over uncertainty.
No automatic uncertain-operation repair endpoint in phase 121.

Bounds proposed for this slice: input 256 KiB; inbox file 1 MiB; evaluation section
256 KiB; max 32 selected sources, 128 immutable typed records, 128 events, 32 source/evidence refs and 64 appended record refs per event,
16 related/replacement refs, 32 scope paths, 4 KiB per prose field; IDs ≤64
characters; SHA256 exactly 64 lowercase hex; full Git revisions exactly 40 hex
for current supported repos. Each selected review body ≤64 KiB, aggregate selected
bodies ≤1 MiB. Respect existing review pagination caps and refuse incomplete
coverage. Duplicate search ≤1000 inbox files/16 MiB, no silent truncation. Existing
harness/artifact/corpus limits remain unchanged. Hardlink, symlink, traversal,
invalid UTF-8, non-regular and oversized inputs refuse. Never prune history to fit.

## Reuse and focused implementation seams

* `lib/learn.mjs`: `home`, `find`, `proposals`, parser/serializer and inbox naming.
  Extend parse/format preservation; guard `propose`, `decide`, `save`. Guard
  evaluated records BEFORE `decide` hands distill records to its early dispatch.
* `lib/distill.mjs`: guard direct `decideDistill` and render consumers so a changed
  `kind/outcome` cannot manufacture acceptance or catalogue writes. Reuse related
  family concepts only; existing catalogue-family acceptance is not evidence.
* `lib/review.mjs`: narrowly export a selected-source reader sharing private
  `readPr`/`readReviews`, complete-content identity and bounded pagination. Existing
  review cache and read receipts remain local source metadata, never sole proof.
* `lib/evaluation-ledger.mjs`: public `evaluations` inspection for frozen plans and
  execution receipts; `evaluation-records.mjs` canonical hashes/IDs; existing
  corpus inspection for known case identities. Do not call run/resume/cancel.
* `practices/reconciliation/files/scripts/plates/decision-context.mjs`: use local
  phase context and its digest; required broken refs block. `not-configured` is
  legacy compatibility, not verified architecture coverage.
* `lib/session-ledger-io.mjs` and local shaping publication: reuse safety/durable
  replacement patterns, not JSON-specific `store` blindly for Markdown. A small
  evaluated-inbox I/O helper is reasonable; no second persistence service.
* Suggested new pure module `lib/evaluated-lessons.mjs` plus one local I/O/source
  adapter module if needed. CLI/help integration stays in existing learn routing.
  Keep tagged-record parsing pure so legacy rendering adds no network dependency.

## Required focused evidence

`tests/evaluated-lessons.test.mjs` should prove strict parse/round-trip and heading
spoof/duplicate-key refusal; all available and unavailable transitions; exact
source identity and body edits; historical review at a different current head
accepted with explicit noncoverage; forged review/comment membership refused;
current-head change during approval requires repreview; raw historical selection
not lost to display filters; missing
source permissions/pages/attachments; duplicate comments vs incidents; forged
caller proof; missing protection/patch/config linkage; unknown recurrence;
legacy propose/decide/distill bypass via kind/outcome; preservation of rejected
rationale and superseded versions; native intake from a verified historical PR
source without fabricated issues; destination races; same-lesson proposal revision
without recapture; old-plan nontransfer to the new candidate; stale request/decision/inventory; concurrent
writers; crash before/after rename and original operation recovery; lock identity
replacement; symlink/hardlink safety; private body non-disclosure; stable previews;
no writes on preview; and no runner/model/publication calls on ANY path.

Use actual local ledger fixtures for retained-source verification; GitHub tests
fake only the external transport, never the verifier. A controlled Acme walk
proves record mechanics only. Phase 122 requires its actual comparison-verification
interface; phase 123 requires actual reviewed-merge/rollback verification. Until
those are implemented, exact, typed refusal is success for those code paths.

## Settled implementation scope — 24 October 2026

This draft supports existing local inbox records AND explicit native selected
intake into that same format. Historical review/comment membership is verified
against its actual reviewed commit, while current head is a separate observation.
Proposal revision reuses the same lesson and sources through immutable versions
and supersession; new intake is not required to revise a hypothesis. These are
workflow requirements, not reasons to recreate selected evidence.

The selected-source reader must expose unfiltered historical identity/content
through existing review transport and pagination. If the real selected PR 216
source lacks available membership evidence, report that specific source gap;
never substitute current-head coverage or fabricated metadata. The exact selected
finding has not been fetched or verified by this read-only draft revision.

The CLI spellings and numeric limits above define this initial slice. The
source-privacy checks must be demonstrated against existing interfaces. The
overlay-only candidate binding above is the phase-121 positive contract: implement
and prove it using actual Git objects and frozen material/configuration records.
Other candidate shapes remain explicit unsupported cases, not fabricated links.
