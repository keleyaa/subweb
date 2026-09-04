package myurls

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/keleyaa/subweb/services/gateway/internal/httpapi"
	"github.com/keleyaa/subweb/services/gateway/internal/shortcode"
)

const createPath = "/short-api/links"

// Handler adapts the public Gateway short-link routes to Rust MyUrls.
type Handler struct {
	client       Client
	maxBodyBytes int64
}

func NewHandler(client Client, maxBodyBytes int64) *Handler {
	return &Handler{client: client, maxBodyBytes: normalizeBodyLimit(maxBodyBytes)}
}

func (handler *Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	requestID := request.Header.Get("X-Request-ID")
	if !validRequestID(requestID) {
		requestID = newRequestID()
	}
	if handler.client == nil {
		writeUnavailable(writer, requestID)
		return
	}

	code := strings.TrimPrefix(request.URL.Path, "/")
	switch {
	case request.URL.Path == createPath:
		handler.create(writer, request, requestID)
	case strings.HasPrefix(request.URL.Path, "/") && shortcode.ValidCode(code):
		handler.resolve(writer, request, requestID)
	default:
		writeProblem(writer, requestID, http.StatusNotFound, "not_found", nil, 0)
	}
}

func (handler *Handler) create(writer http.ResponseWriter, request *http.Request, requestID string) {
	if request.URL.RawQuery != "" {
		writeProblem(writer, requestID, http.StatusNotFound, "not_found", nil, 0)
		return
	}
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", http.MethodPost)
		writeProblem(writer, requestID, http.StatusMethodNotAllowed, "invalid_request", nil, 0)
		return
	}
	if !isJSONContentType(request.Header.Get("Content-Type")) {
		writeProblem(writer, requestID, http.StatusUnsupportedMediaType, "invalid_request", nil, 0)
		return
	}

	body, err := readBody(request, handler.maxBodyBytes)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errBodyTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		writeProblem(writer, requestID, status, "invalid_request", nil, 0)
		return
	}
	response, err := handler.client.Create(request.Context(), body, upstreamHeaders(request.Header, requestID))
	if err != nil {
		writeUnavailable(writer, requestID)
		return
	}
	writeCreateResponse(writer, response, requestID, handler.maxBodyBytes)
}

func (handler *Handler) resolve(writer http.ResponseWriter, request *http.Request, requestID string) {
	if request.URL.RawQuery != "" {
		writeProblem(writer, requestID, http.StatusNotFound, "not_found", nil, 0)
		return
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writer.Header().Set("Allow", "GET, HEAD")
		writeProblem(writer, requestID, http.StatusMethodNotAllowed, "invalid_request", nil, 0)
		return
	}

	response, err := handler.client.Resolve(request.Context(), strings.TrimPrefix(request.URL.Path, "/"), upstreamHeaders(request.Header, requestID))
	if err != nil {
		writeUnavailable(writer, requestID)
		return
	}
	writeResolveResponse(writer, response, requestID, handler.maxBodyBytes)
}

func upstreamHeaders(source http.Header, requestID string) http.Header {
	headers := make(http.Header)
	headers.Set("X-Request-ID", requestID)
	copyForwardedHeaders(headers, source)
	return headers
}

