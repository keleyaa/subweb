package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteProblemWritesConfiguredProblem(t *testing.T) {
	recorder := httptest.NewRecorder()

	WriteProblem(recorder, "req_123", Problem{
		Type:              "about:blank",
		Title:             "Request rejected",
		Status:            http.StatusUnprocessableEntity,
		Code:              "url_not_allowed",
		RetryAfterSeconds: 30,
		Challenge: map[string]string{
			"provider": "turnstile",
			"siteKey":  "site-key",
		},
	})

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusUnprocessableEntity)
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", contentType)
	}
	if requestID := response.Header.Get("X-Request-ID"); requestID != "req_123" {
		t.Fatalf("X-Request-ID = %q, want req_123", requestID)
	}

	var problem Problem
	if err := json.NewDecoder(response.Body).Decode(&problem); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if problem.Type != "about:blank" || problem.Title != "Request rejected" || problem.Status != http.StatusUnprocessableEntity || problem.Code != "url_not_allowed" || problem.RequestID != "req_123" {
		t.Fatalf("problem = %#v, want configured problem with request ID", problem)
	}
	if problem.RetryAfterSeconds != 30 {
		t.Fatalf("RetryAfterSeconds = %d, want 30", problem.RetryAfterSeconds)
	}
	challenge, ok := problem.Challenge.(map[string]any)
	if !ok || challenge["provider"] != "turnstile" || challenge["siteKey"] != "site-key" {
		t.Fatalf("Challenge = %#v, want Turnstile challenge", problem.Challenge)
	}
}

func TestWriteProblemDoesNotExposeInternalError(t *testing.T) {
	recorder := httptest.NewRecorder()

	WriteProblem(recorder, "req_safe", errors.New("redis://user:super-secret@redis:6379/1 unavailable"))

	response := recorder.Result()
	defer response.Body.Close()

	var problem map[string]any
	if err := json.NewDecoder(response.Body).Decode(&problem); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusInternalServerError)
	}
	if problem["code"] != "internal_error" {
		t.Fatalf("code = %#v, want internal_error", problem["code"])
	}
	if problem["requestId"] != "req_safe" {
		t.Fatalf("requestId = %#v, want req_safe", problem["requestId"])
	}
	if body := recorder.Body.String(); body == "" || strings.Contains(body, "super-secret") || strings.Contains(body, "redis://") {
		t.Fatalf("response body leaked internal error: %q", body)
	}
}
