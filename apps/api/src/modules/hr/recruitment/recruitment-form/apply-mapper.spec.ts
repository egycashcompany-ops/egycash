import { describe, expect, it } from 'vitest';
import {
  RecruitmentFormSnapshotSchema,
  RegisterApplicantSchema,
  type RecruitmentFormField,
} from '@ecms/contracts';
import { customAnswers, invalidCustom, missingRequired, toRegistrationBody } from './apply-mapper';

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

describe('invalidCustom', () => {
  const custom = (key: string, kind: string, options: { ar: string; en: string }[] = []) =>
    ({
      type: 'custom',
      key,
      kind,
      label: { ar: key, en: key },
      required: false,
      options,
    }) as unknown as RecruitmentFormField;

  it("holds a custom answer to its question's kind", () => {
    const fields = [
      custom('salary', 'number'),
      custom('start', 'date'),
      custom('shift', 'select', [
        { ar: 'صباحي', en: 'Morning' },
        { ar: 'مسائي', en: 'Evening' },
      ]),
    ];
    expect(invalidCustom(fields, { salary: '5000', start: '2026-01-31', shift: 'صباحي' })).toEqual([]);
    expect(invalidCustom(fields, { salary: 'كتير' })).toEqual([
      { field: 'salary', message: 'applicants.validation.number' },
    ]);
    expect(invalidCustom(fields, { start: '31/01/2026' })).toEqual([
      { field: 'start', message: 'applicants.validation.date' },
    ]);
    // A choice nobody was offered cannot be smuggled in by a crafted payload.
    expect(invalidCustom(fields, { shift: 'ليلي' })).toEqual([
      { field: 'shift', message: 'applicants.validation.choice' },
    ]);
  });

  it('leaves an unanswered optional question alone', () => {
    expect(invalidCustom([custom('salary', 'number')], {})).toEqual([]);
    expect(invalidCustom([custom('salary', 'number')], { salary: '  ' })).toEqual([]);
  });
});

// The snapshot has to be enough to REDRAW the form a candidate saw, a year later, without the
// live form. That means the order, the required flag, the kind, the label and a select's options
// must all survive it — asserted here rather than assumed from the type.
describe('form snapshot completeness', () => {
  const published: RecruitmentFormField[] = [
    { type: 'builtin', key: 'fullNameAr', required: true },
    {
      type: 'custom',
      key: 'shift',
      kind: 'select',
      label: { ar: 'الوردية المفضلة', en: 'Preferred shift' },
      required: true,
      options: [
        { ar: 'صباحي', en: 'Morning' },
        { ar: 'مسائي', en: 'Evening' },
      ],
    },
    { type: 'builtin', key: 'primaryPhone', required: true },
  ];

  it('carries order, required, kind, label and options through the schema unchanged', () => {
    const parsed = RecruitmentFormSnapshotSchema.safeParse({
      title: { ar: 'طلب توظيف', en: 'Job application' },
      formVersion: 7,
      fields: published,
      submittedAt: '2026-08-04T12:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // Order — the array IS the order the candidate saw.
    expect(parsed.data.fields.map((f) => f.key)).toEqual(['fullNameAr', 'shift', 'primaryPhone']);
    // Required as it stood then, not as it stands now.
    expect(parsed.data.fields.map((f) => f.required)).toEqual([true, true, true]);
    // Kind, label and the choices that were actually offered.
    const shift = parsed.data.fields[1];
    expect(shift?.type).toBe('custom');
    if (shift?.type !== 'custom') return;
    expect(shift.kind).toBe('select');
    expect(shift.label).toEqual({ ar: 'الوردية المفضلة', en: 'Preferred shift' });
    expect(shift.options).toEqual([
      { ar: 'صباحي', en: 'Morning' },
      { ar: 'مسائي', en: 'Evening' },
    ]);
    expect(parsed.data.formVersion).toBe(7);
  });

  it('is untouched by what the live form becomes afterwards', () => {
    const snapshot = RecruitmentFormSnapshotSchema.parse({
      title: { ar: 'طلب توظيف', en: 'Job application' },
      formVersion: 7,
      fields: published,
      submittedAt: '2026-08-04T12:00:00.000Z',
    });
    // The form moves on: the question is dropped and the rest reordered.
    const liveNow: RecruitmentFormField[] = [
      { type: 'builtin', key: 'primaryPhone', required: true },
      { type: 'builtin', key: 'fullNameAr', required: true },
    ];
    expect(liveNow.some((f) => f.key === 'shift')).toBe(false);
    // The old application still knows what it was asked, and in what order.
    expect(snapshot.fields.map((f) => f.key)).toEqual(['fullNameAr', 'shift', 'primaryPhone']);
  });
});
