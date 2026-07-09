# Security Policy

ECMS handles identity documents, salaries, and cash-operations data for a cash-logistics
company — a vulnerability here can be a **physical-security** event, not just an IT event.
Please report responsibly.

## Reporting a vulnerability

- **Do not open a public GitHub issue** for anything security-related.
- Report privately via **GitHub Security Advisories**
  (_Security → Report a vulnerability_ on this repository), or by email to
  **egycash.company@gmail.com** with the subject line `SECURITY: <short summary>`.
- Include: affected component/endpoint, reproduction steps or proof of concept, impact
  assessment, and any suggested remediation. Please avoid accessing or exfiltrating real
  data while demonstrating an issue.

## What to expect

| Stage                               | Target                                          |
| ----------------------------------- | ----------------------------------------------- |
| Acknowledgement                     | within 3 business days                          |
| Triage & severity assessment        | within 7 days                                   |
| Fix or mitigation plan communicated | within 14 days of triage                        |
| Public disclosure                   | coordinated with the reporter after a fix ships |

## Scope

- This repository (API, worker, web, shared packages) and its deployment configuration.
- Especially valuable reports: authentication/session flaws (token rotation, TOTP, lockout),
  authorization bypasses (permission or data-scope escape), audit-trail evasion, NoSQL
  injection, and PII exposure (national IDs, contact data).
- Out of scope: vulnerabilities requiring physical access to EGYCASH facilities, social
  engineering of staff, and denial-of-service volume testing against live environments.

## Supported versions

The platform tracks `main` (single-organization internal deployment). Security fixes land on
`main` and are deployed per the [Deployment Strategy](docs/08-operations/deployment-strategy.md);
there are no long-term support branches.
