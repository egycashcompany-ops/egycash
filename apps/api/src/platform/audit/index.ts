// Public surface of the audit feature — nothing else is importable.
export { auditService, registerAuditJobHandlers, type AuditEntry } from './audit.service';
export {
  buildAuditLogsRouter,
  buildActivityLogsRouter,
  buildTimelineRouter,
} from './audit.routes';
export { registerAuditSettings } from './audit.settings';
export { runActivityRetention, type RetentionRunResult } from './audit.retention';
export {
  runSecuritySignalDetection,
  flagBreakGlassUse,
  BREAK_GLASS_SIGNAL,
  type BreakGlassUse,
} from './audit.signals';
