# Evidence: phase 64 — rules with causes and dated measurements

- Date: 2026-10-11
- Phase: 64
- Revision: `52bf189` and working tree; implementation working tree before its phase commit.
- Claim being checked: rendered rules explain their cause, missing dates/causes are advisory, and explicit measurement records can be rederived without rewriting history.

## Recorded observation — 2026-10-10

The conductor directly ran the argument array below on 2026-10-10 at 23:57 MDT, during the phase 63 working tree based on `df58dd7`: exit 0, 3,113 characters in the cold-start portion of `lib/agent-guide.md`. This is a character count, not a startup-time or speedup claim. The record is executable input for phase 64's real re-derivation proof; it is not rewritten when the current count changes.

```keel-measurements
[
  {
    "id": "agent-cold-start-characters",
    "argv": [
      "node",
      "-e",
      "const f=require('node:fs');process.stdout.write(String(f.readFileSync('lib/agent-guide.md','utf8').split('<!-- topic:')[0].length))"
    ],
    "cwd": ".",
    "value": 3113,
    "unit": "characters",
    "date": "2026-10-10"
  }
]
```

## Verification — 2026-10-11

Conductor commands, all exit 0:

- `npm run render`: refreshed managed copies from the changed practice sources.
- `node --import ./tests/helpers/hermetic.mjs --test tests/lessons.test.mjs tests/practices.test.mjs tests/roadmap.test.mjs tests/evidence.test.mjs tests/cli.test.mjs`: 87 tests passed. Tests cover shipped causes, advisory missing causes/dates, strict dates and record validation before execution, direct argv, numeric unavailable results, lazy loading, output limits and descendant teardown.
- `node /tmp/keel-phases-50-66/64-real.mjs`: production `rederive` preview then execution of this record returned old 3,113 characters (2026-10-10), new 3,166 characters (2026-10-11). SHA-256 before/after comparisons confirmed the phase and historical evidence were unchanged. This larger count is not a performance improvement.
- The same real proof called production `render('/Users/dionalmaer/code/ledger', {check:true})`: 59 rendered entries, including three managed guide blocks with causes. Ledger's AGENTS.md, config and lock hashes were unchanged. This proves a preview against the actual adopted configuration, not a published update or an owner read.

The advisory corpus scan returned 59 notes (34 evidence, 25 research). The dated
heading/item heuristic deliberately does not inherit unrelated introductory
paragraphs or filenames. Historical records were preserved; advice neither
fails the gate nor claims the observations are false.

The first integrated run found two skill-document assertions that assumed no
cause annotation between sentences (1,391 of 1,393 tests passed). The assertions
were updated to preserve the semantic checks while allowing cause annotations.
`keel test tests/evidence.test.mjs --stalls --json` exited 0, seed 1925785920:
12 tests ran plainly and with stalls, with no failures, missing tests or
inconclusive comparisons. The file is pinned for future stall checks.

Gate to run on the final recorded tree: `npm run check` (tests, hygiene, stall
coverage, roadmap, rendered copies and inbox), plus `npm run typecheck` for the
explicit production JSDoc scope. Results belong to the commit body and CI.

## Still owed

The owner reads the causes in AGENTS.md and identifies obsolete rules or confirms
they remain useful (15 minutes). No acceptance is inferred from a merge or render
preview. No production adoption or lived-in use is claimed. Windows can preview
records but cannot execute them: POSIX process groups provide the implemented
ordinary-descendant cleanup. Measurement programs retain the caller's permissions;
time/output limits are not a sandbox.

## Review correction — 2026-10-11

PR #104 identified an executable fence inside an HTML comment. The parser now
tracks comment state outside code fences; retired/commented records stay inert,
while literal comment markers in JSON argv remain exact. Regression cases also
cover unfinished comments and ordinary fences hidden inside comments. The
conductor checks the correction with `keel prove tests/evidence.test.mjs --name
'^PR104:' --fix lib/evidence.mjs --base ccb3dcb --trailer`; its generated verdict
belongs to the fix commit, followed by the final gate on this record.
