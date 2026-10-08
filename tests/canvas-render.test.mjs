import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { renderSnapshot, render, GROUPS, PAGE_SIZE, SELECTED_PER_GROUP, selectView, reduceFilters, sourceHref, metricPoints } from '../lib/canvas-render.mjs';

const commit = 'a'.repeat(40), at = '2026-10-08T12:00:00.000Z';
function fixture() {
  const source = { path: 'docs/phases/01-acme.md', revision: commit };
  const phase = { key: 'phase:one', kind: 'phase', title: 'Acme export', goal: 'G1', project: 'anvils', status: 'partial', source,
    facts: { implemented: { value: false, source: 'phase' }, merged: { value: true, source: 'github', observedAt: at }, productionVerified: { value: null, reason: 'No environment proof' }, livedIn: { value: false, source: 'phase' } } };
  const loop = { key: 'loop:one', kind: 'loop', title: 'Acme finding declined', goal: 'G2', project: 'widgets', status: 'declined', source: { path: 'docs/loop/one.md' } };
  const stale = { key: 'loop:stale', kind: 'loop', title: 'Acme stale finding', status: 'stale', source: { path: 'docs/loop/stale.md' } };
  const observation = (id, entity, occurredAt) => ({ id, entity, field: 'status', value: 'partial', source, sourceRevision: commit, observedAt: at, occurredAt, quality: 'reported', evidence: [] });
  return { schema: 1, project: { key: 'acme-project', name: 'Acme', repo: 'Acme/app' }, revision: { commit, dirty: false }, generatedAt: at,
    coverage: [{ source: 'phases', status: 'ok', observedAt: at }, { source: 'github', status: 'disabled', observedAt: at, reason: 'No remote read requested' }],
    entities: [phase, loop, stale], relations: [{ from: 'loop:one', to: 'phase:one', kind: 'addresses', source: loop.source }],
    observations: [observation('obs:one', phase.key, '2026-10-07T00:00:00Z'), observation('obs:two', loop.key, '2026-09-15T00:00:00Z')],
    metrics: [{ id: 'fixes-with-proof', label: 'Fixes with proof', value: null, unit: 'records', coverage: 'unavailable', detail: 'No passing proof chain', entityKeys: [] },
      { id: 'phases-accepted-with-evidence', label: 'Accepted phases', value: 0, unit: 'records', coverage: 'ok', entityKeys: [] },
      { id: 'phase-records', label: 'Phase records', value: 1, unit: 'records', coverage: 'ok', entityKeys: ['phase:one'] }], warnings: [] };
}
function browser(html) {
  const json = /<script id="snapshot" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  const code = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1];
  const inputs = Object.fromEntries(['window', 'goal', 'project', 'source'].map(k => [k, { value: '' }]));
  const controls = { elements: { namedItem: k => inputs[k] }, addEventListener: (type, fn) => { controls[type] = fn; } };
  const content = { innerHTML: '', addEventListener: (type, fn) => { content[type] = fn; } };
  const heading = { setAttribute() {}, focus() { heading.focused = true; }, scrollIntoView() {} };
  const summaries = { addEventListener: (type, fn) => { summaries[type] = fn; } };
  const document = { getElementById: id => ({ snapshot: { textContent: json }, filters: controls, view: content, summaries, 'records-heading': heading, 'metric-picker': heading })[id] };
  runInNewContext(code, { document, URL }, { timeout: 2000 });
  return { content, heading, change: (name, value) => controls.change({ target: { name, value } }),
    measure: value => content.change({ target: { name: 'exploreMetric', value } }),
    summary: dataset => summaries.click({ target: { closest: () => ({ dataset }) } }),
    click: dataset => content.click({ target: { closest: () => ({ dataset, hasAttribute: key => Object.hasOwn(dataset, key.replace(/^data-/, '')), disabled: false }) } }) };
}

