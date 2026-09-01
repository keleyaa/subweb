package main

import (
	"log"
	"os"

	"github.com/keleyaa/subweb/services/gateway/internal/config"
)

func main() {
	if _, err := config.Load(os.Getenv); err != nil {
		log.Fatal(err)
	}
}
