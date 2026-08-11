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

/**
 * The variable list the draft implies.
 *
 * Only placeholders present in BOTH bodies count. G-2 checks per language, so a placeholder in one
 * body alone cannot be declared — declaring it would fail against the other. Showing it as
 * "detected" and then having the server refuse would be the worst of both, so it is reported
 * separately by `unbalancedPlaceholders` and the screen says which language is missing it.
 */
export const derivedVariables = (draft: TemplateDraft): string[] => {
  const ar = new Set(placeholdersIn(draft.bodyAr));
  return placeholdersIn(draft.bodyEn).filter((name) => ar.has(name));
};

/** Placeholders that appear in one body but not the other — G-2 would refuse the draft. */
export const unbalancedPlaceholders = (
  draft: TemplateDraft,
): { name: string; missingFrom: 'ar' | 'en' }[] => {
  const ar = new Set(placeholdersIn(draft.bodyAr));
  const en = new Set(placeholdersIn(draft.bodyEn));
  return [
    ...placeholdersIn(draft.bodyAr)
      .filter((name) => !en.has(name))
      .map((name) => ({ name, missingFrom: 'en' as const })),
    ...placeholdersIn(draft.bodyEn)
      .filter((name) => !ar.has(name))
      .map((name) => ({ name, missingFrom: 'ar' as const })),
  ];
};

/**
 * Placeholders used in the SUBJECT that the bodies do not declare.
 *
 * A subject need not carry every variable, but anything it uses must be declared — and the
 * declaration comes from the bodies. So a subject-only placeholder is a refusal.
 */
export const undeclaredSubjectPlaceholders = (draft: TemplateDraft): string[] => {
  const declared = new Set(derivedVariables(draft));
  return [...placeholdersIn(draft.subjectAr), ...placeholdersIn(draft.subjectEn)].filter(
    (name) => !declared.has(name),
  );
};

/** Every reason the server would refuse this draft, in the order a reader should see them. */
export const draftProblems = (draft: TemplateDraft, isCreate: boolean): string[] => {
  const problems: string[] = [];
  if (isCreate && !/^[a-z][a-zA-Z0-9.]{1,99}$/.test(draft.key)) problems.push('key');
  if (draft.bodyAr.trim() === '' || draft.bodyEn.trim() === '') problems.push('bodyRequired');
  if (draft.channels.length === 0) problems.push('channelRequired');
  // The API's own rule: an email needs something to put in the subject line.
  if (draft.channels.includes('email') && (draft.subjectAr.trim() === '' || draft.subjectEn.trim() === '')) {
    problems.push('subjectRequired');
  }
  if (unbalancedPlaceholders(draft).length > 0) problems.push('unbalanced');
  if (undeclaredSubjectPlaceholders(draft).length > 0) problems.push('subjectUndeclared');
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
