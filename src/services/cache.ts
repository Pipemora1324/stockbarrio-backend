// Small in-memory cache with expiry, used to avoid paying twice for identical questions asked seconds apart.
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: () => number,
    private readonly maxEntries = 200,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs() });
  }

  clear(): void {
    this.entries.clear();
  }
}
