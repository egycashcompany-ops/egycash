# Medical Affairs (P-HR-MED)

**Status: decisions frozen (D1–D14). Not yet implemented — this doc is the base the phases build on.**

**Base:** `main` at `103299c` (Performance complete — P1 through P5 merged).

Every other HR module holds data about what somebody **did**. This one holds data about what
somebody **is**, and that is a different kind of thing to be wrong about.

A payroll error is visible on a bank statement and arguable. An attendance error is arguable against
a punch. A medical record has neither: it is a claim about a person's body, held by their employer,
that they may never see and cannot contest — and the harm from it leaking is not financial and does
not end.

So the load-bearing decisions in this module are all about **who may read**, and every one of them
resolves toward showing less.

---

## 1. What already exists, and what this module is not

The audit before this doc found three things.

**A pre-employment medical exam already exists**, and it is not this module. `medicalExam` is a
seeded evaluation phase in Recruitment (`permissionResource: 'medicalCheck'`, individual, with an
appointment and a required result document). Its subject is an **applicant**, its question is
«should we hire this person», and its answer is a pass or a fail on a stage.

This module's subject is an **employee**, and its question is «what does the company need to know
to employ this person safely and to insure them». The two are not phases of one thing:

| | Recruitment's `medicalExam` | Medical Affairs |
|---|---|---|
| subject | an applicant | an employee |
| decides | whether to hire | nothing |
| lifetime | ends at hire or rejection | the whole employment |
| read by | the recruitment stage's holders | a much smaller group (D3) |

**D1 — they stay separate, and nothing copies between them.** A hire does not carry the applicant's
exam result into an employee health record. That result answered a question that has been answered;
re-filing it as ongoing medical data would turn a one-day fitness check into a permanent claim about
somebody's health, made by a doctor who examined them once, before they started.

**No employee health data exists today.** The employee's `personal` block carries name, national id,
birth date, marital status, religion, education, military status — and nothing medical. This module
adds the first of it.

**Social insurance is already deferred, by a recorded decision.** `hr-payroll.ts` states that «taxes
and social insurance are out of Payroll v1 entirely», pointing at P-HR-12 and P-HR-14.

---

## 2. The word «insurance» means two things, and this module is only one of them

This is the first thing to settle, because the Arabic and the English both collapse it.

- **التأمينات الاجتماعية — social insurance.** A statutory deduction, an employer contribution, a
  government office, an insurance number on a form. It belongs to Payroll and is **deferred by a
  decision this module does not reopen**.
- **التأمين الطبي — medical insurance.** A benefit: a provider, a card number, a coverage tier, the
  dependants it covers, a renewal date.

**D2 — this module holds the SECOND one and never the first.** No insurance number that a payroll
deduction is calculated from, no contribution rate, no employer share. A guard spec forbids the
words by name, because the two are one word in the language everybody here speaks and the confusion
would arrive as a helpful addition rather than as a mistake.

---

## 3. The frozen decisions (D1–D14)

