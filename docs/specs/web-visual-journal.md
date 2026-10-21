# Visual changes and private captures

This contract narrows phase 99 to a usable journal backed by source-owned change
packages and a private media library. No bucket is provisioned by reading or
starting the application. No source record is automatically published by uploading.

## Records and authority

Project-owned `docs/changes/<stable-id>.json` records group a user-visible change:
title, outcome, UI/nonvisual kind, publication date, implementation revision,
source paths, optional PR number, availability observation, preview URL or reason,
short exploration steps, a matching authored walk or an explicit reason, and
bounded capture slots with explicit desktop/mobile unavailability reasons until a private capture is attached.

Use a strict version-1 schema with bounded counts/text and exact keys. At most
50 change packages and 128 KiB per record within the existing source read budget;
report incomplete/invalid input as coverage gaps. IDs and paths must match. No
repository code, HTML or URL content is executed/fetched. URLs are HTTPS anchors
without embedded credentials; links to source commits/records are constructed
from the authorized repository identity and immutable revision.

Resolve the implementation revision and referenced record through the actual
read-only GitHub adapter. A repository declaration of serving/verified status is
visibly attributed to that source; it is not independently observed production.
The package links the phase-98 walk only when its result revision matches. A
changed environment or mismatched walk stays explicit rather than silently
pointing at unrelated instructions. Before/after comparisons require matching
viewport and scenario; name both captured revisions.

Capture slots have stable IDs, before/after roles, exact captured revisions,
expected viewport and scenario, and an unavailability reason when empty. An after
slot binds the implementation revision; a before slot names its own revision.
An attachment is private workspace state keyed by project/change/slot and a digest
of that slot's immutable capture requirements. It contains an opaque artifact ID
and checksum, actual environment, viewport, scenario, capture time, caption and
alt text. Source records never need public copies of private capture metadata.
The receipt retains the original source head and slot requirements. Changed slot
requirements make an old attachment stale, while display-only title/reordering
changes do not. Historical artifacts remain inspectable in the private library.

Captures are shared by the instance's currently authorized owners for that
project; uploader attribution is retained. This differs from an individual's
private testing draft. Request identities also include the initiating actor,
so two owners choosing the same client request ID cannot claim one another's
upload. Slot replacement uses project-scoped compare-and-swap. Every delivery,
list, recovery and mutation still checks current project authorization.

UI work needs desktop/mobile slots or explicit reasons; nonvisual work uses a
bounded supplied excerpt with provenance or a reason. No generated artwork stands
in for evidence. Bytes, storage identity and declared provenance can be checked;
they do not independently prove how the owner took the picture or whether the
product works. Screenshots never complete human acceptance.

## Upload, private delivery and lifecycle

Explicit authenticated owner uploads accept PNG/JPEG only, max 2 MiB and bounded
pixel dimensions (12 MP, each dimension at most 8192). Verify signature/structure
and dimensions, reject malformed/executable formats, and bound reads before
allocation. No arbitrary remote URL import. Browser selection is deliberate;
show the selected image and metadata for confirmation. No implicit captures.

Store ciphertext in a separately configured private Supabase Storage bucket,
using native HTTP and existing production service credentials. Keep the bucket
binding and owner-chosen retention in nonsecret configuration. Verify the
configured bucket identity and public:false on access; unavailable configuration
or public buckets deny delivery and upload. Storage keys are server-assigned,
opaque, and immutable. Never issue signed public/bearer delivery URLs or expose
provider credentials. Serve through authenticated per-project Keel routes with
private no-store, nosniff, fixed raster MIME and bounded bytes; every request
rechecks current project membership. Encrypt using a scoped purpose so ciphertext
cannot be moved between projects/artifact identities and decrypted successfully.

Before an object POST, durably reserve a unique upload intent and its ciphertext
capacity in the transactional store. Store encrypted metadata/receipts separately
from object bytes; direct browser database roles are denied. A CAS transition
allows only one upload dispatch. Retry/uncertain outcomes recover the original
object identity with bounded reads and digest validation; no upsert, duplicate
POST, new key or guessed success. A request can recover a receipt even if it lost
the first response. Keep unknown results visible and charge their capacity.
Only a verified stored object may become the current slot attachment, using a
CAS against the previous attachment revision. Recheck current source requirements
before attaching; a lost source/read or changed slot preserves the artifact and
receipt without claiming a current attachment. A conflicting upload cannot replace
a newer choice, and deletion cannot race an upload still able to dispatch.

Retain per-artifact uploader, project, original source/change identity, byte hash,
provenance, expiry and outcome. Owner selects retention 1–365 days; expiry denies
normal delivery but preserves the receipt and marks the capture expired. No
implicit physical deletion. An explicit reviewed delete targets one verified
artifact; reserve it first, deny delivery, use the Storage API, and preserve
uncertainty until the same original object's absence is verified. Never SQL-delete
object metadata as a substitute. Only verified removal releases byte capacity;
keep the bounded receipt. Busy/unresolved uploads cannot race deletion.

Use hard application limits below the Free project's included storage; metadata,
number of receipts, per-project list/page reads and total reserved ciphertext are
bounded. Capacity failures preserve old observations and show an operator action.
No background cleanup or paid upgrade is assumed. Missing, expired, tampered,
not-configured, unauthorized and provider-unavailable states remain distinct;
unauthorized callers receive no existence oracle.

## Browser experience

Home and project views lead with the user-visible result, a capture or useful
reason, attributed availability, Explore/Try and the matching guided walk.
The detail view shows exploration steps, desktop/mobile captures, keyboard-safe
enlargement and comparable before/after views, then source/provenance details.
Image errors leave meaningful text. Do not take over focus when sources change;
retain the existing queued update behavior. A personal since-last-visit filter
never changes acceptance and uses a named time range for first use.

The project media library supports explicit upload, original receipt/recovery,
expiry/missing states, exact attachment/provenance preview and explicit deletion.
Uploading and attaching to an authored slot stay private. A capture never edits
project-owned source or authorizes Contents-write. Public export of either bytes
or metadata is outside this phase; there is no automatic copy-to-public workflow.

## Approval and proof

Build/test against synthetic Acme adapters first. No new cloud resource is
approved by this contract. Once the code and configuration are reviewable, ask for
the exact private bucket and retention setting, with the current Free allowance
and no paid upgrade. The owner then enables the adapter and performs the real
captured-addition walk. Hosted schema/role/concurrency checks are separate from
isolated PostgreSQL assertions. Main merge, deployment, real operation and
lived-in use remain separate evidence.

Required checks include source validation and historical revision resolution,
private route access/CSRF/Origin, arbitrary fetch and executable rejection,
byte/pixel limits, encryption scope/tampering, transactional races/capacity,
uncertain uploads/deletes and recovery, exact metadata mismatch, stale walks,
expired/missing states and actual mobile/desktop keyboard/browser behavior.


## Provider contract sources

Inspected 2026-10-21: [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[Free storage allowance](https://supabase.com/docs/guides/storage/pricing),
[upload API](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts),
[bucket identity API](https://github.com/supabase/storage-js/blob/master/src/packages/StorageBucketApi.ts),
and [object deletion](https://supabase.com/docs/guides/storage/management/delete-objects).
Use the Storage API for bytes and the transactional RPC for Keel receipts;
neither substitutes for the other. Existing approval of the database does not
create or configure a media bucket.
