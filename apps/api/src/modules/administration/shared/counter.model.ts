// The module's running numbers (design §2.3.1, §2.8): `administration_counters`, one row per series,
// built with the shared counter factory (PC-13) instead of a third copy of Fleet's. P1a.2's one
// series is the item code, `item:global` (OD-05 A); the supplier code (P1b.1) and the yearly
// document series (P2) join it as keys, never as collections.
//
// Bookkeeping, not business data: no repository, no soft delete, no version (§2.1). Written only
// through the two functions below, which keep the factory's two halves apart:
// `ensureCounter` OUTSIDE the transaction (it may create the row, and an insert must not be what
// creates a collection inside one), `nextNumber` INSIDE it as its first write, so a refused
// create gives its number back and the series has no gap.
//
// Both wait for the collection first (§2.1 note 10): the upsert that creates a counter is safe only
// once `ux_counter_key` exists — without it, two processes ensuring one key at once would insert
// two counters, and the series would hand every number out twice. A failed build refuses the
// write, and the next one builds again.
import { type ClientSession } from 'mongoose';
import { defineCounter } from '../../../shared/base/counter';
import { collectionReady } from './collection-ready';

const counter = defineCounter('AdministrationCounter', 'administration_counters');

/** The model, for the module's index list (`administrationModels`) — never written through. */
export const AdministrationCounterModel = counter.model;

const ensureCollection = collectionReady(AdministrationCounterModel);

/**
 * The counter of `key`, made to exist and stand at least at `floor` — the highest number already
 * used — and never lowered. Outside any transaction: before each one that takes a number, and at
 * every boot.
 */
export const ensureCounter = async (key: string, floor: number): Promise<void> => {
  await ensureCollection();
  await counter.ensure(key, floor);
};

/**
 * The next number of `key`, as the first write of the caller's transaction, which has run
 * `ensureCounter` before it began. A missing counter is a 409 "not ready — try again", which the
 * next attempt's `ensureCounter` repairs.
 */
export const nextNumber = (key: string, session: ClientSession): Promise<number> =>
  counter.next(key, session);
