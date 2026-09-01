package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
)

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
		{name: "api other path", method: http.MethodGet, host: "api.example.test", path: "/other", wantCode: http.StatusMisdirectedRequest},
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
