# Reconciliation references (adapt, do not copy invented proof)

Put this section in a phase, with stable IDs on its existing acceptance boxes.

## Reconciliation

```keel-reconciliation
{"version":1,"prs":[],"decisions":[],"implementation":[],"production":[],"use":[],"next":{"kind":"acceptance","ref":"replace-with-existing-acceptance-id"}}
```

## PR impact

Declare actual paths and anchored references. Use `reconciliation: "updated"`
when records changed; give per-record reasons for unchanged records. For a
change without record impact, supply a specific reason:

```keel-impact
{"version":1,"phases":[],"decisions":[],"supersedes":[],"evidence":[],"reconciliation":"none","reason":"Replace with why this diff has no record impact."}
```

## Decision record

Put a decision beside its reasoning in a real decision file. For an existing
research/design section, use an explicit `<a id="store-choice"></a>` anchor.
A proposed successor does not supersede an accepted choice. On acceptance,
fill the real owner/date and link reciprocal, scope-specific replacements.

```keel-decision
{"version":1,"id":"store-choice","status":"proposed","scope":["storage"],"supersedes":[],"superseded_by":[]}
```

## Evidence receipt

In the evidence section referenced by an implementation/production/use
entry, use a `keel-proof` JSON fence. Fill these fields from the actual run:
`version: 1`, `kind`, `acceptance` (existing stable ID), `sha` (full tested
revision), `environment`, `observed_at` (timestamp with zone), `observer`,
`claim`, and `result`. Only `result: "pass"` supports a positive claim.
Production needs `environment: "production"` and an identified `deployment`.
Use needs `duration`, `context`, `observations`, and `repeated: true`.
Do not fill placeholders with fictional success; retain old receipts as history.

### Illustrative Acme receipt — not evidence of a run

Copy the shape, then replace every value from an actual observation. The SHA
below is deliberately invalid as a receipt until replaced. Merely copying this
example cannot establish production proof or acceptance.

```keel-proof
{
  "version": 1,
  "kind": "production",
  "acceptance": "atomic-write",
  "sha": "REPLACE_WITH_FULL_TESTED_COMMIT_SHA",
  "environment": "production",
  "deployment": "REPLACE_WITH_OBSERVED_ACME_DEPLOYMENT_ID",
  "observed_at": "REPLACE_WITH_ACTUAL_TIMESTAMP_AND_ZONE",
  "observer": "REPLACE_WITH_ACTUAL_OBSERVER",
  "claim": "An interrupted Acme write preserves the previous complete record.",
  "result": "REPLACE_WITH_OBSERVED_RESULT"
}
```

For implementation use `kind: "implementation"` and the environment actually
tested (for example `test`). For repeated use, use `kind: "use"`, retain the
common fields, and add the observed `duration`, `context`, `observations`
(string or array), and `repeated: true`. Neither a preview nor deployment
success alone supports a production claim. An invalidated receipt cannot
support a current claim; mark `invalidated: true` and preserve its history.

### Illustrative scoped Acme decision — not a real accepted decision

In `docs/design.md`, preserve the old reasoning and add an explicit anchor
before the heading (a generated Markdown heading anchor alone is insufficient
for a research/design decision):

<a id="acme-store"></a>
## Acme original storage choice

```keel-decision
{"version":1,"id":"acme-store","status":"accepted","scope":["authored-data","cache"],"decided_by":"Acme reviewer (example)","decided_at":"2026-01-01","supersedes":[],"superseded_by":["docs/decisions/store.md#acme-authored-data"]}
```

In `docs/decisions/store.md`, put the successor beside its actual reasoning:

<a id="acme-authored-data"></a>
## Acme authored-data replacement

```keel-decision
{"version":1,"id":"acme-authored-data","status":"accepted","scope":["authored-data"],"decided_by":"Acme reviewer (example)","decided_at":"2026-01-02","supersedes":["docs/design.md#acme-store"],"superseded_by":[]}
```

These dates and people illustrate fields; do not copy them into a real record.
The successor replaces only `authored-data`. Keep the old choice accepted for
`cache` and explain that remaining scope beside its history. Change active
phase references for the replaced scope to the successor; do not retire the
whole phase or rewrite old benchmarks. A successor still `proposed` replaces
nothing. Partition overlapping scopes explicitly with a person's decision.
