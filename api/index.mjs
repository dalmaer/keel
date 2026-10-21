import { configFromEnv, requireRuntime } from '../lib/web/config.mjs';
import { createWebService, unavailableResponse } from '../lib/web/server.mjs';

// Vercel Web Handler: no build step, SDK or process-local authorization state.
export default {
  async fetch(request) {
    try { requireRuntime(); return await createWebService(configFromEnv())(request); }
    catch { return unavailableResponse(); }
  },
};
