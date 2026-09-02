package policy

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"testing"
	"time"
)

type fakeResolver struct {
	addresses []netip.Addr
	err       error
	lookup    func(context.Context) ([]netip.Addr, error)
	calls     int
	network   string
	host      string
}

func (resolver *fakeResolver) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	resolver.calls++
	resolver.network = network
	resolver.host = host
	if resolver.lookup != nil {
		return resolver.lookup(ctx)
	}
	return resolver.addresses, resolver.err
}

func TestValidateAcceptsPublicHTTPSHostnameAndRetainsDialAddresses(t *testing.T) {
	publicAddress := netip.MustParseAddr("93.184.216.34")
	resolver := &fakeResolver{addresses: []netip.Addr{publicAddress}}
	input := "https://example.com/sub?token=opaque"

	target, err := ValidateRemoteURL(context.Background(), input, resolver, Options{})
	if err != nil {
		t.Fatalf("ValidateRemoteURL() error = %v, want nil", err)
	}
	if target.URL == nil || target.URL.String() != input {
		t.Fatalf("target.URL = %v, want %q", target.URL, input)
	}
	if len(target.Addresses) != 1 || target.Addresses[0] != publicAddress {
		t.Fatalf("target.Addresses = %v, want [%s]", target.Addresses, publicAddress)
	}
	if resolver.calls != 1 || resolver.network != "ip" || resolver.host != "example.com" {
		t.Fatalf("resolver call = %d, network = %q, host = %q; want one ip lookup for example.com", resolver.calls, resolver.network, resolver.host)
	}
}

func TestValidateRejectsOversizedResolverResult(t *testing.T) {
	addresses := make([]netip.Addr, 17)
	for index := range addresses {
		addresses[index] = netip.MustParseAddr("93.184.216.34")
	}
	resolver := &fakeResolver{addresses: addresses}

	_, err := ValidateRemoteURL(context.Background(), "https://example.com/path", resolver, Options{})
	assertPolicyError(t, err, "too_many_addresses", 403)
}

func TestValidateRejectsSuccessfulLookupAfterContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	resolver := &fakeResolver{lookup: func(context.Context) ([]netip.Addr, error) {
		cancel()
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}}

	_, err := ValidateRemoteURL(ctx, "https://example.com/path", resolver, Options{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("ValidateRemoteURL() error = %v, want context.Canceled", err)
	}
}

func TestValidateAcceptsPublicIPWithoutResolver(t *testing.T) {
	publicAddress := netip.MustParseAddr("1.1.1.1")
	resolver := &fakeResolver{lookup: func(context.Context) ([]netip.Addr, error) {
		t.Fatal("public IP must not be resolved")
		return nil, nil
	}}

	target, err := ValidateRemoteURL(context.Background(), "https://1.1.1.1/path", resolver, Options{})
	if err != nil {
		t.Fatalf("ValidateRemoteURL() error = %v, want nil", err)
	}
	if resolver.calls != 0 {
		t.Fatalf("resolver calls = %d, want 0", resolver.calls)
	}
	if len(target.Addresses) != 1 || target.Addresses[0] != publicAddress {
		t.Fatalf("target.Addresses = %v, want [%s]", target.Addresses, publicAddress)
	}
}

func TestValidateAcceptsCaseInsensitiveHTTPSWithNumericDefaultPort(t *testing.T) {
	resolver := &fakeResolver{addresses: []netip.Addr{netip.MustParseAddr("93.184.216.34")}}

	_, err := ValidateRemoteURL(context.Background(), "HTTPS://example.com:0443/path", resolver, Options{})
	if err != nil {
		t.Fatalf("ValidateRemoteURL() error = %v, want nil", err)
	}
	if resolver.calls != 1 || resolver.host != "example.com" {
		t.Fatalf("resolver call = %d, host = %q; want one lookup for example.com", resolver.calls, resolver.host)
	}
}

func TestValidateAcceptsPublicIPv6WithoutResolver(t *testing.T) {
	publicAddress := netip.MustParseAddr("2001:4860:4860::8888")
	resolver := &fakeResolver{lookup: func(context.Context) ([]netip.Addr, error) {
		t.Fatal("public IP must not be resolved")
		return nil, nil
	}}

	target, err := ValidateRemoteURL(context.Background(), "https://[2001:4860:4860::8888]/path", resolver, Options{})
	if err != nil {
		t.Fatalf("ValidateRemoteURL() error = %v, want nil", err)
	}
	if resolver.calls != 0 {
		t.Fatalf("resolver calls = %d, want 0", resolver.calls)
	}
	if len(target.Addresses) != 1 || target.Addresses[0] != publicAddress {
		t.Fatalf("target.Addresses = %v, want [%s]", target.Addresses, publicAddress)
	}
}

func TestValidateRejectsUnsafeURLForms(t *testing.T) {
	for name, input := range map[string]string{
		"HTTP":                "http://example.com/path",
		"FTP":                 "ftp://example.com/path",
		"userinfo":            "https://user:password@example.com/path",
		"fragment":            "https://example.com/path#fragment",
		"empty fragment":      "https://example.com/path#",
		"non-443 port":        "https://example.com:8443/path",
		"missing host":        "https:///path",
		"malformed":           "https://[2001:db8::1/path",
		"invalid port":        "https://example.com:not-a-port/path",
		"scoped IPv6 literal": "https://[fe80::1%25en0]/",
	} {
		t.Run(name, func(t *testing.T) {
			resolver := &fakeResolver{addresses: []netip.Addr{netip.MustParseAddr("93.184.216.34")}}
			_, err := ValidateRemoteURL(context.Background(), input, resolver, Options{})
			assertPolicyError(t, err, "url_not_allowed", 403)
			if resolver.calls != 0 {
				t.Fatalf("resolver calls = %d, want 0 for rejected URL", resolver.calls)
			}
		})
	}
}

