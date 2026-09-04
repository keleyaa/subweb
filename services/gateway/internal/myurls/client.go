package myurls

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/shortcode"
)

var ErrUnavailable = errors.New("myurls unavailable")

// Client is the narrow Gateway boundary for the MyUrls service.
type Client interface {
	Create(ctx context.Context, body []byte, headers http.Header) (*http.Response, error)
	Resolve(ctx context.Context, code string, headers http.Header) (*http.Response, error)
	Health(ctx context.Context) error
}

const defaultUpstreamTimeout = 10 * time.Second

// HTTPClient is the bounded HTTP client for the MyUrls service.
type HTTPClient struct {
	baseURL      *url.URL
	httpClient   *http.Client
	maxBodyBytes int64
}

func NewHTTPClient(baseURL *url.URL, transport http.RoundTripper) *HTTPClient {
	return NewHTTPClientWithBodyLimit(baseURL, transport, defaultBodyLimit)
}

func NewHTTPClientWithTimeout(baseURL *url.URL, transport http.RoundTripper, timeout time.Duration) *HTTPClient {
	return newHTTPClient(baseURL, transport, timeout, defaultBodyLimit)
}

// NewHTTPClientWithBodyLimit creates a client with a shared upstream body limit.
func NewHTTPClientWithBodyLimit(baseURL *url.URL, transport http.RoundTripper, maxBodyBytes int64) *HTTPClient {
	return newHTTPClient(baseURL, transport, defaultUpstreamTimeout, maxBodyBytes)
}

func newHTTPClient(baseURL *url.URL, transport http.RoundTripper, timeout time.Duration, maxBodyBytes int64) *HTTPClient {
	var baseCopy *url.URL
	if baseURL != nil {
		copy := *baseURL
		copy.Path = ""
		copy.RawPath = ""
		copy.RawQuery = ""
		copy.Fragment = ""
		baseCopy = &copy
	}
	if transport == nil {
		transport = http.DefaultTransport
	}
	if timeout <= 0 {
		timeout = defaultUpstreamTimeout
	}
	maxBodyBytes = normalizeBodyLimit(maxBodyBytes)
	return &HTTPClient{
		baseURL:      baseCopy,
		maxBodyBytes: maxBodyBytes,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (client *HTTPClient) Create(ctx context.Context, body []byte, headers http.Header) (*http.Response, error) {
	requestID := ""
	if headers != nil {
		requestID = headers.Get("X-Request-ID")
	}
	if !validRequestID(requestID) {
		requestID = newRequestID()
	}
	return client.do(ctx, http.MethodPost, "/api/links", body, requestID, true, headers)
}

func (client *HTTPClient) Resolve(ctx context.Context, code string, headers http.Header) (*http.Response, error) {
	if !shortcode.ValidCode(code) {
		return nil, ErrUnavailable
	}
	requestID := ""
	if headers != nil {
		requestID = headers.Get("X-Request-ID")
	}
	if !validRequestID(requestID) {
		requestID = newRequestID()
	}
	return client.do(ctx, http.MethodGet, "/"+code, nil, requestID, false, headers)
}

func (client *HTTPClient) Health(ctx context.Context) error {
	response, err := client.do(ctx, http.MethodGet, "/health/live", nil, newRequestID(), false, nil)
	if err != nil {
		return ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return ErrUnavailable
	}
	bytesRead, err := io.Copy(io.Discard, io.LimitReader(response.Body, client.maxBodyBytes+1))
	if err != nil || bytesRead > client.maxBodyBytes {
		return ErrUnavailable
	}
	return nil
}

func (client *HTTPClient) do(ctx context.Context, method, requestPath string, body []byte, requestID string, hasBody bool, headers http.Header) (*http.Response, error) {
	if ctx == nil || client.baseURL == nil || client.httpClient == nil {
		return nil, ErrUnavailable
	}
	target := *client.baseURL
	target.Path = requestPath
	target.RawPath = ""
	target.RawQuery = ""
	target.Fragment = ""

	var reader io.Reader
	if hasBody {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, target.String(), reader)
	if err != nil {
		return nil, ErrUnavailable
	}
	request.Header.Set("Accept", "application/json, application/problem+json")
	if hasBody {
		request.Header.Set("Content-Type", "application/json")
	}
	if !validRequestID(requestID) {
		requestID = newRequestID()
	}
	request.Header.Set("X-Request-ID", requestID)
	copyForwardedHeaders(request.Header, headers)

	response, err := client.httpClient.Do(request)
	if err != nil {
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		return nil, ErrUnavailable
	}
	if response == nil || response.Body == nil {
		return nil, ErrUnavailable
	}
	return response, nil
}

func copyForwardedHeaders(destination, source http.Header) {
	if source == nil {
		return
	}
	for _, name := range []string{"X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-IP"} {
		if value := source.Get(name); value != "" {
			destination.Set(name, value)
		}
	}
}

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

func validRequestID(value string) bool {
	return requestIDPattern.MatchString(value)
}

func newRequestID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "myurls-request"
	}
	return hex.EncodeToString(value[:])
}
