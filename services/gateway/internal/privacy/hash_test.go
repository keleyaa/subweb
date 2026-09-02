package privacy

import (
	"errors"
	"strings"
	"testing"
)

var testHashSecret = []byte("01234567890123456789012345678901")

func TestHashIPIsStableFixedLowercaseHex(t *testing.T) {
	first, err := HashIP("203.0.113.10", testHashSecret)
	if err != nil {
		t.Fatalf("HashIP() error = %v", err)
	}
	second, err := HashIP("203.0.113.10", testHashSecret)
	if err != nil {
		t.Fatalf("HashIP() second error = %v", err)
	}
	if first != second {
		t.Fatalf("HashIP() values differ: %q and %q", first, second)
	}
	if len(first) != 64 {
		t.Fatalf("HashIP() length = %d, want 64", len(first))
	}
	for _, character := range first {
		if !strings.ContainsRune("0123456789abcdef", character) {
			t.Fatalf("HashIP() = %q, want lowercase hexadecimal", first)
		}
	}
	if strings.Contains(first, "203.0.113.10") {
		t.Fatalf("HashIP() exposed the raw IP: %q", first)
	}
}

func TestHashIPDiffersForDifferentSecrets(t *testing.T) {
	otherSecret := []byte("abcdefghijklmnopqrstuvwxyz123456")
	first, err := HashIP("203.0.113.10", testHashSecret)
	if err != nil {
		t.Fatalf("HashIP() error = %v", err)
	}
	second, err := HashIP("203.0.113.10", otherSecret)
	if err != nil {
		t.Fatalf("HashIP() with another secret error = %v", err)
	}
	if first == second {
		t.Fatalf("HashIP() values are equal for different secrets: %q", first)
	}
}

func TestHashIPRejectsInvalidOrUnboundedInputs(t *testing.T) {
	for name, test := range map[string]struct {
		ip     string
		secret []byte
	}{
		"empty IP":        {ip: "", secret: testHashSecret},
		"invalid IP":      {ip: "not-an-ip", secret: testHashSecret},
		"zoned IP":        {ip: "fe80::1%en0", secret: testHashSecret},
		"overlong IP":     {ip: strings.Repeat("1", maxIPHashInputBytes+1), secret: testHashSecret},
		"short secret":    {ip: "203.0.113.10", secret: []byte("short")},
		"overlong secret": {ip: "203.0.113.10", secret: make([]byte, maxIPHashSecretBytes+1)},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := HashIP(test.ip, test.secret); err == nil {
				t.Fatal("HashIP() error = nil, want validation error")
			}
		})
	}
}

func TestNewIPHasherCopiesAndValidatesSecret(t *testing.T) {
	secret := append([]byte(nil), testHashSecret...)
	hasher, err := NewIPHasher(secret)
	if err != nil {
		t.Fatalf("NewIPHasher() error = %v", err)
	}
	secret[0] ^= 0xff

	got, err := hasher.Hash("203.0.113.10")
	if err != nil {
		t.Fatalf("IPHasher.Hash() error = %v", err)
	}
	want, err := HashIP("203.0.113.10", testHashSecret)
	if err != nil {
		t.Fatalf("HashIP() error = %v", err)
	}
	if got != want {
		t.Fatalf("IPHasher.Hash() = %q, want %q", got, want)
	}

	_, err = NewIPHasher(nil)
	if err == nil {
		t.Fatal("NewIPHasher(nil) error = nil, want validation error")
	}
	if !errors.Is(err, errInvalidHashSecret) {
		t.Fatalf("NewIPHasher(nil) error = %v, want errInvalidHashSecret", err)
	}
}
