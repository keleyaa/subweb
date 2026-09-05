package conversion

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
	"github.com/keleyaa/subweb/services/gateway/internal/httpapi"
	"github.com/keleyaa/subweb/services/gateway/internal/policy"
	"github.com/keleyaa/subweb/services/gateway/internal/privacy"
	"github.com/keleyaa/subweb/services/gateway/internal/ratelimit"
)

type urlPolicyFunc func(context.Context, string) (policy.DialTarget, error)

func (fn urlPolicyFunc) AuthorizeURL(ctx context.Context, value string) (policy.DialTarget, error) {
	return fn(ctx, value)
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestServiceForwardsValidatedConversionQueryOnly(t *testing.T) {
	var upstreamQuery url.Values
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		upstreamQuery = request.URL.Query()
		response.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(response, "converted")
	}))
	defer upstream.Close()

	service := newTestService(t, upstream.URL, urlPolicyFunc(func(_ context.Context, value string) (policy.DialTarget, error) {
		if value != "https://public.example/feed" {
			t.Fatalf("policy value = %q", value)
		}
		return publicTarget(), nil
	}))

	request := httptest.NewRequest(http.MethodGet,
		"/sub?target=clash&url=https%3A%2F%2Fpublic.example%2Ffeed&include=proxy&evil=discarded",
		nil)
	response := httptest.NewRecorder()

	service.ServeHTTP(response, request)

	if response.Code != http.StatusOK || response.Body.String() != "converted" {
		t.Fatalf("response = (%d, %q), want (200, converted)", response.Code, response.Body.String())
	}
	if got := upstreamQuery.Get("target"); got != "clash" {
		t.Fatalf("upstream target = %q", got)
	}
	if got := upstreamQuery.Get("url"); got != "https://public.example/feed" {
		t.Fatalf("upstream url = %q", got)
	}
	if got := upstreamQuery.Get("include"); got != "proxy" {
		t.Fatalf("upstream include = %q", got)
	}
	if upstreamQuery.Get("evil") != "" {
		t.Fatalf("unknown query parameter was forwarded: %v", upstreamQuery)
	}
}

func TestServiceReportsConfiguredRateLimitRetryWindow(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(response, "converted")
	}))
	defer upstream.Close()

	service := newTestService(t, upstream.URL, acceptingPolicy())
	limiter, err := ratelimit.NewRateLimiter(ratelimit.NewMemoryStore(), 1, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	service.RateLimiter = limiter

	if response := serveConversionRequest(service, "https://public.example/feed"); response.Code != http.StatusOK {
		t.Fatalf("first response status = %d, want 200", response.Code)
	}
	limited := serveConversionRequest(service, "https://public.example/feed")

	assertProblem(t, limited, http.StatusTooManyRequests, "rate_limited")
	if got := limited.Header().Get("Retry-After"); got != "300" {
		t.Fatalf("Retry-After = %q, want 300", got)
	}
	if !strings.Contains(limited.Body.String(), `"retryAfterSeconds":300`) {
		t.Fatalf("body = %q, want retryAfterSeconds 300", limited.Body.String())
	}
}

