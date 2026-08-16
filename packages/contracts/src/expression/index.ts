// P-HR-24 — the shared safe expression engine.
//
// Three files, one capability: a calculated field, described as data, checked against a declared
// catalog, and evaluated without ever executing anything. No parser, no variables, no functions,
// no conditionals, no loops, no recursion — and no route, page, permission or consumer in this
// phase (D-EXPR-7 = A). Phase 4 is what will call it.
export * from './ast.js';
export * from './field-catalog.js';
export * from './validate.js';
export * from './evaluate.js';
