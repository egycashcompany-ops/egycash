// «عقود توريد السيارات» — how the screens say things, in formal Arabic, from i18n keys
// (`fleet.vehicleContracts.*`).
//
// COUNTING. Arabic counts in five forms, read by `custodyPlural` (the custody tabs' own rule):
// «عقد واحد · عقدان · 5 عقود · 11 عقدًا · 100 عقد». Every counted key has the five, `.one` …
// `.other`, with `{{count}}` for the figure (Latin digits, grouped).
//
// PHRASES. «بعد 5 أيام», «المتبقي 3 سيارات»: the figure wears the boards' monospace while the words
// keep the page's face, so a phrase comes back in three parts — before, the figure, after. It is
// translated with a private-use mark where the figure goes and split at the mark (the technique of
// `Sentence` in `CustodyDashboardFund`); a form that says the number in words («يومين») has no mark
// and so no figure.
import { useMemo } from 'react';
import { type FleetVehicleContractDto, type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { useAppSelector } from '../../../store';
import { ApiError } from '../../../shared/lib/api-client';
import { custodyPlural } from './custody-words';

const VC = 'fleet.vehicleContracts';

/** The figure in a phrase: Latin digits, grouped — as every figure on the boards. */
const LATIN = new Intl.NumberFormat('en-US');
export const latin = (n: number): string => LATIN.format(n);

/** Where the figure goes while a phrase is being translated. */
const MARK = '';

export interface Phrase {
  before: string;
  /** `null` when the words say the number themselves. */
  figure: string | null;
  after: string;
}

export const phraseText = (phrase: Phrase): string =>
  `${phrase.before}${phrase.figure ?? ''}${phrase.after}`;

const splitAt = (text: string, figure: string): Phrase => {
  const at = text.indexOf(MARK);
  return at < 0
    ? { before: text, figure: null, after: '' }
    : { before: text.slice(0, at), figure, after: text.slice(at + MARK.length) };
};

export type VehicleContractNoun = 'contract' | 'car' | 'file' | 'line' | 'delivery';
export type VehicleContractUnit = 'car' | 'contract';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface VehicleContractWords {
  /** «عقد واحد», «عقدان», «5 عقود», «11 عقدًا». */
  count: (noun: VehicleContractNoun, n: number) => string;
  /** The word alone, after a figure the screen draws itself — «32 سيارة». */
  unit: (noun: VehicleContractUnit, n: number) => string;
  /** «في بند واحد», «في بندين», «في 3 بنود». */
  inLines: (n: number) => string;
  /** «اليوم», «بعد يومين», «بعد 22 يومًا», «متأخر 9 أيام». */
  days: (days: number) => Phrase;
  /** «آخر موعد للتوريد بعد 5 أيام» / «متأخر 9 أيام عن آخر موعد للتوريد». */
  deadline: (days: number) => Phrase;
  /** «المتبقي سيارة واحدة», «المتبقي 3 سيارات». */
  leftHead: (n: number) => Phrase;
  /** «الاستلام الأول» … «الاستلام العاشر», then «الاستلام رقم 11». */
  deliveryName: (no: number) => string;
  /** The typed name, or «عقد رقم N» when none was written. */
  contractName: (contract: Pick<FleetVehicleContractDto, 'name' | 'no'>) => {
    text: string;
    unnamed: boolean;
  };
  /** «87 ك.ب», «3.9 م.ب». */
  fileSize: (bytes: number) => string;
}

export const vehicleContractWords = (t: Translate, locale: Locale): VehicleContractWords => {
  const form = (n: number): string => custodyPlural(locale, n);
  const daysText = (days: number): string =>
    days === 0
      ? t(`${VC}.days.today`)
      : t(`${VC}.days.${days < 0 ? 'late' : 'in'}.${form(Math.abs(days))}`, { count: MARK });
  return {
    count: (noun, n) => t(`${VC}.count.${noun}.${form(n)}`, { count: latin(n) }),
    unit: (noun, n) => t(`${VC}.unit.${noun}.${form(n)}`),
    inLines: (n) => t(`${VC}.inLines.${form(n)}`, { count: latin(n) }),
    days: (days) => splitAt(daysText(days), latin(Math.abs(days))),
    deadline: (days) =>
      splitAt(
        t(days < 0 ? `${VC}.deadlineLate` : `${VC}.deadlineIn`, { when: daysText(days) }),
        latin(Math.abs(days)),
      ),
    leftHead: (n) => splitAt(t(`${VC}.leftHead.${form(n)}`, { count: MARK }), latin(n)),
    deliveryName: (no) =>
      no >= 1 && no <= 10 ? t(`${VC}.ordinal.${no}`) : t(`${VC}.ordinal.n`, { n: latin(no) }),
    contractName: (contract) =>
      contract.name.trim() === ''
        ? { text: t(`${VC}.unnamed`, { no: latin(contract.no) }), unnamed: true }
        : { text: contract.name.trim(), unnamed: false },
    fileSize: (bytes) =>
      bytes >= 1024 * 1024
        ? t(`${VC}.size.mb`, { n: (bytes / (1024 * 1024)).toFixed(1) })
        : t(`${VC}.size.kb`, { n: latin(Math.max(1, Math.round(bytes / 1024))) }),
  };
};

export const useVehicleContractWords = (): VehicleContractWords => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return useMemo(
    () => vehicleContractWords((key, params) => translate(locale, key, params), locale),
    [locale],
  );
};

