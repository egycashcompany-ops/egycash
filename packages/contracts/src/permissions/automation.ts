// Automation module permission catalog (ADR-018 · automation-module-design §7.1).
//
// Ordinary RBAC. No new concept, no parallel authorisation model: the same `declarePermissions`
// helper, the same `<resource>.<action>` keys, the same registry sync at boot, and therefore the
// same role editor, the same permission matrix and the same audit trail as every other module.
// An automation-specific permission system would be a second place to get authorisation wrong.
//
// Declared here rather than in the API module so the WEB client can reference the keys it gates
// on, and so this slice stays contracts-only. `automationPermissions` is picked up by the module
// manifest at A-3; until then nothing registers them and no behaviour changes.
//
// On naming: the resource is `workflow`, which is what the frozen design specifies. It does not
// collide with the Workflow Engine (ADR-011), whose resources are `workflowDefinition` and
// `workflowInstance` — a separation the localized names below make visible in the role editor,
// because "View automation workflows" and "View workflow definitions" must never be confused by
// the person granting them. The two engines are separate by ADR-018 §Boundary.
import { declarePermissions, type PermissionDef } from './def.js';

const A = 'automation';

export const automationWorkflowPermissions = declarePermissions(
  A,
  'workflow',
  { en: 'automation workflows', ar: 'مسارات الأتمتة' },
  ['view', 'create', 'edit', 'delete'],
  [
    {
      action: 'enable',
      name: { en: 'Enable / disable automation workflows', ar: 'تفعيل / تعطيل مسارات الأتمتة' },
    },
    {
      action: 'run',
      name: { en: 'Run an automation workflow manually', ar: 'تشغيل مسار أتمتة يدويًا' },
    },
    {
      // Reassigns the principal a workflow executes AS (§7.2), so it is the one action here that
      // can change what an automation is able to do. Granted narrowly.
      action: 'transfer',
      name: { en: 'Transfer automation workflow ownership', ar: 'نقل ملكية مسار الأتمتة' },
    },
  ],
);

export const automationExecutionPermissions = declarePermissions(
  A,
  'execution',
  { en: 'automation executions', ar: 'عمليات تشغيل الأتمتة' },
  ['view'],
  [
    { action: 'retry', name: { en: 'Retry a failed execution', ar: 'إعادة محاولة تشغيل فاشل' } },
    { action: 'cancel', name: { en: 'Cancel a running execution', ar: 'إلغاء تشغيل جارٍ' } },
  ],
);

export const automationCredentialPermissions = declarePermissions(
  A,
  'credential',
  { en: 'automation credentials', ar: 'بيانات اعتماد الأتمتة' },
  // `view` returns METADATA ONLY — key, type, owner, last use. There is no read path for a stored
  // secret anywhere in the API (§7.3), so this grant cannot be used to exfiltrate one.
  ['view', 'create', 'edit', 'delete'],
);

export const automationVariablePermissions = declarePermissions(
  A,
  'variable',
  { en: 'automation variables', ar: 'متغيرات الأتمتة' },
  ['view', 'edit'],
);

export const automationTemplatePermissions = declarePermissions(
  A,
  'template',
  { en: 'automation templates', ar: 'قوالب الأتمتة' },
  ['view'],
  [
    {
      // A template is an executable graph; installing one runs it with the installer's
      // permissions and credentials (§11.4). Separate from `view` for exactly that reason.
      action: 'install',
      name: { en: 'Install an automation template', ar: 'تثبيت قالب أتمتة' },
    },
  ],
);

export const automationAdminPermissions = declarePermissions(
  A,
  'automation',
  { en: 'the automation engine', ar: 'محرك الأتمتة' },
  [],
  [
    {
      // Settings, all-branch visibility, provider builder access, and the only route by which an
      // UNSIGNED template package can enter the system.
      action: 'admin',
      name: { en: 'Administer the automation engine', ar: 'إدارة محرك الأتمتة' },
    },
  ],
);

export const automationPermissions: PermissionDef[] = [
  ...automationWorkflowPermissions,
  ...automationExecutionPermissions,
  ...automationCredentialPermissions,
  ...automationVariablePermissions,
  ...automationTemplatePermissions,
  ...automationAdminPermissions,
];
