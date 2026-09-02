package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
)

func TestAppHostServesStaticPagesButAPIAndShortHostsDoNot(t *testing.T) {
	staticCalls := 0
	server := newTestServer(t, Dependencies{
		Static: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			staticCalls++
			if r.Host != "app.example.test" {
				t.Errorf("static request Host = %q, want app.example.test", r.Host)
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("app"))
		}),
	})

	appResponse := serveRequest(t, server, http.MethodGet, "app.example.test", "/dashboard/settings", nil)
	if appResponse.Code != http.StatusOK || appResponse.Body.String() != "app" {
		t.Fatalf("app response = %d %q, want 200 app", appResponse.Code, appResponse.Body.String())
	}
	for _, host := range []string{"api.example.test", "short.example.test"} {
		response := serveRequest(t, server, http.MethodGet, host, "/dashboard/settings", nil)
		if response.Code != http.StatusNotFound {
			t.Errorf("%s status = %d, want %d", host, response.Code, http.StatusNotFound)
		}
	}
	if staticCalls != 1 {
		t.Fatalf("static calls = %d, want 1", staticCalls)
	}
}

func TestHealthzDoesNotRequireDependencies(t *testing.T) {
	converterCalled := false
	shortLinksCalled := false
	readinessCalled := false
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			converterCalled = true
		}),
		ShortLinks: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			shortLinksCalled = true
		}),
		Readiness: func(context.Context) error {
			readinessCalled = true
			return errors.New("dependency should not be checked")
		},
	})

	for _, host := range []string{
		"APP.EXAMPLE.TEST:8443",
		"api.example.test",
		"short.example.test",
	} {
		t.Run(host, func(t *testing.T) {
			response := serveRequest(t, server, http.MethodGet, host, "/healthz", nil)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if contentType := response.Header().Get("Content-Type"); contentType != "text/plain" {
				t.Fatalf("Content-Type = %q, want text/plain", contentType)
			}
			if body := response.Body.String(); body != "ok\n" {
				t.Fatalf("body = %q, want ok\\n", body)
			}
			if requestID := response.Header().Get("X-Request-ID"); requestID == "" {
				t.Fatal("X-Request-ID is empty")
			}
		})
	}
	if converterCalled || shortLinksCalled || readinessCalled {
		t.Fatalf("dependencies called: converter=%t shortLinks=%t readiness=%t", converterCalled, shortLinksCalled, readinessCalled)
	}
}

func TestUnknownHostReturns421(t *testing.T) {
	server := newTestServer(t, Dependencies{})

	response := serveRequest(t, server, http.MethodGet, "unknown.example.test", "/healthz", nil)

	if response.Code != http.StatusMisdirectedRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMisdirectedRequest)
	}
	if requestID := response.Header().Get("X-Request-ID"); requestID == "" {
		t.Fatal("X-Request-ID is empty")
	}
}

