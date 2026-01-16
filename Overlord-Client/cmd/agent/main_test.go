package main

import (
	"testing"
	"time"

	rt "overlord-client/cmd/agent/runtime"
)

func TestMinDuration(t *testing.T) {
	if got := rt.MinDuration(1*time.Second, 5*time.Second); got != 1*time.Second {
		t.Fatalf("expected shorter duration returned, got %s", got)
	}
	if got := rt.MinDuration(5*time.Second, 1*time.Second); got != 1*time.Second {
		t.Fatalf("expected shorter duration returned, got %s", got)
	}
}
