package staticfiles

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newStaticFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, directory := range []string{"assets", "conf"} {
		if err := os.Mkdir(filepath.Join(root, directory), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		"index.html":           "<!doctype html><title>app</title>",
		"assets/app.123.js":    "console.log('app')",
		"conf/config.js":       "window.config = { apiUrl: 'https://api.example.test' };",
		"apple-touch-icon.png": "png-touch",
		"icon-192.png":         "png-192",
		"icon-512.png":         "png-512",
		"site.webmanifest":     "{\"name\":\"Subweb\"}",
		"robots.txt":           "User-agent: *\n",
		"sitemap.xml":          "<?xml version=\"1.0\"?>",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func serveStatic(t *testing.T, handler http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestStaticHandlerServesAssetsWithImmutableCaching(t *testing.T) {
	handler := New(newStaticFixture(t))

	response := serveStatic(t, handler, http.MethodGet, "/assets/app.123.js")

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q, want immutable asset policy", got)
	}
	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/javascript") {
		t.Fatalf("Content-Type = %q, want JavaScript", got)
	}
}

func TestStaticHandlerUsesExplicitResourceContentTypes(t *testing.T) {
	tests := []struct {
		path        string
		contentType string
	}{
		{path: "/apple-touch-icon.png", contentType: "image/png"},
		{path: "/icon-192.png", contentType: "image/png"},
		{path: "/icon-512.png", contentType: "image/png"},
		{path: "/site.webmanifest", contentType: "application/manifest+json"},
		{path: "/robots.txt", contentType: "text/plain; charset=utf-8"},
		{path: "/sitemap.xml", contentType: "application/xml"},
	}
	handler := New(newStaticFixture(t))

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			response := serveStatic(t, handler, http.MethodGet, test.path)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if got := response.Header().Get("Content-Type"); got != test.contentType {
				t.Fatalf("Content-Type = %q, want %q", got, test.contentType)
			}
		})
	}
}

func TestStaticHandlerDoesNotCacheRuntimeConfig(t *testing.T) {
	handler := New(newStaticFixture(t))

	response := serveStatic(t, handler, http.MethodGet, "/conf/config.js")

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if body := response.Body.String(); strings.Contains(body, "REDIS") || strings.Contains(body, "SECRET") || strings.Contains(body, "PASSWORD") {
		t.Fatalf("runtime config contains a secret-looking field: %q", body)
	}
}

func TestStaticHandlerDoesNotFollowSymlinksOutsideRoot(t *testing.T) {
	handlerRoot := newStaticFixture(t)
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(handlerRoot, "assets", "secret.txt")); err != nil {
		t.Fatal(err)
	}

	response := serveStatic(t, New(handlerRoot), http.MethodGet, "/assets/secret.txt")
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestStaticHandlerFallsBackOnlyForExtensionlessPages(t *testing.T) {
	handler := New(newStaticFixture(t))

	for _, path := range []string{"/", "/settings", "/nested/page"} {
		t.Run(path, func(t *testing.T) {
			response := serveStatic(t, handler, http.MethodGet, path)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if body := response.Body.String(); !strings.Contains(body, "<title>app</title>") {
				t.Fatalf("body = %q, want SPA index", body)
			}
		})
	}

	for _, path := range []string{"/assets", "/assets/", "/assets/missing.js", "/conf", "/conf/", "/conf/missing.js", "/missing.js"} {
		t.Run(path, func(t *testing.T) {
			response := serveStatic(t, handler, http.MethodGet, path)
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
		})
	}
}

func TestStaticHandlerAllowsOnlyGetAndHead(t *testing.T) {
	handler := New(newStaticFixture(t))

	response := serveStatic(t, handler, http.MethodPost, "/")
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
	if got := response.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("Allow = %q, want GET, HEAD", got)
	}
}
