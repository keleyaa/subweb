package staticfiles

import (
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const (
	assetCacheControl  = "public, max-age=31536000, immutable"
	configCacheControl = "no-store"
)

// Handler serves the Vue build without exposing directory listings or masking
// missing static resources with the SPA fallback.
type Handler struct {
	root string
}

// New creates a static handler rooted at root.
func New(root string) *Handler {
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		absoluteRoot = filepath.Clean(root)
	}
	return &Handler{root: filepath.Clean(absoluteRoot)}
}

func (handler *Handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		response.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	requestPath, ok := cleanRequestPath(request.URL)
	if !ok {
		http.NotFound(response, request)
		return
	}

	switch requestPath {
	case "/conf/config.js":
		handler.serveFile(response, request, requestPath, "application/javascript; charset=utf-8", configCacheControl)
	case "/favicon.svg":
		handler.serveFile(response, request, requestPath, "image/svg+xml", "")
	case "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png":
		handler.serveFile(response, request, requestPath, "image/png", "")
	case "/site.webmanifest":
		handler.serveFile(response, request, requestPath, "application/manifest+json", "")
	case "/robots.txt":
		handler.serveFile(response, request, requestPath, "text/plain; charset=utf-8", "")
	case "/sitemap.xml":
		handler.serveFile(response, request, requestPath, "application/xml", "")
	default:
		handler.serveDynamicPath(response, request, requestPath)
	}
}

func (handler *Handler) serveDynamicPath(response http.ResponseWriter, request *http.Request, requestPath string) {
	if requestPath == "/assets" || strings.HasPrefix(requestPath, "/assets/") {
		handler.serveFile(response, request, requestPath, "", assetCacheControl)
		return
	}
	if requestPath == "/conf" || strings.HasPrefix(requestPath, "/conf/") {
		http.NotFound(response, request)
		return
	}
	if requestPath == "/" || requestPath == "/index.html" {
		handler.serveFile(response, request, "/index.html", "text/html; charset=utf-8", "")
		return
	}
	if path.Ext(requestPath) != "" {
		http.NotFound(response, request)
		return
	}

	// Only extensionless page URLs fall back to the Vue entrypoint. A real
	// extension indicates a missing resource and must remain a 404.
	handler.serveFile(response, request, "/index.html", "text/html; charset=utf-8", "")
}

func (handler *Handler) serveFile(response http.ResponseWriter, request *http.Request, requestPath, contentType, cacheControl string) {
	filePath, ok := handler.filePath(requestPath)
	if !ok {
		http.NotFound(response, request)
		return
	}

	file, err := os.Open(filePath)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(response, request)
		return
	}
	if contentType != "" {
		response.Header().Set("Content-Type", contentType)
	}
	if cacheControl != "" {
		response.Header().Set("Cache-Control", cacheControl)
	}
	http.ServeContent(response, request, filepath.Base(filePath), info.ModTime(), file)
}

func (handler *Handler) filePath(requestPath string) (string, bool) {
	if handler.root == "" || strings.ContainsRune(requestPath, 0) || strings.Contains(requestPath, "\\") {
		return "", false
	}
	cleaned := path.Clean(requestPath)
	if cleaned != requestPath || !strings.HasPrefix(cleaned, "/") {
		return "", false
	}
	for _, segment := range strings.Split(strings.TrimPrefix(cleaned, "/"), "/") {
		if segment == ".." {
			return "", false
		}
	}

	candidate := filepath.Join(handler.root, filepath.FromSlash(strings.TrimPrefix(cleaned, "/")))
	resolvedRoot, err := filepath.EvalSymlinks(handler.root)
	if err != nil {
		return "", false
	}
	resolvedCandidate, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", false
	}
	relative, err := filepath.Rel(resolvedRoot, resolvedCandidate)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	return resolvedCandidate, true
}

func cleanRequestPath(requestURL *url.URL) (string, bool) {
	if requestURL == nil {
		return "", false
	}
	decoded, err := url.PathUnescape(requestURL.EscapedPath())
	if err != nil || decoded == "" || !strings.HasPrefix(decoded, "/") || strings.ContainsRune(decoded, 0) {
		return "", false
	}
	for _, segment := range strings.Split(strings.TrimPrefix(decoded, "/"), "/") {
		if segment == ".." {
			return "", false
		}
	}
	return path.Clean(decoded), true
}
