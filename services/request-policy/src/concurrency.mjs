export const createConcurrencyLimiter = (maxConcurrency) => {
  let active = 0;

  return {
    tryAcquire() {
      if (active >= maxConcurrency) return false;
      active += 1;
      return true;
    },
    release() {
      active = Math.max(0, active - 1);
    },
    activeCount() {
      return active;
    },
  };
};

export const createCircuitBreaker = ({ failureThreshold = 5, cooldownMs = 30_000 } = {}) => {
  let failures = 0;
  let openedAt = 0;

  return {
    beforeRequest(now = Date.now()) {
      if (openedAt === 0) return true;
      if (now - openedAt >= cooldownMs) {
        openedAt = 0;
        failures = 0;
        return true;
      }
      return false;
    },
    recordSuccess() {
      failures = 0;
      openedAt = 0;
    },
    recordFailure(now = Date.now()) {
      failures += 1;
      if (failures >= failureThreshold) openedAt = now;
    },
    isOpen(now = Date.now()) {
      return openedAt !== 0 && now - openedAt < cooldownMs;
    },
  };
};
