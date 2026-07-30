// Opt-in registration of the n8n provider (A-5, requirement 3 & 7).
//
// The whole integration is optional and behind the provider seam: missing config leaves the null
// provider active and never throws. `fetch` is never called here — registration must not probe
// n8n at boot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/config/env', () => ({
  env: {
    AUTOMATION_ENABLED: true,
    AUTOMATION_PROVIDER: 'n8n',
    N8N_BASE_URL: undefined as string | undefined,
    N8N_API_KEY: undefined as string | undefined,
    N8N_TIMEOUT_MS: 30_000,
    N8N_MAX_RETRIES: 2,
  },
  isTest: true,
}));

const { env } = await import('../../../../infrastructure/config/env');
const cfg = env as unknown as {
  AUTOMATION_ENABLED: boolean;
  AUTOMATION_PROVIDER: string;
  N8N_BASE_URL: string | undefined;
  N8N_API_KEY: string | undefined;
};

const { registerN8nProvider, resetN8nProviderRegistration } = await import('./register-n8n-provider');
const { getAutomationProvider, isAutomationEnabled, resetAutomationProvider } = await import(
  '../../automation.registry'
);

beforeEach(() => {
  cfg.AUTOMATION_ENABLED = true;
  cfg.AUTOMATION_PROVIDER = 'n8n';
  cfg.N8N_BASE_URL = undefined;
  cfg.N8N_API_KEY = undefined;
  resetAutomationProvider();
  resetN8nProviderRegistration();
});
afterEach(() => vi.restoreAllMocks());

describe('registerN8nProvider', () => {
  it('installs the n8n provider when the URL and key are both present', () => {
    cfg.N8N_BASE_URL = 'https://n8n.example';
    cfg.N8N_API_KEY = 'secret';
    registerN8nProvider();
    expect(getAutomationProvider().id).toBe('n8n');
    expect(isAutomationEnabled()).toBe(true);
  });

  it('stays on the null provider (warns, never throws) when N8N_BASE_URL is missing', () => {
    cfg.N8N_API_KEY = 'secret';
    expect(() => registerN8nProvider()).not.toThrow();
    expect(getAutomationProvider().id).toBe('null');
  });

  it('stays on the null provider when N8N_API_KEY is missing — the key is required (req 3)', () => {
    cfg.N8N_BASE_URL = 'https://n8n.example';
    expect(() => registerN8nProvider()).not.toThrow();
    expect(getAutomationProvider().id).toBe('null');
  });

  it('does nothing when n8n is not the configured provider', () => {
    cfg.AUTOMATION_PROVIDER = 'null';
    cfg.N8N_BASE_URL = 'https://n8n.example';
    cfg.N8N_API_KEY = 'secret';
    registerN8nProvider();
    expect(getAutomationProvider().id).toBe('null');
  });
});