test('renderer preserves four independent facts, real source links, relations and missing coverage', () => {
  const s = fixture(), r = renderSnapshot(s);
  const card = r.cards.find(c => c.key === 'entity:phase:one');
  assert.match(card.markdown, /Implemented \| No/);
  assert.match(card.markdown, /Merged \| Yes/);
  assert.match(card.markdown, /Production verified \| Unknown/);
  assert.match(card.markdown, /Lived in \| No/);
  assert.match(card.html, /addresses: loop:one/);
  assert.match(card.html, new RegExp(`https://github.com/Acme/app/blob/${commit}/docs/loop/one.md`));
  assert.match(r.markdown, /Fixes with proof \| Unknown/);
  assert.match(r.markdown, /Accepted phases \| 0/);
  assert.match(r.html, /No remote read requested/);
  assert.equal(r.manifest.complete, false);
  assert.deepEqual(r.manifest.groups.map(g => g.title), GROUPS.map(g => g.title));
  assert.ok(r.cards.filter(c => c.key.startsWith('index:')).length === 6);
  assert.ok(!r.markdown.includes('3 fixes'));
});

test('date, goal, subproject, source and contributor filters intersect; unknown dates remain visible without inventing dates', () => {
  const s = fixture();
  assert.deepEqual(selectView(s, { window: '7' }).entities.map(e => e.key), ['phase:one', 'loop:stale']);
  assert.equal(selectView(s, { window: '30' }).total, 3);
  assert.equal(selectView(s, { window: 'all' }).total, 3);
  assert.equal(selectView(s, { window: '7' }).undated, 1);
  assert.equal(selectView(s, { window: 'all', goal: 'G1', project: 'anvils', source: 'phase' }).total, 1);
  assert.equal(selectView(s, { window: 'all', goal: 'G1', project: 'widgets' }).total, 0);
  assert.equal(selectView(s, { window: 'all', source: 'loop' }).total, 2);
  assert.equal(selectView(s, { window: 'all', metric: 'phase-records' }).total, 1);
  assert.equal(selectView(s, { window: 'all', metric: 'fixes-with-proof' }).total, 0);
  assert.equal(selectView(s, { window: 'all' }).metrics[2].displayValue, 1);
  assert.equal(selectView(s, { window: '7' }).metrics[2].displayValue, 1);
  assert.match(selectView(s, { window: '7' }).metrics[2].displayReason, /Current snapshot.*not a filtered/);
  assert.equal(selectView(s).coverage.length, 2, 'coverage gaps do not disappear under filters');
  assert.equal(reduceFilters({ page: 9 }, { type: 'source', value: 'loop' }).page, 0);
  assert.equal(reduceFilters({}, { type: 'page', value: -4 }).page, 0);
  assert.equal(reduceFilters({}, { type: 'window', value: 'forever' }).window, '30');
});

test('embedded browser script actually drives the shared filters and relation inspection', () => {
  const ui = browser(renderSnapshot(fixture()).html);
  assert.match(ui.content.innerHTML, /3 source records match/);
  ui.change('window', 'all');
  assert.match(ui.content.innerHTML, /3 source records match/);
  ui.change('source', 'loop');
  assert.match(ui.content.innerHTML, /2 source records match/);
  assert.ok(!ui.content.innerHTML.includes('<h3>Acme export</h3>'));
  ui.click({ reset: '' });
  ui.click({ group: 'delivery' });
  assert.match(ui.content.innerHTML, /1 source records match/);
  assert.match(ui.content.innerHTML, /addresses: loop:one/);
  assert.equal(ui.heading.focused, true);
  ui.click({ entity: 'loop:one' });
  assert.match(ui.content.innerHTML, /<h3>Acme finding declined<\/h3>/);
  assert.ok(!ui.content.innerHTML.includes('<h3>Acme export</h3>'));
  ui.click({ reset: '' });
  ui.click({ metric: 'fixes-with-proof' });
  assert.match(ui.content.innerHTML, /0 source records match/);
});

