import { configFromEnv } from '../lib/web/config.mjs';
import { requireHostedRuntime } from '../lib/web/hosted-runtime.mjs';
import { createWebService, unavailableResponse } from '../lib/web/server.mjs';

// Vercel Web Handler: no build step, SDK or process-local authorization state.
export default {
  async fetch(request) {
    try { requireHostedRuntime(); return await createWebService(configFromEnv())(request); }
    catch { return unavailableResponse(); }
  },
};
