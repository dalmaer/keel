import { createHash } from 'node:crypto';
import { requestJson, WebError } from './common.mjs';
export const sourcePath = path => typeof path === 'string' && path.length <= 500 && !/[\x00-\x1f\\:]/.test(path) && path.split('/').every(p => p && !['.','..'].includes(p));
const nodeId = value => typeof value==='string' && /^[!-~]{1,200}$/.test(value);
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
const encode = path => path.split('/').map(encodeURIComponent).join('/');
const missing = () => { const error = new Error('missing source'); error.code = 'ENOENT'; throw error; };
export const gitBlob = content => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
export function createDecisionGitHub(token, { fetcher = fetch } = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  let calls = 0; const signal = AbortSignal.timeout(25000);
  async function get(path, limit = 2 * 1024 * 1024) {
    if (++calls > 250) throw new WebError('source_limit');
    return requestJson(async (url, options) => { const response = await fetcher(url, options);
      if ([401,404].includes(response.status)) { await response.body?.cancel(); throw new WebError('access_denied', 404); } return response;
    }, `https://api.github.com${path}`, { headers, signal }, limit);
  }
  async function graph(query, variables) {
    if (++calls > 250) throw new WebError('source_limit');
    const result=await requestJson(fetcher,'https://api.github.com/graphql',{method:'POST',signal,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({query,variables})},2*1024*1024);
    if(result.errors?.length)throw new WebError('identity_unavailable');
    return result.data;
  }
  const repositoryQuery='query DecisionRepository($id:ID!){node(id:$id){... on Repository{id databaseId nameWithOwner isPrivate viewerPermission defaultBranchRef{id name repository{id databaseId} target{... on Commit{oid tree{oid}}}}}}}';
  const sameRepository=(repo, identity)=>repo?.id===identity.repositoryNodeId&&repo.databaseId===identity.repoId;
  const writable=repo=>['WRITE','MAINTAIN','ADMIN'].includes(repo?.viewerPermission);
  async function snapshot(project) {
    const repo = await get(`/repositories/${project.repoId}`, 65536);
    if (repo.id !== project.repoId || repo.full_name !== project.repo || typeof repo.private !== 'boolean' || typeof repo.default_branch !== 'string' || repo.default_branch.length > 200) throw new WebError('source_unavailable');
    if(!nodeId(repo.node_id))throw new WebError('identity_unavailable');
    const identity={repoId:project.repoId,repositoryNodeId:repo.node_id};
    const current=(await graph(repositoryQuery,{id:repo.node_id}))?.node,ref=current?.defaultBranchRef;
    if(!sameRepository(current,identity)||current.nameWithOwner!==project.repo||current.isPrivate!==repo.private||!nodeId(ref?.id)||ref.name!==repo.default_branch||!sameRepository(ref.repository,identity)||!sha(ref.target?.oid)||!sha(ref.target?.tree?.oid))throw new WebError('identity_unavailable');
    const commit={sha:ref.target.oid,tree:ref.target.tree.oid};
    const base = `/repos/${encode(project.repo)}`;
    const tree = await get(`${base}/git/trees/${commit.tree}?recursive=1`, 5 * 1024 * 1024);
    if (tree.sha!==commit.tree || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 20000) throw new WebError('source_limit');
    const entries = new Map(), dirs = new Set(['']);
    for (const entry of tree.tree) {
      if (!sourcePath(entry.path) || !sha(entry.sha) || entries.has(entry.path)) throw new WebError('source_unavailable');
      entries.set(entry.path, entry); const parts = entry.path.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0,i).join('/'));
      if (entry.type === 'tree') dirs.add(entry.path);
    }
    const cache = new Map(); let bytes = 0;
    const reader = { revision: commit.sha, complete: true,
      async stat(path) { if (path !== '' && !sourcePath(path)) throw new WebError('invalid_source', 400); const entry = entries.get(path);
        if (dirs.has(path)) return {type:'directory'};
        if (!entry) return missing();
        return { type: entry.type === 'blob' && ['100644','100755'].includes(entry.mode) ? 'file' : 'unsupported', size: entry.size };
      },
      async readdir(path) { if (!dirs.has(path)) return missing(); const prefix = path ? `${path}/` : '';
        return [...new Set([...entries.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]))].sort();
      },
      async readFile(path) { const stat = await reader.stat(path), entry = entries.get(path);
        if (stat.type !== 'file' || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > 262144) throw new WebError('source_limit');
        if (cache.has(path)) return cache.get(path);
        bytes += stat.size; if (bytes > 4 * 1024 * 1024) throw new WebError('source_limit');
        const blob = await get(`${base}/git/blobs/${entry.sha}`, 400000);
        if (blob.sha !== entry.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new WebError('source_unavailable');
        const value = Buffer.from(blob.content,'base64'); if (value.length !== stat.size || gitBlob(value) !== entry.sha) throw new WebError('source_unavailable');
        cache.set(path,value); return value;
      },
    };
    return { reader, entries, source: { ...identity, branchNodeId:ref.id, head:commit.sha, branch:ref.name, visibility:current.isPrivate ? 'private' : 'public' }, canWrite:repo.permissions?.push === true&&writable(current) };
  }
  async function dispatch(intent) {
    const query = 'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid url}}}';
    const result = await requestJson(fetcher, 'https://api.github.com/graphql', { method:'POST', signal, headers:{...headers,'Content-Type':'application/json'}, body:JSON.stringify({query,variables:{input:{branch:{id:intent.branchNodeId},expectedHeadOid:intent.head,message:{headline:intent.commitMessage.split('\n')[0],body:intent.marker},fileChanges:{additions:[{path:intent.path,contents:Buffer.from(intent.content).toString('base64')}]},clientMutationId:intent.id}}}) }, 65536);
    if (result.errors?.length) { const refused = result.data?.createCommitOnBranch === null && result.errors.every(e => ['FORBIDDEN','UNPROCESSABLE','STALE_DATA','NOT_FOUND'].includes(e.type)); throw new WebError(refused ? 'remote_refused' : 'remote_uncertain', refused ? 409 : 503); }
    const commit = result.data?.createCommitOnBranch?.commit;
    if (!sha(commit?.oid)) throw new WebError('remote_uncertain');
    return commit.oid;
  }
  async function recover(intent, knownCommit = null) {
    // Names can be recycled. Both history and proof are addressed through the
    // immutable identities captured before dispatch, never through an old name.
    if(!Number.isSafeInteger(intent.repoId)||!nodeId(intent.repositoryNodeId)||!nodeId(intent.branchNodeId)||!sha(intent.originalBlob)||intent.originalBlob===gitBlob(intent.content))return null;
    const data=await graph('query DecisionHistory($id:ID!){node(id:$id){... on Ref{id name repository{id databaseId nameWithOwner} target{... on Commit{history(first:100){nodes{oid message parents(first:2){totalCount nodes{oid}}}}}}}}}',{id:intent.branchNodeId});
    const ref=data?.node;
    if(ref?.id!==intent.branchNodeId||!sameRepository(ref.repository,intent))return null;
    const commits=ref.target?.history?.nodes;
    if(!Array.isArray(commits)||commits.length>100)return null;
    const matches=commits.filter(c=>sha(c.oid)&&c.message===intent.commitMessage&&c.parents?.totalCount===1&&c.parents.nodes?.length===1&&c.parents.nodes[0].oid===intent.head);
    if(matches.length!==1||knownCommit&&matches[0].oid!==knownCommit)return null;
    const oid=matches[0].oid;
    const proof=await graph('query DecisionCommitProof($id:ID!,$oid:GitObjectID!,$expression:String!){node(id:$id){... on Repository{id databaseId nameWithOwner commit:object(oid:$oid){... on Commit{oid message changedFilesIfAvailable repository{id databaseId} parents(first:2){totalCount nodes{oid}}}} blob:object(expression:$expression){... on Blob{oid text byteSize isTruncated}}}}}',{id:intent.repositoryNodeId,oid,expression:`${oid}:${intent.path}`});
    const repo=proof?.node,candidate=repo?.commit,blob=repo?.blob;
    if(!sameRepository(repo,intent)||!sameRepository(candidate?.repository,intent)||candidate.oid!==oid||candidate.message!==intent.commitMessage||candidate.changedFilesIfAvailable!==1||candidate.parents?.totalCount!==1||candidate.parents.nodes?.length!==1||candidate.parents.nodes[0].oid!==intent.head||blob?.oid!==gitBlob(intent.content)||blob.text!==intent.content||blob.byteSize!==Buffer.byteLength(intent.content)||blob.isTruncated!==false)return null;
    if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo.nameWithOwner))return null;
    return {commit:oid,url:`https://github.com/${repo.nameWithOwner}/commit/${oid}`,repoId:intent.repoId,repositoryNodeId:intent.repositoryNodeId};
  }
  async function recheck(project, source) {
    const repo=(await graph(repositoryQuery,{id:source.repositoryNodeId}))?.node,ref=repo?.defaultBranchRef;
    if(!sameRepository(repo,source)||repo.nameWithOwner!==project.repo||!writable(repo)||(repo.isPrivate?'private':'public')!==source.visibility||ref?.id!==source.branchNodeId||ref.name!==source.branch||!sameRepository(ref.repository,source))throw new WebError('access_changed',409);
  }
  return { snapshot, dispatch, recover, recheck };
}
