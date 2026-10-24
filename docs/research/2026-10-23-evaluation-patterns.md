# Evaluation patterns: decisions from source inspection

Research date: 23 October 2026. Plates baseline:
`8f218d7e138edda2c86fc5055c97a59b9df8427a`. This answers concrete design
questions; no external code was executed or adopted, and no vendor outcome
claim is treated as evidence of Plates improvement. Repository pins were
resolved with authenticated read-only `gh api repos/<repo>/commits/HEAD`, then
README/tree and named files were read at that exact SHA. No external tests ran.
Documentation without a published source pin is identified by retrieval/date;
its current wording is not an immutable implementation contract.

| Source and revision/date | Observed mechanism | Plates application | Tradeoff | Decision |
| --- | --- | --- | --- | --- |
| [Tessl docs, retrieved 2026-10-23](https://docs.tessl.io/improving-your-skills/evaluate-skill-quality-using-scenarios) | Documented baseline without skill versus candidate, scenario variants and history-derived tasks; hosted implementation not inspected | Versioned cases and configurations | Generated cases may expose solutions or reward the generating skill; no independent acceptance inferred | Adopt the pattern |
| [Tessl review article, 2026-10-08](https://tessl.io/blog/a-context-driven-code-review-that-learns-and-improves-on-every-run) | Documented repo-owned review lenses routed by affected paths; improvement claims are vendor claims | Scoped context proposal and matched target/control cases | Review knowledge can influence builders, but acceptance remains independent | Adopt the pattern |
| [Inspect 1de26acfcbaa8e2c8258cec8b92bd774ffc309a8](https://github.com/UKGovernmentBEIS/inspect_ai/blob/1de26acfcbaa8e2c8258cec8b92bd774ffc309a8/src/inspect_ai/_eval/evalset.py) | Inspected retry/completion handling; log edit provenance in src/inspect_ai/log/_edit.py; docs describe separate score history and preserved sample IDs | Separate trial/verdict, explicit retry identities and rescore history | Do not import its scheduler or let completed-result reuse masquerade as a new observation | Adopt the pattern |
| [SWE-bench 02e7a74ffd0b707aab73d203fe87bdc7c76afc8e](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/swebench/harness/run_evaluation.py) | Inspected container creation, patch application and report path; docs warn run/instance cache can reuse a different patch result | Pinned source, fresh artifact evaluator, artifact digest in verdict key | Public benchmark performance is not Plates acceptance; do not inherit fuzzy patch fallback or result-cache identity | Adopt the pattern |
| [Promptfoo c0b88a324175c60019cc80de1b2e32b4c849d4c3](https://github.com/promptfoo/promptfoo/blob/c0b88a324175c60019cc80de1b2e32b4c849d4c3/src/assertions/index.ts) | Inspected assertion dispatch and trace-aware checks; docs distinguish deterministic/custom/model assertions | Small check declarations with individual results and artifact checks | Final response assertions alone omit repository effects; model grading deferred | Adopt the pattern |
| [Cognition/Devin article, 2026-02-27](https://cognition.com/blog/how-cognition-uses-devin-to-build-devin) | Vendor description of session obstacles, timelines, action items and prompt suggestions; no implementation inspected | Selected retrospective observations become falsifiable proposals | Recommendations and PR volume are not causal outcome evidence | Adopt the pattern |
| [Beads ce8554ffb1bb7e70e2c04c739b11e72780cb9901](https://github.com/gastownhall/beads/blob/ce8554ffb1bb7e70e2c04c739b11e72780cb9901/backend/conformance/claimer_contract.go) | Inspected claim conformance and claim.go conflict attribution; README describes dependency-ready work and Dolt-backed state | Stable identities and explicit ownership blockers in existing Plates claims/ledger | Adopting its issue database would duplicate Plates task authority and add infrastructure | Adopt the pattern |
| [Gas City ba3ed611de712d00206969c57abc41afed84d984](https://github.com/gastownhall/gascity/blob/ba3ed611de712d00206969c57abc41afed84d984/internal/session/state_machine.go) | Inspected advisory transition table and runtime Provider interface; source notes state changes still spread across managers | Typed adapter capabilities and bounded reconciliation of pending work | README architecture is broader than inspected implementation; no second supervisor | Adopt the pattern |
| [StrongDM factory, retrieved 2026-10-23; Attractor fb57a55ed97372a27ac90102f436947e29f48426](https://github.com/strongdm/attractor/blob/fb57a55ed97372a27ac90102f436947e29f48426/attractor-spec.md) | Factory describes external scenarios and service replicas; Attractor README and checkpoint/retry contract are natural-language specifications, not a runnable implementation | Independent acceptance authority and deterministic delay/duplicate/crash simulation | Reject inferred installability and vendor spending prescriptions; no claimed implementation proof | Adopt the pattern |
| [Amp Orbs 2026-10-22 / Portals 2026-08-06](https://ampcode.com/news/self-hosted-orbs) | Documented spawn/pause/delete provider and thread-scoped HTTP previews; implementation not inspected | Possible later workspace inspection adapter | Persistent environments risk trial contamination; preview does not establish acceptance | Defer |
| [Cursor changelog 2026-08-19](https://cursor.com/changelog/08-19-26) | Documented event subscriptions, PR continuation and isolated subagent machines; implementation not inspected | Possible later sleeping comparison operations with explicit wake/deadline | Existing Plates worker/recovery lanes should own this; no new subscriptions for MVP | Defer |
| [Nerd e1c4d93ec4be43729d6f4752d27fb02d26019bf8](https://github.com/dglazkov/nerd/blob/e1c4d93ec4be43729d6f4752d27fb02d26019bf8/internal/robots/lessons.go) | Access succeeded. Inspected README, run.go, state.go, verdict.go, baseline.go and lessons.go: recorded runs, per-run clones, human card verdicts and shaping lessons with round timing | Keep source-run links, corrections and observed human-response timing | No paired independent evaluation established by inspected code; elapsed response time is not active human effort | Adopt the pattern |

## Focused decisions

1. Keep Plates dependency-free at runtime. **Reject** adding Inspect, Promptfoo,
   Beads or Gas City as a second execution/record system for the MVP. An optional
   export adapter can be reconsidered after one complete local comparison; no
   integration prototype is presently necessary.
2. Case, agent execution and scoring are different authorities. Inspect's
   [logs](https://inspect.aisi.org.uk/eval-logs.html) document new retry logs with
   stable task/sample identities and score-edit history. Preserve originals;
   never count recovered samples as independent repeats.
3. SWE-bench's [guide](https://www.swebench.com/SWE-bench/guides/evaluation/)
   supports clean patch evaluation and warns about result cache identity. Every
   Plates attempt is fresh, while immutable environment images may be reused.
4. [Promptfoo assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/)
   inform check ergonomics, not a text-only success definition.
5. [StrongDM's scenario discussion](https://factory.strongdm.ai/) motivates
   separation from editable tests. A separate directory is not an isolation
   boundary. Builder termination, clean artifact evaluation and external check
   authority are required by the Plates spec.
6. [Amp Portals](https://ampcode.com/news/portals) are a later inspectability
   idea, not a dependency for independent scoring. Reusing an orb across trials
   would conflict with fresh trial state.
7. Nerd is now accessible; the earlier access limitation no longer applies.
   Its latest five commit summaries were inspected for context (not proof of
   behavior). We found operational feedback mechanisms, not evidence of a
   general held-out harness benchmark. Do not copy its automatic posting policy.

## Research limits

The source files above were read, not exhaustively audited. Gas City's transition
module explicitly describes an incremental/advisory reducer; do not attribute
complete state-machine enforcement to that file. Attractor contains specifications.
Tessl, Devin, Amp and Cursor descriptions remain documented/vendor capabilities.
The six Plates corpus anchors are in the harness spec, with original commits and
parents. Historical public fixes cannot become genuinely unseen held-out cases.
