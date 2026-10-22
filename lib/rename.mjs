// Explicit Keel → Plates migration. No network, render, scheduling or execution.
// The private Git journal retains exact before/after bytes for crash recovery.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute, posix } from 'node:path';
import { lstat, readFile, readlink, readdir, mkdir, writeFile, rename, unlink, rmdir, symlink, chmod, realpath, open } from 'node:fs/promises';

const OLD = '.keel', NEW = '.plates', CONFIG = '.keel/keel.json', NEXT_CONFIG = '.plates/plates.json';
const MAX_FILE = 8 * 1024 * 1024, MAX_TOTAL = 128 * 1024 * 1024, MAX_FILES = 10000;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const exists = async path => !!await lstat(path).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
export class RenameError extends Error { constructor(message) { super(message); this.exitCode = 2; } }
const refuse = message => { throw new RenameError(message); };
const git = (root, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

// Operational identifiers are persisted remotely or in recovery receipts. A
// filename migration must not sever their identity or create a second queue.
const DURABLE = /(?:'keel\/'|"keel\/"|`keel\/`)|keel-test-runs\b|keel-production-(?=\d|\$\{|['"`]|$)|keel-tend-page\b|trusted-keel\b|KEEL_WEB_(?:ORIGIN|OPERATION)\b|Keel-Update-Operation\b|keel\/web-update-|keel_operation\b|keel-web-|Keel-Operation\b|keel_run_history\b|keel-goodnight-loop\b|keel%3[Aa][a-z-]+|keel:(?!(?:begin|end)\b)[a-z-]+|(?<=["'`])keel\.(?!(?:json|mjs|js|ts|md|yml|yaml|sh)\b)[a-z][a-zA-Z0-9_-]*(?=\\?["'`])|keel-(?:impact|decision|reconciliation|proof|measurements|verify)\b|keelWindow\b|keel-time-proposals?\b|keel-night-plan\b|keel-claims\b|keel\\?\/(?:robot-|update-)|keel-(?:climb|tend|night|loop)\\?\/|keel-canvas-(?:night|card)\b|__Host-keel-(?:session|login|oauth)\b|keel-job-migrations\b|keel_private\b|keel_model_credential_read\b|keel_(?:web|home_cache|home_quota|home_cursor|decision|walk|media|connection|job|fleet|model|editor_draft|night_retry)_rpc\b|secrets\.KEEL_[A-Z_]+/g;
// Module names are consumer interfaces, not branding prose. Preserve complete
// literals (including package subpaths) before the active-text replacement.
const MODULE_GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))*`;
const MODULE_LITERAL = /(?:"(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*'|`(?:\\[\s\S]|[^`\\])*`)/.source;
const MODULE_CALLEE = `\\b(?:import|require)(?:${MODULE_GAP}\\.${MODULE_GAP}(?:meta${MODULE_GAP}\\.${MODULE_GAP})?resolve)?${MODULE_GAP}\\(${MODULE_GAP}`;
const MODULE_REFERENCE = new RegExp(`(\\b(?:from|import)${MODULE_GAP}|${MODULE_CALLEE})(${MODULE_LITERAL})`, 'g');
function hasComputedModuleReferences(text) {
  const simple = new RegExp(`^(${MODULE_LITERAL})${MODULE_GAP}[,)]`);
  return [...text.matchAll(new RegExp(MODULE_CALLEE, 'g'))].some(match => {
    const literal = simple.exec(text.slice(match.index + match[0].length));
    return !literal || moduleValue(literal[1]) === null;
  });
}
// A computed loader may consume a constant declared elsewhere. Protect token
// literals throughout that source, without trying to infer variable dataflow.
// Comments and ordinary product prose remain eligible for the branding pass.
const SOURCE_LITERALS = new RegExp(`//[^\\n]*|/\\*[\\s\\S]*?\\*/|${MODULE_LITERAL}`, 'g');
function moduleToken(value) { return value !== '' && !/\s/.test(value) && /^[\w@./~:+?#${}\[\]-]+$/.test(value); }
function moduleValue(literal) {
  if (literal[0] === '`' && literal.includes('${')) return null;
  let invalid = false;
  const value = literal.slice(1, -1).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, escape) => {
    if (/^[1-9]/.test(escape)) { invalid = true; return ''; }
    if (escape.startsWith('u{')) {
      const point = Number.parseInt(escape.slice(2, -1), 16);
      if (point > 0x10ffff) { invalid = true; return ''; }
      return String.fromCodePoint(point);
    }
    if (/^[ux][0-9a-fA-F]+$/.test(escape)) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r': '', '\r\n': '' })[escape] ?? escape;
  });
  return invalid ? null : value;
}
function moduleLiteral(value, quote) {
  return quote + value.replaceAll('\\', '\\\\').replaceAll(quote, '\\' + quote)
    .replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('${', quote === '`' ? '\\${' : '${') + quote;
}
function moduleReferenceFor(file, mapping, original) {
  let product = false;
  for (let dir = posix.dirname(file);; dir = posix.dirname(dir)) {
    const state = original.get(posix.join(dir, 'package.json'));
    if (state) {
      const manifest = JSON.parse(decoded(state));
      product = PACKAGE_FIELDS.some(field => productSpec(manifest[field]?.keel));
      break; // A nested package owns its dependency names, even when absent.
    }
    if (dir === '.') break;
  }
  return (value, computed = false, inventoryOnly = false) => {
    if (computed && mapping.has(value)) return mapping.get(value);
    // These are the schema-owned metadata components, including join() calls.
    if (computed && !inventoryOnly && value === OLD) return NEW;
    if (computed && !inventoryOnly && value === 'keel.json') return 'plates.json';
    if (/^keel(?:\/|$)/.test(value)) return product ? value.replace(/^keel/, 'plates') : value;
    if (!/^\.\.?\//.test(value)) return value;
    const [, path, suffix = ''] = /^([^?#]*)([?#][\s\S]*)?$/.exec(value);
    const target = posix.normalize(posix.join(posix.dirname(file), path)).replace(/\/$/, '');
    let destination = mapping.get(target) ?? target;
    if (!mapping.has(target)) {
      // Extensionless local imports are moved only when one inventoried file
      // proves the target. Never infer a directory rename from its spelling.
      const candidates = ['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.json', '.node']
        .filter(extension => mapping.has(target + extension));
      if (candidates.length > 1) refuse(`ambiguous module reference in ${file}: ${value}`);
      if (candidates.length === 1) destination = mapping.get(target + candidates[0]).slice(0, -candidates[0].length);
      // Directory resolution depends on package/index rules beyond this file
      // mapper. Never leave a directory caller pointing at a moved tree.
      if (inventoryOnly && !candidates.length && ![...mapping.keys()].some(from => from.startsWith(target + '/'))) return value;
      if (!candidates.length && [...mapping].some(([from, to]) => from.startsWith(target + '/') && !to.startsWith(target + '/')))
        refuse(`affected directory module reference needs an explicit migration: ${value}`);
    }
    const parent = posix.dirname(mapping.get(file) ?? file);
    if (posix.normalize(posix.join(parent, path)).replace(/\/$/, '') === destination) return value;
    const next = posix.relative(parent, destination);
    return (next.startsWith('../') ? next : './' + next) + suffix;
  };
}
// An unrelated module owns its exported property names. Do not infer an API
// rename from local branding. This bounded guard masks comments/string bodies,
// recognizes declaration/direct-call boundaries and refuses affected bindings;
// it deliberately does not perform variable dataflow or rewrite JavaScript ASTs.
function checkExternalBindings(text) {
  if (!/keel/i.test(text)) return;
  const code = text.replace(SOURCE_LITERALS, token => /^["'`]/.test(token) ? '\0' + ' '.repeat(token.length - 1) : ' '.repeat(token.length));
  const affected = value => /keel/i.test(value);
  const fail = () => refuse('external module API binding needs an explicit migration');
  const externalAt = offset => {
    const literal = new RegExp(`^${MODULE_LITERAL}`).exec(text.slice(offset))?.[0];
    const value = literal && moduleValue(literal);
    return value !== null && value !== undefined && !/^\.\.?\//.test(value);
  };
  const member = offset => {
    const tail = code.slice(offset);
    const dot = /^\s*(?:\?\.|\.)\s*([\w$]+)/.exec(tail);
    if (dot && affected(dot[1])) fail();
    const bracket = /^\s*(?:\?\.)?\[\s*\0/.exec(tail);
    if (bracket) {
      const literal = new RegExp(`^${MODULE_LITERAL}`).exec(text.slice(offset + bracket[0].indexOf('\0')))?.[0];
      if (literal && affected(moduleValue(literal) ?? '')) fail();
    }
  };
  const binding = name => {
    if (!/^[\w$]+$/.test(name)) return;
    for (const match of code.matchAll(new RegExp(`\\b${name.replaceAll('$', '\\$')}\\b`, 'g'))) member(match.index + name.length);
    const destructure = new RegExp(`\\b(?:const|let|var)\\s+\\{([^{};]*)\\}\\s*=\\s*${name.replaceAll('$', '\\$')}\\b`, 'g');
    for (const match of code.matchAll(destructure)) if (affected(text.slice(match.index, match.index + match[0].length))) fail();
  };
  const declaration = /\b(?:import|export)\s+((?:type\s+)?(?:[\w$]+\s*,\s*)?(?:\{[^{};]*\}|\*\s*(?:as\s+[\w$]+)?|[\w$]+))\s+from\s*\0/g;
  for (const match of code.matchAll(declaration)) {
    if (!externalAt(match.index + match[0].lastIndexOf('\0'))) continue;
    const clause = text.slice(match.index + match[0].indexOf(match[1]), match.index + match[0].indexOf(match[1]) + match[1].length);
    if (affected(clause)) fail();
    const names = match[1].replace(/^type\s+/, '').replace(/[{}*]/g, '').split(',').map(part => part.trim().split(/\s+as\s+/).at(-1));
    for (const name of names) binding(name.replace(/^as\s+/, ''));
  }
  for (const match of code.matchAll(/\b(?:require|import)\s*\(\s*\0\s*([,)])/g)) {
    if (!externalAt(match.index + match[0].indexOf('\0'))) continue;
    // Options/trailing commas are unsupported call shapes in affected source.
    // Refuse rather than parse arguments and silently miss an API binding.
    if (match[1] === ',') fail();
    member(match.index + match[0].length);
    const assignment = /\b(?:const|let|var)\s+(\{[^{};]*\}|[\w$]+)\s*=\s*(?:await\s+)?$/.exec(code.slice(0, match.index));
    if (!assignment) continue;
    if (affected(text.slice(assignment.index, match.index))) fail();
    binding(assignment[1]);
  }
}
export function renameActiveText(text, { moduleReference = value => value, moduleSource = false, preserveRuntime = false, environmentKeys = [] } = {}) {
  if (moduleSource) checkExternalBindings(text);
  const held = [];
  // Package script keys are consumer APIs. Their callers in workflows and
  // shell files must retain the same aliases as package.json.
  const scriptKey = value => `\u0000PLATES_HELD_${held.push(value) - 1}\u0000`;
  const restore = value => {
    // A later protected span can contain earlier held literals. Restore in
    // reverse insertion order so unmodified consumer bytes remain exact.
    for (let index = held.length - 1; index >= 0; index--) value = value.replaceAll(`\u0000PLATES_HELD_${index}\u0000`, () => held[index]);
    return value;
  };
  const references = preserveRuntime ? [...text.matchAll(MODULE_REFERENCE)] : [];
  const directLiterals = new Set(references.map(match => match.index + match[1].length));
  const runtimeReference = (value, direct = false) => {
    const next = moduleReference(value, true, preserveRuntime);
    // Even a local wrapper or a Node builtin can consume an API payload.
    // Only definite module specifiers establish a filesystem contract here;
    // other affected literals need explicit, reviewed consumer preparation.
    if (preserveRuntime && !direct && (next !== value || moduleReference(value, true) !== value))
      refuse('ambiguous consumer runtime path needs an explicit migration');
    return next;
  };
  const computed = moduleSource && hasComputedModuleReferences(text);
  if (computed) text = text.replace(SOURCE_LITERALS, (literal, offset) => {
    if (!/^["'`]/.test(literal)) return literal;
    const value = moduleValue(literal);
    if (value === null) {
      const raw = literal.slice(1, -1);
      // Cache-busting query/fragment expressions do not determine the file.
      // Resolve only the static path and retain the exact expression bytes.
      const query = /^([^$]*[?#][^$]*)(\$\{[\s\S]*)$/.exec(raw);
      if (query && !/\$\{[^}]*keel[^}]*\}/i.test(query[2])) {
        const next = runtimeReference(query[1], directLiterals.has(offset));
        return scriptKey(next === query[1] ? literal : '`' + moduleLiteral(next, '`').slice(1, -1) + query[2] + '`');
      }
      if (!moduleToken(raw)) return literal;
      // An interpolation whose identifiers will change, or an unresolved
      // relative target that will move, cannot safely be frozen or guessed.
      if (/\$\{[^}]*keel[^}]*\}/i.test(raw) || /^\.\.?\/.*keel/i.test(raw))
        refuse('affected computed module interpolation needs an explicit migration');
      return scriptKey(literal);
    }
    if (!moduleToken(value) || /^(?:Keel|KEEL)$/.test(value)) return literal;
    const next = runtimeReference(value, directLiterals.has(offset));
    return scriptKey(next === value ? literal : moduleLiteral(next, literal[0]));
  });
  text = text.replace(MODULE_REFERENCE, (whole, prefix, literal) => {
    const value = moduleValue(literal);
    if (value === null) {
      if (/keel|fleet\.json/i.test(literal)) refuse('computed or ambiguous module reference needs an explicit migration');
      return prefix + scriptKey(literal);
    }
    const next = moduleReference(value);
    return prefix + scriptKey(next === value ? literal : moduleLiteral(next, literal[0]));
  });
  if (preserveRuntime) {
    // Consumer JavaScript is an interface, not product prose. Keep identifiers,
    // property keys, environment access, arguments and strings byte-for-byte.
    // Only definite, verified module references move automatically;
    // the existing loader checks still refuse unresolved affected expressions.
    text = text.replace(SOURCE_LITERALS, literal => {
      if (!/^["'`]/.test(literal)) return literal;
      const value = moduleValue(literal);
      if (value === null) return literal;
      const next = runtimeReference(value);
      return next === value ? literal : moduleLiteral(next, literal[0]);
    });
    return restore(text);
  }
  text = text.replace(/(\b(?:npm|pnpm|yarn)\s+run(?:-script)?\s+)(["']?[A-Za-z0-9_.:-]+["']?)/g, (_, prefix, key) => prefix + scriptKey(key));
  text = text.replace(/(\b(?:pnpm|yarn)\s+)(["']?keel[A-Za-z0-9_.:-]*["']?)/g, (_, prefix, key) => prefix + scriptKey(key));
  text = text.replace(/(?:keel-night-plan:|contents\/|holds no )\.keel\/night\/plan\.json|export const REMOTE_PLAN = '\.keel\/night\/plan\.json';/g, match => `\u0000PLATES_HELD_${held.push(match) - 1}\u0000`);
  text = text.replace(/\/\^(?:keel|\(\?:keel\|plates\)) tend:/g, () => `\u0000PLATES_HELD_${held.push('/^(?:keel|plates) tend:') - 1}\u0000`);
  text = text.replace(DURABLE, match => `\u0000PLATES_HELD_${held.push(match) - 1}\u0000`);
  text = text.replace(/^(\s*group:\s*.*keel.*)$/gm, match => `\u0000PLATES_HELD_${held.push(match) - 1}\u0000`);
  // Owner-defined environment keys remain the same interface in both source
  // and managed code; holding complete keys also preserves indirect aliases.
  for (const key of environmentKeys) {
    if (typeof key !== 'string' || !key || !/keel/i.test(key)) continue;
    text = text.split(key).join(scriptKey(key));
  }
  text = text.replace(/KEEL/g, 'PLATES').replace(/Keel/g, 'Plates').replace(/keel/g, 'plates');
  text = text.replaceAll('fleet.json', 'plates.json');
  return restore(text)
    .replace(/^name: keel-impact$/gm, 'name: plates-impact');
}
// Ignore rules are privacy boundaries, not branding prose. Keep every owner
// rule verbatim; only add the corresponding positive root metadata rule.
function migrateIgnore(source, path) {
  const lines = source.split(/\r?\n/);
  const additions = lines.filter(line => /^\/?\.keel(?:\/[^\\\s]*|)$/.test(line))
    .map(line => line.replace('.keel', '.plates')).filter(line => !lines.includes(line));
  if (lines.some(line => /^!\/?\.keel(?:\/|$)/.test(line)) || additions.length && lines.some(line => /^\s*!/.test(line)))
    refuse(`${path}: metadata ignore negation needs an explicit migration`);
  if (!additions.length) return source;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source + (source.endsWith('\n') ? '' : newline) + additions.join(newline) + newline;
}
export function renamePath(path) {
  if (path === 'fleet.json') return 'plates.json';
  return path.replaceAll('keel', 'plates').replaceAll('Keel', 'Plates').replaceAll('KEEL', 'PLATES');
}
// Configuration contains user-owned project, remote and receipt identities.
// Only known integration references and the product source key are renamed.
function integrationReference(text, mapping = new Map()) {
  if (mapping.has(text)) return mapping.get(text);
  // Exact inventoried paths in shell arguments may have other local names
  // (for example tests/keel-check.mjs). Do not rewrite arbitrary identifiers.
  text = text.replace(/(^|[\s"'`=])(\.\/)?([^\s"'`;|&<>]+)/g, (whole, prefix, relative, path) =>
    mapping.has(path) ? prefix + (relative ?? '') + mapping.get(path) : whole);
  return text.replace(/\.keel(?=\/|$)/g, '.plates')
    .replace(/(?<=\.plates\/)keel\.json\b/g, 'plates.json')
    .replace(/scripts\/keel(?=\/|$)/g, 'scripts/plates')
    .replace(/skills\/keel(?=\/|$)/g, 'skills/plates')
    .replace(/(?<![\w-])keel-(night|loop|climb|tend|cross-review)\.ya?ml\b/g, match => match.replace('keel-', 'plates-'));
}
function migrateConfig(config, mapping, self = false) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) refuse('invalid project configuration');
  if (config.plates !== undefined && config.keel !== undefined) refuse('config has conflicting keel and plates keys');
  // Only executable schema fields and the product source participate. Local
  // variant prose, environment values and historical attribution remain data.
  for (const value of [config.keel, config.plates, config.setup, config.check,
    config.climb?.testCommand, config.climb?.build, config.climb?.perf?.command, config.climb?.perf?.check,
    config.loop?.run, config.loop?.afterRender, config.prove?.command,
    ...(Array.isArray(config.loop?.contexts) ? config.loop.contexts.map(context => context?.command) : []),
  ]) if (typeof value === 'string') refuseLegacyProductPins(value);

  const reference = value => typeof value === 'string' ? integrationReference(value, mapping) : value;
  const command = value => {
    if (typeof value !== 'string') return value;
    const next = integrationReference(value, mapping);
    if (!self && next !== value) refuse('configuration command needs an explicit migration');
    return next;
  };
  const localFields = (value, fields, lists = [], commands = []) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const next = { ...value };
    for (const key of fields) if (Object.hasOwn(value, key)) next[key] = reference(value[key]);
    for (const key of lists) if (Array.isArray(value[key])) next[key] = value[key].map(reference);
    for (const key of commands) if (Object.hasOwn(value, key)) next[key] = command(value[key]);
    return next;
  };
  // Explicit schema fields only: never recurse through identities, environment
  // values, descriptions, provider configuration or local-variant provenance.
  const converted = localFields(config, ['health', 'lessons', 'guide', 'gateWorkflow', 'retros'], [], ['check', 'setup']);
  for (const [key, fields, lists, commands] of [
    ['ci', ['gateWorkflow']],
    ['climb', ['buildOutput'], [], ['testCommand', 'build']],
    ['loop', [], ['afterRenderWrites'], ['run', 'afterRender']],
    ['prove', [], [], ['command']],
    ['tests', ['junit'], ['stalls']],
    ['retros', ['dir']],
    ['paths', ['retros']],
  ]) if (config[key] !== undefined && typeof config[key] === 'object') converted[key] = localFields(config[key], fields, lists, commands);
  if (config.climb?.perf !== undefined && converted.climb && !Array.isArray(converted.climb)) converted.climb.perf = localFields(config.climb.perf, [], [], ['command', 'check']);
  if (Array.isArray(config.loop?.contexts)) converted.loop.contexts = config.loop.contexts.map(value => localFields(value, [], [], ['command']));
  if (Array.isArray(config.contracts)) converted.contracts = config.contracts.map(value => localFields(value, ['read'], ['paths']));
  if (Array.isArray(config.ejected)) converted.ejected = config.ejected.map(key => {
    if (typeof key !== 'string') return key;
    const at = key.indexOf('#'), path = at < 0 ? key : key.slice(0, at), block = at < 0 ? '' : key.slice(at);
    // A declared exclusion still owns a target after its file was removed.
    return (mapping.get(path) ?? renamePath(path)) + block;
  });
  if (Object.hasOwn(config, 'keel')) {
    converted.plates = config.keel === 'github:dalmaer/keel' ? 'github:dalmaer/plates' : config.keel;
    delete converted.keel;
  }
  if (config.keel === 'self' && config.repo === 'dalmaer/keel') {
    converted.repo = 'dalmaer/plates';
    converted.lessonProject = config.lessonProject ?? config.repo;
    converted.feedbackProject = config.feedbackProject ?? config.repo;
    if (config.name === 'Keel') converted.name = 'Plates';
  }
  return converted;
}
const PACKAGE_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const productSpec = value => typeof value === 'string' && /^github:dalmaer\/keel(?:#|$)/.test(value);
const productGit = /^(?:github:|(?:git\+)?(?:https?:\/\/github\.com\/|ssh:\/\/(?:git@)?github\.com\/|git:\/\/github\.com\/)|git@github\.com:)dalmaer\/keel(?:\.git)?(?=#|$)/;
const oldProduct = /(?:github:dalmaer\/|github\.com[/:]dalmaer\/)keel(?:\.git)?(?=[#"'\s]|$)/;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function refuseLegacyProductPins(value) {
  // A renamed Git URL still resolves the original code at a pinned revision.
  // Only an explicit compatible upgrade can establish a Plates executable;
  // this offline filename migration cannot verify or move the caller's pin.
  if (typeof value === 'string' && /(?:github:dalmaer\/|github\.com[/:]dalmaer\/|(?:^|[\s"'`])dalmaer\/)keel(?:\.git)?#/i.test(value)) refuse('unsupported legacy product Git pin; choose an explicit compatible upgrade before migration');
  if (value && typeof value === 'object') for (const entry of Object.values(value)) refuseLegacyProductPins(entry);
}

function migrateDependencies(pkg) {
  if (PACKAGE_FIELDS.some(field => productSpec(pkg[field]?.keel)) && PACKAGE_FIELDS.some(field => object(pkg[field]) && Object.hasOwn(pkg[field], 'plates'))) refuse('package has conflicting keel and plates dependencies');
  for (const field of [...PACKAGE_FIELDS, 'peerDependencies', 'overrides', 'resolutions']) refuseLegacyProductPins(pkg[field]);
  for (const field of PACKAGE_FIELDS) {
    if (!object(pkg[field])) continue;
    for (const [key, value] of Object.entries(pkg[field])) {
      if (key !== 'keel' || !productSpec(value)) continue;
      if (Object.hasOwn(pkg[field], 'plates')) refuse('package has conflicting keel and plates dependencies');
      pkg[field].plates = value.replace('github:dalmaer/keel', 'github:dalmaer/plates');
      delete pkg[field].keel;
    }
  }
}
function unquotedShell(text, transform) {
  // Nested shell evaluation is deliberately left on the compatibility alias.
  // This masks simple quoted/escaped spans, not a general shell parser.
  if (/\$\(|`/.test(text)) return text;
  const held = []; let masked = '';
  for (let i = 0; i < text.length;) {
    const start = i, quote = text[i];
    if (quote === '\\') i = Math.min(i + 2, text.length);
    else if (quote === '"' || quote === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === '\\' && quote === '"') i = Math.min(i + 2, text.length);
        else if (text[i++] === quote) break;
      }
    } else { masked += text[i++]; continue; }
    masked += `\u0000PLATES_QUOTED_${held.push(text.slice(start, i)) - 1}\u0000`;
  }
  return transform(masked).replace(/\u0000PLATES_QUOTED_(\d+)\u0000/g, (_, i) => held[Number(i)]);
}
function packageScripts(scripts, mapping, self, file) {
  return Object.fromEntries(Object.entries(scripts).map(([key, value]) => {
    if (typeof value !== 'string') refuse('package script must be a string');
    refuseLegacyProductPins(value);
    // Script names and argument semantics are consumer APIs. Candidate changes
    // are allowed only in the verified product source; consumers must explicitly
    // prepare their commands, even when an argument looks like a moved file.
    const next = unquotedShell(integrationReference(value, mapping), text => text
      .replace(/(^\s*|[;&|\n]\s*)(npx\s+|npm\s+exec\s+(?:--\s+)?|(?:pnpm|yarn)\s+(?:exec|dlx)\s+)?keel(?=\s|$)/g, '$1$2plates')
      .replace(/(^\s*|[;&|\n]\s*)(pnpm|yarn)(\s+)keel(?=\s|$)/g, (all, prefix, manager, space) => Object.hasOwn(scripts, 'keel') ? all : `${prefix}${manager}${space}plates`));
    if (!self && next !== value) refuse(`${file}: package script ${key} needs an explicit migration`);
    return [key, next];
  }));
}
async function packagePathResolver(root, file, mapping) {
  const before = posix.dirname(file), after = posix.dirname(mapping.get(file) ?? file);
  const local = path => posix.relative(before, path);
  const changed = [...mapping].filter(([from, to]) => from !== to);
  const fail = message => refuse(`${file}: ${message}`);
  const patternAffected = value => {
    const prefix = value.replace(/^\.\//, '').split(/[*?[{!]/)[0];
    return changed.some(([path]) => local(path).startsWith(prefix));
  };
  let visited = 0;
  const checkDirectory = async (from, to) => {
    for (const entry of await readdir(join(root, from), { withFileTypes: true })) {
      if (++visited > MAX_FILES) fail('package directory inventory limit reached');
      const child = posix.join(from, entry.name), destination = mapping.get(child) ?? child;
      if (entry.isDirectory()) await checkDirectory(child, to);
      else if (!destination.startsWith(to + '/')) fail(`partly moved package directory: ${from}`);
    }
  };
  const pathValue = async (value, field, relativeOnly = false) => {
    if (typeof value !== 'string') return value;
    if (relativeOnly && !value.startsWith('./')) return value; // External imports/browser packages.
    if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value)) return value;
    if (/[*?[{!]/.test(value)) {
      if (!patternAffected(value)) return value;
      // Broad files inclusion keeps renamed children. Export/import captures
      // are public API names, and workspace captures are lockfile identities.
      if (field === 'files' && /^(?:[^*?[{!]+\/)?\*\*(?:\/\*)?$/.test(value) && renamePath(value) === value) return value;
      fail(`affected package ${field} pattern needs an explicit migration: ${value}`);
    }
    const target = posix.normalize(posix.join(before, value)).replace(/\/$/, '');
    if (!inside(target)) return value;
    let destination = mapping.get(target) ?? target;
    if (!mapping.has(target)) {
      // Node's legacy main lookup permits an omitted file extension. Resolve
      // only an unambiguous inventoried file; never guess a missing entry.
      const candidates = field === 'main' ? ['.js', '.json', '.node'].filter(extension => mapping.has(target + extension)) : [];
      if (candidates.length > 1) fail(`ambiguous package main file: ${value}`);
      if (candidates.length === 1) destination = mapping.get(target + candidates[0]).slice(0, -candidates[0].length);
      const children = changed.filter(([path]) => path.startsWith(target + '/'));
      if (children.length) {
        const proposed = renamePath(target);
        if (proposed !== target) {
          await safeParents(root, target);
          const state = await lstat(join(root, target)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
          if (!state?.isDirectory()) fail(`unverified package directory: ${value}`);
          await checkDirectory(target, proposed);
          destination = proposed;
        }
      }
    }
    if (posix.normalize(posix.join(after, value)).replace(/\/$/, '') === destination) return value;
    const next = posix.relative(after, destination);
    return (value.startsWith('./') && !next.startsWith('../') ? './' : '') + next + (value.endsWith('/') ? '/' : '');
  };
  const workspaceAffected = value => {
    const prefix = value.replace(/^\.\//, '').split(/[*?[{!]/)[0];
    return changed.some(([from, to]) => manifestPath(from) && posix.dirname(from) !== posix.dirname(to) && local(from).startsWith(prefix));
  };
  const scriptMapping = new Map([...mapping].map(([from, to]) => [posix.relative(before, from), posix.relative(after, to)]));
  return { pathValue, workspaceAffected, scriptMapping, fail };
}
const typeScriptConfig = (path, source = '') => /(?:^|\/)(?:ts|js)config(?:\.[^/]*)?\.jsonc?$/.test(path)
  || /\.jsonc?$/.test(path) && /"compilerOptions"\s*:/.test(source);
function migrateTypeScriptConfig(source, file, mapping) {
  const fail = () => refuse(`${file}: affected unsupported TypeScript configuration needs an explicit migration`);
  let config;
  try { config = JSON.parse(source); }
  catch { if (renameActiveText(source) !== source || mapping.get(file) !== file) fail(); return source; }
  if (!object(config)) fail();
  const { files, include, exclude, ...interfaces } = config;
  // Package extends, aliases and compiler paths are resolution interfaces, not
  // product copy. Only exact inventoried file selections are supported.
  const rest = JSON.stringify(interfaces);
  if (renameActiveText(rest) !== rest || posix.dirname(mapping.get(file) ?? file) !== posix.dirname(file)) fail();
  for (const [field, values] of Object.entries({ files, include, exclude })) {
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) fail();
    config[field] = values.map(value => {
      const target = posix.normalize(posix.join(posix.dirname(file), value));
      if (!mapping.has(target)) { if (renameActiveText(value) !== value) fail(); return value; }
      const next = posix.relative(posix.dirname(file), mapping.get(target));
      return value.startsWith('./') && !next.startsWith('../') ? './' + next : next;
    });
  }
  return JSON.stringify(config) === JSON.stringify(JSON.parse(source)) ? source : json(config);
}
const proseFile = path => /\.(?:md|markdown|txt)$/i.test(path) || /(?:^|\/)(?:README|LICENSE|NOTICE|CHANGELOG)$/i.test(path);
function machineConfiguration(path) {
  return /\.(?:json[5c]?|ya?ml|toml)$/.test(path) || /\.config\.[cm]?[jt]s$/.test(path)
    || /(?:^|\/)\.(?:eslintrc|babelrc|swcrc|prettierrc)(?:\.[cm]?[jt]s)?$/.test(path);
}
function checkStructuredMigration(path, source, next, self) {
  if (source === next && renamePath(path) === path || historical(path, source)) return;
  if (!machineConfiguration(path)) return;
  // Existing explicit contracts keep their specialized checks. Unknown tool
  // settings may contain dependency/API keys and must never become brand prose.
  if (/(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return;
  if (/(?:^|\/)renovate\.json$/.test(path)) {
    try {
      const before = JSON.parse(source), after = JSON.parse(next);
      const { description: oldCopy, ...oldSettings } = before, { description: newCopy, ...newSettings } = after;
      if (typeof oldCopy === 'string' && /^Managed by keel \(practice renovate\):/.test(oldCopy)
        && newCopy === renameActiveText(oldCopy) && JSON.stringify(oldSettings) === JSON.stringify(newSettings)) return;
    } catch { /* Unsupported configuration remains a refusal. */ }
  } else if (self && (
    /^(?:fleet|vercel)\.json$/.test(path)
    || /^practices\/[^/]+\/practice\.json$/.test(path)
    || /^practices\/agents-md\/files\/\.claude\/settings\.json$/.test(path)
    || /^docs\/(?:goals\.json|(?:walks|changes)\/[^/]+\.json)$/.test(path)
    || /^tests\/fixtures\//.test(path)
  )) return;
  refuse(`${path}: affected unsupported machine configuration needs an explicit migration`);
}
async function migratePackage(source, mapping, root, file, self = false) {
  const pkg = JSON.parse(source);
  if (!object(pkg)) refuse('invalid package manifest');
  const { pathValue, workspaceAffected, scriptMapping, fail } = await packagePathResolver(root, file, mapping);
  if (pkg.typesVersions !== undefined) {
    if (!object(pkg.typesVersions)) fail('unsupported typesVersions needs an explicit migration');
    for (const routes of Object.values(pkg.typesVersions)) {
      if (!object(routes)) fail('unsupported typesVersions needs an explicit migration');
      for (const targets of Object.values(routes)) {
        if (!Array.isArray(targets) || targets.some(value => typeof value !== 'string')) fail('unsupported typesVersions needs an explicit migration');
        for (const value of targets) if (await pathValue(value, 'typesVersions') !== value) fail('affected typesVersions target needs an explicit migration');
      }
    }
  }
  // Only filesystem values in known npm/Node schemas move. Package identities,
  // export/import condition keys and command names remain consumer-owned APIs.
  const targets = async (value, field) => {
    if (typeof value === 'string') return pathValue(value, field, true);
    if (Array.isArray(value)) return Promise.all(value.map(entry => targets(entry, field)));
    if (object(value)) return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await targets(entry, field)])));
    return value;
  };
  for (const field of ['main', 'module', 'types', 'typings']) if (typeof pkg[field] === 'string') pkg[field] = await pathValue(pkg[field], field);
  for (const field of ['exports', 'imports']) if (pkg[field] !== undefined) pkg[field] = await targets(pkg[field], field);
  if (typeof pkg.bin === 'string') pkg.bin = await pathValue(pkg.bin, 'bin');
  else if (object(pkg.bin)) pkg.bin = Object.fromEntries(await Promise.all(Object.entries(pkg.bin).map(async ([key, value]) => [key, await pathValue(value, 'bin')])));
  for (const field of ['files', 'man']) {
    if (typeof pkg[field] === 'string') pkg[field] = await pathValue(pkg[field], field);
    else if (Array.isArray(pkg[field])) pkg[field] = await Promise.all(pkg[field].map(value => pathValue(value, field)));
  }
  if (object(pkg.directories)) for (const field of ['bin', 'man', 'lib', 'doc', 'example', 'test']) {
    if (typeof pkg.directories[field] === 'string') pkg.directories[field] = await pathValue(pkg.directories[field], `directories.${field}`);
  }
  if (typeof pkg.browser === 'string') pkg.browser = await pathValue(pkg.browser, 'browser');
  else if (object(pkg.browser)) {
    const browser = Object.create(null);
    for (const [key, value] of Object.entries(pkg.browser)) {
      const next = await pathValue(key, 'browser', true);
      if (Object.hasOwn(browser, next)) fail(`package browser path collision: ${next}`);
      browser[next] = await pathValue(value, 'browser', true);
    }
    pkg.browser = browser;
  }
  // Workspace and local dependency moves also change lock link identities.
  // This migrator does not regenerate those graphs, so refuse before writes.
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
  if (Array.isArray(workspaces)) for (const value of workspaces) {
    if (typeof value === 'string' && (workspaceAffected(value) || (!/[*?[{!]/.test(value) && await pathValue(value, 'workspaces') !== value))) fail(`affected package workspace needs an explicit lock migration: ${value}`);
  }
  for (const field of [...PACKAGE_FIELDS, 'peerDependencies']) for (const value of Object.values(pkg[field] ?? {})) {
    if (typeof value !== 'string' || !/^(?:file|link):/.test(value)) continue;
    const path = value.replace(/^(?:file|link):/, '');
    if (await pathValue(path, field) !== path) fail(`affected local dependency needs an explicit lock migration: ${value}`);
  }
  if (pkg.scripts) pkg.scripts = packageScripts(pkg.scripts, scriptMapping, self, file);
  migrateDependencies(pkg);
  return JSON.stringify(pkg) === JSON.stringify(JSON.parse(source)) ? source : json(pkg);
}
function migrateNpmLock(source, manifest, convertedManifest) {
  const lock = JSON.parse(source), pkg = manifest ? JSON.parse(manifest) : null;
  const converted = convertedManifest ? JSON.parse(convertedManifest) : pkg;
  let metadataChanged = false;
  const rootBin = lock.packages?.['']?.bin;
  if (rootBin !== undefined && JSON.stringify(pkg?.bin) !== JSON.stringify(converted?.bin)) {
    // Only root package metadata is in scope, never installed dependency bins
    // or workspace links. Unknown normalization must be reconciled explicitly.
    if (![2, 3].includes(lock.lockfileVersion) || !object(pkg?.bin) || !object(rootBin)
      || Object.keys(rootBin).length !== Object.keys(pkg.bin).length
      || Object.entries(pkg.bin).some(([key, value]) => rootBin[key] !== value)) refuse('package root bin metadata and manifest disagree; reconcile the lock before migration');
    lock.packages[''].bin = { ...converted.bin };
    metadataChanged = true;
  }
  refuseLegacyProductPins(lock);
  const fields = PACKAGE_FIELDS.filter(field => productSpec(pkg?.[field]?.keel));
  if (!fields.length && !oldProduct.test(source)) return metadataChanged ? json(lock) : source;
  if (!object(lock) || ![1, 2, 3].includes(lock.lockfileVersion) || !fields.length) refuse('unsupported or ambiguous product dependency lock; regenerate it explicitly');
  const convert = value => typeof value === 'string' && productGit.test(value) ? value.replace(/dalmaer\/keel(?=\.git|#|$)/, 'dalmaer/plates') : value;
  const dependency = value => {
    if (!object(value) || ![value.resolved, value.version].some(v => typeof v === 'string' && productGit.test(v))) refuse('product dependency lock does not identify the expected Git source');
    const next = { ...value };
    for (const key of ['version', 'resolved', 'from']) if (typeof next[key] === 'string') next[key] = convert(next[key]);
    return next;
  };
  if (lock.lockfileVersion >= 2) {
    if (!object(lock.packages) || !object(lock.packages[''])) refuse('unsupported npm packages lock');
    const root = lock.packages[''];
    for (const field of fields) if (root[field]?.keel !== pkg[field].keel) refuse('package manifest and lock disagree about product dependency');
    migrateDependencies(root);
    if (Object.hasOwn(lock.packages, 'node_modules/plates')) refuse('package lock has conflicting keel and plates dependencies');
    const installed = dependency(lock.packages['node_modules/keel']);
    const renamed = Object.create(null);
    for (const [path, value] of Object.entries(lock.packages)) {
      const target = path === 'node_modules/keel' || path.startsWith('node_modules/keel/') ? 'node_modules/plates' + path.slice('node_modules/keel'.length) : path;
      if (Object.hasOwn(renamed, target) || target !== path && Object.hasOwn(lock.packages, target)) refuse('package lock path collision');
      renamed[target] = path === 'node_modules/keel' ? installed : value;
    }
    lock.packages = renamed;
  }
  if (lock.lockfileVersion <= 2) {
    if (!object(lock.dependencies)) refuse('unsupported npm dependency lock');
    if (Object.hasOwn(lock.dependencies, 'plates')) refuse('package lock has conflicting keel and plates dependencies');
    lock.dependencies.plates = dependency(lock.dependencies.keel);
    delete lock.dependencies.keel;
  }
  // Workspace/transitive references require resolution knowledge this local
  // migrator does not have. Never publish a half-migrated dependency graph.
  if (oldProduct.test(JSON.stringify(lock))) refuse('unsupported product references remain in package lock; regenerate it explicitly');
  return json(lock);
}
const manifestPath = path => /(?:^|\/)package\.json$/.test(path);
const npmLockPath = path => /(?:^|\/)(?:package-lock|npm-shrinkwrap)\.json$/.test(path);
const otherLockPath = path => /(?:^|\/)(?:yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(path);
// These exact legacy readers are present in the inventoried consumer releases.
// Their canonical counterparts change only rename compatibility: bounded dual
// history discovery and immutable repository/workflow/config/artifact binding.
// Never apply a textual approximation to an unknown or locally edited reader.
const HISTORY_READERS = {
  'production-night.mjs': {
    before: 'd7b2dc58a90da8682c9d49025f9a0f8f2421112cdd503b94850482902d6ea978',
    after: '2c17678da7e1838a5871ed434083d0a50d4ab1e9a20a4e6bae6e3403f959cb67',
  },
  'test-history.mjs': {
    before: '5e656638ab55a61748c8cc9df6c5119083a2dbff698a25661d2f9778e04f73d1',
    after: '6ee51865fefcfdc195ee8d21d22876069e0ca814be3326f35a536def138cd757',
  },
};
const historyReader = path => /(?:^|\/)scripts\/(?:keel|plates)\/(production-night|test-history)\.mjs$/.test(path);
async function migrateHistoryReader(path, source) {
  const name = path.split('/').at(-1), expected = HISTORY_READERS[name], actual = hash(source);
  if (actual === expected.after) return source;
  if (actual !== expected.before) refuse(`history reader ${path} is an unknown/local variant; an explicit compatibility upgrade is required before migration`);
  const canonical = await readFile(new URL('../practices/night/files/scripts/plates/' + name, import.meta.url), 'utf8');
  if (hash(canonical) !== expected.after) refuse(`history reader ${path} has an unverified replacement; an explicit compatibility upgrade is required before migration`);
  return canonical;
}
function migrateNightPlanSource(text) {
  if (!text.includes("export const PLAN_BRANCH = 'keel-night-plan';") || text.includes('export const REMOTE_PLAN =')) return text;
  return text.replace("export const PLAN_BRANCH = 'keel-night-plan';", "export const PLAN_BRANCH = 'keel-night-plan';\n// The branch and blob path are durable remote identities shared with existing\n// Keel installations. Local working files use PLAN; remote readers/writers\n// retain one path so a rename cannot create or overwrite a competing plan.\nexport const REMOTE_PLAN = '.keel/night/plan.json';")
    .replaceAll('`${tip}:${PLAN}`', '`${tip}:${REMOTE_PLAN}`')
    .replaceAll('holds no ${PLAN}: nothing to tick', 'holds no ${REMOTE_PLAN}: nothing to tick')
    .replaceAll('held no ${PLAN}`', 'held no ${REMOTE_PLAN}`')
    .replaceAll('`100644,${blob},${PLAN}`', '`100644,${blob},${REMOTE_PLAN}`');
}
// Records describe what happened under the name in use then. Keep their prose,
// commands, measured paths and human decisions; only working link destinations
// may follow a renamed file. Indexes and current design/usage guides stay active.
const historical = (path, source) => /^docs\/(?:evidence|research|reviews|health|night|tend|retros|lessons)(?:\/|\.)/.test(path)
  || /^docs\/(?:changelog|practice)\/\d{4}-\d{2}-\d{2}(?:-[^/]+)?\.md$/.test(path)
  || /^docs\/loop\/(?!README\.md$)[^/]+\.md$/.test(path)
  || /^docs\/projects\/[^/]+\/(?:phases|journey)\.md$/.test(path)
  || (/^docs\/(?:keel|plates)-adoption\.md$/.test(path) && /^Written by `(?:keel|plates) adopt` on practice /m.test(source))
  || ['NOTICE', 'WHATSNEW.md'].includes(path);
function workingLinks(text, mapping) {
  // Historical prose, commands, protocol blocks and fingerprints stay intact.
  // Only Markdown link destinations to renamed tracked paths change.
  return text.replace(/(\]\()([^\s)]+)([^)]*\))/g, (whole, start, target, end) => {
    if (/\/blob\/[a-f0-9]{7,40}\//.test(target)) return whole;
    let next = target;
    for (const [from, to] of mapping) {
      if (next === from || next.endsWith(`/${from}`) || next.startsWith(`${from}#`)) next = next.replace(from, to);
      else {
        const oldName = from.split('/').at(-1), newName = to.split('/').at(-1);
        const [pathname, anchor] = next.split('#');
        if (pathname === oldName || pathname.endsWith(`/${oldName}`)) next = pathname.slice(0, -oldName.length) + newName + (anchor === undefined ? '' : `#${anchor}`);
      }
    }
    return `${start}${next}${end}`;
  });
}
const inside = path => typeof path === 'string' && path && !isAbsolute(path) && !path.split('/').some(part => part === '..' || part === '.git') && !path.includes('\0');
async function safeParents(root, path) {
  if (!inside(path)) refuse(`unsafe migration path: ${path}`);
  let at = root;
  for (const part of path.split('/').slice(0, -1)) {
    at = join(at, part);
    const s = await lstat(at).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (s && (!s.isDirectory() || s.isSymbolicLink())) refuse(`migration parent is not a real directory: ${relative(root, at)}`);
  }
}
async function snapshot(root, path) {
  await safeParents(root, path);
  const full = join(root, path), s = await lstat(full).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!s) return null;
  if (s.isSymbolicLink()) {
    const target = await readlink(full), dest = relative(root, resolve(dirname(full), target));
    if (!inside(dest)) refuse(`migration link escapes project: ${path}`);
    return { kind: 'link', data: target, mode: s.mode & 0o777 };
  }
  if (!s.isFile() || s.size > MAX_FILE) refuse(`unsupported or oversized migration file: ${path}`);
  return { kind: 'file', data: (await readFile(full)).toString('base64'), mode: s.mode & 0o777 };
}
const bytes = state => state.kind === 'link' ? state.data : Buffer.from(state.data, 'base64');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const textState = (state, text) => ({ ...state, data: Buffer.from(text).toString('base64') });
function decoded(state) {
  if (state.kind === 'link') return state.data;
  const raw = bytes(state), value = raw.toString('utf8');
  return raw.includes(0) || !Buffer.from(value).equals(raw) ? null : value;
}
async function metadata(root) {
  const top = await realpath(git(root, 'rev-parse', '--show-toplevel').trim());
  if (top !== root) refuse('migration requires the repository root');
  return resolve(root, git(root, 'rev-parse', '--git-path', 'plates-rename').trim());
}
const MAX_EXCLUDE = 1024 * 1024;
async function excludeLocation(root) {
  const common = await realpath(resolve(root, git(root, 'rev-parse', '--git-common-dir').trim()));
  const path = resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude').trim());
  if (path !== join(common, 'info/exclude')) refuse('unexpected Git exclude location');
  const info = await lstat(dirname(path)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (info && (!info.isDirectory() || info.isSymbolicLink())) refuse('unsafe Git exclude directory');
  return path;
}
async function excludeSnapshot(root) {
  const path = await excludeLocation(root);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_EXCLUDE) refuse('unsafe or oversized Git exclude file');
    const data = await handle.readFile();
    if (data.length > MAX_EXCLUDE) refuse('oversized Git exclude file');
    return { kind: 'file', data: data.toString('base64'), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') refuse('unsafe Git exclude file: symlink');
    throw error;
  } finally { await handle?.close(); }
}
function ignoredPaths(root, paths, verbose = false) {
  if (!paths.length) return new Set();
  try {
    const out = execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, 'check-ignore', '--no-index', '-z', '--stdin', ...(verbose ? ['--verbose'] : [])], { encoding: 'utf8', input: paths.join('\0') + '\0', maxBuffer: 16 * 1024 * 1024 });
    if (verbose) {
      const fields = out.split('\0'), negatives = new Set();
      for (let i = 0; i + 3 < fields.length; i += 4) if (fields[i + 2].startsWith('!')) negatives.add(fields[i + 3]);
      return negatives;
    }
    return new Set(out.split('\0').filter(Boolean));
  } catch (error) { if (error.status === 1) return new Set(); throw error; }
}
const literalIgnore = path => '/' + path.replace(/[\\*?\[\]#! ]/g, '\\$&');
async function privacyPlan(root, runtime, tracked, mapping, before) {
  const sources = [...ignoredPaths(root, runtime.files.filter(path => !tracked.has(path)))];
  if (!sources.length) return null;
  if (sources.some(path => /[\r\n]/.test(path))) refuse('ignored runtime name cannot be represented safely in Git excludes');
  // Keep a wholly ignored, untracked subtree private, including its future
  // records. Otherwise add only exact existing file paths, never a broad glob.
  const dirs = runtime.directories.filter(dir => dir !== OLD && ![...tracked].some(path => path.startsWith(dir + '/')));
  const ignoredDirs = ignoredPaths(root, dirs.map(dir => dir + '/'));
  const patterns = new Set(), targets = sources.map(path => mapping.get(path));
  for (const path of sources) {
    const dir = dirs.find(dir => path.startsWith(dir + '/') && ignoredDirs.has(dir + '/'));
    patterns.add(literalIgnore(dir ? dir + '/' : path));
    patterns.add(literalIgnore(dir ? NEW + dir.slice(OLD.length) + '/' : mapping.get(path)));
    if (!dir && path.endsWith('/.gitignore') && /^!/m.test(await readFile(join(root, path), 'utf8'))) refuse('private runtime ignore file has conflicting negations');
  }
  if (ignoredPaths(root, targets, true).size) refuse('Git ignore rules conflict with private runtime targets');
  const original = before ? bytes(before) : Buffer.alloc(0);
  const added = Buffer.from(`${original.length && original.at(-1) !== 10 ? '\n' : ''}${[...patterns].sort().join('\n')}\n`);
  const data = Buffer.concat([original, added]);
  if (data.length > MAX_EXCLUDE) refuse('Git exclude update exceeds migration bound');
  return { before, after: { kind: 'file', data: data.toString('base64'), mode: before?.mode ?? 0o600 }, targets, patterns: [...patterns].sort() };
}
async function protectRuntime(root, dir, privacy, targets = privacy?.targets) {
  if (!privacy) return;
  const target = await excludeLocation(root), current = await excludeSnapshot(root);
  if (!equal(current, privacy.after)) {
    if (!equal(current, privacy.before)) refuse('Git exclude changed since migration preview; private runtime was not moved');
    const stage = join(dir, 'exclude-after');
    const staged = await lstat(stage).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (staged) {
      if (!staged.isFile() || staged.isSymbolicLink() || staged.nlink !== 1 || !(await readFile(stage)).equals(bytes(privacy.after))) refuse('unsafe migration exclude staging file');
    } else await writeFile(stage, bytes(privacy.after), { flag: 'wx', mode: privacy.after.mode });
    await chmod(stage, privacy.after.mode);
    await mkdir(dirname(target), { recursive: true });
    await excludeLocation(root);
    if (!equal(await excludeSnapshot(root), privacy.before)) refuse('Git exclude changed before publication');
    await rename(stage, target); // Atomic: the old exclusion rules never disappear.
  }
  const ignored = ignoredPaths(root, targets);
  if (targets.some(path => !ignored.has(path))) refuse('Git ignore rules conflict with private runtime targets; no private bytes will move');
}
async function runtimeInventory(root, dir = OLD, result = [], directories = [], directoryModes = []) {
  const full = join(root, dir), s = await lstat(full).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!s) return { files: result, directories, directoryModes };
  if (!s.isDirectory() || s.isSymbolicLink()) refuse(`runtime root is not a real directory: ${dir}`);
  directories.push(dir);
  directoryModes.push({ from: dir, to: NEW + dir.slice(OLD.length), mode: s.mode & 0o7777, uid: s.uid, gid: s.gid });
  if (directories.length > MAX_FILES) refuse('migration directory limit reached');
  for (const item of await readdir(full, { withFileTypes: true })) {
    const path = `${dir}/${item.name}`;
    // Any writer lock, even stale, needs its owner's recovery procedure first.
    if (/\.lock$/.test(item.name)) refuse(`runtime writer lock must be resolved before migration: ${path}`);
    if (item.isDirectory()) await runtimeInventory(root, path, result, directories, directoryModes);
    else result.push(path);
    if (result.length > MAX_FILES) refuse('migration file limit reached');
  }
  return { files: result, directories, directoryModes };
}
// Unlike file modes, directory modes govern every private record below them.
// Preserve even empty directories; never repair an existing destination with
// chmod, since it may have changed after the owner reviewed this migration.
async function runtimeDirectories(root, entries, { create = false } = {}) {
  for (const entry of entries) {
    const { from, to, mode, uid, gid } = entry;
    if (!inside(from) || !(from === OLD || from.startsWith(`${OLD}/`)) || to !== NEW + from.slice(OLD.length) || !Number.isInteger(mode) || mode < 0 || mode > 0o7777 || !Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) refuse('invalid runtime directory evidence');
    await safeParents(root, from); await safeParents(root, to);
    const source = await lstat(join(root, from)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    const target = await lstat(join(root, to)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    for (const [path, state] of [[from, source], [to, target]]) {
      if (state && (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o7777) !== mode || state.uid !== uid || state.gid !== gid)) refuse(`runtime directory changed since preview: ${path}`);
    }
    if (!target && (!create || !source)) refuse(`runtime directory changed since preview: ${to}`);
  }
  if (!create) return;
  for (const { to, mode, uid, gid } of [...entries].sort((a, b) => a.to.length - b.to.length)) {
    const target = join(root, to);
    if (await exists(target)) continue;
    await safeParents(root, to);
    await mkdir(target, { mode }); // Non-recursive: every ancestor has reviewed modes.
    // A restrictive umask may remove permissions. Only our newly created
    // directory may be restored to the reviewed mode, via a no-follow handle.
    const handle = await open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const created = await handle.stat();
      if (created.uid !== uid || created.gid !== gid) refuse(`runtime directory ownership cannot be preserved automatically: ${to}; no private bytes were published`);
      if ((created.mode & 0o7777) !== mode) await handle.chmod(mode);
    }
    finally { await handle.close(); }
  }
  await runtimeDirectories(root, entries);
}
function activeCommandSource(path, source) {
  return /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path) || /\.(?:sh|bash|zsh|dash|ksh|fish|ps1|psm1|cmd|bat)$/i.test(path) || /^#![^\n]*\b(?:sh|bash|zsh|dash|ksh|fish|pwsh|powershell)\b/.test(source)
    || /(?:^|\/)\.(?:bashrc|bash_profile|zshrc|zprofile|profile)$/.test(path);
}
function blockBody(text, id, brand) {
  const begin = `<!-- ${brand}:begin ${id} -->`, end = `<!-- ${brand}:end ${id} -->`;
  const b = text.indexOf(begin), e = text.indexOf(end), start = text.indexOf('\n', b) + 1;
  if (b < 0 || e < start || !start || text.indexOf(begin, b + 1) !== -1) return null;
  return text.slice(start, e);
}
async function migrateLinks(root, original, updated, mapping, runtime) {
  // Targets are filesystem references, not branding text. In particular the
  // checkout root and opaque receipt filenames are not renamed by this plan.
  const directories = new Map(runtime.directoryModes.map(row => [row.from, row.to]));
  const remember = (from, to) => {
    if (directories.has(from) && directories.get(from) !== to) directories.set(from, null);
    else directories.set(from, to);
  };
  for (const [from, to] of mapping) {
    let before = dirname(from), after = dirname(to);
    while (before !== '.' && after !== '.') {
      remember(before, after);
      before = dirname(before); after = dirname(after);
    }
  }
  const checked = new Set();
  let visited = 0;
  const checkDirectory = async (from, to) => {
    if (checked.has(from)) return;
    // A directory link cannot silently lose untracked/unmoved children. Only
    // translate it when the inventory moves its complete tree consistently.
    for (const entry of await readdir(join(root, from), { withFileTypes: true })) {
      if (++visited > MAX_FILES) refuse('migration link inventory limit reached');
      const child = join(from, entry.name);
      if (entry.isDirectory()) {
        const next = directories.get(child);
        if (!next || dirname(next) !== to) refuse(`ambiguous migration directory link target: ${from}`);
        await checkDirectory(child, next);
      } else if (dirname(mapping.get(child) ?? child) !== to) {
        refuse(`ambiguous migration directory link target: ${from}`);
      }
    }
    checked.add(from);
  };
  for (const [from, state] of original) {
    if (state.kind !== 'link') continue;
    const target = relative(root, resolve(dirname(join(root, from)), state.data));
    if (!inside(target)) refuse(`migration link escapes project: ${from}`);
    await safeParents(root, target);
    let nextTarget = mapping.get(target) ?? target;
    if (!mapping.has(target) && directories.has(target)) {
      nextTarget = directories.get(target);
      if (nextTarget === null) refuse(`ambiguous migration directory link target: ${target}`);
      if (nextTarget !== target) await checkDirectory(target, nextTarget);
    }
    const destination = join(root, nextTarget), linkParent = dirname(join(root, mapping.get(from)));
    // Preserve spelling (including ./) when it already refers to the intended
    // destination; otherwise preserve whether the caller chose an absolute link.
    const data = resolve(linkParent, state.data) === destination ? state.data
      : isAbsolute(state.data) ? destination : relative(linkParent, destination);
    updated.set(from, { ...state, data });
  }
}
async function buildPlan(root) {
  if (!await exists(join(root, CONFIG))) {
    if (await exists(join(root, NEXT_CONFIG)) && !await exists(join(root, OLD))) return { version: 1, root, state: 'already-migrated', operations: [], directories: [], digest: hash('already-migrated') };
    refuse('expected .keel/keel.json; refusing an ambiguous or unconfigured project');
  }
  if (await exists(join(root, NEW))) refuse('.plates already exists; inspect conflicting roots before migration');
  const excludeBefore = await excludeSnapshot(root);
  const tracked = git(root, 'ls-files', '-z').split('\0').filter(Boolean);
  const trackedSet = new Set(tracked);
  // git grep does not search symlink blobs; unchanged-name links may still
  // point at a moved file or directory and must participate in the inventory.
  const trackedLinks = git(root, 'ls-files', '--stage', '-z').split('\0')
    .filter(entry => entry.startsWith('120000 ')).map(entry => entry.slice(entry.indexOf('\t') + 1));
  const runtime = await runtimeInventory(root);
  let matching;
  try { matching = git(root, 'grep', '-I', '-i', '-l', '-z', '-E', 'keel|fleet\\.json', '--', '.').split('\0').filter(Boolean); }
  catch (error) { if (error.status !== 1) throw error; matching = []; }
  const oldLock = await readFile(join(root, '.keel/lock.json'), 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  const lockedPaths = oldLock ? Object.keys(JSON.parse(oldLock).files ?? {}).map(key => key.split('#')[0]) : [];
  const paths = [...new Set([...matching, ...trackedLinks, ...tracked.filter(path => renamePath(path) !== path || manifestPath(path) || typeScriptConfig(path) || npmLockPath(path) || otherLockPath(path) || /\.[cm]?[jt]sx?$/.test(path)), ...lockedPaths, ...runtime.files])].sort();
  const mapping = new Map(paths.map(path => [path, path.startsWith(`${OLD}/`) ? `${NEW}/${path.slice(OLD.length + 1)}` : renamePath(path)]));
  mapping.set(CONFIG, NEXT_CONFIG);
  const original = new Map(), updated = new Map();
  let total = 0;
  for (const path of paths) {
    if (!inside(path)) refuse(`unsafe tracked path: ${path}`);
    const state = await snapshot(root, path);
    if (!state) continue; // Unrelated missing tracked files remain the owner's work.
    total += bytes(state).length;
    if (total > MAX_TOTAL) refuse('migration byte limit reached');
    original.set(path, state);
  }
  const existingMapping = new Map([...mapping].filter(([path]) => original.has(path)));
  const identity = JSON.parse(decoded(original.get(CONFIG)));
  const sourcePackage = original.get('package.json');
  const self = identity.keel === 'self' && identity.repo === 'dalmaer/keel'
    && sourcePackage && JSON.parse(decoded(sourcePackage)).name === 'keel';
  const fullFileLocks = oldLock ? JSON.parse(oldLock).files ?? {} : {};
  const environmentKeys = [...Object.keys(identity.env ?? {}), ...(Array.isArray(identity.tests?.configEnv) ? identity.tests.configEnv : [])];
  for (const [path, state] of original) {
    const moduleSource = /\.[cm]?[jt]sx?$/.test(path);
    // A partial block or merely listed path does not establish file ownership.
    const managedSource = fullFileLocks[path]?.sha256 === hash(bytes(state));
    const preserveRuntime = moduleSource && !self && !managedSource;
    const activeText = source => {
      try { return renameActiveText(source, { moduleReference: moduleReferenceFor(path, existingMapping, original), moduleSource, preserveRuntime, environmentKeys }); }
      catch (error) { if (error instanceof RenameError) error.message = `${path}: ${error.message}`; throw error; }
    };
    let next = state;
    const runtimeData = path.startsWith(`${OLD}/`) && ![CONFIG, '.keel/lock.json'].includes(path);
    const source = decoded(state);
    if (source === null && (npmLockPath(path) || otherLockPath(path))) {
      const sibling = path.slice(0, path.lastIndexOf('/') + 1) + 'package.json';
      const manifestState = trackedSet.has(sibling) ? await snapshot(root, sibling) : null;
      const manifest = manifestState ? decoded(manifestState) : null;
      if (manifest && PACKAGE_FIELDS.some(field => productSpec(JSON.parse(manifest)?.[field]?.keel))) refuse(`unsupported opaque product dependency lock: ${path}`);
    }
    if (!runtimeData && source !== null) {
      if (state.kind === 'link') next = state; // Resolve after the complete inventory is available.
      else if (path === CONFIG) {
        // Configuration is mapped after all existing sources are inventoried.
        next = state;
      } else if (manifestPath(path)) {
        next = textState(state, await migratePackage(source, existingMapping, root, path, self));
      } else if (npmLockPath(path) || otherLockPath(path)) {
        const sibling = path.slice(0, path.lastIndexOf('/') + 1) + 'package.json';
        const manifestState = trackedSet.has(sibling) ? await snapshot(root, sibling) : null;
        const manifest = manifestState ? decoded(manifestState) : null;
        if (npmLockPath(path)) next = textState(state, migrateNpmLock(source, manifest, manifest ? await migratePackage(manifest, existingMapping, root, sibling, self) : null));
        else if (oldProduct.test(source) || manifest && PACKAGE_FIELDS.some(field => productSpec(JSON.parse(manifest)?.[field]?.keel))) refuse(`unsupported product dependency lock: ${path}`);
        // Unrelated lockfiles are opaque consumer records, never prose to rename.
      } else if (/(?:^|\/)\.gitignore$/.test(path)) {
        next = textState(state, migrateIgnore(source, path));
      } else if (typeScriptConfig(path, source) && !historical(path, source)) {
        next = textState(state, migrateTypeScriptConfig(source, path, existingMapping));
      } else if (path !== '.keel/lock.json') {
        if (!historical(path, source) && activeCommandSource(path, source)) {
          // Full-line comments are inactive history. Other workflow/shell
          // fields can supply commands indirectly, so refuse ambiguous pins
          // rather than guessing an upgrade or rewriting a pinned executable.
          refuseLegacyProductPins(source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n'));
        }
        let nextText;
        if (historical(path, source)) nextText = workingLinks(source, mapping);
        else if (path.startsWith('docs/phases/') && source.includes('\n## Trajectory')) {
          const at = source.indexOf('\n## Trajectory');
          nextText = activeText(source.slice(0, at)) + workingLinks(source.slice(at), mapping);
        } else if (historyReader(path)) nextText = await migrateHistoryReader(path, source);
        else if (path.endsWith('scripts/keel/night-plan.mjs')) nextText = migrateNightPlanSource(activeText(source));
        else if (path.endsWith('scripts/keel/morning.mjs')) nextText = activeText(source).replace('import { PLAN, PLAN_BRANCH,', 'import { PLAN, PLAN_BRANCH, REMOTE_PLAN,').replace('await at(`${PLAN_BRANCH}:${PLAN}`, () => remoteFile(root, PLAN_BRANCH, PLAN), PLAN_BRANCH);', 'await at(`${PLAN_BRANCH}:${REMOTE_PLAN}`, () => remoteFile(root, PLAN_BRANCH, REMOTE_PLAN), PLAN_BRANCH);');
        else nextText = activeText(source);
        // The new workflow produces the canonical per-attempt artifact; readers
        // above retain immutable old names only for old workflow provenance.
        if (/(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) {
          nextText = nextText.replace(/^(\s*name:\s*['"]?)keel-production-(\$\{\{\s*github\.run_attempt\s*\}\}['"]?\s*)$/gm, '$1plates-production-$2');
          if (/^\s*name:\s*['"]?keel-production-/m.test(nextText)) refuse(`production artifact writer ${path} needs an explicit compatibility upgrade before migration`);
        }
        if (preserveRuntime && machineConfiguration(path)) checkStructuredMigration(path, source, renameActiveText(source), self);
        checkStructuredMigration(path, source, nextText, self);
        if (Object.hasOwn(fullFileLocks, path) && !managedSource && (source !== nextText || renamePath(path) !== path))
          refuse(`managed file drift must be resolved before migration: ${path}`);
        // Textual module recognition is not a JavaScript parser. Unowned
        // executable source must remain byte-exact; even a seemingly definite
        // import can be quoted data. Prepare its references explicitly first.
        if (preserveRuntime && (source !== nextText || renamePath(path) !== path))
          refuse(`${path}: affected unowned executable source needs an explicit migration`);
        if (!self && !managedSource && !historical(path, source) && activeCommandSource(path, source)
          && (source !== nextText || renamePath(path) !== path))
          refuse(`${path}: affected unowned automation needs an explicit migration`);
        // The generic branch is for prose, not an implicit translator for every
        // programming/configuration language. Established schemas have their
        // own checks above; owner-defined machine interfaces need manual prep.
        if (!self && !managedSource && (source !== nextText || renamePath(path) !== path) && !proseFile(path)
          && !machineConfiguration(path) && !/(?:^|\/)\.gitignore$/.test(path))
          refuse(`${path}: affected unowned machine file needs an explicit migration`);
        next = textState(state, nextText);
      }
    }
    updated.set(path, next);
  }
  const configState = original.get(CONFIG);
  await migrateLinks(root, original, updated, existingMapping, runtime);
  updated.set(CONFIG, textState(configState, json(migrateConfig(JSON.parse(decoded(configState)), existingMapping, self))));
  if (original.has('.keel/lock.json')) {
    const state = original.get('.keel/lock.json'), lock = JSON.parse(decoded(state));
    if (!lock || !lock.files || typeof lock.files !== 'object' || Array.isArray(lock.files)) refuse('invalid managed-file lock');
    const files = {};
    for (const [key, row] of Object.entries(lock.files)) {
      const [path, block] = key.split('#'), before = original.get(path), after = updated.get(path);
      const target = mapping.get(path) ?? renamePath(path), nextKey = block ? `${target}#${block}` : target;
      if (files[nextKey]) refuse(`managed lock collision: ${nextKey}`);
      if (!before) {
        if (target !== path) refuse(`managed migration source is missing: ${path}`);
        files[nextKey] = row; continue;
      }
      const oldBytes = block ? blockBody(decoded(before) ?? '', block, 'keel') : bytes(before);
      const newBytes = block ? blockBody(decoded(after) ?? '', block, 'plates') : bytes(after);
      const changed = target !== path || !equal(before, after);
      if (changed && (oldBytes === null || hash(oldBytes) !== row.sha256)) refuse(`managed file drift must be resolved before migration: ${key}`);
      if (changed && newBytes === null) refuse(`managed block did not survive migration: ${key}`);
      files[nextKey] = changed ? { ...row, sha256: hash(newBytes) } : row;
    }
    updated.set('.keel/lock.json', textState(state, json({ ...lock, files })));
  }
  const operations = [];
  for (const [from, before] of original) {
    const to = mapping.get(from), after = updated.get(from);
    if (from === to && equal(before, after)) continue;
    await safeParents(root, to);
    if (from !== to && await exists(join(root, to))) refuse(`migration destination exists: ${to}`);
    if (operations.some(op => op.to.toLowerCase() === to.toLowerCase())) refuse(`migration destination collision: ${to}`);
    operations.push({ from, to, before, after, tracked: trackedSet.has(from) });
  }
  // Publish the new config only after its dependencies; never run both schedules.
  operations.sort((a, b) => Number(a.from === CONFIG) - Number(b.from === CONFIG) || a.from.localeCompare(b.from));
  const directories = new Set(runtime.directories);
  for (const op of operations) {
    let dir = dirname(op.from);
    while (dir !== '.' && renamePath(dir) !== dir) { directories.add(dir); dir = dirname(dir); }
  }
  const privacy = await privacyPlan(root, runtime, trackedSet, mapping, excludeBefore);
  // Gitignore changes precede private data, then the new config publishes last.
  operations.sort((a, b) => Number(a.from === CONFIG) - Number(b.from === CONFIG) || Number(!a.from.endsWith('.gitignore')) - Number(!b.from.endsWith('.gitignore')) || a.from.localeCompare(b.from));
  const plan = { version: 1, root, state: 'planned', operations, directories: [...directories], runtimeDirectories: runtime.directoryModes, privacy };
  return { ...plan, digest: hash(JSON.stringify(plan)) };
}
function publicPlan(plan, state = plan.state) {
  return { version: 1, root: plan.root, state, digest: plan.digest, runtimeDirectories: plan.runtimeDirectories ?? [], files: plan.operations.map(op => ({ from: op.from, to: op.to, kind: op.before.kind, tracked: op.tracked, before: hash(bytes(op.before)), after: hash(bytes(op.after)) })), preservedRuntime: plan.operations.filter(op => op.from.startsWith(`${OLD}/`) && equal(op.before, op.after)).length, privacy: plan.privacy ? { target: 'Git info/exclude', paths: plan.privacy.targets, patterns: plan.privacy.patterns, before: plan.privacy.before ? hash(bytes(plan.privacy.before)) : null, after: hash(bytes(plan.privacy.after)) } : null };
}
async function receiptAt(dir) {
  try { return JSON.parse(await readFile(join(dir, 'receipt.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function validReceipt(receipt, root) {
  if (receipt.version !== 1 || receipt.root !== root || receipt.plan?.root !== root || !Array.isArray(receipt.finished)) refuse('migration receipt identity mismatch');
  const { digest, ...plan } = receipt.plan;
  if (hash(JSON.stringify(plan)) !== digest) refuse('migration receipt digest mismatch');
}
async function saveReceipt(dir, receipt) {
  const path = join(dir, `receipt-${randomUUID()}.tmp`);
  await writeFile(path, json(receipt), { mode: 0o600, flag: 'wx' });
  await rename(path, join(dir, 'receipt.json'));
}
export async function planRename(from) {
  const root = await realpath(resolve(from)), dir = await metadata(root), receipt = await receiptAt(dir);
  if (receipt && receipt.state !== 'completed') {
    validReceipt(receipt, root);
    return publicPlan(receipt.plan, 'recovery-required');
  }
  return publicPlan(await buildPlan(root));
}
async function lockMigration(dir) {
  const prior = await lstat(dir).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (prior && (!prior.isDirectory() || prior.isSymbolicLink())) refuse('migration journal directory is unsafe');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'writer.json');
  try { await writeFile(path, json({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner; try { owner = JSON.parse(await readFile(path, 'utf8')); } catch { refuse('migration writer ownership unavailable'); }
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) refuse('migration writer ownership unavailable');
    try { process.kill(owner.pid, 0); refuse('migration is already active'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    await unlink(path);
    await writeFile(path, json({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 });
  }
  return () => unlink(path);
}
async function place(path, state) {
  if (state.kind === 'link') await symlink(state.data, path);
  else await writeFile(path, bytes(state), { flag: 'wx', mode: state.mode });
}
/** Low-level transaction/recovery API. User-facing callers use migrateRename.
 * afterBackup/afterOperation are injectable process-crash boundaries for tests. */
export async function applyRename(from, { digest, afterBackup, afterOperation } = {}) {
  const root = await realpath(resolve(from)), dir = await metadata(root), release = await lockMigration(dir);
  try {
    let receipt = await receiptAt(dir);
    if (!receipt || receipt.state === 'completed') {
      const plan = await buildPlan(root);
      if (plan.state === 'already-migrated') return publicPlan(plan);
      if (digest && digest !== plan.digest) refuse('migration preview changed; inspect a fresh plan');
      receipt = { version: 1, root, state: 'applying', plan, finished: [] };
      await saveReceipt(dir, receipt);
    } else {
      validReceipt(receipt, root);
      if (digest && digest !== receipt.plan.digest) refuse('recovery must use the original migration preview');
    }
    if (!Object.hasOwn(receipt.plan, 'privacy')) refuse('legacy migration receipt needs a privacy review before recovery');
    if (!Array.isArray(receipt.plan.runtimeDirectories)) refuse('legacy migration receipt needs a directory mode review before recovery');
    await protectRuntime(root, dir, receipt.plan.privacy);
    await runtimeDirectories(root, receipt.plan.runtimeDirectories, { create: !receipt.runtimePrepared });
    if (!receipt.runtimePrepared) { receipt.runtimePrepared = true; await saveReceipt(dir, receipt); }
    for (const [index, op] of receipt.plan.operations.entries()) {
      // Recheck after ignore-file edits and on every recovery boundary.
      if (receipt.plan.privacy?.targets.includes(op.to)) await protectRuntime(root, dir, receipt.plan.privacy, [op.to]);
      await safeParents(root, op.from); await safeParents(root, op.to);
      const parents = receipt.plan.runtimeDirectories.filter(entry => op.to.startsWith(`${entry.to}/`));
      await runtimeDirectories(root, parents);
      const source = join(root, op.from), target = join(root, op.to), backup = join(dir, `before-${index}`), stage = join(dir, `after-${index}`);
      const current = await snapshot(root, op.to);
      if (equal(current, op.after) && (op.from === op.to || !await exists(source))) {
        if (!receipt.finished.includes(index)) { receipt.finished.push(index); await saveReceipt(dir, receipt); }
        continue;
      }
      if (receipt.finished.includes(index)) refuse(`migrated file changed before recovery: ${op.to}`);
      if (op.from !== op.to && current) refuse(`migration target changed: ${op.to}`);
      const original = await snapshot(root, op.from);
      if (!await exists(backup)) {
        if (!equal(original, op.before)) refuse(`migration source changed: ${op.from}`);
        if (await exists(stage)) await unlink(stage);
        await place(stage, op.after);
        if (!parents.length) await mkdir(dirname(target), { recursive: true });
        // Removing the old schedule before installing the new one prevents two
        // workflow filenames from being active in the same completed tree.
        await rename(source, backup);
        if (afterBackup) await afterBackup(index);
      } else {
        const saved = await lstat(backup);
        if (!saved.isFile() && !saved.isSymbolicLink()) refuse('invalid migration backup');
        if (original) refuse(`migration source reappeared: ${op.from}`);
        if (!await exists(stage)) await place(stage, op.after);
      }
      await runtimeDirectories(root, parents);
      // Publish bytes and permissions together, including a staged recovery.
      if (op.after.kind === 'file') await chmod(stage, op.after.mode);
      await rename(stage, target);
      receipt.finished.push(index); await saveReceipt(dir, receipt);
      if (op.to.endsWith('.gitignore')) await protectRuntime(root, dir, receipt.plan.privacy);
      if (afterOperation) await afterOperation(index);
    }
    await runtimeDirectories(root, receipt.plan.runtimeDirectories);
    for (const path of [...receipt.plan.directories].sort((a, b) => b.length - a.length)) {
      try { await rmdir(join(root, path)); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        if (!path.startsWith(OLD) && error.code === 'ENOTEMPTY') continue; // Never remove unrelated untracked work.
        refuse(`runtime changed during migration; inspect ${path} before recovery`);
      }
    }
    receipt.state = 'completed'; await saveReceipt(dir, receipt);
    return publicPlan(receipt.plan, 'completed');
  } finally { await release(); }
}
function validateRenameApproval(yes, digest) {
  if (typeof yes !== 'boolean') refuse('migration approval must be a boolean');
  if (yes !== (digest !== undefined)) refuse('--yes and --digest must be supplied together after reviewing the preview');
  if (digest !== undefined && (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) refuse('--digest needs the exact lowercase SHA-256 preview digest');
}
/** Shared user-facing syntax; validate before resolving or reading the root. */
export function parseRenameArgs(args) {
  for (const flag of ['--yes', '--digest', '--json']) {
    if (args.filter(arg => arg === flag).length > 1) refuse(`${flag} must appear once`);
  }
  let root, yes = false, digest;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes') yes = true;
    else if (arg === '--json') continue;
    else if (arg === '--digest') {
      digest = args[++i];
      if (digest === undefined) refuse('--digest needs the exact lowercase SHA-256 preview digest');
    } else if (!arg.startsWith('-') && root === undefined) root = arg;
    else refuse('usage: plates migrate [project-root] [--yes --digest <preview-digest>] [--json]');
  }
  validateRenameApproval(yes, digest);
  return { root: root ?? '.', yes, digest };
}
export async function migrateRename(options = {}) {
  const { yes = false, digest } = options;
  validateRenameApproval(yes, digest);
  const { root } = options;
  const result = yes ? await applyRename(root, { digest }) : await planRename(root);
  return { data: result, text: `${result.state}: ${result.files.length} file changes${yes ? '' : '; apply this reviewed plan with --yes --digest ' + result.digest}`, exitCode: !yes && result.state !== 'already-migrated' ? 3 : 0 };
}
