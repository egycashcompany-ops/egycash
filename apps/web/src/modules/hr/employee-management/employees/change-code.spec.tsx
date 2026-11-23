// Changing the Employee Code by hand — «عايزك تعمل إمكانية تغيير كود الموظف».
//
// Pinned at the source and through `translate()`: the dialog sits behind a menu, a permission and a
// mutation, which a static render cannot reach, while the properties that matter are plainly
// readable in the files.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { employeeCodePatternFor, type Locale } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const MENU = readFileSync(join(HERE, 'components/actions/ActionsMenu.tsx'), 'utf8');
const DIALOG = readFileSync(join(HERE, 'components/actions/ChangeCodeDialog.tsx'), 'utf8');
const LOCALES: Locale[] = ['en', 'ar'];

describe('changing an employee code by hand', () => {
  /** Its own key — not a side effect of being allowed to edit personal data. */
  it('is offered only to a holder of employee.changeCode', () => {
    expect(MENU).toContain("const changeCode = can('employee.changeCode');");
    expect(MENU).toContain("if (changeCode) items.push({ kind: 'changeCode'");
  });

  it('checks the code\'s shape before sending, with the same rule the server uses', () => {
    expect(DIALOG).toContain('employeeCodePatternFor(employee.origin).test(next)');
  });

  // «لما باجي أغير كود الموظف (تعيين خارجي) مش بيسمح بكتابه حروف … وخلى بالك دا للتعيين الخارجي فقط».
  it('lets an external person\'s code carry letters, and nobody else\'s', () => {
    expect(employeeCodePatternFor('external').test('C5')).toBe(true);
    expect(employeeCodePatternFor('external').test('EX-01')).toBe(true);
    expect(employeeCodePatternFor('external').test('0100004')).toBe(true);
    expect(employeeCodePatternFor('external').test('C')).toBe(false);
    expect(employeeCodePatternFor('external').test('ك5')).toBe(false);
    for (const origin of ['recruitment', 'direct'] as const) {
      expect(employeeCodePatternFor(origin).test('C5'), origin).toBe(false);
      expect(employeeCodePatternFor(origin).test('0100004'), origin).toBe(true);
    }
    // The box says the external shape, and opens a full keyboard, only for an external person.
    expect(DIALOG).toContain("t(external ? 'employees.external.codeShape' : 'employees.changeCode.shape')");
    expect(DIALOG).toContain("{...(external ? {} : { inputMode: 'numeric' as const })}");
    expect(DIALOG).toContain('maxLength={external ? 20 : 12}');
  });

  /** The global «conflicts with the current state» says nothing about codes. */
  it('answers a taken code in words about codes', () => {
    // The server's code for both clashes is DUPLICATE (ConflictError); there is no CONFLICT code.
    expect(DIALOG).toContain("change.error.code === 'DUPLICATE'");
    expect(DIALOG).toContain("'employees.changeCode.taken'");
    // …and a sign-in name another account holds is told apart by its detail.
    expect(DIALOG).toContain("d.field === 'username'");
    expect(DIALOG).toContain("'employees.changeCode.loginTaken'");
  });

  it('requires a reason', () => {
    expect(DIALOG).toContain("t('employees.changeCode.reasonRequired')");
  });

  /** A form somebody is typing into does not close on a click that missed. */
  it('does not close on a stray click', () => {
    expect(DIALOG).toContain('dismissOnOutsideClick={false}');
  });

  /** The employee is told nothing by the system; HR has to be told what to tell them. */
  it('says when the employee now signs in with the new code', () => {
    expect(DIALOG).toContain("meta?.loginUsernameChanged === true");
    for (const locale of LOCALES) {
      const line = translate(locale, 'employees.changeCode.doneWithLogin', { code: '0990286' });
      expect(line).toContain('0990286');
      expect(line).not.toContain('{{');
    }
  });

  it('has every word in both locales', () => {
    const keys = [
      'title', 'current', 'new', 'reason', 'save', 'required', 'shape', 'same', 'taken',
      'reasonRequired', 'note', 'done', 'doneWithLogin', 'loginTaken',
    ];
    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(translate(locale, `employees.changeCode.${key}`)).not.toBe(`employees.changeCode.${key}`);
      }
    }
  });
});
