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
		"signed port":          "https://api.example.test:+443",
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

func TestLoadRejectsSignedListenPort(t *testing.T) {
	env := validEnvironment()
	env["LISTEN_ADDR"] = "0.0.0.0:+8080"

	_, err := Load(getenv(env))
	if err == nil || !strings.Contains(err.Error(), "LISTEN_ADDR") {
		t.Fatalf("Load() error = %v, want LISTEN_ADDR validation error", err)
	}
}

func TestLoadRejectsInvalidDNSHostname(t *testing.T) {
	for _, variable := range []string{"API_URL", "SUBCONVERTER_UPSTREAM", "MYURLS_APP_UPSTREAM", "MYURLS_SHORT_UPSTREAM"} {
		for name, value := range map[string]string{
			"underscore":     "https://api_example.test",
			"leading hyphen": "https://-bad.example.test",
			"empty label":    "https://api..example.test",
		} {
			t.Run(variable+"/"+name, func(t *testing.T) {
				env := validEnvironment()
				env[variable] = value

				_, err := Load(getenv(env))
				if err == nil || !strings.Contains(err.Error(), variable) {
					t.Fatalf("Load() error = %v, want %s validation error", err, variable)
				}
			})
		}
	}
}

func TestLoadAcceptsIPLiteralURLHostnames(t *testing.T) {
	for name, value := range map[string]string{
		"IPv4": "https://127.0.0.1",
		"IPv6": "https://[::1]",
	} {
		t.Run(name, func(t *testing.T) {
			env := validEnvironment()
			env["API_URL"] = value

			if _, err := Load(getenv(env)); err != nil {
				t.Fatalf("Load() error = %v, want IP literal URL hostname to be accepted", err)
			}
		})
	}
}

func TestLoadAcceptsZoneScopedIPv6APIURL(t *testing.T) {
	env := validEnvironment()
	env["API_URL"] = "https://[fe80::1%25en0]:8443"

	cfg, err := Load(getenv(env))
	if err != nil {
		t.Fatalf("Load() error = %v, want zone-scoped IPv6 API URL to be accepted", err)
	}
	if got := cfg.APIURL.String(); got != env["API_URL"] {
		t.Fatalf("APIURL = %q, want %q", got, env["API_URL"])
	}
}

func TestLoadRequiresShortLinkSecretsWhenEnabled(t *testing.T) {
	for name, unset := range map[string]string{
		"Redis URL":             "REDIS_URL",
		"Redis password":        "REDIS_PASSWORD",
		"IP hash secret":        "IP_HASH_SECRET",
		"Turnstile site key":    "TURNSTILE_SITE_KEY",
		"MyUrls app upstream":   "MYURLS_APP_UPSTREAM",
		"MyUrls short upstream": "MYURLS_SHORT_UPSTREAM",
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

func TestLoadDoesNotRequireShortDomainOrShortLinkSecretsWhenDisabled(t *testing.T) {
	env := validEnvironment()
	env["SHORT_LINKS_ENABLED"] = "false"
	delete(env, "SHORT_DOMAIN")

	shortLinkOnlyVariables := []string{
		"REDIS_URL",
		"REDIS_PASSWORD",
		"IP_HASH_SECRET",
		"TURNSTILE_SITE_KEY",
		"MYURLS_APP_UPSTREAM",
		"MYURLS_SHORT_UPSTREAM",
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
	if cfg.ShortDomain != "" {
		t.Fatalf("Load() ShortDomain = %q, want empty", cfg.ShortDomain)
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
		"CONVERSION_DNS_TIMEOUT_MS":            "30001",
		"CONVERSION_EGRESS_CONNECT_TIMEOUT_MS": "30001",
	} {
		t.Run(name, func(t *testing.T) {
			env := validEnvironment()
			env[name] = value
			if name == "CONVERSION_DNS_TIMEOUT_MS" || name == "CONVERSION_EGRESS_CONNECT_TIMEOUT_MS" {
				env["CONVERSION_REQUEST_TIMEOUT_MS"] = "60000"
			}

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
		"MYURLS_APP_UPSTREAM":    "http://myurls-app:3000",
		"MYURLS_SHORT_UPSTREAM":  "http://myurls-short:3000",
	}
}

func getenv(values map[string]string) func(string) string {
	return func(name string) string {
		return values[name]
	}
}
