package egress

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func validAuthorization() Authorization {
	return Authorization{
		Token:     "single-use-token",
		Hostname:  "subscription.example",
		Port:      443,
		Addresses: []netip.Addr{netip.MustParseAddr("8.8.8.8")},
		ExpiresAt: time.Now().Add(time.Minute),
	}
}

func TestDialerUsesVerifiedAddressNotHostname(t *testing.T) {
	var dialedNetwork string
	var dialedAddress string
	dialer := newDialer(time.Second, func(_ context.Context, network, address string) (net.Conn, error) {
		dialedNetwork = network
		dialedAddress = address
		return nil, errors.New("connection refused")
	})

	_, err := dialer.DialContext(context.Background(), validAuthorization())
	if err == nil {
		t.Fatal("DialContext() error = nil, want connection error")
	}
	if dialedNetwork != "tcp" || dialedAddress != "8.8.8.8:443" {
		t.Fatalf("dial target = %s/%s, want tcp/8.8.8.8:443", dialedNetwork, dialedAddress)
	}
	if strings.Contains(err.Error(), "subscription.example") {
		t.Fatalf("DialContext() leaked authorization hostname: %v", err)
	}
}

func TestDialerClosesConnectionReturnedWithError(t *testing.T) {
	connection := &trackingConn{}
	dialer := newDialer(time.Second, func(context.Context, string, string) (net.Conn, error) {
		return connection, errors.New("connection failed after allocation")
	})

	_, err := dialer.DialContext(context.Background(), validAuthorization())
	if err == nil {
		t.Fatal("DialContext() error = nil, want connection error")
	}
	if !connection.closed.Load() {
		t.Fatal("DialContext() did not close connection returned with error")
	}
}

func TestDialerClosesConnectionWhenContextCancelsAfterDial(t *testing.T) {
	connection := &trackingConn{}
	ctx, cancel := context.WithCancel(context.Background())
	dialer := newDialer(time.Second, func(context.Context, string, string) (net.Conn, error) {
		cancel()
		return connection, nil
	})

	_, err := dialer.DialContext(ctx, validAuthorization())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("DialContext() error = %v, want context.Canceled", err)
	}
	if !connection.closed.Load() {
		t.Fatal("DialContext() did not close connection after cancellation")
	}
}

func TestDialerHonorsContextCancellation(t *testing.T) {
	dialer := newDialer(time.Second, func(ctx context.Context, _, _ string) (net.Conn, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := dialer.DialContext(ctx, validAuthorization())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("DialContext() error = %v, want context.Canceled", err)
	}
}

func TestDialerUsesOneOverallConnectBudgetAcrossAddresses(t *testing.T) {
	calls := 0
	dialer := newDialer(5*time.Millisecond, func(ctx context.Context, _, _ string) (net.Conn, error) {
		calls++
		<-ctx.Done()
		return nil, ctx.Err()
	})
	authorization := validAuthorization()
	authorization.Addresses = []netip.Addr{
		netip.MustParseAddr("8.8.8.8"),
		netip.MustParseAddr("1.1.1.1"),
	}

	_, err := dialer.DialContext(context.Background(), authorization)
	var egressErr Error
	if !errors.As(err, &egressErr) || egressErr.Code != "egress_timeout" {
		t.Fatalf("DialContext() error = %T %v, want egress_timeout", err, err)
	}
	if calls != 1 {
		t.Fatalf("dial calls = %d, want one call within overall budget", calls)
	}
}

func TestDialerReturnsTimeoutForSlowConnect(t *testing.T) {
	dialer := newDialer(5*time.Millisecond, func(ctx context.Context, _, _ string) (net.Conn, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})

	_, err := dialer.DialContext(context.Background(), validAuthorization())
	var egressErr Error
	if !errors.As(err, &egressErr) {
		t.Fatalf("DialContext() error = %T %v, want Error", err, err)
	}
	if egressErr.Code != "egress_timeout" || egressErr.Status != 504 {
		t.Fatalf("Error = %+v, want egress_timeout/504", egressErr)
	}
}

func TestDialerRejectsInvalidOrExpiredAuthorizationBeforeDial(t *testing.T) {
	calls := 0
	dialer := newDialer(time.Second, func(context.Context, string, string) (net.Conn, error) {
		calls++
		return nil, errors.New("unexpected dial")
	})
	cases := []struct {
		name string
		auth Authorization
	}{
		{name: "missing token", auth: Authorization{Hostname: "example.com", Port: 443, Addresses: []netip.Addr{netip.MustParseAddr("8.8.8.8")}, ExpiresAt: time.Now().Add(time.Minute)}},
		{name: "expired", auth: Authorization{Token: "token", Hostname: "example.com", Port: 443, Addresses: []netip.Addr{netip.MustParseAddr("8.8.8.8")}, ExpiresAt: time.Now().Add(-time.Second)}},
		{name: "private address", auth: Authorization{Token: "token", Hostname: "example.com", Port: 443, Addresses: []netip.Addr{netip.MustParseAddr("127.0.0.1")}, ExpiresAt: time.Now().Add(time.Minute)}},
		{name: "IPv4 documentation address", auth: Authorization{Token: "token", Hostname: "example.com", Port: 443, Addresses: []netip.Addr{netip.MustParseAddr("192.0.2.1")}, ExpiresAt: time.Now().Add(time.Minute)}},
		{name: "IPv6 documentation address", auth: Authorization{Token: "token", Hostname: "example.com", Port: 443, Addresses: []netip.Addr{netip.MustParseAddr("2001:db8::1")}, ExpiresAt: time.Now().Add(time.Minute)}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := dialer.DialContext(context.Background(), testCase.auth); err == nil {
				t.Fatal("DialContext() error = nil, want rejection")
			}
		})
	}
	if calls != 0 {
		t.Fatalf("dial calls = %d, want no dial for invalid authorizations", calls)
	}
}

type trackingConn struct {
	net.Conn
	closed atomic.Bool
}

func (connection *trackingConn) Close() error {
	connection.closed.Store(true)
	return nil
}

func TestDialerTriesEachAuthorizedAddressWithoutResolvingHostname(t *testing.T) {
	addresses := []netip.Addr{
		netip.MustParseAddr("8.8.8.8"),
		netip.MustParseAddr("1.1.1.1"),
	}
	var dialed []string
	dialer := newDialer(time.Second, func(_ context.Context, _, address string) (net.Conn, error) {
		dialed = append(dialed, address)
		return nil, errors.New("connection refused")
	})
	authorization := validAuthorization()
	authorization.Addresses = addresses

	_, err := dialer.DialContext(context.Background(), authorization)
	if err == nil {
		t.Fatal("DialContext() error = nil, want connection error")
	}
	if len(dialed) != 2 || dialed[0] != "8.8.8.8:443" || dialed[1] != "1.1.1.1:443" {
		t.Fatalf("dialed addresses = %v, want both authorized IPs", dialed)
	}
}
