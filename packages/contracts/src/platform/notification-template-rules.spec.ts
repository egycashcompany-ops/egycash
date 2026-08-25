// A declared variable is a defect when the message never SAYS it — not when one of the two texts
// happens not to.
//
// The distinction was worth exactly one visible bug. The rule used to count only the body, so a
// template whose title lived in the subject could not declare it, and the only way to satisfy the
// rule was to repeat the title inside the body: `'{{title}}\n\n{{body}}'`. Every notification
// renders a title and a body, so every announcement showed its title twice, to everybody.
import { describe, expect, it } from 'vitest';
import { CreateNotificationTemplateSchema } from './notifications.js';

const template = (over: Record<string, unknown> = {}) =>
  CreateNotificationTemplateSchema.safeParse({
    key: 'test.template',
    category: 'hr',
    priority: 'normal',
    subject: { ar: '{{title}}', en: '{{title}}' },
    body: { ar: '{{body}}', en: '{{body}}' },
    channels: ['inApp'],
    variables: ['title', 'body'],
    defaultExpiryHours: null,
    ...over,
  });

describe('where a declared variable may live', () => {
  it('accepts one the SUBJECT carries and the body does not', () => {
    // The shape `hr.announcement` needs, and could not have before.
    expect(template().success).toBe(true);
  });

  it('still refuses one that neither text carries', () => {
    // The failure the rule exists for is unchanged: a variable the caller must supply and the
    // message never says. That is a message sent without it.
    const result = template({ variables: ['title', 'body', 'deadline'] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('deadline');
  });

  it('refuses one carried in only ONE language', () => {
    // Per-language, still: a value present for Arabic readers and missing for English ones is the
    // same silent loss, just for half the company.
    const result = template({ subject: { ar: '{{title}}', en: 'Notice' } });
    expect(result.success).toBe(false);
  });

  it('still refuses a placeholder nobody declared', () => {
    // `interpolate` leaves an unmatched placeholder as literal text, so `{{deadlne}}` ships to the
    // recipient exactly like that.
    const result = template({ body: { ar: '{{body}} {{deadlne}}', en: '{{body}} {{deadlne}}' } });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('deadlne');
  });

  it('accepts a template with no subject at all, as before', () => {
    expect(
      template({ subject: null, body: { ar: '{{title}} {{body}}', en: '{{title}} {{body}}' } })
        .success,
    ).toBe(true);
  });

  it('refuses a subject-only variable when there is no subject to carry it', () => {
    expect(template({ subject: null }).success).toBe(false);
  });
});
