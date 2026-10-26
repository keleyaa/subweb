package turnstile

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestVerifierAcceptsValidToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := request.ParseForm(); err != nil {
			t.Fatalf("ParseForm() error = %v", err)
		}
		if request.Form.Get("secret") != "secret" || request.Form.Get("response") != "token" {
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"hostname":"app.example"}`))
	}))
	defer server.Close()

	verifier := New("secret", "app.example", time.Second)
	verifier.Endpoint = server.URL
	if err := verifier.Verify(context.Background(), "token", "203.0.113.10"); err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
}

func TestVerifierRejectsFailedChallenge(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":false,"error-codes":["invalid-input-response"]}`))
	}))
	defer server.Close()

	verifier := New("secret", "app.example", time.Second)
	verifier.Endpoint = server.URL
	if err := verifier.Verify(context.Background(), "token", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Verify() error = %v, want ErrInvalid", err)
	}
}

func TestVerifierRejectsHostnameMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"hostname":"other.example"}`))
	}))
	defer server.Close()

	verifier := New("secret", "app.example", time.Second)
	verifier.Endpoint = server.URL
	if err := verifier.Verify(context.Background(), "token", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Verify() error = %v, want ErrInvalid", err)
	}
}

func TestVerifierFailsClosed(t *testing.T) {
	if err := New("", "", time.Second).Verify(context.Background(), "token", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty secret Verify() error = %v", err)
	}
	if err := New("secret", "", time.Second).Verify(context.Background(), "", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty token Verify() error = %v", err)
	}
	verifier := New("secret", "", time.Second)
	verifier.Endpoint = "http://127.0.0.1:1/siteverify"
	if err := verifier.Verify(context.Background(), "token", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unreachable endpoint Verify() error = %v", err)
	}
}