func TestUnknownRouteReturns404(t *testing.T) {
	server := newTestServer(t, Dependencies{})

	response := serveRequest(t, server, http.MethodGet, "app.example.test", "/not-implemented", nil)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestReadyzReturnsOKOnAppAndAPIHosts(t *testing.T) {
	server := newTestServer(t, Dependencies{})

	for _, host := range []string{"app.example.test", "api.example.test"} {
		t.Run(host, func(t *testing.T) {
			response := serveRequest(t, server, http.MethodGet, host, "/readyz", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
		})
	}
}

func TestReadinessFailsWhenEnabledDependencyIsDown(t *testing.T) {
	server := newTestServer(t, Dependencies{
		Readiness: func(context.Context) error {
			return errors.New("redis://user:super-secret@redis:6379/1 unavailable")
		},
	})

	for _, host := range []string{"app.example.test", "api.example.test"} {
		t.Run(host, func(t *testing.T) {
			response := serveRequest(t, server, http.MethodGet, host, "/readyz", nil)

			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
			}
			if contentType := response.Header().Get("Content-Type"); contentType != "application/problem+json" {
				t.Fatalf("Content-Type = %q, want application/problem+json", contentType)
			}
			if body := response.Body.String(); strings.Contains(body, "super-secret") || strings.Contains(body, "redis://") {
				t.Fatalf("response body leaked readiness error: %q", body)
			}
		})
	}
}

func TestShortHostReadyzReturns404WithoutCheckingReadiness(t *testing.T) {
	readinessCalled := false
	server := newTestServer(t, Dependencies{
		Readiness: func(context.Context) error {
			readinessCalled = true
			return errors.New("readiness should not be checked")
		},
	})

	response := serveRequest(t, server, http.MethodGet, "short.example.test", "/readyz", nil)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if readinessCalled {
		t.Fatal("Readiness was called")
	}
}

func TestRequestIDIsGeneratedAndReturned(t *testing.T) {
	var dependencyRequestID string
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			dependencyRequestID = request.Header.Get("X-Request-ID")
			w.Header().Set("X-Request-ID", "dependency-request-id")
			w.WriteHeader(http.StatusAccepted)
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", map[string]string{
		"X-Request-ID": "client-request-id",
	})

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusAccepted)
	}
	requestID := response.Header().Get("X-Request-ID")
	if requestID == "" {
		t.Fatal("X-Request-ID is empty")
	}
	if requestID == "client-request-id" || requestID == "dependency-request-id" {
		t.Fatalf("X-Request-ID = %q, want a gateway-generated ID", requestID)
	}
	if dependencyRequestID != requestID {
		t.Fatalf("dependency X-Request-ID = %q, want %q", dependencyRequestID, requestID)
	}
}

func TestDependencyImplicitWriteDetectsContentType(t *testing.T) {
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("plain text"))
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/plain; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want text/plain; charset=utf-8", contentType)
	}
	if body := response.Body.String(); body != "plain text" {
		t.Fatalf("body = %q, want plain text", body)
	}
}

func TestDependencyEmptyWriteIsAllowedAfterNoContent(t *testing.T) {
	var written int
	var writeErr error
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
			written, writeErr = w.Write([]byte{})
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

	if written != 0 {
		t.Fatalf("Write count = %d, want 0", written)
	}
	if writeErr != nil {
		t.Fatalf("Write error = %v, want nil", writeErr)
	}
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "" {
		t.Fatalf("Content-Type = %q, want empty", contentType)
	}
	if body := response.Body.String(); body != "" {
		t.Fatalf("body = %q, want empty", body)
	}
}

func TestDependencyWriteRejectsBodiesForNoContentAndNotModified(t *testing.T) {
	for _, status := range []int{http.StatusNoContent, http.StatusNotModified} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			var written int
			var writeErr error
			server := newTestServer(t, Dependencies{
				Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("X-Upstream", "preserved")
					w.WriteHeader(status)
					written, writeErr = w.Write([]byte("must not emit"))
				}),
			})

			response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

			if written != 0 {
				t.Fatalf("Write count = %d, want 0", written)
			}
			if !errors.Is(writeErr, http.ErrBodyNotAllowed) {
				t.Fatalf("Write error = %v, want %v", writeErr, http.ErrBodyNotAllowed)
			}
			if response.Code != status {
				t.Fatalf("status = %d, want %d", response.Code, status)
			}
			if got := response.Header().Get("X-Upstream"); got != "preserved" {
				t.Fatalf("X-Upstream = %q, want preserved", got)
			}
			if body := response.Body.String(); body != "" {
				t.Fatalf("body = %q, want empty", body)
			}
		})
	}
}

func TestShortHeadDependencyEmptyWriteIsAllowedWithImplicitOK(t *testing.T) {
	var written int
	var writeErr error
	server := newTestServer(t, Dependencies{
		ShortLinks: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			written, writeErr = w.Write([]byte{})
		}),
	})

	response := serveRequest(t, server, http.MethodHead, "short.example.test", "/code", nil)

	if written != 0 {
		t.Fatalf("Write count = %d, want 0", written)
	}
	if writeErr != nil {
		t.Fatalf("Write error = %v, want nil", writeErr)
	}
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "" {
		t.Fatalf("Content-Type = %q, want empty", contentType)
	}
	if body := response.Body.String(); body != "" {
		t.Fatalf("body = %q, want empty", body)
	}
}

