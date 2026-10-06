# Lessons history

<!-- Appended by `keel learn decide` when a distill reword or tag is accepted: the words a row of docs/lessons.md had before. Never edited, never dropped. -->

Each line: when, which lesson and cell, the proposal that changed it, and the old words verbatim.
A reworded shape also records its old fingerprint, the identity keel lessons and fleet count it by.

- 2026-10-06, lesson 14, shape (docs/inbox/2026-10-06-distill-reword-14-shape.md; old fingerprint dalmaer/keel/lesson/14/143073e1): **A check spawned from inside a test runner inherits the runner's context and passes while running nothing.** Node's `node --test` sets `NODE_TEST_CONTEXT` for its children, and a child `node --test` that sees it runs no files and exits 0. *(keel, phase 6)*
- 2026-10-06, lesson 17, shape (docs/inbox/2026-10-06-distill-reword-17-shape.md; old fingerprint dalmaer/keel/lesson/17/429e8cb0): **A test whose injected value doesn't reach every path is green only while the real value happens to match.** The test set the CLI version in-process, but a spawned CLI at its end read the live `package.json`. Nobody noticed, because live and injected were the same number. *(keel, v0.3.1)*