test('current headlines precede compact filters; goals and undated lessons remain visible, with proposals separate', () => {
  const s = fixture();
  s.entities.push({ key: 'goal:G1', kind: 'goal', title: 'Acme outcome', source: { path: 'docs/goals.json' } },
    { key: 'lesson:one', kind: 'lesson', title: 'Acme lesson', source: { path: 'docs/lessons.md' }, guard: 'Acme guard' },
    { key: 'lesson:inbox:one', kind: 'lesson', title: 'Acme proposal', source: { path: 'docs/inbox/one.md' }, proposalKind: 'distill', status: 'declined' });
  s.metrics.push({ id: 'phases-reported-built', label: 'Phases reporting implementation', value: 1, unit: 'records', coverage: 'ok', entityKeys: ['phase:one'] });
  const r = renderSnapshot(s), staticHTML = r.html.split('<script')[0];
  assert.ok(staticHTML.indexOf('id="summaries"') < staticHTML.indexOf('id="filters"'));
  assert.match(staticHTML, /<strong>1<\/strong><span>Lesson records<\/span><small>1 inbox proposals separately/);
  assert.equal(selectView(s, { group: 'lessons' }).total, 2);
  assert.equal(selectView(s, { source: 'lesson proposal' }).total, 1);
  assert.equal(selectView(s, { source: 'lesson' }).total, 1);
  assert.ok(selectView(s, { group: 'delivery' }).entities.some(e => e.key === 'goal:G1'));
  const ui = browser(r.html);
  ui.summary({ summaryMetric: 'phases-reported-built' });
  assert.match(ui.content.innerHTML, /1 source records match/);
  ui.summary({ summaryGroup: 'lessons' });
  assert.match(ui.content.innerHTML, /2 source records match/);
  assert.match(ui.content.innerHTML, /Undated record/);
  assert.match(ui.content.innerHTML, /Inbox proposal.*decision: declined/);
});

test('test and health records show their measurements, never delivery-stage unknowns', () => {
  const s = fixture();
  s.entities = [
    { key: 'test:one', kind: 'test', title: 'Acme test run', source: { path: '.keel/test-runs/acme.json' }, counts: { pass: 7, fail: 0, skip: 1, todo: 0 }, status: 'pass' },
    { key: 'health:one', kind: 'health', title: 'Acme health', source: { path: 'docs/health/2026-10-08.md' }, measures: [{ id: 'slow_tests', value: 0, state: 'ok', bound: '≤ 0' }, { id: 'dependency_age', value: null, state: 'n/a' }] },
  ];
  s.relations = []; s.observations = []; s.metrics = [];
  const r = renderSnapshot(s);
  for (const card of r.cards.filter(c => c.key.startsWith('entity:'))) {
    assert.ok(!card.html.includes('Production verified'));
    assert.ok(!card.markdown.includes('Delivery fact'));
  }
  const test = r.cards.find(c => c.key === 'entity:test:one');
  assert.match(test.html, /<dt>pass<\/dt><dd>7<\/dd>/);
  assert.match(test.markdown, /fail: 0/);
  assert.ok(!test.html.includes('/blob/'));
  const health = r.cards.find(c => c.key === 'entity:health:one');
  assert.match(health.html, /slow_tests<\/th><td>0<\/td>/);
  assert.match(health.html, /dependency_age<\/th><td>Unknown<\/td>/);
});

test('secret-bearing URLs are refused even in nested provenance, without echoing the secret', () => {
  for (const fakeURL of ['https://fake-user:fake-password@acme.test/proof', 'https://acme.test/proof?token=fake-token']) {
    for (const mutate of [
      s => { s.entities[0].source = { url: fakeURL }; },
      s => { s.entities[0].facts.merged.source = fakeURL; },
      s => { s.entities[0].evidence = [{ source: { url: fakeURL } }]; },
      s => { s.warnings = [`See ${fakeURL}`]; },
    ]) {
      const s = fixture(); mutate(s);
      assert.throws(() => renderSnapshot(s), e => e.exitCode === 2 && !/fake-password|fake-token/.test(e.message));
    }
  }
});

test('hostile strings round-trip in embedded JSON but cannot create HTML, script, links or Markdown images', () => {
  const s = fixture(), attack = '</script><script>globalThis.acmeInjected=true</script><img src=x onerror=alert(1)> & " ](javascript:alert(1)) ![x](https://acme.test/x)\u2028';
  s.project.name = attack; s.entities[0].title = attack; s.entities[0].next = attack;
  s.warnings = [attack]; s.metrics[0].detail = attack;
  const r = renderSnapshot(s);
  assert.equal((r.html.match(/<script[ >]/g) ?? []).length, 2);
  assert.ok(!r.html.includes('<img'));
  assert.ok(!r.html.includes('<script>globalThis'));
  const embedded = /<script id="snapshot" type="application\/json">([\s\S]*?)<\/script>/.exec(r.html)[1];
  assert.equal(JSON.parse(embedded).project.name, attack);
  assert.ok(embedded.includes('\\u003c'));
  assert.ok(!r.markdown.includes('![x]('));
  const ui = browser(r.html);
  assert.ok(!ui.content.innerHTML.includes('<img'));
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//acme.test/x', 'https://fake-user:fake-password@acme.test/x', 'https://acme.test/x?token=fake-token']) {
    assert.equal(sourceHref({ url }, s), null);
    const bad = fixture(); bad.entities[0].source = { url };
    assert.throws(() => renderSnapshot(bad), /unsafe source URL/);
  }
  for (const path of ['../outside.md', '/private/secret', 'docs/../../secret', 'docs\\secret']) assert.equal(sourceHref({ path }, fixture()), null);
});

