// Interpret the existing Loop workflow's public job steps. The Gate shell
// captures failures with exit 0; only its later verdict establishes validation.
// Unknown/missing steps never become a success by inheriting the run conclusion.
export function loopRunStatus(jobs) {
  const steps = jobs.flatMap(job => job.steps ?? []);
  const pull = steps.find(step => step.name === "Pull Loop's insights");
  const gate = steps.find(step => step.name === 'Gate');
  const verdict = steps.find(step => ['Validation verdict', 'Verdict'].includes(step.name));
  const state = step => !step ? 'unknown' : step.status && step.status !== 'completed' ? 'pending' : step.conclusion ?? 'unknown';
  const collection = state(pull);
  let validation = 'not-run';
  if (collection === 'success') {
    validation = gate && state(gate) === 'failure' ? 'failure' :
      gate && state(gate) === 'success' && verdict && ['success', 'failure'].includes(state(verdict)) ? state(verdict) : 'unknown';
  }
  return {collection, validation};
}
