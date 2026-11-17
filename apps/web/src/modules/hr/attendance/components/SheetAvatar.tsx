// The face beside a name on the daily sheet.
//
// A stored photo is not addressable by URL — `/hr/employees/:id/photo` needs the session's
// Authorization header, which an `<img src>` cannot send — so the platform's `useEmployeePhotoUrl`
// is what turns a file id into something the browser can load. The employee list's photo column
// already works this way; this is the same mechanism, not a second one.
//
// AN EMPLOYEE WITH NO PHOTO COSTS NOTHING: the hook is handed `null` and never asks. That is the
// common case on this payroll, so the sheet does not open with a request per row.
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { Avatar } from '../../../../shared/ui/Avatar';
import { useEmployeePhotoUrl } from '../../employee-management/employees/api/employee-photo';

/**
 * The first letters of the first two words — which is what a person's initials are in Arabic as
 * much as in English, and is far more recognisable in a column of faces than a generic glyph.
 */
const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('');

export const SheetAvatar = ({
  employeeId,
  photoFileId,
  name,
}: {
  employeeId: string;
  photoFileId: string | null;
  name: string;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const photo = useEmployeePhotoUrl(employeeId, photoFileId);
  return (
    <Avatar
      src={photo.url}
      alt={name}
      shape="circle"
      size="sm"
      fallback={
        <span
          className="text-xs font-semibold text-slate-500 dark:text-slate-400"
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
        >
          {initialsOf(name)}
        </span>
      }
    />
  );
};
