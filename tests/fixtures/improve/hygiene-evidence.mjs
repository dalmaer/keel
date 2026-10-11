// Synthetic Acme evidence. The worktree reading is an injected result grounded
// in tests/worktree-hygiene.test.mjs; long files are measured from real temp Git.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { longFiles, draftsWaiting } from '../../../practices/night/files/scripts/keel/hygiene-measures.mjs';

export async function hygieneFixture({ env, now }) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-hygiene-fixture-'));
  const root = join(dir, 'acme');
  try {
    await mkdir(root);
    const global = join(dir, 'gitconfig');
    await writeFile(global, '');
    // No inherited repository routing/config or developer identity reaches Git.
    const gitEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_') && key !== 'KEEL_GIT'));
    Object.assign(gitEnv, { KEEL_GIT: 'git', GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false', GIT_CONFIG_KEY_2: 'core.hooksPath', GIT_CONFIG_VALUE_2: '/dev/null', GIT_AUTHOR_NAME: 'Acme', GIT_AUTHOR_EMAIL: 'acme@acme.test', GIT_COMMITTER_NAME: 'Acme', GIT_COMMITTER_EMAIL: 'acme@acme.test' });
    const git = args => {
      const r = spawnSync('git', args, {cwd:root,env:gitEnv,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
      if (r.error || r.status !== 0) throw new Error(`synthetic Git: ${r.error?.message ?? r.stderr}`);
    };
    git(['init','--initial-branch=main']);
    await writeFile(join(root, 'anvils.mjs'), `export function anvils() {\n${'  // an Acme anvil\n'.repeat(1600)}}\n`);
    git(['add','--','anvils.mjs']);
    git(['commit','-m','Acme source fixture']);
    const fixtureEnv = {...env,KEEL_CACHE:join(dir,'cache')};
    return { env:fixtureEnv, close:()=>rm(dir,{recursive:true,force:true}), instruments: {
      longFiles: ctx => longFiles({...ctx,root,env:gitEnv}),
      draftsWaiting: ctx => draftsWaiting({...ctx,env:fixtureEnv,guard:async()=>null,graphql:async()=>({data:{rateLimit:{cost:1,remaining:4000,resetAt:new Date(now+3600000).toISOString()},repository:{pullRequests:{pageInfo:{hasNextPage:false},nodes:[{number:1,title:'Acme anvils',url:'https://github.com/acme/storefront/pull/1',isDraft:true,state:'OPEN',createdAt:new Date(now-48*3600000).toISOString(),updatedAt:new Date(now-3600000).toISOString()}]}}}})}),
      staleWorktrees: async()=>({value:1,detail:'synthetic stale Acme worktree; instrument grounded in real-Git focused tests',facts:{schema:1,observedAt:new Date(now).toISOString(),complete:true,staleDays:7,sizeKind:'logical-bytes',worktrees:[{path:'/acme/old',merged:true,stale:true,logicalBytes:123,command:"git -C '/acme/main' worktree remove -- '/acme/old'",protectedReasons:[],reasons:['merged-into-main']}],gaps:[]}}),
    }};
  } catch (e) { await rm(dir,{recursive:true,force:true}); throw e; }
}
