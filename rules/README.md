# Rules

`rules.json` holds ClauseWatch's detection rules and `rules_fixtures.json` the sentences each rule must and must not match. This folder is the source of truth: a rule is changed here, by pull request, and released as a signed file that every extension checks.

## The rules

Each rule finds sentences that say the thing below and quotes them. A sentence that denies it ("we do not…") is not a finding, and a finding is never a verdict on the service.

| Rule | Topic | What it looks for |
|---|---|---|
| `ai-training-on-user-content` | `ai_training` | Your content or inputs used to train or improve AI models. |
| `binding-arbitration` | `arbitration` | Disputes sent to binding arbitration instead of a court. |
| `class-action-waiver` | `arbitration` | Giving up the right to join a class action. |
| `ownership-assignment` | `ip_assignment` | Ownership of what you submit assigned to the service. |
| `perpetual-content-licence` | `ip_assignment` | A perpetual or irrevocable licence to your content. |
| `sells-personal-data` | `data_sale` | Personal data sold or rented. |
| `shares-with-data-brokers` | `data_sale` | Personal data shared with data brokers. |
| `changes-without-notice` | `unilateral_change` | Terms changed without telling you. |
| `effective-on-posting` | `unilateral_change` | Changes taking effect as soon as they are posted. |
| `retains-data-after-closure` | `data_retention` | Data kept, stored or preserved after an account is closed, deleted or cancelled. |
| `shares-data-for-advertising` | `ad_sharing` | Personal data shared or disclosed for advertising or with ad networks. |
| `automatic-renewal` | `auto_renewal` | Plans that renew or bill automatically or on a recurring basis. |
| `cancellation-notice-period` | `auto_renewal` | Cancelling only if done a number of days before the renewal or billing date. |
| `limits-liability` | `liability_limit` | The company limiting, capping or excluding its liability. |
| `governing-law-and-venue` | `governing_law` | A named governing law, or disputes only in named courts (not your own). |
| `collects-childrens-data` | `children_data` | Data collected or used about children or minors. |
| `collects-location-or-biometrics` | `location_biometric` | Precise location, GPS, or biometric data such as face geometry or fingerprints. |
| `terminate-without-reason` | `termination` | Accounts closed, suspended or removed at any time, for any reason, without notice or at the company's discretion. |

## Proposing a rule

1. Add or change the rule in `rules.json`: an `id`, a `category`, the `all` patterns that must all match a sentence and the `none` patterns that must not.
2. Add fixtures for it in `rules_fixtures.json`: at least one sentence it must match and one it must not (a near miss, such as "we do not sell your data"). Use invented text, never a real company's terms.
3. Run the checks:
   ```sh
   npm test             # every fixture through the browser's engine, pattern safety, speed on hostile text
   npm run check:rules  # every fixture through Go's engine (needs Go)
   ```
4. Open a pull request. It needs the checks green and one code-owner review.

## What a pattern may look like

Browser JavaScript matches by backtracking, so some patterns can freeze a tab on a long page. `src/engine/pattern-check.ts` refuses the shapes known to do that, here and in the extension. It is a careful filter, not a proof: official rules are also timed against hostile text in `npm test` and reviewed, and rules people write or import run on re2js, a linear-time engine, as well. The filter refuses:

- no lookaround, inline flags, special groups (`(?...)`) or backreferences, and only the escapes both engines read the same way: `\s \S \w \W \d \D \b \B \n \t \r \f \v` and escaped symbols such as `\.` or `\]`, and class ranges only inside printable ASCII;
- no class starting with `]` (`[]`, `[^]`): write `\]`;
- a group repeated more than once may not contain a quantifier or `|` (`(a+)+` is refused; `(that\s+)?` is fine);
- `.` and negated classes like `[^.]` need a bounded repeat, at most `{0,200}`;
- repeats in a row that can match the same characters may not both be open-ended, and bounded ones multiply to at most 1,000 choices (3,000 when a group of alternatives ends the chain);
- at most 400 characters per pattern, 8 patterns per list, 500 rules.

One difference the checks cannot see: JavaScript's `\s` also matches a non-breaking space, Go's does not. Text with a non-breaking space between two words can match in the extension and not in Go's engine; keep that in mind when a rule depends on `\s`.

## Releases

Rule and known-site changes are merged by pull request. The GuardianVigil team then does a final review, signs and releases each rules version (tagged `rules-v<version>`). Extensions accept only releases signed with the key built into them, and only a newer version; the bundled copy keeps working offline. How a release is checked: [docs/reader.md](../docs/reader.md#the-signed-release).