func TestShortHeadDependencyWriteRejectsBodyWithImplicitContentType(t *testing.T) {
	var written int
	var writeErr error
	server := newTestServer(t, Dependencies{
		ShortLinks: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			written, writeErr = w.Write([]byte("head response"))
		}),
	})

	response := serveRequest(t, server, http.MethodHead, "short.example.test", "/code", nil)

	if written != 0 {
		t.Fatalf("Write count = %d, want 0", written)
	}
	if !errors.Is(writeErr, http.ErrBodyNotAllowed) {
		t.Fatalf("Write error = %v, want %v", writeErr, http.ErrBodyNotAllowed)
	}
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/plain; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want text/plain; charset=utf-8", contentType)
	}
	if body := response.Body.String(); body != "" {
		t.Fatalf("body = %q, want empty", body)
	}
}

func TestRequestIDResponseHeaderRemovesCaseInsensitiveDuplicates(t *testing.T) {
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header()["x-request-id"] = []string{"spoofed"}
			w.WriteHeader(http.StatusAccepted)
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)
	keys, values := headerEntriesEqualFold(response.Header(), "X-Request-ID")
	if len(keys) != 1 {
		t.Fatalf("case-insensitive X-Request-ID keys = %q, want exactly one key", keys)
	}
	if keys[0] != "X-Request-Id" {
		t.Fatalf("X-Request-ID key = %q, want canonical key", keys[0])
	}
	if len(values) != 1 {
		t.Fatalf("case-insensitive X-Request-ID values = %q, want exactly one value", values)
	}
	if values[0] == "" || values[0] == "spoofed" {
		t.Fatalf("X-Request-ID value = %q, want a gateway-generated value", values[0])
	}
}

func TestRouteContracts(t *testing.T) {
	shortLinksCalls := 0
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
		ShortLinks: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			shortLinksCalls++
			w.WriteHeader(http.StatusNoContent)
		}),
	})

	tests := []struct {
		name      string
		method    string
		host      string
		path      string
		wantCode  int
		wantAllow string
	}{
		{name: "health method", method: http.MethodPost, host: "app.example.test", path: "/healthz", wantCode: http.StatusMethodNotAllowed, wantAllow: http.MethodGet},
		{name: "ready method", method: http.MethodPost, host: "app.example.test", path: "/readyz", wantCode: http.StatusMethodNotAllowed, wantAllow: http.MethodGet},
		{name: "api sub method", method: http.MethodPost, host: "api.example.test", path: "/sub", wantCode: http.StatusMethodNotAllowed, wantAllow: http.MethodGet},
		{name: "api other path", method: http.MethodGet, host: "api.example.test", path: "/other", wantCode: http.StatusNotFound},
		{name: "app links method", method: http.MethodGet, host: "app.example.test", path: "/short-api/links", wantCode: http.StatusMethodNotAllowed, wantAllow: http.MethodPost},
		{name: "app other path", method: http.MethodGet, host: "app.example.test", path: "/", wantCode: http.StatusNotFound},
		{name: "short code method", method: http.MethodPost, host: "short.example.test", path: "/abc_123-XYZ", wantCode: http.StatusMethodNotAllowed, wantAllow: "GET, HEAD"},
		{name: "short other path", method: http.MethodGet, host: "short.example.test", path: "/not/a/code", wantCode: http.StatusNotFound},
		{name: "short code get", method: http.MethodGet, host: "short.example.test", path: "/abc_123-XYZ", wantCode: http.StatusNoContent},
		{name: "short code head", method: http.MethodHead, host: "short.example.test", path: "/abc_123-XYZ", wantCode: http.StatusNoContent},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := serveRequest(t, server, test.method, test.host, test.path, nil)

			if response.Code != test.wantCode {
				t.Fatalf("status = %d, want %d", response.Code, test.wantCode)
			}
			if allow := response.Header().Get("Allow"); allow != test.wantAllow {
				t.Fatalf("Allow = %q, want %q", allow, test.wantAllow)
			}
		})
	}

	if shortLinksCalls != 2 {
		t.Fatalf("short links calls = %d, want 2", shortLinksCalls)
	}
}

