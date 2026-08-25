// The editor's rules, as data — separate from the dialog that renders them.
//
// This suite has no DOM, so a form's behaviour cannot be exercised by typing into it. Everything
// here is therefore a pure function over the draft: what the variable list should be, whether the
// draft is submittable, and what the server would refuse. The dialog is then thin enough that
// rendering it proves nothing the eye cannot already see.
//
// **The variable list is DERIVED, never typed.** G-2 requires the declared variables and the text
// to agree exactly, in both directions and in both languages, and an editor with two fields to keep
// in step is an editor that produces 400s. So the placeholders in the text ARE the variable list;
// the screen shows what it found and the administrator edits only the text.
import {
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPriority,
  type NotificationTemplateDto,
  type TemplateStatus,
} from '@ecms/contracts';

export interface TemplateDraft {
  key: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  subjectAr: string;
  subjectEn: string;
  bodyAr: string;
  bodyEn: string;
  channels: NotificationChannel[];
  defaultExpiryHours: string;
  status: TemplateStatus;
}

const PLACEHOLDER = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/** Every `{{name}}` in a piece of text, in the order it first appears. */
export const placeholdersIn = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string)),
];

/** Everything one language SAYS — its subject and its body together. */
const saidIn = (subject: string, body: string): string[] => [
  ...new Set([...placeholdersIn(subject), ...placeholdersIn(body)]),
];

/**
 * The variable list the draft implies.
 *
 * Counted across the SUBJECT and the body, not the body alone. The server's rule asks whether the
 * message says a variable anywhere, and this has to ask the same question — when it asked only of
 * the bodies, a template whose title lives in the subject (`hr.announcement`, and any template
 * shaped like it) reported that title as declared by nothing, and the form refused to save. Not
 * for one edit: for every edit, for ever, with no way to clear the problem except to undo the
 * template.
 *
 * Still intersected across languages. G-2 checks per language, so a placeholder only one language
 * says cannot be declared — declaring it would fail against the other.
 */
export const derivedVariables = (draft: TemplateDraft): string[] => {
  const ar = new Set(saidIn(draft.subjectAr, draft.bodyAr));
  return saidIn(draft.subjectEn, draft.bodyEn).filter((name) => ar.has(name));
};

/**
 * Placeholders one language says and the other does not — G-2 would refuse the draft.
 *
 * Over the subject and the body together, for the same reason `derivedVariables` is: a title
 * present in `subject.ar` and missing from `subject.en` is exactly the one-sided mistake this
 * exists to name, and looking only at bodies never saw it.
 */
export const unbalancedPlaceholders = (
  draft: TemplateDraft,
): { name: string; missingFrom: 'ar' | 'en' }[] => {
  const ar = new Set(saidIn(draft.subjectAr, draft.bodyAr));
  const en = new Set(saidIn(draft.subjectEn, draft.bodyEn));
  return [
    ...[...ar]
      .filter((name) => !en.has(name))
      .map((name) => ({ name, missingFrom: 'en' as const })),
    ...[...en]
      .filter((name) => !ar.has(name))
      .map((name) => ({ name, missingFrom: 'ar' as const })),
  ];
};

/** Every reason the server would refuse this draft, in the order a reader should see them. */
export const draftProblems = (draft: TemplateDraft, isCreate: boolean): string[] => {
  const problems: string[] = [];
  if (isCreate && !/^[a-z][a-zA-Z0-9.]{1,99}$/.test(draft.key)) problems.push('key');
  if (draft.bodyAr.trim() === '' || draft.bodyEn.trim() === '') problems.push('bodyRequired');
  if (draft.channels.length === 0) problems.push('channelRequired');
  // The API's own rule: an email needs something to put in the subject line.
  if (
    draft.channels.includes('email') &&
    (draft.subjectAr.trim() === '' || draft.subjectEn.trim() === '')
  ) {
    problems.push('subjectRequired');
  }
  // `unbalanced` now covers the subject as well as the bodies, so the separate
  // "the subject uses something nothing declares" check is gone: it could only ever fire for a
  // placeholder one language was missing, which this already reports — and reports better, by
  // naming the language it is missing from.
  if (unbalancedPlaceholders(draft).length > 0) problems.push('unbalanced');
  const hours = draft.defaultExpiryHours.trim();
  if (hours !== '' && !/^\d+$/.test(hours)) problems.push('expiry');
  else if (hours !== '' && (Number(hours) < 1 || Number(hours) > 8760)) problems.push('expiry');
  return problems;
};

const orNull = (ar: string, en: string): { ar: string; en: string } | null =>
  ar.trim() === '' && en.trim() === '' ? null : { ar, en };

/** The create body, with `variables` derived rather than taken from the draft. */
export const toCreateBody = (draft: TemplateDraft) => ({
  key: draft.key,
  category: draft.category,
  priority: draft.priority,
  subject: orNull(draft.subjectAr, draft.subjectEn),
  body: { ar: draft.bodyAr, en: draft.bodyEn },
  channels: draft.channels,
  variables: derivedVariables(draft),
  defaultExpiryHours:
    draft.defaultExpiryHours.trim() === '' ? null : Number(draft.defaultExpiryHours),
});

/**
 * The update body. `body` and `variables` are always sent TOGETHER, which is what keeps the
 * schema able to see both halves of the G-2 rule — a one-sided edit passes the schema and is
 * caught later by the server, with a message that reads as a surprise.
 */
export const toUpdateBody = (draft: TemplateDraft) => ({
  category: draft.category,
  priority: draft.priority,
  subject: orNull(draft.subjectAr, draft.subjectEn),
  body: { ar: draft.bodyAr, en: draft.bodyEn },
  channels: draft.channels,
  variables: derivedVariables(draft),
  defaultExpiryHours:
    draft.defaultExpiryHours.trim() === '' ? null : Number(draft.defaultExpiryHours),
});

export const draftFrom = (template: NotificationTemplateDto): TemplateDraft => ({
  key: template.key,
  category: template.category,
  priority: template.priority,
  subjectAr: template.subject?.ar ?? '',
  subjectEn: template.subject?.en ?? '',
  bodyAr: template.body.ar,
  bodyEn: template.body.en,
  channels: [...template.channels],
  defaultExpiryHours:
    template.defaultExpiryHours === null ? '' : String(template.defaultExpiryHours),
  status: template.status,
});

export const emptyDraft = (): TemplateDraft => ({
  key: '',
  category: 'system',
  priority: 'normal',
  subjectAr: '',
  subjectEn: '',
  bodyAr: '',
  bodyEn: '',
  channels: [...NOTIFICATION_CHANNELS].filter((c) => c === 'inApp'),
  defaultExpiryHours: '',
  status: 'active',
});
