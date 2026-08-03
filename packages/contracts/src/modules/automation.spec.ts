// Automation module contracts (A-2).
//
// Two things are worth testing in a contracts file: the rules that stop a caller from saving
// something that can never work, and the rules that exist for security. Everything else is the
// type system's job. So: trigger completeness, the credential DTO having no read path for a
// secret, template prerequisites, and the provider-independence of the whole surface.
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_WORKFLOW_STATUSES,
  AutomationCredentialDtoSchema,
  AutomationTemplatePackageSchema,
  AutomationTriggerInputSchema,
  CreateAutomationCredentialSchema,
  CreateAutomationWorkflowSchema,
  ListAutomationExecutionsQuerySchema,
  ListAutomationWorkflowsQuerySchema,
  ReportAutomationProgressSchema,
  UpsertAutomationVariableSchema,
} from './automation.js';

const NAME = { en: 'Welcome email', ar: 'بريد ترحيبي' };
const EVENT_TRIGGER = { kind: 'event' as const, event: 'hr.employee.created' };

const workflow = (overrides: Record<string, unknown> = {}) => ({
  key: 'hr-welcome-email',
  name: NAME,
  trigger: EVENT_TRIGGER,
  ...overrides,
});

// ── Triggers ────────────────────────────────────────────────────────────────

