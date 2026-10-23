# Phase 116: each plate verifies itself

Observed 2026-10-23 against base `490e7754ca0bf1689305af4798419336d93525df`.
Built by a delegated builder; conductor independently ran the named proof.
Decision context was `not-configured`, not verified architecture coverage.

## Measured proof

Working directory for commands: `/Users/dionalmaer/.codex/worktrees/reconcile-validation-night/plates`.
Runtime: Node 26.12.1 through `PATH=/opt/homebrew/bin:$PATH`; tests use `TZ=UTC`.

- `PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run check:focused -- tests/plate-verification.test.mjs tests/fleet-verification.test.mjs`: exit 0. Both behavior files and the required source/CLI/render/roadmap/inbox/whitespace convention bundle passed. Log: `/tmp/phase116-parent-focused.log`.
- `PATH=/opt/homebrew/bin:$PATH npm run typecheck`: exit 0. Selected JSDoc contracts only. Log: `/tmp/phase116-typecheck.log`.
- Builder's final producer/fleet, persistence, morning and capability source checks: 45/45; workflow checks: 12/12; corrected existing regression expectations: 8/8. Exact commands and retained failures: `/tmp/plates-phase116-builder-report.md`.
- Read-only independent review found and then rechecked three issues: fresh-checkout retry retention, PR-only duplicate/ended ownership, and unsupported/owes-walk phase statuses. No remaining findings in that review. Review was source inspection, not execution.

The integrated `npm run check` is the final checkpoint after this record; its result belongs to the delivery commit/PR, not a prediction here.

## Packed adopter and live source walk

