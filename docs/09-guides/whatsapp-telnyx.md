# WhatsApp activation links through Telnyx

Every new login gets a one-time setup link — when HR creates an employee, when an administrator
re-sends or resets one, when the
[activation follow-up workflow](../../automation/README.md) re-sends it after 48 hours, and in the
boot backfill. ECMS sends it over email and WhatsApp
([auth design §12 R3/R9](../12-planning/auth-account-lifecycle-design.md)). This guide switches the
WhatsApp half on through [Telnyx](https://telnyx.com).

With it on, the employee receives:

> **EGYCASH — حساب الدخول الخاص بك جاهز**<br>
> Your EGYCASH login account is ready
>
> اسم المستخدم / Username: e1024<br>
> كود الموظف / Employee Code: E1024<br>
> صلاحية الرابط حتى / Link expires: 2026-11-03 08:00 UTC
>
> اضغط «تفعيل الحساب» لاختيار كلمة المرور. الرابط يُستخدم مرة واحدة.<br>
> Tap «Activate» to choose your password. The link works only once.
>
> _لا تشارك هذا الرابط · Do not share this link_
>
> **[ تفعيل الحساب · Activate ]** → `https://ecms.egycash.com.eg/activate?token=…`

## Why it has to be a template

WhatsApp lets a business **start** a conversation only with a message template Meta has approved in
advance. Free text is delivered only inside the 24 hours after the person last wrote to the
business number — and a new employee has never written to the company. So the setup link goes out
as the approved template `ecms_account_activation`, with the link as its button.

The template is defined once, in
[`activation-whatsapp-template.ts`](../../apps/api/src/platform/users/activation-whatsapp-template.ts):
the command that registers it with Meta and the code that fills it in for each employee both read
that file, so the two cannot disagree.

## 1. On Telnyx — once

1. **A number.** Telnyx's WhatsApp signup works with a number bought on Telnyx. The account has
   none yet: buy one in the portal (Numbers → Search & Buy). It does not need to be Egyptian.
2. **Meta business verification.** Verify EGYCASH in Meta Business Manager first — an unverified
   business is where WhatsApp signups most often stall, and it caps how many people you can message
   per day (see [§6](#6-before-the-go-live-backfill-the-daily-limit)).
3. **Connect WhatsApp.** In the Telnyx portal: Messaging → WhatsApp → Getting Started →
   _Connect WhatsApp Business_. This is Meta's embedded signup: pick the business, choose the
   number, enter the verification code. Telnyx creates the WhatsApp Business Account (WABA).
4. **Business profile.** Fill in the WhatsApp profile — description, website, category, logo.
   Meta rejects templates from incomplete profiles more often.
5. **An API key.** Create one on the portal's API Keys page. It is a secret: it goes only into
   Railway variables, never into the repository.

If the number has no SMS (a WhatsApp-only number), note the **messaging profile id** it is assigned
to as well — Telnyx needs it on each send.

## 2. Railway — the key and the number

On **both** services (app and worker), set:

| Variable | Value |
|---|---|
| `WHATSAPP_API_TOKEN` | the Telnyx API key |
| `WHATSAPP_FROM_NUMBER` | the WhatsApp number, `+…` |
| `WHATSAPP_ACCOUNT_ID` | the messaging profile id — only for a number without SMS |
| `WEB_PUBLIC_URL` | `https://ecms.egycash.com.eg` (already set — the button points here) |

Leave `WHATSAPP_PROVIDER` as it is for now. Switching it before the template is approved sends the
links as plain text, which reaches nobody new.

## 3. Register the template

From the app service's shell (where those variables are set):

```bash
# 1. Read exactly what will be submitted. Needs nothing — no key, no network.
node apps/api/dist/whatsapp-template.cli.js

# 2. Submit it to Meta, through Telnyx.
node apps/api/dist/whatsapp-template.cli.js --write

# 3. Ask whether Meta has approved it. Usually within a day.
node apps/api/dist/whatsapp-template.cli.js --status
```

`--write` finds the WhatsApp Business Account by itself when the Telnyx account has exactly one;
with several it lists them and asks for `--waba <id>`. It is safe to run twice: a template already
registered under the same name and language is reported, not submitted again. It refuses while
`WEB_PUBLIC_URL` is not a public `https://` address, because Meta approves the button's address as
written.

On a developer machine the same command is `npm run whatsapp:template -- --status`, with the
variables in `.env` or on the command line.

## 4. Switch it on

Once `--status` says **APPROVED**, set on both services:

| Variable | Value |
|---|---|
| `WHATSAPP_PROVIDER` | `telnyx` |
| `WHATSAPP_ACTIVATION_TEMPLATE` | `ecms_account_activation` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `ar` |

Railway redeploys on a variable change. A name Meta could never accept (capitals, spaces, hyphens)
fails the boot with a readable message; a valid name that is simply not the registered one shows
up as `40008` on the first send (see below), which is why step 5 comes before the backfill.

## 5. Try it on one person

Put your own mobile on a test employee, then press **Resend setup link** («إعادة إرسال رابط
التفعيل») on their account card. «Credentials delivery» («إرسال بيانات الدخول») on the card shows
the outcome per channel. `whatsapp: sent` means Telnyx **accepted** the message;
the API log line `whatsapp message accepted by telnyx` carries its `messageId`, which is what the
Telnyx portal's message search takes. Whether it reached the phone is reported by Telnyx afterwards
(its delivery webhooks are not wired into ECMS yet), so look at the phone, or at the message in the
portal.

## 6. Before the go-live backfill: the daily limit

Meta caps how many **different people** a business number may start conversations with in 24
hours. A newly connected number starts low, and the cap rises with business verification and with
the quality of what you send — WhatsApp Manager shows the current one. The boot backfill messages
every employed employee without a login, around 1,670 at go-live, in one go. Above the cap Meta
refuses the extra messages after Telnyx has accepted them, so ECMS would record them as sent.

So, before the backfill runs with WhatsApp on: check the number's current limit, and either wait
until it covers the whole workforce or roll out in waves — keep `HR_PROVISION_MISSING_LOGINS=false`
and create logins branch by branch, a day's limit at a time. Each template message is billed (by
Meta, plus Telnyx's fee).

## When something goes wrong

The account's delivery outcome and the audit trail say why, in Telnyx's own words — with every value
that was sent (the token included) cut out first:

| Outcome | Meaning |
|---|---|
| `telnyx is not configured — set WHATSAPP_API_TOKEN and WHATSAPP_FROM_NUMBER` | one of the two is missing; nothing was sent |
| `telnyx responded 401` | the API key is wrong or revoked |
| `telnyx responded 4xx: 40008 — …` | the template is not approved under that name and language, or the number is not registered for WhatsApp — run `--status` |
| `invalid phone number` | the employee's mobile cannot be read as a phone number; fix it and re-send |
| `The operation was aborted due to timeout` | Telnyx did not answer within 15 seconds; re-send |

The API log line `whatsapp sent as plain text …` (once per process) means `WHATSAPP_PROVIDER=telnyx`
is on without `WHATSAPP_ACTIVATION_TEMPLATE`.

## Changing the wording

The text is fixed once Meta approves it. Change it in `activation-whatsapp-template.ts`, set
`WHATSAPP_ACTIVATION_TEMPLATE` to a **new** name (`ecms_account_activation_v2`), register and wait
for approval as above — the old template keeps working until the variable is switched. The
admin-editable credentials template still writes the **email**; it does not change WhatsApp.

## What else WhatsApp sends

Customer-portal (Gold) accounts get their setup link through the same path, so they receive this
same template, with «—» as the employee code — exactly as their email already reads.

Two other messages use the same transport and still go as **plain text**: the applicant-portal link
(«ادخل على بوابة المتقدمين…») and the applicant-portal sign-in code. Under Telnyx they reach an
applicant only within 24 hours of the applicant writing to the company number. Each needs its own
approved template (the sign-in code in Meta's AUTHENTICATION category) before it can be relied on.