// ── Refusals the screens word themselves (critique 18) ──────────────────────────────────────────

/**
 * What a refused write means to the screen that sent it:
 *   stale          409 — the contract changed after it was read (its version moved)
 *   inactiveType   422 — a new or changed make is missing or no longer active
 *   unknownLine    422 — a line the screen named is no longer the contract's
 *   belowReceived  422 — a count below the cars already received on its line
 *   lineReceived   422 — a line dropped after cars arrived on it
 *   overRemaining  422 — more cars than are still owed on a line
 *   notTheLiveSet  422 — the attachments' order no longer names exactly the live ones
 *   fileRefused    422 — a file of another type, or over the size, refused by the platform
 */
export type VehicleContractRefusal =
  | 'stale'
  | 'inactiveType'
  | 'unknownLine'
  | 'belowReceived'
  | 'lineReceived'
  | 'overRemaining'
  | 'notTheLiveSet'
  | 'fileRefused';

const RULES: Record<string, VehicleContractRefusal> = {
  INACTIVE_TYPE: 'inactiveType',
  UNKNOWN_LINE: 'unknownLine',
  BELOW_RECEIVED: 'belowReceived',
  LINE_RECEIVED: 'lineReceived',
  OVER_REMAINING: 'overRemaining',
  NOT_THE_LIVE_SET: 'notTheLiveSet',
};

/** `null` for anything else — a network drop, a 404 — which keeps its usual message. */
export const vehicleContractRefusalOf = (error: unknown): VehicleContractRefusal | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409 && error.code === 'STALE_DOCUMENT') return 'stale';
  if (error.code === 'FILE_TYPE_NOT_ALLOWED' || error.code === 'FILE_TOO_LARGE') {
    return 'fileRefused';
  }
  if (error.status !== 422 || error.code !== 'BUSINESS_RULE_VIOLATION') return null;
  for (const detail of error.details ?? []) {
    const rule = RULES[detail.code];
    if (rule !== undefined) return rule;
  }
  return null;
};

export const isVehicleContractRefusal = (error: unknown): boolean =>
  vehicleContractRefusalOf(error) !== null;

/** The sentence for each refusal; a file's carries its name (`{{name}}`, `{{mb}}`). */
export const REFUSAL_KEY: Record<VehicleContractRefusal, string> = {
  stale: 'fleet.vehicleContracts.refusedStale',
  inactiveType: 'fleet.vehicleContracts.refused.inactiveType',
  unknownLine: 'fleet.vehicleContracts.refused.unknownLine',
  belowReceived: 'fleet.vehicleContracts.refused.belowReceived',
  lineReceived: 'fleet.vehicleContracts.lines.removeLocked',
  overRemaining: 'fleet.vehicleContracts.delivery.refusedOver',
  notTheLiveSet: 'fleet.vehicleContracts.refused.notTheLiveSet',
  fileRefused: 'fleet.vehicleContracts.files.refused',
};