| # | decision |
|---|---|
| **D1** | **Recruitment's medical exam and this module stay separate**, and nothing copies between them (§1). |
| **D2** | **Medical insurance only, never social insurance** (§2). |
| **D3** | **Medical data is NOT readable by `employee.view`.** It gets its own key, and holding every other HR permission grants none of it. A line manager who may read somebody's attendance, salary band and contract may not read their blood type. |
| **D3-b** | **And the CARD gets a second key of its own** (`medicalInsurance.*`), separate from the clinical one. Added in M4, correcting this document. D4 scopes the card by branch precisely because benefits administration is DELEGABLE — and gating it on the clinical key would mean that delegating it hands out clinical access: whoever files a card number could read everybody's conditions. Administrative and clinical are two gates, not one. The page registry's «a page cannot exist without a permission» rule is what surfaced the error. |
| **D4** | **The organizational scope axes do not apply to the clinical record.** `branchId`/`departmentId` are stamped for the operational rows (§5) but a department-scoped reader is NOT thereby entitled to that department's health data — the key is the gate, not the axis. This is the one collection in HR where a wider scope must not mean wider reading. |
| **D5** | **The employee always sees their own record in full.** It is about them. There is no state in which the company knows something about somebody's body and they cannot read it. |
| **D6** | **Two separate things, kept apart:** the **health profile** (what is true of a person — blood type, chronic conditions, allergies, disability) and the **medical events** (what happened — an examination, a certificate, a fitness assessment on a date). A profile is corrected; an event is never edited (D9). |
| **D6-b** | **The emergency contact is NOT clinical data and does not live here.** It goes on the EMPLOYEE record, readable by `employee.view`. See §3.1 — this is the one decision in the module that deliberately makes something MORE visible. |
| **D7** | **A fitness verdict is a CLINICAL statement recorded as given, never derived.** «Fit», «fit with restrictions», «unfit for this role» comes from whoever examined the person. Nothing computes it from conditions, absences, or age. |
| **D8** | **Restrictions are recorded as WORDS, not as a machine-readable rule.** «No night shifts for six months» is stored as that sentence and a date. Nothing in Attendance or Fleet reads it and enforces it — see D11. |
| **D9** | **A medical event is immutable once recorded**, in the shape a training record is (P-HR-TRN D8) and a finalized review is (P-HR-PRF D7). What a doctor said on a date is not revised; a later opinion is a later event. |
| **D10** | **The insurance card is a benefit record, not a claim system.** Provider, policy/card number, tier as written, start and end, and the dependants covered. No claims, no reimbursements, no balances — that is an accounting boundary, and the same one PY-12, P-HR-12 and P-HR-14 are each stopped at. |
| **D11** | **Medical writes to nothing.** Not Attendance, not Payroll, not Fleet, not scheduling. A restriction does not remove somebody from a roster and an unfit verdict does not suspend anybody: those are decisions with legal consequences that a person makes and records as a personnel action, through the module that already exists for it. |
| **D12** | **No diagnosis codes, no ICD, no clinical coding.** A coded diagnosis is a medical record proper, and holding one makes the company a custodian of clinical data under a duty nobody here has scoped. Conditions are recorded as text on the profile because that is what an HR department can honestly hold. |
| **D13** | **No expiry sweep and no compliance screen.** «Whose medical certificate has lapsed» is a real question and a rule nobody has given — how long a certificate is valid, for which roles, and what follows from a lapse are three unstated decisions, and a screen computed from an invented one would be a report the company acts on. Expiry dates are stored and shown; nothing counts them. |
| **D14** | **Every read of the clinical record is audited**, including reads that return nothing. This is the only place in HR where READS are audited, and the reason is D3: the harm from a leak is not recoverable, so «who looked» has to be answerable after the fact rather than only «who changed». |

### 3.1 The emergency contact, and why it is the one thing this module pushes OUT

The first draft of this document filed the emergency contact under the health profile, with
everything else about somebody's body. That was wrong, and it is worth writing down why rather than
quietly moving the field.

Behind `medicalRecord.view`, the number you call when somebody collapses on a night shift is
readable by the small group D3 creates — and not by the supervisor standing over them. The failure
mode of over-protecting that field is not a privacy complaint; it is nobody being called.

And it is not clinical. A next-of-kin's name and phone number says nothing about a person's health.
It sits beside the phone numbers the employee record already carries, and it is read for the same
reason: somebody needs to reach a human quickly.

**So it belongs on the employee record**, readable by `employee.view`, and this module does not hold
it. The employee record has no emergency contact today — `EmployeeContact` carries two phones and an
email — so adding one is real work, and it belongs to Employee Management rather than here. Recorded
as a gap this module found and did not fix, because fixing it in Medical would put it behind exactly
the key that must not gate it.

Every other decision in this module reduces who can see something. This one is the exception, and
the exception is the point: «protect it» is not automatically the safer answer, and treating it as
one is how a field ends up locked away from the only person who needed it.

### What D7, D8, D11, D12 and D13 have in common

Five decisions to record and not act. A medical module's characteristic failure is not losing
data — it is **acting on a clinical fact through a rule nobody clinical gave it**: rostering around
a restriction the system parsed, flagging somebody unfit because a date passed, treating a stored
condition as a reason. Each of those is a decision about a person's livelihood, made by a schema.

Each gets a seam spec asserting the absence, in the shape `training-absences.spec.ts` uses.

---

## 4. Where each decision lands

- **D3/D3-b/D4** are the whole permission and scope story, and they invert the module's usual
  shape: the key gates, the axis does not widen — except on the card, where the axis is what makes
  delegation possible and a SECOND key is what stops that delegation reaching the clinical rows. `medical-visibility.spec.ts` asserts that the clinical
  repository declares NO `departmentField` — the opposite of what every other guard in this
  codebase requires, and therefore stated loudly where somebody «fixing» it will read it.
