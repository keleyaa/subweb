package myurls

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeClient struct {
	create  func(context.Context, []byte, http.Header) (*http.Response, error)
	resolve func(context.Context, string) (*http.Response, error)
	health  func(context.Context) error
}

func (client fakeClient) Create(ctx context.Context, body []byte, headers http.Header) (*http.Response, error) {
	return client.create(ctx, body, headers)
}

func (client fakeClient) Resolve(ctx context.Context, code string) (*http.Response, error) {
	return client.resolve(ctx, code)
}

func (client fakeClient) Health(ctx context.Context) error {
	return client.health(ctx)
}

func canonicalHeaders(headers http.Header) http.Header {
	result := make(http.Header)
	for key, values := range headers {
		for _, value := range values {
			result.Add(key, value)
		}
	}
	return result
}

func serveMyURLs(t *testing.T, handler http.Handler, method, target, body string, headers http.Header) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header = canonicalHeaders(headers)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestHandlerCreateEnforcesJSONEndpointAndLimits(t *testing.T) {
	called := 0
	handler := NewHandler(fakeClient{
		create: func(_ context.Context, body []byte, headers http.Header) (*http.Response, error) {
			called++
			if string(body) != `{"url":"https://example.test"}` {
				t.Fatalf("body = %q", body)
			}
			if headers.Get("Authorization") != "" || headers.Get("Cookie") != "" || headers.Get("Origin") != "" {
				t.Fatal("sensitive headers reached MyUrls client")
			}
			return response(http.StatusCreated, `{"code":"Ab3dE9xQ","shortUrl":"https://short.example.test/Ab3dE9xQ","expiresAt":"2099-01-01T00:00:00Z"}`), nil
		},
	}, 512)

	requestHeaders := make(http.Header)
	requestHeaders.Set("Content-Type", "application/json; charset=utf-8")
	requestHeaders.Set("Authorization", "secret")
	requestHeaders.Set("Cookie", "secret")
	requestHeaders.Set("Origin", "https://app.example.test")
	response := serveMyURLs(t, handler, http.MethodPost, "/short-api/links", `{"url":"https://example.test"}`, requestHeaders)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusCreated)
	}
	if response.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type = %q", response.Header().Get("Content-Type"))
	}
	if called != 1 {
		t.Fatalf("Create calls = %d, want 1", called)
	}

	for _, test := range []struct {
		name    string
		method  string
		target  string
		headers http.Header
		body    string
		status  int
	}{
		{name: "query", method: http.MethodPost, target: "/short-api/links?x=1", headers: requestHeaders, body: `{}`, status: http.StatusNotFound},
		{name: "wrong content type", method: http.MethodPost, target: "/short-api/links", headers: http.Header{"Content-Type": []string{"text/plain"}}, body: `{}`, status: http.StatusUnsupportedMediaType},
		{name: "wrong method", method: http.MethodGet, target: "/short-api/links", headers: requestHeaders, body: "", status: http.StatusMethodNotAllowed},
		{name: "oversized", method: http.MethodPost, target: "/short-api/links", headers: requestHeaders, body: strings.Repeat("x", 513), status: http.StatusRequestEntityTooLarge},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := serveMyURLs(t, handler, test.method, test.target, test.body, test.headers)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d; body=%q", response.Code, test.status, response.Body.String())
			}
		})
	}
	if called != 1 {
		t.Fatalf("Create calls after rejected requests = %d, want 1", called)
	}
}

func TestHandlerMapsRustProblemDetailsWithoutLeakingUpstreamData(t *testing.T) {
	handler := NewHandler(fakeClient{
		create: func(context.Context, []byte, http.Header) (*http.Response, error) {
			return response(http.StatusForbidden, `{"type":"https://internal/problems/challenge_required","title":"Challenge required","status":403,"code":"challenge_required","requestId":"upstream-id","retryAfterSeconds":12,"challenge":{"provider":"turnstile","siteKey":"public-site-key"},"detail":"redis password"}`), nil
		},
	}, 512)

	headers := make(http.Header)
	headers.Set("Content-Type", "application/json")
	headers.Set("X-Request-ID", "gateway-id")
	result := serveMyURLs(t, handler, http.MethodPost, "/short-api/links", `{}`, headers)
	if result.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", result.Code)
	}
	if result.Header().Get("X-Request-ID") != "gateway-id" {
		t.Fatalf("X-Request-ID = %q", result.Header().Get("X-Request-ID"))
	}
	if result.Header().Get("Retry-After") != "12" {
		t.Fatalf("Retry-After = %q", result.Header().Get("Retry-After"))
	}
	body := result.Body.String()
	if !strings.Contains(body, `"code":"challenge_required"`) || !strings.Contains(body, `"siteKey":"public-site-key"`) {
		t.Fatalf("body = %q", body)
	}
	if strings.Contains(body, "redis password") || strings.Contains(body, "internal/problems") || strings.Contains(body, "upstream-id") {
		t.Fatalf("upstream details leaked: %q", body)
	}
}

