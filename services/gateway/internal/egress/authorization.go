package egress

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/policy"
)

const (
	maxAuthorityLength       = 255
	maxAuthorizationTTL      = time.Minute
	maxAuthorizationDNSDelay = 30 * time.Second
	maxPendingAuthorizations = 4096
	maxAuthorizedAddresses   = 16
	authorizationTokenBytes  = 32
)

var (
	errInvalidAuthority      = errors.New("CONNECT authority is invalid")
	errInvalidAuthorization  = errors.New("CONNECT authorization is invalid")
	errAuthorizationExpired  = errors.New("CONNECT authorization has expired")
	errAuthorizationConsumed = errors.New("CONNECT authorization was already consumed")
)

// Authorization contains the addresses approved for one CONNECT attempt.
// Addresses are copied from the policy resolver result and must be dialed
// directly; the hostname is metadata for binding and logging only.
type Authorization struct {
	Token     string
	Hostname  string
	Port      uint16
	Addresses []netip.Addr
	ExpiresAt time.Time
}

// Authorizer validates a CONNECT authority and issues short-lived, one-time
// credentials that bind the authority to its already-resolved addresses.
type Authorizer interface {
	Authorize(ctx context.Context, authority string) (Authorization, error)
	Consume(token string, authority string) (Authorization, error)
}

// TokenAuthorizer is an in-memory one-time authorization store.
type authorizationEntry struct {
	authorization Authorization
	timer         *time.Timer
}

type TokenAuthorizer struct {
	resolver   policy.Resolver
	dnsTimeout time.Duration
	ttl        time.Duration
	now        func() time.Time

	mu     sync.Mutex
	tokens map[string]*authorizationEntry
}

// NewAuthorizer creates an authorizer that performs one bounded DNS lookup per
// authorization and retains the result until it is consumed or expires.
func NewAuthorizer(resolver policy.Resolver, dnsTimeout, ttl time.Duration) (*TokenAuthorizer, error) {
	if dnsTimeout <= 0 || dnsTimeout > maxAuthorizationDNSDelay || ttl <= 0 || ttl > maxAuthorizationTTL {
		return nil, errInvalidAuthorization
	}
	return &TokenAuthorizer{
		resolver:   resolver,
		dnsTimeout: dnsTimeout,
		ttl:        ttl,
		now:        time.Now,
		tokens:     make(map[string]*authorizationEntry),
	}, nil
}

// Authorize validates authority, resolves it once, and issues a random token.
func (authorizer *TokenAuthorizer) Authorize(ctx context.Context, authority string) (Authorization, error) {
	if authorizer == nil || ctx == nil {
		return Authorization{}, errInvalidAuthorization
	}
	if err := ctx.Err(); err != nil {
		return Authorization{}, err
	}
	hostname, port, canonical, err := parseAuthority(authority)
	if err != nil {
		return Authorization{}, policy.PolicyError{Code: "url_not_allowed", Status: 403}
	}

	lookupContext, cancel := context.WithTimeout(ctx, authorizer.dnsTimeout)
	defer cancel()
	target, err := policy.ValidateRemoteURL(lookupContext, "https://"+canonical, authorizer.resolver, policy.Options{})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return Authorization{}, ctxErr
		}
		return Authorization{}, err
	}
	if lookupErr := lookupContext.Err(); lookupErr != nil {
		return Authorization{}, lookupErr
	}
	if len(target.Addresses) == 0 {
		return Authorization{}, policy.PolicyError{Code: "private_address", Status: 403}
	}
	if len(target.Addresses) > maxAuthorizedAddresses {
		return Authorization{}, policy.PolicyError{Code: "too_many_addresses", Status: 403}
	}

	tokenBytes := make([]byte, authorizationTokenBytes)
	if _, err := rand.Read(tokenBytes); err != nil {
		return Authorization{}, errInvalidAuthorization
	}
	authorization := Authorization{
		Token:     hex.EncodeToString(tokenBytes),
		Hostname:  hostname,
		Port:      port,
		Addresses: append([]netip.Addr(nil), target.Addresses...),
		ExpiresAt: authorizer.now().Add(authorizer.ttl),
	}

	authorizer.mu.Lock()
	defer authorizer.mu.Unlock()
	authorizer.removeExpiredLocked(authorizer.now())
	if len(authorizer.tokens) >= maxPendingAuthorizations {
		return Authorization{}, Error{Code: "authorization_capacity", Status: 503}
	}
	entry := &authorizationEntry{authorization: cloneAuthorization(authorization)}
	authorizer.tokens[authorization.Token] = entry
	entry.timer = time.AfterFunc(authorizer.ttl, func() {
		authorizer.expire(authorization.Token, entry)
	})
	return cloneAuthorization(authorization), nil
}

