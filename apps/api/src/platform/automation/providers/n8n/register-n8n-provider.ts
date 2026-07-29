// Opt-in registration of the n8n provider (registry §2.1 — the provider registers ITSELF).
//
// Called once at module load. It installs the provider only when the deployment has actually asked
// for n8n: AUTOMATION_ENABLED=true, AUTOMATION_PROVIDER=n8n, and N8N_BASE_URL set. Otherwise the
// null provider stays active and nothing about the deployment changes — which is what lets this
// merge ahead of anyone wiring an n8n instance.
//
// It does NOT probe n8n at boot. A health check here would block boot on a slow n8n or decide it
// is down because it happened to be restarting, then stay wrong until the next restart. The
// provider degrades PER DISPATCH instead: an unreachable n8n fails one trigger (recorded, logged),
// never the business event that caused it.
import { env } from '../../../../infrastructure/config/env';
import { logger } from '../../../../infrastructure/logging/logger';
import { setAutomationProvider } from '../../automation.registry';
import { N8nAutomationProvider } from './n8n.provider';

let registered = false;

export const registerN8nProvider = (): void => {
  if (registered) return;
  if (env.AUTOMATION_PROVIDER !== 'n8n') return; // not the configured provider — say nothing
  if (env.N8N_BASE_URL === undefined || env.N8N_BASE_URL === '') {
    logger.warn('automation: AUTOMATION_PROVIDER=n8n but N8N_BASE_URL is unset — staying on the null provider');
    return;
  }
  registered = true;
  setAutomationProvider(
    new N8nAutomationProvider({
      baseUrl: env.N8N_BASE_URL,
      apiKey: env.N8N_API_KEY,
      timeoutMs: env.N8N_TIMEOUT_MS,
      maxRetries: env.N8N_MAX_RETRIES,
    }),
  );
};

/** Test seam. */
export const resetN8nProviderRegistration = (): void => {
  registered = false;
};
