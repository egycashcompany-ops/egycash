# P-HR-17 — Employee Exit Settlement Queue

**Status:** scope frozen before implementation. A **read**, and nothing else: no stored settlement,
no new entity, no event, no financial rule, no amount.

---

## 1. The gap

P-HR-11 built the settlement summary for **one** employee, reached from their profile. There is no
way to ask the opposite question — *who has left and still needs settling?* — so finding them means
knowing their names already.

That is the same defect P-HR-06 closed for adjustments and loans, in the same shape: **a list of the
people an existing per-record screen is about**.

## 2. What it reuses, unchanged

| what | from | how |
|---|---|---|
| who has exited | `employeeRepository.listEmployees({ employed: false })` | already supports scope, search, org filters, pagination and sorting |
| the exit facts | `employee.exit` | `type`, `effectiveDate` — read, never derived |
| the exit month | the same `YYYY-MM` derivation P-HR-11 uses | one shared helper, not a second copy |
| is the month settled? | `payrollRunService.frozenPeriods()` | one call for the whole page |
| is money still owed? | `employeeLoanService.list({ employeeId, status: 'outstandingAtExit' })` | the loans feature's own read |
| the permission | `employee.viewCompensation` | the key P-HR-11's summary already sits behind |

**Nothing new is added to any of those features.** No batch method, no widened query, no new filter.

## 3. Why the person is in the queue — stated, never computed

Every row carries the reason it exists, and each reason is a **fact somebody else already recorded**:

| flag | means | source |
|---|---|---|
| *(the row itself)* | they have exited — a settlement is a manual act and nothing marks it done | `employee.exit` |
| `hasOutstandingLoan` | money was still owed when they left (D8) | the loan's `outstandingAtExit` status |
| `finalPeriodOpen` | the exit month's run is not frozen, so the figures can still move | `frozenPeriods()` |

**No amount appears anywhere in this feature.** Not the balance, not the final pay, not a total. The
figures live on the settlement screen one click away, behind the same key — a list that restated
them would be a second place for the same money to be read, and a queue does not need it to do its
job.

### Deliberately NOT flagged here

* **Expired leave.** Every exit expires whatever balance remained, so the flag would be true for
  almost every row — it discriminates nothing, and the days themselves are already on the
  settlement screen where they can be read.
* **Undecided adjustments.** They already have a screen built for exactly this: the P-HR-06-A
  adjustments queue, org-wide and filtered by status. A third place to see them would cost a query
  per row to duplicate a list that exists.
* **The three unresolved policy amounts** (gratuity, encashment, notice). Identical for every row —
  they are a property of the system, not of a person, and P-HR-11 names them per settlement.

## 4. Two decisions worth recording

### 4.1 No new page, and therefore no new permission

A page in this registry must have at least one permission pointing at it (`validatePageRegistry` →
`empty-page`), and `pageId` is declared per **resource**. The only key that fits this screen is
`employee.viewCompensation`, and it belongs to the `employee` resource whose page is the employee
file — where compensation is genuinely administered. Re-pointing it would make the permission matrix
say something untrue, and inventing a key would contradict "the same existing read permissions".

So the queue is a **second view on the employees list page**, gated on
`can('employee.viewCompensation')` client-side and on the same key server-side. **The page registry
is untouched: 58 pages, and no new permission.**

### 4.2 One query per row for the loan, deliberately

P-HR-06's rule is "one query for the page, not one per row". The exception is argued rather than
assumed: the alternative — one org-wide read of every `outstandingAtExit` loan — is a scan whose
size grows without bound as leavers accumulate, and truncating it at `MAX_PAGE_SIZE` would silently
produce wrong flags. A point lookup per row is indexed, exact, and bounded by the page size.

## 5. Out of scope

No settlement entity or stored row · no termination entity · no event · no notification · no
financial rule · no recomputation of any figure · no bank/WPS · **no export, CSV or PDF — PY-12
stays closed** · no new page, permission, migration or state.

## 6. Test matrix

| case | expectation |
|---|---|
| an exited employee | appears, with their exit type, date and month |
| a serving employee | never appears, whatever the filters |
| a leaver owing money | `hasOutstandingLoan` true |
| a leaver owing nothing | `hasOutstandingLoan` false |
| exit month frozen | `finalPeriodOpen` false |
| exit month not frozen | `finalPeriodOpen` true |
| search / branch filter | narrows the same way the employees list does |
| pagination | standard envelope, same as every other list |
| without `employee.viewCompensation` | 403 |
| no amount in the payload | asserted — no balance, no pay, no total |
| no write path | asserted — the feature has no mutation at all |
