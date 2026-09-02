package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

const listenAddress = ":25500"

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--healthcheck" {
		response, err := (&http.Client{Timeout: time.Second}).Get("http://127.0.0.1" + listenAddress + "/healthz")
		if err != nil || response.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		_ = response.Body.Close()
		return
	}

	http.HandleFunc("/healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusOK)
	})
	http.HandleFunc("/sub", serveConversion)
	if err := http.ListenAndServe(listenAddress, nil); err != nil {
		panic(err)
	}
}

func serveConversion(response http.ResponseWriter, request *http.Request) {
	fixture := request.URL.Query().Get("url")
	switch {
	case strings.Contains(fixture, "fixture://slow"):
		time.Sleep(time.Second)
		response.Header().Set("Content-Type", "text/plain")
		_, _ = response.Write([]byte("slow"))
	case strings.Contains(fixture, "fixture://large"):
		response.Header().Set("Content-Type", "text/plain")
		_, _ = response.Write([]byte(strings.Repeat("x", 1025)))
	case strings.Contains(fixture, "fixture://echo"):
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]string{
			"authorization":       request.Header.Get("Authorization"),
			"cookie":              request.Header.Get("Cookie"),
			"origin":              request.Header.Get("Origin"),
			"forwarded":           request.Header.Get("Forwarded"),
			"proxy_authorization": request.Header.Get("Proxy-Authorization"),
			"x_forwarded_for":     request.Header.Get("X-Forwarded-For"),
			"x_real_ip":           request.Header.Get("X-Real-IP"),
		})
	default:
		http.Error(response, "unknown fixture case", http.StatusBadRequest)
	}
}
