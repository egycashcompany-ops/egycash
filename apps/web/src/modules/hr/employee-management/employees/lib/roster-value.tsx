// One value of the roster preview, rendered by what it IS.
//
// Extracted from the dialog so it can be tested on its own: the dialog reaches its preview only
// after a mutation resolves, which a static render cannot drive, while this — the part that
// decides whether a manager sees a department name or an ObjectId — is pure and can be pinned.
import { type Locale, type RosterEnumFamily, type RosterValueDto } from '@ecms/contracts';
import { localized } from '../../../../../shared/lib/format';

/**
 * Which label table renders each closed vocabulary. The API tags the family and sends the TOKEN;
 * the words are this screen's, in whichever language it is showing — `bachelor` is «Bachelor» or
 * «بكالوريوس» without the API knowing either.
 */
export const ENUM_KEY_PREFIX: Record<RosterEnumFamily, string> = {
  educationLevel: 'applicants.education.',
  insuranceStatus: 'employees.insurance.status.',
  weaponLicenseType: 'employees.roster.enum.weaponLicenseType.',
  maritalStatus: 'employees.roster.enum.maritalStatus.',
  militaryStatus: 'applicants.military.',
  employeeStatus: 'employees.status.',
  exitType: 'employees.exitType.',
};

/**
 * One value of the preview, rendered by what it IS rather than by what it was stringified to.
 *
 * This is the other half of the fix that made the API send typed values: a department is shown by
 * its name, a thing the file would create is shown as «new: name» rather than as the placeholder
 * token that used to leak here, and a vocabulary token is looked up in the screen's own labels.
 */
export const RosterValue = ({
  value,
  t,
  locale,
}: {
  value: RosterValueDto;
  t: (key: string) => string;
  locale: Locale;
}): JSX.Element => {
  switch (value.kind) {
    case 'absent':
      return <>—</>;
    case 'text':
      return <>{value.text}</>;
    case 'enum':
      return <>{t(`${ENUM_KEY_PREFIX[value.family]}${value.value}`)}</>;
    case 'named':
      return value.isNew ? (
        <>
          <span
            className="me-1 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
          >
            {t('employees.roster.new')}
          </span>
          {localized(value.name, locale)}
        </>
      ) : (
        <>{localized(value.name, locale)}</>
      );
  }
};