// Consume validates and atomically consumes one token without performing DNS.
func (authorizer *TokenAuthorizer) Consume(token string, authority string) (Authorization, error) {
	if authorizer == nil || token == "" {
		return Authorization{}, errInvalidAuthorization
	}
	_, _, canonical, err := parseAuthority(authority)
	if err != nil {
		return Authorization{}, errInvalidAuthorization
	}

	authorizer.mu.Lock()
	defer authorizer.mu.Unlock()
	entry, ok := authorizer.tokens[token]
	if !ok {
		return Authorization{}, errAuthorizationConsumed
	}
	if !authorizer.now().Before(entry.authorization.ExpiresAt) {
		delete(authorizer.tokens, token)
		if entry.timer != nil {
			entry.timer.Stop()
		}
		return Authorization{}, errAuthorizationExpired
	}
	if canonical != canonicalAuthority(entry.authorization.Hostname, entry.authorization.Port) {
		return Authorization{}, errInvalidAuthority
	}
	delete(authorizer.tokens, token)
	if entry.timer != nil {
		entry.timer.Stop()
	}
	return cloneAuthorization(entry.authorization), nil
}

func (authorizer *TokenAuthorizer) removeExpiredLocked(now time.Time) {
	for token, entry := range authorizer.tokens {
		if !now.Before(entry.authorization.ExpiresAt) {
			delete(authorizer.tokens, token)
			if entry.timer != nil {
				entry.timer.Stop()
			}
		}
	}
}

func (authorizer *TokenAuthorizer) expire(token string, entry *authorizationEntry) {
	authorizer.mu.Lock()
	defer authorizer.mu.Unlock()
	if current, ok := authorizer.tokens[token]; ok && current == entry {
		delete(authorizer.tokens, token)
	}
}

func cloneAuthorization(authorization Authorization) Authorization {
	authorization.Addresses = append([]netip.Addr(nil), authorization.Addresses...)
	return authorization
}

func parseAuthority(authority string) (string, uint16, string, error) {
	if authority == "" || len(authority) > maxAuthorityLength || hasAuthorityControl(authority) {
		return "", 0, "", errInvalidAuthority
	}
	host, portText, err := net.SplitHostPort(authority)
	if err != nil || host == "" {
		return "", 0, "", errInvalidAuthority
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil || port != 443 {
		return "", 0, "", errInvalidAuthority
	}
	if strings.HasPrefix(authority, "[") {
		if !strings.HasSuffix(authority, "]:"+portText) || !strings.Contains(host, ":") {
			return "", 0, "", errInvalidAuthority
		}
	} else if strings.Contains(host, ":") || strings.ContainsAny(authority, "[]") {
		return "", 0, "", errInvalidAuthority
	}

	if address, parseErr := netip.ParseAddr(host); parseErr == nil {
		if address.Zone() != "" {
			return "", 0, "", errInvalidAuthority
		}
		host = address.String()
	} else if !isAuthorityHostname(host) {
		return "", 0, "", errInvalidAuthority
	} else {
		host = strings.ToLower(host)
	}
	return host, uint16(port), canonicalAuthority(host, uint16(port)), nil
}

func canonicalAuthority(hostname string, port uint16) string {
	return net.JoinHostPort(hostname, strconv.FormatUint(uint64(port), 10))
}

func hasAuthorityControl(value string) bool {
	for _, character := range value {
		if character <= 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

func isAuthorityHostname(value string) bool {
	if len(value) == 0 || len(value) > 253 || strings.HasSuffix(value, ".") {
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
