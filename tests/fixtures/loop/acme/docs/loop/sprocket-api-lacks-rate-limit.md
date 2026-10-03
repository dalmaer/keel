---
title: 'Sprocket API lacks "rate limit"'
loop: bbbbbbbb-2222-4000-8000-000000000002, bbbbbbbb-2222-4000-8000-000000000003
loop_rank: P1
loop_state: ACTIVE
loop_goal: G-acme-1
decision: declined
rank: never
since: 2026-09-30
note: "By design: one person's tool, no shared API — see docs/phases/01-acme-widgets.md."
---

# Sprocket API lacks "rate limit"

> **Loop says** (P1): Sprockets can be requested without limit.

## Our read

**By design.** lib/sprocket.mjs:3 serves one local user.
