// Public surface of the Automation Service — nothing else is importable (ADR-003, D-A2).
//
// Business modules import from here and nowhere else. In particular `providers/**` is off-limits
// to everything outside this directory, enforced by the `no-restricted-imports` rule in
// `eslint.config.js` rather than by convention: a seam that depends on everyone remembering it is
// a seam that lasts until the first deadline.
export { automationService, type TriggerRequest, type TriggerOutcome } from './automation.service';
export {
  AutomationCapabilityError,
  type AutomationProvider,
} from './automation.provider';
export {
  setAutomationProvider,
  getAutomationProvider,
  isAutomationEnabled,
  automationCapabilities,
  resetAutomationProvider,
} from './automation.registry';
export { nullAutomationProvider } from './providers/null/null.provider';
// The n8n provider registers itself; only the registration hook and its types are public. The
// provider class and client stay behind `providers/**`, off-limits to modules by the lint rule.
export {
  registerN8nProvider,
  resetN8nProviderRegistration,
} from './providers/n8n/register-n8n-provider';
// `runProviderConformance` is deliberately NOT re-exported here. This barrel is in the runtime
// graph (server, worker and both seed CLIs load `moduleManifests` → automation.module → here),
// and the conformance suite imports `vitest`, which refuses to load outside a vitest run — so
// re-exporting it took every entrypoint down at import time. Provider spec files live inside
// this directory (exempt from the barrel lint rule) and import `./provider-conformance` directly.
