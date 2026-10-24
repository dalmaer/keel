import { validateUpdateTarget } from '../update-artifact.mjs';

export function legacyUpdateWorkflow(target, { disabled = false } = {}) {
  validateUpdateTarget(target);
  const expression = value => '${{ ' + value + ' }}';
  return `# Contributor-only example; install only after exact worker/source policy review.
name: keel web update preparation
run-name: ${expression("format('keel-web-{0}', inputs.keel_operation)")}
on:
  workflow_dispatch:
    inputs:
      keel_operation:
        description: Reviewed Keel preparation operation identity
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: ${expression("format('plates-web-update-{0}', inputs.keel_operation)")}
  cancel-in-progress: false
jobs:
  web-worker:
    if: ${disabled ? '${{ false }}' : expression("github.event_name == 'workflow_dispatch' && inputs.keel_operation != ''")}
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${expression('github.sha')}
          path: project-source
          persist-credentials: false
      - uses: actions/checkout@v7
        with:
          repository: ${target.repo}
          ref: ${target.commit}
          path: trusted-keel
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version-file: trusted-keel/.nvmrc
      - name: Prepare bounded update
        env:
          KEEL_WEB_ORIGIN: ${expression('vars.KEEL_WEB_ORIGIN')}
          KEEL_WEB_OPERATION: ${expression('inputs.keel_operation')}
          GITHUB_WORKFLOW_SHA: ${expression('github.workflow_sha')}
        run: node trusted-keel/scripts/web-update-worker.mjs
`;
}

// Keep the pinned worker's checkout directory and environment protocol valid.
// Existing immutable target commits consume those names even after branding changes.
export function canonicalUpdateWorkflow(target, options = {}) {
  return legacyUpdateWorkflow(target, options)
    .replace('name: keel web update preparation', 'name: plates web update preparation')
    .replace('description: Reviewed Keel preparation operation identity', 'description: Reviewed Plates preparation operation identity');
}
