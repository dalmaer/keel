import { readFile } from 'node:fs/promises';
import { runBlocks, inlineNode } from '/Users/dionalmaer/code/plates/tests/helpers/workflows.mjs';
const root = '/Users/dionalmaer/code/plates';
const night = await readFile(`${root}/practices/night/files/.github/workflows/plates-night.yml`, 'utf8');
const typecheck = await readFile(`${root}/.github/workflows/typecheck.yml`, 'utf8');
const count = text => { const blocks=runBlocks(text); return { bash:blocks.length, node:blocks.reduce((n,b)=>n+inlineNode(b.script).length,0) }; };
const wrap = name => `jobs:\n  night:\n    steps:\n      - name: ${name}\n        run: |\n${runBlocks(night).find(b=>b.step===name).script.split('\n').map(l=>'          '+l).join('\n')}\n`;
const mutations = [
 ['apostrophe','Read the config','// Only the secret NAME, never its value: the Install step looks it up.',"// Only the secret's NAME, never its value."],
 ['invalid JS','Read the config','const tok = c.setupToken;','const tok = c.setupToken +;'],
 ['missing then','Install','elif [ -f package-lock.json ]; then','elif [ -f package-lock.json ]'],
];
const rows=mutations.map(([name,step,from,to])=>({name,before:count(night.replace(from,to)),after:count(wrap(step).replace(from,to))}));
rows.push({name:'duplicate clean typecheck',before:count(typecheck),after:{bash:0,node:0}});
const reduction=rows.reduce((sum,r)=>({bash:sum.bash+r.before.bash-r.after.bash,node:sum.node+r.before.node-r.after.node}),{bash:0,node:0});
console.log(JSON.stringify({method:'Static runBlocks/inlineNode inventory; no checker subprocesses launched',rows,reduction,total:reduction.bash+reduction.node,removedNightFixture:{directGit:7,directBash:2,nested:'additional launches not counted'}},null,2));
