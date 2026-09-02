package runtimeconfig

import (
	"fmt"
	"net/http"
	"strconv"
)

// Handler renders the public runtime configuration without exposing service
// credentials or internal network details.
type Handler struct {
	body []byte
}

// New creates a cache-disabled runtime configuration response.
func New(apiURL string, shortLinksEnabled, customBackendEnabled bool, turnstileSiteKey string) *Handler {
	body := []byte(fmt.Sprintf(`/* global window */
window.__SUBWEB_CONFIG__ = {
  apiUrl: %q,
  shortLinksEnabled: %s,
  customBackendEnabled: %s,
  turnstileSiteKey: %q,
};
window.config = window.__SUBWEB_CONFIG__;
`, apiURL, strconv.FormatBool(shortLinksEnabled), strconv.FormatBool(customBackendEnabled), turnstileSiteKey))
	return &Handler{body: body}
}

func (handler *Handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if handler == nil || request.URL.Path != "/conf/config.js" {
		response.WriteHeader(http.StatusNotFound)
		return
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		response.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	response.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusOK)
	if request.Method != http.MethodHead {
		_, _ = response.Write(handler.body)
	}
}
