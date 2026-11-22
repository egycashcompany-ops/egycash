// The names a page of custody prints — its holders, the departments and places they are kept at,
// and who signed for them — read ONCE per response, never per row: one directory batch for every
// person (the employee holders and the responsible people together), one read for the departments
// and one for the places. Every id the read cannot name is simply absent, and the row shows the id.
import { getDirectoryEmployees } from '../../../platform/directory';
import { departmentRepository } from '../../../platform/organization';
import { itLocationRepository } from '../locations/location.repository';
// Types only: the mapper module reaches every IT model, which a reader of names has no reason to load.
import type { ItCustodianLabels, ItHolderLabels } from '../it.mappers';
import { type CustodyHolder } from './custody-holder';

const distinct = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => id !== ''))];

/** These people's code and name, as the directory answers — none asked for, nothing asked. */
export const employeeLabels = async (ids: readonly string[]): Promise<ItHolderLabels> => {
  const wanted = distinct(ids);
  if (wanted.length === 0) return new Map();
  const employees = await getDirectoryEmployees(wanted);
  return new Map(
    [...employees].map(([id, employee]) => [
      id,
      { code: employee.code, fullNameAr: employee.fullNameAr },
    ]),
  );
};

/**
 * The departments and places these holders name — read by id, in any state: a department since
 * made inactive, or a place since retired, still names the custody written with it.
 */
export const custodianLabels = async (
  holders: readonly CustodyHolder[],
): Promise<ItCustodianLabels> => {
  const departmentIds = distinct(
    holders.flatMap((holder) => (holder.kind === 'department' ? [holder.departmentId] : [])),
  );
  const locationIds = distinct(
    holders.flatMap((holder) => (holder.kind === 'department' ? [holder.locationId] : [])),
  );
  // An employee-only page — every page before 2026-11-19 — reads neither.
  const [departments, locations] = await Promise.all([
    departmentIds.length === 0 ? [] : departmentRepository.findByIdsSystem(departmentIds),
    locationIds.length === 0 ? [] : itLocationRepository.findByIdsSystem(locationIds),
  ]);
  return {
    departments: new Map(
      departments.map((row) => [String(row._id), { ar: row.name.ar, en: row.name.en }]),
    ),
    locations: new Map(
      locations.map((row) => [String(row._id), { ar: row.name.ar, en: row.name.en }]),
    ),
  };
};
