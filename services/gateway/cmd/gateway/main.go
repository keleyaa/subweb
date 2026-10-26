package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
	"github.com/keleyaa/subweb/services/gateway/internal/conversion"
	"github.com/keleyaa/subweb/services/gateway/internal/egress"
	"github.com/keleyaa/subweb/services/gateway/internal/httpapi"
	"github.com/keleyaa/subweb/services/gateway/internal/linkstore"
	"github.com/keleyaa/subweb/services/gateway/internal/myurls"
	"github.com/keleyaa/subweb/services/gateway/internal/policy"
	"github.com/keleyaa/subweb/services/gateway/internal/privacy"
	"github.com/keleyaa/subweb/services/gateway/internal/ratelimit"
	"github.com/keleyaa/subweb/services/gateway/internal/runtimeconfig"
	"github.com/keleyaa/subweb/services/gateway/internal/staticfiles"
	"github.com/keleyaa/subweb/services/gateway/internal/turnstile"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--healthcheck" {
		os.Exit(runHealthcheck())
	}
	if len(os.Args) >= 2 && os.Args[1] == "--import-links" {
		os.Exit(runImportLinks(os.Args[2:]))
	}
	if len(os.Args) >= 2 && os.Args[1] == "--backup-links" {
		os.Exit(runBackupLinks(os.Args[2:]))
	}
	if len(os.Args) >= 2 && os.Args[1] == "--restore-links" {
		os.Exit(runRestoreLinks(os.Args[2:]))
	}
	if len(os.Args) >= 2 && os.Args[1] == "--verify-links" {
		os.Exit(runVerifyLinks(os.Args[2:]))
	}

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}

	logger := newLogger(cfg.LogLevel)
	logger.Info("gateway starting",
		"listen", cfg.ListenAddr,
		"egress_listen", cfg.EgressListenAddr,
		"restricted_egress_listen", cfg.EgressRestrictedListenAddr,
		"short_links_enabled", cfg.ShortLinksEnabled,
		"log_level", cfg.LogLevel,
	)

	servers, closeResources, err := buildServers(cfg, logger)
	if err != nil {
		log.Fatal(err)
	}
	defer closeResources()

	shutdownSignal, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErrors := make(chan error, len(servers.all))
	for _, server := range servers.all {
		go serve(server, serverErrors)
	}

	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			shutdownServers(servers.all...)
			log.Fatal(err)
		}
	case <-shutdownSignal.Done():
		if err := shutdownServers(servers.all...); err != nil {
			log.Fatal(err)
		}
		for range len(servers.all) {
			if err := <-serverErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatal(err)
			}
		}
	}
}

// newLogger builds the Gateway's structured logger. The configured level also
// gates the access log: warn or error keeps only failures and warnings.
func newLogger(level string) *slog.Logger {
	options := &slog.HandlerOptions{Level: slog.LevelInfo}
	switch level {
	case "debug":
		options.Level = slog.LevelDebug
	case "warn":
		options.Level = slog.LevelWarn
	case "error":
		options.Level = slog.LevelError
	}
	return slog.New(slog.NewTextHandler(os.Stderr, options))
}

func serve(server *http.Server, errors chan<- error) {
	errors <- server.ListenAndServe()
}

func runHealthcheck() int {
	egressAddress, err := egressHealthAddress(os.Getenv("EGRESS_LISTEN_ADDR"))
	if err != nil || checkEgressListener(egressAddress) != nil {
		return 1
	}
	if shortLinksEnabledForHealthcheck(os.Getenv("SHORT_LINKS_ENABLED")) {
		restrictedAddress, err := egressHealthAddressNamed(os.Getenv("EGRESS_RESTRICTED_LISTEN_ADDR"), defaultEgressRestrictedListenAddress)
		if err != nil || checkEgressListener(restrictedAddress) != nil {
			return 1
		}
	}

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

func egressHealthAddress(listenAddress string) (string, error) {
	return egressHealthAddressNamed(listenAddress, defaultEgressListenAddress)
}

func egressHealthAddressNamed(listenAddress, fallback string) (string, error) {
	if listenAddress == "" {
		listenAddress = fallback
	}
	_, port, err := net.SplitHostPort(listenAddress)
	if err != nil || port == "" {
		return "", errors.New("invalid egress listen address")
	}
	return net.JoinHostPort("127.0.0.1", port), nil
}

// shortLinksEnabledForHealthcheck mirrors the Gateway default: only the
// explicit "false" value runs the two-service profile without MyUrls.
func shortLinksEnabledForHealthcheck(value string) bool {
	return value != "false"
}

func checkEgressListener(address string) error {
	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		return err
	}
	return connection.Close()
}

