// The owner's two fuel-card sheets — «عاوز اضيف دول عندى فى شاشة البطاقات» — read, planned and
// written. The boot step around it is `fuel-cards.ts`.
//
// THE SHEETS, as the owner settled them: EGYCASHTCS is Chill Out, EGYCASH is Wataniya. Each row is
// one card: its number, the name printed on it, its balance, its password (most have one) and the
// car code it is on. The codes were matched to the registry once, by hand, and approved («الجدول
// اللى انت باعته بتاع العربيات تمام اعتمد»); the asset carries the matched code beside the sheet's.
//
// CARDS ON NO CAR. «سفر 1» … «سفر 6» and «اسبير» are spare cards with no car («كروت زيادة ملهمش
// عربيات»), and «تويوتا اللواء» is a car that is not the company's — it lives on the fuel screens
// only. Each of those is a card on no car, named by its label.
//
// NOTHING IS DROPPED. A code the registry does not know any more, or a car that already holds a
// card of that company, is not a reason to leave a card out: it is imported on no car, labelled
// with the code it came with, and named in the run's outcome so it can be moved onto its car.
// THE EXPIRY DATES came after the sheets («تاريخ الانتهاء هبعته مع صوره كل فيزا فى فايل تانى»): a
// photo of each card and two expiry sheets. A renewed card keeps its number and gets a later
// date, so the latest date printed on the card's own photo wins over an older sheet row; each
// is stored as the last day of its month («VALID THRU»). A card neither source dates is imported
// with none, and its date is typed in later.
import { Types } from 'mongoose';
import { FLEET_FUEL_CARD_COMPANIES, type FleetFuelCardCompany } from '@ecms/contracts';
import { FleetFuelCardModel } from '../fuel-cards/fuel-card.model';

/** The asset, under `apps/api/assets/fleet-go-live/`. */
export const FUEL_CARDS_FILE = 'fuel-cards-2026-10-04.json';

export interface FuelCardRow {
  company: FleetFuelCardCompany;
  number: string;
  name: string;
  balance: number;
  /** «VALID THRU» as a day, `YYYY-MM-DD`; `null` when neither the photo nor the sheets date it. */
  expiresAt: string | null;
  password: string | null;
  /** The code as the sheet wrote it — kept for the report. */
  sheetCode: string;
  /** The registry's code for that car; `null` for a card on no car. */
  vehicleCode: string | null;
  /** What a card on no car is called; `null` for a card on a car. */
  label: string | null;
}

