import cliData from './capability-cli-data.mjs';
import routineData from './capability-routine-data.mjs';
import { numeric, projectId as validProjectId, WebError } from './common.mjs';

const inspectionReason = 'Inspection is available. Source completeness and current action eligibility are checked by the destination; this catalogue has made no source or provider probe.';
const sourceReason = 'Instance prerequisites are present, but current source, user permission, policy, budget and reviewed intent still require the domain adapter. No action is authorized here.';

// These are existing task destinations, not executable command registrations.
const tasks = [
  ['home', 'See what needs you', 'Overview', 'read', 'both', 'native', 'home', '/', null],
  ['activity', 'Investigate recorded runs', 'Routines', 'read', 'both', 'native', 'run-history', '/activity', null],
  ['routines', 'Inspect routines and coverage', 'Routines', 'read', 'both', 'native', 'run-history', '/routines', null],
  ['changes', 'Explore recent changes', 'Review', 'read', 'project', 'native', 'changes', '/changes', null],
  ['walks', 'Test a change step by step', 'Review', 'private-write', 'project', 'native', 'guided-walk', '/walks', null],
  ['acceptance', 'Review guided acceptance', 'Review', 'repository-write', 'project', 'native', 'guided-walk', '/walks', 'decision'],
  ['decisions', 'Answer a supported decision', 'Review', 'repository-write', 'project', 'native', 'decisions', '/', 'decision'],
  ['captures', 'Attach a private screenshot', 'Review', 'private-write', 'project', 'native', 'media', '/changes', 'media'],
  ['daily', 'Inspect the day and save an evening draft', 'Planning', 'private-write', 'project', 'native', 'daily', '/daily', null],
  ['night-publication', 'Publish a reviewed night plan', 'Planning', 'repository-write', 'project', 'native', 'night-plan-v1', '/daily', 'night-plan'],
  ['night-retry', 'Review a failed night retry', 'Routines', 'job', 'project', 'native', 'night-rerun-v1', '/activity', 'night-retry'],
  ['learning', 'Explore private shared lessons', 'Learning', 'read', 'both', 'native', 'learning', '/learning', null],
  ['learning-copy', 'Review a lesson migration', 'Learning', 'repository-write', 'project', 'native', 'learning', '/learning', 'workspace'],
  ['versions', 'Compare source versions', 'Updates', 'read', 'both', 'native', 'fleet-updates', '/versions', null],
  ['prepare-update', 'Prepare a supported project update', 'Updates', 'job', 'project', 'worker', 'update-preparation-v1', '/versions', 'updates'],
  ['publish-update', 'Review an update pull request', 'Updates', 'external-write', 'project', 'native', 'fleet-publication', '/versions', 'publication'],
  ['typecheck', 'Run a registered typecheck', 'Routines', 'job', 'project', 'worker', 'typecheck-v1', '/jobs', 'jobs'],
  ['schedule', 'Review a supported typecheck schedule', 'Routines', 'repository-write', 'project', 'native', 'typecheck-schedule-v1', '/routines', 'schedule'],
  ['connections', 'Inspect connections and capacity gaps', 'Connections', 'read', 'both', 'native', 'connections', '/connections', null],
  ['credentials', 'Manage an approved API connection', 'Connections', 'private-write', 'both', 'native', 'connections', '/connections', 'connections'],
  ['connection-policy', 'Review connection policy', 'Connections', 'repository-write', 'both', 'native', 'connection-policy', '/connections', 'workspace'],
  ['model-policy', 'Inspect model policy', 'Models', 'read', 'both', 'native', 'model-policy', '/model-policy', null],
  ['model-policy-write', 'Review model policy changes', 'Models', 'repository-write', 'both', 'native', 'model-policy', '/model-policy', 'workspace'],
  ['model-task', 'Prepare an evidence brief', 'Models', 'job', 'project', 'worker', 'evidence-brief-v1', '/model-tasks', 'models'],
  ['setup', 'Inspect workspace setup', 'Setup', 'read', 'fleet', 'native', 'setup', '/setup', null],
];

