export function formatTimestamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString();
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
