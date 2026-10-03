---
title: Widget cache ignores expiry
loop:
  - aaaaaaaa-1111-4000-8000-000000000001
loop_rank: P2/S2
loop_state: ACTIVE
loop_goal: G-acme-1
decision: proposed
rank: next
phase: 1
lesson: 2
since: 2026-10-01
note: "Holds: lib/cache.mjs:12 never reads ttl. Fix it beside the widget work."
---

# Widget cache ignores expiry

> **Loop says** (P2/S2, confidence 90): The widget cache never expires entries.

- `lib/cache.mjs`

## Our read

**Holds.** lib/cache.mjs:12 stores entries with no ttl check.
