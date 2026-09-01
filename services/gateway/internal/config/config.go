package config

import (
	"encoding/hex"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultListenAddr                  = "0.0.0.0:8080"
	defaultConversionRateLimit         = 10
	defaultConversionRateWindowSeconds = 60
	defaultMaxRequestBytes             = 16 * 1024
	defaultMaxResponseBytes            = 8 * 1024 * 1024
	defaultRequestTimeoutMilliseconds  = 10_000
	defaultDNSTimeoutMilliseconds      = 2_000
	defaultConnectTimeoutMilliseconds  = 5_000
	defaultMaxConcurrency              = 2

	maxConversionRateLimit         = 10_000
	maxConversionRateWindowSeconds = 3_600
	maxRequestBytes                = 1 * 1024 * 1024
	maxResponseBytes               = 64 * 1024 * 1024
	maxRequestTimeoutMilliseconds  = 60_000
	maxDNSTimeoutMilliseconds      = 30_000
	maxConnectTimeoutMilliseconds  = 30_000
	maxConversionConcurrency       = 100
)

// Config contains the Gateway's validated runtime configuration.
type Config struct {
	ListenAddr                 string
	AppDomain                  string
	APIDomain                  string
	ShortDomain                string
	APIURL                     *url.URL
	ShortLinksEnabled          bool
	CustomBackendEnabled       bool
	TrustedProxyCIDR           *net.IPNet
	RedisURL                   string
	RedisPassword              string
	IPHashSecret               []byte
	TurnstileSiteKey           string
	TurnstileSecretKey         string
	SubConverterUpstream       *url.URL
	MyURLsUpstream             *url.URL
	ConversionRateLimit        int
	ConversionRateWindow       time.Duration
	ConversionMaxRequestBytes  int64
	ConversionMaxResponseBytes int64
	ConversionRequestTimeout   time.Duration
	ConversionDNSTimeout       time.Duration
	EgressConnectTimeout       time.Duration
	ConversionMaxConcurrency   int
}

