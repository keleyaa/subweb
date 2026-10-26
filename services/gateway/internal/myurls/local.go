package myurls

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/linkstore"
	"github.com/keleyaa/subweb/services/gateway/internal/privacy"
	"github.com/keleyaa/subweb/services/gateway/internal/ratelimit"
)

// clientIPHeader carries the Gateway-observed client address to the short-link
// implementation. The handler always overwrites it, so clients cannot spoof it.
const clientIPHeader = "X-Subweb-Client-IP"

const maxAliasLength = 32

// ChallengeVerifier verifies a Turnstile token.
type ChallengeVerifier interface {
	Verify(ctx context.Context, token, remoteIP string) error
}

// LocalOptions configures the embedded short-link implementation.
type LocalOptions struct {
	Store       linkstore.Store
	PublicBase  *url.URL
	TTL         time.Duration
	Limiter     ratelimit.CounterStore
	IPHasher    *privacy.IPHasher
	Challenge   ChallengeVerifier
	SiteKey     string
	ValidateURL func(ctx context.Context, value string) error

	CreateLimit   int
	CreateWindow  time.Duration
	DailyLimit    int
	DailyWindow   time.Duration
	ResolveLimit  int
	ResolveWindow time.Duration

	Now func() time.Time
}

// LocalClient implements Client against an embedded link store.
type LocalClient struct {
	options LocalOptions
}

// NewLocalClient validates options and returns the embedded implementation.
func NewLocalClient(options LocalOptions) (*LocalClient, error) {
	if options.Store == nil {
		return nil, errors.New("myurls: store is required")
	}
	if options.PublicBase == nil {
		return nil, errors.New("myurls: public base URL is required")
	}
	if options.Limiter == nil || options.IPHasher == nil {
		return nil, errors.New("myurls: rate limiter and IP hasher are required")
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	return &LocalClient{options: options}, nil
}

type createRequest struct {
	URL            string  `json:"url"`
	Alias          *string `json:"alias"`
	ChallengeToken *string `json:"challengeToken"`
}

// Create implements Client.
func (client *LocalClient) Create(ctx context.Context, body []byte, headers http.Header) (*http.Response, error) {
	request, err := decodeCreate(body)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "invalid_request", "", 0, nil), nil
	}
	if len(request.URL) == 0 {
		return errorResponse(http.StatusBadRequest, "invalid_request", "", 0, nil), nil
	}

	fingerprint, err := client.fingerprint(headers)
	if err != nil {
		return errorResponse(http.StatusServiceUnavailable, "dependency_unavailable", "", 0, nil), nil
	}

	if limited, retry := client.exceeded(ctx, "create:"+fingerprint, client.options.CreateLimit, client.options.CreateWindow); limited {
		return errorResponse(http.StatusTooManyRequests, "rate_limited", "", retry, nil), nil
	}
	if limited, retry := client.exceeded(ctx, "daily:"+fingerprint, client.options.DailyLimit, client.options.DailyWindow); limited {
		return errorResponse(http.StatusTooManyRequests, "rate_limited", "", retry, nil), nil
	}

	if client.options.Challenge != nil {
		token := ""
		if request.ChallengeToken != nil {
			token = *request.ChallengeToken
		}
		challenge := client.challengePayload()
		if token == "" {
			return errorResponse(http.StatusForbidden, "challenge_required", "", 0, challenge), nil
		}
		remoteIP := strings.TrimSpace(headers.Get(clientIPHeader))
		if err := client.options.Challenge.Verify(ctx, token, remoteIP); err != nil {
			return errorResponse(http.StatusForbidden, "challenge_invalid", "", 0, challenge), nil
		}
	}

	if client.options.ValidateURL != nil {
		if err := client.options.ValidateURL(ctx, request.URL); err != nil {
			return errorResponse(http.StatusUnprocessableEntity, "url_not_allowed", "", 0, nil), nil
		}
	}

	alias := ""
	if request.Alias != nil {
		alias = *request.Alias
		if alias != "" && !validAlias(alias) {
			return errorResponse(http.StatusUnprocessableEntity, "alias_invalid", "", 0, nil), nil
		}
	}

	expiresAt := time.Time{}
	if client.options.TTL > 0 {
		expiresAt = client.options.Now().Add(client.options.TTL)
	}

	link, err := client.options.Store.Create(ctx, request.URL, alias, expiresAt)
	switch {
	case err == nil:
	case errors.Is(err, linkstore.ErrAliasUnavailable):
		return errorResponse(http.StatusConflict, "alias_unavailable", "", 0, nil), nil
	case errors.Is(err, linkstore.ErrCodeExhausted):
		return errorResponse(http.StatusServiceUnavailable, "code_generation_exhausted", "", 0, nil), nil
	case errors.Is(err, linkstore.ErrInvalidTarget):
		return errorResponse(http.StatusBadRequest, "invalid_request", "", 0, nil), nil
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return errorResponse(http.StatusRequestTimeout, "request_timeout", "", 0, nil), nil
	default:
		return errorResponse(http.StatusServiceUnavailable, "dependency_unavailable", "", 0, nil), nil
	}

	payload := struct {
		Code      string `json:"code"`
		ShortURL  string `json:"shortUrl"`
		ExpiresAt string `json:"expiresAt"`
	}{
		Code:      link.Code,
		ShortURL:  client.shortURL(link.Code),
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
	}
	return jsonResponse(http.StatusCreated, payload), nil
}

