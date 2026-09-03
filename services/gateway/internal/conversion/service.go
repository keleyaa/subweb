package conversion

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/httpapi"
	"github.com/keleyaa/subweb/services/gateway/internal/policy"
	"github.com/keleyaa/subweb/services/gateway/internal/privacy"
	"github.com/keleyaa/subweb/services/gateway/internal/ratelimit"
)

const (
	defaultMaxRequestBytes  = 16 * 1024
	defaultMaxResponseBytes = 8 * 1024 * 1024
	defaultTimeout          = 10 * time.Second
	maxSubscriptionURLs     = 16
	maxTargetLength         = 64
)

var (
	allowedQueryParameters = [...]string{
		"target", "ver", "url", "config", "include", "exclude", "emoji", "udp",
		"sort", "list", "scv", "append_type", "filename",
	}
	allowedNodeSchemes = map[string]struct{}{
		"ss": {}, "ssr": {}, "ssd": {}, "vmess": {}, "vless": {},
		"trojan": {}, "socks": {}, "socks5": {},
	}
	targetPattern = regexp.MustCompile(`^[A-Za-z0-9&=_-]+$`)
)

// URLPolicy authorizes one remote URL and returns the addresses validated for it.
// Conversion uses this as a preflight gate. The SubConverter request itself is
// forced through the CONNECT proxy, which independently authorizes the target
// and dials its own fixed-IP evidence before opening the remote connection.
type URLPolicy interface {
	AuthorizeURL(context.Context, string) (policy.DialTarget, error)
}

// Service applies conversion policy before forwarding a request to SubConverter.
type Service struct {
	Policy      URLPolicy
	RateLimiter *ratelimit.RateLimiter
	IPHasher    *privacy.IPHasher
	Semaphore   *policy.Semaphore
	Upstream    *url.URL
	Transport   http.RoundTripper

	MaxRequest  int64
	MaxResponse int64
	Timeout     time.Duration
}

// ServeHTTP serves the public GET /sub conversion endpoint.
func (service *Service) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	requestID := request.Header.Get("X-Request-ID")
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", http.MethodGet)
		service.writeProblem(response, requestID, http.StatusMethodNotAllowed, "method_not_allowed", 0)
		return
	}
	if request.URL == nil || request.URL.Path != "/sub" {
		service.writeProblem(response, requestID, http.StatusNotFound, "not_found", 0)
		return
	}

	maxRequest := service.MaxRequest
	if maxRequest <= 0 {
		maxRequest = defaultMaxRequestBytes
	}
	if int64(len(request.URL.RequestURI())) > maxRequest || request.ContentLength > maxRequest {
		service.writeProblem(response, requestID, http.StatusRequestEntityTooLarge, "request_too_large", 0)
		return
	}

	timeout := service.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	requestContext, cancel, err := policy.WithTotalTimeout(request.Context(), timeout)
	if err != nil {
		service.writeProblem(response, requestID, http.StatusInternalServerError, "internal_error", 0)
		return
	}
	defer cancel()

	if err := service.validateConfiguration(); err != nil {
		service.writeProblem(response, requestID, http.StatusInternalServerError, "internal_error", 0)
		return
	}

	// Reserve the conversion slot before DNS and URL policy work so expensive
	// authorization is covered by the same request-level concurrency limit.
	release, acquired := service.Semaphore.TryAcquire()
	if !acquired {
		service.writeError(response, requestID, policy.PolicyError{Code: "concurrency_limited", Status: http.StatusTooManyRequests})
		return
	}
	defer release()

	if err := service.validateQuery(requestContext, request.URL.Query()); err != nil {
		if request.Context().Err() != nil {
			return
		}
		service.writeError(response, requestID, err)
		return
	}

	clientIP, err := requestClientIP(request.RemoteAddr)
	if err != nil {
		service.writeError(response, requestID, policy.PolicyError{Code: "client_ip_invalid", Status: http.StatusForbidden})
		return
	}
	ipHash, err := service.IPHasher.Hash(clientIP.String())
	if err != nil {
		service.writeProblem(response, requestID, http.StatusInternalServerError, "internal_error", 0)
		return
	}
	rateLimit, err := service.RateLimiter.Allow(requestContext, conversionRateKey(ipHash))
	if err != nil {
		if request.Context().Err() != nil {
			return
		}
		var policyErr policy.PolicyError
		if errors.As(err, &policyErr) && policyErr.Code == "rate_limited" {
			service.writeProblem(response, requestID, policyErr.Status, policyErr.Code, retryAfterSeconds(rateLimit.RetryAfter))
			return
		}
		service.writeError(response, requestID, err)
		return
	}

	upstreamResponse, body, err := service.fetch(requestContext, request)
	if err != nil {
		if request.Context().Err() != nil {
			return
		}
		service.writeError(response, requestID, err)
		return
	}
	defer upstreamResponse.Body.Close()
	response.Header().Set("Content-Type", upstreamResponse.Header.Get("Content-Type"))
	response.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(body)
}

