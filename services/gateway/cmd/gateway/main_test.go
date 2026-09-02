package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
)

func TestBuildServersRoutesAppAndShortLinksToSeparateUpstreams(t *testing.T) {
	var appHeaders, shortHeaders http.Header
	app := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/links" {
			t.Fatalf("app request = %s %s", request.Method, request.URL.Path)
		}
		appHeaders = request.Header.Clone()
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusCreated)
		_, _ = writer.Write([]byte(`{"code":"Ab3dE9_x"}`))
	}))
	defer app.Close()

	short := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/Ab3dE9_x" {
			t.Fatalf("short request = %s %s", request.Method, request.URL.Path)
		}
		shortHeaders = request.Header.Clone()
		writer.Header().Set("Location", "https://destination.example.test/subscription")
		writer.WriteHeader(http.StatusFound)
	}))
	defer short.Close()

	cfg := testGatewayConfig(t, app.URL, short.URL, true)
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
	for _, name := range []string{"Authorization", "Cookie", "Origin"} {
		if got := appHeaders.Get(name); got != "" {
			t.Fatalf("app %s = %q, want empty", name, got)
		}
	}
}

func TestBuildServersDisablesShortLinkDependencies(t *testing.T) {
	cfg := testGatewayConfig(t, "", "", false)
	cfg.RedisURL = "not a Redis URL"
	cfg.RedisPassword = ""
	cfg.IPHashSecret = nil
	cfg.MyURLsAppUpstream = nil
	cfg.MyURLsShortUpstream = nil

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

func testGatewayConfig(t *testing.T, appUpstream, shortUpstream string, shortLinksEnabled bool) config.Config {
	t.Helper()
	parseURL := func(value string) *url.URL {
		if value == "" {
			return nil
		}
		parsed, err := url.Parse(value)
		if err != nil {
			t.Fatal(err)
		}
		return parsed
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
		MyURLsAppUpstream:          parseURL(appUpstream),
		MyURLsShortUpstream:        parseURL(shortUpstream),
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
