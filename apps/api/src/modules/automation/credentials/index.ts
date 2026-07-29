// The service is exported for the dispatcher (A-5/A-6) that has to open secrets at run time.
// Nothing on the HTTP surface can reach `resolveForExecution`.
export { automationCredentialService, type ResolvedSecret } from './credential.service';
export { buildAutomationCredentialsRouter } from './credential.routes';
export { automationCredentialRepository } from './credential.repository';
export { type AutomationCredentialDoc } from './credential.model';
export { redactSnapshot, containsSecret, isSecretFieldName, REDACTED } from './redaction';
