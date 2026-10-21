# Shaping

An idea can lose its owner's choices when a recommendation becomes a plan.
This optional practice installs a local review guide and seeded example.
Enable with `keel adopt --with shaping` or `keel init Acme --description
"Acme project" --with shaping`. It requires no model, account or scheduler.

The CLI reads versioned records, reuses decision-context resolution and the
robot rubric validator, and seeds only digest-approved local phase drafts.
Milestone plans and robot work remain previews. See the [guide](files/docs/shaping.md).

Origin: Keel's decisions and feedback specification, phase 91. No upstream
code copied. Decisions remain authoritative in source records.
