// The create-login form opens on what the system already knows about this person.
//
// It opened BLANK: six empty boxes asking an HR officer to type the name — in two languages — of an
// employee whose record was on the screen behind the dialog, plus a phone the record also holds and
// an email marked required that most records do not have at all. Nothing about that was a data
// problem; every answer was already stored and simply was not read.
//
// `apps/web` has no jsdom, so a dialog that only mounts on a click cannot be rendered here. What
// decides the boxes' contents is `initialDraft`, a pure function of the employee — `useState(() =>
// initialDraft(employee))` is the whole of the wiring — so that is what this pins, together with
// the guarantee the dialog rests on: what it produces is submittable.
import { describe, expect, it } from 'vitest';
import { CreateEmployeeLoginSchema, type EmployeeDto } from '@ecms/contracts';
import { initialDraft } from './components/EmployeeAccountCard';

const employee = (over: {
  fullNameAr?: string;
  fullNameEn?: string | null;
  email?: string | null;
  primaryPhone?: string;
  code?: string;
} = {}): EmployeeDto =>
  ({
    id: 'e1',
    code: over.code ?? '0101032',
    personal: {
      fullNameAr: over.fullNameAr ?? 'محمد أحمد علي حسن',
      fullNameEn: over.fullNameEn === undefined ? 'Mohamed Ahmed Ali Hassan' : over.fullNameEn,
      contact: {
        primaryPhone: over.primaryPhone ?? '01001234567',
        secondaryPhone: null,
        email: over.email === undefined ? 'm.ahmed@egycash.com' : over.email,
        preferredContactChannel: null,
      },
    },
  }) as unknown as EmployeeDto;

describe('the create-login form opens filled in', () => {
  it('fills every box the employee record can answer', () => {
    expect(initialDraft(employee())).toEqual({
      email: 'm.ahmed@egycash.com',
      username: '0101032',
      firstName: { ar: 'محمد', en: 'Mohamed' },
      lastName: { ar: 'أحمد علي حسن', en: 'Ahmed Ali Hassan' },
      phone: '01001234567',
    });
  });

  it('splits the name the way the SERVER does when it provisions an account at hire', () => {
    // Both sides call `loginProfileNames`. An account created by hand and one created at hire must
    // carry the same name for the same person, or the two paths quietly disagree.
    const draft = initialDraft(employee({ fullNameAr: 'عبد الرحمن محمد علي' }));
    expect(draft.firstName.ar).toBe('عبد');
    expect(draft.lastName.ar).toBe('الرحمن محمد علي');
  });

  it('leaves the email box EMPTY rather than inventing one, when the record has none', () => {
    expect(initialDraft(employee({ email: null })).email).toBe('');
  });

  it('falls back to the Arabic name when the record carries no English one', () => {
    const draft = initialDraft(employee({ fullNameEn: null }));
    expect(draft.firstName).toEqual({ ar: 'محمد', en: 'محمد' });
    expect(draft.lastName).toEqual({ ar: 'أحمد علي حسن', en: 'أحمد علي حسن' });
  });

  it('the username is the Employee Code, which is what makes the email optional', () => {
    expect(initialDraft(employee({ code: '0209988' })).username).toBe('0209988');
  });

  it('produces a body the endpoint ACCEPTS — with an email and without one', () => {
    // The point of the fallback and of the code-as-username: whatever the record holds, the form
    // opens on something that can be submitted without a single keystroke.
    for (const record of [employee(), employee({ email: null, fullNameEn: null })]) {
      const draft = initialDraft(record);
      const body = {
        ...(draft.email === '' ? {} : { email: draft.email }),
        username: draft.username,
        firstName: draft.firstName,
        lastName: draft.lastName,
        phone: draft.phone,
        locale: 'ar' as const,
      };
      const parsed = CreateEmployeeLoginSchema.safeParse(body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('a one-word name still fills both boxes, so the form is submittable', () => {
    const draft = initialDraft(employee({ fullNameAr: 'محمد', fullNameEn: null }));
    expect(draft.firstName).toEqual({ ar: 'محمد', en: 'محمد' });
    expect(draft.lastName).toEqual({ ar: 'محمد', en: 'محمد' });
  });
});
