// Every model the api declares, loaded without starting anything — what `db:sync-indexes` compares
// against the server.
//
// Every model registers itself with mongoose when its file is imported. The api's own entry imports
// reach almost all of them: the platform routers (app) and the module manifests. The exceptions are
// models reached only from server.ts and worker.ts, which cannot be imported here because they
// start the process on import; each is imported by name below. `sync-indexes.models.spec.ts`
// imports every model file in the source tree after this one and fails if any of them registers a
// model this missed, so the list cannot fall behind.
import './app';
import './modules';
// IT's go-live bookkeeping — reached only through the go-live steps server.ts and worker.ts start.
import './modules/it/go-live/go-live-run.model';
