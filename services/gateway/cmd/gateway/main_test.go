package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
	"github.com/keleyaa/subweb/services/gateway/internal/myurls"
	"github.com/keleyaa/subweb/services/gateway/internal/ratelimit"
)

func TestBuildServersRoutesAppAndShortLinksToOneUpstream(t *testing.T) {
	var appHeaders, shortHeaders http.Header
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/api/links":
			appHeaders = request.Header.Clone()
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_, _ = writer.Write([]byte(`{"code":"Ab3dE9_x","shortUrl":"https://short.example.test/Ab3dE9_x"}`))
		case request.Method == http.MethodGet && request.URL.Path == "/Ab3dE9_x":
			shortHeaders = request.Header.Clone()
			writer.Header().Set("Location", "https://destination.example.test/subscription")
			writer.WriteHeader(http.StatusFound)
		default:
			t.Errorf("unexpected upstream request = %s %s", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()

	cfg := testGatewayConfig(t, upstream.URL, true)
	server, egressServer, closeResources, err := buildServers(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closeResources()
	defer egressServer.Close()

	appRequest := httptest.NewRequest(http.MethodPost, "http://"+cfg.AppDomain+"/short-api/links", strings.NewReader(`{"url":"https://source.example.test/sub"}`))
	appRequest.Host = cfg.AppDomain
	appRequest.RemoteAddr = "198.51.100.10:1234"
	appRequest.Header.Set("Content-Type", "application/json")
	appRequest.Header.Set("Authorization", "secret")
	appRequest.Header.Set("Cookie", "session=secret")
	appRequest.Header.Set("Origin", "https://evil.example.test")
	appRequest.Header.Set("X-Forwarded-For", "203.0.113.9")
	appResponse := httptest.NewRecorder()
	server.Handler.ServeHTTP(appResponse, appRequest)
	if appResponse.Code != http.StatusCreated {
		t.Fatalf("app status = %d, want %d; body=%q", appResponse.Code, http.StatusCreated, appResponse.Body.String())
	}

	shortRequest := httptest.NewRequest(http.MethodGet, "http://"+cfg.ShortDomain+"/Ab3dE9_x", nil)
	shortRequest.Host = cfg.ShortDomain
	shortRequest.RemoteAddr = "198.51.100.10:1234"
	shortResponse := httptest.NewRecorder()
	server.Handler.ServeHTTP(shortResponse, shortRequest)
	if shortResponse.Code != http.StatusFound {
		t.Fatalf("short status = %d, want %d; body=%q", shortResponse.Code, http.StatusFound, shortResponse.Body.String())
	}

	for name, headers := range map[string]http.Header{"app": appHeaders, "short": shortHeaders} {
		for header, want := range map[string]string{
			"X-Forwarded-For":   "198.51.100.10",
			"X-Forwarded-Proto": "https",
			"X-Real-IP":         "198.51.100.10",
		} {
			if got := headers.Get(header); got != want {
				t.Fatalf("%s %s = %q, want %q", name, header, got, want)
			}
		}
	}
	if got := appHeaders.Get("X-Forwarded-Host"); got != cfg.AppDomain {
		t.Fatalf("app X-Forwarded-Host = %q, want %q", got, cfg.AppDomain)
	}
	if got := shortHeaders.Get("X-Forwarded-Host"); got != cfg.ShortDomain {
		t.Fatalf("short X-Forwarded-Host = %q, want %q", got, cfg.ShortDomain)
	}
	for _, testCase := range []struct {
		host, method, path string
		status             int
	}{
		{cfg.ShortDomain, http.MethodPost, "/short-api/links", http.StatusNotFound},
		{cfg.ShortDomain, http.MethodPost, "/api/links", http.StatusNotFound},
		{cfg.AppDomain, http.MethodPost, "/api/links", http.StatusMethodNotAllowed},
		{cfg.APIDomain, http.MethodPost, "/short-api/links", http.StatusNotFound},
		{"unknown.example.test", http.MethodPost, "/short-api/links", http.StatusMisdirectedRequest},
		{cfg.ShortDomain, http.MethodPost, "/Ab3dE9_x", http.StatusMethodNotAllowed},
	} {
		request := httptest.NewRequest(testCase.method, "https://"+testCase.host+testCase.path, strings.NewReader(`{}`))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)
		if response.Code != testCase.status {
			t.Fatalf("%s %s %s status = %d, want %d", testCase.host, testCase.method, testCase.path, response.Code, testCase.status)
		}
	}
	for _, name := range []string{"Authorization", "Cookie", "Origin"} {
		if got := appHeaders.Get(name); got != "" {
			t.Fatalf("app %s = %q, want empty", name, got)
		}
	}
}

func TestReadinessRequiresOneMyURLsInstanceWhenShortLinksAreEnabled(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusServiceUnavailable} {
		upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.URL.Path != "/health/live" {
				t.Errorf("health path = %q", request.URL.Path)
			}
			writer.WriteHeader(status)
		}))
		cfg := testGatewayConfig(t, upstream.URL, true)
		readiness := readinessFunc(cfg, pingableCounterStore{CounterStore: ratelimit.NewMemoryStore()}, myurls.NewHTTPClient(mustParseURL(t, upstream.URL), nil))
		err := readiness(context.Background())
		upstream.Close()
		if (err == nil) != (status == http.StatusOK) {
			t.Fatalf("status %d readiness error = %v", status, err)
		}
	}
}

func TestEgressHealthcheckRequiresListeningPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	if err := checkEgressListener(listener.Addr().String()); err != nil {
		t.Fatalf("checkEgressListener() error = %v, want nil", err)
	}

	listener.Close()
	if err := checkEgressListener(listener.Addr().String()); err == nil {
		t.Fatal("checkEgressListener() error = nil, want unavailable listener error")
	}
}

func TestEgressHealthAddressUsesLoopbackAndConfiguredPort(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "default", want: "127.0.0.1:25502"},
		{name: "configured", input: "0.0.0.0:3128", want: "127.0.0.1:3128"},
		{name: "invalid", input: "not-an-address", wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := egressHealthAddress(testCase.input)
			if testCase.wantErr {
				if err == nil {
					t.Fatal("egressHealthAddress() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("egressHealthAddress() error = %v, want nil", err)
			}
			if got != testCase.want {
				t.Fatalf("egressHealthAddress() = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestReadinessRejectsNilContextWhenShortLinksAreEnabled(t *testing.T) {
	cfg := testGatewayConfig(t, "", true)
	if err := readinessFunc(cfg, pingableCounterStore{CounterStore: ratelimit.NewMemoryStore()}, testReadinessClient{})(nil); err == nil {
		t.Fatal("readiness error = nil, want unavailable error")
	}
}

func TestReadinessFailsClosedWhenMyURLsDependenciesAreMissing(t *testing.T) {
	cfg := testGatewayConfig(t, "", true)
	readiness := readinessFunc(cfg, pingableCounterStore{CounterStore: ratelimit.NewMemoryStore()})
	if err := readiness(context.Background()); err == nil {
		t.Fatal("readiness error = nil, want unavailable error")
	}
}

func TestReadinessFailsClosedWhenRedisPingIsUnavailable(t *testing.T) {
	cfg := testGatewayConfig(t, "", true)
	readiness := readinessFunc(
		cfg,
		ratelimit.NewMemoryStore(),
		testReadinessClient{},
	)
	if err := readiness(context.Background()); err == nil {
		t.Fatal("readiness error = nil, want unavailable error")
	}
}

func TestReadinessReturnsRedisFailure(t *testing.T) {
	cfg := testGatewayConfig(t, "", true)
	wantErr := errors.New("redis unavailable")
	readiness := readinessFunc(
		cfg,
		pingableCounterStore{CounterStore: ratelimit.NewMemoryStore(), pingErr: wantErr},
		testReadinessClient{},
	)
	if err := readiness(context.Background()); !errors.Is(err, wantErr) {
		t.Fatalf("readiness error = %v, want %v", err, wantErr)
	}
}

type pingableCounterStore struct {
	ratelimit.CounterStore
	pingErr error
}

func (store pingableCounterStore) Ping(context.Context) error {
	return store.pingErr
}

type testReadinessClient struct{}

func (testReadinessClient) Create(context.Context, []byte, http.Header) (*http.Response, error) {
	return nil, nil
}

func (testReadinessClient) Resolve(context.Context, string, http.Header) (*http.Response, error) {
	return nil, nil
}

func (testReadinessClient) Health(context.Context) error {
	return nil
}

func TestGatewayURLPolicyPreservesTotalDeadline(t *testing.T) {
	resolver := resolverFunc(func(ctx context.Context, _, _ string) ([]netip.Addr, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	requestContext, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	_, err := (gatewayURLPolicy{resolver: resolver, timeout: time.Second}).AuthorizeURL(requestContext, "https://example.test/sub")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("AuthorizeURL error = %v, want context deadline exceeded", err)
	}
}

type resolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (resolver resolverFunc) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return resolver(ctx, network, host)
}

func TestBuildServersDisablesShortLinkDependencies(t *testing.T) {
	cfg := testGatewayConfig(t, "", false)
	cfg.RedisURL = "not a Redis URL"
	cfg.RedisPassword = ""
	cfg.IPHashSecret = nil
	cfg.MyURLsUpstream = nil

	server, egressServer, closeResources, err := buildServers(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closeResources()
	defer egressServer.Close()

	request := httptest.NewRequest(http.MethodPost, "http://"+cfg.AppDomain+"/short-api/links", strings.NewReader(`{}`))
	request.Host = cfg.AppDomain
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func mustParseURL(t *testing.T, value string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func testGatewayConfig(t *testing.T, upstream string, shortLinksEnabled bool) config.Config {
	t.Helper()
	parseURL := func(value string) *url.URL {
		if value == "" {
			return nil
		}
		return mustParseURL(t, value)
	}
	return config.Config{
		ListenAddr:                 "127.0.0.1:0",
		EgressListenAddr:           "127.0.0.1:0",
		AppDomain:                  "app.example.test",
		APIDomain:                  "api.example.test",
		ShortDomain:                "short.example.test",
		APIURL:                     parseURL("https://api.example.test"),
		ShortLinksEnabled:          shortLinksEnabled,
		CustomBackendEnabled:       true,
		RedisURL:                   "redis://127.0.0.1:6379/1",
		RedisPassword:              "test-password",
		IPHashSecret:               []byte("0123456789abcdef0123456789abcdef"),
		TurnstileSiteKey:           "site-key",
		SubConverterUpstream:       parseURL("http://subconverter:25500"),
		MyURLsUpstream:             parseURL(upstream),
		ConversionRateLimit:        10,
		ConversionRateWindow:       time.Minute,
		ConversionMaxRequestBytes:  16 * 1024,
		ConversionMaxResponseBytes: 8 * 1024 * 1024,
		ConversionRequestTimeout:   10 * time.Second,
		ConversionDNSTimeout:       2 * time.Second,
		EgressConnectTimeout:       5 * time.Second,
		ConversionMaxConcurrency:   2,
	}
}

func TestReadinessAcceptsOneHealthyMyURLsInstance(t *testing.T) {
	cfg := testGatewayConfig(t, "", true)
	readiness := readinessFunc(cfg, pingableCounterStore{CounterStore: ratelimit.NewMemoryStore()}, testReadinessClient{})
	if err := readiness(context.Background()); err != nil {
		t.Fatalf("single-instance readiness error = %v", err)
	}
}
