// The rules, exercised where they are cheap to exercise.
//
// Every case here is a sentence somebody agreed to in §5 of the design. The ones worth reading are
// the two asymmetries: a refusal reopens a slot while an acceptance closes it, and a refused slot
// is NOT missing.
import { describe, expect, it } from 'vitest';
import {
  isComplete,
  licenseClassProblem,
  mayReplace,
  mayReview,
  missingFor,
  pendingReviewCount,
  typesFor,
  type DocumentTypeFacts,
  type HandedInFacts,
} from './applicant-document-rules';

const type = (over: Partial<DocumentTypeFacts> & { id: string; key: string }): DocumentTypeFacts => ({
  applicability: 'all',
  required: true,
  licenseClassRequired: false,
  order: 0,
  active: true,
  ...over,
});

const QUALIFICATION = type({ id: 't1', key: 'qualification', order: 1 });
const BIRTH = type({ id: 't2', key: 'birthCertificate', order: 2 });
const LICENCE = type({
  id: 't5',
  key: 'professionalDrivingLicense',
  applicability: 'driversOnly',
  licenseClassRequired: true,
  order: 5,
});
const OPTIONAL = type({ id: 't9', key: 'extra', required: false, order: 9 });

describe('D-APP-5 — the seat decides who owes a licence, not the person', () => {
  it('asks a driver for the licence', () => {
    expect(typesFor([QUALIFICATION, LICENCE], true).map((t) => t.key)).toEqual([
      'qualification',
      'professionalDrivingLicense',
    ]);
  });

  it('does not ask anybody else', () => {
    expect(typesFor([QUALIFICATION, LICENCE], false).map((t) => t.key)).toEqual(['qualification']);
  });

  it('leaves a retired type out without forgetting it exists', () => {
    const retired = type({ id: 't3', key: 'gone', active: false });
    expect(typesFor([QUALIFICATION, retired], true).map((t) => t.key)).toEqual(['qualification']);
  });

  it('orders by `order`, then by key so the list never shuffles between reads', () => {
    const a = type({ id: 'a', key: 'aaa', order: 3 });
    const b = type({ id: 'b', key: 'bbb', order: 3 });
    expect(typesFor([b, a, BIRTH], false).map((t) => t.key)).toEqual(['birthCertificate', 'aaa', 'bbb']);
  });
});

describe('D-APP-7ج — a refusal reopens the slot, an acceptance closes it', () => {
  it('lets the candidate replace what nobody has ruled on', () => {
    expect(mayReplace('pending')).toBe(true);
  });

  it('lets the candidate replace what was REFUSED — that is what the refusal asked for', () => {
    expect(mayReplace('rejected')).toBe(true);
  });

  it('refuses to let an accepted document be swapped underneath the person who accepted it', () => {
    expect(mayReplace('accepted')).toBe(false);
  });
});

describe('HR rules once', () => {
  it('reviews what is waiting', () => {
    expect(mayReview('pending')).toBe(true);
  });

  it('does not re-decide a settled slot', () => {
    expect(mayReview('accepted')).toBe(false);
    expect(mayReview('rejected')).toBe(false);
  });
});

describe('what is still missing', () => {
  const asked = [QUALIFICATION, BIRTH];

  it('is what was never handed in', () => {
    const handed: HandedInFacts[] = [{ typeId: 't1', status: 'pending' }];
    expect(missingFor(asked, handed).map((t) => t.key)).toEqual(['birthCertificate']);
  });

  it('does NOT include a refused slot — something was handed in, and a reason is sitting on it', () => {
    const handed: HandedInFacts[] = [
      { typeId: 't1', status: 'rejected' },
      { typeId: 't2', status: 'accepted' },
    ];
    expect(missingFor(asked, handed)).toEqual([]);
  });
});

describe('whether the candidate is finished', () => {
  const asked = [QUALIFICATION, BIRTH, OPTIONAL];

  it('is finished when everything required is in and nothing is refused', () => {
    expect(
      isComplete(asked, [
        { typeId: 't1', status: 'accepted' },
        { typeId: 't2', status: 'pending' },
      ]),
    ).toBe(true);
  });

  it('is NOT finished while something they handed in stands refused', () => {
    expect(
      isComplete(asked, [
        { typeId: 't1', status: 'rejected' },
        { typeId: 't2', status: 'accepted' },
      ]),
    ).toBe(false);
  });

  it('is not held up by an optional slot nobody filled', () => {
    expect(
      isComplete(asked, [
        { typeId: 't1', status: 'accepted' },
        { typeId: 't2', status: 'accepted' },
      ]),
    ).toBe(true);
  });

  it('waiting on HR still counts as the candidate having done their part', () => {
    expect(pendingReviewCount([{ typeId: 't1', status: 'pending' }, { typeId: 't2', status: 'accepted' }])).toBe(1);
  });
});

describe('D-APP-6 — the licence class is asked for exactly where it means something', () => {
  it('refuses a professional licence handed in without one', () => {
    expect(licenseClassProblem(LICENCE, undefined)).toBe('missing');
  });

  it('accepts it when stated', () => {
    expect(licenseClassProblem(LICENCE, 'first')).toBeNull();
  });

  it('refuses a class stated on a document that has no such thing', () => {
    expect(licenseClassProblem(BIRTH, 'second')).toBe('unexpected');
  });

  it('is content with a birth certificate that states nothing', () => {
    expect(licenseClassProblem(BIRTH, undefined)).toBeNull();
  });
});
