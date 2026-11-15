// Recover saved events once at startup; the relayer schedules any pending retries.
export function startOutboxRecovery(wake: () => Promise<void>): void {
  void wake();
}
