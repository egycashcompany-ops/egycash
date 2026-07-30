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
export { runProviderConformance } from './provider-conformance';
