// «تصحيح أرقام الكروت» (6d) — WHAT the repair changes, as a constant. No PIN, no I/O.
//
// Read from the analyst's correction table (scratchpad 6d/table.json, 2026-11-02 — its PIN-free
// extract is committed beside the spec as `table-6d.json`), which was built from the go-live asset
// `assets/fleet-go-live/fuel-cards-2026-10-04.json`, the card photos `fuel-card-photos/<number>.jpg`,
// the company statement of the go-live day and the car registry. `number-repair-definition.spec.ts`
// pins every value here to the extract, to the asset and to the photos' byte sizes, and the cycle
// algebra (each record receives the number the record before it in the chain holds).
//
// THE PHYSICAL CARD IS THE NUMBER (owner, «3 ايوه»): the PIN, the photo and the expiry belong with
// the number. A cycle record keeps its name, car, balance and log, and receives the number of the
// card embossed with its name — `after` — with that card's PIN, photo and expiry. `hasPin` is a
// yes/no read from the asset (a PIN on file or none); the PIN itself never appears in this module.
// Five numbers have none stored (548 •••• 6548, 7800, 8713, 9096, 9641): the records that receive
// them (cars 284, 269, 230, 256, 251) end with no PIN, and the owner types those from the card.
//
// THE 0849 PAIR (cars 530 and 283): number, car, photo, expiry and PIN are right; the NAME and the
// go-live OPENING balance are swapped. The repair swaps the names and moves each balance by the
// opening's difference.
//
// Names are compared EXACTLY — two other Wataniya cards differ from these only by an «S» before the
// chassis (EGYCASH-8618-S778864, EGYCASH-8616-S783211), and `548 •••• 2516` is also a Chill Out
// card: every record is found as «the live Wataniya card on car X», never by name or last four.
import { type FleetFuelNumberRepairCycleUnit } from '@ecms/contracts';

/** The repair's key — on every `dataFix` line it writes. */
export const FUEL_NUMBER_REPAIR_KEY = '6d:2026-10-04';
export const FUEL_NUMBER_REPAIR_COMPANY = 'wataniya' as const;
/** The go-live day the definition was read from. */
export const FUEL_NUMBER_REPAIR_GO_LIVE_DAY = '2026-10-04';
/** The company statement of the go-live day («الوطنية 4-10-2026»), whose figures the pair note cites. */
export const FUEL_NUMBER_REPAIR_STATEMENT = { day: '2026-10-04', id: 'd81237e3' } as const;

/** What the analyst read on a card's photo. */
export interface RepairPhotoEvidence {
  /** The name embossed on the card. */
  embossedName: string;
  /** The car code on the card's sticker. */
  stickerCar: string;
  /** «VALID THRU», `MM/YY`. */
  validThru: string;
}

/** A physical card as the go-live asset holds it: its number, expiry, PIN (yes/no), photo size. */
export interface RepairCardFacts {
  number: string;
  /** `YYYY-MM-DD`. */
  expiresAt: string;
  /** A PIN is stored with this number — a yes/no; never the PIN. */
  hasPin: boolean;
  /** The byte size of `fuel-card-photos/<number>.jpg` — how its go-live photo is recognised. */
  photoBytes: number;
}

/** One record of a cycle. */
export interface RepairCycleRecord {
  unit: FleetFuelNumberRepairCycleUnit;
  /** 1-based, in chain order. */
  order: number;
  car: string;
  /** EXACT — kept by the repair. */
  name: string;
  /** The card whose number the record holds today. */
  before: RepairCardFacts;
  /** The card embossed with the record's name — what it holds after. */
  after: RepairCardFacts;
  /** Unchanged by the repair. */
  goLiveBalance: number;
  /** The name's chassis differs from the registry's: the statement's spelling, kept. */
  chassisTypo: boolean;
  photoBefore: RepairPhotoEvidence;
  photoAfter: RepairPhotoEvidence;
}

/** One record of the 0849 pair. */
export interface RepairPairRecord {
  car: string;
  number: string;
  expiresAt: string;
  hasPin: boolean;
  photoBytes: number;
  nameBefore: string;
  nameAfter: string;
  openingBefore: number;
  openingAfter: number;
  /** `openingAfter − openingBefore`. */
  delta: number;
  /** The car's balance on the go-live day's statement, by its own name row. */
  statementOpening: number;
  photo: RepairPhotoEvidence;
}

