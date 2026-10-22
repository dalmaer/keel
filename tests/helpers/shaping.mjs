import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
export const fixture = async () => JSON.parse(await readFile(new URL('../../practices/shaping/files/docs/templates/shaping.json',import.meta.url),'utf8'));
export const base = `---
status: planned
since: 2026-10-20
goal: G0
spec: 2
depends: []
note: "Acme foundation awaits work."
evidence: []
---

# Acme foundation works

## Done when

Acme starts locally.

## Scope

Acme foundation.

## Acceptance

- [ ] Acme starts: \`node --test\`

## Real surfaces

none

## Proof

Run \`node --test\`.

## Deliberately open

Conductor judges whether startup is sufficient.

## Next action

Implement Acme startup.
`;
export async function world(t) {
  const root=await mkdtemp(join(tmpdir(),'acme-shaping-')); t.after(()=>rm(root,{recursive:true,force:true}));
  for(const p of ['.plates','docs/phases','docs/decisions'])await mkdir(join(root,p),{recursive:true});
  const config={name:'Acme',tagline:'Acme shaping',repo:'acme/app',practices:['base','agents-md','shaping'],check:'node --test'};
  await writeFile(join(root,'.plates/plates.json'),JSON.stringify(config));
  await writeFile(join(root,'docs/goals.json'),JSON.stringify([{id:'G0',title:'Acme works',outcome:'Acme runs locally.'}]));
  await writeFile(join(root,'docs/phases/00-acme.md'),base);
  const record=await fixture(); await save(root,record);
  execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['commit','-qm','Acme fixture'],{cwd:root});
  return {root,record,config};
}
export const save=(root,record)=>writeFile(join(root,'idea.json'),JSON.stringify(record,null,2)+'\n');
