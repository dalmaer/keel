# Production errors

Use the night practice to turn repeated production errors into reviewable work.
Collection is deterministic and read-only. The robot's existing authorization,
budget and review flow still govern repairs; monitoring never grants permission
to merge or deploy.

## Configure a source

Add `production` to `.keel/keel.json`. Install the provider's public CLI in the
execution environment and give it an existing, narrowly scoped log-reader identity.
Do not copy a developer login into GitHub secrets. A missing executable, expired
login or unreadable source is an unavailable observation, not zero errors.

```json
{
  "production": {
    "version": 1,
    "enabled": true,
    "sources": [{
      "id": "acme-production",
      "provider": "gcp",
      "project": "acme-prod",
      "service": "acme",
      "region": "us-west1",
      "environment": "production",
      "windowMinutes": 1440,
      "maxEvents": 1000,
      "maxBytes": 1048576,
      "timeoutMs": 30000,
      "threshold": 3
    }]
  }
}
```

For Vercel, use `provider: "vercel"`, the project ID as `project`, and the team
ID as `scope`; omit `region`. Keep the explicit service and production environment.
The reader uses bounded public CLI queries, never a live tail. An optional
`dashboardUrl` names the Vercel team/project web URL so repair specs link to the
right dashboard; project IDs and team IDs are not dashboard slugs. Provider CLI output
does not prove retention, sampling or ingestion completeness; those gaps remain
visible even when the command succeeds. Reaching an event or byte cap cannot
produce a complete window.

The night accepts the existing repository secret `VERCEL_API_TOKEN` only when a
validated enabled Vercel source requires it. It passes that value as `VERCEL_TOKEN`
only to the collector; it is neither a command argument nor global workflow env.
Off, static and Google-only projects need no Vercel secret. The normal project
`setup` can install an explicitly pinned Vercel CLI with lifecycle scripts disabled; keep
its existing install steps and setup token. Never put a credential in config `env`.
Google collection uses the execution environment's approved log-reader identity;
this feature does not create IAM resources or copy a personal login into CI.

A static site or a CLI without a deployed application runtime can say:

```json
{"production":{"version":1,"enabled":false,"applicability":"not-applicable"}}
```

This means application-log collection does not apply; it says nothing about browser
errors, uptime or dependency health. Instrumenting client errors needs a real
source and separate coverage evidence.

## Collect, triage, repair

```sh
keel production status --json
keel production collect --json
keel production collect --yes --json
```

Preview first to inspect scope. Persisted observations live in `.keel/production/`.
Keep its state and recovery records: losing them loses deduplication and recurrence
history. Logs are untrusted input. Keel retains bounded sanitized identities and
error signatures, not raw request bodies, private telemetry or entire messages.

Recurring errors are triage candidates. A generated spec records the observed
frequency and source window, but cannot invent a reproduction. Establish a failing
regression test, a bounded change and acceptance before handing work to an agent.
Use `keel --agent-help production` for the current spec and verification arguments.
Issue preparation reuses the existing robot journal; ambiguous creation must be
reconciled instead of retried blindly. See [the robot](the-robot.md).

## Verify a fix

Keep proposed, implemented, merged and production-verified outcomes separate.
Verification needs the fixed revision actually serving production, passing smokes,
a matching complete observation window, enough traffic or a deliberate equivalent
probe, and no recurrence of the signature. Zero observed errors with unknown traffic
is inconclusive. A successful deployment or merged PR alone is insufficient.

When using an explicitly approved `equivalentProbe` and the delivery practice,
verification records real exact-revision smoke receipts. Keep one completed check
before the observation window, then run a separate probe and collect a window
covering its entire `startedAt`–`completedAt` interval. Verify again to combine
that in-window probe with fresh live-revision evidence. A smoke run after a window cannot
prove traffic within it. Provider completeness gaps still prevent verification.

Keep earlier failures when a later window passes. A recurrence after verification
is regression evidence, not permission to erase the previous outcome. Each incident retains up to 32 detailed verification outcomes and proof references;
evictions are counted explicitly. Acceptance
continues to belong to the project's phase or planning record.

## Night and morning

For a new installation, set `production.since` to its explicit UTC start boundary.
That boundary labels earlier history unavailable; never move it forward to hide an
interrupted run or discard existing monitoring evidence. Nightly startup otherwise
requires complete evidence that no earlier enabled run needs restoration.

The existing night workflow collects before planning and retains observations for
the next run. It does not start a second gate or model session. Health, plan and
morning summaries distinguish recurring candidates from collection gaps. A fresh
checkout must recover the latest applicable state; missing or ambiguous recovery
cannot silently bootstrap a clean history.

Verify a real collection and the following run's recovery before calling a project
operational. Configuration alone is not that proof. Source-specific authentication
and provider retention remain deployment responsibilities. See the
[specification](../specs/production-errors.md) for bounds and evidence requirements.
