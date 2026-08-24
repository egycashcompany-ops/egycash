// The announcement template, checked against the platform's own rule for a template.
//
// WHY THIS FILE EXISTS. The first version of this template declared four variables — `titleAr`,
// `titleEn`, `bodyAr`, `bodyEn` — with `body.ar` using only the Arabic pair and `body.en` only the
// English one. That is refused by `CreateNotificationTemplateSchema`: every declared variable must
// appear in EVERY language body, because a variable a language ignores is data that language
// silently drops.
//
// Nothing caught it here. The seed runs at boot against a real database, so the failure landed in
// CI as every integration test failing at once, with the actual reason — one rejected template —
// buried in a boot log. The rule is a pure function over the template's own content, so it can be
// asked directly, and this asks it.
import { describe, expect, it } from 'vitest';
import { CreateNotificationTemplateSchema } from '@ecms/contracts';

/** The exact payload `ensureAnnouncementTemplate` sends, kept beside the assertion it must pass. */
const TEMPLATE = {
  key: 'hr.announcement',
  category: 'hr' as const,
  priority: 'normal' as const,
  subject: { ar: '{{title}}', en: '{{title}}' },
  body: { ar: '{{title}}\n\n{{body}}', en: '{{title}}\n\n{{body}}' },
  channels: ['inApp', 'email', 'push'] as const,
  variables: ['title', 'body'],
  defaultExpiryHours: null,
};

describe('the announcement template is one the platform will accept', () => {
  it('passes the schema the seed will be validated by', () => {
    const result = CreateNotificationTemplateSchema.safeParse({
      ...TEMPLATE,
      channels: [...TEMPLATE.channels],
    });
    // A failure here is a boot failure on every environment, so the message is worth surfacing.
    expect(result.success ? null : JSON.stringify(result.error.issues)).toBeNull();
  });

  it('declares a subject, which the email channel requires', () => {
    // `channels` includes email, and the schema refuses that combination without a subject.
    expect(TEMPLATE.channels).toContain('email');
    expect(TEMPLATE.subject).not.toBeNull();
  });

  it('uses every declared variable in BOTH language bodies', () => {
    // The rule the four-variable version broke, stated directly.
    for (const language of ['ar', 'en'] as const) {
      for (const variable of TEMPLATE.variables) {
        expect(TEMPLATE.body[language], `body.${language} uses {{${variable}}}`).toContain(
          `{{${variable}}}`,
        );
      }
    }
  });

  it('declares every placeholder it uses, in the subject too', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)].map((m) => m[1] as string);
    const used = new Set([
      ...placeholders(TEMPLATE.body.ar),
      ...placeholders(TEMPLATE.body.en),
      ...placeholders(TEMPLATE.subject.ar),
      ...placeholders(TEMPLATE.subject.en),
    ]);
    for (const name of used) expect(TEMPLATE.variables).toContain(name);
  });
});

// The other half of the same lesson: because the template cannot carry a per-language variable,
// the language split has to happen at SEND time. These pin the partition that does it.
const partition = (
  userIds: readonly string[],
  locales: Map<string, 'ar' | 'en'>,
): Record<'ar' | 'en', string[]> => {
  const groups: Record<'ar' | 'en', string[]> = { ar: [], en: [] };
  for (const userId of userIds) groups[locales.get(userId) ?? 'ar'].push(userId);
  return groups;
};

describe('each reading language is addressed its own copy', () => {
  it('splits recipients by the language they read', () => {
    const groups = partition(
      ['a', 'b', 'c'],
      new Map([
        ['a', 'ar'],
        ['b', 'en'],
        ['c', 'en'],
      ] as [string, 'ar' | 'en'][]),
    );
    expect(groups.ar).toEqual(['a']);
    expect(groups.en).toEqual(['b', 'c']);
  });

  it('never drops somebody whose account the read did not return', () => {
    // A missing row must cost a person nothing — least of all the announcement itself.
    const groups = partition(['a', 'ghost'], new Map([['a', 'en']] as [string, 'ar' | 'en'][]));
    expect([...groups.ar, ...groups.en].sort()).toEqual(['a', 'ghost']);
  });

  it('loses nobody and duplicates nobody across the two groups', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const groups = partition(ids, new Map([['b', 'en']] as [string, 'ar' | 'en'][]));
    expect([...groups.ar, ...groups.en].sort()).toEqual(ids);
  });
});
