// Compile-only assertions import actual production exports. An unused
// suppression directive fails the check if a contract silently becomes permissive.
import { nodePlan, suiteCollector, readReceiptPlan, isStallsReceipt, stallsEvidence } from '../practices/night/files/scripts/keel/time-receipts.mjs';
import { robotPolicy } from '../practices/climb/files/scripts/keel/robot-policy.mjs';

type Plan = Awaited<ReturnType<typeof nodePlan>>;
const unavailable: Plan = {version: 1, available: false, invocationId: 'acme', reason: 'unknown selection'};
// @ts-expect-error An unavailable plan cannot claim an expected inventory.
const falseInventory: Plan = {...unavailable, expectedFiles: ['tests/acme.test.mjs']};
// @ts-expect-error Availability requires the actual plan's settings and inventory.
const falseAvailable: Plan = {version: 1, available: true, invocationId: 'acme'};

declare const external: unknown;
// @ts-expect-error Unknown external JSON is not a validated plan.
suiteCollector({root: '/acme', flagsHash: 'acme', plan: external});
const plan = await readReceiptPlan({KEEL_SUITE_PLAN: '{}'});
const collector = suiteCollector({root: '/acme', flagsHash: 'acme', plan});
collector.push(external);
const receipt = collector.finish();
if (receipt.complete) {
  const elapsed: number = receipt.aggregate.durationMs;
  void elapsed;
} else {
  // @ts-expect-error Unavailable observations cannot be used as measured timing.
  const inventedTiming: number = receipt.aggregate?.durationMs;
}
type SuiteReceipt = ReturnType<typeof collector.finish>;
// @ts-expect-error A complete receipt requires a measured aggregate.
const falseComplete: SuiteReceipt = {...receipt, complete: true, aggregate: null};
if (isStallsReceipt(external)) {
  const outcome: 'pass' | 'fail' | 'inconclusive' | 'skip' | 'todo' = external.stalled;
  void outcome;
}
type StallsReceipt = ReturnType<typeof stallsEvidence>[number];
declare const stalls: StallsReceipt;
// @ts-expect-error Unknown is not a recorded outcome.
const falseOutcome: StallsReceipt = {...stalls, stalled: 'unknown'};

type Policy = ReturnType<typeof robotPolicy>;
// @ts-expect-error Invalid configuration cannot authorize spending.
const invalidEnabled: Policy = {valid: false, enabled: true, weeklyMinutes: 10, problems: []};
// @ts-expect-error Enabled policy requires a known budget, never null.
const unknownBudget: Policy = {valid: true, enabled: true, weeklyMinutes: null, problems: []};
const policy = robotPolicy(external);
if (policy.enabled) {
  const budget: number = policy.weeklyMinutes;
  const validated: true = policy.valid;
  void [budget, validated];
}
