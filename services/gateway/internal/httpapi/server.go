package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
)

// Dependencies are the handlers and readiness check used by the HTTP server.
//
// Dependency handlers must use only http.ResponseWriter's base Header, WriteHeader,
// and Write methods. Gateway atomically buffers their responses, so streaming,
// WebSocket upgrades, connection hijacking, HTTP/2 push, flushing, and other
// optional ResponseWriter capabilities are unsupported.
type Dependencies struct {
	Converter  http.Handler
	ShortLinks http.Handler
	Readiness  func(context.Context) error
	Logger     *slog.Logger
}

// NewServer creates the Gateway's single HTTP entrypoint.
func NewServer(cfg config.Config, deps Dependencies) *http.Server {
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}

	handler := gatewayHandler{
		cfg:    cfg,
		deps:   deps,
		logger: logger,
	}
	return &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: http.HandlerFunc(handler.serveHTTP),
	}
}

type gatewayHandler struct {
	cfg    config.Config
	deps   Dependencies
	logger *slog.Logger
}

type hostKind int

const (
	unknownHost hostKind = iota
	appHost
	apiHost
	shortHost
)

func (handler gatewayHandler) serveHTTP(response http.ResponseWriter, request *http.Request) {
	requestID := newRequestID()
	writer := &requestIDResponseWriter{
		ResponseWriter: response,
		requestID:      requestID,
	}
	writer.enforceRequestID()

	defer func() {
		if recover() != nil {
			handler.logger.Error("gateway handler panic",
				"request_id", requestID,
				"method", request.Method,
				"status", http.StatusInternalServerError,
			)
			WriteProblem(writer, requestID, Problem{
				Status: http.StatusInternalServerError,
				Code:   "internal_error",
			})
		}
		writer.enforceRequestID()
	}()

	host := handler.classifyHost(request.Host)
	if host == unknownHost {
		writeStatusProblem(writer, requestID, http.StatusMisdirectedRequest, "misdirected_request")
		return
	}

	switch request.URL.Path {
	case "/healthz":
		if request.Method != http.MethodGet {
			writeMethodNotAllowed(writer, requestID, http.MethodGet)
			return
		}
		writeOK(writer)
		return
	case "/readyz":
		if host == shortHost {
			writeStatusProblem(writer, requestID, http.StatusNotFound, "not_found")
			return
		}
		if request.Method != http.MethodGet {
			writeMethodNotAllowed(writer, requestID, http.MethodGet)
			return
		}
		if handler.deps.Readiness != nil && handler.deps.Readiness(request.Context()) != nil {
			writeStatusProblem(writer, requestID, http.StatusServiceUnavailable, "service_unavailable")
			return
		}
		writeOK(writer)
		return
	}

	switch host {
	case apiHost:
		handler.serveAPI(writer, request, requestID)
	case appHost:
		handler.serveApp(writer, request, requestID)
	case shortHost:
		handler.serveShort(writer, request, requestID)
	default:
		writeStatusProblem(writer, requestID, http.StatusMisdirectedRequest, "misdirected_request")
	}
}

func (handler gatewayHandler) serveAPI(writer http.ResponseWriter, request *http.Request, requestID string) {
	if request.URL.Path != "/sub" {
		writeStatusProblem(writer, requestID, http.StatusNotFound, "not_found")
		return
	}
	if request.Method != http.MethodGet {
		writeMethodNotAllowed(writer, requestID, http.MethodGet)
		return
	}
	if handler.deps.Converter == nil {
		writeStatusProblem(writer, requestID, http.StatusNotFound, "not_found")
		return
	}
	handler.serveDependency(handler.deps.Converter, writer, request, requestID, handler.cfg.APIDomain)
}

