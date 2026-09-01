package config

import (
	"strings"
	"testing"
)

const testIPHashSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestLoadRejectsMissingRequiredDomain(t *testing.T) {
	env := validEnvironment()
	delete(env, "APP_DOMAIN")

	_, err := Load(getenv(env))
	if err == nil || !strings.Contains(err.Error(), "APP_DOMAIN") {
		t.Fatalf("Load() error = %v, want APP_DOMAIN validation error", err)
	}
}

func TestLoadRejectsInvalidURL(t *testing.T) {
	for name, value := range map[string]string{
		"non-HTTPS remote URL": "http://converter.example.test",
		"URL credentials":      "https://user:password@api.example.test",
		"invalid port":         "https://api.example.test:65536",
		"non-HTTP scheme":      "ftp://api.example.test",
	} {
		t.Run(name, func(t *testing.T) {
			env := validEnvironment()
			env["API_URL"] = value

			_, err := Load(getenv(env))
			if err == nil || !strings.Contains(err.Error(), "API_URL") {
				t.Fatalf("Load() error = %v, want API_URL validation error", err)
			}
		})
	}
}

func TestLoadRequiresShortLinkSecretsWhenEnabled(t *testing.T) {
	for name, unset := range map[string]string{
		"Redis password":       "REDIS_PASSWORD",
		"IP hash secret":       "IP_HASH_SECRET",
		"Turnstile site key":   "TURNSTILE_SITE_KEY",
		"Turnstile secret key": "TURNSTILE_SECRET_KEY",
	} {
		t.Run(name, func(t *testing.T) {
			env := validEnvironment()
			delete(env, unset)

			_, err := Load(getenv(env))
			if err == nil || !strings.Contains(err.Error(), unset) {
				t.Fatalf("Load() error = %v, want %s validation error", err, unset)
			}
		})
	}
}

func TestLoadDoesNotRequireShortLinkSecretsWhenDisabled(t *testing.T) {
	env := validEnvironment()
	env["SHORT_LINKS_ENABLED"] = "false"

	shortLinkOnlyVariables := []string{
		"REDIS_URL",
		"REDIS_PASSWORD",
		"IP_HASH_SECRET",
		"TURNSTILE_SITE_KEY",
		"TURNSTILE_SECRET_KEY",
		"MYURLS_UPSTREAM",
	}
	for _, name := range shortLinkOnlyVariables {
		delete(env, name)
	}

	requested := make(map[string]bool)
	cfg, err := Load(func(name string) string {
		requested[name] = true
		return env[name]
	})
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ShortLinksEnabled {
		t.Fatal("Load() ShortLinksEnabled = true, want false")
	}
	for _, name := range shortLinkOnlyVariables {
		if requested[name] {
			t.Fatalf("Load() read %s when short links are disabled", name)
		}
	}
}

func TestLoadRejectsUnsafeTrustedProxyCIDR(t *testing.T) {
	for _, value := range []string{"0.0.0.0/0", "::/0"} {
		t.Run(value, func(t *testing.T) {
			env := validEnvironment()
			env["TRUSTED_PROXY_CIDR"] = value

			_, err := Load(getenv(env))
			if err == nil || !strings.Contains(err.Error(), "TRUSTED_PROXY_CIDR") {
				t.Fatalf("Load() error = %v, want TRUSTED_PROXY_CIDR validation error", err)
			}
		})
	}
}

func TestLoadRejectsUnboundedPolicyValues(t *testing.T) {
	for name, value := range map[string]string{
		"CONVERSION_RATE_LIMIT":                "10001",
		"CONVERSION_RATE_WINDOW_SECONDS":       "3601",
		"CONVERSION_MAX_REQUEST_BYTES":         "1048577",
		"CONVERSION_MAX_RESPONSE_BYTES":        "67108865",
		"CONVERSION_REQUEST_TIMEOUT_MS":        "60001",
		"CONVERSION_MAX_CONCURRENCY":           "101",
		"CONVERSION_DNS_TIMEOUT_MS":            "10000",
		"CONVERSION_EGRESS_CONNECT_TIMEOUT_MS": "10000",
	} {
		t.Run(name, func(t *testing.T) {
			env := validEnvironment()
			env[name] = value

			_, err := Load(getenv(env))
			if err == nil || !strings.Contains(err.Error(), name) {
				t.Fatalf("Load() error = %v, want %s validation error", err, name)
			}
		})
	}
}

func validEnvironment() map[string]string {
	return map[string]string{
		"APP_DOMAIN":             "app.example.test",
		"API_DOMAIN":             "api.example.test",
		"SHORT_DOMAIN":           "short.example.test",
		"API_URL":                "https://api.example.test",
		"SHORT_LINKS_ENABLED":    "true",
		"CUSTOM_BACKEND_ENABLED": "true",
		"REDIS_URL":              "redis://redis:6379/1",
		"REDIS_PASSWORD":         "redis-password",
		"IP_HASH_SECRET":         testIPHashSecret,
		"TURNSTILE_SITE_KEY":     "turnstile-site-key",
		"TURNSTILE_SECRET_KEY":   "turnstile-secret-key",
		"SUBCONVERTER_UPSTREAM":  "http://subconverter:25500",
		"MYURLS_UPSTREAM":        "http://myurls:3000",
	}
}

func getenv(values map[string]string) func(string) string {
	return func(name string) string {
		return values[name]
	}
}
