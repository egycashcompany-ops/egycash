// P-HR-24 — the promises this engine makes are the kind that must be enforced mechanically.
//
// Every guard below corresponds to a decision, and each exists because the failure it prevents
// would not look like a failure in review:
//
//   G1  no dynamic execution, ever. This is the property the whole design is for.
//   G2  the engine imports nothing. A pure calculator that reached for a database would stop being
//       testable as a value and start being a system.
//   G3  D-EXPR-8 — the payroll engine does not become configurable, in this phase or the next.
//   G4  no parser. D-EXPR-3 = A is a decision about the AUTHORING surface, and the way it erodes is
//       a helpful little `fromString`.
//   G5  the language stays exactly this large.
//   G6  D-EXPR-1 = B — `filter-eval` is left alone and does not fold into this.
//
// COMMENTS ARE STRIPPED BEFORE EVERY SCAN. These files EXPLAIN what they refuse — `$function`,
// `eval`, `calcBasis` and `payroll` all appear in the prose above and in the sources — and a guard
// that read the explanation as a violation would punish the documentation for being explicit. This
// is the same lesson P-HR-23's guards recorded.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as engine from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const ENGINE_FILES = ['ast.ts', 'field-catalog.ts', 'validate.ts', 'evaluate.ts', 'index.ts'] as const;
const ENGINE = ENGINE_FILES.map((name) => [name, stripComments(read(`./${name}`))] as const);

const AST = stripComments(read('./ast.ts'));
const VALIDATE = read('./validate.ts');

/** Four files in `apps/api` this phase promised not to change the behaviour of. */
const API = '../../../../apps/api/src';
const PAYROLL_FILES = [
  `${API}/modules/hr/payroll/compensation/compensation-rules.ts`,
  `${API}/modules/hr/payroll/compensation/attendance-quantities.ts`,
  `${API}/modules/hr/payroll/payslips/payslip-eligibility.ts`,
] as const;
const FILTER_EVAL = `${API}/modules/automation/triggers/filter-eval.ts`;

/** Every module specifier a file imports from. */
const importsOf = (source: string): string[] =>
  [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] as string);

describe('G1 — nothing here executes anything', () => {
  it('contains no dynamic execution of any kind', () => {
    for (const [name, source] of ENGINE) {
      for (const forbidden of [
        'eval(',
        'new Function',
        'Function(',
        'vm.',
        'require(',
        'import(',
        'setTimeout',
        'globalThis',
      ]) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no Mongo evaluation operator — the engine emits no query at all', () => {
    for (const [name, source] of ENGINE) {
      for (const operator of ['$function', '$where', '$expr', '$accumulator']) {
        expect(source, `${name}: ${operator}`).not.toContain(operator);
      }
    }
  });
});

describe('G2 — the engine is a value, not a system', () => {
  it('imports nothing but zod and its own files', () => {
    for (const [name, source] of ENGINE) {
      for (const specifier of importsOf(source)) {
        expect(
          specifier === 'zod' || specifier.startsWith('./'),
          `${name} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it('reaches for no clock and no randomness, so a result depends only on its inputs', () => {
    for (const [name, source] of ENGINE) {
      for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'process.']) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('G3 — payroll does not become configurable (D-EXPR-8)', () => {
  it('the engine names nothing from payroll', () => {
    for (const [name, source] of ENGINE) {
      for (const word of ['calcBasis', 'payslip', 'payItem', 'salary', 'payroll', 'minorUnits']) {
        expect(source.toLowerCase(), `${name}: ${word}`).not.toContain(word.toLowerCase());
      }
    }
  });

  it('no payroll calculation imports the engine, or names any part of it', () => {
    for (const file of PAYROLL_FILES) {
      const source = stripComments(read(file));
      for (const specifier of importsOf(source)) {
        expect(specifier.includes('expression'), `${file} imports ${specifier}`).toBe(false);
      }
      for (const symbol of ['evaluateExpression', 'validateExpression', 'ExpressionNode']) {
        expect(source, `${file}: ${symbol}`).not.toContain(symbol);
      }
    }
  });

  it('still finds the payroll files where this phase left them', () => {
    // Without this, a moved or renamed file would turn the guard above into a silent pass on an
    // empty string — the vacuous-guard trap P-HR-22 hit once and does not intend to hit again.
    for (const file of PAYROLL_FILES) {
      expect(read(file).length, file).toBeGreaterThan(500);
    }
    expect(stripComments(read(PAYROLL_FILES[0]))).toContain('calcBasis');
  });
});

describe('G4 — there is no parser, and no way to grow one quietly', () => {
  it('exports nothing that reads a language', () => {
    for (const exported of Object.keys(engine)) {
      expect(exported, exported).not.toMatch(/parse|compile|tokeni|lex|fromString|fromText/i);
    }
  });

  it('takes an already-parsed value, never a string', () => {
    expect(VALIDATE).toContain('input: unknown');
    expect(AST).not.toContain('z.string().transform');
  });
});

describe('G5 — the language stays exactly this large', () => {
  it('declares four kinds, four binary operations and one unary operation', () => {
    expect([...engine.EXPRESSION_NODE_KINDS]).toEqual(['literal', 'field', 'unary', 'binary']);
    expect([...engine.EXPRESSION_BINARY_OPS]).toEqual(['add', 'subtract', 'multiply', 'divide']);
    expect([...engine.EXPRESSION_UNARY_OPS]).toEqual(['negate']);
  });

  it('names none of the constructs that were decided against', () => {
    // Quoted forms only: `'not'` is a decision, `not` is half the words in the file.
    for (const rejected of [
      "'modulo'",
      "'power'",
      "'and'",
      "'or'",
      "'not'",
      "'if'",
      "'coalesce'",
      "'round'",
      "'abs'",
      "'min'",
      "'max'",
      "'sum'",
      "'count'",
      "'avg'",
      "'variable'",
      "'call'",
    ]) {
      expect(AST, rejected).not.toContain(rejected);
    }
  });

  it('offers one field type, because arithmetic has one input type', () => {
    expect([...engine.EXPRESSION_FIELD_TYPES]).toEqual(['number']);
  });
});

describe('G6 — the automation filter is left alone (D-EXPR-1 = B)', () => {
  it('does not import this engine, and is not imported by it', () => {
    const source = stripComments(read(FILTER_EVAL));
    expect(source).toContain('matchesFilters');
    for (const specifier of importsOf(source)) {
      expect(specifier.includes('expression'), `filter-eval imports ${specifier}`).toBe(false);
    }
    for (const [name, engineSource] of ENGINE) {
      expect(engineSource, `${name}: filter`).not.toContain('matchesFilters');
      expect(engineSource, `${name}: AutomationFilter`).not.toContain('AutomationFilter');
    }
  });
});
