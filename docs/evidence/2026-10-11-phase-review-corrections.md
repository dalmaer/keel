# Evidence: phase review corrections

- Date: 2026-10-11
- Phases: 58, 63, 64, 66
- Revision: `633b3fe` and working tree.
- Claim: late findings on PRs #102, #103, #104 and #106 are corrected without treating merge as acceptance.

## Corrections

- Guide destinations reject the adoption report and collisions through filesystem case, hardlink and symlink identities before writes. Metadata aliases stay reserved. Seeded nested lesson destinations are encoded; invalid guide paths return usage status 2.
- Milestone source gaps ignore persisted loose-end marks and refuse new marks; an unavailable read cannot disappear because an earlier gap was dismissed.
- Measurement and rule-cause advice track fences before HTML comments. Indented measurement examples are excluded while nested list prose remains visible. Windows retains preview and validation tests; POSIX-only execution assertions are guarded.
- Hygiene uses Git's path-filtered blob for published identity and an optional raw SHA-256 digest for working-copy freshness. Legacy proposals remain readable; new digest-bearing instances distinguish changed raw bytes. Filter errors are unavailable, not healthy zeros. Git uses its repository-configured filters; these are ordinary Git commands, not sandboxed programs. POSIX filter groups have bounded teardown; native Windows descendant cleanup is not claimed.
- Generated markers must occur in a leading comment header. Configured in-repository health-directory aliases retain canonical report/decision identity; page aliases and out-of-repository targets remain refused.

## Verification

The conductor independently ran the loose-end, evidence and Markdown regression files: exit 0, 38 tests passed. The guide/adopt/doctor/update run passed 110 tests before the subsequent metadata-alias regressions; the final integrated proof includes those regressions too.

Generated `keel prove` receipts against `633b3fe` demonstrate red without each production correction and green with it: guide validation, gap marking, fence/comment parsing, indented code, generated headers, canonical Git blobs, digest propagation and health aliases. Their exact generated trailers belong to the fix commit. Native macOS filesystem checks and synthetic win32 path resolution are distinguished; no native Windows execution is claimed.

Final conductor focused run: `node --import ./tests/helpers/hermetic.mjs --test tests/guide.test.mjs tests/hygiene-measures.test.mjs tests/hygiene-proposals.test.mjs tests/improve-measures.test.mjs tests/phase64-markdown-advice.test.mjs tests/loose-ends.test.mjs tests/evidence.test.mjs tests/board.test.mjs`, exit 0, 187 passed. `npm run render` and `npm run roadmap` exited 0.

A read-only production `longFiles` audit at 2026-10-11T08:15:56Z returned five long source files with complete current coverage (693 tracked, 203 scanned, 490 excluded); five bounded histories remain incomplete. The existing real `tests/workflows.test.mjs` proposal still parses and its canonical blob remains `6b298b8ec57c2763971ff3a9b635db704ccb87b6`. No health page or remote object was changed by that observation. The final recorded tree is checked with `npm run check` and `npm run typecheck`; their results belong to the commit body and exact-revision CI.

## Integrated compatibility correction

The first integrated gate found one failure among 1,496 tests: ordinary proposal decisions outside the health directory were incorrectly restricted by the alias fix. The correction retains the existing strict regular-file path first and permits the configured health alias through its separate canonical check. A new regression preserves ordinary non-health files and refuses other aliases. The full gate is repeated because the implementation changed; the initial failure is not treated as a flake.

## Follow-up review

PR #107 identified the standard Go `Code generated … DO NOT EDIT.` header, which must remain excluded while ordinary later comments stay eligible. The correction has a generated VERIFIED regression against `6bbf0f6`, including a tracked `.pb.go` file and the absence of a split proposal. The final gate runs again on this recorded correction.

## Second review pass

The independent connector review arrived during the final pre-merge check, so PR #107 was held. Its additional findings are addressed before merge: C# generated-file banners retain header-only exclusion; legacy pre-digest proposals retain their lifecycle for the same subject/blob; ordinary alias decisions use and revalidate a canonical page and diff its tracked path; case checks inspect entries in the compared directory rather than its parent. Empty or unprobeable directories conservatively reserve case-only variants; no case behavior is inferred from the parent. Synthetic per-directory mapping tests are not a native Windows walk. Generated regression proofs for this pass use `5ac77ac` as the base. The conductor reran the measure/integration files (43 passing tests) and guide/proposal/CLI files (see final gate for integrated counts). No owner acceptance is inferred from the review.

## Generated-banner grammar

A further review identified Rust bindgen's standard `automatically generated` header. Recognition now covers explicit leading file/code/class generation declarations, including optional `NOTE:`, alongside Go/C# markers. Negations, ordinary value descriptions and later comments remain ineligible as generated-file authority. The tracked Rust-bindings regression has a generated VERIFIED proof against `3f8e2f3`; the four header-family tests and final gate cover the combined behavior.

## Still owed

The existing owner/pilot requirements of phases 58, 63, 64 and 66 remain unchecked. Phase 50 still requires the public conditional-edit API and its recorded browser/workflow/scheduled-use walks. These corrections neither enable robot spend nor create a real issue, delete worktrees, alter draft PRs, or establish production acceptance or lived-in use. Historical report observations are preserved.