func TestValidateRejectsURLContainingLiteralHash(t *testing.T) {
	resolver := &fakeResolver{}
	_, err := ValidateRemoteURL(context.Background(), "https://example.com/path%23fragment#", resolver, Options{})
	assertPolicyError(t, err, "url_not_allowed", 403)
	if resolver.calls != 0 {
		t.Fatalf("resolver calls = %d, want 0 for rejected URL", resolver.calls)
	}
}

func TestValidateRejectsURLLongerThanConfiguredMaximum(t *testing.T) {
	_, err := ValidateRemoteURL(
		context.Background(),
		"https://example.com/"+string(make([]byte, 20)),
		&fakeResolver{},
		Options{MaxURLLength: 20},
	)
	assertPolicyError(t, err, "url_too_long", 413)
}

func TestValidateUsesLegacyURLLengthDefault(t *testing.T) {
	input := "https://example.com/" + strings.Repeat("a", 4070)
	resolver := &fakeResolver{addresses: []netip.Addr{netip.MustParseAddr("93.184.216.34")}}

	if _, err := ValidateRemoteURL(context.Background(), input, resolver, Options{}); err != nil {
		t.Fatalf("ValidateRemoteURL() error = %v, want default limit to allow %d-byte URL", err, len(input))
	}
}

func TestValidateRejectsPrivateDirectAddresses(t *testing.T) {
	for _, input := range []string{
		"https://127.0.0.1/path",
		"https://[::1]/path",
		"https://10.0.0.1/path",
		"https://[fc00::1]/path",
	} {
		t.Run(input, func(t *testing.T) {
			resolver := &fakeResolver{lookup: func(context.Context) ([]netip.Addr, error) {
				t.Fatal("IP literal must not be resolved")
				return nil, nil
			}}
			_, err := ValidateRemoteURL(context.Background(), input, resolver, Options{})
			assertPolicyError(t, err, "private_address", 403)
			if resolver.calls != 0 {
				t.Fatalf("resolver calls = %d, want 0", resolver.calls)
			}
		})
	}
}

func TestValidateRejectsHostnameWithAnyPrivateDNSAnswer(t *testing.T) {
	resolver := &fakeResolver{addresses: []netip.Addr{
		netip.MustParseAddr("93.184.216.34"),
		netip.MustParseAddr("127.0.0.1"),
	}}

	_, err := ValidateRemoteURL(context.Background(), "https://example.com/path", resolver, Options{})
	assertPolicyError(t, err, "private_address", 403)
	if resolver.calls != 1 {
		t.Fatalf("resolver calls = %d, want 1", resolver.calls)
	}
}

func TestValidateRejectsSpecialPurposeDNSAnswers(t *testing.T) {
	for _, value := range []string{
		"192.52.193.1",
		"192.175.48.1",
		"2001:3::1",
		"2001:30::1",
		"2620:4f:8000::1",
	} {
		t.Run(value, func(t *testing.T) {
			resolver := &fakeResolver{addresses: []netip.Addr{netip.MustParseAddr(value)}}
			_, err := ValidateRemoteURL(context.Background(), "https://example.com/path", resolver, Options{})
			assertPolicyError(t, err, "private_address", 403)
			if resolver.calls != 1 {
				t.Fatalf("resolver calls = %d, want exactly one", resolver.calls)
			}
		})
	}
}

func TestValidateRejectsNoDNSAnswersWithLegacyPrivateAddressError(t *testing.T) {
	resolver := &fakeResolver{}

	_, err := ValidateRemoteURL(context.Background(), "https://example.com/path", resolver, Options{})
	assertPolicyError(t, err, "private_address", 403)
}

func TestValidateMapsResolverErrorToDNSUnresolvable(t *testing.T) {
	resolver := &fakeResolver{err: errors.New("resolver failure with internal detail")}

	_, err := ValidateRemoteURL(context.Background(), "https://example.com/path", resolver, Options{})
	assertPolicyError(t, err, "dns_unresolvable", 403)
	if err.Error() != "dns_unresolvable" {
		t.Fatalf("error = %q, want machine code only", err)
	}
}

func TestValidateMapsResolverTimeoutToDNSTimeout(t *testing.T) {
	resolver := &fakeResolver{err: &net.DNSError{Err: "i/o timeout", Name: "example.com", IsTimeout: true}}

	_, err := ValidateRemoteURL(context.Background(), "https://example.com/path", resolver, Options{})
	assertPolicyError(t, err, "dns_timeout", 403)
}

func TestValidateMapsContextDeadlineToDNSTimeout(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	resolver := &fakeResolver{lookup: func(ctx context.Context) ([]netip.Addr, error) {
		return nil, ctx.Err()
	}}

	_, err := ValidateRemoteURL(ctx, "https://example.com/path", resolver, Options{})
	assertPolicyError(t, err, "dns_timeout", 403)
}

func assertPolicyError(t *testing.T, err error, wantCode string, wantStatus int) {
	t.Helper()
	if err == nil {
		t.Fatalf("error = nil, want %s", wantCode)
	}
	policyError, ok := err.(PolicyError)
	if !ok {
		t.Fatalf("error type = %T, want policy.PolicyError", err)
	}
	if policyError.Code != wantCode || policyError.Status != wantStatus {
		t.Fatalf("policy error = %#v, want code %q status %d", policyError, wantCode, wantStatus)
	}
}
