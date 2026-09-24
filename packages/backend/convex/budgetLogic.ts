export function periodAt(utcMilliseconds: number) {
  return new Date(utcMilliseconds).toISOString().slice(0, 7);
}

export function nanosForUsd(dollars: number) {
  if (!Number.isFinite(dollars) || dollars < 0) throw new Error("Invalid dollar amount.");
  return Math.round(dollars * 1_000_000_000);
}

export function estimateNanos(
  inputTokens: number,
  outputTokens: number,
  price: { input: number; output: number },
) {
  return Math.ceil((inputTokens * price.input + outputTokens * price.output) * 1000);
}

export function canReserve(
  account: { spentNanos: number; reservedNanos: number; increaseNanos: number },
  capNanos: number,
  requestedNanos: number,
) {
  return (
    account.spentNanos + account.reservedNanos + requestedNanos <= capNanos + account.increaseNanos
  );
}

export function tokenCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const structured = value as { total?: unknown; text?: unknown };
    return tokenCount(structured.total ?? structured.text);
  }
  return 0;
}
