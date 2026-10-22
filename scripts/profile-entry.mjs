// Same CLI call contract as bin/plates.mjs, with an explicit import boundary.
const profile = globalThis[Symbol.for('plates.profile')];
profile?.importStart();
const { main } = await import('../lib/cli.mjs');
profile?.importEnd();
process.exitCode = await main(process.argv.slice(2));
