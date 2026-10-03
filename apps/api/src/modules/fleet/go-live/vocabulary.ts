// The house's own Fleet vocabulary, as DATA — the lists the owner handed over from the legacy
// system, ready to be put into the catalogs the Fleet screens read.
//
// IT LIVES IN THE MODULE BECAUSE THE BOOT SEED IS ITS CALLER. It began beside the CLI that was
// meant to apply it, and that placement was the mistake: a list that arrives only when somebody
// remembers to type a command is a list that does not arrive. `fleet.seed.ts` now applies it on
// every boot, exactly as it applies the driver catalogs beside it, so a deploy carries the
// vocabulary the way a deploy carries everything else. `fleet-vocabulary.cli.ts` still re-exports
// this and still works; it is no longer the only way in.
//
// EVERY NAME CARRIES ITS ENGLISH. The first cut stored the Arabic string twice, on the honest
// grounds that nobody had been asked for a translation — and then the owner asked for one: «ضيفهم
// عربى وترجم الانجلش وانت بتضيف». So each entry is a pair. The Arabic is the key the catalog's
// duplicate guard matches on and is copied from the legacy system character for character; the
// English is a translation of a part, a job or a place, and a transliteration where the name is a
// company's own (Toyota, Geely, Misr Insurance) because a company's name is not translated.
//
// Importable and side-effect free. The split is the same one `seed-demo.ts` makes, and for the
// same reason: a list this long is worth reading in a test without booting a platform to do it.
import { type FleetCatalogKind } from '@ecms/contracts';
import { fleetCatalogItemRepository, fleetCatalogItemService } from '../catalogs';
import { FleetCatalogItemModel } from '../catalogs/catalog-item.model';

import { COUNTING_WORK_TYPES, FLEET_VOCABULARY, type VocabularyName } from './vocabulary-names';

export { COUNTING_WORK_TYPES, FLEET_VOCABULARY, type VocabularyName };

export interface VocabularyChange {
  kind: FleetCatalogKind;
  name: string;
  en: string;
  /** `create` = not there at all. `flag` = there, but not counted when it has to be. */
  action: 'create' | 'flag';
}

export interface VocabularyPlan {
  changes: VocabularyChange[];
  /** Already correct, and left alone. */
  unchanged: number;
}

const counts = (kind: FleetCatalogKind, name: string): boolean =>
  kind === 'workType' && COUNTING_WORK_TYPES.includes(name);

/**
 * What WOULD change, without changing it.
 *
 * The plan is computed against the live catalogs rather than assumed, because this runs against a
 * database somebody has already been using: most of these names are expected to be there, and the
 * only honest report is the one that says which are not.
 */
export const planFleetVocabulary = async (): Promise<VocabularyPlan> => {
  const changes: VocabularyChange[] = [];
  let unchanged = 0;
  for (const { kind, names } of FLEET_VOCABULARY) {
    for (const raw of names) {
      const name = raw.ar.trim();
      const en = raw.en.trim();
      const existing = await fleetCatalogItemRepository.findByKindAndNameAr(kind, name);
      if (existing === null) {
        changes.push({ kind, name, en, action: 'create' });
        continue;
      }
      // THE FLAG IS REPAIRED ON A ROW THAT ALREADY EXISTS, which `ensure` alone would not do — it
      // returns the existing document untouched. «صيانة» is very likely already in the catalog
      // from an earlier hand-entry, unflagged, and leaving it that way would reproduce the silence
      // this list is partly meant to end.
      if (counts(kind, name) && existing.countsForAlarm !== true) {
        changes.push({ kind, name, en, action: 'flag' });
        continue;
      }
      unchanged += 1;
    }
  }
  return { changes, unchanged };
};

/**
 * Apply a plan. Creates what is missing and flags what is mis-flagged; touches nothing else.
 *
 * `by` is the author, and `null` is the honest value for the BOOT SEED: nobody pressed anything,
 * so there is nobody to record. The operator running the CLI is a real person and is recorded as
 * one. The flag repair splits on the same fact — `update` is the audited, version-checked path a
 * person's edit goes through, and an unauthored boot write goes to the model directly, exactly as
 * `migrateViolationTypeSides` next door already does for the same kind of one-line repair.
 */
export const applyFleetVocabulary = async (
  plan: VocabularyPlan,
  by: string | null,
): Promise<VocabularyPlan> => {
  for (const change of plan.changes) {
    if (change.action === 'create') {
      await fleetCatalogItemService.ensure(
        {
          kind: change.kind,
          name: { ar: change.name, en: change.en },
          countsForAlarm: counts(change.kind, change.name),
        },
        by,
      );
      continue;
    }
    const existing = await fleetCatalogItemRepository.findByKindAndNameAr(change.kind, change.name);
    if (existing === null) continue;
    if (by === null) {
      await FleetCatalogItemModel.updateOne(
        { _id: existing._id },
        { $set: { countsForAlarm: true } },
      ).exec();
      continue;
    }
    await fleetCatalogItemService.update(
      String(existing._id),
      { countsForAlarm: true, version: existing.__v },
      by,
    );
  }
  return plan;
};