// gatewayServers holds every listener the Gateway runs. The public API server is
// named separately from the full set so callers and tests never depend on the
// order servers were appended in.
type gatewayServers struct {
	public *http.Server
	all    []*http.Server
}

func buildServers(cfg config.Config, logger *slog.Logger) (gatewayServers, func(), error) {
	resolver := net.DefaultResolver
	urlPolicy := gatewayURLPolicy{resolver: resolver, timeout: cfg.ConversionDNSTimeout}

	ipHasher, err := newIPHasher(cfg)
	if err != nil {
		return gatewayServers{}, func() {}, err
	}
	counterStore, closeStore, err := newCounterStore(cfg)
	if err != nil {
		return gatewayServers{}, func() {}, err
	}
	rateLimiter, err := ratelimit.NewRateLimiter(counterStore, int64(cfg.ConversionRateLimit), cfg.ConversionRateWindow)
	if err != nil {
		closeStore()
		return gatewayServers{}, func() {}, err
	}
	semaphore, err := policy.NewSemaphore(cfg.ConversionMaxConcurrency)
	if err != nil {
		closeStore()
		return gatewayServers{}, func() {}, err
	}
	ipGate, err := policy.NewInFlightGate(cfg.ConversionMaxConcurrencyPerIP)
	if err != nil {
		closeStore()
		return gatewayServers{}, func() {}, err
	}

	internalTransport := http.DefaultTransport.(*http.Transport).Clone()
	internalTransport.Proxy = nil
	internalTransport.TLSHandshakeTimeout = cfg.EgressConnectTimeout
	converter := &conversion.Service{
		Policy:      urlPolicy,
		RateLimiter: rateLimiter,
		IPHasher:    ipHasher,
		Semaphore:   semaphore,
		IPGate:      ipGate,
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
	static := staticfiles.New(staticRoot, cfg.AppDomain)
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
		return gatewayServers{}, func() {}, err
	}
	dialer, err := egress.NewDialer(cfg.EgressConnectTimeout)
	if err != nil {
		closeStore()
		return gatewayServers{}, func() {}, err
	}
	servers := []*http.Server{
		egress.NewProxyServer(cfg.EgressListenAddr, egress.NewProxy(authorizer, dialer)),
	}

	if cfg.ShortLinksEnabled {
		client, closeLinks, readinessCounter := buildShortLinkClient(cfg, counterStore, internalTransport, ipHasher, urlPolicy)
		if client == nil {
			closeStore()
			return gatewayServers{}, func() {}, errors.New("configure short-link backend")
		}
		previousClose := closeStore
		closeStore = func() {
			closeLinks()
			previousClose()
		}
		dependencies.ShortLinks = myurls.NewHandler(client, cfg.ConversionMaxRequestBytes)
		dependencies.Readiness = readinessFunc(cfg, readinessCounter, client)

		restrictedProxy, err := egress.NewRestrictedProxy(authorizer, dialer, cfg.EgressAllowedHosts)
		if err != nil {
			closeStore()
			return gatewayServers{}, func() {}, err
		}
		servers = append(servers, egress.NewProxyServer(cfg.EgressRestrictedListenAddr, restrictedProxy))
	}
	public := httpapi.NewServer(cfg, dependencies)
	return gatewayServers{public: public, all: append(servers, public)}, closeStore, nil
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
	target, err := policy.ValidateRemoteURL(lookupContext, value, gatewayURLPolicy.resolver, policy.Options{})
	if err != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return policy.DialTarget{}, context.DeadlineExceeded
	}
	return target, err
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
	if !cfg.ShortLinksEnabled || cfg.EmbeddedShortLinks {
		return ratelimit.NewMemoryStore(), func() {}, nil
	}
	store, err := ratelimit.NewRedisStore(cfg.RedisURL, cfg.RedisPassword)
	if err != nil {
		return nil, func() {}, err
	}
	return store, func() { _ = store.Close() }, nil
}