const isCompany = (value: unknown): value is FleetFuelCardCompany =>
  typeof value === 'string' && (FLEET_FUEL_CARD_COMPANIES as readonly string[]).includes(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * The asset's rows, checked. A row that is not a card — no number, no name, no balance, on a car
 * AND labelled, or neither — and a number that appears twice are rejected, and the step refuses
 * the whole file rather than import part of it.
 */
export const parseFuelCards = (raw: unknown): { rows: FuelCardRow[]; rejected: string[] } => {
  const rows: FuelCardRow[] = [];
  const rejected: string[] = [];
  const cards = (raw as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(cards)) return { rows, rejected: ['the file has no «cards» list'] };
  const seen = new Set<string>();
  cards.forEach((card: Record<string, unknown>, index) => {
    const number = text(card.number);
    const name = text(card.name);
    const vehicleCode = text(card.vehicleCode);
    const label = text(card.label);
    const sheetCode = text(card.sheetCode) ?? '';
    const balance = card.balance;
    const password = card.password === null ? null : text(card.password);
    const expiresAt = card.expiresAt === null ? null : text(card.expiresAt);
    const where = `#${index + 1} ${number ?? '?'} (${sheetCode})`;
    if (!isCompany(card.company)) rejected.push(`${where}: unknown company`);
    else if (number === null || !/^\d{4,40}$/u.test(number)) rejected.push(`${where}: bad number`);
    else if (name === null) rejected.push(`${where}: no name`);
    else if (typeof balance !== 'number' || !Number.isFinite(balance)) {
      rejected.push(`${where}: bad balance`);
    } else if (expiresAt !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(expiresAt)) {
      rejected.push(`${where}: bad expiry`);
    } else if ((vehicleCode === null) === (label === null)) {
      rejected.push(`${where}: needs a car code or a label, not both`);
    } else if (seen.has(number)) rejected.push(`${where}: number appears twice`);
    else {
      seen.add(number);
      rows.push({
        company: card.company,
        number,
        name,
        balance: Math.round(balance * 100) / 100,
        expiresAt,
        password,
        sheetCode,
        vehicleCode,
        label,
      });
    }
  });
  return { rows, rejected };
};

export interface PlannedCard {
  row: FuelCardRow;
  /** The car it goes on, or `null` — then `label` names it. */
  vehicleId: string | null;
  label: string | null;
}

export interface FuelCardsPlan {
  create: PlannedCard[];
  /** Numbers already on a live card — a re-run, or a card the clerk added by hand. */
  alreadyThere: string[];
  /** «number — code»: the registry has no car with that code; imported on no car, by the code. */
  unknownCodes: string[];
  /** «number — code»: the car already holds a card of that company; imported on no car. */
  carTaken: string[];
}

/**
 * Decide, for every row, whether it is created and where it goes.
 *
 * `vehicles` is code → id of the live cars; `existingNumbers` the numbers on live cards;
 * `takenPairs` «vehicleId|company» of the live cards on a car. Pure — the apply only writes it.
 */
export const planFuelCards = (
  rows: readonly FuelCardRow[],
  vehicles: ReadonlyMap<string, string>,
  existingNumbers: ReadonlySet<string>,
  takenPairs: ReadonlySet<string>,
): FuelCardsPlan => {
  const plan: FuelCardsPlan = { create: [], alreadyThere: [], unknownCodes: [], carTaken: [] };
  const taken = new Set(takenPairs);
  for (const row of rows) {
    if (existingNumbers.has(row.number)) {
      plan.alreadyThere.push(row.number);
      continue;
    }
    if (row.vehicleCode === null) {
      plan.create.push({ row, vehicleId: null, label: row.label });
      continue;
    }
    const vehicleId = vehicles.get(row.vehicleCode);
    if (vehicleId === undefined) {
      plan.unknownCodes.push(`${row.number} — ${row.vehicleCode}`);
      plan.create.push({ row, vehicleId: null, label: row.vehicleCode });
      continue;
    }
    const pair = `${vehicleId}|${row.company}`;
    if (taken.has(pair)) {
      plan.carTaken.push(`${row.number} — ${row.vehicleCode}`);
      plan.create.push({ row, vehicleId: null, label: row.vehicleCode });
      continue;
    }
    taken.add(pair);
    plan.create.push({ row, vehicleId, label: null });
  }
  return plan;
};

/**
 * Write the plan. One card at a time: a card that fails is reported and the rest still go in, and
 * a re-run finds every card written so far under «already there» — the number is the key.
 */
export const applyFuelCards = async (
  plan: FuelCardsPlan,
  by: string,
): Promise<{ created: number; failures: string[] }> => {
  let created = 0;
  const failures: string[] = [];
  const author = new Types.ObjectId(by);
  for (const { row, vehicleId, label } of plan.create) {
    try {
      await FleetFuelCardModel.create({
        vehicleId: vehicleId === null ? null : new Types.ObjectId(vehicleId),
        label,
        company: row.company,
        name: row.name,
        number: row.number,
        expiresAt: row.expiresAt === null ? null : new Date(`${row.expiresAt}T00:00:00.000Z`),
        password: row.password,
        balance: row.balance,
        requestedAmount: null,
        requestedAt: null,
        lastChargedAt: null,
        createdBy: author,
        updatedBy: author,
      });
      created += 1;
    } catch (error) {
      failures.push(`${row.number}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { created, failures };
};