export interface RepairCycle {
  unit: FleetFuelNumberRepairCycleUnit;
  n: 1 | 2 | 3;
  /** Chain order: each car's record holds the NEXT car's card number. */
  cars: readonly string[];
}

export const REPAIR_CYCLES: readonly RepairCycle[] = [
  { unit: 'C4', n: 1, cars: ['239', '241', '243', '209'] },
  { unit: 'C5', n: 2, cars: ['233', '525', '284', '269', '230'] },
  { unit: 'C6', n: 3, cars: ['232', '800', '256', '267', '251', '246'] },
];

/** The 15 cycle records, in cycle and chain order. */
export const REPAIR_RECORDS: readonly RepairCycleRecord[] = [
  {
    unit: 'C4',
    order: 1,
    car: '239',
    name: 'EGYCASH-4643-4209073',
    before: {
      number: '5485640006602813',
      expiresAt: '2027-03-31',
      hasPin: true,
      photoBytes: 65863,
    },
    after: { number: '5485640005010935', expiresAt: '2027-03-31', hasPin: true, photoBytes: 75576 },
    goLiveBalance: 3049.73,
    chassisTypo: true,
    photoBefore: { embossedName: 'EGYCASH-4645-422193', stickerCar: '241', validThru: '03/27' },
    photoAfter: { embossedName: 'EGYCASH-4643-4209073', stickerCar: '239', validThru: '03/27' },
  },
  {
    unit: 'C4',
    order: 2,
    car: '241',
    name: 'EGYCASH-4645-422193',
    before: {
      number: '5485640006433375',
      expiresAt: '2027-03-31',
      hasPin: true,
      photoBytes: 71026,
    },
    after: { number: '5485640006602813', expiresAt: '2027-03-31', hasPin: true, photoBytes: 65863 },
    goLiveBalance: 9594.55,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-4649-422195', stickerCar: '243', validThru: '03/27' },
    photoAfter: { embossedName: 'EGYCASH-4645-422193', stickerCar: '241', validThru: '03/27' },
  },
  {
    unit: 'C4',
    order: 3,
    car: '243',
    name: 'EGYCASH-4649-422195',
    before: {
      number: '5485640005044116',
      expiresAt: '2028-11-30',
      hasPin: true,
      photoBytes: 58325,
    },
    after: { number: '5485640006433375', expiresAt: '2027-03-31', hasPin: true, photoBytes: 71026 },
    goLiveBalance: 7620,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-1781-312986', stickerCar: '209', validThru: '11/28' },
    photoAfter: { embossedName: 'EGYCASH-4649-422195', stickerCar: '243', validThru: '03/27' },
  },
  {
    unit: 'C4',
    order: 4,
    car: '209',
    name: 'EGYCASH-1781-312986',
    before: {
      number: '5485640005010935',
      expiresAt: '2027-03-31',
      hasPin: true,
      photoBytes: 75576,
    },
    after: { number: '5485640005044116', expiresAt: '2028-11-30', hasPin: true, photoBytes: 58325 },
    goLiveBalance: 7950,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-4643-4209073', stickerCar: '239', validThru: '03/27' },
    photoAfter: { embossedName: 'EGYCASH-1781-312986', stickerCar: '209', validThru: '11/28' },
  },
  {
    unit: 'C5',
    order: 1,
    car: '233',
    name: 'EGYCASH-6163-313110',
    before: {
      number: '5485640006632653',
      expiresAt: '2028-06-30',
      hasPin: true,
      photoBytes: 57592,
    },
    after: { number: '5485640006842179', expiresAt: '2026-11-30', hasPin: true, photoBytes: 54178 },
    goLiveBalance: 12800,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-6731-350118', stickerCar: '525', validThru: '06/28' },
    photoAfter: { embossedName: 'EGYCASH-6163-313110', stickerCar: '233', validThru: '11/26' },
  },
  {
    unit: 'C5',
    order: 2,
    car: '525',
    name: 'EGYCASH-6731-350118',
    before: {
      number: '5485640006639096',
      expiresAt: '2029-01-31',
      hasPin: false,
      photoBytes: 48607,
    },
    after: { number: '5485640006632653', expiresAt: '2028-06-30', hasPin: true, photoBytes: 57592 },
    goLiveBalance: 13650,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-8618-778864', stickerCar: '284', validThru: '01/29' },
    photoAfter: { embossedName: 'EGYCASH-6731-350118', stickerCar: '525', validThru: '06/28' },
  },
  {
    unit: 'C5',
    order: 3,
    car: '284',
    name: 'EGYCASH-8618-778864',
    before: {
      number: '5485640004788713',
      expiresAt: '2027-11-30',
      hasPin: false,
      photoBytes: 70015,
    },
    after: {
      number: '5485640006639096',
      expiresAt: '2029-01-31',
      hasPin: false,
      photoBytes: 48607,
    },
    goLiveBalance: 6837.9,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-3237-675891', stickerCar: '269', validThru: '11/27' },
    photoAfter: { embossedName: 'EGYCASH-8618-778864', stickerCar: '284', validThru: '01/29' },
  },
  {
    unit: 'C5',
    order: 4,
    car: '269',
    name: 'EGYCASH-3237-675891',
    before: {
      number: '5485640006497800',
      expiresAt: '2026-11-30',
      hasPin: false,
      photoBytes: 50932,
    },
    after: {
      number: '5485640004788713',
      expiresAt: '2027-11-30',
      hasPin: false,
      photoBytes: 70015,
    },
    goLiveBalance: 6008.81,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-6167-2573534', stickerCar: '230', validThru: '11/26' },
    photoAfter: { embossedName: 'EGYCASH-3237-675891', stickerCar: '269', validThru: '11/27' },
  },
  {
    unit: 'C5',
    order: 5,
    car: '230',
    name: 'EGYCASH-6167-2573534',
    before: {
      number: '5485640006842179',
      expiresAt: '2026-11-30',
      hasPin: true,
      photoBytes: 54178,
    },
    after: {
      number: '5485640006497800',
      expiresAt: '2026-11-30',
      hasPin: false,
      photoBytes: 50932,
    },
    goLiveBalance: 7351.33,
    chassisTypo: true,
    photoBefore: { embossedName: 'EGYCASH-6163-313110', stickerCar: '233', validThru: '11/26' },
    photoAfter: { embossedName: 'EGYCASH-6167-2573534', stickerCar: '230', validThru: '11/26' },
  },
  {
    unit: 'C6',
    order: 1,
    car: '232',
    name: 'EGYCASH-6164-313107',
    before: {
      number: '5485640005952516',
      expiresAt: '2027-07-31',
      hasPin: true,
      photoBytes: 61614,
    },
    after: { number: '5485640005934142', expiresAt: '2026-11-30', hasPin: true, photoBytes: 61924 },
    goLiveBalance: 6280,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-4822-48085', stickerCar: '800', validThru: '07/27' },
    photoAfter: { embossedName: 'EGYCASH-6164-313107', stickerCar: '232', validThru: '11/26' },
  },
  {
    unit: 'C6',
    order: 2,
    car: '800',
    name: 'EGYCASH-4822-48085',
    before: {
      number: '5485640006489641',
      expiresAt: '2027-07-31',
      hasPin: false,
      photoBytes: 76449,
    },
    after: { number: '5485640005952516', expiresAt: '2027-07-31', hasPin: true, photoBytes: 61614 },
    goLiveBalance: 8780,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-9931-450279', stickerCar: '256', validThru: '07/27' },
    photoAfter: { embossedName: 'EGYCASH-4822-48085', stickerCar: '800', validThru: '07/27' },
  },
  {
    unit: 'C6',
    order: 3,
    car: '256',
    name: 'EGYCASH-9931-450279',
    before: {
      number: '5485640005054503',
      expiresAt: '2027-11-30',
      hasPin: true,
      photoBytes: 76694,
    },
    after: {
      number: '5485640006489641',
      expiresAt: '2027-07-31',
      hasPin: false,
      photoBytes: 76449,
    },
    goLiveBalance: 1469.52,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-3235-676916', stickerCar: '267', validThru: '11/27' },
    photoAfter: { embossedName: 'EGYCASH-9931-450279', stickerCar: '256', validThru: '07/27' },
  },
  {
    unit: 'C6',
    order: 4,
    car: '267',
    name: 'EGYCASH-3235-676916',
    before: {
      number: '5485640005076548',
      expiresAt: '2027-03-31',
      hasPin: false,
      photoBytes: 53811,
    },
    after: { number: '5485640005054503', expiresAt: '2027-11-30', hasPin: true, photoBytes: 76694 },
    goLiveBalance: 5745,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-1344-438318', stickerCar: '251', validThru: '03/27' },
    photoAfter: { embossedName: 'EGYCASH-3235-676916', stickerCar: '267', validThru: '11/27' },
  },
  {
    unit: 'C6',
    order: 5,
    car: '251',
    name: 'EGYCASH-1344-438318',
    before: {
      number: '5485640006234146',
      expiresAt: '2027-03-31',
      hasPin: true,
      photoBytes: 83056,
    },
    after: {
      number: '5485640005076548',
      expiresAt: '2027-03-31',
      hasPin: false,
      photoBytes: 53811,
    },
    goLiveBalance: 8239.21,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-1337-446321', stickerCar: '246', validThru: '03/27' },
    photoAfter: { embossedName: 'EGYCASH-1344-438318', stickerCar: '251', validThru: '03/27' },
  },
  {
    unit: 'C6',
    order: 6,
    car: '246',
    name: 'EGYCASH-1337-446321',
    before: {
      number: '5485640005934142',
      expiresAt: '2026-11-30',
      hasPin: true,
      photoBytes: 61924,
    },
    after: { number: '5485640006234146', expiresAt: '2027-03-31', hasPin: true, photoBytes: 83056 },
    goLiveBalance: 285.07,
    chassisTypo: false,
    photoBefore: { embossedName: 'EGYCASH-6164-313107', stickerCar: '232', validThru: '11/26' },
    photoAfter: { embossedName: 'EGYCASH-1337-446321', stickerCar: '246', validThru: '03/27' },
  },
];

