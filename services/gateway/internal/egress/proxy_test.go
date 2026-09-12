package egress

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

type recordingAuthorizer struct {
	authorized []string
	err        error
}

func (authorizer *recordingAuthorizer) Authorize(_ context.Context, authority string) (Authorization, error) {
	authorizer.authorized = append(authorizer.authorized, authority)
	return authorizer.grant(), authorizer.err
}

func (authorizer *recordingAuthorizer) Consume(string, string) (Authorization, error) {
	return authorizer.grant(), authorizer.err
}

// grant returns one valid, unexpired authorization so tests reach the dialer
// instead of failing authorization validation first.
func (authorizer *recordingAuthorizer) grant() Authorization {
	return Authorization{
		Token:     "token",
		Hostname:  "challenges.cloudflare.com",
		Port:      443,
		Addresses: []netip.Addr{netip.MustParseAddr("93.184.216.34")},
		ExpiresAt: time.Now().Add(time.Minute),
	}
}

func connectRequest(authority string) *http.Request {
	return &http.Request{
		Method: http.MethodConnect,
		Host:   authority,
		URL:    &url.URL{},
		Header: make(http.Header),
	}
}

func failingDialer(t *testing.T) *Dialer {
	t.Helper()
	return newDialer(time.Second, func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("dial failed")
	})
}

func TestRestrictedProxyRejectsUnlistedHostBeforeAuthorizing(t *testing.T) {
	authorizer := &recordingAuthorizer{}
	proxy, err := NewRestrictedProxy(authorizer, failingDialer(t), []string{"challenges.cloudflare.com"})
	if err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	proxy.ServeHTTP(response, connectRequest("subscription.example.test:443"))

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if len(authorizer.authorized) != 0 {
		t.Fatalf("authorize calls = %v, want none for a disallowed host", authorizer.authorized)
	}
	if strings.Contains(response.Body.String(), "subscription.example.test") {
		t.Fatalf("response body = %q, want no destination disclosure", response.Body.String())
	}
}

func TestRestrictedProxyServesListedHost(t *testing.T) {
	authorizer := &recordingAuthorizer{}
	proxy, err := NewRestrictedProxy(authorizer, failingDialer(t), []string{"Challenges.Cloudflare.com"})
	if err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	proxy.ServeHTTP(response, connectRequest("challenges.cloudflare.com:443"))

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d after the dial failure", response.Code, http.StatusBadGateway)
	}
	if len(authorizer.authorized) != 1 || authorizer.authorized[0] != "challenges.cloudflare.com:443" {
		t.Fatalf("authorize calls = %v, want the allowlisted authority", authorizer.authorized)
	}
}

func TestRestrictedProxyRejectsNonConnectMethod(t *testing.T) {
	proxy, err := NewRestrictedProxy(&recordingAuthorizer{}, failingDialer(t), []string{"challenges.cloudflare.com"})
	if err != nil {
		t.Fatal(err)
	}

	request := connectRequest("challenges.cloudflare.com:443")
	request.Method = http.MethodGet
	response := httptest.NewRecorder()
	proxy.ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
}

func TestNewRestrictedProxyRejectsInvalidAllowlist(t *testing.T) {
	for name, hosts := range map[string][]string{
		"empty":          {},
		"blank":          {"  "},
		"port":           {"challenges.cloudflare.com:443"},
		"trailing dot":   {"challenges.cloudflare.com."},
		"underscore":     {"challenges_cloudflare.com"},
		"empty label":    {"challenges..cloudflare.com"},
		"non-ascii host": {"challenges.cloudflare.com/"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewRestrictedProxy(&recordingAuthorizer{}, failingDialer(t), hosts); err == nil {
				t.Fatalf("NewRestrictedProxy(%v) error = nil, want invalid allowlist error", hosts)
			}
		})
	}
}

