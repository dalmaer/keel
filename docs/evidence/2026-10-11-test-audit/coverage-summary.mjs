#!/usr/bin/env node
// Read-only native V8 profile analysis. Writes only summary artifacts in scratch.
// Usage: node /tmp/keel-test-audit/coverage-summary.mjs RAW_DIRECTORY [OUTPUT_DIRECTORY]
// Does not run tests, import project code, modify profiles, or claim assertion/branch coverage.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = '/Users/dionalmaer/code/keel';
const PREFIX = 'file:///Users/dionalmaer/code/keel/';
const SCRATCH = '/tmp/keel-test-audit';
const sha = value => createHash('sha256').update(value).digest('hex');
const inside = (parent, child) => child === parent || (!relative(parent, child).startsWith(`..${sep}`) && relative(parent, child) !== '..' && !relative(parent, child).startsWith(sep));
const posix = value => value.split(sep).join('/');
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const ratio = (positive, observed) => ({ entryPositiveFunctions: positive, observedFunctions: observed });

if (!process.argv[2]) {
  process.stderr.write('Usage: node coverage-summary.mjs RAW_DIRECTORY [OUTPUT_DIRECTORY]\n');
  process.exitCode = 2;
} else {
  main();
}

function main() {
  const input = realpathSync(resolve(process.argv[2]));
  if (!lstatSync(input).isDirectory()) throw new Error('RAW_DIRECTORY must be a directory');
  const output = resolve(process.argv[3] ?? join(SCRATCH, 'native-coverage-summary'));
  mkdirSync(SCRATCH, { recursive: true });
  // Only scratch output; never write within the raw collection directory.
  const scratchReal = realpathSync(SCRATCH);
  if (!inside(resolve(SCRATCH), output)) throw new Error('OUTPUT_DIRECTORY must be inside /tmp/keel-test-audit');
  let ancestor = output;
  while (true) {
    try { realpathSync(ancestor); break; } catch {
      const next = resolve(ancestor, '..');
      if (next === ancestor) throw new Error('Output parent unavailable');
      ancestor = next;
    }
  }
  const projectedOutput = resolve(realpathSync(ancestor), relative(ancestor, output));
  if (!inside(scratchReal, projectedOutput) || inside(input, projectedOutput)) throw new Error('Output must be in scratch and outside RAW_DIRECTORY');
  mkdirSync(output, { recursive: true });
  const outputReal = realpathSync(output);
  const startedAt = new Date().toISOString();
  const head = git(['rev-parse', 'HEAD']).trim();
  const tracked = git(['ls-files', '-z', '--', 'lib', 'bin', 'practices', 'scripts']).split('\0').filter(Boolean);
  const candidates = [...new Set(tracked.filter(p => /^(lib|bin|practices|scripts)\/.+\.mjs$/.test(p)))].sort();
  const excludedTestSources = candidates.filter(p => /(?:^|\/)tests\//.test(p) || /\.test\.mjs$/.test(p));
  const production = candidates.filter(p => !excludedTestSources.includes(p));
  const sources = new Map(), urls = new Map(), errors = [], warnings = [];
  for (const path of production) {
    const file = { path, url: pathToFileURL(join(ROOT, path)).href, sha256: null, utf16Length: null, bytes: null, sourceReadable: false,
      observed: false, profileFiles: new Set(), scriptRecords: 0, functions: new Map(), invalidFunctionRecords: 0, offsetMismatches: 0 };
    try {
      const st = lstatSync(join(ROOT, path));
      if (!st.isFile()) throw new Error('tracked source is not a regular file (symlinks excluded)');
      const bytes = readFileSync(join(ROOT, path));
      file.sha256 = sha(bytes); file.utf16Length = bytes.toString('utf8').length; file.bytes = bytes.length; file.sourceReadable = true;
    } catch (e) { errors.push({ kind: 'source-read', file: path, message: e.message }); }
    sources.set(path, file); urls.set(file.url, file);
  }

  let adjacentRunLog = null;
  try {
    const logPath = input + '.log', text = readFileSync(logPath, 'utf8');
    const counts = {};
    for (const key of ['tests','suites','pass','fail','cancelled','skipped','todo']) {
      const match = text.match(new RegExp('^ℹ ' + key + ' (\\d+)', 'm'));
      if (match) counts[key] = Number(match[1]);
    }
    adjacentRunLog = { path:logPath,sha256:sha(text),counts,
      failedLocations:[...text.matchAll(/^test at (.+)$/gm)].map(m=>m[1]),
      association:'Adjacent input-directory .log naming convention; not a complete-process receipt' };
  } catch (e) { if (e.code !== 'ENOENT') errors.push({kind:'adjacent-log-read',file:input+'.log',message:e.message}); }

  const copyPairs = [];
  for (const manifest of tracked.filter(p => /^practices\/[^/]+\/practice\.json$/.test(p)).sort()) {
    try {
      const data = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
      if (!Array.isArray(data.files)) continue;
      const practice = manifest.split('/')[1];
      for (const row of data.files) {
        if (typeof row.from !== 'string' || typeof row.path !== 'string') continue;
        const canonical = posix(relative(ROOT, resolve(ROOT, 'practices', practice, 'files', row.from)));
        const rendered = posix(relative(ROOT, resolve(ROOT, row.path)));
        if (!sources.has(canonical) || !sources.has(rendered) || canonical === rendered) continue;
        const a = sources.get(canonical), b = sources.get(rendered);
        copyPairs.push({ manifest, canonical, rendered, currentBytesIdentical: a.sha256 !== null && a.sha256 === b.sha256 });
      }
    } catch (e) { errors.push({ kind: 'manifest-read-or-json', file: manifest, message: e.message }); }
  }

  const raw = { regularFiles: 0, jsonFiles: 0, nonJsonFiles: 0, coverageNamedFiles: 0, parsedJsonFiles: 0,
    parsedJsonErrors: 0, nativeProfileFiles: 0, nonProfileJsonFiles: 0, invalidCoverageShapes: 0,
    symlinksSkipped: 0, bytesRead: 0, scriptRecords: 0, matchedScriptRecords: 0,
    profileFilesWithProduction: 0, functionRecordsBeforeDeduplication: 0, repeatedFunctionRecords: 0,
    blockRangesIgnored: 0, diagnosticRewrittenProfileFiles: 0 };
  const excluded = { outsideExactRoot: 0, inRootButNotTrackedProductionExactUrl: 0, missingOrInvalidUrl: 0 };
  const profiles = [], profilePids = new Set();
  function scan(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)); }
    catch (e) { errors.push({ kind: 'directory-read', file: posix(relative(input, dir)), message: e.message }); return; }
    for (const ent of entries) {
      const absolute = join(dir, ent.name), name = posix(relative(input, absolute));
      if (ent.isSymbolicLink()) { raw.symlinksSkipped++; continue; }
      if (ent.isDirectory()) { scan(absolute); continue; }
      if (!ent.isFile()) continue;
      raw.regularFiles++;
      if (!ent.name.endsWith('.json')) { raw.nonJsonFiles++; continue; }
      raw.jsonFiles++;
      const namedCoverage = /^coverage-.*\.json$/.test(ent.name);
      if (namedCoverage) raw.coverageNamedFiles++;
      let data, bytes;
      try { bytes = readFileSync(absolute); raw.bytesRead += bytes.length; }
      catch (e) { errors.push({ kind: 'profile-read', file: name, message: e.message }); continue; }
      try { data = JSON.parse(bytes.toString('utf8')); raw.parsedJsonFiles++; }
      catch (e) { raw.parsedJsonErrors++; errors.push({ kind: 'profile-json-parse', file: name, message: e.message }); continue; }
      if (!data || !Array.isArray(data.result)) {
        raw.nonProfileJsonFiles++;
        if (namedCoverage) { raw.invalidCoverageShapes++; errors.push({ kind: 'profile-shape', file: name, message: 'coverage-named JSON has no result array' }); }
        continue;
      }
      raw.nativeProfileFiles++;
      if (data.keelAudit) raw.diagnosticRewrittenProfileFiles++;
      const pid = /^coverage-(\d+)-/.exec(ent.name)?.[1] ?? null;
      if (pid !== null) profilePids.add(pid);
      const profile = { file: name, sha256: sha(bytes), bytes: bytes.length, pidFromFilename: pid, timestamp: data.timestamp ?? null,
        scriptRecords: data.result.length, matchedScriptRecords: 0, diagnosticRewritten: !!data.keelAudit };
      for (const script of data.result) {
        raw.scriptRecords++;
        if (typeof script?.url !== 'string') { excluded.missingOrInvalidUrl++; continue; }
        if (!script.url.startsWith(PREFIX)) { excluded.outsideExactRoot++; continue; }
        // Exact membership, never suffix matching, URL decoding or canonicalization.
        const file = urls.get(script.url);
        if (!file) { excluded.inRootButNotTrackedProductionExactUrl++; continue; }
        raw.matchedScriptRecords++; profile.matchedScriptRecords++;
        file.observed = true; file.scriptRecords++; file.profileFiles.add(name);
        if (!Array.isArray(script.functions)) { errors.push({ kind: 'script-shape', file: name, source: file.path, message: 'functions is not an array' }); continue; }
        for (const fn of script.functions) {
          raw.functionRecordsBeforeDeduplication++;
          const entry = fn?.ranges?.[0];
          if (!entry || !Number.isInteger(entry.startOffset) || !Number.isInteger(entry.endOffset) || entry.startOffset < 0 || entry.endOffset <= entry.startOffset || !Number.isFinite(entry.count) || entry.count < 0) {
            file.invalidFunctionRecords++;
            errors.push({ kind: 'function-shape', file: name, source: file.path, functionName: fn?.functionName ?? null, message: 'missing/invalid first (entry) range' });
            continue;
          }
          const { startOffset, endOffset, count } = entry;
          const mismatch = file.utf16Length !== null && endOffset > file.utf16Length;
          if (mismatch) file.offsetMismatches++;
          const key = `${startOffset}:${endOffset}`;
          let value = file.functions.get(key);
          if (value) raw.repeatedFunctionRecords++;
          else {
            value = { startOffset, endOffset, names: new Set(), entryPositive: false, maxObservedEntryCount: 0,
              observations: 0, profileFiles: new Set(), isBlockCoverageObserved: false, exceedsCurrentSource: false };
            file.functions.set(key, value);
          }
          value.names.add(typeof fn.functionName === 'string' ? fn.functionName : '');
          value.entryPositive ||= count > 0;
          value.maxObservedEntryCount = Math.max(value.maxObservedEntryCount, count);
          value.observations++; value.profileFiles.add(name); value.isBlockCoverageObserved ||= fn.isBlockCoverage === true;
          value.exceedsCurrentSource ||= mismatch;
          raw.blockRangesIgnored += Math.max(0, fn.ranges.length - 1);
        }
      }
      if (profile.matchedScriptRecords) raw.profileFilesWithProduction++;
      profiles.push(profile);
    }
  }
  scan(input);
  const serializeFunction = value => ({ startOffset: value.startOffset, endOffset: value.endOffset, names: [...value.names].sort(),
    entryPositive: value.entryPositive, maxObservedEntryCount: value.maxObservedEntryCount, observations: value.observations,
    profileCount: value.profileFiles.size, isBlockCoverageObserved: value.isBlockCoverageObserved, exceedsCurrentSource: value.exceedsCurrentSource });
  const fileStats = [...sources.values()].map(file => {
    const functions = [...file.functions.values()].sort((a,b) => a.startOffset-b.startOffset || a.endOffset-b.endOffset).map(serializeFunction);
    return { path: file.path, url: file.url, sha256: file.sha256, utf16Length: file.utf16Length, bytes: file.bytes,
      sourceReadable: file.sourceReadable, observed: file.observed, profileCount: file.profileFiles.size, scriptRecords: file.scriptRecords,
      ...ratio(functions.filter(f => f.entryPositive).length, functions.length), invalidFunctionRecords: file.invalidFunctionRecords,
      offsetMismatches: file.offsetMismatches, zeroEntryFunctions: functions.filter(f => !f.entryPositive).map(({names,startOffset,endOffset}) => ({names,startOffset,endOffset})), functions };
  });

  // Only manifest-related copies with identical current bytes can share an offset space.
  // Never merge coincidental same-name modules or different versions.
  const parent = new Map(production.map(p => [p,p]));
  const find = p => parent.get(p) === p ? p : find(parent.get(p));
  for (const pair of copyPairs) if (pair.currentBytesIdentical) parent.set(find(pair.rendered), find(pair.canonical));
  const groups = new Map();
  for (const file of sources.values()) {
    const key = find(file.path), group = groups.get(key) ?? { members: [], functions: new Map() };
    group.members.push(file.path);
    for (const fn of file.functions.values()) {
      const key = `${fn.startOffset}:${fn.endOffset}`, v = group.functions.get(key) ?? { startOffset:fn.startOffset, endOffset:fn.endOffset, names:new Set(), entryPositive:false };
      for (const name of fn.names) v.names.add(name);
      v.entryPositive ||= fn.entryPositive; group.functions.set(key,v);
    }
    groups.set(key,group);
  }
  const copyGroups = [...groups.values()].filter(g => g.members.length > 1).map(g => ({ members:g.members,
    ...ratio([...g.functions.values()].filter(f=>f.entryPositive).length,g.functions.size),
    zeroEntryFunctions:[...g.functions.values()].filter(f=>!f.entryPositive).map(f=>({names:[...f.names].sort(),startOffset:f.startOffset,endOffset:f.endOffset})) }));
  const sum = field => fileStats.reduce((n,f)=>n+f[field],0);
  const absent = fileStats.filter(f => !f.observed).map(f=>f.path);
  const notes = [
    'Production inventory excludes tracked paths under tests/ and *.test.mjs, including shipped practice test templates; these exclusions are listed explicitly.',
    'Entry-positive means at least one profile reports first function range count > 0. Denominator is functions observed in profiles, not all functions in the repository.',
    'V8 function records include anonymous/script-wrapper entries as emitted; no parser-derived source function denominator is claimed. Offsets are UTF-16 code units.',
    'Deduplication is by exact tracked source URL plus entry start/end offsets; names are retained as a set. Entry counts are not summed into an invocation estimate.',
    'All regular JSON files under the input directory are examined, including subprocess profiles. No PID or test-process filter is applied. Symlinks are skipped.',
    'Only exact file:///Users/dionalmaer/code/keel/ URLs for currently tracked production .mjs paths match. Queries, fragments, fixture/mutant copies, worktrees and copied adopter sources are excluded, including code that executed only in those copies.',
    'Unobserved modules are listed separately; absence is not evidence that every function in them was never executed elsewhere. No absent-module functions enter the denominator.',
    'Block ranges are ignored and are not claimed as branches. Entry execution is not assertion coverage, behavior verification, mutation sensitivity or test usefulness.',
    'Per-source statistics keep canonical practice and rendered copies separate. Manifest-related identical-current-byte copies additionally have union-by-offset groups. No overall coverage percentage is emitted.',
    'Profiles do not prove source hashes at collection time. Current HEAD, working-copy hashes and mismatched offsets are contextual checks only. Do not mix collection revisions; same-URL runtime source replacement cannot be detected reliably.',
    'Stop collection before analysis: changing or partially written profiles may yield parse/read errors. JSON validity does not prove the complete process set flushed successfully.',
  ];
  if (adjacentRunLog?.counts?.fail > 0) warnings.push(`Adjacent collection log reports ${adjacentRunLog.counts.fail} failed tests; some scenarios stopped early. This is not a fully passing collection.`);
  if (raw.diagnosticRewrittenProfileFiles) warnings.push('Some profiles carry keelAudit metadata from the old rewriting preload; this is not an untouched native baseline.');
  if (errors.length) warnings.push('Errors/gaps exist; inspect the full artifact before interpreting observed counts.');
  if (sum('offsetMismatches')) warnings.push('Some observed offsets exceed current source length; collection/source comparability is uncertain.');
  const fullPath = join(outputReal,'coverage-file-stats.json'), summaryPath = join(outputReal,'coverage-summary.json');
  const full = { schemaVersion:1, startedAt, finishedAt:new Date().toISOString(), root:ROOT, input, headAtAnalysis:head,
    productionWorkingStatus:git(['status','--porcelain=v1','--','lib','bin','practices','scripts']),
    rawProfileCounts:{...raw,distinctPidsFromFilenames:profilePids.size}, excludedScriptRecords:excluded,
    adjacentRunLog, inventory:{trackedMjsCandidates:candidates.length,excludedTestSources,trackedProductionModules:production.length,observedModules:fileStats.length-absent.length,absentModules:absent},
    fileQualifiedFunctionSlots:ratio(sum('entryPositiveFunctions'),sum('observedFunctions')),
    identicalManifestCopyCollapsedSlots:ratio([...groups.values()].reduce((n,g)=>n+[...g.functions.values()].filter(f=>f.entryPositive).length,0),[...groups.values()].reduce((n,g)=>n+g.functions.size,0)),
    canonicalRenderedPairs:copyPairs, identicalCanonicalRenderedGroups:copyGroups, files:fileStats, profiles, errors,warnings,notes };
  writeFileSync(fullPath,JSON.stringify(full,null,2)+'\n',{flag:'w'});
  const summary = { schemaVersion:1, input, headAtAnalysis:head, rawProfileCounts:full.rawProfileCounts,
    adjacentRunLog,trackedMjsCandidates:candidates.length,excludedTestSources,trackedProductionModules:production.length,observedModules:fileStats.length-absent.length,absentModuleCount:absent.length,
    absentModuleExamples:absent.slice(0,12), fileQualifiedFunctionSlots:full.fileQualifiedFunctionSlots,
    identicalManifestCopyCollapsedSlots:full.identicalManifestCopyCollapsedSlots,
    canonicalRenderedPairCount:copyPairs.length,identicalCopyGroupCount:copyGroups.length,
    jsonParseErrorCount:raw.parsedJsonErrors,totalErrorCount:errors.length,
    errorExamples:errors.slice(0,8).map(e=>({...e,message:e.message.slice(0,220)})),
    excludedScriptRecords:excluded, warnings,
    interpretation:'Observed function entry execution only. Unobserved modules excluded from function denominator; no overall percentage, branch or assertion coverage claim.',
    fullFileStats:fullPath, summaryFile:summaryPath };
  writeFileSync(summaryPath,JSON.stringify(summary,null,2)+'\n',{flag:'w'});
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
}
