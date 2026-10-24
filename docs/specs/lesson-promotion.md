# Reviewed lesson packages — phase 123 contract, 24 October 2026

Extends evaluated-learning records and lesson screening. Implement independently
behind phase119's owner merge hold. No real approver policy, paid execution,
provider activation, external publication or production promotion is enabled.

## Authority and trust boundary

Use existing inbox Evaluation history, immutable experiment reports, private
workspace binding, source verifier, exact preview/operation recovery, review
transport and phase decision context. No new scheduler or evidence store.

A package is useful for supported, rejected AND inconclusive evaluated results.
Generating it is not readiness. Readiness is not promotion. Source inclusion
after reviewed merge is not installation, acceptance, deployment or lived-in use.

Promotion is disabled unless independently configured policy can be read from
the authorized repository's current default branch. Extend optional configuration
with learning.approval exactly:
{schemaVersion:1,provider:"github",ownerApproverIds:[positiveSafeInteger,...]}.
IDs must be unique, bounded (1–16); matching accounts must have provider type User.
Do not configure this on a real project. No login-name fallback, request override,
locally edited config or review.reviewer alias is authority.
MVP is github.com only; unsupported GitHub hosts refuse explicitly.

Default-branch governance is the explicit trust assumption. Resolve canonical
repository ID/default-branch SHA freshly, read policy at that exact SHA, and bind
repository ID, branch, source SHA, blob OID, byte hash and policy digest. The
same approval subsection must already exist at the PR's exact base snapshot.
The candidate must not modify .plates/plates.json. A policy installed only by
the candidate or changed between observations cannot approve that candidate.
This does not authenticate policy authorship or prove a physical human clicked.

Approval is a current provider-attributed APPROVED review by a configured
human-designated account, with exact current reviewed head and PR membership.
Review body is exactly:
plates-learning-approval-v1 promote sha256:<package-payload-digest>
or the distinct rollback action and inverse-package digest, with at most one LF.
No prose keyword inference. Fetch complete bounded review pages; exclude
dismissed/older approvals, and refuse a latest outstanding CHANGES_REQUESTED
review by any reviewer. Latest means submitted timestamp with numeric ID tie-break;
ambiguous/missing identities refuse. Owner-as-author cannot self-approve via this
review-only route; report that unsupported case. Review state/body may mutate:
retain their fresh observed hash/time, never claim bytes as they were at merge.

## Package construction and local records

Add package as a read-only learn evaluate verb, with slug, manifest/state and
--json, no request file/yes/digest. Derive the active evaluated proposal's exact
retained report, source identities and current material-plan binding; no caller
report, metrics, patch bytes, disposition, approved or verified fields.
A package preview writes nothing, including no report or inbox directory.

Return deterministic versioned package payload, content-derived digest, public
Markdown, deterministic public JSON bytes, intended repository-relative artifact
path and explicit readiness gaps. Payload includes proposal/evaluation/report refs,
reporter/version/digests, hypothesis, source links, scope, candidate/baseline,
criteria, raw per-case counts and all-attempt costs, attempt references, missing
evidence, commentary attribution, mapping and inverse.
Never export private source bodies, full private report receipts/inventories,
host paths, transcripts, credentials or acceptance materials. Hashes/relative
paths and sanitized source links are enough. Bound output (256 KiB); refuse
overflow rather than trim contrary evidence.

Public payload excludes its own digest/envelope, PR/review/merge identities and
eventual package-file content hash (avoids circular identities).
Use deterministic JSON plus one LF. Fixed package artifact path:
docs/evidence/learning-packages/<payloadDigest>.json.
The artifact is proposed, not written or published by the package command.

Initial mapping supports identity paths only from scoped material-overlay
candidate, exact base revision and actual frozen after bytes. Check all candidate
changes accounted, unique paths, regular 100644 blobs, before hashes/absence,
no protected oracle/config paths and no routing changes. If tested overlay cannot
establish installed invocation/routing, keep publication_mapping_unverified gap;
byte identity alone does not establish runtime efficacy. Package still exports
an explicitly unready proposal.
A narrow inverse restores verified prior bytes for replacements and removes only
exact candidate-added files. It does not delete unrelated work. Keep original
public package as historical evidence; rollback adds its own inverse package.

Add strict sealed learning-review-package records for explicitly approved
record-package action via learn evaluate decide. Payload {proposalRef,evaluationRef};
derive package internally, append same-state event, one package per exact content,
preserve operation identity. Changes produce a new package and fresh approval.
Existing rejection and supersession remain explicit and retain evidence.
No operation creates a GitHub PR or activates an instruction.

