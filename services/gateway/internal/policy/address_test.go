package policy

import (
	"net/netip"
	"testing"
)

func TestAddressAcceptsPublicUnicast(t *testing.T) {
	for _, value := range []string{
		"1.1.1.1",
		"93.184.216.34",
		"2001:4860:4860::8888",
	} {
		t.Run(value, func(t *testing.T) {
			address := netip.MustParseAddr(value)
			if !isPublicUnicast(address) {
				t.Fatalf("isPublicUnicast(%s) = false, want true", address)
			}
		})
	}
}

func TestAddressRejectsNonPublicUnicast(t *testing.T) {
	for _, value := range []string{
		"0.0.0.0",                  // unspecified
		"127.0.0.1",                // IPv4 loopback
		"10.0.0.1",                 // RFC 1918
		"172.16.0.1",               // RFC 1918
		"192.168.1.1",              // RFC 1918
		"169.254.1.1",              // IPv4 link-local
		"224.0.0.1",                // IPv4 multicast
		"100.64.0.1",               // carrier-grade NAT
		"198.18.0.1",               // benchmarking
		"192.0.2.1",                // TEST-NET-1 documentation
		"198.51.100.1",             // TEST-NET-2 documentation
		"203.0.113.1",              // TEST-NET-3 documentation
		"240.0.0.1",                // reserved
		"::",                       // unspecified
		"::1",                      // IPv6 loopback
		"fc00::1",                  // IPv6 ULA
		"fe80::1",                  // IPv6 link-local
		"ff02::1",                  // IPv6 multicast
		"2001:db8::1",              // IPv6 documentation
		"2001:2::1",                // IPv6 benchmarking
		"2001:0000::1",             // Teredo
		"2002::1",                  // 6to4
		"::ffff:192.0.2.1",         // IPv4-mapped IPv6
		"2001:4860:4860::8888%en0", // scoped address
	} {
		t.Run(value, func(t *testing.T) {
			address := netip.MustParseAddr(value)
			if isPublicUnicast(address) {
				t.Fatalf("isPublicUnicast(%s) = true, want false", address)
			}
		})
	}
}
