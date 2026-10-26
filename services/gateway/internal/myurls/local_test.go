package myurls

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/linkstore"
	"github.com/keleyaa/subweb/services/gateway/internal/privacy"
	"github.com/keleyaa/subweb/services/gateway/internal/ratelimit"
)

type fakeChallenge struct {
	err   error
	token string
}

func (challenge *fakeChallenge) Verify(_ context.Context, token, _ string) error {
	challenge.token = token
	return challenge.err
}

func newTestLocalClient(t *testing.T, mutate func(*LocalOptions)) *LocalClient {
	t.Helper()
	hasher, err := privacy.NewIPHasher([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("NewIPHasher() error = %v", err)
	}
	base, err := url.Parse("https://short.example")
	if err != nil {
		t.Fatalf("url.Parse() error = %v", err)
	}
	options := LocalOptions{
		Store:         linkstore.NewMemoryStore(),
		PublicBase:    base,
		TTL:           24 * time.Hour,
		Limiter:       ratelimit.NewMemoryStore(),
		IPHasher:      hasher,
		SiteKey:       "site-key",
		CreateLimit:   100,
		CreateWindow:  10 * time.Minute,
		DailyLimit:    1000,
		DailyWindow:   24 * time.Hour,
		ResolveLimit:  100,
		ResolveWindow: 10 * time.Second,
	}
	if mutate != nil {
		mutate(&options)
	}
	client, err := NewLocalClient(options)
	if err != nil {
		t.Fatalf("NewLocalClient() error = %v", err)
	}
	return client
}

func testHeaders() http.Header {
	headers := http.Header{}
	headers.Set(clientIPHeader, "203.0.113.10")
	headers.Set("X-Request-ID", "request-1")
	return headers
}

func decodeBody(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body error = %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode body %q error = %v", string(body), err)
	}
	return payload
}

func TestLocalClientCreatesLink(t *testing.T) {
	client := newTestLocalClient(t, nil)

	response, err := client.Create(context.Background(), []byte(`{"url":"https://example.com/page"}`), testHeaders())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("Create() status = %d, want 201", response.StatusCode)
	}
	payload := decodeBody(t, response)
	code, _ := payload["code"].(string)
	if len(code) == 0 {
		t.Fatalf("Create() code missing in %v", payload)
	}
	if payload["shortUrl"] != "https://short.example/"+code {
		t.Fatalf("Create() shortUrl = %v", payload["shortUrl"])
	}
	if _, ok := payload["expiresAt"].(string); !ok {
		t.Fatalf("Create() expiresAt missing in %v", payload)
	}
}

func TestLocalClientRejectsUnknownField(t *testing.T) {
	client := newTestLocalClient(t, nil)

	response, err := client.Create(context.Background(), []byte(`{"url":"https://example.com","extra":true}`), testHeaders())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("Create() status = %d, want 400", response.StatusCode)
	}
	if payload := decodeBody(t, response); payload["code"] != "invalid_request" {
		t.Fatalf("Create() code = %v", payload["code"])
	}
}

func TestLocalClientRejectsDuplicateAlias(t *testing.T) {
	client := newTestLocalClient(t, nil)

	first, err := client.Create(context.Background(), []byte(`{"url":"https://example.com/one","alias":"alias1"}`), testHeaders())
	if err != nil || first.StatusCode != http.StatusCreated {
		t.Fatalf("first Create() = %v, %v", first.StatusCode, err)
	}
	second, err := client.Create(context.Background(), []byte(`{"url":"https://example.com/two","alias":"alias1"}`), testHeaders())
	if err != nil {
		t.Fatalf("second Create() error = %v", err)
	}
	if second.StatusCode != http.StatusConflict {
		t.Fatalf("second Create() status = %d, want 409", second.StatusCode)
	}
	if payload := decodeBody(t, second); payload["code"] != "alias_unavailable" {
		t.Fatalf("second Create() code = %v", payload["code"])
	}
}

