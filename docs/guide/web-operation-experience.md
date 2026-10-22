# Move between projects and resume your work

The [operation experience contract](../specs/web-operation-experience.md) defines
phase107's shared navigation, capability catalogue and private editor drafts.
Its implementation and real-service acceptance are tracked in
[phase107](../phases/107-mobile-and-desktop-cover-plates-operations.md). A catalogue
entry is not proof that an operation is enabled or executable on your instance.

## Choose the right lens

Home remains the place to see decisions needing you, tests to perform and recent
changes. Choose Fleet for the authorized projects together, or select one project
to see its records. Activity, Routines, Learning, Updates and Connections should
keep that project visible. More exposes less frequent destinations without
turning the Home screen into a command menu.

Changing project preserves filters that still apply, such as an activity time
window. A run, decision or operation receipt belongs to its original project;
changing lens opens the corresponding index in the selected project. It never
changes a receipt's identity or transfers a pending action to another repository.

## Find an operation

Operation coverage groups tasks by what you want to do. Open an entry to see its
supported web treatment, the relevant destination, required access and any limits.
Advanced detail maps CLI forms and arguments for people who need that comparison.

- **Native:** a purpose-built web flow exists for the stated subset.
- **Worker:** a specific supported worker performs the stated operation.
- **Presentation-only:** a CLI option changes presentation rather than an action.
- **Limited:** the operation or variant still needs the named implementation.

These describe implementation. Instance activation, access, source compatibility
and budgets are separate. “Disabled here” needs the named setup; “unsupported”
needs code. “Unverified” means the catalogue has not established the required fact.
The actual destination rechecks current access and source before offering an action.

The supported typecheck retry is not a retry of an arbitrary failed night.
[Night controls](web-night-operations.md) provide a separate registered canonical
night adapter and reviewed plan publication. General robot execution, unregistered
night workflows, local runner operations and subscription model execution remain
explicit gaps. Update PR creation is also distinct from merging a PR or
observing its installed version. The full fleet goal stays open across these gaps.

## Save a draft deliberately

Guided walks retain their existing private save/resume and observation history.
Phase107 adds typed private drafts for daily plans, model source selections and
instructions, and model policy edits. Other forms remain memory-only unless they
explicitly offer the private draft controls.

A confirmed saved draft can be loaded after signing in on another authorized
device. Saving a draft changes neither the project source nor any approval. The
app rechecks the current source when you restore it; changed source requires a
fresh review even when your authored text is still useful. Drafts expire after
30 days. The initial private store has an instance-wide limit of 1,000 rows and
50 MiB of encrypted payloads; it reports capacity problems explicitly. Opening a draft may reserve an
empty metadata row to prevent stale saves from becoming valid after cleanup.
Only an explicit save retains authored content. Storage must be enabled and
verified before these controls are available.

Treat these states differently:

- **Saved:** the private store confirmed this revision.
- **Unsaved:** edits remain only in the open page.
- **Save unconfirmed:** the response was lost; check saved state before trying again.
- **Conflict:** another session saved a newer revision; compare before replacing it.
- **Source changed:** the authored draft remains available, but its old review does not.

Offline unsaved edits can be lost when a phone closes a background tab or kills
its process. Navigation warnings cannot prevent that. Plates does not copy private
form content or credentials into browser persistence, and reconnect never silently
submits an operation. Save while connected before changing devices.

## Return after session expiry or a lost connection

Sign in from the expired-session page to return to its validated destination.
For an uncertain operation, keep the original receipt and inspect or reconcile it.
Do not create another operation just because a response was lost. Fresh login does
not restore an expired preview or grant permission to run it.

Previously rendered offline content is only the last observation. New navigation
and fresh data may be unavailable. Reconnect can refresh a read; it does not count
model tokens, run a worker, save a draft, publish a change or upload a capture on
your behalf. If project access was removed, private content is cleared and a saved
draft cannot be retrieved through the former grant.

## Setup and acceptance

Private editor drafts use a separate encrypted runtime store and SQL012. This is
outside the public code repo and private Git source records. Activation requires
its approved migration, scope/CAS/expiry proof and a verified deployment; migration
files in the source tree alone do not establish a hosted service.

The acceptance walk uses actual mobile and desktop browsers to investigate a run,
record a test, inspect/update a project and inspect capacity. Record terminal
detours, source gaps, expired-session recovery and offline behavior. Local synthetic
screenshots help inspect the interface; they do not replace that owner exercise.
