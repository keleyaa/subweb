package myurls

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func mustURL(t *testing.T, value string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func newTestClient(t *testing.T, transport http.RoundTripper) *HTTPClient {
	t.Helper()
	baseURL, err := url.Parse("http://myurls.test:3000")
	if err != nil {
		t.Fatal(err)
	}
	return NewHTTPClient(baseURL, transport)
}

func response(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

func TestClientCreateUsesGeneratedRequestIDWhenInputIsUnsafe(t *testing.T) {
	client := newTestClient(t, roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("X-Request-ID") == "bad id" || request.Header.Get("X-Request-ID") == "" {
			t.Fatalf("X-Request-ID = %q, want generated safe ID", request.Header.Get("X-Request-ID"))
		}
		return response(http.StatusCreated, `{}`), nil
	}))

	upstream, err := client.Create(context.Background(), []byte(`{}`), http.Header{"X-Request-ID": []string{"bad id"}})
	if err != nil {
		t.Fatal(err)
	}
	upstream.Body.Close()
}

func TestClientCreateUsesRustAPIPathAndSafeHeaders(t *testing.T) {
	client := newTestClient(t, roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/links" {
			t.Fatalf("request = %s %s, want POST /api/links", request.Method, request.URL.Path)
		}
		if request.URL.RawQuery != "" {
			t.Fatalf("query = %q, want empty", request.URL.RawQuery)
		}
		if request.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("Content-Type = %q, want application/json", request.Header.Get("Content-Type"))
		}
		if request.Header.Get("Accept") != "application/json, application/problem+json" {
			t.Fatalf("Accept = %q", request.Header.Get("Accept"))
		}
		if request.Header.Get("X-Request-ID") != "req-create" {
			t.Fatalf("X-Request-ID = %q, want req-create", request.Header.Get("X-Request-ID"))
		}
		for _, name := range []string{"Authorization", "Proxy-Authorization", "Cookie", "Origin", "Forwarded"} {
			if got := request.Header.Get(name); got != "" {
				t.Fatalf("%s = %q, want empty", name, got)
			}
		}
		for name, want := range map[string]string{
			"X-Forwarded-For":   "198.51.100.10",
			"X-Forwarded-Host":  "app.example.test",
			"X-Forwarded-Proto": "https",
			"X-Real-IP":         "198.51.100.10",
		} {
			if got := request.Header.Get(name); got != want {
				t.Fatalf("%s = %q, want %q", name, got, want)
			}
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != `{"url":"https://example.test/sub"}` {
			t.Fatalf("body = %q", body)
		}
		return response(http.StatusCreated, `{}`), nil
	}))

	headers := make(http.Header)
	headers.Set("X-Request-ID", "req-create")
	headers.Set("Authorization", "secret")
	headers.Set("Proxy-Authorization", "secret")
	headers.Set("Cookie", "secret")
	headers.Set("Origin", "https://evil.test")
	headers.Set("Forwarded", "for=evil.test")
	headers.Set("X-Forwarded-For", "198.51.100.10")
	headers.Set("X-Forwarded-Host", "app.example.test")
	headers.Set("X-Forwarded-Proto", "https")
	headers.Set("X-Real-IP", "198.51.100.10")
	upstream, err := client.Create(context.Background(), []byte(`{"url":"https://example.test/sub"}`), headers)
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Body.Close()
}

func TestClientDoesNotFollowMyURLsRedirects(t *testing.T) {
	requests := 0
	client := newTestClient(t, roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if requests > 1 {
			t.Fatal("client followed a MyUrls redirect")
		}
		redirect := response(http.StatusFound, "")
		redirect.Header.Set("Location", "https://external.example.test/redirect")
		return redirect, nil
	}))

	upstream, err := client.Resolve(context.Background(), "Ab3dE9_x-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Body.Close()
	if upstream.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", upstream.StatusCode, http.StatusFound)
	}
}

func TestClientResolveValidatesCodeAndUsesExactPath(t *testing.T) {
	client := newTestClient(t, roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodGet || request.URL.Path != "/Ab3dE9_x-1" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.URL.RawQuery != "" {
			t.Fatalf("query = %q, want empty", request.URL.RawQuery)
		}
		if request.Header.Get("X-Request-ID") == "" {
			t.Fatal("missing generated request ID")
		}
		return response(http.StatusFound, ""), nil
	}))

	upstream, err := client.Resolve(context.Background(), "Ab3dE9_x-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Body.Close()

	for _, code := range []string{"", "../secret", "bad/code", strings.Repeat("a", 65)} {
		if _, err := client.Resolve(context.Background(), code, nil); err == nil {
			t.Fatalf("Resolve(%q) succeeded, want validation error", code)
		}
	}
}

func TestClientBoundsUpstreamRequests(t *testing.T) {
	client := NewHTTPClientWithTimeout(mustURL(t, "http://myurls.test:3000"), roundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	}), 20*time.Millisecond)

	started := time.Now()
	_, err := client.Resolve(context.Background(), "Ab3dE9_x-1", nil)
	if err != ErrUnavailable {
		t.Fatalf("error = %v, want ErrUnavailable", err)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("request took %s, want bounded timeout", elapsed)
	}
}

func TestClientRejectsNilContext(t *testing.T) {
	client := newTestClient(t, roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("nil context reached transport")
		return nil, nil
	}))

	if _, err := client.Resolve(nil, "Ab3dE9_x-1", nil); err != ErrUnavailable {
		t.Fatalf("error = %v, want ErrUnavailable", err)
	}
}

func TestClientHealthRejectsOversizedResponse(t *testing.T) {
	client := newTestClient(t, roundTripFunc(func(*http.Request) (*http.Response, error) {
		return response(http.StatusOK, strings.Repeat("x", defaultBodyLimit+1)), nil
	}))

	if err := client.Health(context.Background()); err != ErrUnavailable {
		t.Fatalf("health error = %v, want ErrUnavailable", err)
	}
}

func TestClientHealthUsesConfiguredBodyLimit(t *testing.T) {
	client := NewHTTPClientWithBodyLimit(mustURL(t, "http://myurls.test:3000"), roundTripFunc(func(*http.Request) (*http.Response, error) {
		return response(http.StatusOK, strings.Repeat("x", 33)), nil
	}), 32)

	if err := client.Health(context.Background()); err != ErrUnavailable {
		t.Fatalf("health error = %v, want %v", err, ErrUnavailable)
	}
}

func TestClientHealthUsesLiveEndpointAndClosesResponse(t *testing.T) {
	closed := false
	client := newTestClient(t, roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodGet || request.URL.Path != "/health/live" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusNoContent,
			Body:       closeTracker{Reader: strings.NewReader(""), closed: &closed},
			Header:     make(http.Header),
		}, nil
	}))

	if err := client.Health(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !closed {
		t.Fatal("health response body was not closed")
	}
}

type closeTracker struct {
	io.Reader
	closed *bool
}

func (tracker closeTracker) Close() error {
	*tracker.closed = true
	return nil
}