func TestLocalClientRequiresChallengeWhenConfigured(t *testing.T) {
	challenge := &fakeChallenge{}
	client := newTestLocalClient(t, func(options *LocalOptions) { options.Challenge = challenge })

	response, err := client.Create(context.Background(), []byte(`{"url":"https://example.com"}`), testHeaders())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("Create() status = %d, want 403", response.StatusCode)
	}
	payload := decodeBody(t, response)
	if payload["code"] != "challenge_required" {
		t.Fatalf("Create() code = %v", payload["code"])
	}
	if payload["challenge"] == nil {
		t.Fatalf("Create() challenge payload missing")
	}
}

func TestLocalClientRejectsInvalidChallenge(t *testing.T) {
	challenge := &fakeChallenge{err: errors.New("rejected")}
	client := newTestLocalClient(t, func(options *LocalOptions) { options.Challenge = challenge })

	response, err := client.Create(context.Background(), []byte(`{"url":"https://example.com","challengeToken":"token"}`), testHeaders())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("Create() status = %d, want 403", response.StatusCode)
	}
	if payload := decodeBody(t, response); payload["code"] != "challenge_invalid" {
		t.Fatalf("Create() code = %v", payload["code"])
	}
	if challenge.token != "token" {
		t.Fatalf("verifier token = %q", challenge.token)
	}
}

func TestLocalClientRejectsDisallowedURL(t *testing.T) {
	client := newTestLocalClient(t, func(options *LocalOptions) {
		options.ValidateURL = func(context.Context, string) error { return errors.New("blocked") }
	})

	response, err := client.Create(context.Background(), []byte(`{"url":"http://127.0.0.1/"}`), testHeaders())
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("Create() status = %d, want 422", response.StatusCode)
	}
	if payload := decodeBody(t, response); payload["code"] != "url_not_allowed" {
		t.Fatalf("Create() code = %v", payload["code"])
	}
}

func TestLocalClientResolvesLink(t *testing.T) {
	client := newTestLocalClient(t, nil)

	created, err := client.Create(context.Background(), []byte(`{"url":"https://example.com/target"}`), testHeaders())
	if err != nil || created.StatusCode != http.StatusCreated {
		t.Fatalf("Create() = %v, %v", created.StatusCode, err)
	}
	code := decodeBody(t, created)["code"].(string)

	response, err := client.Resolve(context.Background(), code, testHeaders())
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if response.StatusCode != http.StatusFound {
		t.Fatalf("Resolve() status = %d, want 302", response.StatusCode)
	}
	if location := response.Header.Get("Location"); location != "https://example.com/target" {
		t.Fatalf("Resolve() location = %q", location)
	}
}

func TestLocalClientResolveUnknownCode(t *testing.T) {
	client := newTestLocalClient(t, nil)

	response, err := client.Resolve(context.Background(), "missing1", testHeaders())
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("Resolve() status = %d, want 404", response.StatusCode)
	}
}

func TestLocalClientRateLimitsCreates(t *testing.T) {
	client := newTestLocalClient(t, func(options *LocalOptions) {
		options.CreateLimit = 1
		options.CreateWindow = time.Minute
	})

	first, err := client.Create(context.Background(), []byte(`{"url":"https://example.com/one"}`), testHeaders())
	if err != nil || first.StatusCode != http.StatusCreated {
		t.Fatalf("first Create() = %v, %v", first.StatusCode, err)
	}
	second, err := client.Create(context.Background(), []byte(`{"url":"https://example.com/two"}`), testHeaders())
	if err != nil {
		t.Fatalf("second Create() error = %v", err)
	}
	if second.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second Create() status = %d, want 429", second.StatusCode)
	}
	payload := decodeBody(t, second)
	if payload["code"] != "rate_limited" {
		t.Fatalf("second Create() code = %v", payload["code"])
	}
	if payload["retryAfterSeconds"] == nil {
		t.Fatalf("second Create() retryAfterSeconds missing")
	}
}

func TestLocalClientRequiresClientAddress(t *testing.T) {
	client := newTestLocalClient(t, nil)

	response, err := client.Create(context.Background(), []byte(`{"url":"https://example.com"}`), http.Header{})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("Create() status = %d, want 503", response.StatusCode)
	}
}

func TestLocalClientHealth(t *testing.T) {
	client := newTestLocalClient(t, nil)

	if err := client.Health(context.Background()); err != nil {
		t.Fatalf("Health() error = %v", err)
	}
}
