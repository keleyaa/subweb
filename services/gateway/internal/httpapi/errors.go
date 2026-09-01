package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

// Problem is the stable error response returned by Gateway HTTP handlers.
type Problem struct {
	Type              string `json:"type"`
	Title             string `json:"title"`
	Status            int    `json:"status"`
	Code              string `json:"code"`
	RequestID         string `json:"requestId"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
	Challenge         any    `json:"challenge,omitempty"`
}

// Error allows a Problem to be returned through standard error paths.
func (problem Problem) Error() string {
	return problem.Code
}

// WriteProblem writes a sanitized RFC 9457-compatible problem response.
func WriteProblem(w http.ResponseWriter, requestID string, err error) {
	problem := Problem{
		Type:      "about:blank",
		Title:     http.StatusText(http.StatusInternalServerError),
		Status:    http.StatusInternalServerError,
		Code:      "internal_error",
		RequestID: requestID,
	}

	var value Problem
	if errors.As(err, &value) {
		problem = value
	} else {
		var pointer *Problem
		if errors.As(err, &pointer) && pointer != nil {
			problem = *pointer
		}
	}
	problem = normalizeProblem(problem, requestID)
	body, marshalErr := json.Marshal(problem)
	if marshalErr != nil {
		problem = normalizeProblem(Problem{
			Type:   "about:blank",
			Title:  http.StatusText(http.StatusInternalServerError),
			Status: http.StatusInternalServerError,
			Code:   "internal_error",
		}, requestID)
		body, marshalErr = json.Marshal(problem)
		if marshalErr != nil {
			body = []byte(`{"type":"about:blank","title":"Internal Server Error","status":500,"code":"internal_error","requestId":""}`)
		}
	}

	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Request-ID", requestID)
	if problem.RetryAfterSeconds > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(problem.RetryAfterSeconds))
	} else {
		w.Header().Del("Retry-After")
	}
	w.WriteHeader(problem.Status)
	_, _ = w.Write(body)
}

func normalizeProblem(problem Problem, requestID string) Problem {
	if problem.Type == "" {
		problem.Type = "about:blank"
	}
	if problem.Status < http.StatusBadRequest || problem.Status > 599 {
		problem.Status = http.StatusInternalServerError
	}
	if problem.Title == "" {
		problem.Title = http.StatusText(problem.Status)
	}
	if problem.Code == "" {
		problem.Code = "internal_error"
	}
	if problem.RetryAfterSeconds < 1 {
		problem.RetryAfterSeconds = 0
	}
	problem.RequestID = requestID
	return problem
}