func (service *Service) validateConfiguration() error {
	if service.Policy == nil || service.RateLimiter == nil || service.IPHasher == nil || service.Semaphore == nil || service.Upstream == nil {
		return errors.New("conversion service configuration is incomplete")
	}
	return nil
}

func (service *Service) validateQuery(ctx context.Context, values url.Values) error {
	if len(values["target"]) != 1 || len(values["ver"]) > 1 || len(values["url"]) > 1 || len(values["config"]) > 1 {
		return policy.PolicyError{Code: "invalid_request", Status: http.StatusBadRequest}
	}

	target := values.Get("target")
	if target == "" || len(target) > maxTargetLength || !targetPattern.MatchString(target) {
		return policy.PolicyError{Code: "invalid_target", Status: http.StatusBadRequest}
	}
	if version := values.Get("ver"); version != "" && version != "2" && version != "3" && version != "4" {
		return policy.PolicyError{Code: "invalid_request", Status: http.StatusBadRequest}
	}
	if err := service.validateSubscriptionURLs(ctx, values.Get("url")); err != nil {
		return err
	}
	if config := values.Get("config"); config != "" {
		if _, err := service.Policy.AuthorizeURL(ctx, config); err != nil {
			return err
		}
	}
	return nil
}

func (service *Service) validateSubscriptionURLs(ctx context.Context, value string) error {
	if value == "" {
		return policy.PolicyError{Code: "missing_url", Status: http.StatusBadRequest}
	}
	items := strings.Split(value, "|")
	if len(items) > maxSubscriptionURLs {
		return policy.PolicyError{Code: "too_many_urls", Status: http.StatusRequestEntityTooLarge}
	}
	valid := 0
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		valid++
		if strings.Contains(item, "://") {
			scheme := strings.ToLower(item[:strings.Index(item, "://")])
			if scheme == "http" || scheme == "https" {
				if _, err := service.Policy.AuthorizeURL(ctx, item); err != nil {
					return err
				}
				continue
			}
			if _, ok := allowedNodeSchemes[scheme]; ok && validNodeURI(item) {
				continue
			}
		}
		return policy.PolicyError{Code: "url_not_allowed", Status: http.StatusForbidden}
	}
	if valid == 0 {
		return policy.PolicyError{Code: "missing_url", Status: http.StatusBadRequest}
	}
	return nil
}

