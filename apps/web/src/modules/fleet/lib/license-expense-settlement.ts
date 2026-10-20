// «الحالة» of a licensing-expenses record against the custody fund: each of its memos is waiting for
// its «تسوية عهدة», or settled by one — and a record with ANY memo settled is locked whole, its
// other memo too (the licence service refuses the edit and the delete; the screens only say so).
//
// Read from the settlement fields themselves, never from the printable memo (`memosOf`), which
// carries what the paper prints and nothing about the fund. A record saved before settlements
// existed has no field at all, and reads as waiting.
import {
  type FleetLicenseExpenseDto,
  type FleetLicenseExpenseKind,
  type FleetLicenseExpenseSettleStatus,
  type FleetLicenseExpenseSettlementDto,
} from '@ecms/contracts';

type Row = Pick<FleetLicenseExpenseDto, 'renewal' | 'extension'>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

/** One memo of a record and where it stands — `settlement` is `null` while it waits. */
export interface LicencePartStatus {
  kind: FleetLicenseExpenseKind;
  settlement: FleetLicenseExpenseSettlementDto | null;
}

/** «التسوية» on the filter bar — the sample's order: settled, then waiting. */
export const LICENCE_SETTLE_FILTER: readonly FleetLicenseExpenseSettleStatus[] = [
  'settled',
  'waiting',
];

/** A `status` read off the address — anything but the two answers is no filter at all. */
export const licenceSettleParam = (raw: string | null): FleetLicenseExpenseSettleStatus | '' =>
  raw === 'settled' || raw === 'waiting' ? raw : '';

/** Each memo the record holds, the renewal first, as the department files them. */
export const licencePartStatuses = (row: Row): LicencePartStatus[] =>
  (['renewal', 'extension'] as const).flatMap((kind) => {
    const part = row[kind];
    return part === null ? [] : [{ kind, settlement: part.settlement ?? null }];
  });

/** The settlement that locks the record — the renewal's, else the extension's; `null` = writable. */
export const licenceLock = (row: Row): FleetLicenseExpenseSettlementDto | null =>
  row.renewal?.settlement ?? row.extension?.settlement ?? null;

export const isLicenceLocked = (row: Row): boolean => licenceLock(row) !== null;

/** «2026/10/05» — the boards' year-first day. */
export const settlementDay = (settlement: FleetLicenseExpenseSettlementDto): string =>
  settlement.date.slice(0, 10).replace(/-/gu, '/');

/**
 * «الحالة» as the Excel and the PDF write it: «تمت التسوية 2026/10/05» or «لم تُسوَّ بعد» — and on a
 * record holding both memos, each named by its kind: «تجديد تراخيص: … — مد مدة: …».
 */
export const licenceStatusText = (row: Row, t: Translate): string => {
  const parts = licencePartStatuses(row);
  const one = (part: LicencePartStatus): string =>
    part.settlement === null
      ? t('fleet.licenseExpenses.settlement.waiting')
      : t('fleet.licenseExpenses.settlement.settledOn', { date: settlementDay(part.settlement) });
  if (parts.length < 2) return parts.map(one).join('');
  return parts
    .map((part) =>
      t('fleet.licenseExpenses.settlement.partStatus', {
        kind: t(`fleet.licenseExpenses.kinds.${part.kind}`),
        status: one(part),
      }),
    )
    .join(' — ');
};