// linkReadinessStore adds a store health probe to the embedded rate-limit counter.
type linkReadinessStore struct {
	ratelimit.CounterStore
	store *linkstore.SQLiteStore
}

// Ping reports whether the short-link database is reachable.
func (store linkReadinessStore) Ping(ctx context.Context) error {
	return store.store.Health(ctx)
}

// buildShortLinkClient selects the embedded SQLite backend or the legacy
// external MyUrls service. It returns a nil client when configuration is
// inconsistent so the caller can abort startup.
func buildShortLinkClient(
	cfg config.Config,
	counterStore ratelimit.CounterStore,
	transport http.RoundTripper,
	ipHasher *privacy.IPHasher,
	urlPolicy gatewayURLPolicy,
) (myurls.Client, func(), ratelimit.CounterStore) {
	if !cfg.EmbeddedShortLinks {
		client := myurls.NewHTTPClientWithBodyLimit(cfg.MyURLsUpstream, transport, cfg.ConversionMaxRequestBytes)
		return client, func() {}, counterStore
	}

	store, err := linkstore.OpenSQLite(cfg.ShortLinkDBPath)
	if err != nil {
		return nil, func() {}, counterStore
	}
	memory := ratelimit.NewMemoryStore()
	client, err := myurls.NewLocalClient(myurls.LocalOptions{
		Store:      store,
		PublicBase: &url.URL{Scheme: "https", Host: cfg.ShortDomain},
		TTL:        cfg.ShortLinkTTL,
		Limiter:    memory,
		IPHasher:   ipHasher,
		Challenge:  challengeVerifier(cfg),
		SiteKey:    cfg.TurnstileSiteKey,
		ValidateURL: func(ctx context.Context, value string) error {
			_, err := urlPolicy.AuthorizeURL(ctx, value)
			return err
		},
		CreateLimit:   cfg.ShortLinkCreateLimit,
		CreateWindow:  cfg.ShortLinkCreateWindow,
		DailyLimit:    cfg.ShortLinkDailyLimit,
		DailyWindow:   cfg.ShortLinkDailyWindow,
		ResolveLimit:  cfg.ShortLinkResolveLimit,
		ResolveWindow: cfg.ShortLinkResolveWindow,
	})
	if err != nil {
		_ = store.Close()
		return nil, func() {}, counterStore
	}

	stop := make(chan struct{})
	go cleanupLinks(store, stop)
	closeLinks := func() {
		close(stop)
		_ = store.Close()
	}
	return client, closeLinks, linkReadinessStore{CounterStore: memory, store: store}
}

// challengeVerifier returns nil when Turnstile is disabled.
func challengeVerifier(cfg config.Config) myurls.ChallengeVerifier {
	if !cfg.TurnstileEnabled {
		return nil
	}
	return turnstile.New(cfg.TurnstileSecretKey, cfg.AppDomain, cfg.TurnstileTimeout)
}

// cleanupLinks removes expired links on a low-frequency schedule.
func cleanupLinks(store *linkstore.SQLiteStore, stop <-chan struct{}) {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), readinessTimeout)
			_, _ = store.Cleanup(ctx, time.Now())
			cancel()
		}
	}
}

const readinessTimeout = 5 * time.Second
const defaultEgressListenAddress = "0.0.0.0:25502"
const defaultEgressRestrictedListenAddress = "0.0.0.0:25503"

type readinessStore interface {
	Ping(context.Context) error
}

