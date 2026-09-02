package egress

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/policy"
)

const maxDialTimeout = 30 * time.Second

// Error is a sanitized egress failure with a stable code and HTTP status.
type Error struct {
	Code   string
	Status int
}

func (err Error) Error() string { return err.Code }

type dialContextFunc func(context.Context, string, string) (net.Conn, error)

// Dialer connects only to addresses carried by an Authorization. It never
// passes the authorization hostname to the network resolver.
type Dialer struct {
	timeout     time.Duration
	dialContext dialContextFunc
}

// NewDialer creates a fixed-address dialer with a bounded per-attempt timeout.
func NewDialer(timeout time.Duration) (*Dialer, error) {
	if timeout <= 0 || timeout > maxDialTimeout {
		return nil, errors.New("egress dial timeout is invalid")
	}
	return newDialer(timeout, (&net.Dialer{Timeout: timeout}).DialContext), nil
}

func newDialer(timeout time.Duration, dialContext dialContextFunc) *Dialer {
	return &Dialer{timeout: timeout, dialContext: dialContext}
}

// DialContext tries each verified address and returns a sanitized failure if
// none can be connected. Parent cancellation always wins over connection errors.
func (dialer *Dialer) DialContext(ctx context.Context, authorization Authorization) (net.Conn, error) {
	if dialer == nil || dialer.dialContext == nil || dialer.timeout <= 0 || dialer.timeout > maxDialTimeout {
		return nil, Error{Code: "egress_unavailable", Status: 502}
	}
	if ctx == nil {
		return nil, context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !authorizationIsValid(authorization) {
		return nil, Error{Code: "authorization_invalid", Status: 403}
	}

	overallTimeout := dialer.timeout
	if remaining := time.Until(authorization.ExpiresAt); remaining < overallTimeout {
		overallTimeout = remaining
	}
	if overallTimeout <= 0 {
		return nil, Error{Code: "authorization_expired", Status: 403}
	}
	overallContext, cancel := context.WithTimeout(ctx, overallTimeout)
	defer cancel()
	var timedOut bool

	for _, address := range authorization.Addresses {
		if err := overallContext.Err(); err != nil {
			return nil, dialDeadlineError(ctx, authorization, err)
		}
		connection, err := dialer.dialContext(overallContext, "tcp", net.JoinHostPort(address.String(), strconv.Itoa(int(authorization.Port))))
		if err == nil && connection != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				_ = connection.Close()
				return nil, ctxErr
			}
			if !time.Now().Before(authorization.ExpiresAt) {
				_ = connection.Close()
				return nil, Error{Code: "authorization_expired", Status: 403}
			}
			return connection, nil
		}
		if connection != nil {
			_ = connection.Close()
		}
		if err == nil {
			err = errors.New("dial returned nil connection")
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		if errors.Is(err, context.DeadlineExceeded) || isTimeoutError(err) {
			timedOut = true
		}
		if deadlineErr := overallContext.Err(); deadlineErr != nil {
			return nil, dialDeadlineError(ctx, authorization, deadlineErr)
		}
	}
	if timedOut {
		return nil, Error{Code: "egress_timeout", Status: 504}
	}
	return nil, Error{Code: "egress_unavailable", Status: 502}
}

func dialDeadlineError(ctx context.Context, authorization Authorization, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if !time.Now().Before(authorization.ExpiresAt) {
		return Error{Code: "authorization_expired", Status: 403}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return Error{Code: "egress_timeout", Status: 504}
	}
	return Error{Code: "egress_unavailable", Status: 502}
}

func authorizationIsValid(authorization Authorization) bool {
	if authorization.Token == "" || authorization.Port != 443 || authorization.Hostname == "" || !time.Now().Before(authorization.ExpiresAt) || len(authorization.Addresses) == 0 {
		return false
	}
	for _, address := range authorization.Addresses {
		if !isPublicUnicast(address) {
			return false
		}
	}
	return true
}

func isTimeoutError(err error) bool {
	var networkError net.Error
	return errors.As(err, &networkError) && networkError.Timeout()
}

func isPublicUnicast(address netip.Addr) bool {
	if !address.IsValid() {
		return false
	}
	_, err := policy.ValidateRemoteURL(
		context.Background(),
		"https://"+net.JoinHostPort(address.String(), "443"),
		nil,
		policy.Options{},
	)
	return err == nil
}
