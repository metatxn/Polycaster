export function backoffDelayMs(
  attempt: number,
  options: { baseMs: number; factor?: number; capMs: number }
): number {
  const factor = options.factor ?? 2;
  return Math.min(
    options.baseMs * factor ** Math.max(0, attempt),
    options.capMs
  );
}