func TestMissingDependenciesReturn404(t *testing.T) {
	server := newTestServer(t, Dependencies{})

	for _, test := range []struct {
		name   string
		method string
		host   string
		path   string
	}{
		{name: "converter", method: http.MethodGet, host: "api.example.test", path: "/sub"},
		{name: "app short links", method: http.MethodPost, host: "app.example.test", path: "/short-api/links"},
		{name: "short redirect", method: http.MethodGet, host: "short.example.test", path: "/code"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := serveRequest(t, server, test.method, test.host, test.path, nil)
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
		})
	}
}

func TestPanicReturnsInternalProblem(t *testing.T) {
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic("do not expose this")
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if body := response.Body.String(); strings.Contains(body, "do not expose this") {
		t.Fatalf("response body leaked panic value: %q", body)
	}
}

func TestNewServerUsesConfiguredListenAddr(t *testing.T) {
	cfg := testConfig()
	cfg.ListenAddr = "127.0.0.1:9090"

	server := NewServer(cfg, Dependencies{})

	if server.Addr != cfg.ListenAddr {
		t.Fatalf("Addr = %q, want %q", server.Addr, cfg.ListenAddr)
	}
	if server.Handler == nil {
		t.Fatal("Handler is nil")
	}
}

func newTestServer(t *testing.T, deps Dependencies) *http.Server {
	t.Helper()
	return NewServer(testConfig(), deps)
}

func testConfig() config.Config {
	return config.Config{
		ListenAddr:  "127.0.0.1:8080",
		AppDomain:   "app.example.test",
		APIDomain:   "api.example.test",
		ShortDomain: "short.example.test",
	}
}

func serveRequest(t *testing.T, server *http.Server, method, host, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "http://gateway.test"+path, nil)
	request.Host = host
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response := httptest.NewRecorder()
	server.Handler.ServeHTTP(response, request)
	return response
}

func TestHostAuthorityRejectsUnicodeSimpleFoldEquivalent(t *testing.T) {
	handlerCalls := 0
	server := newTestServer(t, Dependencies{
		ShortLinks: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			handlerCalls++
			w.WriteHeader(http.StatusNoContent)
		}),
	})

	uppercaseResponse := serveRequest(t, server, http.MethodGet, "APP.EXAMPLE.TEST", "/code", nil)
	if uppercaseResponse.Code != http.StatusNoContent {
		t.Fatalf("uppercase status = %d, want %d", uppercaseResponse.Code, http.StatusNoContent)
	}
	if handlerCalls != 1 {
		t.Fatalf("uppercase handler calls = %d, want 1", handlerCalls)
	}

	handlerCalls = 0
	unicodeResponse := serveRequest(t, server, http.MethodGet, "app.example.te\u017ft", "/code", nil)
	if unicodeResponse.Code != http.StatusMisdirectedRequest {
		t.Fatalf("Unicode status = %d, want %d", unicodeResponse.Code, http.StatusMisdirectedRequest)
	}
	if handlerCalls != 0 {
		t.Fatalf("Unicode host handler calls = %d, want 0", handlerCalls)
	}
}

