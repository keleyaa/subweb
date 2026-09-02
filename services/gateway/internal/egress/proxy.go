package egress

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"time"
)

// Proxy is the internal HTTP CONNECT proxy used by SubConverter. It performs
// authorization before dialing and never exposes the destination or lower-level
// network error in its response body.
type Proxy struct {
	authorizer Authorizer
	dialer     *Dialer
}

// NewProxy constructs a CONNECT-only proxy from the shared policy components.
func NewProxy(authorizer Authorizer, dialer *Dialer) *Proxy {
	return &Proxy{authorizer: authorizer, dialer: dialer}
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

	copyDone := make(chan struct{}, 2)
	go proxy.copyHalf(copyDone, remote, io.MultiReader(buffered.Reader, client))
	go proxy.copyHalf(copyDone, client, remote)
	<-copyDone
	_ = client.SetDeadline(time.Now())
	_ = remote.SetDeadline(time.Now())
	<-copyDone
}

func (proxy *Proxy) copyHalf(done chan<- struct{}, destination net.Conn, source io.Reader) {
	_, _ = io.Copy(destination, source)
	closeWrite(destination)
	done <- struct{}{}
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

func writeProxyError(response http.ResponseWriter, status int) {
	response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	response.WriteHeader(status)
	_, _ = response.Write([]byte("egress request failed\n"))
}
