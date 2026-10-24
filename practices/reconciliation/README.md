# Reconciliation

Merged work can leave a draft claim, obsolete next action, or superseded decision behind. GitHub owns merge facts; phases own acceptance; decisions own architecture; evidence owns tested claims. A merge never ticks acceptance.

Opt in with `plates adopt --with reconciliation` or `plates init <dir> --description "…" --with reconciliation`. This installs the standalone reconciliation runtime, its decision-context sibling, a guide, and seeded templates. Local phase formats remain local. Doctor reads annotations offline; `--github` requests read-only observations. The existing night reports manual proposals in its health queue. Records are never data eligible for automatic merging.

Origin: the phase 26 reconciliation design in this repository, informed by Ledger delivery/record drift. No upstream code copied.

The shipped [template](files/docs/templates/reconciliation.md) includes full
`plates-proof` and `plates-decision` JSON examples using synthetic Acme. Receipts
name the tested SHA, claim, acceptance ID, environment, timestamp, observer
and result; production additionally identifies the deployment. Placeholder
receipts deliberately cannot pass as proof. Research/design decisions require
an explicit `<a id="…"></a>` anchor. The example successor replaces only the
old decision's authored-data scope, leaving its cache choice and historical
measurements intact, with reciprocal supersession links.

Practice authors sharing just the runtime use the explicit `runtimeFiles` contract
in [the development guide](../../docs/development.md#share-installed-runtime-files-between-practices).
Climb imports those two scripts without enabling this optional practice.