func validNodeURI(value string) bool {
	if value == "" || len(value) > 4096 {
		return false
	}
	for _, character := range value {
		if character <= 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

func (service *Service) fetch(ctx context.Context, request *http.Request) (*http.Response, []byte, error) {
	upstreamURL := *service.Upstream
	upstreamURL.Path = "/sub"
	upstreamURL.RawPath = ""
	upstreamURL.RawQuery = forwardedQuery(request.URL.Query())

	upstreamRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL.String(), nil)
	if err != nil {
		return nil, nil, policy.PolicyError{Code: "upstream_error", Status: http.StatusBadGateway}
	}
	upstreamRequest.Header.Set("Accept", "text/plain, text/yaml, application/yaml, application/json, */*")
	upstreamRequest.Header.Set("User-Agent", "subweb-gateway/1")
	if requestID := request.Header.Get("X-Request-ID"); safeRequestID(requestID) {
		upstreamRequest.Header.Set("X-Request-ID", requestID)
	}

	transport := service.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	upstreamResponse, err := client.Do(upstreamRequest)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, nil, ctxErr
		}
		return nil, nil, policy.PolicyError{Code: "upstream_error", Status: http.StatusBadGateway}
	}
	if upstreamResponse.StatusCode < 200 || upstreamResponse.StatusCode >= 300 {
		_ = upstreamResponse.Body.Close()
		status := http.StatusBadRequest
		if upstreamResponse.StatusCode >= 500 {
			status = http.StatusBadGateway
		}
		return nil, nil, policy.PolicyError{Code: "upstream_error", Status: status}
	}

	maxResponse := service.MaxResponse
	if maxResponse <= 0 {
		maxResponse = defaultMaxResponseBytes
	}
	body, err := policy.ReadResponseBody(ctx, upstreamResponse.Body, maxResponse)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, nil, ctxErr
		}
		return nil, nil, err
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(upstreamResponse.Header.Get("Content-Type"), ";", 2)[0]))
	if contentType == "" {
		contentType = "text/plain"
	}
	if !allowedResponseContentType(contentType) {
		return nil, nil, policy.PolicyError{Code: "unsupported_content_type", Status: http.StatusBadGateway}
	}
	return upstreamResponse, body, nil
}

func forwardedQuery(values url.Values) string {
	forwarded := make(url.Values)
	for _, name := range allowedQueryParameters {
		for _, value := range values[name] {
			forwarded.Add(name, value)
		}
	}
	return forwarded.Encode()
}

func allowedResponseContentType(value string) bool {
	switch value {
	case "application/json", "application/octet-stream", "application/yaml", "text/plain", "text/yaml", "text/x-yaml":
		return true
	default:
		return false
	}
}

func requestClientIP(remoteAddr string) (netip.Addr, error) {
	host := remoteAddr
	if parsedHost, _, err := net.SplitHostPort(remoteAddr); err == nil {
		host = parsedHost
	}
	address, err := netip.ParseAddr(host)
	if err != nil || address.Zone() != "" {
		return netip.Addr{}, errors.New("client IP is invalid")
	}
	return address, nil
}

func conversionRateKey(hash string) string {
	return "subweb:rate:convert:" + hash
}

func safeRequestID(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '.' && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func (service *Service) writeError(response http.ResponseWriter, requestID string, err error) {
	var policyErr policy.PolicyError
	if errors.As(err, &policyErr) {
		service.writeProblem(response, requestID, policyErr.Status, policyErr.Code, 0)
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		service.writeProblem(response, requestID, http.StatusGatewayTimeout, "upstream_timeout", 0)
		return
	}
	service.writeProblem(response, requestID, http.StatusBadGateway, "upstream_error", 0)
}

func retryAfterSeconds(duration time.Duration) int {
	if duration <= 0 {
		return 0
	}
	return int((duration + time.Second - 1) / time.Second)
}

func (service *Service) writeProblem(response http.ResponseWriter, requestID string, status int, code string, retryAfterSeconds int) {
	problem := httpapi.Problem{
		Type:              "about:blank",
		Title:             http.StatusText(status),
		Status:            status,
		Code:              code,
		RequestID:         requestID,
		RetryAfterSeconds: retryAfterSeconds,
	}
	httpapi.WriteProblem(response, requestID, problem)
}
