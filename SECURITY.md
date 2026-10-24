# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | Yes |

Security fixes go into the latest 1.x release. Rules releases are always fixed forward with a newer version.

## Reporting a vulnerability

Please report vulnerabilities privately, not in public issues:

- through GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**; or
- by email to clausewatch@guardianvigil.io.

Include what you found, how to reproduce it, and its impact. We will acknowledge the report, keep you informed until it is resolved, and credit you in the release notes if you wish.

## Scope

Especially in scope:

- a page that can make the extension read, fetch or send something it should not (for example a document on another site, or what is typed into a form);
- a way to make the extension accept rules or known sites that the GuardianVigil team did not sign, or an older release than the one it has;
- a pattern that passes the pattern check (`src/engine/pattern-check.ts`) but can freeze a page;
- a quote shown that is not the document's exact text;
- an AI answer that gets past the quote check (`src/ai/validate.ts`) or the summary's citation and verdict checks (`src/ai/summary.ts`).

Out of scope:

- the content of a third-party terms or privacy page, or a rule missing a clause (open a normal issue for that);
- the security of the AI service a user chooses with their own key;
- problems in the browser itself, or that need a modified browser or an already compromised device.

ClauseWatch has no server and no account: there is no user data held anywhere to attack. The public keys the extension trusts for rules releases are in `src/engine/trusted-keys.ts`.
