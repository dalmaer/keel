// keel drain: one open PR per machine queue. The logic ships into each project
// as the night practice's managed scripts/keel/drain.mjs, so a project's
// night shift runs from its own checkout (design §6, "Projects run on their
// own"); the CLI's verb is that same module, never a copy. render --check
// fails when keel's rendered copy drifts from it.
export * from '../practices/night/files/scripts/keel/drain.mjs';
