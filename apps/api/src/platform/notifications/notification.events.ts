// Inbound event subscriptions (Sprint 3.3 plan §4) — the two initial, deliberately
// short list of consumers. Payloads are cast, not schema-validated, matching the
// existing consumer convention (see `auth.service.ts`'s `registerAuthEventHandlers`).
import { PlatformEvents, type EventEnvelope } from '@ecms/contracts';
import { subscribe } from '../kernel/event-bus';
import { rbacService } from '../rbac';
import { notificationsService } from './notification.service';
import { ROLE_ASSIGNMENT_CHANGED_TEMPLATE_KEY, SECURITY_ALERT_TEMPLATE_KEY } from './notification.seeds';

interface AuditAlertRaisedPayload {
  signal: string;
  userId?: string;
  count: number;
  windowMinutes: number;
}

interface RoleAssignmentChangedPayload {
  userId: string;
  roleId: string;
  change: 'granted' | 'revoked' | 'updated';
}

export const registerNotificationEventHandlers = (): void => {
  // First real consumer of the Sprint 3.2 signal detectors (plan §4) — everyone with
  // organization-wide audit-log visibility learns about a raised security signal.
  subscribe(PlatformEvents.AuditAlertRaised, 'notifications.securityAlert', async (envelope: EventEnvelope) => {
    const payload = envelope.payload as AuditAlertRaisedPayload;
    await notificationsService.notify({
      template: SECURITY_ALERT_TEMPLATE_KEY,
      to: { permission: 'auditLog.view', scope: 'organization' },
      data: {
        signal: payload.signal,
        count: String(payload.count),
        windowMinutes: String(payload.windowMinutes),
      },
      entityRef: { moduleId: 'platform', entityType: 'security', entityId: payload.signal },
    });
  });

  // Proves the general subscription seam with a low-risk, human-facing example (plan §4).
  subscribe(
    PlatformEvents.RoleAssignmentChanged,
    'notifications.roleAssignmentChanged',
    async (envelope: EventEnvelope) => {
      const payload = envelope.payload as RoleAssignmentChangedPayload;
      const role = await rbacService.getRole(payload.roleId).catch(() => null);
      await notificationsService.notify({
        template: ROLE_ASSIGNMENT_CHANGED_TEMPLATE_KEY,
        to: { userId: payload.userId },
        data: {
          roleName: role?.name.en ?? payload.roleId,
          change: payload.change,
        },
        entityRef: { moduleId: 'platform', entityType: 'user', entityId: payload.userId },
      });
    },
  );
};
