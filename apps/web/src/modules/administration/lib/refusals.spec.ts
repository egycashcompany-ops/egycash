// The server's refusals, worded beside the field each one names (design §13.6 E, §5.15) — the
// dialogs' server-error mapping. Each refusal is built as the API sends it (its code and its
// `details`, the shapes `packages/contracts/src/errors/index.ts` documents), and each detail lands
// on the form's own box for that field, in words the catalog holds in both languages.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { translate } from '../../../platform/localization/i18n';
import { REFUSAL_FIELD_KEYS, carryEdits, fieldRefusal, refusalFieldKeys } from './refusals';

const refused = (code: string, details: { field?: string; code: string }[], status = 422) =>
  new ApiError(
    code,
    'server english',
    status,
    details.map((detail) => ({ ...detail, message: 'server english' })),
  );

describe('a refusal lands on the box it names', () => {
  it('a duplicate on the name, the code or the barcode', () => {
    expect(
      refusalFieldKeys(
        refused(ErrorCodes.ADMINISTRATION_DUPLICATE, [{ field: 'name', code: 'duplicate' }], 409),
      ),
    ).toEqual({ nameAr: 'administration.refusals.duplicate.name' });
    expect(
      refusalFieldKeys(
        refused(ErrorCodes.ADMINISTRATION_DUPLICATE, [{ field: 'code', code: 'duplicate' }], 409),
      ),
    ).toEqual({ code: 'administration.refusals.duplicate.code' });
    expect(
      refusalFieldKeys(
        refused(
          ErrorCodes.ADMINISTRATION_DUPLICATE,
          [{ field: 'barcode', code: 'duplicate' }],
          409,
        ),
      ),
    ).toEqual({ barcode: 'administration.refusals.duplicate.barcode' });
  });

  it('a refused parent, in the words of its problem', () => {
    for (const problem of ['self', 'cycle', 'tooDeep', 'inactive', 'hasChildren']) {
      expect(
        refusalFieldKeys(
          refused(ErrorCodes.ADMINISTRATION_CATEGORY_PARENT_INVALID, [
            { field: 'parentId', code: problem },
          ]),
        ),
      ).toEqual({ parentId: `administration.refusals.parent.${problem}` });
    }
  });

  it('levels out of order on every level the server names', () => {
    expect(
      refusalFieldKeys(
        refused(ErrorCodes.ADMINISTRATION_STOCK_LEVELS_ORDER, [
          { field: 'minQty', code: 'outOfOrder' },
          { field: 'maxQty', code: 'outOfOrder' },
        ]),
      ),
    ).toEqual({
      minQty: 'administration.refusals.levelsOutOfOrder',
      maxQty: 'administration.refusals.levelsOutOfOrder',
    });
  });

  it('a retired unit or category, and a category that wants its subcategory named', () => {
    expect(
      refusalFieldKeys(
        refused(ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE, [
          { field: 'unitId', code: 'inactive' },
          { field: 'categoryId', code: 'inactive' },
        ]),
      ),
    ).toEqual({
      unitId: 'administration.refusals.inactive.unitId',
      categoryId: 'administration.refusals.inactive.categoryId',
    });
    expect(
      refusalFieldKeys(
        refused(ErrorCodes.ADMINISTRATION_SUBCATEGORY_REQUIRED, [
          { field: 'categoryId', code: 'subcategoryRequired' },
        ]),
      ),
    ).toEqual({ categoryId: 'administration.refusals.subcategoryRequired' });
  });

  it('a keeper who left, a store that may not retire, and a branch outside the top bar’s choice', () => {
    expect(
      refusalFieldKeys(
        refused(ErrorCodes.ADMINISTRATION_EMPLOYEE_EXITED, [
          { field: 'responsibleEmployeeId', code: 'exited' },
        ]),
      ),
    ).toEqual({ responsibleEmployeeId: 'administration.refusals.keeperExited' });
    expect(
      refusalFieldKeys(
        refused(ErrorCodes.ADMINISTRATION_DEACTIVATION_BLOCKED, [
          { field: 'isActive', code: 'holdsStock' },
          { field: 'isActive', code: 'openDocument' },
        ]),
      ),
    ).toEqual({ isActive: 'administration.refusals.deactivation.holdsStock' });
    expect(
      refusalFieldKeys(
        refused(
          ErrorCodes.VALIDATION_FAILED,
          [{ field: 'body.branchId', code: 'OUT_OF_REACH' }],
          400,
        ),
      ),
    ).toEqual({ branchId: 'administration.refusals.branchOutOfReach' });
  });

  it('names no field for a refusal that names none — the alert box says those', () => {
    expect(refusalFieldKeys(new ApiError(ErrorCodes.FORBIDDEN, 'no', 403))).toEqual({});
    expect(refusalFieldKeys(new ApiError(ErrorCodes.STALE_DOCUMENT, 'moved', 409))).toEqual({});
    expect(refusalFieldKeys(new Error('network'))).toEqual({});
    expect(refusalFieldKeys(null)).toEqual({});
    // A detail it does not know is left to the alert box, never guessed onto a box.
    expect(
      refusalFieldKeys(
        refused(ErrorCodes.ADMINISTRATION_DUPLICATE, [{ field: 'nickname', code: 'duplicate' }]),
      ),
    ).toEqual({});
  });

  it('words a field through the reader’s catalog, and nothing for a field not named', () => {
    const keys = { nameAr: 'administration.refusals.duplicate.name' };
    const ar = (key: string): string => translate('ar', key);
    expect(fieldRefusal(keys, 'nameAr', ar)).toBe(
      translate('ar', 'administration.refusals.duplicate.name'),
    );
    expect(fieldRefusal(keys, 'code', ar)).toBeUndefined();
  });
});

describe('every word a refusal can take exists in both languages', () => {
  it.each(REFUSAL_FIELD_KEYS.map((key) => ({ key })))('$key', ({ key }) => {
    for (const locale of ['ar', 'en'] as const) {
      expect(translate(locale, key), `${locale}: ${key}`).not.toBe(key);
    }
  });
});

describe('a stale save keeps what the reader changed', () => {
  const opened = { nameAr: 'قطعة', nameEn: 'Piece', notes: '', isActive: true };

  it('lays the reader’s changes over the record as it now is', () => {
    const typed = { ...opened, notes: 'ملاحظتي' };
    const fresh = { ...opened, nameEn: 'Unit piece', version: 2 } as typeof opened;
    expect(carryEdits(opened, typed, fresh)).toEqual({
      nameAr: 'قطعة',
      nameEn: 'Unit piece',
      notes: 'ملاحظتي',
      isActive: true,
      version: 2,
    });
  });

  it('takes the other person’s value for every box the reader left alone', () => {
    const fresh = { nameAr: 'قطع', nameEn: 'Pieces', notes: 'من غيري', isActive: false };
    expect(carryEdits(opened, { ...opened }, fresh)).toEqual(fresh);
  });

  it('keeps the reader’s typing where both changed the same box', () => {
    const typed = { ...opened, nameEn: 'Mine' };
    const fresh = { ...opened, nameEn: 'Theirs' };
    expect(carryEdits(opened, typed, fresh).nameEn).toBe('Mine');
  });
});