// Load reads and validates Gateway configuration through getenv.
func Load(getenv func(string) string) (Config, error) {
	if getenv == nil {
		return Config{}, fmt.Errorf("getenv must not be nil")
	}

	listenAddr, err := loadListenAddr(getenv("LISTEN_ADDR"))
	if err != nil {
		return Config{}, err
	}
	appDomain, err := loadDomain("APP_DOMAIN", getenv("APP_DOMAIN"))
	if err != nil {
		return Config{}, err
	}
	apiDomain, err := loadDomain("API_DOMAIN", getenv("API_DOMAIN"))
	if err != nil {
		return Config{}, err
	}
	shortDomain, err := loadDomain("SHORT_DOMAIN", getenv("SHORT_DOMAIN"))
	if err != nil {
		return Config{}, err
	}
	if appDomain == apiDomain || appDomain == shortDomain || apiDomain == shortDomain {
		return Config{}, fmt.Errorf("APP_DOMAIN, API_DOMAIN, and SHORT_DOMAIN must be distinct")
	}

	apiURL, err := loadAPIURL(getenv("API_URL"))
	if err != nil {
		return Config{}, err
	}
	shortLinksEnabled, err := loadBoolean("SHORT_LINKS_ENABLED", getenv("SHORT_LINKS_ENABLED"), true)
	if err != nil {
		return Config{}, err
	}
	customBackendEnabled, err := loadBoolean("CUSTOM_BACKEND_ENABLED", getenv("CUSTOM_BACKEND_ENABLED"), true)
	if err != nil {
		return Config{}, err
	}
	trustedProxyCIDR, err := loadTrustedProxyCIDR(getenv("TRUSTED_PROXY_CIDR"))
	if err != nil {
		return Config{}, err
	}

	subConverterUpstream, err := loadHTTPURL("SUBCONVERTER_UPSTREAM", getenv("SUBCONVERTER_UPSTREAM"))
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		ListenAddr:           listenAddr,
		AppDomain:            appDomain,
		APIDomain:            apiDomain,
		ShortDomain:          shortDomain,
		APIURL:               apiURL,
		ShortLinksEnabled:    shortLinksEnabled,
		CustomBackendEnabled: customBackendEnabled,
		TrustedProxyCIDR:     trustedProxyCIDR,
		SubConverterUpstream: subConverterUpstream,
	}

	if shortLinksEnabled {
		redisURL, err := loadRedisURL(getenv("REDIS_URL"))
		if err != nil {
			return Config{}, err
		}
		ipHashSecret, err := loadIPHashSecret(getenv("IP_HASH_SECRET"))
		if err != nil {
			return Config{}, err
		}
		myURLsUpstream, err := loadHTTPURL("MYURLS_UPSTREAM", getenv("MYURLS_UPSTREAM"))
		if err != nil {
			return Config{}, err
		}
		redisPassword, err := required("REDIS_PASSWORD", getenv("REDIS_PASSWORD"))
		if err != nil {
			return Config{}, err
		}
		turnstileSiteKey, err := required("TURNSTILE_SITE_KEY", getenv("TURNSTILE_SITE_KEY"))
		if err != nil {
			return Config{}, err
		}
		turnstileSecretKey, err := required("TURNSTILE_SECRET_KEY", getenv("TURNSTILE_SECRET_KEY"))
		if err != nil {
			return Config{}, err
		}

		cfg.RedisURL = redisURL
		cfg.RedisPassword = redisPassword
		cfg.IPHashSecret = ipHashSecret
		cfg.TurnstileSiteKey = turnstileSiteKey
		cfg.TurnstileSecretKey = turnstileSecretKey
		cfg.MyURLsUpstream = myURLsUpstream
	}

	if cfg.ConversionRateLimit, err = loadPositiveInt(getenv, "CONVERSION_RATE_LIMIT", defaultConversionRateLimit, maxConversionRateLimit); err != nil {
		return Config{}, err
	}
	rateWindowSeconds, err := loadPositiveInt(getenv, "CONVERSION_RATE_WINDOW_SECONDS", defaultConversionRateWindowSeconds, maxConversionRateWindowSeconds)
	if err != nil {
		return Config{}, err
	}
	cfg.ConversionRateWindow = time.Duration(rateWindowSeconds) * time.Second

	maxRequestBytes, err := loadPositiveInt(getenv, "CONVERSION_MAX_REQUEST_BYTES", defaultMaxRequestBytes, maxRequestBytes)
	if err != nil {
		return Config{}, err
	}
	cfg.ConversionMaxRequestBytes = int64(maxRequestBytes)

	maxResponseBytes, err := loadPositiveInt(getenv, "CONVERSION_MAX_RESPONSE_BYTES", defaultMaxResponseBytes, maxResponseBytes)
	if err != nil {
		return Config{}, err
	}
	cfg.ConversionMaxResponseBytes = int64(maxResponseBytes)

	requestTimeoutMilliseconds, err := loadPositiveInt(getenv, "CONVERSION_REQUEST_TIMEOUT_MS", defaultRequestTimeoutMilliseconds, maxRequestTimeoutMilliseconds)
	if err != nil {
		return Config{}, err
	}
	cfg.ConversionRequestTimeout = time.Duration(requestTimeoutMilliseconds) * time.Millisecond

	dnsTimeoutMilliseconds, err := loadPositiveInt(getenv, "CONVERSION_DNS_TIMEOUT_MS", defaultDNSTimeoutMilliseconds, maxDNSTimeoutMilliseconds)
	if err != nil {
		return Config{}, err
	}
	cfg.ConversionDNSTimeout = time.Duration(dnsTimeoutMilliseconds) * time.Millisecond
	if cfg.ConversionDNSTimeout >= cfg.ConversionRequestTimeout {
		return Config{}, fmt.Errorf("CONVERSION_DNS_TIMEOUT_MS must be less than CONVERSION_REQUEST_TIMEOUT_MS")
	}

	connectTimeoutMilliseconds, err := loadPositiveInt(getenv, "CONVERSION_EGRESS_CONNECT_TIMEOUT_MS", defaultConnectTimeoutMilliseconds, maxConnectTimeoutMilliseconds)
	if err != nil {
		return Config{}, err
	}
	cfg.EgressConnectTimeout = time.Duration(connectTimeoutMilliseconds) * time.Millisecond
	if cfg.EgressConnectTimeout >= cfg.ConversionRequestTimeout {
		return Config{}, fmt.Errorf("CONVERSION_EGRESS_CONNECT_TIMEOUT_MS must be less than CONVERSION_REQUEST_TIMEOUT_MS")
	}

	if cfg.ConversionMaxConcurrency, err = loadPositiveInt(getenv, "CONVERSION_MAX_CONCURRENCY", defaultMaxConcurrency, maxConversionConcurrency); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func loadListenAddr(value string) (string, error) {
	if value == "" {
		return defaultListenAddr, nil
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil || host == "" {
		return "", fmt.Errorf("LISTEN_ADDR must be a host and port")
	}
	if err := validatePort(port); err != nil {
		return "", fmt.Errorf("LISTEN_ADDR %w", err)
	}
	return value, nil
}

func loadDomain(name, value string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	if !isValidHostname(value) {
		return "", fmt.Errorf("%s must be a hostname", name)
	}
	return strings.ToLower(value), nil
}

func isValidHostname(value string) bool {
	if len(value) > 253 || strings.HasSuffix(value, ".") {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if !(character >= 'a' && character <= 'z') && !(character >= 'A' && character <= 'Z') && !(character >= '0' && character <= '9') && character != '-' {
				return false
			}
		}
	}
	return true
}

