package policy

import (
	"context"
	"errors"
	"net/netip"
	"net/url"
	"strings"
)

const defaultMaxURLLength = 4096

// Resolver resolves all addresses for a hostname.
type Resolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

// DialTarget contains the validated URL and the addresses authorized for its connection.
type DialTarget struct {
	URL       *url.URL
	Addresses []netip.Addr
}

// Options controls URL policy limits. A zero MaxURLLength uses the legacy 4096-byte limit.
type Options struct {
	MaxURLLength int
}

// PolicyError is a sanitized policy rejection with a stable machine code and HTTP status.
type PolicyError struct {
	Code   string
	Status int
}

// Error returns only the stable machine code and never includes request input or resolver details.
func (err PolicyError) Error() string {
	return err.Code
}

// ValidateRemoteURL validates a remote HTTPS URL and resolves its public connection addresses.
func ValidateRemoteURL(ctx context.Context, value string, resolver Resolver, opts Options) (DialTarget, error) {
	maxURLLength := opts.MaxURLLength
	if maxURLLength <= 0 {
		maxURLLength = defaultMaxURLLength
	}
	if len(value) > maxURLLength {
		return DialTarget{}, PolicyError{Code: "url_too_long", Status: 413}
	}

	// url.URL omits an empty fragment from Fragment, so inspect the source first.
	if strings.Contains(value, "#") {
		return DialTarget{}, PolicyError{Code: "url_not_allowed", Status: 403}
	}

	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Hostname() == "" || parsed.User != nil || (parsed.Port() != "" && parsed.Port() != "443") {
		return DialTarget{}, PolicyError{Code: "url_not_allowed", Status: 403}
	}

	hostname := parsed.Hostname()
	if address, err := netip.ParseAddr(hostname); err == nil {
		if !isPublicUnicast(address) {
			return DialTarget{}, PolicyError{Code: "private_address", Status: 403}
		}
		return DialTarget{URL: parsed, Addresses: []netip.Addr{address}}, nil
	}

	if resolver == nil {
		return DialTarget{}, PolicyError{Code: "dns_unresolvable", Status: 403}
	}
	addresses, err := resolver.LookupNetIP(ctx, "ip", hostname)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return DialTarget{}, PolicyError{Code: "dns_timeout", Status: 403}
		}
		return DialTarget{}, PolicyError{Code: "dns_unresolvable", Status: 403}
	}
	if len(addresses) == 0 {
		return DialTarget{}, PolicyError{Code: "private_address", Status: 403}
	}
	for _, address := range addresses {
		if !isPublicUnicast(address) {
			return DialTarget{}, PolicyError{Code: "private_address", Status: 403}
		}
	}

	return DialTarget{URL: parsed, Addresses: append([]netip.Addr(nil), addresses...)}, nil
}