- **D5** is the `/me` read, in the shape P-HR-PRF P5 shipped.
- **D6** is two collections.
- **D9** is a `writeConditions()` seam on the events repository, the shape P-HR-PRF P4 used.
- **D14** is an audit write on the read path — the one place in HR that does it.

## 5. The collections

| | what it is | scope axes |
|---|---|---|
| `hr_medical_profiles` | one per employee: blood type, conditions, allergies, disability | none (D4) |
| `hr_medical_events` | an examination, a certificate, a fitness verdict on a date | none (D4) |
| `hr_medical_insurance` | the card: provider, number, tier, window, dependants | branch + department |

The insurance row carries the axes and the clinical rows do not, and that asymmetry IS D4: a card
number is an administrative fact somebody's HR officer legitimately administers by branch; a blood
type is not.

## 6. Events (ADR-008)

`hr.medicalEvent.recorded` · `hr.medicalInsurance.issued` · `.renewed` · `.ended`

**No event carries a clinical value** — no verdict, no condition, no restriction. The ids only. An
event is where a consequence gets attached by a subscriber written in good faith, and D11 is the
decision that no consequence exists.

There is deliberately **no `hr.medicalProfile.updated`**: a change to somebody's health profile is
not a fact other modules have any business reacting to.

## 7. The phases

| phase | what ships |
|---|---|
| **M1** | This document. |
| **M2** | The health profile: the record, its permission, the employee's own view (D3, D4, D5). |
| **M3** | Medical events: recording one, its immutability, its documents (D6, D7, D9). |
| **M4** | Medical insurance: the card and its dependants (D10). |

M2 first because the permission model is the module, and everything after it inherits the decision.

---

## 8. The questions for the owner

None of these blocks the module.

1. ~~**Who, by name, may read clinical data?** (D3)~~ — **ANSWERED (owner ruling, 2026-08-31): a
   seeded `hr-medical-officer` role, holding `medicalRecord.view` and `medicalRecord.manage` and
   nothing else.** Created by `hr.seed.ts` at boot — not by `seed-data.ts`, whose own header says
   production never runs it — and assigned to nobody, because which people read bodies is a
   decision code cannot make.

   **One correction to what this question claimed.** It said the key was "held by nobody". That
   was not accurate: `seed-data.ts` grants Super Admin `rbacService.registeredPermissionKeys()`,
   the whole registry, so that one account has always held it. The real defect was narrower and
   worse than "nobody can read" — the only key to the clinical door was on the master ring, which
   is precisely the arrangement D3 was written to prevent. The seeded HR account never held it
   (`platform-admin` gets only `moduleId === 'platform'` keys), so the module did ship unusable
   for its intended reader.

   The role is created with `ensureManagedRole`, and both consequences are deliberate: it is NOT a
   system role, so holding it does not make an account privileged and does not force TOTP
   enrollment on it; and its grant set is re-asserted on every boot, so the role cannot quietly
   grow — a key added by hand in the Roles screen is gone at the next deploy. An organization that
   needs a wider bundle builds its own role rather than widening this one.

   `medicalInsurance.*` (D3-b) stays OUT of it, and that is the point of the split: D4 scopes the
   card by branch because benefits administration is delegable, so folding those keys in would
   mean delegating card work hands out clinical access.
2. **Is medical insurance company-wide or per band?** (D10) — the tier is recorded as written
   either way; the question is whether a tier is ever DERIVED from a grade, which would be a rule.
3. **What follows an «unfit» verdict?** (D7, D11) — today: nothing automatic, and a person acts
   through a personnel action. If there is a required procedure, it is a phase.
4. **Certificate validity periods?** (D13) — how long, for which roles, and what a lapse means.
   Until all three are answered there is nothing to compute compliance against.
5. **Do dependants need records of their own?** (D10) — today they are names on a card. If the
   company administers their claims, that is a different and larger module.
6. **Who is the emergency contact, and does HR hold one today?** (D6-b) — the employee record has
   no field for it, so nobody's is recorded anywhere. Adding it is a small change to Employee
   Management and it is not this module's to make, but it is the gap most likely to matter on the
   day it matters.

Question 1 is answered above. The five that remain are all real questions about how the company
works, and none of them blocks the module.
