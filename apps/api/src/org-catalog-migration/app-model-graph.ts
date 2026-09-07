// Register every Mongoose model the running system has — imported for the side effect alone.
//
// `apply.ts` sweeps `mongoose.models` to find every collection storing a department id, and that
// map holds only what something has IMPORTED. A collection nobody imported is a collection the
// sweep skips in silence, leaving its rows pointing at a department the merge just retired — which
// is the one failure this migration must not have.
//
// IT TAKES BOTH IMPORTS, and neither is redundant:
//
//   • `../modules` is the Layer-2 graph — every HR, fleet, IT, operations, gold and ATM model. The
//     app does NOT reach these statically: `buildApp` mounts module routers from the registry at
//     call time, so importing the app alone finds four models out of forty.
//   • `../app` is the platform features reached only from the HTTP surface — `department_applications`
//     and `role_assignments` among them — which no module manifest mentions.
//
// `references.spec.ts` imports this same file and asserts that the hard-to-reach ones are found, so
// the coverage claim is checked rather than asserted.
export { moduleManifests } from '../modules';
export { buildApp } from '../app';
