# Payslip export / PDF (PY-12)

**Status: CLOSED as a documented design — no implementation, by decision.** There is a complete
architectural precedent for how a payslip PDF *would* be built, and no requirement anywhere in the
repository that one be built. The owner has now decided the same way (§5).

**Base:** `main` at `cd785ca`; closed on `main` after HR3-C.

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

## 5. The frozen decisions (approved)

| # | decision |
|---|---|
| **1** | **No PDF at this time.** |
| **2** | The existing payslip screen plus **browser print** are sufficient for the current stage. |
| **3** | **Add nothing on speculation** — no endpoint, no permission, no storage, no Chromium infrastructure for a future possibility. |
| **4** | PDF is documented as a **future capability / a phase of its own**. |
| **5** | When PDF is eventually built, it **must render from the payslip snapshot**, never from the employee's current data. |

### How they answer the open questions

- **D1 — is a PDF wanted at all?** → **Not now** (decision 1). §4's whole cost column is therefore
  not incurred: no `payslip.print` key, no worker job, no `CHROMIUM_PATH` dependency, no Files
  lifecycle (decision 3).
- **D2 — stored file or rendered on demand?** → Deferred to the future phase (decision 4). The
  recommendation stands: **on demand**, since a payslip is not signed and the snapshot already
  makes rendering deterministic.
- **D3 — who may print?** → Deferred with D2. Note that decision 2 makes it moot today: browser
  print is available to whoever can already open the payslip, which PY-11 settled.
- **D4 — is an HTML print view enough?** → **Yes** (decision 2), and it needs nothing built: the
  PY-11 page prints.

### Decision 5 is already satisfied

This is worth stating plainly because it is the requirement that would be expensive to retrofit and
is instead already paid for. `PayslipDto` is self-contained by construction (§3): the employee's
identity as it stood at issue, the currency, the basic salary, the day counts, every line with its
own derivation, the totals in minor units, the leave facts and the run id. A future renderer needs
**one document read** and touches nothing live.

So decision 5 is not a constraint on future work so much as a description of what PY-7 already
built. Whoever picks the PDF phase up inherits the hard part finished.

## 6. Outcome

**Closed without implementation**, matching the recommendation this document opened with. PY-11
delivered the access; a browser prints it.

### The future capability, when a requirement appears

A real trigger would be a bank needing a signed file, an auditor needing an archive, or an employee
needing a stamped copy. At that point the phase is small and fully precedented:

1. render on demand from the `PayslipDto` snapshot (decision 5 — and §3 says this already works);
2. follow `contract.print` for the permission shape, and answer the ESS `/me` case explicitly;
3. reuse `platform/pdf` — which stays disabled without `CHROMIUM_PATH`, so dev and CI stay hermetic.

Nothing in the repository anticipates that work today, and by decision 3 nothing should.
