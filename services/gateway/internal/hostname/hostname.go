// Package hostname centralizes the hostname syntax the Gateway accepts for
// public domains and for host-allowlisted egress destinations. Both boundaries
// must agree: a value that passes configuration validation but fails allowlist
// validation (or the reverse) turns a startup contract into a runtime surprise.
package hostname

import "strings"

const (
	maxHostnameLength = 253
	maxLabelLength    = 63
)

// Valid reports whether value is a syntactically valid hostname: dot-separated
// labels of ASCII letters, digits, and inner hyphens. An empty value, a
// trailing dot, oversized labels, and leading or trailing hyphens are rejected.
func Valid(value string) bool {
	if len(value) == 0 || len(value) > maxHostnameLength || strings.HasSuffix(value, ".") {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if len(label) == 0 || len(label) > maxLabelLength || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if !(character >= 'a' && character <= 'z') &&
				!(character >= 'A' && character <= 'Z') &&
				!(character >= '0' && character <= '9') &&
				character != '-' {
				return false
			}
		}
	}
	return true
}
