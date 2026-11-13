const RECOVERY_INTERVAL_MS = 1000;

// Immediate recovery at startup; later ticks cover missed wakes and due retries.
export function startOutboxRecovery(wake: () => Promise<void>): () => void {
  const timer = setInterval(() => { void wake(); }, RECOVERY_INTERVAL_MS);
  timer.unref(); // The timer alone must not keep a stopped server process alive.
  void wake();

  return () => { clearInterval(timer); };
}
