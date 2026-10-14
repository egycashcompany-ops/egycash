// What a click on a Fleet table's header does — and why it does not throw the last one away.
//
// The rule, its format and every function live in `shared/lib/table-sort.ts`, shared since a screen
// outside Fleet sorts its columns the same way. Fleet's tables keep importing from here.
export * from '../../../shared/lib/table-sort';