func TestHostAuthorityRequiresConfiguredDomainAndValidOptionalPort(t *testing.T) {
	server := newTestServer(t, Dependencies{})

	for _, host := range []string{
		"app.example.test:bad",
		"app.example.test:0",
		"app.example.test:65536",
		"app.example.test:+443",
		"[app.example.test]:443",
		"app.example.test:443:8443",
		":443",
		"",
	} {
		t.Run(host, func(t *testing.T) {
			response := serveRequest(t, server, http.MethodGet, host, "/healthz", nil)
			if response.Code != http.StatusMisdirectedRequest {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusMisdirectedRequest)
			}
		})
	}

	response := serveRequest(t, server, http.MethodGet, "APP.EXAMPLE.TEST:8443", "/healthz", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestAppShortCodeRouteContract(t *testing.T) {
	shortLinksCalls := 0
	server := newTestServer(t, Dependencies{
		ShortLinks: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			shortLinksCalls++
			w.WriteHeader(http.StatusNoContent)
		}),
	})

	for _, test := range []struct {
		name      string
		method    string
		path      string
		wantCode  int
		wantAllow string
	}{
		{name: "short code get", method: http.MethodGet, path: "/abc_123-XYZ", wantCode: http.StatusNoContent},
		{name: "short code head", method: http.MethodHead, path: "/abc_123-XYZ", wantCode: http.StatusNoContent},
		{name: "short code post", method: http.MethodPost, path: "/abc_123-XYZ", wantCode: http.StatusMethodNotAllowed, wantAllow: "GET, HEAD"},
		{name: "invalid path", method: http.MethodGet, path: "/not/a/code", wantCode: http.StatusNotFound},
		{name: "short api query", method: http.MethodPost, path: "/short-api/links?x=1", wantCode: http.StatusNotFound},
		{name: "short api post", method: http.MethodPost, path: "/short-api/links", wantCode: http.StatusNoContent},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := serveRequest(t, server, test.method, "app.example.test", test.path, nil)
			if response.Code != test.wantCode {
				t.Fatalf("status = %d, want %d", response.Code, test.wantCode)
			}
			if allow := response.Header().Get("Allow"); allow != test.wantAllow {
				t.Fatalf("Allow = %q, want %q", allow, test.wantAllow)
			}
		})
	}

	if shortLinksCalls != 3 {
		t.Fatalf("short links calls = %d, want 3", shortLinksCalls)
	}
}

func TestDependencyRequestHeadersAreGatewayControlled(t *testing.T) {
	for _, test := range []struct {
		name       string
		method     string
		host       string
		path       string
		publicHost string
		remoteAddr string
		wantIP     string
	}{
		{name: "api subscription", method: http.MethodGet, host: "api.example.test", path: "/sub", publicHost: "api.example.test", remoteAddr: "203.0.113.9:4321", wantIP: "203.0.113.9"},
		{name: "app short link creation", method: http.MethodPost, host: "app.example.test", path: "/short-api/links", publicHost: "app.example.test", remoteAddr: "203.0.113.9:4321", wantIP: "203.0.113.9"},
		{name: "app short code", method: http.MethodGet, host: "app.example.test", path: "/code", publicHost: "app.example.test", remoteAddr: "203.0.113.9:4321", wantIP: "203.0.113.9"},
		{name: "short domain code", method: http.MethodGet, host: "short.example.test", path: "/code", publicHost: "short.example.test", remoteAddr: "203.0.113.9:4321", wantIP: "203.0.113.9"},
		{name: "unparseable peer omits IP headers", method: http.MethodGet, host: "api.example.test", path: "/sub", publicHost: "api.example.test", remoteAddr: "not-a-socket-address", wantIP: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			var receivedHost string
			var receivedHeaders http.Header
			dependency := http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				receivedHost = request.Host
				receivedHeaders = request.Header.Clone()
				w.Header().Set("X-Request-ID", "dependency-request-id")
				w.WriteHeader(http.StatusNoContent)
			})
			server := newTestServer(t, Dependencies{Converter: dependency, ShortLinks: dependency})

			request := httptest.NewRequest(test.method, "http://gateway.test"+test.path, nil)
			request.Host = test.host
			request.RemoteAddr = test.remoteAddr
			addSpoofedForwardingHeaders(request)
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			server.Handler.ServeHTTP(response, request)

			if response.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
			}
			if receivedHost != test.publicHost {
				t.Fatalf("dependency Host = %q, want %q", receivedHost, test.publicHost)
			}
			if got := receivedHeaders.Get("X-Forwarded-Host"); got != test.publicHost {
				t.Fatalf("dependency X-Forwarded-Host = %q, want %q", got, test.publicHost)
			}
			if got := receivedHeaders.Get("X-Forwarded-Proto"); got != "https" {
				t.Fatalf("dependency X-Forwarded-Proto = %q, want https", got)
			}
			if got := receivedHeaders.Get("X-Real-IP"); got != test.wantIP {
				t.Fatalf("dependency X-Real-IP = %q, want %q", got, test.wantIP)
			}
			if got := receivedHeaders.Get("X-Forwarded-For"); got != test.wantIP {
				t.Fatalf("dependency X-Forwarded-For = %q, want %q", got, test.wantIP)
			}
			if got := receivedHeaders.Get("Content-Type"); got != "application/json" {
				t.Fatalf("dependency Content-Type = %q, want application/json", got)
			}
			for _, header := range []string{
				"Authorization",
				"Proxy-Authorization",
				"Cookie",
				"Origin",
				"Forwarded",
				"X-Forwarded-By",
				"X-Forwarded-Client-Cert",
			} {
				if values := receivedHeaders.Values(header); len(values) != 0 {
					t.Fatalf("dependency %s = %q, want removed", header, values)
				}
			}
			requestID := response.Header().Get("X-Request-ID")
			if requestID == "" || requestID == "spoofed-request-id" || requestID == "dependency-request-id" {
				t.Fatalf("response X-Request-ID = %q, want gateway-generated ID", requestID)
			}
			if got := receivedHeaders.Get("X-Request-ID"); got != requestID {
				t.Fatalf("dependency X-Request-ID = %q, want %q", got, requestID)
			}
		})
	}
}

