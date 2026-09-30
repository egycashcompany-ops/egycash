// «املأ من السيستم» — what the registry already knows, written into a notice's boxes.
//
// Only boxes a form ties to a source (`NoticeField.source`) are touched, and a source the system
// has nothing for leaves its box as it was: picking a car must not blank the driver's name the
// clerk already typed. Everything else on the form is the clerk's to write.
import {
  type FleetAccidentDto,
  type FleetDriverProfileDto,
  type FleetPersonDto,
  type FleetVehicleDto,
} from '@ecms/contracts';
import { type NoticeSource, type NoticeTemplate } from './notice-templates';

/** The company is the insured on every notice the fleet files. */
export const NOTICE_COMPANY_NAME = 'شركة ايجى كاش للحلول النقدية';

export interface NoticeSystemFacts {
  vehicle?: FleetVehicleDto | undefined;
  /** The vehicle type's Arabic name — what the form calls «الماركة / الموديل». */
  vehicleTypeName?: string | undefined;
  person?: FleetPersonDto | undefined;
  profile?: FleetDriverProfileDto | null | undefined;
  accident?: FleetAccidentDto | undefined;
  /** Put the company in «المؤمن له» — only the first time, never over what was typed. */
  company?: boolean;
}

/** `2026-09-28T…` → `2026/09/28`, the way the forms write a date in one box. */
const day = (iso: string | null | undefined): string | undefined =>
  iso === null || iso === undefined || iso === ''
    ? undefined
    : iso.slice(0, 10).replaceAll('-', '/');

/** A time of day only when the record carries one — a date stored at midnight has none. */
const timeOf = (iso: string | null | undefined): string | undefined => {
  if (iso === null || iso === undefined || iso === '') return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  const hours = at.getHours();
  const minutes = at.getMinutes();
  if (hours === 0 && minutes === 0) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const factFor = (source: NoticeSource, facts: NoticeSystemFacts): string | undefined => {
  switch (source) {
    case 'companyName':
      return facts.company === true ? NOTICE_COMPANY_NAME : undefined;
    case 'driverName':
      return facts.person?.fullNameAr;
    case 'driverPhone':
      return facts.person?.phone ?? undefined;
    case 'licenseNumber':
      return facts.profile?.licenseNumber ?? undefined;
    case 'licenseExpiry':
      return day(facts.profile?.licenseExpiresAt);
    case 'motorNumber':
      return facts.vehicle?.motorNumber;
    case 'chassisNumber':
      return facts.vehicle?.chassisNumber;
    case 'plateNumber':
      return facts.vehicle?.plateNumber;
    case 'vehicleType':
      return facts.vehicleTypeName;
    case 'accidentDate':
      // A date box stores what the date input stores.
      return facts.accident?.occurredAt?.slice(0, 10) ?? undefined;
    case 'accidentTime':
      return timeOf(facts.accident?.occurredAt);
    case 'accidentStatement':
      return facts.accident?.statement === '' ? undefined : facts.accident?.statement;
    default:
      return undefined;
  }
};

/** The boxes these facts fill, and what goes in each. Boxes with nothing to say are left out. */
export const autofillValues = (
  template: NoticeTemplate,
  facts: NoticeSystemFacts,
): Record<string, string> => {
  const filled: Record<string, string> = {};
  for (const field of template.sections.flatMap((section) => section.fields)) {
    if (field.source === undefined) continue;
    let fact = factFor(field.source, facts)?.trim();
    if (fact === undefined || fact === '') continue;
    // A date in a plain box is written the way the form writes one; a date box keeps the stored
    // form, which is what its date input reads.
    if (field.kind !== 'date') fact = fact.replace(/^(\d{4})-(\d{2})-(\d{2})$/u, '$1/$2/$3');
    filled[field.key] = fact;
  }
  return filled;
};
