// P10 · G-2 — `variables` and the text must agree, in both directions.
//
// The renderer is find-and-replace and nothing else, so BOTH kinds of disagreement fail silently.
// That is the whole reason this is a schema rule: neither failure produces an error at send time,
// so nothing would ever surface them.
//
//   • a declared variable the text never uses → the message is sent without it, and
//     `validateVariables` still demands it from the caller, so no layer complains;
//   • a placeholder the template does not declare → never required of the caller, and
//     `interpolate` leaves it as literal text, so `{{setuplink}}` ships exactly like that.
//
// The case that named the rule is `platform.credentialsDelivery`: an administrator editing the
// wording and dropping `{{setupLink}}` produces an activation email with no activation link. It
// sends successfully. The account is stranded and nothing reports it.
import { describe, expect, it } from 'vitest';
import {
  CreateNotificationTemplateSchema,
  UpdateNotificationTemplateSchema,
  templateContentDisagreement,
} from './notifications.js';

const base = {
  key: 'test.template',
  category: 'workflow' as const,
  priority: 'normal' as const,
  subject: { ar: 'موضوع', en: 'Subject' },
  body: { ar: 'مرحبًا {{name}}', en: 'Hello {{name}}' },
  channels: ['inApp' as const],
  variables: ['name'],
  defaultExpiryHours: null,
};

const create = (overrides: Record<string, unknown> = {}) =>
  CreateNotificationTemplateSchema.safeParse({ ...base, ...overrides });
const update = (body: Record<string, unknown>) => UpdateNotificationTemplateSchema.safeParse(body);
const message = (result: ReturnType<typeof create>): string =>
  result.success ? '' : (result.error.issues[0]?.message ?? '');

describe('a declared variable the text never uses', () => {
  it('is refused', () => {
    expect(create({ variables: ['name', 'orphan'] }).success).toBe(false);
  });

  it('says which variable, and what would happen', () => {
    const text = message(create({ variables: ['name', 'orphan'] }));
    expect(text).toContain('"orphan"');
    expect(text).toContain('sent without it');
  });

  // Per language, because a variable present in one and absent from the other is the same silent
  // loss — for every reader of the language that lost it.
  it('is refused when it is missing from only ONE language', () => {
    expect(create({ body: { ar: 'مرحبًا {{name}}', en: 'Hello' } }).success).toBe(false);
    expect(create({ body: { ar: 'مرحبًا', en: 'Hello {{name}}' } }).success).toBe(false);
  });

  it('names the language that lost it', () => {
    expect(message(create({ body: { ar: 'مرحبًا {{name}}', en: 'Hello' } }))).toContain('body.en');
    expect(message(create({ body: { ar: 'مرحبًا', en: 'Hello {{name}}' } }))).toContain('body.ar');
  });

  // The reported failure, as a schema case.
  it('refuses a credentials-shaped body that dropped the setup link', () => {
    const result = create({
      variables: ['username', 'setupLink'],
      body: { ar: 'أهلًا {{username}}', en: 'Hi {{username}}' },
    });
    expect(result.success).toBe(false);
    expect(message(result)).toContain('"setupLink"');
  });
});

describe('a placeholder the template does not declare', () => {
  it('is refused in the body', () => {
    expect(create({ body: { ar: 'مرحبًا {{name}} {{typo}}', en: 'Hello {{name}} {{typo}}' } }).success).toBe(
      false,
    );
  });

  it('is refused in the subject', () => {
    expect(create({ subject: { ar: 'موضوع {{typo}}', en: 'Subject {{typo}}' } }).success).toBe(false);
  });

  it('says it would be delivered as literal text', () => {
    const text = message(create({ subject: { ar: 'م {{typo}}', en: 'S {{typo}}' } }));
    expect(text).toContain('"typo"');
    expect(text).toContain('literal text');
  });

  // The mis-cased variable — the failure mode that looks like nothing at all until it arrives.
  it('catches a difference of case', () => {
    expect(create({ body: { ar: '{{name}} {{Name}}', en: '{{name}} {{Name}}' } }).success).toBe(false);
  });
});

describe('what stays allowed', () => {
  it('accepts a template whose text uses every declared variable', () => {
    expect(create().success).toBe(true);
  });

  it('accepts a template with no variables and no placeholders', () => {
    expect(create({ variables: [], body: { ar: 'ثابت', en: 'Fixed' } }).success).toBe(true);
  });

  // A subject legitimately summarises; it is not required to carry the whole variable set.
  it('does not require the subject to use every variable', () => {
    expect(create({ subject: { ar: 'تنبيه', en: 'Alert' } }).success).toBe(true);
  });

  it('accepts a variable used more than once', () => {
    expect(create({ body: { ar: '{{name}} و {{name}}', en: '{{name}} and {{name}}' } }).success).toBe(
      true,
    );
  });
});

describe('the same rule on an edit', () => {
  it('refuses a body that drops a variable being declared alongside it', () => {
    expect(
      update({ variables: ['name', 'orphan'], body: { ar: '{{name}}', en: '{{name}}' } }).success,
    ).toBe(false);
  });

  it('accepts a body and variable list that agree', () => {
    expect(
      update({ variables: ['name'], body: { ar: '{{name}}', en: '{{name}}' } }).success,
    ).toBe(true);
  });

  /**
   * A partial edit names one half; the other is carried forward by the service, and the schema
   * cannot see it. Rather than guess, the schema passes and the SERVER checks the merged version —
   * which is the only place the whole template is known. `templateContentDisagreement` is that
   * check, and these two cases pin the seam so it cannot be quietly dropped.
   */
  it('lets a one-sided edit through, because the schema cannot see the other half', () => {
    expect(update({ body: { ar: 'أي شيء', en: 'anything' } }).success).toBe(true);
    expect(update({ variables: ['whatever'] }).success).toBe(true);
  });

  it('still refuses a status-only edit that names nothing else', () => {
    expect(update({ status: 'inactive' }).success).toBe(true); // nothing to disagree with
  });
});

describe('templateContentDisagreement — the merged-version check', () => {
  const merged = (over: Record<string, unknown> = {}) =>
    templateContentDisagreement({
      subject: null,
      body: { ar: '{{name}}', en: '{{name}}' },
      variables: ['name'],
      ...over,
    } as Parameters<typeof templateContentDisagreement>[0]);

  it('returns null when the merged version agrees', () => {
    expect(merged()).toBeNull();
  });

  it('reports a declared variable the merged body never uses', () => {
    expect(merged({ variables: ['name', 'ghost'] })).toContain('"ghost"');
  });

  it('reports an undeclared placeholder in the merged body', () => {
    expect(merged({ body: { ar: '{{name}}{{x}}', en: '{{name}}{{x}}' } })).toContain('"x"');
  });

  it('checks the merged subject too', () => {
    expect(merged({ subject: { ar: '{{q}}', en: '{{q}}' } })).toContain('"q"');
  });
});