test('unknown versions and duplicate identities are refused before artifacts are made', async () => {
  assert.throws(() => renderSnapshot({ ...fixture(), schema: 2 }), e => e.exitCode === 2 && /schema/.test(e.message));
  const duplicate = fixture(); duplicate.entities.push({ ...duplicate.entities[0] });
  assert.throws(() => renderSnapshot(duplicate), /duplicate/);
  const s = fixture(); s.entities[0].facts = undefined;
  assert.match(renderSnapshot(s).cards.find(c => c.key === 'entity:phase:one').markdown, /Implemented \| Unknown/);
});

test('rendering is byte-deterministic, preserves inputs and never uses the browser clock for a window', () => {
  const s = fixture(), saved = structuredClone(s);
  assert.deepEqual(renderSnapshot(s), renderSnapshot(structuredClone(s)));
  assert.deepEqual(s, saved);
  const first = selectView(s, { window: '7' });
  s.generatedAt = '2026-11-08T12:00:00Z';
  assert.equal(first.total, 2); assert.equal(selectView(s, { window: '7' }).total, 1);
  const dirty = fixture(); dirty.revision.dirty = true;
  assert.ok(sourceHref(dirty.entities[0].source, dirty).includes(`/blob/${commit}/`));
  assert.equal(sourceHref({ path: '.keel/test-runs/example.json' }, dirty), null);
  assert.match(renderSnapshot(dirty).html, /committed reference; local contents may differ/);
  assert.match(renderSnapshot(dirty).html, /Local \/ uncommitted/);
});

test('thousands of source records use bounded cards and pages, with every record reachable', () => {
  const s = fixture();
  s.entities = Array.from({ length: 2001 }, (_, n) => ({ key: `phase:${String(n).padStart(4, '0')}`, kind: 'phase', title: `Acme ${n}`, source: { path: `docs/phases/${n}.md` }, date: '2026-10-07' }));
  s.metrics = []; s.observations = []; s.relations = [];
  const r = renderSnapshot(s);
  assert.ok(r.cards.length <= 1 + GROUPS.length * (1 + SELECTED_PER_GROUP));
  assert.equal((r.html.split('<script')[0].match(/<article class="record">/g) ?? []).length, PAGE_SIZE);
  const seen = new Set();
  for (let page = 0; page < Math.ceil(s.entities.length / PAGE_SIZE); page++) {
    for (const e of selectView(s, { window: 'all', page }).entities) seen.add(e.key);
  }
  assert.equal(seen.size, s.entities.length);
  assert.equal(selectView(s, { page: 99999 }).state.page, Math.ceil(s.entities.length / PAGE_SIZE) - 1);
  const ui = browser(r.html); ui.click({ page: '1' });
  assert.match(ui.content.innerHTML, /Page 2 of 84/);
});

test('instrument gaps split the plotted series and retain explicit zero in the accessible table', () => {
  const s = fixture();
  s.observations = [0, null, 2].map((value, n) => ({ id: `sample:${n}`, entity: 'phase:one', field: 'phase-records', value, source: s.entities[0].source, sourceRevision: commit, observedAt: `2026-10-0${n + 1}T12:00:00Z`, quality: value === null ? 'unknown' : 'reported', evidence: [] }));
  const r = renderSnapshot(s);
  assert.equal((r.html.split('<script')[0].match(/<polyline /g) ?? []).length, 2, 'no line crosses the missing sample');
  assert.match(r.html, /<td>0<\/td>/); assert.match(r.html, /<td>Unknown<\/td>/);
  assert.match(r.html, /gaps mean unknown, not zero/);
});

