// The vocabulary moved INTO the Fleet module, where its caller is.
//
// It used to live here, next to the CLI that applied it — and that is precisely why 167 names sat
// in a merged pull request without ever reaching the company's screens: nothing applied them
// except a command somebody had to remember to run. The list is now seeded on boot from
// `modules/fleet/go-live/vocabulary.ts`, like every other catalog the module seeds.
//
// This file stays as the CLI's entry point so `npm run seed:fleet-vocabulary` and its spec keep
// working unchanged. The CLI is now a way to apply the list EARLY or to re-check it — no longer
// the only way it is ever applied.
export {
  COUNTING_WORK_TYPES,
  FLEET_VOCABULARY,
  planFleetVocabulary,
  applyFleetVocabulary,
  type VocabularyChange,
  type VocabularyPlan,
} from './modules/fleet/go-live/vocabulary';
