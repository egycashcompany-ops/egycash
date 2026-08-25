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
import { ANNOUNCEMENT_TEMPLATE } from './announcement.seed';

/**
 * The payload the seed ACTUALLY sends — imported, not copied.
 *
 * It used to be a copy of these fields sitting here. When the seed changed, the copy did not, and
 * this suite went on passing while validating a template nobody sends. One definition is the only
 * version of this that stays true.
 */
const TEMPLATE = ANNOUNCEMENT_TEMPLATE;

/**
 * The subject, asserted present once rather than narrowed at ten call sites.
 *
 * `CreateNotificationTemplate` allows a null subject — a template may legitimately have none — but
 * this one's whole point is that the title lives there. If it ever became null the duplicate would
 * be back, so that is a failure, not a branch to handle.
 */
const subject = TEMPLATE.subject;
if (subject === null || subject === undefined) {
  throw new Error('the announcement template must carry a subject — the title lives in it');
}

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

  it('says every declared variable in each language, in the subject or the body', () => {
    // The rule the four-variable version broke, stated directly — and it counts BOTH texts. A
    // variable the subject carries is not one the message loses.
    for (const language of ['ar', 'en'] as const) {
      const said = `${subject[language]} ${TEMPLATE.body[language]}`;
      for (const variable of TEMPLATE.variables) {
        expect(said, `${language} says {{${variable}}}`).toContain(`{{${variable}}}`);
      }
    }
  });

  it('says the title ONCE — the duplicate every recipient saw', () => {
    // A notification renders its title and its body. With `{{title}}` in both, every announcement
    // showed its title twice, on every screen, to everybody.
    for (const language of ['ar', 'en'] as const) {
      expect(TEMPLATE.body[language], `body.${language} repeats the title`).not.toContain(
        '{{title}}',
      );
      expect(subject[language]).toContain('{{title}}');
    }
  });

  it('declares every placeholder it uses, in the subject too', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)].map((m) => m[1] as string);
    const used = new Set([
      ...placeholders(TEMPLATE.body.ar),
      ...placeholders(TEMPLATE.body.en),
      ...placeholders(subject.ar),
      ...placeholders(subject.en),
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
