// What a changed field is CALLED, for the person reading the preview.
//
// The report names fields by their document path — `personal.contact.primaryPhone` — because that is
// what gets written. A confirmation dialog showing that asks an HR manager to approve a schema they
// have never seen; the whole value of a preview is that somebody can read it and say "no, not that
// one". So every path the importer can actually produce has a name here, in both languages.
//
// An unmapped path falls back to the path itself rather than to a guess or a blank: a field with no
// label is a mapping to add, and saying so in the UI is how it gets noticed.

/** Path → i18n key. The keys live under `employees.roster.field.*`. */
const FIELD_KEYS: Record<string, string> = {
  'personal.fullNameAr': 'employees.roster.field.fullNameAr',
  'personal.fullNameEn': 'employees.roster.field.fullNameEn',
  'personal.searchName': 'employees.roster.field.searchName',
  'personal.nationalId': 'employees.roster.field.nationalId',
  'personal.nationalIdExpiry': 'employees.roster.field.nationalIdExpiry',
  'personal.contact.primaryPhone': 'employees.roster.field.primaryPhone',
  'personal.contact.secondaryPhone': 'employees.roster.field.secondaryPhone',
  'personal.maritalStatus': 'employees.roster.field.maritalStatus',
  'personal.religion': 'employees.roster.field.religion',
  'personal.currentAddress': 'employees.roster.field.address',
  'personal.military': 'employees.roster.field.military',
  'personal.education': 'employees.roster.field.education',
  'personal.drivingLicenses': 'employees.roster.field.drivingLicense',
  'insurance.insuranceNumber': 'employees.roster.field.insuranceNumber',
  'insurance.occupation': 'employees.roster.field.occupation',
  'insurance.occupationCode': 'employees.roster.field.occupationCode',
  'insurance.grossWage': 'employees.roster.field.grossWage',
  'insurance.contributionWage': 'employees.roster.field.contributionWage',
  'insurance.basicWage': 'employees.roster.field.basicWage',
  'insurance.employerShare': 'employees.roster.field.employerShare',
  'insurance.employeeShare': 'employees.roster.field.employeeShare',
  'insurance.status': 'employees.roster.field.insuranceStatus',
  'officer.reserveOfficer': 'employees.roster.field.reserveOfficer',
  'officer.rank': 'employees.roster.field.rank',
  'officer.weaponLicense': 'employees.roster.field.weaponLicense',
  'officer.professionPractice': 'employees.roster.field.professionPractice',
  'officer.retirementDate': 'employees.roster.field.retirementDate',
  'employment.branchId': 'employees.columns.branch',
  'employment.departmentId': 'employees.columns.department',
  'employment.sectionId': 'employees.columns.section',
  'employment.jobTitleId': 'employees.columns.jobTitle',
};

/**
 * The paths that are a MIRROR of another one, and are hidden from the preview.
 *
 * The list and the profile read placement from different places — `employment.departmentId` and a
 * top-level `departmentId` — so a move writes both. Showing both would tell the reader their
 * department is changing twice, which is not a thing that can happen.
 */
const MIRRORS = new Set(['branchId', 'departmentId', 'sectionId']);

/**
 * `searchName` is derived from the name and moves with it. It is a real write and belongs in the
 * audit trail, but in a preview it is a second line saying what the line above it already said.
 */
const DERIVED = new Set(['personal.searchName']);

export const isHiddenFromPreview = (path: string): boolean =>
  MIRRORS.has(path) || DERIVED.has(path);

export const rosterFieldLabel = (t: (key: string) => string, path: string): string => {
  const key = FIELD_KEYS[path];
  return key === undefined ? path : t(key);
};

/** The changes worth showing, and how many were folded away as mirrors of one already shown. */
export const visibleChanges = <T extends { path: string }>(changes: readonly T[]): T[] =>
  changes.filter((c) => !isHiddenFromPreview(c.path));
