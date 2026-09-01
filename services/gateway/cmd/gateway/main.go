package main

import (
	"errors"
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
	"github.com/keleyaa/subweb/services/gateway/internal/httpapi"
)

func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}

	server := httpapi.NewServer(cfg, httpapi.Dependencies{Logger: slog.Default()})
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
