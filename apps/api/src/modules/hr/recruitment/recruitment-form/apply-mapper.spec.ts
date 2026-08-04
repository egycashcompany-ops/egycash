import { describe, expect, it } from 'vitest';
import { RegisterApplicantSchema, type RecruitmentFormField } from '@ecms/contracts';
import { customAnswers, missingRequired, toRegistrationBody } from './apply-mapper';

const builtin = (key: string, required = false): RecruitmentFormField =>
  ({ type: 'builtin', key, required }) as RecruitmentFormField;

const DEFAULTS: RecruitmentFormField[] = [
  builtin('fullNameAr', true),
  builtin('nationalId'),
  builtin('primaryPhone', true),
  builtin('educationLevel'),
];

describe('missingRequired', () => {
  it('names the fields a candidate left blank', () => {
    expect(missingRequired(DEFAULTS, { fullNameAr: 'أحمد محمد' })).toEqual(['primaryPhone']);
    expect(missingRequired(DEFAULTS, { fullNameAr: '  ', primaryPhone: '01012345678' })).toEqual([
      'fullNameAr',
    ]);
    expect(missingRequired(DEFAULTS, { fullNameAr: 'أحمد', primaryPhone: '01012345678' })).toEqual([]);
  });

  it('holds name and phone required even when the stored form says otherwise', () => {
    // Belt and braces: the schema refuses to save such a form, and the mapper refuses to honour
    // one that got in some other way.
    const tampered = [builtin('fullNameAr', false), builtin('primaryPhone', false)];
    expect(missingRequired(tampered, {})).toEqual(['fullNameAr', 'primaryPhone']);
  });

  it('reads a required checkbox as "must be ticked"', () => {
    const consent: RecruitmentFormField = {
      type: 'custom',
      key: 'consent',
      kind: 'checkbox',
      label: { ar: 'الموافقة', en: 'Consent' },
      required: true,
      options: [],
    };
    expect(missingRequired([consent], { consent: false })).toEqual(['consent']);
    expect(missingRequired([consent], { consent: true })).toEqual([]);
  });
});

describe('toRegistrationBody', () => {
  const answers = {
    fullNameAr: '  أحمد محمد  ',
    nationalId: '29001011201234',
    primaryPhone: '010 1234 5678',
    educationLevel: 'bachelor',
  };

  it('produces a body the REAL registration schema accepts', () => {
    const parsed = RegisterApplicantSchema.safeParse({
      sourceId: '6a71ba261db68a923e529cf8',
      intakeChannel: 'web',
      ...toRegistrationBody(DEFAULTS, answers),
    });
    expect(parsed.success).toBe(true);
    // The shared rules did their work on the way through: the phone is normalised, not echoed.
    expect(parsed.success && parsed.data.contact.primaryPhone).toBe('01012345678');
    expect(parsed.success && parsed.data.identity.fullNameAr).toBe('أحمد محمد');
  });

  it('cannot reach a column the published form does not ask about', () => {
    // A hand-crafted payload carrying an answer to a question that is not on the form must not
    // set that column — the form is the allow-list.
    const body = toRegistrationBody(DEFAULTS, { ...answers, email: 'sneaky@example.com' });
    expect((body.contact as Record<string, unknown>).email).toBeUndefined();
  });

  it('drops a half-answered address rather than sending one the API will discard', () => {
    const fields = [...DEFAULTS, builtin('city'), builtin('governorate'), builtin('addressLine1')];
    expect(toRegistrationBody(fields, { ...answers, city: 'الدقي' }).officialAddress).toBeUndefined();
    const full = toRegistrationBody(fields, {
      ...answers,
      city: 'الدقي',
      governorate: 'الجيزة',
      addressLine1: '5 شارع',
    });
    expect(full.officialAddress).toEqual({ line1: '5 شارع', city: 'الدقي', governorate: 'الجيزة' });
  });

  it('lets the shared rules reject a bad answer instead of judging it here', () => {
    const parsed = RegisterApplicantSchema.safeParse({
      sourceId: '6a71ba261db68a923e529cf8',
      intakeChannel: 'web',
      ...toRegistrationBody(DEFAULTS, { ...answers, primaryPhone: '013 1234 5678' }),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('customAnswers', () => {
  it('keeps each answer with the question it answered', () => {
    const fields: RecruitmentFormField[] = [
      builtin('fullNameAr', true),
      {
        type: 'custom',
        key: 'noticePeriod',
        kind: 'text',
        label: { ar: 'مدة الإخطار', en: 'Notice period' },
        required: false,
        options: [],
      },
      {
        type: 'custom',
        key: 'ownsCar',
        kind: 'checkbox',
        label: { ar: 'يمتلك سيارة', en: 'Owns a car' },
        required: false,
        options: [],
      },
    ];
    expect(customAnswers(fields, { noticePeriod: 'شهر', ownsCar: true })).toEqual([
      { key: 'noticePeriod', label: { ar: 'مدة الإخطار', en: 'Notice period' }, value: 'شهر' },
      { key: 'ownsCar', label: { ar: 'يمتلك سيارة', en: 'Owns a car' }, value: 'true' },
    ]);
  });

  it('skips unanswered optional questions rather than storing empty rows', () => {
    const fields: RecruitmentFormField[] = [
      {
        type: 'custom',
        key: 'noticePeriod',
        kind: 'text',
        label: { ar: 'مدة الإخطار', en: 'Notice period' },
        required: false,
        options: [],
      },
    ];
    expect(customAnswers(fields, { noticePeriod: '   ' })).toEqual([]);
  });
});
