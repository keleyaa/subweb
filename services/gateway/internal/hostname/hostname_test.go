package hostname

import (
	"strings"
	"testing"
)

func TestValidAcceptsOrdinaryHostnames(t *testing.T) {
	for _, value := range []string{
		"challenges.cloudflare.com",
		"Challenges.Cloudflare.com",
		"a",
		"a-b.example.test",
		"host1.example.test",
		"192.0.2.1",
	} {
		if !Valid(value) {
			t.Fatalf("Valid(%q) = false, want true", value)
		}
	}
}

func TestValidRejectsMalformedHostnames(t *testing.T) {
	for name, value := range map[string]string{
		"empty":           "",
		"trailing dot":    "challenges.cloudflare.com.",
		"leading hyphen":  "-challenges.cloudflare.com",
		"trailing hyphen": "challenges-.cloudflare.com",
		"empty label":     "challenges..cloudflare.com",
		"underscore":      "challenges_cloudflare.com",
		"port":            "challenges.cloudflare.com:443",
		"scheme":          "https://challenges.cloudflare.com",
		"slash":           "challenges.cloudflare.com/",
		"space":           " challenges.cloudflare.com",
		"unicode":         "例え.example",
		"oversized label": strings.Repeat("a", maxLabelLength+1) + ".example.test",
		"oversized name":  "example.test" + strings.Repeat(".example", 40),
	} {
		t.Run(name, func(t *testing.T) {
			if Valid(value) {
				t.Fatalf("Valid(%q) = true, want false", value)
			}
		})
	}
}
