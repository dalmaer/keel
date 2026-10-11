// 0005 can be recorded for CI/night work while milestone planning leaves
// phase tests dormant. A separate id keeps this repair available when the
// project returns to files, without replaying the other parts of 0005.
import { SHIPPED, shippedEdit } from './0005-test-ledger-reach.mjs';

export const id = '0007-phase-guard-reach';
export const to = '0.8.28';
export const summary = 'wire missing shipped phase guards into the node test script when file planning is active';

const phases = Object.freeze({ phases: SHIPPED.phases });

export async function applies(project) {
  return !!(await shippedEdit(project, phases));
}

export async function up(project) {
  const edit = await shippedEdit(project, phases);
  return edit ? [{ path: edit.path, content: edit.content }] : [];
}
