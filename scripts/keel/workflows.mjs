// keel's workflow syntax check (keel practice `ci`; managed: keel render
// rewrites it). keel's lesson 30: a workflow's inline shell and inline
// `node -e '…'` were never run before they reached GitHub, so a quote or a
// missing `then` broke the job where nobody was looking. This reads every
// `run:` block of the project's .github/workflows/*.yml without a YAML
// dependency, runs `bash -n` on it and `node --check` on each inline node
// body, and names the file, step and line of each problem.
// tests/keel-workflows.test.mjs runs it in the project's own gate; keel's
// tests import the same functions (one source).
//
// Zero dependencies. It spawns bash and node, with the test runner's
// NODE_TEST_* variables stripped (a child that inherits them runs nothing).
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const WORKFLOWS = '.github/workflows';

/**
 * Every `run:` script in one workflow's text: [{ step, line, script }]. A
 * `run: |` (or `>`) block is the lines indented past its key, the common
 * indent stripped; a one-line `run:` is its value (outer quotes stripped).
 * A GitHub expression (dollar, double braces) and a keel template
 * placeholder (double braces) become the word GHEXPR, so the shell sees what
 * it would after substitution.
 */
export function runBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let step = null;
  const sub = s => s.replace(/\$\{\{[\s\S]*?\}\}/g, 'GHEXPR').replace(/\{\{\s*[\w.-]+\s*\}\}/g, 'GHEXPR');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    const item = /^(\s*)- /.exec(line);
    if (item) step = null;
    const name = /^\s*(?:- )?name:\s*(.+?)\s*$/.exec(line);
    if (name) step = name[1].replace(/^(["'])(.*)\1$/, '$2');
    const r = /^(\s*)(- )?run:\s*(.*?)\s*$/.exec(line);
    if (!r) continue;
    const keyIndent = r[1].length + (r[2] ? 2 : 0);
    const value = r[3];
    if (/^[|>][-+]?\d*$/.test(value)) {
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() && l.search(/\S/) <= keyIndent) break;
        body.push(l);
      }
      while (body.length && !body.at(-1).trim()) body.pop();
      const indent = Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)));
      out.push({ step: step ?? `line ${i + 1}`, line: i + 1, script: sub(body.map(l => l.slice(indent)).join('\n')) });
      i = j - 1;
    } else {
      out.push({ step: step ?? `line ${i + 1}`, line: i + 1, script: sub(value.replace(/^(["'])(.*)\1$/, '$2')) });
    }
  }
  return out;
}

/** The single-quoted JS of each `node [--input-type=module] -e '…'` in a script: [{ module, js }]. */
export function inlineNode(script) {
  return [...script.matchAll(/\bnode\s+(--input-type=module\s+)?-e\s+'([^']*)'/g)].map(m => ({ module: Boolean(m[1]), js: m[2] }));
}

const env = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST_')));
const spawn = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', env: env(), maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
};

/** What bash -n and node --check say about one workflow's scripts: [string], each naming the file, step and line. */
export async function shellProblems(label, text) {
  const out = [];
  const dir = await mkdtemp(join(tmpdir(), 'keel-wf-'));
  try {
    for (const b of runBlocks(text)) {
      const where = `${label}: step "${b.step}" (line ${b.line})`;
      const sh = spawn('bash', ['-n'], `${b.script}\n`);
      if (sh.status !== 0) out.push(`${where}: bash -n: ${sh.stderr.trim().split('\n')[0]}`);
      for (const [k, n] of inlineNode(b.script).entries()) {
        const file = join(dir, `b${b.line}-${k}.${n.module ? 'mjs' : 'cjs'}`);
        await writeFile(file, n.js);
        const js = spawn(process.execPath, ['--check', file]);
        if (js.status !== 0) out.push(`${where}: node -e: ${js.stderr.trim().split('\n').filter(l => /Error|^\S.*:\d+$/.test(l)).join(' | ')}`);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  return out;
}

/** The project's workflows, as paths from root: ['.github/workflows/check.yml', …]. None: []. */
export async function workflowFiles(root) {
  try { return (await readdir(join(root, WORKFLOWS))).filter(n => /\.ya?ml$/.test(n)).sort().map(n => `${WORKFLOWS}/${n}`); }
  catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return []; throw e; }
}

/** Every workflow under root checked: { files, blocks, nodes, problems }. */
export async function workflowProblems(root) {
  const files = await workflowFiles(root);
  let blocks = 0, nodes = 0;
  const problems = [];
  for (const f of files) {
    const text = await readFile(join(root, f), 'utf8');
    const bs = runBlocks(text);
    blocks += bs.length;
    nodes += bs.reduce((a, b) => a + inlineNode(b.script).length, 0);
    problems.push(...await shellProblems(f, text));
  }
  return { files, blocks, nodes, problems };
}
