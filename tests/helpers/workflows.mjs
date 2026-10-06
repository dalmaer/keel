// Reading a workflow's shell without a YAML dependency, shared by
// tests/workflows.test.mjs and tests/climb.test.mjs (a test file imported by
// another would register its tests twice).

/**
 * Every `run:` script in one workflow's text, read without a YAML dependency:
 * [{ step, line, script }]. A `run: |` (or `>`) block is the lines indented past
 * its key, the common indent stripped; a one-line `run:` is its value (outer
 * quotes stripped). GitHub's `${{ … }}` and a template's `{{name}}` become the
 * word GHEXPR, so the shell sees what it would after substitution.
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
