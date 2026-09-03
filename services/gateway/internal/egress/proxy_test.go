package egress

import (
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

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
