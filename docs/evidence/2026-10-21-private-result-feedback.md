# Evidence: phase 92 — feedback stays attached to the result reviewed

- Date: 2026-10-21
- Phase: [92](../phases/92-feedback-names-the-result-reviewed.md)
- Revision: `517ff8c8fc1266ec4f82914296db0099918e12f7` plus the working tree for
  `phase 92: Feedback names the result the owner reviewed`.
- Claim: explicit local capture retains exact result bytes and revision history;
  publication remains an independently approved issue or shaping handoff.

## Automated checks

The conductor ran the named feedback files together with the changed board and
CLI files:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/feedback.test.mjs tests/feedback-route.test.mjs tests/feedback-cli.test.mjs tests/board.test.mjs tests/cli.test.mjs
```

Exit 0: 82 tests, 82 passed, 0 failed, duration 39728.898042 ms. This exercises
immutable retained bytes, replay/edit/history, simultaneous stale writes,
missing/corrupt results, explicit resolutions, capacity, exact outbound issue
identity, uncertain-write recovery, and the real phase-91 shaping inspection.
The capacity test retains 1000 valid histories and refuses the next observation;
the byte limit test preserves existing records when capacity is exhausted.

Privacy checks exercise real Git negations at snapshot, revision and temporary
paths, actual adopted-project `npm pack`, and ordinary canvas/night artifacts.
Invalid UTF-8 JSON and coercible array/number references are rejected. Selected
result bytes remain binary-exact. Original authored input files are caller-owned;
retained copies are the store's responsibility.

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/docs.test.mjs tests/helpers.test.mjs
npm run typecheck
git diff --check
```

Each exited 0; documentation/helper tests passed 7/7. Typecheck retains its
existing selected-production scope; this is not a claim of whole-repository
static coverage. After the browser found a source-footer wrapping defect,
`node --check lib/board.mjs` and `git diff --check` exited 0 and the actual
packaged browser was rechecked as described below.

The integrated gate is `npm run check` through `keel ready` / `keel integrate`.
It covers tests plus roadmap, render and inbox guards on the recorded tree.
Its result belongs in the integration receipt and a later evidence addendum,
not a prediction here.

## Published-package and adopted-project surface

The conductor packed the working tree using:

```sh
npm pack --ignore-scripts --json --pack-destination /tmp
tar -xzf /tmp/keel-0.8.32.tgz -C <disposable-directory>
```

Both exited 0. The extracted version was 0.8.32; initial archive SHA-256 was
`1d22a94a4421ebcbc1bc03a465287ef0207b9b95008bbf3646d66a532dc75d52`.
This was an extracted local package, not a new registry publication.
A fresh Acme Git project with no dependency on the source checkout exercised
27 fresh-process commands. Inputs lived in a separate private directory.

```sh
node <extracted>/bin/keel.mjs adopt --check 'node --check acme.mjs' --json
node <extracted>/bin/keel.mjs --agent-help feedback --json
node <extracted>/bin/keel.mjs feedback capture <private-capture.json> --json
node <extracted>/bin/keel.mjs feedback capture <private-capture.json> --yes --digest <preview-digest> --json
node <extracted>/bin/keel.mjs feedback list --json
node <extracted>/bin/keel.mjs feedback propose <id> --record <private-publication.json> --json
node <extracted>/bin/keel.mjs feedback resolve <id> --record <private-resolution.json> --json
node <extracted>/bin/keel.mjs feedback resolve <id> --record <private-resolution.json> --yes --digest <preview-digest> --json
git add .
git diff --cached
npm pack --ignore-scripts --dry-run --json
```

Observed: adoption preserved owner prose and shipped help was available.
Capture preview exited 3 without creating storage; changed source words refused
with exit 2 under the old digest. Approved capture exited 0. Deleting the
original result still left complete retained coverage. Identical replay returned
unchanged. Proposal exited 3 without an issue journal or provider write.
Resolution preview exited 3 and application exited 0; a new authored revision
returned to pending while old history remained. A zero digest refused with exit
2. A new result bound to a GitHub issue with an unavailable adapter exited 2,
explicitly unavailable. Two distinct observations remained. Git staging and npm
export contained neither retained private files nor the synthetic private text.

Local command/output receipt: `/tmp/keel-phase92-surface.json`; verification
script and output: `/tmp/keel-phase92-surface.mjs` and
`/tmp/keel-phase92-surface.log`. These are machine-local scratch evidence; the
committed packed/adopted test preserves the repeatable lifecycle.

## Browser walk on the owner's machine

The extracted CLI served the same disposable Acme repository on loopback using
`keel board --port 43192`. No server or provider facade supplied feedback:
the board read the retained store created by the lifecycle above. Unavailable
GitHub and missing roadmap sources remained visible gaps.

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Open packaged board with two pending observations | Safe metadata without raw words | Two pending IDs, coverage and local review command; private sentinel absent from rendered text | Real board projection, not hosted web capture |
| View at 360 × 800 | Readable narrow layout | Initially 394 px document width from an existing long source-gap path; fixed source wrapping and repacked; final document width 360 px and feedback panel 328 px | Browser viewport, not physical phone use |
| View at 1280 × 900 | Readable desktop layout | Document width 1280 px, no horizontal overflow | Desktop browser layout |

Final archive after the CSS correction:
`f491618fec5b3981b3c78ff8436a5692e610d0cf5ed5ee8cf3997164a3b8b9b8`.
Screenshots remain outside Git at `/tmp/keel-feedback-board-mobile.jpg` and
`/tmp/keel-feedback-board-desktop.jpg`; the mobile capture was shown to the owner.
The temporary server and tab were closed and the viewport override reset.

## Review and changes of course

Independent review found two privacy assumptions that did not hold: Git's local
exclude does not protect an adopted npm package, and one ignored sentinel does
not prove every destination is ignored. The design was corrected before the
implementation: store-local npm exclusion plus actual destination checks.
Conductor probes also found UTF-8 replacement and reference coercion; focused
regressions now cover both shapes.

A generic reopening tag was insufficient to hand work to phase 91. An authored,
validated shaping record is now required; the implementation does not invent a
goal, proof command or owner answer. The returned record runs through actual
`inspectShape`, with canonical references freshly resolved and manual attribution
preserved. Final independent review reported no remaining actionable findings.

Fresh phase-92 context at dispatch/resume was `not-configured`, with latest digest
`3def18ca58bd85af4e2e9d42b6613e9f28dd1040d8ef0be68c31e80dacc624f8`.
This is legacy behavior, not verified architecture coverage. Phase claim ownership
was revalidated before resuming builders.

## Gaps and decision

This supports **built** for the local slice, not lived-in or hosted behavior.
Automatic provider comment collection is unavailable. No real issue was posted,
no agent was started, no owner choice was fabricated and no phase was accepted.
Crash locks fail closed; the guide documents owner-confirmed stopped-writer
recovery while preserving records and incomplete data. There is no automatic
cleanup, export or lock takeover. Actual usefulness and live adapter behavior
remain separate owner evidence. Phase 98 still owns hosted guided walks.
