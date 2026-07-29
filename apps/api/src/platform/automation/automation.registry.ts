// Provider selection and dependency injection (design §2.1, D-A4).
//
// One provider is active per process. Selection is by configuration, not by import: nothing here
// reaches into `providers/n8n` — that provider registers ITSELF at boot (A-6), the same way
// `register-ocr-provider.ts` does for OCR. Keeping the direction of dependency this way round is
// what stops the registry from growing a `switch` over every provider that will ever exist.
import { type AutomationCapabilities } from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { logger } from '../../infrastructure/logging/logger';
import { type AutomationProvider } from './automation.provider';
import { nullAutomationProvider } from './providers/null/null.provider';

let active: AutomationProvider = nullAutomationProvider;

/**
 * Install a provider. Called at boot by the provider's own registration module.
 *
 * Refuses while the feature flag is off, and says so. A provider that silently installed itself
 * despite `AUTOMATION_ENABLED=false` would make the flag advisory, and the flag is the only thing
 * keeping thirteen unfinished slices invisible in production.
 */
export const setAutomationProvider = (provider: AutomationProvider): void => {
  if (!env.AUTOMATION_ENABLED) {
    logger.warn(
      { providerId: provider.id },
      'automation provider ignored — AUTOMATION_ENABLED is false',
    );
    return;
  }
  if (provider.id !== env.AUTOMATION_PROVIDER) {
    logger.warn(
      { providerId: provider.id, configured: env.AUTOMATION_PROVIDER },
      'automation provider ignored — not the configured provider',
    );
    return;
  }
  active = provider;
  logger.info({ providerId: provider.id, capabilities: provider.capabilities }, 'automation provider registered');
};

export const getAutomationProvider = (): AutomationProvider => active;

/** True only when a real provider is installed — the null provider is not "enabled". */
export const isAutomationEnabled = (): boolean =>
  env.AUTOMATION_ENABLED && active.id !== nullAutomationProvider.id;

export const automationCapabilities = (): AutomationCapabilities => active.capabilities;

/** Test-only: restore the null provider between suites. */
export const resetAutomationProvider = (): void => {
  active = nullAutomationProvider;
};
