package policy

import "testing"

func TestInFlightGateRejectsInvalidCapacity(t *testing.T) {
	for _, limit := range []int{0, -1, maxInFlightGateCapacity + 1} {
		if _, err := NewInFlightGate(limit); err == nil {
			t.Fatalf("NewInFlightGate(%d) error = nil, want invalid capacity error", limit)
		}
	}
}

func TestInFlightGateLimitsEachKeyIndependently(t *testing.T) {
	gate, err := NewInFlightGate(2)
	if err != nil {
		t.Fatal(err)
	}

	first, ok := gate.TryAcquire("key-a")
	if !ok {
		t.Fatal("first acquire = false, want true")
	}
	if _, ok := gate.TryAcquire("key-a"); !ok {
		t.Fatal("second acquire = false, want true")
	}
	if _, ok := gate.TryAcquire("key-a"); ok {
		t.Fatal("third acquire = true, want false once the key reaches its limit")
	}
	if _, ok := gate.TryAcquire("key-b"); !ok {
		t.Fatal("independent key acquire = false, want true")
	}

	first()
	if _, ok := gate.TryAcquire("key-a"); !ok {
		t.Fatal("acquire after release = false, want true")
	}
}

func TestInFlightGateReleaseIsIdempotentAndDropsIdleKeys(t *testing.T) {
	gate, err := NewInFlightGate(1)
	if err != nil {
		t.Fatal(err)
	}

	release, ok := gate.TryAcquire("key-a")
	if !ok {
		t.Fatal("acquire = false, want true")
	}
	if gate.trackedKeys() != 1 {
		t.Fatalf("tracked keys = %d, want 1", gate.trackedKeys())
	}

	release()
	release()
	if gate.trackedKeys() != 0 {
		t.Fatalf("tracked keys after release = %d, want 0", gate.trackedKeys())
	}
	if _, ok := gate.TryAcquire("key-a"); !ok {
		t.Fatal("acquire after idempotent release = false, want true")
	}
}

func TestInFlightGateRejectsEmptyKeyAndNilGate(t *testing.T) {
	gate, err := NewInFlightGate(1)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := gate.TryAcquire(""); ok {
		t.Fatal("empty key acquire = true, want false")
	}

	var nilGate *InFlightGate
	if _, ok := nilGate.TryAcquire("key-a"); ok {
		t.Fatal("nil gate acquire = true, want false")
	}
}
