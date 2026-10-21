# Explore changes and keep captures private

Home's **Recently added** cards lead with what you can do now, a real capture or
its explicit absence, attributed availability, a try link and the corresponding
guided walk. Open **Changes** within a project for its journal, or **Private
media** for original capture receipts. Legacy phase/commit cards remain when no
change packages are authored.

This is implemented application behavior, not proof that a media bucket has been
activated or that an owner has verified a real deployment. [Phase 99](../phases/99-recent-changes-are-visible-and-testable.md)
retains those separate checks. No bucket is provisioned by starting the service.

## Author a change package

Add `docs/changes/<stable-id>.json` to the project repository. The source owns the
change description; private attachments do not edit it. This example needs actual
immutable revisions and source paths before it can be used:

```json
{
  "version": 1,
  "id": "acme-search",
  "title": "Find Acme things",
  "outcome": "Search and open an Acme item.",
  "kind": "ui",
  "publishedAt": "2026-10-21",
  "revision": "<40-character implementation commit>",
  "paths": ["src/search.mjs"],
  "pr": null,
  "availability": {
    "state": "preview",
    "environment": "Acme staging",
    "observedAt": "2026-10-21T12:00:00.000Z",
    "observedRevision": "<40-character observed commit>",
    "reason": "The author observed this staging revision."
  },
  "preview": {"url": "https://preview.acme.test/search", "reason": null},
  "explore": ["Search for Acme.", "Open a matching item."],
  "walk": {"id": "acme-search", "reason": null},
  "captures": [
    {"id": "desktop-after", "role": "after", "revision": "<implementation commit>", "viewport": "desktop", "scenario": "Search results", "reason": "Desktop capture not attached yet."},
    {"id": "mobile-after", "role": "after", "revision": "<implementation commit>", "viewport": "mobile", "scenario": "Search results", "reason": "Mobile capture not attached yet."}
  ],
  "nonvisual": null
}
```

The file name matches the stable ID. UI packages require desktop and mobile after
slots with explicit reasons until captures exist. Each after slot binds the
implementation revision; before slots bind their own immutable revision. Keep
slot IDs stable. Changing capture requirements makes earlier attachments stale;
changing a display title or order does not erase their provenance.

Use one of the availability states shown here:

```json
{"states":["source-only","preview","awaiting-deploy","serving","verified"]}
```

Availability is visibly a project-source declaration, never an independent
production observation by Keel. A matching walk must name the same result
revision and environment; otherwise the UI explains why it cannot offer that
walk. A screenshot does not establish serving state or human acceptance.

A nonvisual package uses a concrete supplied excerpt and source path, or a reason
it is unavailable, instead of artwork. Source reads are bounded to fifty packages,
128 KiB each, with explicit gaps for invalid or incomplete reads. Home further
bounds its recent journal payload; the full journal remains linked separately.
The [source contract](../specs/web-visual-journal.md) describes exact authority and
validation boundaries.

## Review and upload a capture

From a change, choose **Review or attach private captures**, select its authored
slot and choose a PNG or JPEG. The service accepts at most 2 MiB, 12 megapixels
and 8192 pixels per dimension. SVG, HTML, remote image imports and arbitrary
embedded frames are not supported.

Enter the actual environment, CSS viewport width/height, capture time in UTC,
caption and useful alt text. The slot supplies the required revision, viewport
category and scenario. **Review file and provenance** shows the actual selected
image, its checksum and the exact metadata. Review possible private content, then
explicitly confirm the upload. Files and metadata stay private even for public
project repositories; this flow never publishes or updates source records.

Before/after views require current captures of the same scenario, environment
and CSS viewport dimensions. Different device pixel ratios can produce different
image pixel dimensions, which remain visible. Images that cannot be compared are
shown separately with an explanation. Enlarge with the keyboard, close with Escape
or the Close button, and return to the originating link.

An upload first reserves a durable private intent. A lost response retains its
request identity in the receipt URL. Use **Check original receipt**; it looks up
that request and checks the original stored object, without sending another
upload. A verified object may attach only if its source requirements and previous
slot revision still agree. A newer attachment is never silently replaced by an
older concurrent upload. An unattached artifact remains in the library.

The bounded library lists saved receipt state without fetching every object.
Opening a receipt checks the object and distinguishes missing, expired, tampered
or unavailable bytes. Delivery checks current membership on every request and
uses authenticated same-origin routes, not reusable public URLs. Image errors
retain a useful message and a link to inspect the original receipt.

## Retention, deletion and capacity

Retention is chosen by the owner, from one to 365 days. Expiry denies normal image
delivery but retains the receipt. There is no background deletion. **Review
artifact deletion** identifies one exact artifact, hash, byte count and captured
revision. Confirm those bytes explicitly. Delivery stops when deletion is
reserved; capacity is released only after the original object's absence is
verified. An uncertain deletion keeps its receipt and reserved capacity.

A prepared intent that never dispatched still reserves capacity. This slice has
no cancel/reclaim UI for prepared uploads; it requires operator inspection.
Uncertain uploads also retain their reservation. Do not retry an upload to work
around either state. Existing records survive capacity refusals.

Application limits are at most 256 MiB reserved ciphertext, 1,000 receipts and
50 MiB encrypted metadata per configured scope, with thirty receipts per page.
The configured byte limit may be lower. These are application caps, not a promise
of the provider's free allowance or an authorization for a paid upgrade.

## Configure the optional adapter

Complete [the private service setup](web-auth-service.md). Apply migrations 001
through 006 in order, including
[006-private-media.sql](../../lib/web/migrations/006-private-media.sql), to the
approved private database. Verify hosted role and concurrency behavior separately
from local adapter tests. Creating or enabling a bucket needs the owner's approval
of the exact destination and retention setting; existing database approval does
not create that permission.

After approval, add this nonsecret member to the existing instance configuration:

```json
{"media":{"bucket":"acme-private-captures","retentionDays":30,"capacityBytes":268435456}}
```

Use the actual approved bucket ID. The existing server-only service credentials
access the private bucket; browser credentials cannot. The adapter verifies bucket
identity and that it is private. Objects are encrypted with project/artifact
scope. Missing configuration gives a useful unavailable state on Home rather than
turning missing media into an empty successful observation. No paid resource,
automatic cleanup or public export is assumed.

## Personal journal filters

**Since last visit** is a personal timestamp preference scoped to the signed-in
workspace, user and project view. First use explicitly shows the last seven days.
Publication records have day precision, so the entire previous visit date is
included; some additions from that day may already be familiar. First use includes
seven whole publication days. Only up to fifty view timestamps are retained locally; no private snapshots,
image bytes or credentials enter that preference. Date filtering never changes
acceptance or hides required decisions and walks. New Home observations remain
behind **Show changes**, preserving the card and keyboard focus you are reading.
