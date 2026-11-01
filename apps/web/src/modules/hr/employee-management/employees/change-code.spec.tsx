// Changing the Employee Code by hand — «عايزك تعمل إمكانية تغيير كود الموظف».
//
// Pinned at the source and through `translate()`: the dialog sits behind a menu, a permission and a
// mutation, which a static render cannot reach, while the properties that matter are plainly
// readable in the files.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@ecms/contracts';
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

  it('checks the company\'s code shape before sending, with the same pattern the server uses', () => {
    expect(DIALOG).toContain('EMPLOYEE_CODE_PATTERN.test(next)');
  });

  /** The global «conflicts with the current state» says nothing about codes. */
  it('answers a taken code in words about codes', () => {
    expect(DIALOG).toContain("change.error.code === 'CONFLICT'");
    expect(DIALOG).toContain("t('employees.changeCode.taken')");
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
      'reasonRequired', 'note', 'done', 'doneWithLogin',
    ];
    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(translate(locale, `employees.changeCode.${key}`)).not.toBe(`employees.changeCode.${key}`);
      }
    }
  });
});
