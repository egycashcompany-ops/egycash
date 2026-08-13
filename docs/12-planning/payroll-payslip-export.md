# Payslip export / PDF (PY-12)

**Status: investigation + design. No runtime code.** There is a complete architectural precedent
for how a payslip PDF *would* be built, and **no requirement anywhere in the repository that one be
built**. The brief's rule applies: do not invent a requirement the code or design does not prove.

**Base:** `main` at `cd785ca`.

---

## 1. Is there a proven requirement? No.

Searched: `packages/contracts`, `apps/api`, `apps/web`, `docs/03-decisions` (ADR-001…026),
`docs/12-planning`, `docs/01-domain`.

| looked for | found |
|---|---|
| a `payslip.print` / `payslip.export` permission | none — the registry has 219 keys and none of them is one |
| a payslip PDF route, controller, worker job or file field | none |
| a design doc or ADR naming payslip export | none |
| a TODO, a stub, a disabled flag | none |
| a *consumer* — anything that would read such a file | none |

The only occurrences of "payslip" outside PY-7's own code are **negative assertions** in tests
stating the surface does not exist.

## 2. The precedent, in full — how it *would* be built

The Contracts module already does exactly this, and does it well.

### 2.1 The platform seam

```ts
// apps/api/src/platform/pdf/index.ts
export { pdfDriverEnabled, renderPdfFromHtml } from '../../infrastructure/pdf/chromium-pdf';
```

Headless chromium via `puppeteer-core`, **disabled unless `CHROMIUM_PATH` is set** — with the
reason stated in the driver: *"dev/CI stay hermetic and the print-view fallback covers exports"*.
Deterministic settings (A4, fixed margins, `printBackground`, no browser header/footer, the
document carries its own integrity line).

### 2.2 The module side

`contracts/contract-pdf.ts`:

- runs in the **worker** (the reliable tier), not in the request;
- writes the result to Files with a fixed mime allow-list;
- **one immutable file per version** — `if (doc.generation.pdfFileId !== null) return;` (A15);
- degrades to null when the driver is absent, and logs rather than failing the flow.

`contract.routes.ts` gates both the HTML document view and the PDF behind a **dedicated
`contract.print` key**, and the module header records that exports are **audited** under it —
`AUDIT_ACTIONS` already contains `export`.

## 3. What PY-7 already guarantees

The brief's own constraint — *the PDF must be built from the payslip snapshot, not from the
employee's current data* — is **already satisfied and needs no new work**:

`PayslipDto` is self-contained by construction. It carries the employee's identity as it stood at
issue, the currency, the basic salary, the day counts, every line with its own derivation, the
totals in minor units, the leave facts and the run id. A renderer needs **one document read** and
touches nothing live. That was the whole point of PY-7 storing rather than projecting.

So if this is ever built, the risky part is already done.

## 4. What it would cost, if granted

| | |
|---|---|
| a permission | `payslip.print` — following `contract.print`. Printing pay is separately auditable from reading it, and the ESS `/me` case would need its own answer (may an employee print their own? presumably yes, own-scope by construction — but that is a decision) |
| a page/registry entry | none if it hangs off the existing surfaces |
| an audit action | none new — `export` exists |
| an event | none, unless something consumes the file |
| storage | a Files entry per payslip per version, immutable like a contract's |
| a worker job | rendering belongs off the request path, as Contracts does it |
| an environment dependency | `CHROMIUM_PATH`, absent in dev/CI by design |

## 5. Decisions required

- **D1 — is a payslip PDF wanted at all?** Nothing implies it. An employee can already read their
  payslip (PY-11) and print the page from the browser, which is exactly the *"print-view fallback"*
  the PDF driver's own comment names as sufficient for exports.
- **D2 — if yes: a stored immutable file, or rendered on demand?** Contracts stores one file per
  version because a contract is signed. A payslip is not signed; rendering on demand from an
  immutable snapshot gives the same determinism with no storage and no lifecycle. **Recommend on
  demand** if D1 = yes.
- **D3 — who may print?** `payslip.print` for the administrative path. For `/me`, own-scope by
  construction argues for no key — consistent with PY-11.
- **D4 — is a print VIEW (HTML, no chromium) enough?** It needs no driver, no storage, no worker
  and no environment variable. If the answer to D1 is "people want a piece of paper", this is the
  cheaper half and could ship alone.

## 6. Recommendation

**Do not build it now.** PY-11 delivered the access; a browser prints it. If a requirement appears —
a bank needs a signed file, an auditor needs an archive, an employee needs a stamped copy — D2's
"render on demand from the snapshot" is a small, well-precedented phase, and PY-7 already removed
the only hard part.