`PATH=/opt/homebrew/bin:$PATH npm pack --json --pack-destination /tmp/plates-phase116-walk`
completed with exit 0; extracted candidate at `/tmp/plates-phase116-walk/package`.
Then:

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false node /tmp/plates-phase116-walk.mjs /Users/dionalmaer/.codex/worktrees/reconcile-validation-night/plates /tmp/plates-phase116-walk/package
```

Exit 0 at 2026-10-23T23:31:55Z. Output retained in `/tmp/plates-phase116-walk/result.json` and `/tmp/plates-phase116-walk.log`; the reproducible script is retained below.

The packed CLI initialized a synthetic Acme project and ran its installed producer. A real arithmetic test failed (exit 1), then its corrected test passed (exit 0); both receipts survived report refresh, morning finalization and a Git commit. Both were attributed `local-command` with clean, distinct source revisions. The later report commit was classified **behind**, not silently treated as the tested revision. Fresh-checkout recovery and a rejected stale writer are additionally exercised against local bare Git origins by `tests/plate-verification.test.mjs` using the workflow push command.

Live GitHub reads observed Plates main at `490e7754ca0bf1689305af4798419336d93525df`. The worktree was dirty, disclosed as such. Phase 116's claim existed but its phase was not yet on main, producing a coverage gap; phase 114 was owned by open PR 229, with activity unknown. No claim was removed by verification.

The configured fleet contained five readable managed repositories. All five correctly reported **missing / verification not yet adopted**, not healthy:

| Repository | Pinned main |
| --- | --- |
| dalmaer/plates | 490e7754ca0bf1689305af4798419336d93525df |
| dalmaer/duo | dc05e24af4c941d366db6a693e1dc91337b25776 |
| dalmaer/cajones | 2d47796ba85def295b05af41ad41532dd6bc6f0d |
| dalmaer/ledger | c374234e7b7dc8ff5a1e6702d1fe7c1b647a0dde |
| dglazkov/isocan | 97b2e93e742f9542dace5d79da8fcbbb050733c6 |

These are read-only metadata/report reads, not consumer gate runs or proof of installation.

## First failures and limitations

Initial focused testing found one invalid synthetic fleet fixture (7/8 passed), then eight existing expectations incompatible with pinned source reads and retained attempts (61/69 passed). The fixture and expectations were corrected; retained logs are `/tmp/phase116-first-tests.log` and `/tmp/phase116-existing-tests.log`. The first integrated gate also exited 1: 2,886/2,891 passed. Two CLI copies captured an invalid phase evidence path while the conductor corrected its metadata; the standalone two-test diagnosis passed after correction. Three workflow harnesses lacked the new recovery environment/receipt and required updates. The updated night-box and test-history harnesses run actual recovery against their local bare origins; all 67 focused tests passed (exit 0, `/tmp/plates-phase116-harness-report.md`). No runtime relaxation was needed. Full output is retained in `/tmp/phase116-full-check.log`; CLI diagnosis is `/tmp/phase116-cli-diagnosis.log`. These were deterministic failures, not retries hiding flakes. Final focused ledgers reported no flaky or slower tests.

No hosted nightly execution, fleet rollout, production verification, local session liveness or multi-night usefulness is claimed. The package walk installs the candidate tarball, not a registry release. Existing report publication does not make its source SHA equivalent to the later report commit. Remote recovery conflicts refuse publication. Bounds and absent reconciliation/access remain explicit gaps. Schedules and model budgets are unchanged.

## Retained walk script

Save this as `/tmp/plates-phase116-walk.mjs` and supply source/extracted-package paths. It creates only synthetic local work and reads the authorized fleet.

```js
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const [sourceRoot, packedRoot] = process.argv.slice(2);
assert.ok(sourceRoot && packedRoot, 'source root and extracted package required');
const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false',GIT_CONFIG_KEY_1:'commit.gpgsign',GIT_CONFIG_VALUE_1:'false',GIT_AUTHOR_NAME:'Acme',GIT_AUTHOR_EMAIL:'acme@example.invalid',GIT_COMMITTER_NAME:'Acme',GIT_COMMITTER_EMAIL:'acme@example.invalid'};
const dir=await mkdtemp(join(tmpdir(),'plates-phase116-packed-'));
const root=join(dir,'acme');
execFileSync(process.execPath,[join(packedRoot,'bin/plates.mjs'),'init',root,'--description','Acme verifies a local synthetic test.','--repo','acme/plate','--kind','node','--json'],{env,encoding:'utf8'});
const config=JSON.parse(await readFile(join(root,'.plates/plates.json'),'utf8'));
config.health='reports';config.check=`${process.execPath} --test acme.test.mjs`;
await writeFile(join(root,'.plates/plates.json'),JSON.stringify(config,null,2)+'\n');
const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8'}).trim();
const mod=await import(pathToFileURL(join(root,'scripts/plates/improve.mjs')));
const v=await import(pathToFileURL(join(root,'scripts/plates/verification.mjs')));
const merger=await import(pathToFileURL(join(root,'scripts/plates/time-proposals.mjs')));
const morning=await import(pathToFileURL(join(root,'scripts/plates/morning.mjs')));
const read=async endpoint=>{
 if(endpoint==='repos/acme/plate')return {full_name:'acme/plate',default_branch:'main'};
 if(endpoint==='repos/acme/plate/commits/main')return {sha:git('rev-parse','HEAD')};
 if(endpoint.includes('matching-refs')||endpoint.includes('/pulls?'))return [];
 throw new Error('synthetic endpoint not supplied');
};
const date=new Date().toISOString().slice(0,10);
const passes=[];
for(const passing of [false,true]) {
 await writeFile(join(root,'acme.test.mjs'),`import test from 'node:test'; import assert from 'node:assert/strict'; test('Acme arithmetic',()=>assert.equal(1+1,${passing?2:3}));\n`);
 git('add','.');git('commit','-qm',passing?'Acme correct arithmetic':'Acme failing arithmetic');
 const out=await mod.improve({root,report:true,date},{env,measures:mod.MEASURES.filter(m=>m.id==='gate'),verificationRead:read});
 assert.equal(out.exitCode,passing?0:1);
 passes.push({exit:out.exitCode,source:out.data.verification.source,gate:out.data.verification.gate});
}
const path=`reports/${date}.md`;
let page=await readFile(join(root,path),'utf8');
assert.equal(v.parseVerifications(page).length,2);
page=merger.rewriteHealthBody(page,body=>morning.withPlanSection(body,["## Tonight's plan",'','Acme finalization.','']));
await writeFile(join(root,path),page);
git('add','.');git('commit','-qm','Acme retained health and morning result');
const committed=git('show',`HEAD:${path}`);
assert.equal(v.parseVerifications(committed).length,2);
const assessed=v.assessVerification(committed,{repo:'acme/plate',branch:'main',sha:git('rev-parse','HEAD')});
assert.equal(assessed.state,'behind');
const currentConfig=JSON.parse(await readFile(join(sourceRoot,'.plates/plates.json'),'utf8'));
const live=await v.observeVerification({root:sourceRoot,config:currentConfig,env});
const {fleet}=await import(pathToFileURL(join(packedRoot,'lib/fleet.mjs')));
const result=await fleet({dir:sourceRoot},{env,cli:(await readFile(join(packedRoot,'practices/VERSION'),'utf8')).trim()});
const report={at:new Date().toISOString(),packedRoot,acmeRoot:root,passes,committedReport:git('rev-parse','HEAD'),retainedAttempts:2,afterReportCommit:assessed.state,liveObservation:live,fleet:result.data.rows.map(r=>({repo:r.repo,role:r.role,verification:r.verification??null,unreadable:r.unreadable??null}))};
await mkdir('/tmp/plates-phase116-walk',{recursive:true});
await writeFile('/tmp/plates-phase116-walk/result.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
```
