package config

import (
	"strconv"
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
	for _, variable := range []string{"API_URL", "SUBCONVERTER_UPSTREAM", "MYURLS_UPSTREAM"} {
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
		"Redis URL":          "REDIS_URL",
		"Redis password":     "REDIS_PASSWORD",
		"IP hash secret":     "IP_HASH_SECRET",
		"Turnstile site key": "TURNSTILE_SITE_KEY",
		"MyUrls upstream":    "MYURLS_UPSTREAM",
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
		"MYURLS_UPSTREAM":        "http://myurls:3000",
	}
}

func TestLoadAppliesRestrictedEgressAndConcurrencyDefaults(t *testing.T) {
	cfg, err := Load(getenv(validEnvironment()))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LogLevel != "info" {
		t.Fatalf("LogLevel = %q, want the info default", cfg.LogLevel)
	}
	if cfg.EgressListenAddr != "0.0.0.0:25502" {
		t.Fatalf("EgressListenAddr = %q, want the subscription egress listener", cfg.EgressListenAddr)
	}
	if cfg.EgressRestrictedListenAddr != "0.0.0.0:25503" {
		t.Fatalf("EgressRestrictedListenAddr = %q, want the restricted egress listener", cfg.EgressRestrictedListenAddr)
	}
	if len(cfg.EgressAllowedHosts) != 1 || cfg.EgressAllowedHosts[0] != "challenges.cloudflare.com" {
		t.Fatalf("EgressAllowedHosts = %v, want the Turnstile siteverify host", cfg.EgressAllowedHosts)
	}
	if cfg.ConversionMaxConcurrency != 4 {
		t.Fatalf("ConversionMaxConcurrency = %d, want 4", cfg.ConversionMaxConcurrency)
	}
	if cfg.ConversionMaxConcurrencyPerIP != 2 {
		t.Fatalf("ConversionMaxConcurrencyPerIP = %d, want 2", cfg.ConversionMaxConcurrencyPerIP)
	}
}

func TestLoadLogLevel(t *testing.T) {
	for _, level := range []string{"debug", "info", "warn", "error"} {
		t.Run(level, func(t *testing.T) {
			env := validEnvironment()
			env["LOG_LEVEL"] = level

			cfg, err := Load(getenv(env))
			if err != nil {
				t.Fatal(err)
			}
			if cfg.LogLevel != level {
				t.Fatalf("LogLevel = %q, want %q", cfg.LogLevel, level)
			}
		})
	}

	for _, value := range []string{"INFO", "verbose", "warning", "1"} {
		t.Run("rejects "+value, func(t *testing.T) {
			env := validEnvironment()
			env["LOG_LEVEL"] = value

			_, err := Load(getenv(env))
			if err == nil || !strings.Contains(err.Error(), "LOG_LEVEL") {
				t.Fatalf("Load() error = %v, want LOG_LEVEL validation error", err)
			}
		})
	}
}

func TestLoadNormalizesEgressAllowedHosts(t *testing.T) {
	env := validEnvironment()
	env["EGRESS_ALLOWED_HOSTS"] = " Challenges.Cloudflare.com , ,challenges.cloudflare.com,cdn.example.test "

	cfg, err := Load(getenv(env))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"challenges.cloudflare.com", "cdn.example.test"}
	if len(cfg.EgressAllowedHosts) != len(want) {
		t.Fatalf("EgressAllowedHosts = %v, want %v", cfg.EgressAllowedHosts, want)
	}
	for index, host := range want {
		if cfg.EgressAllowedHosts[index] != host {
			t.Fatalf("EgressAllowedHosts[%d] = %q, want %q", index, cfg.EgressAllowedHosts[index], host)
		}
	}
}

func TestLoadRejectsInvalidEgressAllowedHosts(t *testing.T) {
	tooMany := make([]string, 0, maxEgressAllowedHosts+1)
	for index := range maxEgressAllowedHosts + 1 {
		tooMany = append(tooMany, "host"+strconv.Itoa(index)+".example.test")
	}

	for name, value := range map[string]string{
		"empty":          " , ",
		"port":           "challenges.cloudflare.com:443",
		"trailing dot":   "challenges.cloudflare.com.",
		"underscore":     "challenges_cloudflare.com",
		"scheme":         "https://challenges.cloudflare.com",
		"empty label":    "challenges..cloudflare.com",
		"too many hosts": strings.Join(tooMany, ","),
	} {
		t.Run(name, func(t *testing.T) {
			env := validEnvironment()
			env["EGRESS_ALLOWED_HOSTS"] = value

			_, err := Load(getenv(env))
			if err == nil || !strings.Contains(err.Error(), "EGRESS_ALLOWED_HOSTS") {
				t.Fatalf("Load() error = %v, want EGRESS_ALLOWED_HOSTS validation error", err)
			}
		})
	}
}

func TestLoadRejectsInvalidRestrictedEgressListenerAndPerClientLimit(t *testing.T) {
	for name, mutate := range map[string]func(map[string]string){
		"restricted listener": func(env map[string]string) {
			env["EGRESS_RESTRICTED_LISTEN_ADDR"] = "not-an-address"
		},
		"per-client limit": func(env map[string]string) {
			env["CONVERSION_MAX_CONCURRENCY_PER_IP"] = "101"
		},
		"zero per-client limit": func(env map[string]string) {
			env["CONVERSION_MAX_CONCURRENCY_PER_IP"] = "0"
		},
	} {
		t.Run(name, func(t *testing.T) {
			env := validEnvironment()
			mutate(env)

			if _, err := Load(getenv(env)); err == nil {
				t.Fatal("Load() error = nil, want validation error")
			}
		})
	}
}

func getenv(values map[string]string) func(string) string {
	return func(name string) string {
		return values[name]
	}
}
