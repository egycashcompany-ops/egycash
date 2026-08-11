// P10 — the templates the platform ships must obey the rules it enforces on administrators.
//
// Two invariants, both of which would otherwise fail at the worst possible moment:
//
//   • **G-2 applies to the seeds too.** `ensureBuiltinNotificationTemplates` runs at every boot,
//     in every environment including the test suites, and goes through `service.ensure` → `create`
//     — which is NOT the HTTP path, so the Zod schema never sees it. A seeded template that
//     violated the rule the screen enforces would boot fine and refuse to be edited afterwards:
//     an administrator opening it, changing one word and pressing save would be told the template
//     is invalid, about a defect they did not introduce and cannot see.
//   • **Every protected key is actually seeded.** `PROTECTED_TEMPLATE_KEYS` is the list the
//     deactivate guard reads; a key in it that nothing creates protects nothing, and a seeded
//     template missing from it is deactivatable — which stops the notification it carries.
//
// The seeds are captured rather than written to a database: what is being checked is the DATA the
// boot sequence declares, and that needs no Mongo.
import { describe, expect, it, vi } from 'vitest';
import { CreateNotificationTemplateSchema } from '@ecms/contracts';

const captured: { key: string }[] = [];
vi.mock('./notification-template.service', () => ({
  notificationTemplateService: {
    ensure: async (input: { key: string }) => {
      captured.push(input);
      return input;
    },
  },
}));

const { ensureBuiltinNotificationTemplates } = await import('./notification.seeds');
const { PROTECTED_TEMPLATE_KEYS, isSendableTemplate } = await import('./notification.template-rules');

await ensureBuiltinNotificationTemplates();

describe('the built-in templates', () => {
  it('are the three the platform sends by name', () => {
    expect(captured).toHaveLength(3);
  });

  // The rule the screen enforces, applied to the wording this repository ships.
  it.each(captured.map((t) => [t.key, t] as const))('%s satisfies G-2', (key, template) => {
    const result = CreateNotificationTemplateSchema.safeParse(template);
    const detail = result.success ? '' : JSON.stringify(result.error.issues);
    expect(result.success, `${key}: ${detail}`).toBe(true);
  });

  it.each(captured.map((t) => [t.key] as const))('%s is protected from deactivation', (key) => {
    expect(PROTECTED_TEMPLATE_KEYS).toContain(key);
  });

  // The other direction: a key nothing creates is a guard over nothing.
  it('protects no key that is not seeded', () => {
    const seeded = captured.map((t) => t.key).sort();
    expect([...PROTECTED_TEMPLATE_KEYS].sort()).toEqual(seeded);
  });
});

describe('isSendableTemplate — the rule both consumers now read', () => {
  // `notify()` has always refused an inactive template; the credentials-delivery path never looked
  // at `status`, so deactivating `platform.credentialsDelivery` withdrew it everywhere except the
  // one place it was used. Naming the question once is what stops that recurring — what each
  // caller DOES about a `false` still differs, and should.
  it('accepts an active template', () => {
    expect(isSendableTemplate({ status: 'active' })).toBe(true);
  });

  it('refuses an inactive one', () => {
    expect(isSendableTemplate({ status: 'inactive' })).toBe(false);
  });

  it('refuses an absent one, however it is absent', () => {
    expect(isSendableTemplate(null)).toBe(false);
    expect(isSendableTemplate(undefined)).toBe(false);
  });
});