const limitationByTask = {
  home: 'Bounded source observations, not a complete local-checkout audit.',
  activity: 'History records observation coverage; an Actions success is not phase acceptance.',
  routines: 'A listed routine is not necessarily executable from this workspace.',
  changes: 'Authored change packages are source declarations; preview links do not prove a serving revision.',
  walks: 'Only authored, supported guided walks. Unsaved browser edits are not durable storage.',
  acceptance: 'Exact supported phase/evidence changes only; source-bound observation and fresh reviewed preview required.',
  decisions: 'Supported health proposals and unanswered shaping questions only; not arbitrary decision records.',
  captures: 'Private bounded image capture; no public publication or proof of serving revision.',
  daily: 'A saved private evening draft is not night authorization or publication. Review publication separately.',
  'night-publication': 'Existing canonical plan branch only; supported measure and triage edits preserve recorded progress. Exact public visibility approval is separate. Publication does not start a night.',
  'night-retry': 'Only the latest failed canonical night attempt with an explicitly reviewed private profile. Uses the current UTC date and plan with original actor privileges; a request accepted by GitHub is not a successful night. No arbitrary robot or climb retry.',
  learning: 'Private catalogue review, not mothership inbox acceptance or upstream lesson submission.',
  'learning-copy': 'Exact reviewed catalogue migration; fresh source and destination checks required.',
  versions: 'Source-declared versions only; missing installed runtime evidence stays unavailable.',
  'prepare-update': 'Pinned adopter update preparation only; no arbitrary shell, self-update or automatic merge.',
  'publish-update': 'Exact immutable update patch and reviewed pull request; merge and deployment remain separate.',
  typecheck: 'Fixed typecheck adapter only. It cannot retry an arbitrary failed night, robot or climb run.',
  schedule: 'Existing supported project-owned typecheck cron only; no generic scheduler or managed-night rewrite.',
  connections: 'Model-list metadata is not inference capacity or subscription quota.',
  credentials: 'Only explicitly activated supported API-key providers and approved policy scopes.',
  'connection-policy': 'Exact private workspace policy change, not credential activation.',
  'model-policy': 'Declared policy and evidence can be stale; no live quota probe is performed here.',
  'model-policy-write': 'Exact reviewed policy change; it grants no automatic provider call.',
  'model-task': 'Tool-free bounded API evidence brief only; no general builder, robot or subscription execution.',
  setup: 'Diagnostics only; no resource creation, credentials or local directory initialization.',
};

function groupFor(command) {
  if (/^(goal|phase|status|next|night|morning|goodnight)/.test(command)) return 'Planning';
  if (/^(learn|lessons|retro)/.test(command)) return 'Learning';
  if (/^(fleet|update|release|render|adopt|init)/.test(command)) return 'Updates';
  if (/^(walk|feedback|review|issue|shape|decision|canvas|board)/.test(command)) return 'Review';
  return 'Local and advanced';
}

function taskRoute(suffix, scope, project) {
  if (scope === 'fleet') return suffix;
  if (!project) return scope === 'both' ? suffix : null;
  return `/projects/${project.id}${suffix === '/' ? '' : suffix}`;
}