func (handler gatewayHandler) serveApp(writer http.ResponseWriter, request *http.Request, requestID string) {
	if request.URL.Path == "/short-api/links" {
		if request.URL.RawQuery != "" {
			writeStatusProblem(writer, requestID, http.StatusNotFound, "not_found")
			return
		}
		if request.Method != http.MethodPost {
			writeMethodNotAllowed(writer, requestID, http.MethodPost)
			return
		}
	} else {
		if !isShortCodePath(request.URL.Path) {
			writeStatusProblem(writer, requestID, http.StatusNotFound, "not_found")
			return
		}
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			writeMethodNotAllowed(writer, requestID, "GET, HEAD")
			return
		}
	}
	if handler.deps.ShortLinks == nil {
		writeStatusProblem(writer, requestID, http.StatusNotFound, "not_found")
		return
	}
	handler.serveDependency(handler.deps.ShortLinks, writer, request, requestID, handler.cfg.AppDomain)
}

func (handler gatewayHandler) serveShort(writer http.ResponseWriter, request *http.Request, requestID string) {
	if !isShortCodePath(request.URL.Path) {
		writeStatusProblem(writer, requestID, http.StatusNotFound, "not_found")
		return
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeMethodNotAllowed(writer, requestID, "GET, HEAD")
		return
	}
	if handler.deps.ShortLinks == nil {
		writeStatusProblem(writer, requestID, http.StatusNotFound, "not_found")
		return
	}
	handler.serveDependency(handler.deps.ShortLinks, writer, request, requestID, handler.cfg.ShortDomain)
}

func (handler gatewayHandler) serveDependency(dependency http.Handler, writer http.ResponseWriter, request *http.Request, requestID, publicDomain string) {
	dependencyRequest := request.Clone(request.Context())
	if dependencyRequest.Header == nil {
		dependencyRequest.Header = make(http.Header)
	}
	for header := range dependencyRequest.Header {
		name := strings.ToLower(header)
		if name == "authorization" ||
			name == "proxy-authorization" ||
			name == "cookie" ||
			name == "origin" ||
			name == "forwarded" ||
			strings.HasPrefix(name, "x-forwarded-") ||
			name == "x-real-ip" {
			delete(dependencyRequest.Header, header)
		}
	}
	dependencyRequest.Host = publicDomain
	dependencyRequest.Header.Set("X-Forwarded-Host", publicDomain)
	dependencyRequest.Header.Set("X-Forwarded-Proto", "https")
	dependencyRequest.Header.Set("X-Request-ID", requestID)
	if clientIP := socketClientIP(request.RemoteAddr); clientIP != "" {
		dependencyRequest.Header.Set("X-Forwarded-For", clientIP)
		dependencyRequest.Header.Set("X-Real-IP", clientIP)
	}

	buffer := newBufferedResponseWriter()
	dependency.ServeHTTP(buffer, dependencyRequest)
	if buffer.invalidStatus {
		writeStatusProblem(writer, requestID, http.StatusBadGateway, "upstream_invalid_status")
		return
	}
	if buffer.status == http.StatusSwitchingProtocols {
		writeStatusProblem(writer, requestID, http.StatusBadGateway, "upstream_protocol_not_supported")
		return
	}
	buffer.commit(writer)
}

func (handler gatewayHandler) classifyHost(value string) hostKind {
	host := requestHostname(value)
	if !isStrictASCIIHostname(host) {
		return unknownHost
	}
	switch {
	case strings.EqualFold(host, handler.cfg.AppDomain):
		return appHost
	case strings.EqualFold(host, handler.cfg.APIDomain):
		return apiHost
	case strings.EqualFold(host, handler.cfg.ShortDomain):
		return shortHost
	default:
		return unknownHost
	}
}

func requestHostname(value string) string {
	if value == "" {
		return ""
	}
	if !strings.Contains(value, ":") {
		return value
	}
	if strings.Count(value, ":") != 1 {
		return ""
	}
	host, port, found := strings.Cut(value, ":")
	if !found || host == "" || strings.ContainsAny(host, "[]") || !isValidAuthorityPort(port) {
		return ""
	}
	return host
}

