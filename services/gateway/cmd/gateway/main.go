package main

import (
	"context"
	"crypto/rand"
	"errors"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
	"github.com/keleyaa/subweb/services/gateway/internal/conversion"
	"github.com/keleyaa/subweb/services/gateway/internal/egress"
	"github.com/keleyaa/subweb/services/gateway/internal/httpapi"
	"github.com/keleyaa/subweb/services/gateway/internal/myurls"
	"github.com/keleyaa/subweb/services/gateway/internal/policy"
	"github.com/keleyaa/subweb/services/gateway/internal/privacy"
	"github.com/keleyaa/subweb/services/gateway/internal/ratelimit"
	"github.com/keleyaa/subweb/services/gateway/internal/runtimeconfig"
	"github.com/keleyaa/subweb/services/gateway/internal/staticfiles"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--healthcheck" {
		os.Exit(runHealthcheck())
	}

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}

	server, egressServer, closeResources, err := buildServers(cfg, slog.Default())
	if err != nil {
		log.Fatal(err)
	}
	defer closeResources()

	shutdownSignal, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErrors := make(chan error, 2)
	go serve(server, serverErrors)
	go serve(egressServer, serverErrors)

	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			shutdownServers(server, egressServer)
			log.Fatal(err)
		}
	case <-shutdownSignal.Done():
		if err := shutdownServers(server, egressServer); err != nil {
			log.Fatal(err)
		}
		for range 2 {
			if err := <-serverErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatal(err)
			}
		}
	}
}

func serve(server *http.Server, errors chan<- error) {
	errors <- server.ListenAndServe()
}

func runHealthcheck() int {
	request, err := http.NewRequest(http.MethodGet, "http://127.0.0.1:8080/healthz", nil)
	if err != nil {
		return 1
	}
	request.Host = os.Getenv("APP_DOMAIN")
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return 1
	}
	return 0
}

func buildServers(cfg config.Config, logger *slog.Logger) (*http.Server, *http.Server, func(), error) {
	resolver := net.DefaultResolver
	urlPolicy := gatewayURLPolicy{resolver: resolver, timeout: cfg.ConversionDNSTimeout}

	ipHasher, err := newIPHasher(cfg)
	if err != nil {
		return nil, nil, func() {}, err
	}
	counterStore, closeStore, err := newCounterStore(cfg)
	if err != nil {
		return nil, nil, func() {}, err
	}
	rateLimiter, err := ratelimit.NewRateLimiter(counterStore, int64(cfg.ConversionRateLimit), cfg.ConversionRateWindow)
	if err != nil {
		closeStore()
		return nil, nil, func() {}, err
	}
	semaphore, err := policy.NewSemaphore(cfg.ConversionMaxConcurrency)
	if err != nil {
		closeStore()
		return nil, nil, func() {}, err
	}

	internalTransport := http.DefaultTransport.(*http.Transport).Clone()
	internalTransport.Proxy = nil
	internalTransport.TLSHandshakeTimeout = cfg.EgressConnectTimeout
	converter := &conversion.Service{
		Policy:      urlPolicy,
		RateLimiter: rateLimiter,
		IPHasher:    ipHasher,
		Semaphore:   semaphore,
		Upstream:    cfg.SubConverterUpstream,
		Transport:   internalTransport,
		MaxRequest:  cfg.ConversionMaxRequestBytes,
		MaxResponse: cfg.ConversionMaxResponseBytes,
		Timeout:     cfg.ConversionRequestTimeout,
	}

	staticRoot := os.Getenv("STATIC_ROOT")
	if staticRoot == "" {
		staticRoot = "/app/dist"
	}
	static := staticfiles.New(staticRoot)
	runtime := runtimeconfig.New(cfg.APIURL.String(), cfg.ShortLinksEnabled, cfg.CustomBackendEnabled, cfg.TurnstileSiteKey)
	dependencies := httpapi.Dependencies{
		Converter:     converter,
		Static:        static,
		RuntimeConfig: runtime,
		Readiness:     readinessFunc(cfg, counterStore),
		Logger:        logger,
	}

	var authorizer *egress.TokenAuthorizer
	if authorizer, err = egress.NewAuthorizer(resolver, cfg.ConversionDNSTimeout, 30*time.Second); err != nil {
		closeStore()
		return nil, nil, func() {}, err
	}
	dialer, err := egress.NewDialer(cfg.EgressConnectTimeout)
	if err != nil {
		closeStore()
		return nil, nil, func() {}, err
	}
	egressServer := egress.NewProxyServer(cfg.EgressListenAddr, egress.NewProxy(authorizer, dialer))

	if cfg.ShortLinksEnabled {
		appClient := myurls.NewHTTPClientWithBodyLimit(cfg.MyURLsAppUpstream, internalTransport, cfg.ConversionMaxRequestBytes)
		shortClient := myurls.NewHTTPClientWithBodyLimit(cfg.MyURLsShortUpstream, internalTransport, cfg.ConversionMaxRequestBytes)
		dependencies.AppShortLinks = myurls.NewHandler(appClient, cfg.ConversionMaxRequestBytes)
		dependencies.ShortLinks = myurls.NewHandler(shortClient, cfg.ConversionMaxRequestBytes)
		dependencies.Readiness = readinessFunc(cfg, counterStore, appClient, shortClient)
	}
	server := httpapi.NewServer(cfg, dependencies)
	return server, egressServer, closeStore, nil
}

