#!/usr/bin/env node
// A stand-in for the stitch CLI, at the process boundary (keel phase 14). It
// answers in the envelope both ledger's and isocan's loop scripts parse from
// `stitch … --format json -q`: {"success": true, "data": …}, or
// {"success": false, "error": {"code", "message"}} with a non-zero exit.
// State comes from the JSON file STITCH_STUB_STATE; every call is appended to
// STITCH_STUB_LOG as {args, includeDismissed}. Synthetic: Acme only.
import { readFileSync, appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.STITCH_STUB_STATE, 'utf8'));
appendFileSync(process.env.STITCH_STUB_LOG, `${JSON.stringify({ args, includeDismissed: process.env.LOOP_INCLUDE_DISMISSED ?? null })}\n`);
const say = body => process.stdout.write(JSON.stringify(body));
const ok = data => say({ success: true, data });
const fail = (code, message) => { say({ success: false, error: { code, message } }); process.exitCode = 1; };
const flag = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };

if (state.error) fail(state.error.code ?? 'UNAVAILABLE', state.error.message);
else {
  const [verb, noun, id] = args;
  switch (`${verb} ${noun}`) {
    case 'find insights': ok({ items: state.insights ?? [], nextPageToken: null }); break;
    case 'find priorities': ok({ items: state.priorities ?? [] }); break;
    case 'find contexts': ok({ items: (state.contexts ?? []).map(({ data, ...c }) => c) }); break;
    case 'get context': {
      const c = (state.contexts ?? []).find(x => x.id === id);
      if (c) ok(c); else fail('NOT_FOUND', `context ${id} not found`);
      break;
    }
    case 'delete context': ok({}); break;
    case 'create context': ok({ name: `workspaces/${flag('-w')}/contexts/ctx-new`, ...JSON.parse(flag('--json')).body }); break;
    case 'generate insights': ok({ state: 'RUNNING', priority: flag('--priority') }); break;
    default:
      if (verb === 'dismiss') {
        const payload = JSON.parse(flag('--json'));
        ok({ succeeded: payload.ids, failed: [] });
      } else fail('INVALID_ARGUMENT', `unknown command: ${args.join(' ')}`);
  }
}
// Like stitch, exit at once rather than wait for stdout to drain: written to a
// pipe, a large answer is cut off (on macOS, where a pipe is asynchronous); to
// a file, it is whole.
process.exit(process.exitCode ?? 0);
