// Read-only, private reference graph. References never create decisions or proof.
import { createLearning } from './learning.mjs';
import { createDecisionGitHub, sourcePath } from './decision-github.mjs';
import { createRunBudget } from './runs.mjs';
import { exact, hash, numeric, projectId, requestJson, WebError } from './common.mjs';
import { lessonId, revision, decodeJson } from './learning-model.mjs';
import { parseProposal, readIssue } from '../learn.mjs';
import { parseLessons, lessonFingerprint } from '../../practices/night/files/scripts/keel/lib.mjs';

export const traceId = value => typeof value === 'string' && /^lesson-[a-f0-9]{40}$/.test(value);
const repoName = value => typeof value === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]{1,100}$/.test(value);
const fileKeys = ['repoId','repo','path','revision','blob'];
const rowKeys = [...fileKeys,'row','fingerprint'];
const fileRef = (v, row = false) => exact(v,row ? rowKeys : fileKeys)
  && numeric(v.repoId) && repoName(v.repo) && sourcePath(v.path) && revision(v.revision) && revision(v.blob)
  && (!row || numeric(v.row) && typeof v.fingerprint === 'string' && v.fingerprint.length <= 300);
const bounded = (v, test, limit = 5) => Array.isArray(v) && v.length <= limit && v.every(item=>test(item));
const migrationId = v => typeof v === 'string' && /^[0-9]{4}-[a-z0-9-]{1,120}$/.test(v);
export function validateLessonTrace(value) {
  const fail = () => { throw new WebError('invalid_lesson_trace',409); };
  if (!exact(value,['version','id','source','decision','catalogue','guards','migrations','proofs','release','adoptions'])
    || value.version !== 1 || !traceId(value.id) || !fileRef(value.source,true) || lessonId(value.source) !== value.id
    || !(value.catalogue === null || fileRef(value.catalogue,true))
    || !bounded(value.guards,fileRef) || !bounded(value.proofs,fileRef)
    || !bounded(value.migrations,m => exact(m,['id','source']) && migrationId(m.id) && fileRef(m.source))
    || !bounded(value.adoptions,a => exact(a,['projectId','cataloguePath','guardPaths','migrationIds'])
      && projectId(a.projectId) && sourcePath(a.cataloguePath)
      && bounded(a.guardPaths,g => exact(g,['sourcePath','projectPath']) && sourcePath(g.sourcePath) && sourcePath(g.projectPath))
      && bounded(a.migrationIds,migrationId),3)) fail();
  const d = value.decision, r = value.release;
  if (!(d === null || d.kind === 'proposal' && exact(d,['kind','source']) && fileRef(d.source)
    || d.kind === 'issue' && exact(d,['kind','repoId','repo','number']) && numeric(d.repoId) && repoName(d.repo) && numeric(d.number))) fail();
  if (!(r === null || exact(r,['repoId','repo','tag','revision']) && numeric(r.repoId) && repoName(r.repo)
    && revision(r.revision) && typeof r.tag === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(r.tag)
    && !r.tag.includes('..') && !r.tag.includes('//') && !r.tag.endsWith('/'))) fail();
  for (const items of [value.guards.map(f=>`${f.repoId}:${f.path}`),value.proofs.map(f=>`${f.repoId}:${f.path}`),value.migrations.map(m=>m.id),value.adoptions.map(a=>a.projectId)]) {
    if (new Set(items).size !== items.length) fail();
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 16384) fail();
  return value;
}
const node = (state,label,reason,extra = {}) => ({state,label,reason,...extra});
const missing = (label,reason = 'No supported source reference is available.') => node('unavailable',label,reason);
const inconsistent = (label,reason) => node('inconsistent',label,reason);
const decode = bytes => new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const sameRow = (a,b) => ['n','shape','cost','guard'].every(k=>a?.[k] === b?.[k]);
const link = ref => `https://github.com/${ref.repo}/blob/${ref.revision}/${ref.path.split('/').map(encodeURIComponent).join('/')}`;
const sourceFact = ref => ({...ref,url:link(ref)});