func readinessFunc(cfg config.Config, store ratelimit.CounterStore, myURLsClients ...myurls.Client) func(context.Context) error {
	return func(ctx context.Context) error {
		if !cfg.ShortLinksEnabled {
			return nil
		}
		redisStore, ok := store.(readinessStore)
		if ctx == nil || !ok || len(myURLsClients) != 1 {
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

func shutdownServers(servers ...*http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var firstErr error
	for _, server := range servers {
		if err := server.Shutdown(ctx); firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// short-link import command
// importSummary reports the outcome of a short-link import.
type importSummary struct {
	scanned  int
	imported int
	skipped  int
	invalid  int
}

// runImportLinks imports Redis-exported short links into the SQLite store.
// Input is tab-separated: code, url, expiresAt (unix seconds, 0 = never).
func runImportLinks(args []string) int {
	flags := flag.NewFlagSet("import-links", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dbPath := flags.String("db", envOrDefault("SHORT_LINK_DB_PATH", "/data/links.db"), "SQLite database path")
	inputPath := flags.String("input", "-", "TSV input path, - for stdin")
	dryRun := flags.Bool("dry-run", false, "count without writing")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	reader, closeInput, err := openImportInput(*inputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "import-links: %v\n", err)
		return 1
	}
	defer closeInput()

	if *dryRun {
		summary, err := scanImport(reader)
		if err != nil {
			fmt.Fprintf(os.Stderr, "import-links: %v\n", err)
			return 1
		}
		printSummary(summary)
		return 0
	}

	store, err := linkstore.OpenSQLite(*dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "import-links: %v\n", err)
		return 1
	}
	defer func() { _ = store.Close() }()

	summary, err := importLinks(context.Background(), reader, store)
	if err != nil {
		fmt.Fprintf(os.Stderr, "import-links: %v\n", err)
		return 1
	}
	printSummary(summary)
	return 0
}

func openImportInput(path string) (io.Reader, func(), error) {
	if path == "-" {
		return os.Stdin, func() {}, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, func() {}, err
	}
	return file, func() { _ = file.Close() }, nil
}

func scanImport(reader io.Reader) (importSummary, error) {
	summary := importSummary{}
	err := eachImportRecord(reader, func(code, target string, expiresAt time.Time) {
		summary.scanned++
		if !importable(code, target) {
			summary.invalid++
			return
		}
		summary.imported++
	})
	return summary, err
}

func importLinks(ctx context.Context, reader io.Reader, store linkstore.Store) (importSummary, error) {
	summary := importSummary{}
	err := eachImportRecord(reader, func(code, target string, expiresAt time.Time) {
		summary.scanned++
		if !importable(code, target) {
			summary.invalid++
			return
		}
		_, err := store.Create(ctx, target, code, expiresAt)
		switch {
		case err == nil:
			summary.imported++
		case errors.Is(err, linkstore.ErrAliasUnavailable):
			summary.skipped++
		default:
			summary.invalid++
		}
	})
	return summary, err
}

func eachImportRecord(reader io.Reader, visit func(code, target string, expiresAt time.Time)) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	line := 0
	for scanner.Scan() {
		line++
		record := scanner.Text()
		if strings.TrimSpace(record) == "" {
			continue
		}
		fields := strings.Split(record, "\t")
		if len(fields) != 3 {
			return fmt.Errorf("line %d: expected 3 tab-separated fields", line)
		}
		expiresUnix, err := strconv.ParseInt(strings.TrimSpace(fields[2]), 10, 64)
		if err != nil || expiresUnix < 0 {
			return fmt.Errorf("line %d: invalid expiry", line)
		}
		expiresAt := time.Time{}
		if expiresUnix > 0 {
			expiresAt = time.Unix(expiresUnix, 0).UTC()
		}
		visit(strings.TrimSpace(fields[0]), strings.TrimSpace(fields[1]), expiresAt)
	}
	return scanner.Err()
}

func importable(code, target string) bool {
	return code != "" && target != ""
}

func printSummary(summary importSummary) {
	fmt.Printf("scanned=%d imported=%d skipped=%d invalid=%d\n",
		summary.scanned, summary.imported, summary.skipped, summary.invalid)
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

// runBackupLinks writes a consistent SQLite snapshot for host-side storage.
func runBackupLinks(args []string) int {
	flags := flag.NewFlagSet("backup-links", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dbPath := flags.String("db", envOrDefault("SHORT_LINK_DB_PATH", "/data/links.db"), "SQLite database path")
	outPath := flags.String("out", "", "snapshot output path")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *outPath == "" {
		fmt.Fprintln(os.Stderr, "backup-links: -out is required")
		return 2
	}

	ctx, cancel := context.WithTimeout(context.Background(), readinessTimeout)
	defer cancel()
	store, err := linkstore.OpenSQLite(*dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "backup-links: %v\n", err)
		return 1
	}
	defer func() { _ = store.Close() }()

	if err := store.Backup(ctx, *outPath); err != nil {
		fmt.Fprintf(os.Stderr, "backup-links: %v\n", err)
		return 1
	}
	total, err := store.Count(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "backup-links: %v\n", err)
		return 1
	}
	fmt.Printf("backup=ok links=%d\n", total)
	return 0
}

// runRestoreLinks replaces the database with a verified snapshot.
func runRestoreLinks(args []string) int {
	flags := flag.NewFlagSet("restore-links", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dbPath := flags.String("db", envOrDefault("SHORT_LINK_DB_PATH", "/data/links.db"), "SQLite database path")
	inPath := flags.String("in", "", "snapshot input path")
	confirmed := flags.Bool("confirm-stop-writes", false, "required acknowledgement that the Gateway is stopped")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if !*confirmed {
		fmt.Fprintln(os.Stderr, "restore-links: -confirm-stop-writes is required")
		return 2
	}
	if *inPath == "" {
		fmt.Fprintln(os.Stderr, "restore-links: -in is required")
		return 2
	}

	ctx, cancel := context.WithTimeout(context.Background(), readinessTimeout)
	defer cancel()
	source, err := linkstore.OpenSQLite(*inPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "restore-links: %v\n", err)
		return 1
	}
	expected, err := source.Count(ctx)
	_ = source.Close()
	if err != nil {
		fmt.Fprintf(os.Stderr, "restore-links: %v\n", err)
		return 1
	}

	if err := replaceSQLiteFile(*inPath, *dbPath); err != nil {
		fmt.Fprintf(os.Stderr, "restore-links: %v\n", err)
		return 1
	}

	restored, err := linkstore.OpenSQLite(*dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "restore-links: %v\n", err)
		return 1
	}
	total, err := restored.Count(ctx)
	_ = restored.Close()
	if err != nil {
		fmt.Fprintf(os.Stderr, "restore-links: %v\n", err)
		return 1
	}
	if total != expected {
		fmt.Fprintf(os.Stderr, "restore-links: restored %d links, expected %d\n", total, expected)
		return 1
	}
	fmt.Printf("restore=ok links=%d\n", total)
	return 0
}

// replaceSQLiteFile atomically installs a snapshot and drops stale WAL files.
func replaceSQLiteFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()

	temporary, err := os.CreateTemp(filepath.Dir(destination), ".links-restore-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	if _, err := io.Copy(temporary, input); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if err := os.Remove(destination + suffix); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return os.Rename(temporaryPath, destination)
}

// runVerifyLinks checks a SQLite snapshot without modifying it.
func runVerifyLinks(args []string) int {
	flags := flag.NewFlagSet("verify-links", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dbPath := flags.String("db", envOrDefault("SHORT_LINK_DB_PATH", "/data/links.db"), "SQLite database path")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	ctx, cancel := context.WithTimeout(context.Background(), readinessTimeout)
	defer cancel()
	store, err := linkstore.OpenSQLite(*dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "verify-links: %v\n", err)
		return 1
	}
	defer func() { _ = store.Close() }()

	if err := store.Integrity(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "verify-links: %v\n", err)
		return 1
	}
	total, err := store.Count(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "verify-links: %v\n", err)
		return 1
	}
	fmt.Printf("verify=ok links=%d\n", total)
	return 0
}
