// Reading a workflow's shell without a YAML dependency, shared by
// tests/workflows.test.mjs and tests/climb.test.mjs (a test file imported by
// another would register its tests twice). The reader is the ci practice's
// shipped scripts/plates/workflows.mjs: one source, so the check every project
// runs is the one plates's tests hold its own workflows to.
export { runBlocks, inlineNode, shellProblems, workflowProblems } from '../../practices/ci/files/scripts/plates/workflows.mjs';
