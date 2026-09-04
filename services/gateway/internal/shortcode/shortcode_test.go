package shortcode

import (
	"strings"
	"testing"
)

func TestValidPathAcceptsShortCodeCharacters(t *testing.T) {
	for _, value := range []string{"/a", "/abc_123-XYZ", "/" + strings.Repeat("a", 64)} {
		if !ValidPath(value) {
			t.Fatalf("ValidPath(%q) = false, want true", value)
		}
	}
}

func TestValidPathRejectsInvalidShortCodePaths(t *testing.T) {
	for _, value := range []string{"", "/", "abc", "/not/a/code", "/" + strings.Repeat("a", 65), "/bad.code"} {
		if ValidPath(value) {
			t.Fatalf("ValidPath(%q) = true, want false", value)
		}
	}
}

func TestValidCodeMatchesValidPath(t *testing.T) {
	for _, code := range []string{"a", "abc_123-XYZ", strings.Repeat("a", 64)} {
		if !ValidCode(code) || !ValidPath("/"+code) {
			t.Fatalf("short code %q should be valid in both forms", code)
		}
	}
	for _, code := range []string{"", "bad/code", strings.Repeat("a", 65)} {
		if ValidCode(code) || ValidPath("/"+code) {
			t.Fatalf("short code %q should be invalid in both forms", code)
		}
	}
}