func TestUnrestrictedProxyAllowsUnlistedAuthority(t *testing.T) {
	proxy := NewProxy(&recordingAuthorizer{}, failingDialer(t))
	if !proxy.hostAllowed("subscription.example.test:443") {
		t.Fatal("unrestricted proxy rejected an authority, want allowed")
	}
	if !proxy.hostAllowed("") {
		t.Fatal("unrestricted proxy rejected an empty authority, want the authorizer to decide")
	}
}

func TestNewProxyServerUsesBoundedHTTPTimeouts(t *testing.T) {
	server := NewProxyServer("127.0.0.1:0", NewProxy(nil, nil))

	if server.ReadHeaderTimeout != proxyReadHeaderTimeout {
		t.Fatalf("ReadHeaderTimeout = %s, want %s", server.ReadHeaderTimeout, proxyReadHeaderTimeout)
	}
	if server.MaxHeaderBytes != proxyMaxHeaderBytes {
		t.Fatalf("MaxHeaderBytes = %d, want %d", server.MaxHeaderBytes, proxyMaxHeaderBytes)
	}
	if server.IdleTimeout != 0 {
		t.Fatalf("IdleTimeout = %s, want zero because CONNECT tunnels use per-I/O deadlines", server.IdleTimeout)
	}
}

func TestNewProxyUsesBoundedTunnelIdleTimeout(t *testing.T) {
	proxy := NewProxy(nil, nil)
	if proxy.idleTimeout != proxyIdleTimeout {
		t.Fatalf("idleTimeout = %s, want %s", proxy.idleTimeout, proxyIdleTimeout)
	}
}

func TestIdleReaderRefreshesReadDeadline(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	reader := &idleReader{connection: server, reader: server, timeout: 10 * time.Millisecond}
	started := make(chan error, 1)
	go func() {
		_, err := reader.Read(make([]byte, 1))
		started <- err
	}()

	select {
	case err := <-started:
		if err == nil {
			t.Fatal("Read error = nil, want timeout")
		}
		networkError, ok := err.(net.Error)
		if !ok || !networkError.Timeout() {
			t.Fatalf("Read error = %v, want timeout error", err)
		}
	case <-time.After(time.Second):
		t.Fatal("idle read did not time out")
	}
}
func TestRelayPreservesOppositeDirectionAfterHalfClose(t *testing.T) {
	clientPeer, clientConnection := tcpPair(t)
	remotePeer, remoteConnection := tcpPair(t)
	defer clientPeer.Close()
	defer clientConnection.Close()
	defer remotePeer.Close()
	defer remoteConnection.Close()

	proxy := &Proxy{idleTimeout: time.Second}
	done := make(chan struct{})
	go func() {
		proxy.relay(clientConnection, remoteConnection, strings.NewReader(""))
		close(done)
	}()

	if err := clientPeer.CloseWrite(); err != nil {
		t.Fatal(err)
	}
	if err := remotePeer.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if count, err := remotePeer.Read(make([]byte, 1)); count != 0 || err != io.EOF {
		t.Fatalf("remote EOF after client half-close = (%d, %v), want (0, EOF)", count, err)
	}
	if err := remotePeer.SetReadDeadline(time.Time{}); err != nil {
		t.Fatal(err)
	}
	if _, err := remotePeer.Write([]byte("late data")); err != nil {
		t.Fatal(err)
	}

	if err := clientPeer.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, len("late data"))
	if _, err := io.ReadFull(clientPeer, buffer); err != nil {
		t.Fatalf("read relayed data: %v", err)
	}
	if string(buffer) != "late data" {
		t.Fatalf("relayed data = %q, want %q", buffer, "late data")
	}
	if err := remotePeer.CloseWrite(); err != nil {
		t.Fatal(err)
	}

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("relay did not finish after both sides closed")
	}
}

func tcpPair(t *testing.T) (peer, server *net.TCPConn) {
	t.Helper()
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	peer, err = net.DialTCP("tcp4", nil, listener.Addr().(*net.TCPAddr))
	if err != nil {
		t.Fatal(err)
	}
	server, err = listener.AcceptTCP()
	if err != nil {
		peer.Close()
		t.Fatal(err)
	}
	return peer, server
}