func TestHandlerResolvesOnlyShortCodesAndCopiesLocation(t *testing.T) {
	resolved := ""
	handler := NewHandler(fakeClient{
		resolve: func(_ context.Context, code string) (*http.Response, error) {
			resolved = code
			result := response(http.StatusFound, "")
			result.Header.Set("Location", "https://short.example.test/"+code)
			result.Header.Set("Set-Cookie", "secret")
			return result, nil
		},
	}, 512)

	headers := make(http.Header)
	headers.Set("X-Request-ID", "gateway-id")
	result := serveMyURLs(t, handler, http.MethodGet, "/Ab3dE9_x-1", "", headers)
	if result.Code != http.StatusFound || result.Header().Get("Location") != "https://short.example.test/Ab3dE9_x-1" {
		t.Fatalf("response = %d %q", result.Code, result.Header().Get("Location"))
	}
	if result.Header().Get("Set-Cookie") != "" {
		t.Fatal("Set-Cookie leaked")
	}
	if resolved != "Ab3dE9_x-1" {
		t.Fatalf("resolved code = %q", resolved)
	}

	for _, target := range []string{"/Ab3dE9_x-1?query=1", "/api/links", "/bad/code", "/"} {
		response := serveMyURLs(t, handler, http.MethodGet, target, "", nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, want 404", target, response.Code)
		}
	}
}

func TestHandlerAddsRequestIDToRejectedRoutes(t *testing.T) {
	handler := NewHandler(fakeClient{}, 512)
	for _, target := range []string{"/short-api/links?x=1", "/bad/code"} {
		t.Run(target, func(t *testing.T) {
			headers := make(http.Header)
			headers.Set("X-Request-ID", "gateway-id")
			result := serveMyURLs(t, handler, http.MethodGet, target, "", headers)
			if result.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", result.Code)
			}
			if result.Header().Get("X-Request-ID") != "gateway-id" {
				t.Fatalf("X-Request-ID = %q, want gateway-id", result.Header().Get("X-Request-ID"))
			}
			if result.Header().Get("Content-Type") != "application/problem+json" {
				t.Fatalf("Content-Type = %q, want problem+json", result.Header().Get("Content-Type"))
			}
		})
	}
}

func TestHandlerRejectsUnsafeRedirectLocations(t *testing.T) {
	for _, location := range []string{"javascript:alert(1)", "https://user:secret@example.test/path", "//example.test/path"} {
		t.Run(location, func(t *testing.T) {
			handler := NewHandler(fakeClient{
				resolve: func(context.Context, string) (*http.Response, error) {
					result := response(http.StatusFound, "")
					result.Header.Set("Location", location)
					return result, nil
				},
			}, 512)
			result := serveMyURLs(t, handler, http.MethodGet, "/Ab3dE9_x-1", "", nil)
			if result.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503", result.Code)
			}
			if result.Header().Get("Location") != "" {
				t.Fatal("unsafe Location was forwarded")
			}
		})
	}
}

func TestHandlerMapsUnavailableAndClosesResponses(t *testing.T) {
	closed := false
	handler := NewHandler(fakeClient{
		create: func(context.Context, []byte, http.Header) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusCreated, Body: trackingBody{Reader: strings.NewReader(`not-json`), closed: &closed}, Header: make(http.Header)}, nil
		},
	}, 512)

	headers := make(http.Header)
	headers.Set("Content-Type", "application/json")
	result := serveMyURLs(t, handler, http.MethodPost, "/short-api/links", `{}`, headers)
	if result.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", result.Code)
	}
	if !closed {
		t.Fatal("response body was not closed")
	}
}

type trackingBody struct {
	io.Reader
	closed *bool
}

func (body trackingBody) Close() error {
	*body.closed = true
	return nil
}
