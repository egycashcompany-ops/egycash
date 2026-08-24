// Document numbering — the gold formats, unchanged.
//
//   receiving : R<YYYYMMDD><nn>      delivery : D<YYYYMMDD><nn>      transfer : T<YYYYMMDD><nn>
//
// `nn` is the count of documents already carrying today's prefix, zero-padded to two digits and
// starting at 00 — the gold system's own rule (`R${prefix}${String(count).padStart(2,'0')}`), kept
// because operators read these numbers aloud and file them by hand.
//
// The one thing the port adds is a RETRY. The gold implementation derived the number from a count
// and inserted it, so two operators saving at the same second produced the same number; the unique
// index now catches that, and the caller retries with the next count instead of failing. That
// makes the existing rule actually hold — it does not change what the rule is.
import { type FilterQuery, type Model } from 'mongoose';

const todayStamp = (): string => {
  const t = new Date();
  return `${String(t.getFullYear())}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
};

export const GOLD_NUMBER_PREFIXES = { receiving: 'R', delivery: 'D', transfer: 'T' } as const;

/**
 * The next free number for today, for one document kind.
 *
 * @param model      the collection to count in
 * @param field      the field holding the number (`receiptNumber` / `transferNumber`)
 * @param kindPrefix R | D | T
 * @param attempt    how many numbers to skip — the retry counter, 0 on the first try
 */
export const nextGoldNumber = async <T>(
  model: Model<T>,
  field: string,
  kindPrefix: string,
  attempt = 0,
): Promise<string> => {
  const prefix = `${kindPrefix}${todayStamp()}`;
  const filter = { [field]: new RegExp(`^${prefix}`) } as FilterQuery<T>;
  const used = await model.countDocuments(filter).exec();
  return `${prefix}${String(used + attempt).padStart(2, '0')}`;
};

/** Max numbering retries before a save gives up — far above any realistic same-second burst. */
export const GOLD_NUMBER_ATTEMPTS = 25;