function prerequisites(key, access, config, project) {
  const permission = (name, text) => access[name] === 'write' ? null : text;
  const contents = () => permission('contentsPermission', 'Current GitHub App Contents write permission is unavailable.');
  if (key === 'night-plan' || key === 'night-retry') {
    const policy = config.nightOperations;
    if (!policy?.verifiedAt || !policy.restoreReconciledAt) return 'Night controls have not been verified and reconciled for this instance.';
    if (key === 'night-plan') return policy.planWrites === true ? contents() : 'Night plan publication is disabled.';
    if (policy.retryEnabled !== true) return 'Night retries are disabled.';
    if (project && !policy.profiles?.includes(project.id)) return 'This project is not approved for a reviewed night-retry profile.';
    if (config.jobs?.enabled !== true || !config.jobs.verifiedAt || !config.jobs.restoreReconciledAt) return 'Shared worker budget admission is disabled or has not been verified.';
    return permission('actionsPermission', 'Current GitHub App Actions write permission is unavailable.');
  }
  if (key === 'decision') return config.decisionWrites === true ? contents() : 'Decision submission is disabled for this instance.';
  if (key === 'workspace') return config.workspaceWrites === true ? contents() : 'Private workspace source writes are disabled for this instance.';
  if (key === 'media') return config.media ? null : 'Private capture storage is not configured.';
  if (['jobs', 'schedule', 'updates', 'publication'].includes(key)) {
    if (config.jobs?.enabled !== true || !config.jobs.verifiedAt || !config.jobs.restoreReconciledAt) return 'Worker execution is disabled or its verification and restore reconciliation are missing.';
    if (key === 'schedule') {
      if (config.jobs.scheduleWrites !== true) return 'Schedule source writes are disabled.';
      return contents() || permission('workflowsPermission', 'Current GitHub App Workflows write permission is unavailable.');
    }
    if (key === 'publication') {
      if (config.fleetUpdates?.enabled !== true || config.fleetUpdates?.publishEnabled !== true) return 'Update pull request publication is disabled.';
      return contents() || permission('pullRequestsPermission', 'Current GitHub App Pull requests write permission is unavailable.');
    }
    if (key === 'updates' && config.fleetUpdates?.enabled !== true) return 'Update preparation is disabled.';
    return permission('actionsPermission', 'Current GitHub App Actions write permission is unavailable.');
  }
  if (key === 'connections' || key === 'models') {
    if (config.connections?.enabled !== true || !config.connections.vaultVerifiedAt) return 'Credential storage is disabled or has not been verified.';
    if (key === 'models' && (config.modelRouting?.enabled !== true || !config.modelRouting.verifiedAt || !config.modelRouting.restoreReconciledAt)) return 'Model execution is disabled or its verification and restore reconciliation are missing.';
  }
  return null;
}

function taskRow(task, access, config, project) {
  const [key, title, group, effect, scope, treatment, adapter, suffix, activation] = task;
  const route = taskRoute(suffix, scope, project);
  const missing = prerequisites(activation, access, config, project);
  const state = missing ? 'disabled' : !route ? 'unverified' : effect === 'read' ? 'available' : 'unverified';
  const reason = missing || (!route ? 'Select an authorized project to inspect this task.' : effect === 'read' ? inspectionReason : sourceReason);
  return {
    id: `web.${key}`, title, group, treatment, effect, scope, route, adapter,
    readiness: { state, reason },
    requirements: ['Current authenticated workspace/project scope', ...(effect === 'read' ? ['Destination reports its actual source coverage'] : ['Fresh domain source and permission checks', 'Exact reviewed intent and original receipt where applicable'])],
    limitations: [limitationByTask[key]],
    followUp: effect === 'read' ? 'Inspect the destination coverage and source timestamps.' : 'Open the supported destination, inspect its capability result, and review a fresh preview before acting.',
    cli: [],
  };
}

function cliRow(entry) {
  const presentation = entry.command === 'help';
  return {
    id: entry.id, title: entry.summary.split(':')[0], group: groupFor(entry.command),
    treatment: presentation ? 'presentation-only' : 'limited', effect: presentation ? 'presentation' : 'local',
    scope: 'both', route: null, adapter: null,
    readiness: { state: presentation ? 'available' : 'unsupported', reason: presentation ? 'CLI help is a presentation format; this catalogue describes supported web tasks.' : entry.limitation },
    requirements: ['Exact CLI variant and source semantics'], limitations: [entry.limitation], followUp: entry.followUp,
    cli: [{ command: `keel ${entry.command}`, usage: entry.usage, forms: entry.forms.map(({ parserSource, ...form }) => structuredClone(form)) }],
  };
}

