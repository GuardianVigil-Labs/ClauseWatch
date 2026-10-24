// rulecheck runs the rules' fixtures through Go's RE2 engine. The
// extension matches with JavaScript; any other reader of the same file (in Go
// or another RE2-style engine) must agree on every fixture, so a rule both
// engines read differently fails here instead of in an installed extension.
//
//	go run . ../../rules
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

type rulesFile struct {
	Flags string `json:"flags"`
	Rules []struct {
		ID   string   `json:"id"`
		All  []string `json:"all"`
		None []string `json:"none"`
	} `json:"rules"`
}

type fixturesFile struct {
	Fixtures map[string]struct {
		Match   []string `json:"match"`
		NoMatch []string `json:"noMatch"`
	} `json:"fixtures"`
}

func main() {
	dir := "rules"
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	problems, err := check(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rulecheck:", err)
		os.Exit(2)
	}
	for _, p := range problems {
		fmt.Fprintln(os.Stderr, "rulecheck:", p)
	}
	if len(problems) > 0 {
		os.Exit(1)
	}
	fmt.Println("rulecheck: every fixture agrees in Go")
}

func check(dir string) ([]string, error) {
	var rf rulesFile
	var ff fixturesFile
	if err := readJSON(filepath.Join(dir, "rules.json"), &rf); err != nil {
		return nil, err
	}
	if err := readJSON(filepath.Join(dir, "rules_fixtures.json"), &ff); err != nil {
		return nil, err
	}
	if rf.Flags != "i" {
		return nil, fmt.Errorf(`flags must be "i"`)
	}
	var problems []string
	compile := func(id string, ps []string) []*regexp.Regexp {
		out := make([]*regexp.Regexp, 0, len(ps))
		for _, p := range ps {
			re, err := regexp.Compile("(?i)" + p)
			if err != nil {
				problems = append(problems, fmt.Sprintf("%s: %q does not compile in Go: %v", id, p, err))
				continue
			}
			out = append(out, re)
		}
		return out
	}
	seen := map[string]bool{}
	for _, r := range rf.Rules {
		seen[r.ID] = true
		all, none := compile(r.ID, r.All), compile(r.ID, r.None)
		if len(all) != len(r.All) || len(none) != len(r.None) {
			continue
		}
		fx, ok := ff.Fixtures[r.ID]
		if !ok || len(fx.Match) == 0 || len(fx.NoMatch) == 0 {
			problems = append(problems, fmt.Sprintf("%s: needs at least one match and one noMatch fixture", r.ID))
			continue
		}
		for _, s := range fx.Match {
			if !matches(all, none, s) {
				problems = append(problems, fmt.Sprintf("%s: should match %q", r.ID, s))
			}
		}
		for _, s := range fx.NoMatch {
			if matches(all, none, s) {
				problems = append(problems, fmt.Sprintf("%s: should not match %q", r.ID, s))
			}
		}
	}
	for id := range ff.Fixtures {
		if !seen[id] {
			problems = append(problems, fmt.Sprintf("%s: fixtures for a rule that does not exist", id))
		}
	}
	return problems, nil
}

// matches is the extension's ruleMatches: every "all" pattern and no "none" pattern.
func matches(all, none []*regexp.Regexp, s string) bool {
	for _, re := range all {
		if !re.MatchString(s) {
			return false
		}
	}
	for _, re := range none {
		if re.MatchString(s) {
			return false
		}
	}
	return true
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
