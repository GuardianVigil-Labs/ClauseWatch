// The rules and known sites built into this extension version: what it uses
// until a newer signed release verifies, and whenever one cannot be had.

import rules from "../../rules/rules.json";
import sites from "../../rules/sites.json";
import type { KnownSite } from "./known-sites";
import type { RulesFile } from "./rules";

export const BUNDLED: RulesFile = { ...(rules as RulesFile), sites: sites.sites as KnownSite[] };