describe('AutomationTriggerInputSchema', () => {
  it('accepts an event trigger and defaults timezone and filters', () => {
    const parsed = AutomationTriggerInputSchema.parse(EVENT_TRIGGER);
    expect(parsed.timezone).toBe('Africa/Cairo');
    expect(parsed.filters).toEqual([]);
  });

  it('refuses a trigger that could never fire', () => {
    // Each of these saves cleanly without the refinement and then does nothing forever, which is
    // the worst failure mode an automation can have: silent and indistinguishable from "no work".
    expect(AutomationTriggerInputSchema.safeParse({ kind: 'event' }).success).toBe(false);
    expect(AutomationTriggerInputSchema.safeParse({ kind: 'cron' }).success).toBe(false);
    expect(AutomationTriggerInputSchema.safeParse({ kind: 'schedule' }).success).toBe(false);
  });

  it('names the field that is missing, not just "invalid"', () => {
    const parsed = AutomationTriggerInputSchema.safeParse({ kind: 'cron' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['cron']);
  });

  it('does not require an event on a manual trigger', () => {
    expect(AutomationTriggerInputSchema.safeParse({ kind: 'manual' }).success).toBe(true);
  });

  it('rejects an unknown key — a mistyped trigger field would be silently ignored otherwise', () => {
    expect(
      AutomationTriggerInputSchema.safeParse({ ...EVENT_TRIGGER, evnet: 'typo' }).success,
    ).toBe(false);
  });

  it('carries declarative filters, never an expression to evaluate', () => {
    const parsed = AutomationTriggerInputSchema.parse({
      ...EVENT_TRIGGER,
      filters: [{ field: 'origin', op: 'eq', value: 'recruitment' }],
    });
    expect(parsed.filters).toHaveLength(1);
  });
});

// ── Workflows ───────────────────────────────────────────────────────────────

describe('CreateAutomationWorkflowSchema', () => {
  it('accepts a minimal workflow and defaults its scope and AI opt-in', () => {
    const parsed = CreateAutomationWorkflowSchema.parse(workflow());
    expect(parsed.branchScope).toBe('branch');
    // AI is off unless a field is explicitly opted in (§6) — the default must never be "all".
    expect(parsed.aiOptIn).toEqual([]);
    expect(parsed.description).toBeNull();
  });

  it('rejects a key that is not a stable identifier', () => {
    for (const key of ['Welcome Email', '1st-workflow', 'hr_welcome', '']) {
      expect(CreateAutomationWorkflowSchema.safeParse(workflow({ key })).success, key).toBe(false);
    }
  });

  it('rejects unknown keys', () => {
    expect(
      CreateAutomationWorkflowSchema.safeParse(workflow({ n8nWorkflowId: 'wf_1' })).success,
    ).toBe(false);
  });

  it('validates the trigger through the same refinement', () => {
    expect(
      CreateAutomationWorkflowSchema.safeParse(workflow({ trigger: { kind: 'event' } })).success,
    ).toBe(false);
  });

  it('distinguishes a workflow a human disabled from one the platform suspended', () => {
    // They look the same on a dashboard and are not the same thing: `suspended` means the owner
    // is gone, and re-enabling it has to go through a transfer rather than a toggle (§7.2).
    expect(AUTOMATION_WORKFLOW_STATUSES).toContain('disabled');
    expect(AUTOMATION_WORKFLOW_STATUSES).toContain('suspended');
  });
});

describe('list queries', () => {
  it('applies the platform pagination defaults', () => {
    const parsed = ListAutomationWorkflowsQuerySchema.parse({});
    expect(parsed).toMatchObject({ page: 1, pageSize: 25 });
  });

  it('coerces query-string dates on the executions filter', () => {
    const parsed = ListAutomationExecutionsQuerySchema.parse({ from: '2026-07-01T00:00:00.000Z' });
    expect(parsed.from).toBeInstanceOf(Date);
  });

  it('rejects an unknown filter rather than returning an unfiltered page', () => {
    expect(ListAutomationWorkflowsQuerySchema.safeParse({ owner: 'me' }).success).toBe(false);
  });
});

// ── Credentials ─────────────────────────────────────────────────────────────

describe('credentials are write-only', () => {
  it('has no field that could carry a secret back out', () => {
    // The response shape is a schema rather than a bare interface precisely so this rule is
    // executable. Adding `value` to the DTO — the one change that would turn `credential.view`
    // into an exfiltration endpoint — fails here rather than shipping.
    const keys = Object.keys(AutomationCredentialDtoSchema.shape);
    for (const forbidden of ['value', 'secret', 'ciphertext', 'plaintext', 'wrappedKey']) {
      expect(keys, `DTO must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('shows a fixed mask, not a prefix of the real value', () => {
    // A masked prefix leaks entropy and, for short secrets, most of the secret.
    expect(AutomationCredentialDtoSchema.shape.masked.value).toBe('••••••••');
  });

  it('exposes the sealing key id so rotation posture is visible without decrypting', () => {
    expect(Object.keys(AutomationCredentialDtoSchema.shape)).toContain('keyId');
  });

  it('accepts a value on the way in', () => {
    const parsed = CreateAutomationCredentialSchema.safeParse({
      key: 'smtp-main',
      name: { en: 'Outbound mail', ar: 'البريد الصادر' },
      type: 'smtp',
      value: 'super-secret',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses an empty secret rather than storing a sealed empty string', () => {
    const parsed = CreateAutomationCredentialSchema.safeParse({
      key: 'smtp-main',
      name: { en: 'x', ar: 'x' },
      type: 'smtp',
      value: '',
    });
    expect(parsed.success).toBe(false);
  });
});

// ── Variables ───────────────────────────────────────────────────────────────

describe('UpsertAutomationVariableSchema', () => {
  it('requires the reference its scope depends on', () => {
    expect(UpsertAutomationVariableSchema.safeParse({ value: 'x', scope: 'branch' }).success).toBe(
      false,
    );
    expect(
      UpsertAutomationVariableSchema.safeParse({ value: 'x', scope: 'workflow' }).success,
    ).toBe(false);
  });

  it('accepts a global variable with no reference', () => {
    expect(UpsertAutomationVariableSchema.parse({ value: 'x' }).scope).toBe('global');
  });

  it('allows an empty value — clearing a variable is not the same as deleting it', () => {
    expect(UpsertAutomationVariableSchema.safeParse({ value: '' }).success).toBe(true);
  });
});

// ── Template packages ───────────────────────────────────────────────────────

const templatePackage = (overrides: Record<string, unknown> = {}) => ({
  key: 'hr-welcome-email',
  version: '1.2.0',
  name: NAME,
  category: 'hr',
  description: { en: 'Sends a welcome email', ar: 'يرسل بريدًا ترحيبيًا' },
  provider: { id: 'example', minVersion: '1.0.0' },
  graph: { providerId: 'example', formatVersion: '1', nodes: [] },
  ...overrides,
});

describe('AutomationTemplatePackageSchema', () => {
  it('accepts a package and defaults its prerequisites to none', () => {
    const parsed = AutomationTemplatePackageSchema.parse(templatePackage());
    expect(parsed.requires.events).toEqual([]);
    expect(parsed.requires.capabilities).toEqual([]);
  });

  it('accepts an UNSIGNED package — it is stored as untrusted, not refused at the schema', () => {
    // Refusing here would push the decision into the transport. §11.4 puts it in the installer,
    // where "unsigned" can be recorded, reviewed and explicitly trusted by a human.
    expect(AutomationTemplatePackageSchema.safeParse(templatePackage()).success).toBe(true);
  });

  it('requires a semantic version, because the catalogue keeps every version', () => {
    expect(
      AutomationTemplatePackageSchema.safeParse(templatePackage({ version: '1.2' })).success,
    ).toBe(false);
    expect(
      AutomationTemplatePackageSchema.safeParse(templatePackage({ version: '1.2.0-rc.1' })).success,
    ).toBe(true);
  });

  it('restricts required capabilities to ones a provider can actually declare', () => {
    // Derived from `AutomationCapabilitiesSchema.keyof()`, so a capability added to the provider
    // contract becomes requestable with no edit here — and a typo is rejected.
    expect(
      AutomationTemplatePackageSchema.safeParse(
        templatePackage({ requires: { capabilities: ['graphImportExport'] } }),
      ).success,
    ).toBe(true);
    expect(
      AutomationTemplatePackageSchema.safeParse(
        templatePackage({ requires: { capabilities: ['timeTravel'] } }),
      ).success,
    ).toBe(false);
  });

  it('names the provider whose graph it carries without pinning the schema to one', () => {
    const parsed = AutomationTemplatePackageSchema.parse(
      templatePackage({ provider: { id: 'some-future-runtime' } }),
    );
    expect(parsed.provider.id).toBe('some-future-runtime');
  });

  it('rejects unknown top-level keys, so a malformed package fails at import', () => {
    expect(
      AutomationTemplatePackageSchema.safeParse(templatePackage({ script: 'rm -rf /' })).success,
    ).toBe(false);
  });
});

// ── Callbacks ───────────────────────────────────────────────────────────────

describe('ReportAutomationProgressSchema', () => {
  it('accepts per-node results in the provider-independent shape', () => {
    const parsed = ReportAutomationProgressSchema.parse({
      status: 'success',
      nodes: [{ name: 'send-email', status: 'success', durationMs: 42 }],
    });
    expect(parsed.nodes).toHaveLength(1);
  });

  it('defaults to no nodes, for a provider that reports no per-node progress', () => {
    expect(ReportAutomationProgressSchema.parse({ status: 'running' }).nodes).toEqual([]);
  });
});

// ── The rule that outranks the rest ─────────────────────────────────────────

describe('provider independence', () => {
  it('names no provider anywhere in the module contracts', async () => {
    // A vendor identifier in a DTO ends up in the database, the web client and every integration
    // written against the API. At that point replacing the provider is a migration, not a config
    // change — which is exactly what D-A4 exists to prevent.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./automation.ts', import.meta.url), 'utf8'),
    );
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/n8n|temporal|camunda|zapier/i);
  });
});
