package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, rules, fixtures string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "rules.json"), []byte(rules), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "rules_fixtures.json"), []byte(fixtures), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestBundledRulesAgree(t *testing.T) {
	problems, err := check("../../rules")
	if err != nil || len(problems) > 0 {
		t.Fatalf("err=%v problems=%v", err, problems)
	}
}

func TestReportsDisagreementAndGoOnlyErrors(t *testing.T) {
	dir := write(t,
		`{"flags":"i","rules":[{"id":"a","all":["waive"],"none":["not"]},{"id":"b","all":["(?=x)y"],"none":[]},{"id":"c","all":["x"],"none":[]}]}`,
		`{"fixtures":{"a":{"match":["We do not waive"],"noMatch":["We waive it"]},"b":{"match":["y"],"noMatch":["z"]},"ghost":{"match":["x"],"noMatch":["y"]}}}`)
	problems, err := check(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(problems, "\n")
	for _, want := range []string{`a: should match "We do not waive"`, `a: should not match "We waive it"`, "b: \"(?=x)y\" does not compile in Go", "c: needs at least one match", "ghost: fixtures for a rule"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}