test('every metric is reachable through the actual selector, including unknown metrics beyond the first twelve', () => {
  const s = fixture();
  s.metrics = Array.from({ length: 42 }, (_, i) => ({ id: `health-acme-${i}`, label: `Acme measure ${i}`, value: i % 3 ? i : null,
    unit: 'records', coverage: i % 3 ? 'ok' : 'unavailable', entityKeys: ['phase:one'], detail: `Acme measurement ${i}` }));
  const r = renderSnapshot(s), ui = browser(r.html);
  for (const metric of s.metrics) {
    assert.ok(ui.content.innerHTML.includes(`<option value="${metric.id}"`));
    ui.measure(metric.id);
    assert.ok(ui.content.innerHTML.includes(`<h3>${metric.label}</h3>`), metric.id);
    assert.equal((ui.content.innerHTML.match(/<article class="metric">/g) ?? []).length, 1);
    assert.match(ui.content.innerHTML, /class="measure-details" open/);
    assert.match(ui.content.innerHTML, /3 source records match/, 'inspecting a metric does not filter source records');
  }
  assert.equal(ui.heading.focused, true);
});

test('collector series use at dates, source-backed gap rows and categorical values; filters reach the series', () => {
  const s = fixture(), source = s.entities[0].source;
  const metric = { id: 'health-acme-series', label: 'Acme measured trend', value: 0, unit: 'records', coverage: 'ok', entityKeys: ['phase:one'],
    series: [{ at: '2026-09-01', value: 9, source }, { at: '2026-10-06', value: 3, source },
      { at: '2026-10-07', value: null, source }, { at: '2026-10-08', value: 0, source }] };
  s.metrics.push(metric);
  assert.deepEqual(metricPoints(metric, selectView(s), s).map(p => p.at), ['2026-10-06', '2026-10-07', '2026-10-08']);
  assert.equal(metricPoints(metric, selectView(s, { window: 'all' }), s).length, 4);
  assert.equal(metricPoints(metric, selectView(s, { source: 'loop' }), s).length, 0);
  assert.equal(metricPoints(metric, selectView(s, { goal: 'G1' }), s).length, 3);
  const ui = browser(renderSnapshot(s).html); ui.measure(metric.id);
  assert.match(ui.content.innerHTML, /2026-10-07 \(recorded\)<\/td><td>Unknown/);
  assert.match(ui.content.innerHTML, /2026-10-08 \(recorded\)<\/td><td>0/);
  assert.ok(ui.content.innerHTML.includes(`/blob/${commit}/docs/phases/01-acme.md`));
  assert.equal((ui.content.innerHTML.match(/<polyline /g) ?? []).length, 2, 'a missing sample cannot join two segments');
  metric.series = [{ at: '2026-10-07', value: 'fail', source }, { at: '2026-10-08', value: 'pass', source }];
  const categorical = browser(renderSnapshot(s).html); categorical.measure(metric.id);
  assert.match(categorical.content.innerHTML, /<td>fail<\/td>/); assert.match(categorical.content.innerHTML, /<td>pass<\/td>/);
  assert.equal((categorical.content.innerHTML.match(/<polyline /g) ?? []).length, 0, 'do not invent numeric scores for categorical results');
});

test('artifact bundle matches its manifest; repeated output and symlinks cannot overwrite human files', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'acme-canvas-render-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'snapshot.json'); await writeFile(input, JSON.stringify(fixture()));
  const result = await render({ snapshot: input, output: join(root, 'artifacts') });
  assert.equal(await readFile(join(result.output, 'pulse.html'), 'utf8'), result.html);
  assert.equal(await readFile(join(result.output, 'pulse.md'), 'utf8'), result.markdown);
  assert.deepEqual(JSON.parse(await readFile(join(result.output, 'manifest.json'), 'utf8')), result.manifest);
  for (const entry of result.manifest.cards) {
    const card = result.cards.find(c => c.key === entry.key);
    assert.equal(await readFile(join(result.output, entry.markdown), 'utf8'), card.markdown);
    if (entry.html) assert.equal(await readFile(join(result.output, entry.html), 'utf8'), card.html);
  }
  await writeFile(join(result.output, 'human.md'), 'Acme human note');
  await assert.rejects(render({ snapshot: fixture(), output: result.output }), /already exists/);
  assert.equal(await readFile(join(result.output, 'human.md'), 'utf8'), 'Acme human note');
  await symlink(result.output, join(root, 'link'));
  await assert.rejects(render({ snapshot: fixture(), output: join(root, 'link', 'child') }), /symlink/);
  await assert.rejects(render({ snapshot: { schema: 9 }, output: join(root, 'bad') }), /schema/);
  assert.ok(!(await readdir(root)).includes('bad'));
});
