# Verify CLI fleet enrollment from the source checkout

Consumer adoption, source fleet membership and hosted access are separate
completion states. This read-only source tool verifies only the second; it does
not install into consumers or start a routine, worker, update or deployment.

After owner-approved enrollment is reviewed, use the exact actual central
manifest at the Plates source root:

```sh
node scripts/check-fleet-registration.mjs --manifest /absolute/path/to/plates/plates.json --repo acme/studio --json
```

The checker requires a regular root `plates.json` beside a Plates self config
with a string repository identity, and parses entries with the same parser as
`plates fleet`. Admission-shaped files, consumer configs, malformed identities,
unavailable evidence and duplicate entries cannot establish membership. Exit 0
means a managed row exists in those local bytes; 1 means it is missing or only
a source row; 2 means unavailable/invalid evidence or usage. It writes nothing
and does not call GitHub.

Retain the manifest source revision and recheck remote main after merge; an
unmerged passing proposal is not current central membership. The consumer
`plates adopt` JSON, terminal output and report remain explicitly `not-checked`
for registration. Run this check as the separate completion handoff rather than
inferring membership from consumer CI or a temporary validation allowlist.

The existing root fleet policy covers observations, update planning and release
rehearsal. Hosted manifests, server project allowlists, App repository grants,
worker registration, explicit audit/collector target lists and user automations
need their own inspection and reviewed scope changes; none is enabled here.