func TestBufferedDependencyResponseCommitsFinalStatusAfterInformationalResponse(t *testing.T) {
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Add("X-Upstream-Value", "first")
			w.WriteHeader(http.StatusEarlyHints)
			w.Header().Add("X-Upstream-Value", "second")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("final response"))
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if values := response.Header().Values("X-Upstream-Value"); strings.Join(values, ",") != "first,second" {
		t.Fatalf("X-Upstream-Value = %q, want [first second]", values)
	}
	if body := response.Body.String(); body != "final response" {
		t.Fatalf("body = %q, want final response", body)
	}
}

func TestBufferedDependencyResponseSnapshotsFinalHeaders(t *testing.T) {
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("X-First", "initial")
			w.WriteHeader(http.StatusOK)
			w.Header().Set("X-First", "mutated")
			w.Header().Set("X-Later", "later")
			w.Header().Set("X-Sensitive", "secret")
			_, _ = w.Write([]byte("final response"))
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if value := response.Header().Get("X-First"); value != "initial" {
		t.Fatalf("X-First = %q, want initial", value)
	}
	for _, header := range []string{"X-Later", "X-Sensitive"} {
		if values := response.Header().Values(header); len(values) != 0 {
			t.Fatalf("%s = %q, want removed", header, values)
		}
	}
	if body := response.Body.String(); body != "final response" {
		t.Fatalf("body = %q, want final response", body)
	}
}

func TestBufferedDependencyResponseRejectsProtocolUpgrade(t *testing.T) {
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("X-Sensitive", "secret")
			w.Header().Set("Set-Cookie", "session=leaked")
			w.WriteHeader(http.StatusSwitchingProtocols)
			_, _ = w.Write([]byte("leaked response"))
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadGateway)
	}
	if value := response.Header().Get("X-Sensitive"); value != "" {
		t.Fatalf("X-Sensitive = %q, want removed", value)
	}
	if values := response.Header().Values("Set-Cookie"); len(values) != 0 {
		t.Fatalf("Set-Cookie = %q, want removed", values)
	}
	if requestID := response.Header().Get("X-Request-ID"); requestID == "" {
		t.Fatal("X-Request-ID is empty")
	}
	if body := response.Body.String(); !strings.Contains(body, `"code":"upstream_protocol_not_supported"`) || !strings.Contains(body, `"title":"Bad Gateway"`) || strings.Contains(body, "secret") || strings.Contains(body, "leaked") {
		t.Fatalf("body = %q, want sanitized bad gateway problem", body)
	}
}