// Resolve implements Client.
func (client *LocalClient) Resolve(ctx context.Context, code string, headers http.Header) (*http.Response, error) {
	fingerprint, err := client.fingerprint(headers)
	if err != nil {
		return errorResponse(http.StatusServiceUnavailable, "dependency_unavailable", "", 0, nil), nil
	}
	if limited, retry := client.exceeded(ctx, "resolve:"+fingerprint, client.options.ResolveLimit, client.options.ResolveWindow); limited {
		return errorResponse(http.StatusTooManyRequests, "rate_limited", "", retry, nil), nil
	}

	link, err := client.options.Store.Resolve(ctx, code)
	if errors.Is(err, linkstore.ErrNotFound) {
		return &http.Response{StatusCode: http.StatusNotFound, Header: http.Header{}, Body: http.NoBody}, nil
	}
	if err != nil {
		return errorResponse(http.StatusServiceUnavailable, "dependency_unavailable", "", 0, nil), nil
	}

	header := http.Header{}
	header.Set("Location", link.URL)
	return &http.Response{StatusCode: http.StatusFound, Header: header, Body: http.NoBody}, nil
}

// Health implements Client.
func (client *LocalClient) Health(ctx context.Context) error {
	return client.options.Store.Health(ctx)
}

func (client *LocalClient) fingerprint(headers http.Header) (string, error) {
	ip := strings.TrimSpace(headers.Get(clientIPHeader))
	if ip == "" {
		return "", errors.New("myurls: client address is missing")
	}
	return client.options.IPHasher.Hash(ip)
}

func (client *LocalClient) exceeded(ctx context.Context, key string, limit int, window time.Duration) (bool, int) {
	if limit <= 0 || window <= 0 {
		return false, 0
	}
	count, err := client.options.Limiter.Increment(ctx, key, window)
	if err != nil {
		return true, int(window.Seconds())
	}
	if count > int64(limit) {
		return true, int(window.Seconds())
	}
	return false, 0
}

func (client *LocalClient) shortURL(code string) string {
	base := *client.options.PublicBase
	base.Path = strings.TrimSuffix(base.Path, "/") + "/" + code
	return base.String()
}

func (client *LocalClient) challengePayload() map[string]string {
	return map[string]string{"provider": "turnstile", "siteKey": client.options.SiteKey}
}

func decodeCreate(body []byte) (createRequest, error) {
	var request createRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return createRequest{}, err
	}
	if decoder.More() {
		return createRequest{}, errors.New("myurls: trailing JSON content")
	}
	return request, nil
}

func validAlias(alias string) bool {
	if len(alias) < 4 || len(alias) > maxAliasLength {
		return false
	}
	for index := 0; index < len(alias); index++ {
		character := alias[index]
		if (character < 'a' || character > 'z') &&
			(character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') &&
			character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func jsonResponse(status int, payload any) *http.Response {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return errorResponse(http.StatusServiceUnavailable, "dependency_unavailable", "", 0, nil)
	}
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(bytes.NewReader(encoded)),
	}
}

func errorResponse(status int, code, requestID string, retryAfterSeconds int, challenge any) *http.Response {
	payload := map[string]any{"code": code}
	if requestID != "" {
		payload["requestId"] = requestID
	}
	if retryAfterSeconds > 0 {
		payload["retryAfterSeconds"] = retryAfterSeconds
	}
	if challenge != nil {
		payload["challenge"] = challenge
	}
	return jsonResponse(status, payload)
}