/** The 0849 pair — car 530, then car 283. */
export const REPAIR_PAIR: readonly [RepairPairRecord, RepairPairRecord] = [
  {
    car: '530',
    number: '5485640006210849',
    expiresAt: '2029-01-31',
    hasPin: true,
    photoBytes: 13886,
    nameBefore: 'EGYCASH-8616-783211',
    nameAfter: 'EGYCASH-1137-401485',
    openingBefore: 13130.62,
    openingAfter: 1258,
    delta: -11872.62,
    statementOpening: 1258,
    photo: { embossedName: 'EGYCASH-1137-401485', stickerCar: '530', validThru: '01/29' },
  },
  {
    car: '283',
    number: '5485640006880849',
    expiresAt: '2029-01-31',
    hasPin: true,
    photoBytes: 43834,
    nameBefore: 'EGYCASH-1137-401485',
    nameAfter: 'EGYCASH-8616-783211',
    openingBefore: 1258,
    openingAfter: 13130.62,
    delta: 11872.62,
    statementOpening: 11430.62,
    photo: { embossedName: 'EGYCASH-8616-783211', stickerCar: '283', validThru: '01/29' },
  },
];

/** The pair's two numbers — the batch-3 link lock (`FUEL_CARD_LINKS_IN_REPAIR`) names the same. */
export const REPAIR_PAIR_NUMBERS: readonly [string, string] = [
  REPAIR_PAIR[0].number,
  REPAIR_PAIR[1].number,
];

/** Every car the repair looks at — the 15 and the pair. */
export const REPAIR_CARS: readonly string[] = [
  ...REPAIR_RECORDS.map((record) => record.car),
  ...REPAIR_PAIR.map((record) => record.car),
];

/** The records of one cycle, in chain order. */
export const recordsOf = (unit: FleetFuelNumberRepairCycleUnit): RepairCycleRecord[] =>
  REPAIR_RECORDS.filter((record) => record.unit === unit).sort((a, b) => a.order - b.order);
