// The vehicle import moved INTO the Fleet module, where its caller is.
//
// It used to live here, next to the CLI that applied it. That is exactly why 209 cars and 56
// licence scans sat in a merged pull request without ever reaching the company's registry: the
// whole of #447 was a library and a command, and a command nobody runs imports nothing. The
// module's own boot seed now applies it — see `modules/fleet/go-live/vehicles.ts`.
//
// This file stays as the CLI's entry point so `npm run import:vehicles` and its spec keep working
// unchanged. The CLI is now the way to apply the data EARLY, to dry-run it, or to finish a run
// that stopped — no longer the only way it is ever applied.
export {
  parseCars,
  planImport,
  applyImport,
  type ParsedCar,
  type ParseResult,
  type ImportPlan,
  type ImportOutcome,
} from './modules/fleet/go-live/vehicles-import';
