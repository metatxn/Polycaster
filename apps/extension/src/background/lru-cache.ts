export class LRUCache<K, V> {
  private readonly max: number;
  private readonly cache: Map<K, V>;

  constructor(max: number) {
    this.max = max;
    this.cache = new Map();
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value === undefined) return undefined;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, value);
  }
}