## Readiness, promotion and rollback

ready via decide references {proposalRef,packageRef}. Revalidate original report
and current verifier; supported screening, every target/control/resource criterion,
unchanged actual delivery/oracle, complete public mapping/inverse and current
source/decision bindings are mandatory. Append learning-readiness and transition
evaluated -> ready-for-review. Caller hashes/booleans cannot skip checks.
Offline results cannot satisfy it. Synthetic pure tests are machinery only.

promote via decide selects {proposalRef,readinessRef,repo,prNumber,reviewId}.
Resolve package/approval policy/source facts internally. No supplied merged SHA
is proof. Read exact Git blobs at base, reviewed head and merge, enumerating
complete bounded trees/differences (not truncated PR patch text).
MVP allows only a two-parent merge whose first parent is package.baseRevision,
second parent is reviewed head, and tree equals reviewed head tree.
PR base must match package base and target authorized default branch.
Reject squash/rebase/advanced-base variants until separately implemented.
Whole base->head difference must equal mapped candidate add/replace files
PLUS exact public package artifact. Reject extra files, mode changes,
symlinks, submodules, hidden deletions, policy changes or modified acceptance.
Fresh before/after observations must agree on policy/head/reviews/merge and
content digests. Local writer serialization does not make GitHub reads atomic.
Append learning-promotion with original package/readiness/approval/merge evidence;
transition ready-for-review -> promoted. Keep observed inclusion separate from
production outcomes. Never POST, merge or change GitHub state.

request-rollback appends a request with {proposalRef,promotionRef}; reason is
existing request.reason. It leaves lifecycle promoted. Derive deterministic
inverse public package using retained original bytes, original mapping and
promotion revision. Marker action is rollback. Inverse PR removes/restores only
candidate material paths and adds inverse package; original package stays.
observe-rollback selects {proposalRef,rollbackRequestRef,repo,prNumber,reviewId}.
Apply same independent current policy, exact review and two-parent merge
verification to inverse. Only then append learning-rollback and transition
promoted -> rolled-back. Missing/changed files or uncertain observations refuse.
No serving-revision or completed deployment claim is made.

Derived legacy projection: evaluated/ready-for-review/promoted/rolled-back ->
proposed. Reviewed source inclusion never sets legacy accepted. Preserve the
explicit promoted history and all prior records.
Legacy learn decide/distill cannot activate tagged proposals.

## Follow-up and recovery

Implement follow-up as explicitly approved local record, never polling.
Payload names proposalRef, decisionRef (evaluation/readiness/promotion/rollback),
window {start,end}, selected source selectors/classifications, attributed
commentary and optional existing related/replacement ref. Resolve selectors
through existing source readers; preserve identities and exact finding dedup.
A selected finding set is not complete exposure. Initial coverage is unmeasured,
denominator/rates/cost/latency/help changes null. Never turn missing observations
into zero recurrence. Existing sources may establish distinct incident identities
only when reader actually supplies them.
No automatic reopen, rollback or broader scope. Explicit revise after follow-up
creates changed proposal version, supersedes old ref, retains promotion/rollback
history and transfers no support. It must not imply the old rule has been removed.

All new requests/records require strict nested runtime validation and existing
byte/count limits. Reuse exact request/operation IDs and inbox CAS. Ambiguous
local writes or external observations keep original identities; no PR retry
occurs because these commands do not publish. Duplicate recovery revalidates
original referenced reports and decisions where needed, preserving old
observations and reporting conflicts rather than rewriting history.
A later revoked review is a new observation, not a rewritten old promotion.

## Proof and implementation bounds

Focused proof: npm run check:focused -- tests/lesson-promotion.test.mjs, plus
provider verifier and package/schema tests. Conductor full check/typecheck once
on final tree; fresh private Acme installed/public-CLI package walk.

Tests prove positive package from actual terminal offline receipts plus
unknown-cost/inconclusive disclosure; supported/ready arithmetic only synthetic.
Verify disabled/candidate-only/rotated policy, wrong host/repo/account/Bot,
changed/dismissed/old approval, partial pages, owner-as-author refusal, mutated
source between reads, extra tree changes/modes, exact allowed two-parent merge,
unsupported merge variants, rollback pending vs observed, unknown follow-up
exposure, no preview writes, and preserved original operations.
Use actual local Git trees/commits where possible; fake external transport only,
not internal verifiers. No favorable real efficacy or human approval claim.