func TestServiceRateLimitsByTrustedProxyClientIP(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(response, "converted")
	}))
	defer upstream.Close()

	service := newTestService(t, upstream.URL, acceptingPolicy())
	limiter, err := ratelimit.NewRateLimiter(ratelimit.NewMemoryStore(), 1, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	service.RateLimiter = limiter
	_, trustedProxyCIDR, err := net.ParseCIDR("127.0.0.1/32")
	if err != nil {
		t.Fatal(err)
	}
	server := httpapi.NewServer(config.Config{
		AppDomain:        "app.example.test",
		APIDomain:        "api.example.test",
		ShortDomain:      "short.example.test",
		TrustedProxyCIDR: trustedProxyCIDR,
	}, httpapi.Dependencies{Converter: service})

	for _, test := range []struct {
		name     string
		clientIP string
		wantCode int
	}{
		{name: "first client", clientIP: "198.51.100.1", wantCode: http.StatusOK},
		{name: "second client", clientIP: "198.51.100.2", wantCode: http.StatusOK},
		{name: "same client is limited", clientIP: "198.51.100.1", wantCode: http.StatusTooManyRequests},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://gateway.test/sub?target=clash&url=ss%3A%2F%2Fexample", nil)
			request.Host = "api.example.test"
			request.RemoteAddr = "127.0.0.1:3456"
			request.Header.Set("X-Forwarded-For", test.clientIP)
			response := httptest.NewRecorder()

			server.Handler.ServeHTTP(response, request)

			if response.Code != test.wantCode {
				t.Fatalf("status = %d, want %d", response.Code, test.wantCode)
			}
		})
	}
}

func TestServiceMountsThroughAPIHostRoute(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(response, "converted")
	}))
	defer upstream.Close()

	service := newTestService(t, upstream.URL, acceptingPolicy())
	server := httpapi.NewServer(config.Config{
		AppDomain:   "app.example.test",
		APIDomain:   "api.example.test",
		ShortDomain: "short.example.test",
	}, httpapi.Dependencies{Converter: service})
	request := httptest.NewRequest(http.MethodGet, "http://gateway.test/sub?target=clash&url=https%3A%2F%2Fpublic.example%2Ffeed", nil)
	request.Host = "api.example.test"
	request.RemoteAddr = "198.51.100.9:1234"
	response := httptest.NewRecorder()

	server.Handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || response.Body.String() != "converted" {
		t.Fatalf("response = (%d, %q), want (200, converted)", response.Code, response.Body.String())
	}
}

func TestServiceRejectsPrivateURLBeforeUpstream(t *testing.T) {
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		upstreamCalls.Add(1)
	}))
	defer upstream.Close()

	service := newTestService(t, upstream.URL, urlPolicyFunc(func(_ context.Context, _ string) (policy.DialTarget, error) {
		return policy.DialTarget{}, policy.PolicyError{Code: "private_address", Status: http.StatusForbidden}
	}))
	response := serveConversionRequest(service, "https://private.example/feed")

	assertProblem(t, response, http.StatusForbidden, "private_address")
	if upstreamCalls.Load() != 0 {
		t.Fatal("upstream was called after policy rejection")
	}
}

func TestServiceMapsDNSTimeout(t *testing.T) {
	service := newTestService(t, "http://127.0.0.1:1", urlPolicyFunc(func(_ context.Context, _ string) (policy.DialTarget, error) {
		return policy.DialTarget{}, policy.PolicyError{Code: "dns_timeout", Status: http.StatusForbidden}
	}))

	response := serveConversionRequest(service, "https://slow.example/feed")

	assertProblem(t, response, http.StatusForbidden, "dns_timeout")
}

func TestServiceMapsUpstreamServerError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusBadGateway)
	}))
	defer upstream.Close()

	service := newTestService(t, upstream.URL, acceptingPolicy())
	response := serveConversionRequest(service, "https://public.example/feed")

	assertProblem(t, response, http.StatusBadGateway, "upstream_error")
}

func TestServiceDoesNotFollowUpstreamRedirects(t *testing.T) {
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		upstreamCalls.Add(1)
		if request.URL.Path == "/sub" {
			response.Header().Set("Location", "/next")
			response.WriteHeader(http.StatusFound)
			return
		}
		response.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(response, "must not follow")
	}))
	defer upstream.Close()

	service := newTestService(t, upstream.URL, acceptingPolicy())
	response := serveConversionRequest(service, "https://public.example/feed")

	assertProblem(t, response, http.StatusBadRequest, "upstream_error")
	if got := upstreamCalls.Load(); got != 1 {
		t.Fatalf("upstream calls = %d, want one request without redirect follow-up", got)
	}
}

