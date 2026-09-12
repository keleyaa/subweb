package egress

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	proxyReadHeaderTimeout = 5 * time.Second
	proxyIdleTimeout       = 5 * time.Minute
	proxyMaxHeaderBytes    = 16 * 1024
)

var errInvalidAllowedHosts = errors.New("allowed host list is invalid")

// Proxy is the internal HTTP CONNECT proxy used by SubConverter. It performs
// authorization before dialing and never exposes the destination or lower-level
// network error in its response body.
type Proxy struct {
	authorizer   Authorizer
	dialer       *Dialer
	idleTimeout  time.Duration
	allowedHosts map[string]struct{}
}

// NewProxy constructs a CONNECT-only proxy from the shared policy components.
func NewProxy(authorizer Authorizer, dialer *Dialer) *Proxy {
	return &Proxy{
		authorizer:  authorizer,
		dialer:      dialer,
		idleTimeout: proxyIdleTimeout,
	}
}

// NewRestrictedProxy constructs a CONNECT-only proxy that only serves the
// listed hostnames. Callers use it to hand one dependency (MyUrls) a narrow
// egress path instead of the unrestricted subscription egress.
func NewRestrictedProxy(authorizer Authorizer, dialer *Dialer, hosts []string) (*Proxy, error) {
	if len(hosts) == 0 {
		return nil, errInvalidAllowedHosts
	}
	allowed := make(map[string]struct{}, len(hosts))
	for _, host := range hosts {
		host = strings.ToLower(strings.TrimSpace(host))
		if !isAuthorityHostname(host) {
			return nil, errInvalidAllowedHosts
		}
		allowed[host] = struct{}{}
	}
	proxy := NewProxy(authorizer, dialer)
	proxy.allowedHosts = allowed
	return proxy, nil
}

func (proxy *Proxy) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodConnect {
		response.Header().Set("Allow", http.MethodConnect)
		response.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if proxy == nil || proxy.authorizer == nil || proxy.dialer == nil {
		writeProxyError(response, http.StatusServiceUnavailable)
		return
	}
	// A restricted listener rejects disallowed destinations before any DNS
	// lookup so a narrow dependency cannot probe arbitrary public hosts.
	if !proxy.hostAllowed(request.Host) {
		writeProxyError(response, http.StatusForbidden)
		return
	}

	authorization, err := proxy.authorizer.Authorize(request.Context(), request.Host)
	if err != nil {
		writeProxyError(response, proxyStatus(err))
		return
	}
	// CONNECT itself is the one-time credential exchange. Removing the token
	// before dialing prevents abandoned requests from filling the token store.
	authorization, err = proxy.authorizer.Consume(authorization.Token, request.Host)
	if err != nil {
		writeProxyError(response, proxyStatus(err))
		return
	}
	remote, err := proxy.dialer.DialContext(request.Context(), authorization)
	if err != nil {
		writeProxyError(response, proxyStatus(err))
		return
	}

	hijacker, ok := response.(http.Hijacker)
	if !ok {
		_ = remote.Close()
		writeProxyError(response, http.StatusNotImplemented)
		return
	}
	client, buffered, err := hijacker.Hijack()
	if err != nil {
		_ = remote.Close()
		return
	}
	defer client.Close()
	defer remote.Close()
	if _, err := client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
		return
	}

	proxy.relay(client, remote, buffered.Reader)
}

// hostAllowed reports whether the CONNECT authority is permitted on this
// listener. An empty allowlist keeps the unrestricted subscription behaviour.
func (proxy *Proxy) hostAllowed(authority string) bool {
	if len(proxy.allowedHosts) == 0 {
		return true
	}
	hostname, _, _, err := parseAuthority(authority)
	if err != nil {
		return false
	}
	_, ok := proxy.allowedHosts[strings.ToLower(hostname)]
	return ok
}

func (proxy *Proxy) relay(client, remote net.Conn, buffered io.Reader) {
	copyDone := make(chan struct{}, 2)
	go proxy.copyHalf(copyDone, remote, client, io.MultiReader(buffered, client))
	go proxy.copyHalf(copyDone, client, remote, remote)
	<-copyDone
	<-copyDone
}

func (proxy *Proxy) copyHalf(done chan<- struct{}, destination, sourceConnection net.Conn, source io.Reader) {
	reader := &idleReader{connection: sourceConnection, reader: source, timeout: proxy.idleTimeout}
	writer := &idleWriter{connection: destination, timeout: proxy.idleTimeout}
	_, _ = io.Copy(writer, reader)
	closeWrite(destination)
	done <- struct{}{}
}

type idleReader struct {
	connection net.Conn
	reader     io.Reader
	timeout    time.Duration
}

func (reader *idleReader) Read(buffer []byte) (int, error) {
	if reader.timeout <= 0 {
		return reader.reader.Read(buffer)
	}
	if err := reader.connection.SetReadDeadline(time.Now().Add(reader.timeout)); err != nil {
		return 0, err
	}
	return reader.reader.Read(buffer)
}

type idleWriter struct {
	connection net.Conn
	timeout    time.Duration
}

func (writer *idleWriter) Write(buffer []byte) (int, error) {
	if writer.timeout <= 0 {
		return writer.connection.Write(buffer)
	}
	if err := writer.connection.SetWriteDeadline(time.Now().Add(writer.timeout)); err != nil {
		return 0, err
	}
	return writer.connection.Write(buffer)
}

func closeWrite(connection net.Conn) {
	if closeWriter, ok := connection.(interface{ CloseWrite() error }); ok {
		_ = closeWriter.CloseWrite()
	}
}

func proxyStatus(err error) int {
	if err == nil {
		return http.StatusBadGateway
	}
	if errors.Is(err, context.Canceled) {
		return http.StatusBadGateway
	}
	var egressError Error
	if errors.As(err, &egressError) && egressError.Status >= 400 && egressError.Status <= 599 {
		return egressError.Status
	}
	return http.StatusBadGateway
}

func NewProxyServer(addr string, proxy *Proxy) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           proxy,
		ReadHeaderTimeout: proxyReadHeaderTimeout,
		MaxHeaderBytes:    proxyMaxHeaderBytes,
	}
}

func writeProxyError(response http.ResponseWriter, status int) {
	response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	response.WriteHeader(status)
	_, _ = response.Write([]byte("egress request failed\n"))
}