func writeCreateResponse(writer http.ResponseWriter, response *http.Response, requestID string, maxBodyBytes int64) {
	if response == nil || response.Body == nil {
		writeUnavailable(writer, requestID)
		return
	}
	defer response.Body.Close()

	body, err := readResponseBody(response.Body, maxBodyBytes)
	if err != nil {
		writeUnavailable(writer, requestID)
		return
	}
	if response.StatusCode == http.StatusCreated {
		var payload map[string]any
		if json.Unmarshal(body, &payload) != nil || payload == nil {
			writeUnavailable(writer, requestID)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Request-ID", requestID)
		writer.WriteHeader(http.StatusCreated)
		_, _ = writer.Write(body)
		return
	}
	writeMyURLsError(writer, requestID, response.StatusCode, body)
}

func writeResolveResponse(writer http.ResponseWriter, response *http.Response, requestID string, maxBodyBytes int64) {
	if response == nil || response.Body == nil {
		writeUnavailable(writer, requestID)
		return
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusMultipleChoices && response.StatusCode < http.StatusBadRequest {
		location := response.Header.Get("Location")
		if !validRedirectLocation(location) {
			writeUnavailable(writer, requestID)
			return
		}
		writer.Header().Set("Location", location)
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Request-ID", requestID)
		writer.WriteHeader(response.StatusCode)
		return
	}
	body, err := readResponseBody(response.Body, maxBodyBytes)
	if err != nil {
		writeUnavailable(writer, requestID)
		return
	}
	if response.StatusCode == http.StatusNotFound {
		writeProblem(writer, requestID, http.StatusNotFound, "not_found", nil, 0)
		return
	}
	writeMyURLsError(writer, requestID, response.StatusCode, body)
}

func writeMyURLsError(writer http.ResponseWriter, requestID string, status int, body []byte) {
	var payload struct {
		Code              string          `json:"code"`
		RetryAfterSeconds int             `json:"retryAfterSeconds"`
		Challenge         json.RawMessage `json:"challenge"`
	}
	if json.Unmarshal(body, &payload) != nil || !knownErrorCode(payload.Code) {
		writeUnavailable(writer, requestID)
		return
	}
	if status < http.StatusBadRequest || status > 599 {
		writeUnavailable(writer, requestID)
		return
	}
	var challenge any
	if len(payload.Challenge) > 0 && string(payload.Challenge) != "null" {
		var candidate struct {
			Provider string `json:"provider"`
			SiteKey  string `json:"siteKey"`
		}
		if json.Unmarshal(payload.Challenge, &candidate) != nil || candidate.Provider != "turnstile" || candidate.SiteKey == "" {
			writeUnavailable(writer, requestID)
			return
		}
		challenge = map[string]string{"provider": candidate.Provider, "siteKey": candidate.SiteKey}
	}
	writeProblem(writer, requestID, status, payload.Code, challenge, payload.RetryAfterSeconds)
}

func writeUnavailable(writer http.ResponseWriter, requestID string) {
	writeProblem(writer, requestID, http.StatusServiceUnavailable, "dependency_unavailable", nil, 0)
}

func writeProblem(writer http.ResponseWriter, requestID string, status int, code string, challenge any, retryAfterSeconds int) {
	httpapi.WriteProblem(writer, requestID, httpapi.Problem{
		Status:            status,
		Code:              code,
		Challenge:         challenge,
		RetryAfterSeconds: retryAfterSeconds,
	})
}

var errBodyTooLarge = errors.New("request body too large")

func readBody(request *http.Request, maxBytes int64) ([]byte, error) {
	if request.Body == nil {
		return nil, errors.New("request body missing")
	}
	defer request.Body.Close()
	return readLimited(request.Body, maxBytes, errBodyTooLarge)
}

func readResponseBody(reader io.Reader, maxBytes int64) ([]byte, error) {
	return readLimited(reader, maxBytes, errBodyTooLarge)
}

func readLimited(reader io.Reader, maxBytes int64, tooLarge error) ([]byte, error) {
	if maxBytes < 1 {
		return nil, tooLarge
	}
	body, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxBytes {
		return nil, tooLarge
	}
	return body, nil
}

func isJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && strings.EqualFold(mediaType, "application/json")
}

func validRedirectLocation(value string) bool {
	parsed, err := url.ParseRequestURI(value)
	return err == nil && parsed.IsAbs() && parsed.Hostname() != "" && parsed.User == nil &&
		(parsed.Scheme == "http" || parsed.Scheme == "https")
}

func knownErrorCode(code string) bool {
	switch code {
	case "invalid_request", "challenge_required", "challenge_invalid", "alias_unavailable", "url_not_allowed", "alias_invalid", "rate_limited", "request_timeout", "dependency_unavailable", "code_generation_exhausted", "not_found":
		return true
	default:
		return false
	}
}