Real phase122 measured screening still needs missing provider/spending integration
and owner-approved allowance. Real phase123 promotion additionally needs owner
configured approver policy, supported evaluation and actual exact reviewed PR.
Independent mechanics may be verified without activating any of these.
Keep phase partial while named real acceptance/dependency remains unavailable;
do not use owes:walk to hide missing provider implementation.

## Settled serialization and mapping details

Let P be the strictly allowlisted public payload; D = SHA256(canonicalJSON(P)).
Artifact bytes are canonicalJSON(P) plus one LF. Artifact path contains D.
Return path, byte hash, Markdown and D beside P, not inside it. P contains
candidate-only inverse entry hashes, never a complete future inverse package.
A later inverse package can reference D without creating a hash cycle.

Public payload fields are an allowlist, not a spread of private configuration,
material or report objects: schemaVersion, kind, proposalRef, evaluationRef,
reportRef, reportDigest, reporterDigest, hypothesis, expectedBenefit, downside,
mechanism, scope, sourceLinks, baseRevision, candidateDigest, comparisonSummary,
mapping, inverse, disposition, limitations. Define strict nested schemas.
Comparison summary includes only named public case IDs/classes, raw counts,
discordance, resource coverage, criteria results, opaque attempt/evidence refs
and missing-evidence statements. Private source bodies, source locators,
environment settings, command argv, context text and private oracle paths never
enter public JSON or Markdown. Only explicit public candidate paths are exported.

For identity mapping require baseline-delivered material bytes at every changed
path to equal the real Git-base regular blob or real absence. Baseline overlays
differing from Git are not installed-base evidence. Derive inverse from verified
Git bytes, not an arbitrary baseline overlay. Path equality alone does not prove
runtime invocation/dependencies: readiness needs an explicitly supported delivery
route in the actual adapter; otherwise retain publication_mapping_unverified.
Do not invent a route attestation in the request or silently treat overlay
presence as evidence that the candidate was used. Missing provider/routing support
stays a named implementation gap, while an inconclusive package remains useful.

