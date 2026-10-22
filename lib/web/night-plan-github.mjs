import {requestJson,WebError} from './common.mjs';
import {PLAN_BRANCH} from './night-plan-model.mjs';
export function createNightPlanGitHub(token,{fetcher=fetch}={}) {
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'};
  async function query(query,variables) {
    const result=await requestJson(fetcher,'https://api.github.com/graphql',{method:'POST',headers,signal:AbortSignal.timeout(25000),body:JSON.stringify({query,variables})},1048576);
    if(result.errors?.some(error=>['FORBIDDEN','NOT_FOUND','UNAUTHORIZED'].includes(error.type)))throw new WebError('access_denied',404);
    if(result.errors?.length)throw new WebError('night_source_unavailable',503);
    return result.data?.node;
  }
  function repository(repo,project,source) {
    if(repo?.id!==source.repositoryNodeId||repo.databaseId!==project.repoId||repo.nameWithOwner!==project.repo||(repo.isPrivate?'private':'public')!==source.visibility)throw new WebError('access_changed',409);
  }
  async function openRobotPrs(project,source) {
    const ids=new Set(),numbers=[];let cursor=null,total=null;
    for(let page=0;page<3;page++) {
      const repo=await query('query NightPlanOpenPulls($id:ID!,$after:String){node(id:$id){... on Repository{id databaseId nameWithOwner isPrivate pullRequests(states:OPEN,first:100,after:$after){totalCount nodes{number headRefName isCrossRepository} pageInfo{hasNextPage endCursor}}}}}',{id:source.repositoryNodeId,after:cursor});
      repository(repo,project,source);const pulls=repo.pullRequests;
      if(!Number.isSafeInteger(pulls?.totalCount)||pulls.totalCount<0||pulls.totalCount>300||total!==null&&pulls.totalCount!==total||!Array.isArray(pulls.nodes)||pulls.nodes.length>100||typeof pulls.pageInfo?.hasNextPage!=='boolean')throw new WebError('night_policy_unavailable',503);
      total=pulls.totalCount;
      for(const pr of pulls.nodes) {
        if(!Number.isSafeInteger(pr?.number)||pr.number<1||ids.has(pr.number)||typeof pr.headRefName!=='string'||pr.headRefName.length>300||typeof pr.isCrossRepository!=='boolean')throw new WebError('night_policy_unavailable',503);
        ids.add(pr.number);const match=/^keel\/robot-([1-9]\d*)$/.exec(pr.headRefName);
        if(!pr.isCrossRepository&&match) {const issue=Number(match[1]);if(!Number.isSafeInteger(issue))throw new WebError('night_policy_unavailable',503);numbers.push(issue);}
      }
      if(!pulls.pageInfo.hasNextPage) {
        if(ids.size!==total)throw new WebError('night_policy_unavailable',503);
        return [...new Set(numbers)].sort((a,b)=>a-b);
      }
      if(typeof pulls.pageInfo.endCursor!=='string'||pulls.pageInfo.endCursor.length>1000||!pulls.pageInfo.endCursor||pulls.pageInfo.endCursor===cursor)throw new WebError('night_policy_unavailable',503);
      cursor=pulls.pageInfo.endCursor;
    }
    throw new WebError('night_policy_unavailable',503);
  }
  async function recheck(project,source,defaultSource) {
    const repo=await query('query NightPlanRecheck($id:ID!,$name:String!){node(id:$id){... on Repository{id databaseId nameWithOwner isPrivate viewerPermission defaultBranchRef{id name repository{id databaseId} target{... on Commit{oid}}} ref(qualifiedName:$name){id name repository{id databaseId} target{... on Commit{oid}}}}}}',{id:source.repositoryNodeId,name:`refs/heads/${PLAN_BRANCH}`});
    repository(repo,project,source);
    if(!['WRITE','MAINTAIN','ADMIN'].includes(repo.viewerPermission))throw new WebError('access_changed',409);
    for(const [ref,expected] of [[repo.ref,source],[repo.defaultBranchRef,defaultSource]]) {
      if(ref?.id!==expected.branchNodeId||ref.name!==expected.branch||ref.target?.oid!==expected.head||ref.repository?.id!==source.repositoryNodeId||ref.repository.databaseId!==project.repoId)throw new WebError('night_source_changed',409);
    }
  }
  return {openRobotPrs,recheck};
}