func loadAPIURL(value string) (*url.URL, error) {
	parsed, err := loadURL("API_URL", value)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme == "https" {
		return parsed, nil
	}
	if parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()) {
		return parsed, nil
	}
	return nil, fmt.Errorf("API_URL must use HTTPS or loopback HTTP")
}

func loadHTTPURL(name, value string) (*url.URL, error) {
	parsed, err := loadURL(name, value)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("%s must be an HTTP(S) URL", name)
	}
	return parsed, nil
}

func loadRedisURL(value string) (string, error) {
	parsed, err := loadURL("REDIS_URL", value)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "redis" && parsed.Scheme != "rediss" {
		return "", fmt.Errorf("REDIS_URL must use redis or rediss")
	}
	return parsed.String(), nil
}

func loadURL(name, value string) (*url.URL, error) {
	if value == "" {
		return nil, fmt.Errorf("%s is required", name)
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Hostname() == "" {
		return nil, fmt.Errorf("%s must be a valid URL", name)
	}
	if _, err := netip.ParseAddr(parsed.Hostname()); err != nil && !isValidHostname(parsed.Hostname()) {
		return nil, fmt.Errorf("%s must be a valid URL", name)
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("%s must not contain userinfo", name)
	}
	if err := validateURLPort(parsed); err != nil {
		return nil, fmt.Errorf("%s %w", name, err)
	}
	return parsed, nil
}

func validateURLPort(parsed *url.URL) error {
	port := parsed.Port()
	if port == "" {
		if strings.HasSuffix(parsed.Host, ":") {
			return fmt.Errorf("contains an invalid port")
		}
		return nil
	}
	if err := validatePort(port); err != nil {
		return err
	}
	return nil
}

func validatePort(value string) error {
	if !isDecimal(value) {
		return fmt.Errorf("contains an invalid port")
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("contains an invalid port")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

func loadBoolean(name, value string, fallback bool) (bool, error) {
	if value == "" {
		return fallback, nil
	}
	switch value {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("%s must be true or false", name)
	}
}

func loadTrustedProxyCIDR(value string) (*net.IPNet, error) {
	if value == "" {
		return nil, nil
	}
	ip, cidr, err := net.ParseCIDR(value)
	if err != nil || !ip.Equal(cidr.IP) {
		return nil, fmt.Errorf("TRUSTED_PROXY_CIDR must be a network CIDR")
	}
	ones, bits := cidr.Mask.Size()
	if ones <= 0 || bits == 0 {
		return nil, fmt.Errorf("TRUSTED_PROXY_CIDR must not trust all addresses")
	}
	return cidr, nil
}

func loadIPHashSecret(value string) ([]byte, error) {
	if len(value) != 64 {
		return nil, fmt.Errorf("IP_HASH_SECRET must be a 64-character hexadecimal value")
	}
	secret, err := hex.DecodeString(value)
	if err != nil || len(secret) != 32 {
		return nil, fmt.Errorf("IP_HASH_SECRET must be a 64-character hexadecimal value")
	}
	return secret, nil
}

func loadPositiveInt(getenv func(string) string, name string, fallback, maximum int) (int, error) {
	value := getenv(name)
	if value == "" {
		return fallback, nil
	}
	if !isDecimal(value) {
		return 0, fmt.Errorf("%s must be a positive integer no greater than %d", name, maximum)
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 || parsed > maximum {
		return 0, fmt.Errorf("%s must be a positive integer no greater than %d", name, maximum)
	}
	return parsed, nil
}

func isDecimal(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return value != ""
}

func required(name, value string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}