type gatewayURLPolicy struct {
	resolver policy.Resolver
	timeout  time.Duration
}

func (gatewayURLPolicy gatewayURLPolicy) AuthorizeURL(ctx context.Context, value string) (policy.DialTarget, error) {
	if ctx == nil {
		return policy.DialTarget{}, context.Canceled
	}
	lookupContext, cancel := context.WithTimeout(ctx, gatewayURLPolicy.timeout)
	defer cancel()
	return policy.ValidateRemoteURL(lookupContext, value, gatewayURLPolicy.resolver, policy.Options{})
}

func newIPHasher(cfg config.Config) (*privacy.IPHasher, error) {
	secret := cfg.IPHashSecret
	if len(secret) == 0 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return nil, errors.New("generate local IP hash secret")
		}
	}
	return privacy.NewIPHasher(secret)
}

func newCounterStore(cfg config.Config) (ratelimit.CounterStore, func(), error) {
	if !cfg.ShortLinksEnabled {
		return ratelimit.NewMemoryStore(), func() {}, nil
	}
	store, err := ratelimit.NewRedisStore(cfg.RedisURL, cfg.RedisPassword)
	if err != nil {
		return nil, func() {}, err
	}
	return store, func() { _ = store.Close() }, nil
}

const readinessTimeout = 5 * time.Second

type readinessStore interface {
	Ping(context.Context) error
}

func readinessFunc(cfg config.Config, store ratelimit.CounterStore, myURLsClients ...myurls.Client) func(context.Context) error {
	return func(ctx context.Context) error {
		if !cfg.ShortLinksEnabled {
			return nil
		}
		redisStore, ok := store.(readinessStore)
		if ctx == nil || !ok || len(myURLsClients) != 2 {
			return myurls.ErrUnavailable
		}
		checkContext, cancel := context.WithTimeout(ctx, readinessTimeout)
		defer cancel()
		if err := redisStore.Ping(checkContext); err != nil {
			return err
		}
		for _, client := range myURLsClients {
			if client == nil {
				return myurls.ErrUnavailable
			}
			if err := client.Health(checkContext); err != nil {
				return err
			}
		}
		return nil
	}
}

func shutdownServers(server, egressServer *http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	firstErr := server.Shutdown(ctx)
	if err := egressServer.Shutdown(ctx); firstErr == nil {
		firstErr = err
	}
	return firstErr
}