func TestServiceClosesSuccessfulUpstreamBody(t *testing.T) {
	bodyClosed := make(chan struct{})
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/plain"}},
			Body:       &trackingBody{Reader: strings.NewReader("converted"), closed: bodyClosed},
			Request:    request,
		}, nil
	})
	service := newTestService(t, "http://converter.invalid", acceptingPolicy())
	service.Transport = transport

	response := serveConversionRequest(service, "https://public.example/feed")
	if response.Code != http.StatusOK || response.Body.String() != "converted" {
		t.Fatalf("response = (%d, %q), want (200, converted)", response.Code, response.Body.String())
	}
	select {
	case <-bodyClosed:
	case <-time.After(time.Second):
		t.Fatal("successful upstream body was not closed")
	}
}

func TestServiceStopsOversizedUpstreamResponse(t *testing.T) {
	readStarted := make(chan struct{})
	bodyClosed := make(chan struct{})
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body := &trackingBody{Reader: strings.NewReader("123456789"), closed: bodyClosed}
		close(readStarted)
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/plain"}},
			Body:       body,
			Request:    request,
		}, nil
	})
	service := newTestService(t, "http://converter.invalid", acceptingPolicy())
	service.Transport = transport
	service.MaxResponse = 8

	response := serveConversionRequest(service, "https://public.example/feed")

	<-readStarted
	assertProblem(t, response, http.StatusRequestEntityTooLarge, "response_too_large")
	select {
	case <-bodyClosed:
	case <-time.After(time.Second):
		t.Fatal("oversized upstream body was not closed")
	}
}

func TestServiceLimitsConversionConcurrency(t *testing.T) {
	upstreamStarted := make(chan struct{}, 2)
	releaseUpstream := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		upstreamStarted <- struct{}{}
		<-releaseUpstream
		response.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(response, "ok")
	}))
	defer upstream.Close()

	var policyCalls atomic.Int32
	service := newTestService(t, upstream.URL, urlPolicyFunc(func(_ context.Context, _ string) (policy.DialTarget, error) {
		policyCalls.Add(1)
		return publicTarget(), nil
	}))
	var waitGroup sync.WaitGroup
	for range 2 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			response := serveConversionRequest(service, "https://public.example/feed")
			if response.Code != http.StatusOK {
				t.Errorf("concurrent response status = %d, want 200", response.Code)
			}
		}()
	}
	for range 2 {
		select {
		case <-upstreamStarted:
		case <-time.After(time.Second):
			t.Fatal("conversion did not reach upstream")
		}
	}

	limited := serveConversionRequest(service, "https://public.example/feed")
	assertProblem(t, limited, http.StatusTooManyRequests, "concurrency_limited")
	if got := policyCalls.Load(); got != 2 {
		t.Fatalf("policy calls = %d, want 2 while conversion slots are full", got)
	}
	close(releaseUpstream)
	waitGroup.Wait()
}

func TestServicePropagatesClientCancellationToUpstream(t *testing.T) {
	upstreamStarted := make(chan struct{})
	upstreamCanceled := make(chan struct{})
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		close(upstreamStarted)
		<-request.Context().Done()
		close(upstreamCanceled)
		return nil, request.Context().Err()
	})
	service := newTestService(t, "http://converter.invalid", acceptingPolicy())
	service.Transport = transport

	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, "/sub?target=clash&url=https%3A%2F%2Fpublic.example%2Ffeed", nil).WithContext(ctx)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		service.ServeHTTP(response, request)
		close(done)
	}()
	<-upstreamStarted
	cancel()

	select {
	case <-upstreamCanceled:
	case <-time.After(time.Second):
		t.Fatal("upstream did not receive cancellation")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("conversion handler did not return after cancellation")
	}
}