func TestBufferedDependencyResponseRejectsInvalidFinalStatus(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
	}{
		{name: "99", status: 99},
		{name: "1000", status: 1000},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := newTestServer(t, Dependencies{
				Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("X-Sensitive", "secret")
					w.Header().Set("Set-Cookie", "session=leaked")
					w.WriteHeader(test.status)
					_, _ = w.Write([]byte("leaked response"))
				}),
			})

			response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

			if response.Code != http.StatusBadGateway {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusBadGateway)
			}
			if value := response.Header().Get("X-Sensitive"); value != "" {
				t.Fatalf("X-Sensitive = %q, want removed", value)
			}
			if values := response.Header().Values("Set-Cookie"); len(values) != 0 {
				t.Fatalf("Set-Cookie = %q, want removed", values)
			}
			if requestID := response.Header().Get("X-Request-ID"); requestID == "" {
				t.Fatal("X-Request-ID is empty")
			}
			if body := response.Body.String(); !strings.Contains(body, `"code":"upstream_invalid_status"`) || !strings.Contains(body, `"title":"Bad Gateway"`) || strings.Contains(body, "secret") || strings.Contains(body, "leaked") {
				t.Fatalf("body = %q, want sanitized bad gateway problem", body)
			}
		})
	}
}

func TestBufferedResponseWriterDoesNotSupportStreaming(t *testing.T) {
	buffer := newBufferedResponseWriter(http.MethodGet)

	if _, ok := any(buffer).(http.Flusher); ok {
		t.Fatal("buffered response writer implements http.Flusher")
	}
	if err := http.NewResponseController(buffer).Flush(); !errors.Is(err, http.ErrNotSupported) {
		t.Fatalf("ResponseController.Flush() error = %v, want %v", err, http.ErrNotSupported)
	}
}

func TestPanicDiscardsDependencyResponse(t *testing.T) {
	server := newTestServer(t, Dependencies{
		Converter: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Add("X-Sensitive", "secret")
			w.WriteHeader(http.StatusTeapot)
			_, _ = w.Write([]byte("leak"))
			panic("do not expose this")
		}),
	})

	response := serveRequest(t, server, http.MethodGet, "api.example.test", "/sub", nil)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if got := response.Header().Get("X-Sensitive"); got != "" {
		t.Fatalf("X-Sensitive = %q, want removed", got)
	}
	if body := response.Body.String(); strings.Contains(body, "secret") || strings.Contains(body, "leak") || strings.Contains(body, "do not expose this") {
		t.Fatalf("response body leaked dependency output: %q", body)
	}
	if requestID := response.Header().Get("X-Request-ID"); requestID == "" {
		t.Fatal("X-Request-ID is empty")
	}
}

func headerEntriesEqualFold(header http.Header, name string) (keys []string, values []string) {
	for key, entries := range header {
		if strings.EqualFold(key, name) {
			keys = append(keys, key)
			values = append(values, entries...)
		}
	}
	return keys, values
}

func addSpoofedForwardingHeaders(request *http.Request) {
	for _, header := range []string{
		"Authorization",
		"Proxy-Authorization",
		"Cookie",
		"Origin",
		"Forwarded",
		"X-Forwarded-For",
		"X-Forwarded-Host",
		"X-Forwarded-Proto",
		"X-Forwarded-By",
		"X-Real-IP",
		"X-Request-ID",
	} {
		request.Header.Add(header, "spoofed-"+strings.ToLower(header))
	}
	request.Header["fOrWaRdEd"] = []string{"spoofed-forwarded-mixed-case"}
	request.Header["x-FoRwArDeD-Client-Cert"] = []string{"spoofed-client-cert"}
}
