// «تصحيح القراءة» — WHAT a correction may change and WHICH neighbour it rewrites, decided without
// a database so every shape the old book left behind can be tested on its own.
//
// The neighbours are the rows dated just before and just after this one (see `findNeighbors`):
// the chain is ordered by DATE, the way `record()` splices a reading into it. Two rules follow
// from asking by date on a book that was never perfectly chained:
//
//   • ONLY WHAT THIS REQUEST CHANGES IS CHECKED. A book row can sit «backwards» against the day
//     before it (car 219: 79,180 on 5 March, 79,146 on the 6th). Correcting that row's note or its
//     drivers says nothing about its readings, and refusing it for a figure nobody touched would
//     leave the clerk no way to fix anything else on it.
//   • ONLY A LINKED NEIGHBOUR IS REWRITTEN. A shared reading is ONE fact on two rows — the closing
//     reading of the row before IS the opening reading of this one — but only where the two
//     actually agree. Where the book closed the day before on some other figure, that figure is
//     its own record and a correction here does not overwrite it.
//
// Equal to a neighbour is ACCEPTED, as `record()` accepts it: a car that did not move is a
// zero-km period, not an error.

/** The fields of a row the rules read. Structural, so a lean document or a test literal will do. */
export interface ChainRow {
  _id: { toString(): string };
  date: Date;
  outReading: number | null;
  inReading: number | null;
}

/** The reading-and-date half of a correction request; `undefined` = not asked to change. */
export interface ReadingChange {
  outReading?: number | undefined;
  /** `null` asks to reopen the period. */
  inReading?: number | null | undefined;
  date?: Date | undefined;
}

export interface CorrectionRefusal {
  field: 'outReading' | 'inReading' | 'date';
  message: string;
}

export interface CorrectionPlan {
  newOut: number | null;
  newIn: number | null;
  /** The previous row's closing reading to write, or `undefined` to leave that row alone. */
  prevIn: number | undefined;
  /** The next row's opening reading to write, or `undefined` to leave that row alone. */
  nextOut: number | undefined;
}

/** (date, _id) — the chain's order, the one `findNeighbors` and `findPriorByDate` both use. */
const before = (date: Date, id: string, other: ChainRow): boolean => {
  const at = date.getTime();
  const theirs = other.date.getTime();
  // ObjectId hex strings are all 24 characters, so comparing them as text compares them as numbers.
  return at < theirs || (at === theirs && id < other._id.toString());
};

export const planCorrection = (
  entry: ChainRow,
  change: ReadingChange,
  prev: ChainRow | null,
  next: ChainRow | null,
): { refusal: CorrectionRefusal } | { plan: CorrectionPlan } => {
  const newOut = change.outReading ?? entry.outReading;
  const newIn = change.inReading === undefined ? entry.inReading : change.inReading;
  const outChanged = newOut !== entry.outReading;
  const inChanged = newIn !== entry.inReading;
  const refuse = (field: CorrectionRefusal['field'], message: string) => ({
    refusal: { field, message },
  });

  if ((outChanged || inChanged) && newOut !== null && newIn !== null && newIn < newOut) {
    return refuse('inReading', 'a period cannot end below its own start');
  }
  if (outChanged && prev !== null && newOut !== null && newOut < (prev.outReading as number)) {
    return refuse('outReading', 'the corrected reading falls below the previous period');
  }
  if (inChanged && next !== null && newIn === null) {
    // The closing reading is shared with the next entry's opening — a middle period cannot
    // be "reopened"; the correction rewrites both rows, it never deletes the shared fact.
    return refuse('inReading', 'a closed period between two others cannot be reopened');
  }
  if (
    inChanged &&
    next !== null &&
    newIn !== null &&
    next.inReading !== null &&
    newIn > next.inReading
  ) {
    return refuse('inReading', 'the corrected reading overlaps the next period');
  }

  // A NEW DATE MUST KEEP THE ROW WHERE IT IS. The chain's order IS the date order now, so a row
  // moved past the one before or after it would carry readings that belong somewhere else in the
  // chain, and the next `record()` would splice against the wrong day. Moving it within its own
  // place — a day mistyped by one — is the correction this field exists for.
  if (change.date !== undefined && change.date.getTime() !== entry.date.getTime()) {
    const id = entry._id.toString();
    const pastPrev = prev !== null && before(change.date, id, prev);
    const pastNext = next !== null && !before(change.date, id, next);
    if (pastPrev || pastNext) {
      return refuse(
        'date',
        'moving a reading past the one before or after it reorders the chain — delete it and record it on its own day',
      );
    }
  }

  return {
    plan: {
      newOut,
      newIn,
      prevIn:
        outChanged && newOut !== null && prev !== null && prev.inReading === entry.outReading
          ? newOut
          : undefined,
      nextOut:
        inChanged && newIn !== null && next !== null && next.outReading === entry.inReading
          ? newIn
          : undefined,
    },
  };
};