func isStrictASCIIHostname(value string) bool {
	if len(value) == 0 || len(value) > 253 {
		return false
	}

	labelStart := 0
	for index := 0; index <= len(value); index++ {
		if index != len(value) && value[index] != '.' {
			continue
		}

		label := value[labelStart:index]
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') &&
				(character < 'A' || character > 'Z') &&
				(character < '0' || character > '9') &&
				character != '-' {
				return false
			}
		}
		labelStart = index + 1
	}

	return true
}

func isValidAuthorityPort(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	port, err := strconv.Atoi(value)
	return err == nil && port >= 1 && port <= 65535
}

func socketClientIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return ""
	}
	address := net.ParseIP(host)
	if address == nil {
		return ""
	}
	return address.String()
}

func isShortCodePath(path string) bool {
	if len(path) < 2 || len(path) > 65 || path[0] != '/' {
		return false
	}
	for _, character := range path[1:] {
		if (character < 'a' || character > 'z') &&
			(character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') &&
			character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func writeOK(writer http.ResponseWriter) {
	writer.Header().Set("Content-Type", "text/plain")
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write([]byte("ok\n"))
}

func writeMethodNotAllowed(writer http.ResponseWriter, requestID, allow string) {
	writer.Header().Set("Allow", allow)
	writeStatusProblem(writer, requestID, http.StatusMethodNotAllowed, "method_not_allowed")
}

func writeStatusProblem(writer http.ResponseWriter, requestID string, status int, code string) {
	WriteProblem(writer, requestID, Problem{
		Status: status,
		Code:   code,
	})
}

type requestIDResponseWriter struct {
	http.ResponseWriter
	requestID string
}

func (writer *requestIDResponseWriter) WriteHeader(status int) {
	writer.enforceRequestID()
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *requestIDResponseWriter) Write(body []byte) (int, error) {
	writer.enforceRequestID()
	return writer.ResponseWriter.Write(body)
}

func (writer *requestIDResponseWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
}

func (writer *requestIDResponseWriter) enforceRequestID() {
	writer.Header().Set("X-Request-ID", writer.requestID)
}

type bufferedResponseWriter struct {
	header        http.Header
	finalHeader   http.Header
	body          bytes.Buffer
	status        int
	wroteHeader   bool
	invalidStatus bool
}

func newBufferedResponseWriter() *bufferedResponseWriter {
	return &bufferedResponseWriter{header: make(http.Header)}
}

func (writer *bufferedResponseWriter) Header() http.Header {
	return writer.header
}

func (writer *bufferedResponseWriter) WriteHeader(status int) {
	if writer.wroteHeader {
		return
	}
	if status < http.StatusContinue || status > 999 {
		writer.invalidStatus = true
		writer.wroteHeader = true
		return
	}
	if status < http.StatusOK {
		if status != http.StatusSwitchingProtocols {
			return
		}
		writer.status = status
		writer.wroteHeader = true
		return
	}
	writer.status = status
	writer.finalHeader = writer.header.Clone()
	writer.wroteHeader = true
}

func (writer *bufferedResponseWriter) Write(body []byte) (int, error) {
	if !writer.wroteHeader {
		writer.WriteHeader(http.StatusOK)
	}
	return writer.body.Write(body)
}

func (writer *bufferedResponseWriter) commit(destination http.ResponseWriter) {
	if writer.invalidStatus {
		return
	}

	status := writer.status
	header := writer.finalHeader
	if !writer.wroteHeader {
		status = http.StatusOK
		header = writer.header
	}

	destinationHeader := destination.Header()
	for name := range destinationHeader {
		delete(destinationHeader, name)
	}
	for name, values := range header {
		destinationHeader[name] = append([]string(nil), values...)
	}
	destination.WriteHeader(status)
	if writer.body.Len() > 0 {
		_, _ = destination.Write(writer.body.Bytes())
	}
}

var requestIDFallbackCounter atomic.Uint64

func newRequestID() string {
	var bytes [16]byte
	if count, err := rand.Read(bytes[:]); err == nil && count == len(bytes) {
		return hex.EncodeToString(bytes[:])
	}
	return fmt.Sprintf("fallback-%x-%x", time.Now().UnixNano(), requestIDFallbackCounter.Add(1))
}
