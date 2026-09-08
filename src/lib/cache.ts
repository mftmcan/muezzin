/**
 * SizeLimitedCache
 * A lightweight bounded memory cache with a FIFO eviction strategy
 * to prevent memory leaks in long-running PWA client sessions.
 */
export class SizeLimitedCache<K, V> {
  private map = new Map<K, V>();
  private keyQueue: K[] = [];

  constructor(private maxSize: number = 50) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (!this.map.has(key)) {
      this.keyQueue.push(key);
      if (this.keyQueue.length > this.maxSize) {
        const oldestKey = this.keyQueue.shift();
        if (oldestKey !== undefined) {
          this.map.delete(oldestKey);
        }
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    this.keyQueue = this.keyQueue.filter((k) => k !== key);
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.keyQueue = [];
  }
}
