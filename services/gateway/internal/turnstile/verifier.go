// Package turnstile verifies Cloudflare Turnstile challenge tokens.
package turnstile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultEndpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// ErrInvalid reports a token that Cloudflare did not accept.
var ErrInvalid = errors.New("turnstile: challenge rejected")

// Verifier validates Turnstile tokens against the Cloudflare siteverify API.
type Verifier struct {
	Secret   string
	Hostname string
	Endpoint string
	Client   *http.Client
}

// New returns a verifier with a bounded HTTP client.
func New(secret, hostname string, timeout time.Duration) *Verifier {
	if timeout <= 0 {
		timeout = 2500 * time.Millisecond
	}
	return &Verifier{
		Secret:   secret,
		Hostname: hostname,
		Client:   &http.Client{Timeout: timeout},
	}
}

// Verify reports whether token is a valid Turnstile token for this site.
func (verifier *Verifier) Verify(ctx context.Context, token, remoteIP string) error {
	if verifier == nil || verifier.Secret == "" || strings.TrimSpace(token) == "" {
		return ErrInvalid
	}

	form := url.Values{}
	form.Set("secret", verifier.Secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}

	endpoint := verifier.Endpoint
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return ErrInvalid
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	httpClient := verifier.Client
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2500 * time.Millisecond}
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return ErrInvalid
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("%w: status %d", ErrInvalid, response.StatusCode)
	}

	var payload struct {
		Success  bool     `json:"success"`
		Hostname string   `json:"hostname"`
		Errors   []string `json:"error-codes"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return ErrInvalid
	}
	if !payload.Success {
		return ErrInvalid
	}
	if verifier.Hostname != "" && payload.Hostname != "" && payload.Hostname != verifier.Hostname {
		return ErrInvalid
	}
	return nil
}
