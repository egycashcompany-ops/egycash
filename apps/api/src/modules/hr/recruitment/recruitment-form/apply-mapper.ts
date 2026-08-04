// Turns a public form submission into a registration payload.
//
// This file maps; it does NOT validate. Every value it produces is handed to
// `RegisterApplicantSchema` — the same schema the internal form posts through — so a phone typed
// on a public page is judged by exactly the rule a recruiter's phone is judged by. Adding a
// second opinion here is how the two paths would drift.
import {
  RECRUITMENT_FORM_MANDATORY,
  type ApplicantFormAnswerDto,
  type RecruitmentFormBuiltin,
  type RecruitmentFormField,
} from '@ecms/contracts';

export type Answers = Record<string, string | boolean>;

const text = (answers: Answers, key: string): string | undefined => {
  const raw = answers[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
};

const bool = (answers: Answers, key: string): boolean => answers[key] === true || answers[key] === 'true';

const numeric = (answers: Answers, key: string): number | undefined => {
  const raw = text(answers, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Which required questions were left blank. Reported as field keys so the public page can mark
 * the fields themselves rather than showing one sentence about "the form".
 */
export const missingRequired = (fields: RecruitmentFormField[], answers: Answers): string[] =>
  fields
    .filter((f) => {
      const required =
        f.required || (f.type === 'builtin' && RECRUITMENT_FORM_MANDATORY.includes(f.key));
      if (!required) return false;
      // A required checkbox means "must be ticked"; everything else means "must be answered".
      if (f.type === 'custom' && f.kind === 'checkbox') return !bool(answers, f.key);
      return text(answers, f.key) === undefined;
    })
    .map((f) => f.key);

/** The answers to custom questions, each carrying the question it answered. */
export const customAnswers = (
  fields: RecruitmentFormField[],
  answers: Answers,
): ApplicantFormAnswerDto[] =>
  fields.flatMap((f) => {
    if (f.type !== 'custom') return [];
    const value =
      f.kind === 'checkbox' ? (bool(answers, f.key) ? 'true' : 'false') : text(answers, f.key);
    return value === undefined ? [] : [{ key: f.key, label: f.label, value }];
  });

/**
 * The registration body a submission describes — everything except who is registering it and
 * where they came from, which the service supplies from the link.
 */
export const toRegistrationBody = (
  fields: RecruitmentFormField[],
  answers: Answers,
): Record<string, unknown> => {
  // Only answers to questions the form actually asks are read. A payload carrying extra keys
  // cannot reach a column the admin did not publish.
  const asked = new Set(
    fields.filter((f) => f.type === 'builtin').map((f) => f.key as RecruitmentFormBuiltin),
  );
  const ask = (key: RecruitmentFormBuiltin): string | undefined =>
    asked.has(key) ? text(answers, key) : undefined;

  const line1 = ask('addressLine1');
  const city = ask('city');
  const governorate = ask('governorate');
  // The API stores an address only when all three are present, so a partial one is dropped here
  // rather than sent and silently discarded.
  const address =
    line1 !== undefined && city !== undefined && governorate !== undefined
      ? { line1, city, governorate }
      : undefined;

  const level = ask('educationLevel');
  const specialization = ask('educationSpecialization');
  const salary = asked.has('expectedSalary') ? numeric(answers, 'expectedSalary') : undefined;
  const military = ask('militaryStatus');
  const custom = customAnswers(fields, answers);

  return {
    identity: {
      fullNameAr: text(answers, 'fullNameAr') ?? '',
      ...(ask('fullNameEn') === undefined ? {} : { fullNameEn: ask('fullNameEn') }),
      ...(ask('nationalId') === undefined ? {} : { nationalId: ask('nationalId') }),
      ...(ask('maritalStatus') === undefined ? {} : { maritalStatus: ask('maritalStatus') }),
      nationality: 'Egyptian',
    },
    contact: {
      primaryPhone: text(answers, 'primaryPhone') ?? '',
      ...(ask('secondaryPhone') === undefined ? {} : { secondaryPhone: ask('secondaryPhone') }),
      ...(ask('email') === undefined ? {} : { email: ask('email') }),
    },
    ...(address === undefined ? {} : { officialAddress: address }),
    ...(level === undefined
      ? {}
      : { education: { level, ...(specialization === undefined ? {} : { specialization }) } }),
    ...(military === undefined ? {} : { military: { status: military } }),
    ...(salary === undefined ? {} : { expectedSalary: { amount: salary, currency: 'EGP' } }),
    ...(asked.has('willingToRelocate') ? { willingToRelocate: bool(answers, 'willingToRelocate') } : {}),
    ...(custom.length === 0 ? {} : { formAnswers: custom }),
  };
};