func TestServiceMapsItsOwnDeadlineToGatewayTimeout(t *testing.T) {
	upstreamStarted := make(chan struct{})
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		close(upstreamStarted)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	service := newTestService(t, "http://converter.invalid", acceptingPolicy())
	service.Transport = transport
	service.Timeout = 20 * time.Millisecond

	response := serveConversionRequest(service, "https://public.example/feed")
	<-upstreamStarted
	assertProblem(t, response, http.StatusGatewayTimeout, "upstream_timeout")
}

func TestServiceAcceptsOnlyGET(t *testing.T) {
	service := newTestService(t, "http://127.0.0.1:1", acceptingPolicy())
	request := httptest.NewRequest(http.MethodPost, "/sub", nil)
	response := httptest.NewRecorder()

	service.ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", response.Code)
	}
	if response.Header().Get("Allow") != http.MethodGet {
		t.Fatalf("Allow = %q, want GET", response.Header().Get("Allow"))
	}
}

func TestServiceRemovesSensitiveRequestHeaders(t *testing.T) {
	var received http.Header
	transport := roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		received = request.Header.Clone()
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/plain"}},
			Body:       io.NopCloser(strings.NewReader("ok")),
			Request:    request,
		}, nil
	})
	service := newTestService(t, "http://converter.invalid", acceptingPolicy())
	service.Transport = transport
	request := httptest.NewRequest(http.MethodGet, "/sub?target=clash&url=https%3A%2F%2Fpublic.example%2Ffeed", nil)
	for _, name := range []string{"Authorization", "Proxy-Authorization", "Cookie", "Origin", "Forwarded", "X-Forwarded-For", "X-Real-IP"} {
		request.Header.Set(name, "spoofed")
	}
	response := httptest.NewRecorder()

	service.ServeHTTP(response, request)

	for _, name := range []string{"Authorization", "Proxy-Authorization", "Cookie", "Origin", "Forwarded", "X-Forwarded-For", "X-Real-IP"} {
		if received.Get(name) != "" {
			t.Fatalf("upstream received %s", name)
		}
	}
}

func acceptingPolicy() urlPolicyFunc {
	return func(_ context.Context, _ string) (policy.DialTarget, error) {
		return publicTarget(), nil
	}
}

func publicTarget() policy.DialTarget {
	return policy.DialTarget{
		URL:       &url.URL{Scheme: "https", Host: "public.example"},
		Addresses: []netip.Addr{netip.MustParseAddr("93.184.216.34")},
	}
}

func newTestService(t *testing.T, upstream string, urlPolicy URLPolicy) *Service {
	t.Helper()
	parsed, err := url.Parse(upstream)
	if err != nil {
		t.Fatal(err)
	}
	store := ratelimit.NewMemoryStore()
	limiter, err := ratelimit.NewRateLimiter(store, 100, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	hasher, err := privacy.NewIPHasher([]byte("01234567890123456789012345678901"))
	if err != nil {
		t.Fatal(err)
	}
	semaphore, err := policy.NewSemaphore(2)
	if err != nil {
		t.Fatal(err)
	}
	return &Service{
		Policy:      urlPolicy,
		RateLimiter: limiter,
		IPHasher:    hasher,
		Semaphore:   semaphore,
		Upstream:    parsed,
		MaxRequest:  16 * 1024,
		MaxResponse: 8 * 1024 * 1024,
		Timeout:     2 * time.Second,
	}
}

func serveConversionRequest(service *Service, subscriptionURL string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet,
		"/sub?target=clash&url="+url.QueryEscape(subscriptionURL), nil)
	request.RemoteAddr = "198.51.100.9:1234"
	response := httptest.NewRecorder()
	service.ServeHTTP(response, request)
	return response
}

func assertProblem(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"code":"`+code+`"`) {
		t.Fatalf("body = %q, want code %q", response.Body.String(), code)
	}
}

type trackingBody struct {
	io.Reader
	closed chan struct{}
}

func (body *trackingBody) Close() error {
	select {
	case <-body.closed:
	default:
		close(body.closed)
	}
	return nil
}
