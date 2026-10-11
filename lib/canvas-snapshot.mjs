// Read-only projection of authored records and saved measurements. Never run a
// gate, project script, model, retro, or workflow to manufacture an observation.
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parsePhase, boxes, sectionsOf } from '../practices/phases/files/scripts/roadmap.mjs';
import { parseProject } from './phases-projects.mjs';
import { parseFinding } from '../practices/loop/files/scripts/loop.mjs';
import { parseLessons, lessonFingerprint, healthDirOf, cells } from '../practices/night/files/scripts/keel/lib.mjs';
import { MEASURES } from '../practices/night/files/scripts/keel/improve.mjs';
import { parseProposal } from './learn.mjs';
import { readRuns, flaky, slower } from '../practices/night/files/scripts/keel/test-ledger.mjs';
import { reconcile } from '../practices/reconciliation/files/scripts/keel/reconcile.mjs';

const exec = promisify(execFile);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim().length > 0;
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const COVERAGE = ['ok', 'stale', 'unavailable', 'unsupported', 'disabled'];
const KINDS = ['phase', 'goal', 'decision', 'loop', 'lesson', 'retro', 'health', 'test', 'pr', 'release', 'update', 'review', 'loose-end'];
export const SOURCES = Object.freeze(['project', 'git', 'goals', 'phases', 'decisions', 'reconciliation', 'loop', 'lessons', 'lesson-sent', 'inbox', 'retros', 'health', 'tests', 'climb', 'tend', 'dependencies', 'reviews', 'drain', 'loose-ends', 'releases', 'fleet', 'github']);
const units = new Map(MEASURES.map(m => [m.id, m.unit]));
const unknown = reason => ({ value: null, reason });
const facts = () => Object.fromEntries(['implemented', 'merged', 'productionVerified', 'livedIn'].map(k => [k, unknown('No explicit observation for this stage')]));
function invalid(message) { const e = new Error(`canvas snapshot: ${message}`); e.exitCode = 2; throw e; }
function relativePath(path) {
  return text(path) && !path.startsWith('/') && !/[\\\x00-\x1f:]/.test(path)
    && path.split('#')[0].split('/').every(p => p && p !== '.' && p !== '..');
}
function safeURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search; } catch { return false; }
}

