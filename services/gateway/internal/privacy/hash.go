package privacy

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/netip"
)

const (
	minIPHashSecretBytes = 32
	maxIPHashSecretBytes = 64
	maxIPHashInputBytes  = 128
)

var (
	errInvalidHashSecret = errors.New("IP hash secret is invalid")
	errInvalidHashInput  = errors.New("IP hash input is invalid")
)

// IPHasher creates stable keyed identifiers for validated client IP addresses.
type IPHasher struct {
	secret []byte
}

// NewIPHasher validates and copies a secret for repeated IP hashing.
func NewIPHasher(secret []byte) (*IPHasher, error) {
	if len(secret) < minIPHashSecretBytes || len(secret) > maxIPHashSecretBytes {
		return nil, errInvalidHashSecret
	}
	return &IPHasher{secret: append([]byte(nil), secret...)}, nil
}

// Hash returns a fixed-length lowercase HMAC-SHA256 digest for an IP address.
func (hasher *IPHasher) Hash(ip string) (string, error) {
	if hasher == nil || len(hasher.secret) < minIPHashSecretBytes || len(hasher.secret) > maxIPHashSecretBytes {
		return "", errInvalidHashSecret
	}
	if len(ip) == 0 || len(ip) > maxIPHashInputBytes {
		return "", errInvalidHashInput
	}
	address, err := netip.ParseAddr(ip)
	if err != nil || address.Zone() != "" {
		return "", errInvalidHashInput
	}

	mac := hmac.New(sha256.New, hasher.secret)
	_, _ = mac.Write([]byte(address.String()))
	return hex.EncodeToString(mac.Sum(nil)), nil
}
