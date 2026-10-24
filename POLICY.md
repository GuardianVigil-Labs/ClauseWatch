# Repository policy

This repository contains **only** the ClauseWatch browser extension, its rules, its tests and its own documentation.

## What never belongs here

Never commit personal data, local paths, credentials or non-public information:

- personal details: real names, personal email addresses, phone numbers, account IDs;
- details of anyone's computer: local paths, machine names, user names, local hostnames or addresses;
- credentials of any kind: keys, tokens, passwords, certificates, even expired or fake-looking ones;
- customer, employee or user data, including in test fixtures (use invented examples and RFC 5737 addresses);
- code, configuration or documents that are not part of this project, and links to private issues, documents or chats.

## What the extension calls

The extension calls no service of its own: its only request of its own is the daily download of the signed rules release from this repository's GitHub releases ([`docs/reader.md`](docs/reader.md)).

## Everything shipped is public

Anyone can unpack an installed extension and read every line. So:

- no secret may depend on the extension's code staying hidden;
- the extension holds no credentials of its own; an AI key the user enters stays on their device and goes only to the service they named;
- rules and known sites are trusted only when signed with a key built into the extension.

## How it is enforced

- `scripts/leak-guard.mjs` runs on every pull request and fails on local paths, personal email addresses, private network addresses, private keys and credential-shaped tokens. Run it locally with `npm run leak-guard`.
- Every change needs review from a code owner (`.github/CODEOWNERS`), and `main` accepts changes only through reviewed pull requests.
- A finding is fixed by removing the content, never by weakening the guard. Adding an allowed exception needs a code owner's approval and a written reason.
