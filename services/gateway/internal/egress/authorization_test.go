package egress

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"testing"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/policy"
)

type recordingResolver struct {
	addresses []netip.Addr
	calls     int
}

func (resolver *recordingResolver) LookupNetIP(context.Context, string, string) ([]netip.Addr, error) {
	resolver.calls++
	return append([]netip.Addr(nil), resolver.addresses...), nil
}

func TestAuthorizeConnectRequires443(t *testing.T) {
	resolver := &recordingResolver{addresses: []netip.Addr{netip.MustParseAddr("8.8.8.8")}}
	authorizer, err := NewAuthorizer(resolver, 2*time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}

	for _, authority := range []string{
		"example.com",
		"example.com:80",
		"example.com:443:443",
		"[2001:4860:4860::8888]:80",
		"2001:4860:4860::8888:443",
	} {
		t.Run(authority, func(t *testing.T) {
			if _, err := authorizer.Authorize(context.Background(), authority); err == nil {
				t.Fatalf("Authorize(%q) error = nil, want rejection", authority)
			}
		})
	}
}

func TestAuthorizeDirectIPDoesNotRequireResolver(t *testing.T) {
	authorizer, err := NewAuthorizer(nil, 2*time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}

	authorization, err := authorizer.Authorize(context.Background(), "8.8.8.8:443")
	if err != nil {
		t.Fatalf("Authorize() error = %v, want direct IP without resolver", err)
	}
	if len(authorization.Addresses) != 1 || authorization.Addresses[0].String() != "8.8.8.8" {
		t.Fatalf("Authorization addresses = %v, want direct IP", authorization.Addresses)
	}
}

func TestAuthorizeRejectsOversizedAddressSet(t *testing.T) {
	addresses := make([]netip.Addr, 17)
	for index := range addresses {
		addresses[index] = netip.MustParseAddr(fmt.Sprintf("8.8.8.%d", index+1))
	}
	resolver := &recordingResolver{addresses: addresses}
	authorizer, err := NewAuthorizer(resolver, 2*time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}
	if _, err := authorizer.Authorize(context.Background(), "example.com:443"); err == nil {
		t.Fatal("Authorize() error = nil, want oversized address set rejection")
	}
}

func TestAuthorizeCapacityIsBounded(t *testing.T) {
	authorizer, err := NewAuthorizer(nil, 2*time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}
	for index := 0; index < maxPendingAuthorizations; index++ {
		if _, err := authorizer.Authorize(context.Background(), "8.8.8.8:443"); err != nil {
			t.Fatalf("Authorize() at index %d error = %v", index, err)
		}
	}
	if _, err := authorizer.Authorize(context.Background(), "8.8.8.8:443"); err == nil {
		t.Fatal("Authorize() beyond capacity error = nil, want bounded rejection")
	}
}

func TestAuthorizeConnectRejectsPrivateResolution(t *testing.T) {
	resolver := &recordingResolver{addresses: []netip.Addr{netip.MustParseAddr("127.0.0.1")}}
	authorizer, err := NewAuthorizer(resolver, 2*time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}

	_, err = authorizer.Authorize(context.Background(), "private.example:443")
	var policyErr policy.PolicyError
	if !errors.As(err, &policyErr) {
		t.Fatalf("Authorize() error = %T %v, want PolicyError", err, err)
	}
	if policyErr.Code != "private_address" || policyErr.Status != 403 {
		t.Fatalf("PolicyError = %+v, want private_address/403", policyErr)
	}
}

func TestAuthorizeReturnedAddressesCannotMutateStoredAuthorization(t *testing.T) {
	resolver := &recordingResolver{addresses: []netip.Addr{netip.MustParseAddr("8.8.8.8")}}
	authorizer, err := NewAuthorizer(resolver, 2*time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}

	authorization, err := authorizer.Authorize(context.Background(), "example.com:443")
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	authorization.Addresses[0] = netip.MustParseAddr("1.1.1.1")

	consumed, err := authorizer.Consume(authorization.Token, "example.com:443")
	if err != nil {
		t.Fatalf("Consume() error = %v", err)
	}
	if got := consumed.Addresses[0].String(); got != "8.8.8.8" {
		t.Fatalf("consumed address = %s, want verified 8.8.8.8", got)
	}
}

func TestAuthorizeAndConsumeBindsTargetAndIsOneTime(t *testing.T) {
	resolver := &recordingResolver{addresses: []netip.Addr{netip.MustParseAddr("8.8.8.8")}}
	authorizer, err := NewAuthorizer(resolver, 2*time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}

	authorization, err := authorizer.Authorize(context.Background(), "Example.COM:443")
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if authorization.Token == "" || authorization.Hostname != "example.com" || authorization.Port != 443 {
		t.Fatalf("Authorization = %+v, want normalized one-time token and :443", authorization)
	}
	if len(authorization.Addresses) != 1 || authorization.Addresses[0].String() != "8.8.8.8" {
		t.Fatalf("Authorization addresses = %v, want verified address", authorization.Addresses)
	}

	if _, err := authorizer.Consume(authorization.Token, "other.example:443"); err == nil {
		t.Fatal("Consume() with another authority error = nil, want rejection")
	}
	consumed, err := authorizer.Consume(authorization.Token, "example.com:443")
	if err != nil {
		t.Fatalf("Consume() error = %v", err)
	}
	if consumed.Token != authorization.Token || consumed.Hostname != authorization.Hostname {
		t.Fatalf("consumed authorization = %+v, want original authorization", consumed)
	}
	if _, err := authorizer.Consume(authorization.Token, "example.com:443"); err == nil {
		t.Fatal("replayed Consume() error = nil, want one-time rejection")
	}
	if resolver.calls != 1 {
		t.Fatalf("resolver calls = %d, want one authorization lookup and no Consume lookup", resolver.calls)
	}
}

func TestConnectCannotReplayExpiredAuthorization(t *testing.T) {
	resolver := &recordingResolver{addresses: []netip.Addr{netip.MustParseAddr("8.8.8.8")}}
	authorizer, err := NewAuthorizer(resolver, 2*time.Second, time.Millisecond)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}

	authorization, err := authorizer.Authorize(context.Background(), "example.com:443")
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, err := authorizer.Consume(authorization.Token, "example.com:443"); err == nil {
		t.Fatal("expired Consume() error = nil, want rejection")
	}
}

type blockingResolver struct {
	started chan struct{}
}

func (resolver *blockingResolver) LookupNetIP(ctx context.Context, _, _ string) ([]netip.Addr, error) {
	close(resolver.started)
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestAuthorizePropagatesContextCancellationDuringDNS(t *testing.T) {
	resolver := &blockingResolver{started: make(chan struct{})}
	authorizer, err := NewAuthorizer(resolver, time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, authorizeErr := authorizer.Authorize(ctx, "example.com:443")
		result <- authorizeErr
	}()
	<-resolver.started
	cancel()

	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("Authorize() error = %v, want context.Canceled", err)
	}
}

func TestAuthorizeConnectHonorsContextCancellation(t *testing.T) {
	resolver := &recordingResolver{addresses: []netip.Addr{netip.MustParseAddr("8.8.8.8")}}
	authorizer, err := NewAuthorizer(resolver, 2*time.Second, 5*time.Second)
	if err != nil {
		t.Fatalf("NewAuthorizer() error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := authorizer.Authorize(ctx, "example.com:443"); !errors.Is(err, context.Canceled) {
		t.Fatalf("Authorize() error = %v, want context.Canceled", err)
	}
	if resolver.calls != 0 {
		t.Fatalf("resolver calls = %d, want no lookup after cancellation", resolver.calls)
	}
}
