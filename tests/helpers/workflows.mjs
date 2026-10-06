// Reading a workflow's shell without a YAML dependency, shared by
// tests/workflows.test.mjs and tests/climb.test.mjs (a test file imported by
// another would register its tests twice). The reader is the ci practice's
// shipped scripts/keel/workflows.mjs: one source, so the check every project
// runs is the one keel's tests hold its own workflows to.
export { runBlocks, inlineNode, shellProblems, workflowProblems } from '../../practices/ci/files/scripts/keel/workflows.mjs';
