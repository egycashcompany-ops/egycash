# WhatsApp activation links through Telnyx

ECMS sends a login's one-time setup link over email and WhatsApp
([auth design §12 R3/R9](../12-planning/auth-account-lifecycle-design.md)) when HR registers an
employee (the login is made and the link sent at once), when an administrator presses **Resend setup
link** or resets a password, when the
[activation follow-up workflow](../../automation/README.md) re-sends it after 48 hours, and in the
boot backfill. («إنشاء حساب دخول» for an existing employee and creating a user in System Users send
nothing: they hand the link to the person creating it.) This guide switches the WhatsApp half on
through [Telnyx](https://telnyx.com).

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
registered in that account under the same name and language is reported, not submitted again. It
refuses while `WEB_PUBLIC_URL` is not a public `https://` address, because Meta approves the
button's address as written — and `--write` and `--status` both say so loudly when the template
already there was approved for a **different** address than this deployment's. Never send through
such a template: every employee's link would go to the old address.

On a developer machine the same command is `npm run whatsapp:template -- --status`, with the
variables in `.env` or on the command line.

## 4. Switch it on

Once `--status` says **APPROVED**, set on both services:

| Variable | Value |
|---|---|
| `WHATSAPP_PROVIDER` | `telnyx` |
| `WHATSAPP_ACTIVATION_TEMPLATE` | `ecms_account_activation` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `ar` |

Deploy the changed variables. A name Meta could never accept (capitals, spaces, hyphens) fails the
boot with a readable message. A valid name that is not the registered one, or not approved yet, is
either refused by Telnyx at send time — the outcome shows Telnyx's code and reason — or accepted
and dropped later by Meta, in which case ECMS shows it as sent. Step 5 is how you find out, which is
why it comes before the backfill.

## 5. Try it on one person

Register a new test employee with your own mobile — the template goes out at once — or put your
mobile on an existing test **login** (System Users → the account → Phone) and press **Resend setup
link** («إعادة إرسال رابط التفعيل») on its account card. Editing the employee's mobile in HR does not
change the number a resend uses: that is the login's own phone, copied once when the login was made.
«Credentials delivery» («إرسال بيانات الدخول») on the card shows the outcome per channel. `whatsapp: sent` means Telnyx **accepted** the message;
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

So, before the backfill runs with WhatsApp on, check the number's current limit:

- **Wait** until it covers the whole workforce, keeping `HR_PROVISION_MISSING_LOGINS=false` on
  **both** services until then — the app and the worker each run the backfill when they boot.
- **Or roll out by hand, a day's limit at a time.** There is no bulk action for this: for an
  existing employee «إنشاء حساب دخول» makes the login but sends nothing, so the template goes out
  only when «إعادة إرسال رابط التفعيل» is pressed on each account card.

Either way, if the activation follow-up workflow is enabled it re-sends after 48 hours to everyone
who has not activated yet, so each wave comes round a second time — budget for it twice. Each
template message is billed (by Meta, plus Telnyx's fee).

## When something goes wrong

The account's delivery outcome and the audit trail say why, in Telnyx's own words — with every value
that was sent (the token included) cut out first:

| Outcome | Meaning |
|---|---|
| `telnyx is not configured — set WHATSAPP_API_TOKEN and WHATSAPP_FROM_NUMBER` | one of the two is missing; nothing was sent |
| `telnyx responded 401` | the API key is wrong or revoked |
| `telnyx responded 4xx: <code> — <title> …` | Telnyx refused it, in its own words. A template, name or language problem: run `--status`; a number problem: check the number's WhatsApp registration in the Telnyx portal |
| `invalid phone number` | the login's phone cannot be read as a phone number; fix it on the login (System Users), not only on the employee, and re-send |
| `The operation was aborted due to timeout` | Telnyx did not answer within 15 seconds; re-send |

The API log line `whatsapp sent as plain text …` is written once per process for each kind of
message, and names it: `purpose: "activation"` means `WHATSAPP_ACTIVATION_TEMPLATE` is not set. A
line with no purpose is an applicant-portal message, which has no template yet (see below).

## Changing the wording, or the address

The text — and the button's address — are fixed once Meta approves them. To change either:

1. Change the text in `activation-whatsapp-template.ts` (or `WEB_PUBLIC_URL`, for a new address)
   and deploy.
2. Register it under a **new** name, leaving the Railway variable alone so live sends keep using
   the approved one:

   ```bash
   node apps/api/dist/whatsapp-template.cli.js --write --name ecms_account_activation_v2
   ```

   ```bash
   node apps/api/dist/whatsapp-template.cli.js --status --name ecms_account_activation_v2
   ```

3. Only once that says **APPROVED**, set `WHATSAPP_ACTIVATION_TEMPLATE=ecms_account_activation_v2`
   on both services.

The old template keeps working until step 3 as long as its variables are unchanged. The
admin-editable credentials template still writes the **email**; it does not change WhatsApp.

## What else WhatsApp sends

A customer-portal (Gold) account's setup code is handed to the customer by staff when the account is
created; nothing is sent then. A later **New setup link** («رابط تفعيل جديد») on the account
(which also resets its password), or the 48-hour follow-up, goes through this same path and sends this same template, with
«—» as the employee code — as the email already reads.

Two other messages use the same transport and still go as **plain text**: the applicant-portal link
(«ادخل على بوابة المتقدمين…») and the applicant-portal sign-in code. Under Telnyx they reach an
applicant only within 24 hours of the applicant writing to the company number. Each needs its own
approved template (the sign-in code in Meta's AUTHENTICATION category) before it can be relied on.
