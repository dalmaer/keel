// One project's rehearsal in a worker thread (lib/fleet.mjs rehearse, phase
// 53). The candidate practice is loaded here, from the checkout being
// released, and the row goes back to the parent. Nothing here pushes.
import { workerData, parentPort } from 'node:worker_threads';
import { rehearseOne } from './fleet.mjs';
import { load as loadPractices } from './practices.mjs';
import { load as loadMigrations } from './migrations.mjs';

const { plan, env, cli, cliRoot, practicesDir, migrationsDir } = workerData;
const practices = await loadPractices(practicesDir);
const migrations = await loadMigrations(migrationsDir);
parentPort.postMessage(await rehearseOne(plan, { env, cli, cliRoot, practices, migrations }));
