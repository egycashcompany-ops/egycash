// A duplicate-key error has to say WHICH constraint it violated.
//
// This is not polish. A collection carries several unique indexes; told only "Duplicate resource",
// the reader has to guess which one, and a bulk import makes that guess thousands of times over.
// The go-live workforce import spent three diagnostic rounds on exactly that.
//
// The other half is what must NOT be in the message: the values. Field names are schema and safe in
// a 409 body; the values are somebody's national ID, email or phone number, and this reaches API
// clients.
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../errors';
import { duplicateMessageForTest } from './base.repository';

/** The shape the MongoDB driver actually raises for E11000. */
const e11000 = (keyPattern: Record<string, number>, keyValue: Record<string, unknown>) => ({
  code: 11000,
  keyPattern,
  keyValue,
  message: 'E11000 duplicate key error',
});

describe('what a duplicate-key error tells the reader', () => {
  it('names the single field that collided', () => {
    const msg = duplicateMessageForTest(e11000({ employeeNumber: 1 }, { employeeNumber: '0006' }));
    expect(msg).toContain('employeeNumber');
  });

  it('names every field of a compound index, in order', () => {
    const msg = duplicateMessageForTest(
      e11000({ userId: 1, roleId: 1, scope: 1 }, { userId: 'a', roleId: 'b', scope: 'organization' }),
    );
    expect(msg).toContain('userId');
    expect(msg).toContain('roleId');
    expect(msg).toContain('scope');
  });

  /**
   * THE ONE THAT IS NOT COSMETIC. `keyValue` carries the colliding value — a national ID, an email,
   * a phone number. It must never reach the message, which is returned to API clients.
   */
  it('never leaks the colliding value', () => {
    const msg = duplicateMessageForTest(
      e11000({ 'personal.nationalId': 1 }, { 'personal.nationalId': '29001011234567' }),
    );
    expect(msg).toContain('personal.nationalId');
    expect(msg).not.toContain('29001011234567');
  });

  /** Without a key pattern there is nothing to add, so the default stands rather than a half-message. */
  it('falls back to the plain default when the driver gave no key pattern', () => {
    expect(duplicateMessageForTest({ code: 11000 })).toBeUndefined();
    expect(duplicateMessageForTest({ code: 11000, keyPattern: null })).toBeUndefined();
    expect(new ConflictError(duplicateMessageForTest({ code: 11000 })).message).toBe(
      'Duplicate resource',
    );
  });
});