export function createLessonRollout(config,{fetcher = fetch,now = Date.now} = {}) {
  async function inspect(access,token,id) {
    if (!traceId(id)) throw new WebError('invalid_lesson_trace',400);
    const budget = createRunBudget(fetcher,{now}), transport = budget.fetcher;
    const learning = createLearning(config,{fetcher:transport}), workspace = await learning.workspace(access,token);
    const model = {schema:1,id,readAt:new Date(now()).toISOString(),manifestSource:null,
      source:missing('Original lesson'),decision:missing('Decision'),catalogue:missing('Catalogue row'),
      guards:[],migrations:[],proofs:[],release:missing('Release'),adoptions:[],gaps:[]};
    let manifest;
    try {
      const path = `lesson-traces/${id}.json`, bytes = await workspace.snapshot.reader.readFile(path);
      if (bytes.length > 16384) throw new WebError('invalid_lesson_trace',409);
      manifest = validateLessonTrace(decodeJson(bytes));
      if (manifest.id !== id) throw new WebError('invalid_lesson_trace',409);
      model.manifestSource = sourceFact({repoId:workspace.repository.repoId,repo:workspace.repository.repo,path,
        revision:workspace.snapshot.source.head,blob:workspace.snapshot.entries.get(path).sha});
    } catch (error) {
      if ([401,403,404].includes(error.status)) throw error;
      model.gaps.push({reason:error.code === 'ENOENT' ? 'No private trace reference manifest is present.' : 'The private trace manifest is invalid, unavailable or exceeds the read bound.'});
      return model;
    }
    const authorized = ref => {
      const project = access.projects.find(p=>p.repoId === ref.repoId && p.repo === ref.repo);
      if (project) { learning.authorizedProject(access,project); return project; }
      if (ref.repoId === workspace.repository.repoId && ref.repo === workspace.repository.repo) return workspace.repository;
      throw new WebError('trace_source_not_authorized',409);
    };
    const provider = createDecisionGitHub(token,{fetcher:transport}), loaded = new Map();
    async function file(ref) {
      const project = authorized(ref), key = JSON.stringify(ref);
      if (!loaded.has(key)) loaded.set(key,provider.readResult(project,ref.revision,ref.path));
      const result = await loaded.get(key);
      if (result.blob !== ref.blob) throw new WebError('trace_source_inconsistent',409);
      return result;
    }
    async function repository(ref) {
      authorized(ref);
      const observed = await requestJson(transport,`https://api.github.com/repositories/${ref.repoId}`,
        {headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}},65536);
      if (observed.id !== ref.repoId || observed.full_name !== ref.repo) throw new WebError('access_denied',404);
    }
    async function safely(label,work) {
      try { return await work(); }
      catch (error) {
        if ([401,403,404].includes(error.status)) throw error;
        if (error.code === 'trace_source_inconsistent') return inconsistent(label,'The referenced canonical source contradicts this reference.');
        return missing(label,error.code === 'trace_source_not_authorized' ? 'This source is outside current authorized repositories.' : 'Source unavailable, unsupported or beyond the shared read bound.');
      }
    }
    async function row(ref) {
      const result = await file(ref), rows = parseLessons(decode(result.bytes)).rows.filter(r=>r.n === ref.row);
      if (rows.length !== 1 || lessonFingerprint(ref.repo,rows[0]) !== ref.fingerprint) throw new WebError('trace_source_inconsistent',409);
      return rows[0];
    }
    let originalRow, catalogueRow;
    model.source = await safely('Original lesson',async()=>{
      originalRow = await row(manifest.source);
      return node('evidenced','Original lesson','Historical canonical lesson row observed.',{source:sourceFact(manifest.source),shape:originalRow.shape});
    });
    if (manifest.decision) model.decision = await safely('Decision',async()=>{
      if (!originalRow) return missing('Decision','The original identity could not be verified.');
      const d = manifest.decision;
      let status,outcome,reference;
      if (d.kind === 'proposal') {
        const proposal = parseProposal(decode((await file(d.source)).bytes));
        if (proposal.meta.from !== manifest.source.fingerprint || !['lesson','practice'].includes(proposal.meta.kind)) throw new WebError('trace_source_inconsistent',409);
        status = proposal.meta.status; outcome = proposal.meta.outcome ?? null;
        if (!['untriaged','proposed','accepted','declined','linked'].includes(status)
          || !(outcome === null && ['untriaged','declined'].includes(status) || ['lesson','practice','decline','link'].includes(outcome))
          || ['accepted','declined','linked'].includes(status) && !proposal.decision.trim()
          || status === 'accepted' && !['lesson','practice'].includes(outcome) || status === 'linked' && outcome !== 'link') throw new WebError('trace_source_inconsistent',409);
        reference = sourceFact(d.source);
      } else {
        await repository(d);
        const issue = await requestJson(transport,`https://api.github.com/repos/${d.repo}/issues/${d.number}`,
          {headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}},262144);
        const read = readIssue(issue), labels = (issue.labels || []).map(l=>typeof l === 'string' ? l : l?.name);
        const decisions = labels.filter(l=>typeof l === 'string' && l.startsWith('decided:'));
        if (issue.number !== d.number || issue.pull_request || read.fingerprint !== manifest.source.fingerprint || read.project !== manifest.source.repo
          || !labels.includes('lesson') || decisions.length > 1) throw new WebError('trace_source_inconsistent',409);
        outcome = decisions[0]?.slice(8) ?? null;
        if (outcome !== null && !['lesson','practice','decline','link'].includes(outcome)) throw new WebError('trace_source_inconsistent',409);
        status = outcome === null ? 'undecided' : outcome === 'decline' ? 'declined' : outcome === 'link' ? 'linked' : 'accepted';
        reference = {repoId:d.repoId,repo:d.repo,number:d.number,url:`https://github.com/${d.repo}/issues/${d.number}`,observedAt:model.readAt};
      }
      return node('evidenced','Decision','Canonical decision state observed; no release or installation is implied.',{source:reference,status,outcome});
    });
    if (manifest.catalogue) model.catalogue = await safely('Catalogue row',async()=>{
      catalogueRow = await row(manifest.catalogue);
      return node('evidenced','Catalogue row','Referenced canonical row observed. Its relationship is owner-declared, not inferred from wording.',{source:sourceFact(manifest.catalogue),shape:catalogueRow.shape});
    });
    for (const ref of manifest.guards) model.guards.push(await safely('Guard source',async()=>{
      await file(ref); return node('evidenced','Guard source','Exact file bytes present; working protection is not established.',{source:sourceFact(ref)});
    }));
    for (const migration of manifest.migrations) model.migrations.push(await safely('Migration source',async()=>{
      const text = decode((await file(migration.source)).bytes);
      // Inspect only a supported literal declaration; never import project code.
      if (!new RegExp(`export\\s+const\\s+id\\s*=\\s*['"]${migration.id}['"]\\s*;`).test(text)) throw new WebError('trace_source_inconsistent',409);
      return node('evidenced','Migration source','Expected literal migration identifier observed in source; implementation and execution are not established.',{id:migration.id,source:sourceFact(migration.source)});
    }));
    for (const ref of manifest.proofs) model.proofs.push(await safely('Proof reference',async()=>{
      await file(ref); return node('evidenced','Proof reference','Referenced file present; no passed check is inferred.',{source:sourceFact(ref)});
    }));
    const released = new Map();
    if (manifest.release) model.release = await safely('Release',async()=>{
      const r = manifest.release; await repository(r);
      const headers = {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'};
      const base = `https://api.github.com/repos/${r.repo}`;
      const ref = await requestJson(transport,`${base}/git/ref/tags/${r.tag.split('/').map(encodeURIComponent).join('/')}`,{headers},65536);
      if (ref.ref !== `refs/tags/${r.tag}`) throw new WebError('trace_source_inconsistent',409);
      let object = ref.object;
      for (let n=0;object?.type === 'tag' && n<3;n++) {
        if (!revision(object.sha)) throw new WebError('trace_source_inconsistent',409);
        const tag = await requestJson(transport,`${base}/git/tags/${object.sha}`,{headers},65536);
        if (tag.sha !== object.sha) throw new WebError('trace_source_inconsistent',409);
        object = tag.object;
      }
      if (object?.type !== 'commit' || object.sha !== r.revision) throw new WebError('trace_source_inconsistent',409);
      const refs = [...manifest.guards,...manifest.migrations.map(m=>m.source),...(manifest.catalogue?[manifest.catalogue]:[])];
      if (!catalogueRow || refs.some(f=>f.repoId !== r.repoId || f.repo !== r.repo)) return missing('Release','Tag identity observed, but complete catalogue/guard linkage is unavailable.');
      for (const source of refs) {
        const result = await provider.readResult(authorized(r),r.revision,source.path);
        if (source === manifest.catalogue) {
          const rows = parseLessons(decode(result.bytes)).rows.filter(x=>x.n === source.row);
          if (rows.length !== 1 || !sameRow(rows[0],catalogueRow)) throw new WebError('trace_source_inconsistent',409);
        } else {
          await file(source);
          if (result.blob !== source.blob) throw new WebError('trace_source_inconsistent',409);
          released.set(source.path,result);
        }
      }
      return node('evidenced','Release','Named tag and referenced contents observed; first release is not established.',{tag:r.tag,revision:r.revision,source:{repoId:r.repoId,repo:r.repo,url:`https://github.com/${r.repo}/tree/${r.revision}`}});
    });
    for (const selected of manifest.adoptions) model.adoptions.push(await safely('Project adoption',async()=>{
      const project = access.projects.find(p=>p.id === selected.projectId);
      if (!project) throw new WebError('trace_source_not_authorized',409);
      learning.authorizedProject(access,project);
      const snapshot = await provider.snapshot(project);
      const cfg = decodeJson(await snapshot.reader.readFile('.keel/keel.json'));
      const lock = decodeJson(await snapshot.reader.readFile('.keel/lock.json'));
      const facts = {project:{id:project.id,repo:project.repo},source:{...snapshot.source,url:`https://github.com/${project.repo}/tree/${snapshot.source.head}`},practice:typeof cfg.practice === 'string'?cfg.practice:null,lockPractice:typeof lock.practice === 'string'?lock.practice:null,lesson:missing('Lesson text'),guards:[],migrations:[],protection:missing('Executed protection'),acceptance:missing('Project acceptance')};
      if (model.release.state !== 'evidenced') return node('unavailable','Project adoption','Release content is not verified; no adoption is inferred.',facts);
      facts.lesson = await safely('Lesson text',async()=>{
        const rows = parseLessons(decode(await snapshot.reader.readFile(selected.cataloguePath))).rows.filter(r=>r.n === catalogueRow.n);
        return rows.length === 1 && sameRow(rows[0],catalogueRow) ? node('evidenced','Lesson text','Exact referenced catalogue row observed; this does not establish installed protection.') : inconsistent('Lesson text','Current catalogue does not contain the exact referenced row.');
      });
      for (const pair of selected.guardPaths) facts.guards.push(await safely('Installed guard',async()=>{
        const expected = released.get(pair.sourcePath);
        if (!manifest.guards.some(f=>f.path === pair.sourcePath) || !expected) return missing('Installed guard','No verified released guard corresponds to this mapping.');
        if (Array.isArray(cfg.ejected) && cfg.ejected.includes(pair.projectPath)) return inconsistent('Installed guard','This guard path is ejected.');
        const bytes = await snapshot.reader.readFile(pair.projectPath), entry = lock.files?.[pair.projectPath];
        if (!entry) return missing('Installed guard','No managed-file lock entry is available; rendered blocks and project-owned paths need separate proof.');
        if (entry.sha256 !== hash(bytes)) return inconsistent('Installed guard','Current guard bytes differ from the managed lock; local customization is visible.');
        if (!bytes.equals(expected.bytes)) return missing('Installed guard','Managed bytes differ from the release reference. Rendered templates, selected guides and blocks need trusted rendering proof; raw equality cannot establish them.');
        return node('evidenced','Installed guard','Current bytes and managed lock match the referenced release; execution remains unverified.',{path:pair.projectPath});
      }));
      for (const migrationId of selected.migrationIds) facts.migrations.push(
        manifest.migrations.some(m=>m.id === migrationId) && Array.isArray(cfg.migrations) && cfg.migrations.includes(migrationId)
          ? node('evidenced','Recorded migration','Current project configuration records this released migration; execution is not independently verified.',{id:migrationId})
          : missing('Recorded migration','A released migration reference or current recorded ID is absent.',{id:migrationId}));
      const checks = [facts.lesson,...facts.guards,...facts.migrations];
      return node(checks.some(c=>c.state === 'inconsistent')?'inconsistent':checks.every(c=>c.state === 'evidenced')?'evidenced':'unavailable','Project adoption','These are separate source observations, not project acceptance.',facts);
    }));
    if (budget.exhausted) model.gaps.push({reason:'The shared source read bound was reached; remaining evidence is unavailable.'});
    model.gaps.push({reason:'Reference relationships are owner-authored. Protection execution and acceptance are not established by this read.'});
    return model;
  }
  return {inspect};
}
