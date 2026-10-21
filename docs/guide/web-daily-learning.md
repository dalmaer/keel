# Daily work and private learning

Open **Daily work** from Home to choose an authorized project, or use a project's
Daily work link. Select the night date in UTC. The page retains the winning item
source and the complete original records from known night branches and the default
branch. An item recorded as done is a source observation, not project acceptance.
Expand source details to compare its path, revision, blob and original status.
Missing, invalid and unavailable reads stay visible as coverage gaps. Access
denial clears protected output and requires current authorization again.
Home's small daily summary reads only the latest bounded default-branch record;
open the daily page for the additional known night sources.

The budget view separates explicit configured allowance, allocated plan minutes
and observed actual usage. Unknown usage is not zero spend. Climb allowance and
jobs are declarations from project configuration; absent defaults or invalid
values stay unavailable. The web reader does not execute project scripts or
claim to validate the complete runner configuration. Weekly allowances and
per-run allowances remain separate.

## Shape an unsaved evening draft

Edit an available authored plan, choose eligible lanes and allocations, and use
**Validate unsaved preview**. The server checks fresh source identity, canonical
plan shape and the observed lane limits. The result shows the entire unsaved plan
and any validation problems. A changed source requires a new inspection. Editing
while validation is in flight invalidates that response.

Draft text exists only in the current page. Leaving or reloading loses it; it is
not stored in localStorage, saved to a repository, published or scheduled. The
CLI command is a copy control, not execution. The existing explicit workflow is
`keel goodnight`; inspect its selected plan and authority before running it in an
authorized checkout. Hosted execution and publication are unavailable here.

## Inspect lessons and their origins

Project **Learning** reads the project's configured lesson table. **Workspace
learning** reads typed lesson records only from the pinned private workspace
repository. Records keep their source repository, path, revision, blob, row and
fingerprint. Similar shapes are not silently merged. An absent catalogue is shown
as absent; unavailable coverage does not become an empty success.

Import actor and time fields are declared source attribution. They do not prove
who authenticated or performed a transfer. A separately verified operation receipt
establishes the observed private copy.

## Review a private copy

Select one to three project records and choose **Review private copy**. Inspect
the private destination, every complete new file, commit message, source revision,
review digest and expiry. The only destinations are new typed lesson files under
the workspace's lessons directory. Existing different content is never overwritten;
identical existing content is a read-only no-op. Originals stay in their projects.

The independent workspace-write setting is off by default. A preview remains
readable when submission is disabled and explains the refusal. Enabling a private
copy requires separate owner approval for the deployment setting and GitHub App
Contents-write access. It does not enable project decision writes or enlarge
budgets. **Setup** displays these nonsecret capability states and authorized
projects; it does not activate resources or expose credentials.

When submission is enabled, explicitly approve the exact preview before copying.
Bookmark the original receipt link before submission. A lost response, missing
receipt or uncertain state means **Check original receipt**, never another copy
request. Recovery only reads the original operation. Success appears only with a
verified commit and file receipt. Revoked access, changed source, changed private
visibility or a stale destination requires review; a verified copy does not permit
removing originals or establish project acceptance.

## Download only explicitly reviewed text

Select one to three records and write the complete outbound text in the export
editor. No private citations, source URLs, feedback, images or hidden metadata are
added automatically. Review every character of the exact preview and explicitly
approve its digest. Editing the text or selection invalidates the preview.

The authenticated download rechecks current access and selected source identity.
It returns only the approved UTF-8 text as an attachment named
`keel-reviewed-lessons.txt`, with no-store response headers. The client checks the
received bytes against the approved text before offering the file. This is not
anonymization and it does not publish anything. Any later publication is a separate
owner-authorized action.

## Verification scope

These screens and routes have [dated adapter, browser and real-source evidence](../evidence/2026-10-21-web-daily-learning.md), including desktop/mobile screenshots. A local
Acme copy or download is not evidence of a real workspace migration. Deployment,
the owner-selected real-record copy, its recovery walk and comparison against
actual GitHub nightly records require their own evidence. Source-write gates stay
disabled until separately approved. See the [contract](../specs/web-daily-learning.md)
and [phase](../phases/100-daily-work-and-learning-stay-private.md) for current status.