// Restrict a receipt read to the same Markdown section the engine validated.
function evidenceSection(raw, reference) {
  const anchor = reference.split('#')[1];
  if (!anchor) return raw;
  const lines = raw.split(/\r?\n/), seen = new Map();
  let start = -1, level = 7, pending = null;
  for (let i = 0; i < lines.length; i++) {
    const explicit = /<a\s+(?:id|name)=["']([\w.-]+)["']\s*>\s*<\/a>/.exec(lines[i]);
    const h = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (h) {
      if (start >= 0 && pending !== anchor && h[1].length <= level) return lines.slice(start, i).join('\n');
      const slug = h[2].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
      const count = seen.get(slug) || 0; seen.set(slug, count + 1);
      if ((explicit?.[1] || pending || `${slug}${count ? `-${count}` : ''}`) === anchor) { start = i; level = h[1].length; }
      pending = null;
    } else if (explicit) {
      pending = explicit[1];
      if (explicit[1] === anchor) { start = i; level = 7; }
    }
  }
  return start < 0 ? '' : lines.slice(start).join('\n');
}

/** Validate before rendering or publishing. Returns the same object; throws exitCode 2. */
export function validateSnapshot(s) {
  if (!object(s) || s.schema !== 1) invalid('unsupported schema (expected 1)');
  if (!object(s.project) || !text(s.project.key) || !text(s.project.name) || !(s.project.repo === null || text(s.project.repo))) invalid('invalid project');
  if (!object(s.revision) || !(s.revision.commit === null || /^[a-f\d]{40,64}$/i.test(s.revision.commit)) || ![true, false, null].includes(s.revision.dirty)) invalid('invalid revision');
  if (!date(s.generatedAt)) invalid('invalid generatedAt');
  for (const k of ['coverage', 'entities', 'relations', 'observations', 'metrics', 'warnings']) if (!Array.isArray(s[k])) invalid(`${k} must be an array`);
  const unique = (rows, field, label) => {
    const ids = new Set();
    for (const r of rows) { if (!object(r) || !text(r[field]) || ids.has(r[field])) invalid(`invalid or duplicate ${label}`); ids.add(r[field]); }
    return ids;
  };
  unique(s.coverage, 'source', 'coverage source');
  for (const c of s.coverage) if (!COVERAGE.includes(c.status) || !date(c.observedAt) || (c.status !== 'ok' && !text(c.reason))) invalid('invalid coverage');
  const keys = unique(s.entities, 'key', 'entity key');
  const source = src => {
    if (!object(src) || (!text(src.path) && !text(src.url) && src.type !== 'supplied-report')) invalid('missing source reference');
    if (src.path !== undefined && !relativePath(src.path)) invalid('unsafe source path');
    if (src.url !== undefined && !safeURL(src.url)) invalid('unsafe source URL');
  };
  for (const e of s.entities) {
    if (!KINDS.includes(e.kind) || !text(e.title)) invalid('invalid entity');
    source(e.source);
    if (e.facts !== undefined) {
      if (!object(e.facts)) invalid('invalid facts');
      for (const f of Object.values(e.facts)) if (!object(f) || ![true, false, null].includes(f.value) || (f.value === null ? !text(f.reason) : !f.source)) invalid('invalid delivery fact');
    }
  }
  for (const r of s.relations) { if (!object(r) || !keys.has(r.from) || !keys.has(r.to) || !text(r.kind)) invalid('dangling relation'); if (r.source) source(r.source); }
  unique(s.observations, 'id', 'observation id');
  for (const o of s.observations) {
    if (!keys.has(o.entity) || !text(o.field) || !Object.hasOwn(o, 'value') || !date(o.observedAt) || !['verified', 'reported', 'inferred', 'unknown'].includes(o.quality) || !Array.isArray(o.evidence) || !Object.hasOwn(o, 'sourceRevision') || (o.occurredAt !== undefined && !date(o.occurredAt))) invalid('invalid observation');
    source(o.source);
  }
  unique(s.metrics, 'id', 'metric id');
  for (const m of s.metrics) if (!text(m.label) || !text(m.unit) || !COVERAGE.includes(m.coverage) || !(m.value === null || Number.isFinite(m.value)) || (m.coverage !== 'ok' && m.value !== null) || !Array.isArray(m.entityKeys) || m.entityKeys.some(k => !keys.has(k))) invalid('invalid metric');
  const privateKeys = /^(?:rawSummary|rawTranscript|transcripts?|session(?:Id|Path|Pointer)?|commands?|token|accessToken|password|secret|authorization|credentials)$/i;
  function privacy(value) {
    if (Array.isArray(value)) { for (const v of value) privacy(v); return; }
    if (object(value)) { for (const [key, v] of Object.entries(value)) { if (privateKeys.test(key)) invalid('private raw payload field is not publishable'); privacy(v); } return; }
    if (typeof value === 'string') for (const m of value.matchAll(/https?:\/\/[^\s<>"')\x60]+/g)) if (!safeURL(m[0])) invalid('unsafe embedded URL');
  }
  privacy(s);
  return s;
}

/**
 * Collect local evidence; GitHub is opt-in and uses the reconciliation reader.
 * report: already measured improve {date, measures}, its {data} envelope, or
 * a repository-relative JSON path. Supplied values supersede saved same-day data.
 * artifacts: objects/relative JSON paths with {schema:1, projectKey, source,
 * observedAt, entities, relations?, observations?}; source names a SOURCES lane.
 * history: earlier schema-1 snapshots (objects/relative paths), same project key.
 * windowDays: observation window, default 30. No historical states are invented.
 */
export async function snapshot({ root, github = false, now = new Date(), env = process.env, report, artifacts = [], history = [], windowDays = 30 }) {
  root = await realpath(resolve(root));
  const generatedAt = new Date(now).toISOString();
  if (!Number.isFinite(windowDays) || windowDays <= 0) invalid('windowDays must be positive');
  if (!Array.isArray(artifacts) || !Array.isArray(history)) invalid('artifacts and history must be arrays');
  // Bound reads and refuse links at every component, including configured paths.
  async function pathOf(path) {
    if (!relativePath(path) || path.includes('#')) throw Error('unsafe configured source path');
    let target = root;
    for (const part of path.split('/')) { target = join(target, part); if ((await lstat(target)).isSymbolicLink()) throw Error(`symlink source refused: ${path}`); }
    return target;
  }
  async function read(path) {
    const p = await pathOf(path), stat = await lstat(p);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error(`source is not a bounded regular file: ${path}`);
    return readFile(p, 'utf8');
  }
  const json = async path => JSON.parse(await read(path));
  async function names(path, suffix) {
    const entries = await readdir(await pathOf(path), { withFileTypes: true });
    if (entries.length > 2000) throw Error(`too many records: ${path}`);
    return entries.filter(e => suffix ? e.name.endsWith(suffix) && e.name !== 'README.md' : e.isDirectory()).map(e => e.name).sort();
  }
  const cfg = await json('.keel/keel.json');
  if (!object(cfg)) invalid('project configuration must be an object');
  const repo = typeof cfg.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(cfg.repo) ? cfg.repo : null;
  const s = { schema: 1, project: { key: cfg.canvas?.projectKey || `local:${hash(repo || root).slice(0, 24)}`, name: cfg.name || basename(root), repo }, revision: { commit: null, dirty: null }, generatedAt, coverage: [], entities: [], relations: [], observations: [], metrics: [], warnings: [] };
  const covered = new Map(), entities = new Map(), pendingRelations = [];
  const coverage = (source, status, reason) => covered.set(source, { source, status, ...(reason ? { reason } : {}), observedAt: generatedAt });
  const warn = message => s.warnings.push(message);
  const src = path => ({ path, revision: s.revision.commit });
  function add(e) {
    e.observedAt ??= generatedAt;
    e.area ??= e.kind;
    if (entities.has(e.key)) { warn(`Duplicate source identity: ${e.key}; retained first record, excluded ambiguous outcomes`); const old = entities.get(e.key); old.ambiguous = true; return old; }
    entities.set(e.key, e); return e;
  }
  function observation(entity, field, value, source, occurredAt, quality = 'reported', evidence = []) {
    s.observations.push({ id: `observation:${hash([entity, field, source, occurredAt ?? null, value])}`, entity, field, value, source, sourceRevision: source.revision ?? null, observedAt: generatedAt, ...(date(occurredAt) ? { occurredAt } : {}), quality, evidence });
  }
  function healthEntity(e) {
    const previous = entities.get(e.key);
    if (previous) {
      entities.delete(e.key);
      s.observations = s.observations.filter(o => o.entity !== e.key);
      e.reconciliation ??= previous.reconciliation;
      e.measures = e.measures.map(m => {
        const old = previous.measures.find(p => p.id === m.id);
        return { ...m, unit: m.unit ?? old?.unit ?? null, better: m.better ?? old?.better ?? null };
      });
    }
    return add(e);
  }
  async function collect(source, fn) {
    try { await fn(); if (!covered.has(source)) coverage(source, 'ok'); }
    catch (e) { coverage(source, 'unavailable', e.code === 'ENOENT' ? 'No saved source records' : String(e.message).replaceAll(root, '<project>')); }
  }
  async function git(args) { return (await exec('git', ['-C', root, ...args], { env, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
  await collect('git', async () => {
    s.revision.commit = await git(['rev-parse', 'HEAD']);
    s.revision.dirty = !!await git(['status', '--porcelain', '--untracked-files=normal']);
  });
  if (!cfg.canvas?.projectKey) warn('Project has no persisted canvas.projectKey; local identity is provisional until connection.');
  add({ key: 'update:configuration', kind: 'update', title: 'Recorded practice installation', source: src('.keel/keel.json'), status: 'recorded', practiceVersion: cfg.practice ?? null, migrations: Array.isArray(cfg.migrations) ? cfg.migrations.filter(text) : [], facts: facts() });
  coverage('project', 'ok');
  await collect('goals', async () => {
    const rows = await json('docs/goals.json');
    if (!Array.isArray(rows)) throw Error('Unsupported goals schema');
    for (const g of rows) {
      if (!text(g.id) || !text(g.title)) throw Error('Invalid goal record');
      add({ key: `goal:${g.id}`, kind: 'goal', title: g.title, source: src('docs/goals.json'), status: g.retired ? 'retired' : 'active', outcome: g.outcome ?? null });
    }
  });
  const phaseDocs = new Map();
  async function phase(p, path, raw, project) {
    const key = `phase:${path}`;
    const e = add({ key, kind: 'phase', title: p.title, source: src(path), status: p.status, ...(p.goal ? { goal: p.goal } : {}), ...(project ? { project } : {}), facts: facts(), next: p.next ?? null, acceptance: boxes(sectionsOf(raw).Acceptance ?? ''), evidence: (p.evidence ?? []).map(v => `docs/${v}`) });
    e.facts.implemented = ['built', 'lived-in'].includes(p.status) ? { value: true, source: 'phase', evidence: e.evidence, quality: 'reported' } : unknown('Phase has no complete implementation claim');
    if (p.status === 'lived-in') e.facts.livedIn = { value: true, source: 'phase', evidence: e.evidence, quality: 'reported' };
    for (const path of e.evidence) { try { if (!(await read(path)).trim()) throw Error('empty evidence'); } catch { e.evidenceMissing = true; warn(`Missing evidence for ${key}: ${path}`); } }
    observation(key, 'status', p.status, e.source, p.since);
    if (p.goal) pendingRelations.push({ from: key, to: `goal:${p.goal}`, kind: 'serves', source: e.source });
    phaseDocs.set(key, raw);
    return e;
  }
  await collect('phases', async () => {
    if (cfg.phases?.source === 'milestones') { coverage('phases', 'unsupported', 'GitHub milestones are a read-only planning source; canvas does not collect this source yet. Use keel next or the board.'); return; }
    if (cfg.phases?.shape && !['files', 'projects'].includes(cfg.phases.shape)) { coverage('phases', 'unsupported', `Unknown phase shape: ${cfg.phases.shape}`); return; }
    if (cfg.phases?.shape === 'projects') {
      for (const project of await names('docs/projects')) {
        const path = `docs/projects/${project}/phases.md`;
        let raw; try { raw = await read(path); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
        const parsed = parseProject(project, raw), lines = raw.split(/\r?\n/);
        for (let i = 0; i < parsed.phases.length; i++) {
          const p = parsed.phases[i], section = lines.slice(p.line - 1, parsed.phases[i + 1] ? parsed.phases[i + 1].line - 1 : undefined).join('\n');
          const heading = section.split('\n')[0].replace(/^##\s+/, '');
          const anchor = heading.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
          await phase(p, `${path}#${anchor}`, section.replace(/^### /gm, '## '), project);
        }
        for (const lint of parsed.lint) warn(`${lint.path}: ${lint.message}`);
      }
    } else {
      const byId = new Map();
      for (const file of await names('docs/phases', '.md')) {
        const path = `docs/phases/${file}`, raw = await read(path);
        try { const p = parsePhase(file, raw); await phase(p, path, raw); byId.set(p.id, { p, key: `phase:${path}` }); }
        catch (e) { add({ key: `phase:${path}`, kind: 'phase', title: /^# (.+)$/m.exec(raw)?.[1] || file, source: src(path), status: 'unknown', facts: facts() }); coverage('phases', 'unavailable', 'Some phase records could not be parsed'); warn(e.message); }
      }
      for (const { p, key } of byId.values()) for (const id of p.depends) {
        if (byId.has(id)) pendingRelations.push({ from: key, to: byId.get(id).key, kind: 'depends-on', source: src(`docs/phases/${p.file}`) });
        else warn(`${key}: dependency ${id} is missing`);
      }
    }
  });

  let reconciliation;
  let trackedResearch = new Set();
  try { trackedResearch = new Set((await git(['ls-files', '--', 'docs/research', 'docs/design.md'])).split('\n')); } catch { /* untracked research is never published */ }
  const publishRecord = path => !/^docs\/(research\/|design\.md$)/.test(path) || trackedResearch.has(path.split('#')[0]);
  await collect('reconciliation', async () => {
    reconciliation = await reconcile({ root, github, now, env });
    if (reconciliation.unknown.length) coverage('reconciliation', 'unavailable', 'Existing reconciliation reader reported incomplete observations');
    for (const f of [...reconciliation.findings, ...reconciliation.unknown].filter(f => publishRecord(f.path))) warn(`${f.rule}: ${f.path}: ${f.message}`);
    // Findings/proposals remain review data; do not apply their proposed edits.
    s.reconciliation = { findings: reconciliation.findings.filter(f => publishRecord(f.path)), unknown: reconciliation.unknown.filter(f => publishRecord(f.path)), observedAt: generatedAt, fresh: true };
  });
  coverage('github', !github ? 'disabled' : reconciliation?.snapshot.remote === 'observed' ? 'ok' : 'unavailable', !github ? 'Remote reads require github: true' : reconciliation?.snapshot.remote === 'observed' ? undefined : 'GitHub observations unavailable or incomplete');
  for (const [ref, p] of Object.entries(reconciliation?.snapshot.prs ?? {})) {
    const url = p.html_url || `https://github.com/${ref.replace('#', '/pull/')}`;
    if (!safeURL(url)) continue;
    add({ key: `pr:${ref}`, kind: 'pr', title: ref, source: { url }, status: p.merged_at ? 'merged' : p.state, facts: { ...facts(), merged: { value: !!p.merged_at, source: url, observedAt: generatedAt } } });
  }
  await collect('decisions', async () => {
    // Only authoritative decision fences in the existing engine's inventory.
    for (const path of reconciliation?.snapshot.inventory ?? []) {
      if (!/^docs\/(decisions\/|research\/|design\.md$)/.test(path) || !publishRecord(path)) continue;
      const raw = await read(path);
      for (const m of raw.matchAll(/```keel-decision\s*\n([\s\S]*?)\n```/g)) {
        const d = JSON.parse(m[1]);
        if (d.version !== 1 || !text(d.id) || !['proposed', 'accepted', 'superseded', 'withdrawn'].includes(d.status)) throw Error('Unsupported decision record');
        if (!path.startsWith('docs/decisions/') && !raw.slice(0, m.index).includes(`id="${d.id}"`)) continue;
        const ref = `${path}#${d.id}`, key = `decision:${ref}`;
        add({ key, kind: 'decision', title: d.id, status: d.status, source: src(ref), scope: d.scope, decidedAt: d.decided_at ?? null });
        for (const old of d.supersedes ?? []) pendingRelations.push({ from: key, to: `decision:${old}`, kind: 'supersedes', source: src(ref) });
      }
    }
    if (![...entities.values()].some(e => e.kind === 'decision')) coverage('decisions', 'unavailable', 'No structured decision records');
  });
  for (const [key, raw] of phaseDocs) {
    const e = entities.get(key);
    for (const m of raw.matchAll(/```keel-reconciliation\s*\n([\s\S]*?)\n```/g)) {
      let r; try { r = JSON.parse(m[1]); } catch { continue; }
      if (r.version !== 1) continue;
      for (const ref of r.prs ?? []) {
        const normalized = typeof ref === 'string' ? ref.replace(/^https:\/\/github.com\//, '').replace('/pull/', '#') : '';
        const pr = entities.get(`pr:${normalized}`);
        if (pr) pendingRelations.push({ from: key, to: pr.key, kind: 'implemented-by', source: e.source });
      }
      // Merge belongs to PRs; never promotes phase acceptance. Likewise, scoped
      // receipts belong to their acceptance IDs rather than every phase box.
      const blocked = !reconciliation || reconciliation.unknown.length || reconciliation.findings.some(f => f.path.split('#')[0] === e.source.path.split('#')[0]);
      if (!blocked) for (const lane of ['implementation', 'production', 'use']) for (const entry of r[lane] ?? []) {
        const proofPath = entry.evidence.split('#')[0];
        let proofText; try { proofText = evidenceSection(await read(proofPath), entry.evidence); } catch { continue; }
        // The reconciliation engine has already validated the scoped reference.
        // Preserve the actual receipt; never synthesize a pass from a checkbox.
        for (const match of proofText.matchAll(/```keel-proof\s*\n([\s\S]*?)\n```/g)) {
          let receipt; try { receipt = JSON.parse(match[1]); } catch { continue; }
          if (receipt.version !== 1 || receipt.kind !== lane || receipt.acceptance !== entry.acceptance || receipt.result !== 'pass' || receipt.invalidated === true || !text(receipt.environment) || !text(receipt.observer) || !text(receipt.claim) || !date(receipt.observed_at) || !/^[a-f\d]{40,64}$/i.test(receipt.sha ?? '')) continue;
          const proof = { ...receipt, reference: entry.evidence };
          (e.proofs ??= []).push(proof);
          observation(e.key, `proof:${lane}:${entry.acceptance}`, { result: 'pass', kind: lane, acceptance: entry.acceptance, environment: receipt.environment }, { path: entry.evidence, revision: receipt.sha }, receipt.observed_at, 'verified', [entry.evidence]);
        }
      }
      for (const [field, lane] of [['productionVerified', 'production'], ['livedIn', 'use']]) {
        if (!blocked && Array.isArray(r[lane]) && r[lane].length) e.facts[field] = { value: true, source: 'reconciliation', quality: 'verified', acceptance: r[lane].map(x => x.acceptance), evidence: r[lane].map(x => x.evidence), observedAt: generatedAt };
      }
    }
  }
  await collect('loop', async () => {
    if (cfg.local?.loop) { coverage('loop', 'unsupported', 'Local Loop variant has no registered adapter'); return; }
    const dir = cfg.loop?.dir ?? 'docs/loop', seen = new Map();
    for (const file of await names(dir, '.md')) {
      const path = `${dir}/${file}`, f = parseFinding(await read(path), file.slice(0, -3));
      const aliases = [...new Set(f.loop)].sort();
      const previous = aliases.map(id => seen.get(id)).find(Boolean);
      if (previous) {
        previous.ambiguous = true;
        previous.aliases = [...new Set([...previous.aliases, ...aliases])].sort();
        for (const id of aliases) seen.set(id, previous);
        warn(`Duplicate Loop aliases at ${path}; outcomes excluded for ${previous.key}`);
        coverage('loop', 'unavailable', 'Duplicate canonical finding aliases require source review');
        continue;
      }
      const e = add({ key: `loop:${aliases[0] ?? path}`, kind: 'loop', title: f.title, source: src(path), status: f.decision, aliases, rank: f.rank, upstreamRank: f.loop_rank, upstreamState: f.loop_state, project: f.project, facts: facts() });
      for (const id of aliases) seen.set(id, e);
      observation(e.key, 'status', f.decision, e.source, f.since);
      const target = [...entities.values()].find(p => p.kind === 'phase' && (f.project ? p.project === f.project && f.phase !== null && p.source.path.includes(`#phase-${f.phase}-`) : f.phase !== null && new RegExp(`/0*${f.phase}-`).test(p.source.path)));
      if (target) pendingRelations.push({ from: e.key, to: target.key, kind: 'addresses', source: e.source });
      // A done decision is reported resolution only. A phase link alone is not
      // a passing proof for this finding and this affected revision.
    }
  });
  let sent = null;
  await collect('lesson-sent', async () => { sent = await json('.keel/sent.json'); if (!object(sent)) throw Error('Invalid sent fingerprint record'); });
  await collect('lessons', async () => {
    const path = cfg.lessons ?? 'docs/lessons.md', table = parseLessons(await read(path));
    if (table.guard < 0) { coverage('lessons', 'unsupported', 'No recognized lesson table'); return; }
    for (const row of table.rows) {
      const fingerprint = lessonFingerprint(repo || s.project.key, row), receipt = sent?.[fingerprint];
      const e = add({ key: `lesson:${fingerprint}`, kind: 'lesson', subtype: 'catalogue', area: 'lessons', title: row.shape, source: src(path), status: receipt ? 'sent' : sent ? 'local' : 'unknown', fingerprint, number: row.n, guard: row.guard, provenance: row.where, sentAt: date(receipt?.at) ? receipt.at : null });
      if (receipt) observation(e.key, 'sent', true, src('.keel/sent.json'), receipt.at);
    }
  });
  await collect('inbox', async () => {
    for (const file of await names('docs/inbox', '.md')) {
      const path = `docs/inbox/${file}`, p = parseProposal(await read(path));
      const e = add({ key: `lesson:inbox:${path}`, kind: 'lesson', subtype: 'inbox-proposal', area: 'inbox', title: p.title || file, source: src(path), status: p.meta.status, proposalKind: p.meta.kind, outcome: p.meta.outcome ?? null, origin: p.meta.from ?? null });
      // These are the decision writer's literal record forms, not title matches.
      const decidedLesson = /accepted \(lesson\): lesson (\d+) in docs\/lessons\.md/.exec(p.decision)?.[1];
      const number = typeof p.meta.link === 'number' ? p.meta.link : decidedLesson ? Number(decidedLesson) : null;
      const lesson = [...entities.values()].find(l => l.subtype === 'catalogue' && l.number === number);
      if (lesson) pendingRelations.push({ from: e.key, to: lesson.key, kind: 'derived-from', source: e.source });
    }
  });
  await collect('retros', async () => {
    const dir = cfg.paths?.retros ?? 'docs/retros';
    for (const file of await names(dir, '.json')) {
      const path = `${dir}/${file}`, r = await json(path);
      if (r.schema !== 1 || !text(r.id) || !Array.isArray(r.candidates)) { coverage('retros', 'unsupported', 'Unknown captured retro schema'); continue; }
      const e = add({ key: `retro:${r.id}`, kind: 'retro', title: `Captured retro ${date(r.date) ? r.date : r.id}`, source: src(path), status: 'captured', provider: r.provider ?? 'unknown', countCoverage: r.coverage ?? 'unknown', candidates: r.candidates.map(c => ({ id: c.id, type: c.type, decision: { status: c.decision?.status ?? 'pending', ...(date(c.decision?.date) ? { date: c.decision.date } : {}) }, links: Array.isArray(c.links) ? c.links.filter(v => relativePath(v) || safeURL(v)) : [], evidence: Array.isArray(c.evidence) ? c.evidence.filter(relativePath) : [] })) });
      // Never publish transcript/session pointers, command text, arbitrary
      // summaries or provider payloads; these are not public capture metadata.
      for (const c of e.candidates) for (const link of c.links) {
        const target = [...entities.values()].find(x => x.key === link || x.source.path === link || x.source.url === link);
        if (target) pendingRelations.push({ from: e.key, to: target.key, kind: 'candidate-change', candidate: c.id, source: e.source });
      }
      observation(e.key, 'captured', true, e.source, r.date);
    }
  });
  await collect('health', async () => {
    const dir = healthDirOf(cfg);
    const files = [...await names(dir, '.md'), ...await names(dir, '.json')];
    for (const file of files) {
      const path = `${dir}/${file}`, raw = await read(path);
      let when, measures;
      if (file.endsWith('.json')) {
        const report = JSON.parse(raw), data = report.data ?? report;
        if (!date(data.date) || !Array.isArray(data.measures)) throw Error('Unsupported saved improve JSON');
        when = data.date; measures = data.measures.map(m => ({ id: m.id, value: Number.isFinite(m.value) ? m.value : null, state: m.state, bound: m.bound ?? null, unit: m.unit ?? units.get(m.id) ?? null, better: m.better ?? null }));
      } else {
        when = /^# Health — (\d{4}-\d{2}-\d{2})$/m.exec(raw)?.[1];
        if (!when) continue;
        measures = raw.split('\n').filter(l => /^\| `[^`]+` — /.test(l)).map(l => {
          const c = cells(l), id = /^`([^`]+)`/.exec(c[0])?.[1];
          return { id, value: /^-?\d+(\.\d+)?$/.test(c[1]) ? Number(c[1]) : null, state: c[3], bound: c[2], unit: units.get(id) ?? null };
        });
      }
      const e = healthEntity({ key: `health:${when}`, kind: 'health', title: `Health — ${when}`, date: when, source: src(path), status: measures.some(m => m.state === 'broken') ? 'broken' : 'recorded', measures });
      if (file.endsWith('.md')) {
        const section = sectionsOf(raw)['Reconciliation (manual review)'];
        const fenced = section && /```json\s*\n([\s\S]*?)\n```/.exec(section);
        if (fenced) {
          try { const saved = JSON.parse(fenced[1]); e.reconciliation = { findings: Array.isArray(saved.findings) ? saved.findings.map(f => ({ rule: f.rule, path: f.path, message: f.message })) : [], unknown: Array.isArray(saved.unknown) ? saved.unknown.length : null, fresh: false }; }
          catch { warn(`Malformed saved reconciliation at ${path}`); }
        }
      }
      for (const m of measures) observation(e.key, `measure:${m.id}`, ['broken', 'n/a'].includes(m.state) ? null : m.value, e.source, when, 'reported');
    }
    if (![...entities.values()].some(e => e.kind === 'health')) coverage('health', 'unavailable', 'No recognized saved health reports');
  });
  if (report !== undefined) await collect('night-report', async () => {
    const raw = typeof report === 'string' ? await json(report) : report;
    const r = raw?.data ?? raw;
    if (!date(r?.date) || !Array.isArray(r.measures)) throw Error('Invalid supplied improve report');
    const source = typeof report === 'string' ? src(report) : { type: 'supplied-report', revision: s.revision.commit };
    const measures = r.measures.map(m => ({ id: m.id, value: Number.isFinite(m.value) ? m.value : null, state: m.state, bound: m.bound ?? null, unit: m.unit ?? units.get(m.id) ?? null, better: m.better ?? null }));
    const e = healthEntity({ key: `health:${r.date}`, kind: 'health', title: `Supplied night measures ${r.date}`, source, date: r.date, status: measures.some(m => m.state === 'broken') ? 'broken' : 'recorded', measures });
    for (const m of measures) observation(e.key, `measure:${m.id}`, ['broken', 'n/a'].includes(m.state) ? null : m.value, source, r.date);
  });
  await collect('tests', async () => {
    // Preflight the existing reader's paths; it deliberately tolerates malformed
    // records, which are exposed as incomplete coverage here.
    for (const file of await names('.keel/test-runs', '.json')) await read(`.keel/test-runs/${file}`);
    const { runs, skipped } = await readRuns(root), distinct = new Map();
    for (const run of runs) {
      const identity = hash([run.date, run.commit, run.tree, run.dir ?? '.', run.config ?? null, run.workflow ?? null, run.tests]);
      if (!distinct.has(identity)) distinct.set(identity, run);
    }
    for (const [identity, r] of distinct) {
      const path = `.keel/test-runs/${r.id}.json`;
      const e = add({ key: `test:${identity}`, kind: 'test', title: `Test run ${r.date}`, source: { ...src(path), revision: r.commit ?? null }, status: r.tests.some(t => t.outcome === 'fail') ? 'fail' : r.tests.some(t => t.outcome === 'pass') ? 'pass' : 'no-tests', counts: Object.fromEntries(['pass', 'fail', 'skip', 'todo'].map(outcome => [outcome, r.tests.filter(t => t.outcome === outcome).length])), workflow: r.workflow ?? null, dirty: r.dirty ?? null, machine: r.machine ?? null, config: r.config ?? null });
      observation(e.key, 'outcome', e.status, e.source, r.date);
    }
    s.testHygiene = { flaky: flaky([...distinct.values()]).map(f => ({ name: f.name, file: relativePath(f.file) ? f.file : null, passed: f.passed, failed: f.failed })), slower: slower([...distinct.values()]).map(f => ({ name: f.name, file: relativePath(f.file) ? f.file : null, ms: f.ms, median: f.median })) };
    if (skipped || !runs.length) coverage('tests', 'unavailable', skipped ? `${skipped} saved test records unreadable` : 'No saved test runs');
  });
  for (const [source, path] of [['climb', '.keel/climb/night.json'], ['tend', '.keel/tend/pass.json']]) await collect(source, async () => {
    const r = await json(path);
    if (!object(r)) throw Error('Invalid saved upkeep record');
    add({ key: `health:${source}:${r.date ?? 'latest'}`, kind: 'health', title: `Saved ${source} pass`, source: src(path), status: typeof r.decision === 'string' ? r.decision : 'recorded', job: typeof r.job === 'string' ? r.job : null, date: date(r.date) ? r.date : null });
    coverage(source, 'ok', 'Saved metadata only; no gates, proposals or models executed');
  });
  await collect('loose-ends', async () => {
    const path = '.keel/loose-ends.json', data = await json(path);
    if (!Array.isArray(data.marks)) throw Error('Invalid loose-end marks');
    for (const m of data.marks) {
      if (!text(m.fingerprint) || !['resume', 'park', 'drop'].includes(m.move)) continue;
      add({ key: `loose-end:${hash(m.fingerprint)}`, kind: 'loose-end', title: 'Recorded owner choice', source: src(path), status: m.move, until: date(m.until) ? m.until : null });
    }
    coverage('loose-ends', 'ok', 'Saved owner marks only; private sessions and other checkouts are not scanned');
  });
  await collect('releases', async () => {
    const rows = await git(['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/tags']);
    for (const row of rows.split('\n').filter(Boolean)) {
      const [tag, revision] = row.split('\t');
      add({ key: `release:${tag}`, kind: 'release', title: tag, source: repo ? { url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`, revision } : { ...src('.keel/keel.json'), revision }, status: 'tagged' });
    }
    coverage('releases', 'ok', 'Local tags only; a tag does not establish publication or fleet adoption');
  });
  // These areas require APIs or artifacts not supplied by the existing local
  // readers. State the exact gap instead of turning absent telemetry into zero.
  for (const [source, reason] of Object.entries({
    dependencies: 'No recorded dependency artifact supplied; local lockfiles do not establish PR/CI history',
    reviews: 'No recorded review-answer artifact supplied; GitHub reconciliation observes referenced PRs only',
    drain: 'No recorded queue artifact supplied; the drain command is never executed by collection',
    fleet: 'No recorded fleet artifact supplied; fleet configuration alone does not establish remote adoption',
  })) coverage(source, github ? 'unavailable' : 'disabled', reason);
  // Optional saved lifecycle artifacts have the same validated entities,
  // relations and observations as a snapshot, with their own source coverage.
  // They are data only, never commands or adapters imported from the project.
  for (const input of artifacts) {
    const a = typeof input === 'string' ? await json(input) : input;
    if (!object(a) || a.schema !== 1 || !SOURCES.includes(a.source) || !date(a.observedAt) || Date.parse(a.observedAt) > Date.parse(generatedAt) || a.projectKey !== s.project.key) invalid('invalid recorded artifact identity or schema');
    if (!Array.isArray(a.entities) || new Set(a.entities.map(e => e.key)).size !== a.entities.length) invalid('duplicate artifact entity keys');
    const combined = [...new Map([...entities.values(), ...a.entities].map(e => [e.key, e])).values()];
    const projected = { ...s, entities: combined, relations: a.relations ?? [], observations: a.observations ?? [], metrics: [], coverage: [{ source: a.source, status: 'ok', observedAt: a.observedAt }], warnings: [] };
    validateSnapshot(projected);
    if (a.observations?.some(o => Date.parse(o.observedAt) > Date.parse(a.observedAt))) invalid('artifact observation is newer than its source timestamp');
    for (const e of a.entities) add({ ...e, observedAt: a.observedAt, lifecycleSource: a.source });
    pendingRelations.push(...(a.relations ?? []));
    s.observations.push(...(a.observations ?? []));
    coverage(a.source, 'ok', 'Validated recorded artifact; timestamp is the source observation, not a new remote read');
    covered.get(a.source).observedAt = a.observedAt;
  }
  const prior = [];
  for (const input of history) {
    const h = validateSnapshot(typeof input === 'string' ? await json(input) : input);
    if (h.project.key !== s.project.key || Date.parse(h.generatedAt) >= Date.parse(generatedAt)) invalid('history must precede this snapshot and belong to this project');
    prior.push(h);
  }
  for (const source of SOURCES) if (!covered.has(source)) coverage(source, 'unavailable', 'No source observation');
  for (const r of pendingRelations) {
    if (entities.has(r.to) && entities.has(r.from)) s.relations.push(r);
    else warn(`Unresolved relation: ${r.from} ${r.kind} ${r.to}`);
  }
  s.entities = [...entities.values()].sort((a, b) => a.key.localeCompare(b.key));
  s.coverage = [...covered.values()].sort((a, b) => a.source.localeCompare(b.source));
  s.relations = [...new Map(s.relations.map(r => [JSON.stringify([r.from, r.kind, r.to, r.candidate ?? null]), r])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  s.observations = [...new Map(s.observations.map(o => [o.id, o])).values()].sort((a, b) => a.id.localeCompare(b.id));
  function metric(id, label, source, selected, detail) {
    const c = covered.get(source);
    s.metrics.push({ id, label, value: c.status === 'ok' ? selected.length : null, unit: 'records', coverage: c.status, detail: detail || c.reason, entityKeys: selected.map(e => e.key) });
  }
  const es = s.entities.filter(e => !e.ambiguous);
  metric('phases-reported-built', 'Phases reporting implementation', 'phases', es.filter(e => e.kind === 'phase' && e.facts.implemented.value === true), 'Current status claims only; not a count of transitions in a time window');
  metric('phases-accepted-with-evidence', 'Accepted phases with evidence present', 'phases', es.filter(e => e.kind === 'phase' && ['built', 'lived-in'].includes(e.status) && e.acceptance?.length && e.acceptance.every(b => b.checked) && e.evidence?.length && !e.evidenceMissing), 'Authored acceptance with existing evidence files; not independently rerun proof');
  metric('loop-reported-done', 'Findings reported done', 'loop', es.filter(e => e.kind === 'loop' && e.status === 'done'), 'Declined and stale are excluded; this is not proof-backed fixes');
  metric('loop-accepted-open', 'Accepted findings still open', 'loop', es.filter(e => e.kind === 'loop' && e.status === 'accepted'), 'Current backlog; no cohort or time-to-fix inferred');
  metric('lessons-sent', 'Lessons with sent receipts', 'lesson-sent', es.filter(e => e.kind === 'lesson' && e.status === 'sent'), 'Sending is separate from accepted, shipped and adopted');
  metric('captured-retros', 'Explicitly captured retros', 'retros', es.filter(e => e.kind === 'retro'));
  metric('saved-test-runs', 'Distinct saved test runs', 'tests', es.filter(e => e.kind === 'test'), 'Deduplicated recorded runs; missing runs are not zero activity');
  for (const source of ['health', 'tests', 'retros']) {
    const kind = { health: 'health', tests: 'test', retros: 'retro' }[source];
    const stamps = s.observations.filter(o => s.entities.some(e => e.key === o.entity && e.kind === kind) && date(o.occurredAt)).map(o => o.occurredAt).sort((a, b) => Date.parse(a) - Date.parse(b));
    const c = s.coverage.find(c => c.source === source);
    if (c && stamps.length) { c.latestSampleAt = stamps.at(-1); c.sampleWindow = { from: stamps[0], to: stamps.at(-1) }; }
    if (c && source === 'health' && cfg.canvas?.cadence === 'nightly') {
      c.expectedCadence = { value: 1, unit: 'day' };
      if (c.status === 'ok' && c.latestSampleAt && Date.parse(generatedAt) - Date.parse(c.latestSampleAt) > 2 * 86400000) { c.status = 'stale'; c.reason = 'Newest saved health sample is over two nightly intervals old'; }
    }
  }
  s.complete = s.coverage.every(c => ['ok', 'disabled'].includes(c.status));
  return withHistory(s, prior, { windowDays });
}

/**
 * Enrich an already collected snapshot with in-memory prior snapshots. Pure and
 * synchronous (also safe to await): returns a new validated snapshot, never reads
 * paths or mutates either input. History must be older and from the same project.
 * Replaces previous enrichment, including when history/windowDays is narrowed.
 */
export function withHistory(current, history, { windowDays = 30 } = {}) {
  validateSnapshot(current);
  if (!Array.isArray(history)) invalid('history must be an array of snapshots');
  if (!Number.isFinite(windowDays) || windowDays <= 0) invalid('windowDays must be positive');
  const prior = new Map();
  for (const h of history) {
    validateSnapshot(h);
    if (h.project.key !== current.project.key || Date.parse(h.generatedAt) >= Date.parse(current.generatedAt)) invalid('history must precede this snapshot and belong to this project');
    const previous = prior.get(h.generatedAt);
    if (previous && hash(previous) !== hash(h)) invalid('conflicting history snapshots at the same timestamp');
    prior.set(h.generatedAt, h);
  }
  const enriched = structuredClone(current);
  reduceHistory(enriched, [...prior.values()], windowDays);
  return validateSnapshot(enriched);
}

const DERIVED_METRICS = new Set([
  'fixes-with-proof', 'loop-completion-rate', 'learning-adopted', 'learning-shipped',
  'retro-follow-through', 'retro-picked-implemented', 'retro-picked-evidence-present',
  'regression-rate', 'cost', 'observed-active-days', 'recorded-test-failures',
  'observed-delivery-transitions', 'dependency-updates-open', 'reviews-unanswered',
  'queue-backlog', 'fleet-applied',
]);

// All reducers consume observations or explicit links. No wall-clock interpolation,
// inferred fixes from commit titles, or invented historical acceptance cohorts.
function reduceHistory(s, history, windowDays) {
  s.metrics = s.metrics.filter(m => !DERIVED_METRICS.has(m.id) && !/^(health-|change-|cost-)/.test(m.id));
  for (const [id, label, detail] of [
    ['fixes-with-proof', 'Fixes with revision-scoped proof', 'No resolvable finding-to-phase passing receipt was observed'],
    ['loop-completion-rate', 'Loop completion rate', 'No recorded accepted cohort at window start'],
    ['learning-adopted', 'Accepted lessons shipped and adopted', 'No complete lesson-to-release-to-project receipt chain'],
    ['retro-follow-through', 'Picked retro candidates proven', 'No validated candidate-to-change proof chain'],
    ['regression-rate', 'Regression rate', 'No comparable acceptance cohort and explicit escape observations'],
    ['cost', 'Recorded model cost', 'No normalized provider usage receipts'],
  ]) s.metrics.push({ id, label, value: null, unit: id.endsWith('rate') ? 'ratio' : id === 'cost' ? 'unknown' : 'records', coverage: 'unavailable', detail, entityKeys: [] });

  const end = Date.parse(s.generatedAt), start = end - windowDays * 86400000;
  const before = [...history].sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  const baseline = before.filter(h => Date.parse(h.generatedAt) <= start).at(-1);
  const all = [...before, s], entities = new Map(s.entities.map(e => [e.key, e]));
  const known = source => s.coverage.find(c => c.source === source)?.status === 'ok';
  const linked = (key, kinds) => s.relations.filter(r => r.from === key && kinds.includes(r.kind)).map(r => entities.get(r.to)).filter(Boolean);
  const proof = e => !e.ambiguous && Array.isArray(e.proofs) && e.proofs.some(p => p.version === 1 && p.kind === 'implementation' && p.result === 'pass' && p.invalidated !== true && /^[a-f\d]{40,64}$/i.test(p.sha ?? '') && date(p.observed_at) && text(p.environment));
  const set = (id, label, value, unit, coverage, detail, entityKeys = [], extra = {}) => {
    const m = { id, label, value, unit, coverage, detail, entityKeys: [...new Set(entityKeys)].filter(k => entities.has(k)), ...extra };
    const at = s.metrics.findIndex(m => m.id === id);
    if (at < 0) s.metrics.push(m); else s.metrics[at] = m;
  };
  const loops = s.entities.filter(e => e.kind === 'loop' && !e.ambiguous);
  const proven = loops.filter(e => e.status === 'done' && linked(e.key, ['addresses']).some(proof));
  // A recognized cohort of done findings whose links are all resolvable can
  // distinguish zero proven from wholly missing proof instrumentation.
  const done = loops.filter(e => e.status === 'done');
  if (known('loop') && (proven.length || done.length && done.every(e => linked(e.key, ['addresses']).length))) {
    set('fixes-with-proof', 'Done findings with linked implementation receipts', proven.length, 'records', 'ok', 'Explicit finding → phase → reconciliation-validated passing receipt, at the receipt revision; declined/stale excluded', proven.map(e => e.key), { denominator: done.length });
  }
  const retros = s.entities.filter(e => e.kind === 'retro' && !e.ambiguous);
  const picked = retros.flatMap(e => (e.candidates ?? []).filter(c => c.decision?.status === 'picked').map(c => ({ e, c, changes: s.relations.filter(r => r.from === e.key && r.candidate === c.id && r.kind === 'candidate-change').map(r => entities.get(r.to)).filter(Boolean) })));
  if (known('retros')) {
    for (const [id, label, select] of [
      ['retro-picked-implemented', 'Picked candidates linked to reported implementation', p => p.changes.some(e => e.facts?.implemented?.value === true)],
      ['retro-picked-evidence-present', 'Picked candidates linked to implementation with evidence present', p => p.changes.some(e => e.facts?.implemented?.value === true && e.evidence?.length && !e.evidenceMissing)],
      ['retro-follow-through', 'Picked candidates linked to passing implementation receipts', p => p.changes.some(proof)],
    ]) { const chosen = picked.filter(select); set(id, label, chosen.length, 'candidates', 'ok', 'Owner picked decisions only; implementation, file presence and scoped proof are separate', chosen.map(p => p.e.key), { numerator: chosen.length, denominator: picked.length }); }
  }
  const lessons = s.entities.filter(e => e.kind === 'lesson' && e.status === 'accepted' && !e.ambiguous);
  const shipped = lessons.filter(e => linked(e.key, ['ships-in', 'shipped-in']).some(r => r.kind === 'release' && ['published', 'released', 'shipped'].includes(r.status)));
  const adopted = shipped.filter(e => linked(e.key, ['adopted-by']).some(r => r.kind === 'update' && r.status === 'applied' && text(r.practiceVersion)));
  const lifecycle = s.relations.some(r => ['ships-in', 'shipped-in', 'adopted-by'].includes(r.kind));
  if (lifecycle) {
    set('learning-shipped', 'Accepted lessons explicitly linked to published releases', shipped.length, 'records', 'ok', 'Local tags alone do not prove publication', shipped.map(e => e.key));
    set('learning-adopted', 'Shipped lessons with explicit applied-version observations', adopted.length, 'records', 'ok', 'An update PR merge alone does not prove adoption', adopted.map(e => e.key));
  }
  const observations = [...new Map(all.flatMap(h => h.observations).map(o => [JSON.stringify([o.entity, o.field, o.occurredAt ?? o.observedAt]), o])).values()];
  const inWindow = observations.filter(o => date(o.occurredAt) && Date.parse(o.occurredAt) >= start && Date.parse(o.occurredAt) <= end);
  const activity = inWindow.filter(o => ['outcome', 'captured'].includes(o.field) || o.field.startsWith('measure:'));
  const days = [...new Set(activity.map(o => new Date(o.occurredAt).toISOString().slice(0, 10)))].sort();
  set('observed-active-days', 'Days with saved health, test or retro observations', activity.length ? days.length : null, 'days', activity.length ? 'ok' : 'unavailable', 'Partial instrumentation; not CLI use or causal value. Missing intervals are unknown', activity.map(o => o.entity), { days, window: { from: new Date(start).toISOString(), to: s.generatedAt }, samples: activity.length });
  const measures = [...new Set(inWindow.filter(o => o.field.startsWith('measure:')).map(o => o.field))].sort();
  for (const field of measures) {
    const series = inWindow.filter(o => o.field === field).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const last = series.at(-1), lastKnownValue = Number.isFinite(last.value) ? last.value : null;
    const stale = s.coverage.find(c => c.source === (last.source.type === 'supplied-report' ? 'night-report' : 'health'))?.status === 'stale';
    const value = stale ? null : lastKnownValue;
    const unit = all.flatMap(h => h.entities).find(e => e.key === last.entity)?.measures?.find(m => `measure:${m.id}` === field)?.unit ?? 'recorded value';
    set(`health-${field.slice(8)}`, `Saved health: ${field.slice(8)}`, value, unit, stale ? 'stale' : value === null ? 'unavailable' : 'ok', 'Reported samples only; null instruments break the series, absent days are not zero', series.map(o => o.entity), { lastKnownValue, samples: series.length, series: series.map(o => ({ at: o.occurredAt, value: o.value, source: o.source })) });
    const numeric = series.filter(o => Number.isFinite(o.value));
    if (numeric.length >= 2) {
      const a = numeric[0], b = numeric.at(-1);
      const meta = o => all.flatMap(h => h.entities).find(e => e.key === o.entity)?.measures?.find(m => `measure:${m.id}` === field);
      const x = meta(a), y = meta(b);
      if (x?.unit && x.better && x.unit === y?.unit && x.better === y.better && !series.some(o => o.value === null)) set(`change-${field.slice(8)}`, `Measured change: ${field.slice(8)}`, b.value - a.value, x.unit, 'ok', 'Same recorded measure unit and direction; an observed difference, not a claim of statistical significance or causation', [a.entity, b.entity], { baseline: a.value, candidate: b.value, better: x.better, samples: numeric.length });
    }
  }
  const tests = inWindow.filter(o => o.field === 'outcome');
  if (tests.length) set('recorded-test-failures', 'Failed saved test runs in window', tests.filter(o => o.value === 'fail').length, 'runs', 'ok', 'Distinct saved observations; does not estimate missing CI runs', tests.map(o => o.entity), { denominator: tests.length, series: tests.map(o => ({ at: o.occurredAt, value: o.value, source: o.source })) });
  if (baseline?.coverage.some(c => c.source === 'loop' && c.status === 'ok') && known('loop')) {
    const cohort = baseline.entities.filter(e => e.kind === 'loop' && e.status === 'accepted' && !e.ambiguous);
    const complete = cohort.every(e => entities.has(e.key) && !entities.get(e.key).ambiguous);
    const resolved = cohort.filter(e => entities.get(e.key)?.status === 'done');
    if (complete && cohort.length) set('loop-completion-rate', 'Observed accepted-cohort completion', resolved.length / cohort.length, 'ratio', 'ok', 'Cohort from the last known snapshot at or before window start; done is reported resolution, not scoped proof', cohort.map(e => e.key), { numerator: resolved.length, denominator: cohort.length, baselineAt: baseline.generatedAt });
  }
  if (baseline?.coverage.some(c => c.source === 'phases' && c.status === 'ok') && known('phases')) {
    const old = new Map(baseline.entities.filter(e => e.kind === 'phase').map(e => [e.key, e]));
    const entered = s.entities.filter(e => e.kind === 'phase' && ['built', 'lived-in'].includes(e.status) && old.has(e.key) && !['built', 'lived-in'].includes(old.get(e.key).status));
    set('observed-delivery-transitions', 'Observed phases entering built or lived-in', entered.length, 'records', 'ok', 'Changes between observations; exact transition dates are unknown', entered.map(e => e.key), { baselineAt: baseline.generatedAt });
  }
  for (const [source, id, label, accept] of [
    ['dependencies', 'dependency-updates-open', 'Observed open dependency updates', e => ['pr', 'update'].includes(e.kind) && e.status === 'open'],
    ['reviews', 'reviews-unanswered', 'Recorded unanswered reviews', e => e.kind === 'review' && e.status === 'unanswered'],
    ['drain', 'queue-backlog', 'Observed open machine queue PRs', e => e.kind === 'pr' && e.status === 'open'],
    ['fleet', 'fleet-applied', 'Observed applied fleet updates', e => e.kind === 'update' && e.status === 'applied'],
  ]) {
    const selected = s.entities.filter(e => e.lifecycleSource === source && !e.ambiguous && accept(e));
    set(id, label, known(source) ? selected.length : null, 'records', known(source) ? 'ok' : s.coverage.find(c => c.source === source)?.status ?? 'unavailable', 'Validated saved lifecycle observations only; no remote action or acceptance inferred', selected.map(e => e.key));
  }
  const accepted = new Set(inWindow.filter(o => o.field === 'acceptedDelivery' && o.value === true && ['reported', 'verified'].includes(o.quality)).map(o => o.entity));
  if (accepted.size) {
    const reopened = new Set(inWindow.filter(o => ['reopened', 'escape'].includes(o.field) && o.value === true && ['reported', 'verified'].includes(o.quality) && accepted.has(o.entity)).map(o => o.entity));
    set('regression-rate', 'Explicit regressions among recorded accepted deliveries', reopened.size / accepted.size, 'ratio', 'ok', 'Only explicitly observed acceptance and reopen/escape facts in the same window', [...accepted], { numerator: reopened.size, denominator: accepted.size });
  }
  const costs = inWindow.filter(o => o.field === 'cost' && Number.isFinite(o.value) && o.value >= 0 && text(o.unit) && text(o.provider) && ['reported', 'verified'].includes(o.quality));
  const groups = new Map();
  for (const o of costs) { const key = JSON.stringify([o.provider, o.unit]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o); }
  for (const [key, values] of groups) {
    const [provider, unit] = JSON.parse(key);
    set(groups.size === 1 ? 'cost' : `cost-${hash(key).slice(0, 12)}`, `Recorded cost: ${provider}`, values.reduce((n, o) => n + o.value, 0), unit, 'ok', 'Recorded usage receipts only; providers and units are never mixed', values.map(o => o.entity), { provider, samples: values.length });
  }
  s.history = { windowDays, from: new Date(start).toISOString(), to: s.generatedAt, baselineAt: baseline?.generatedAt ?? null, snapshots: before.length, firstObservedAt: before[0]?.generatedAt ?? s.generatedAt, gaps: 'Only supplied snapshots and dated source observations are known; missing intervals are not zero.' };
}
