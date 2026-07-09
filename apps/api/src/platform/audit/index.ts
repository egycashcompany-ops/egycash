// Public surface of the audit feature — nothing else is importable.
export { auditService, registerAuditJobHandlers, type AuditEntry } from './audit.service';
export { buildAuditLogsRouter, buildActivityLogsRouter } from './audit.routes';