function routineRow(entry) {
  return {
    id: entry.id, title: `Installed ${entry.title}`, group: 'Installed routines', treatment: 'limited', effect: 'local', scope: 'project',
    route: null, adapter: null, readiness: { state: 'unsupported', reason: 'Canonical routine grammar is catalogued; the installed project source and environment have not been inspected. Recorded history does not enable execution.' },
    requirements: ['Source-pinned installed implementation', 'Purpose-specific execution authority and bounds'],
    limitations: [entry.notes || 'Installed routine execution is not exposed through this catalogue.'], followUp: entry.followUp,
    cli: [{ command: `node ${entry.source.split('/files/')[1]}`, usage: entry.forms.join(' | '), forms: [{
      subcommand: entry.forms.join(' | '), positionals: entry.positionals, arguments: entry.arguments.map(token => ({ token, arity: 'see canonical form', repeat: 'parser-specific', treatment: 'limited' })), constraints: entry.notes,
    }] }],
  };
}

function projectScope(access, config, selected) {
  if (!numeric(access?.userId) || !access.workspace?.id || access.workspace.id !== config?.workspace?.id
    || !Array.isArray(access.projects) || access.projects.length > 100) throw new WebError('access_denied', 404);
  if (selected === null) return null;
  if (!validProjectId(selected)) throw new WebError('access_denied', 404);
  const project = access.projects.find(item => item.id === selected);
  if (!project || !numeric(project.repoId) || config.projectRepoIds?.[selected] !== project.repoId) throw new WebError('access_denied', 404);
  return { id: selected, name: selected };
}

/** Read-only capability projection. It never loads credentials, probes providers or dispatches work. */
export function capabilityCatalogue(access, config, { projectId = null } = {}) {
  const project = projectScope(access, config, projectId);
  const rows = [...tasks.map(task => taskRow(task, access, config, project)), ...cliData.map(cliRow), ...routineData.map(routineRow)];
  for (const [id, command, positionals, reason] of [
    ['agent-help', 'keel --agent-help', 'topic|all:0..1', 'Agent help takes precedence anywhere in argv; no task execution.'],
    ['version', 'keel --version', '', 'CLI package version output is not a remote project runtime observation.'],
    ['help-alias', 'keel --help | keel -h', '', 'First-token help aliases only; no universal post-verb --help.'],
    ['json', 'keel --json', '', 'First-token JSON selects help; ordinary command JSON changes output representation only.'],
  ]) {
    rows.push({id: `global.${id}`, title: command, group: 'CLI presentation', treatment: 'presentation-only', effect: 'presentation', scope: 'both', route: null, adapter: null,
      readiness: {state: 'available', reason}, requirements: [], limitations: [reason], followUp: 'Use task destinations for web workflows; CLI representation flags do not dispatch work.',
      cli: [{command, usage: command, forms: [{subcommand: null, positionals, arguments: [{token: '--json', arity: 0, repeat: 'parser-specific', treatment: 'presentation-only'}], constraints: reason}]}]});
  }
  return {
    schema: 1, scope: project ? 'project' : 'fleet', project, rows,
    coverage: {
      registeredEntries: cliData.length, forms: cliData.reduce((count, item) => count + item.forms.length, 0), installedEntrypoints: routineData.length,
      grammar: 'reviewed-source-boundary',
      gaps: ['Installed or project-owned scripts can differ from the reviewed canonical package; their grammar remains unverified.', 'Coverage is not execution or source completeness. Arbitrary night, robot, climb and custom-command execution remains unsupported; the named night controls have narrower source and policy requirements.', 'No provider quota or current source observation was collected for this catalogue.'],
    },
  };
}