Rollback requests require an existing repair reference (phase or owner/repo#issue),
resolved through existing phase/issue readers; never create one implicitly.
The rolled-back compatibility view retains an explicit rollback banner and repair
link in addition to status proposed. Preserve original prose and prior history.

Review ordering is per immutable user ID over decisive APPROVED/CHANGES_REQUESTED
events; a later COMMENTED review does not clear an outstanding change request.
Dismissed reviews cannot approve. Verify exact selected review membership and
require the selected approval to remain the current applicable approval.
Provider submission and merge timestamps are source facts. Do not put a changing
local fetch clock inside the exact preview/output digest: preview/apply must be
repeatable for unchanged sources. Request.at remains manual transition attribution,
not authenticated approval time. Any nonbinding diagnostic fetch time must be
clearly separated from retained authorization and cannot affect derived permission.

## Final interface clarifications

request-rollback payload is exactly {proposalRef,promotionRef,repairRef}.
repairRef is {kind:"phase"|"issue",ref}; resolve existence and current source
identity in this same authorized repository. Issue/phase closure is reported
source state, not inferred acceptance or a reason to create replacement work.

Original reporterDigest remains historical. Revalidate with the retained v1
projection/arithmetic and bind a separate current verification digest to a new
decision. Never rewrite old report bytes or demand their original code hash
equal newly installed code. Unsupported historical semantics refuse readiness.

Package/record-package may describe the active proposal's retained evaluation
after evaluation, readiness, rejection, promotion or rollback; no evaluation
means refusal. Recording stays in the current lifecycle state. Initially omit
free-form commentary from exported packages; follow-up commentary stays explicitly
attributed in its own record and is not implicitly exported.

Follow-up request action is follow-up, routed through the follow-up verb, payload
exactly {proposalRef,decisionRef,window,selections,commentary,relation}.
window is canonical UTC {start,end}, start < end. commentary is
{text,attribution:"manual",actor}; relation is null or
{recordRef,relation:"related"|"replacement"}, resolving an existing record.
Selections may be empty for a purely attributed observation; that establishes no
recurrence or eligible exposure. With selections, verify/deduplicate actual
source refs. Record actual source-set coverage and null outcome-rate metrics.
Allow follow-up only for an active proposal with a retained evaluation in
evaluated, ready-for-review, rejected, promoted or rolled-back state.

Existing revise payload remains accepted for proposed/evaluated. Extend its
strict grammar with optional followUpRef only for reopening from ready-for-review,
promoted or rolled-back; those states require the ref to an existing follow-up
of that exact proposal. Preserve genuine-change checks and all historical
records; new versions start proposed with no transferred plan/evaluation.
Do not reopen rejected/superseded via this route without a separate explicit design.

Combined public JSON plus Markdown limit is 256 KiB, candidate maximum16 files,
and existing lower material/delivery/history bounds remain effective. Public
artifact metadata uses {path,byteDigest,byteLength}; internal verifier expected
delta carries UTF-8 bytes strings for artifact/before/after contents, never public
caller overrides. Binary or unavailable prior material makes inverse unavailable.

Current public CLI proof establishes useful inconclusive/unready packages and
disabled promotion. Positive pure lifecycle/arithmetic and independent real-Git
external-transport tests establish their own narrow mechanics. Do not seed a fake
verified-ready record or route attestation to manufacture a positive end-to-end
promotion walk. Missing route/provider capabilities remain explicit code gaps.

## Accepted internal approval API


validateLearningApproval(value)
  Pure exact {schemaVersion:1,provider:'github',ownerApproverIds:[1..16 unique IDs]}.
  Throws for malformed/unknown fields; absence handled by reader, not coerced.

inspectLearningApprovalPolicy({repo}, {env,deadline})
  No caller policy/root/config override. Fresh github.com canonical repository
  resolution and default branch commit/blob read. Returns:
  {schemaVersion:1, state:'not-configured'|'configured', repository, policy,
   sourceDigest, limitations}; policy:null only for proven absent subsection/file.
  Unavailable/partial/unsupported-host facts throw, never appear disabled/absent.
  repository exact {id,fullName,defaultBranch,defaultSha}; policy binding exact
  {sourceSha,blobOid,byteDigest,digest,approval}. No local fetch clock in binding.

verifyLearningMerge(expected, {env,deadline})
  expected is INTERNAL primary-derived authority, never copied from CLI JSON:
  {schemaVersion:1,repo,prNumber,reviewId,action:'promote'|'rollback',payloadDigest,
   baseRevision,artifact:{path,byteDigest,bytes},changes:[{path,before,after}]}
  before/after are null or {mode:'100644',byteDigest,bytes}; null->blob is add,
  blob->blob replace; blob->null allowed ONLY rollback's derived inverse.
  Artifact bytes/path are independently derived canonical package facts; verifier
  reads remote actual blobs and compares SHA256/size, not caller-supplied patches.

  Returns strict immutable-observation body:
  {schemaVersion:1,method:'github-learning-merge-v1',action,payloadDigest,
   repository,policy,basePolicy,review,merge,artifact,changesDigest,
   observationDigest,limitations}.
  review exact {id,reviewerId,reviewerType:'User',authorId,state:'APPROVED',head,
   submittedAt,bodySha256}; merge exact {prNumber,baseRef,baseSha,headSha,
   mergeSha,parentShas,baseTree,headTree,mergeTree,mergedAt,differenceDigest}.
  policy/basePolicy use above strict bindings; approval subsections must equal.
  Include complete decisive review-set digest in observationDigest, not just the
  selected approval, so newly outstanding changes requested invalidate approval.
  Primary stores only bounded selected facts and opaque hashes, not API bodies.

validateLearningPolicyObservation(value)
validateLearningMergeObservation(value)
  Deep exact validators for primary history parsing; no controller imports or
  evaluated-lessons dependency, avoiding cycles. Secondary may use existing pure
  fingerprint helpers. Expected nested schema must be confirmed before coding.

Both readers are read-only, write no cache/receipt, enforce finite requests/pages/
trees/blobs/output and overall deadline, and compare two fresh observations.
Use explicit --hostname github.com for gh API reads; no GH_HOST fallback.
Fetch all bounded review pages, validate immutable numeric reviewer IDs/types,
order decisive reviews per ID (timestamp then numeric review ID), refuse active
changes-requested from any reviewer, author self-approval and ambiguous data.
Verify selected review PR membership/current head and exact marker bytes.
Read exact Git objects; verify the two-parent topology and whole base/head diff,
not PR patch summaries. Recursive tree truncation is refusal. No POST/merge/push.
Tests fake only external transport and exercise actual generated local Git blobs,
trees and two-parent commits; no injected internal “verified” result.


## Review clarification — 24 October 2026

PR254 review identified that legacy accepted conflated reviewed source inclusion
with acceptance in inbox consumers. All promoted evaluations remain proposed in
the compatibility projection; the explicit evaluation history retains promotion.
This changes no human acceptance or production claim. Pending rollback likewise
remains proposed until the distinct rollback history event. No live controller
promotion was reachable or activated by this unreleased implementation.
