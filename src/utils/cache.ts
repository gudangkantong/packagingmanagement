/**
 * Simple localStorage cache with TTL
 * Untuk mengurangi Firestore reads pada data yang jarang berubah
 */

const CACHE_PREFIX = "smb_cache_";
const DEFAULT_TTL = 12 * 60 * 60 * 1000; // 12 jam

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Ambil data dari cache. Return null kalau expired atau tidak ada.
 */
export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > entry.ttl) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Simpan data ke cache dengan TTL
 */
export function setCache<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage penuh atau unavailable, skip saja
  }
}

/**
 * Hapus satu item cache
 */
export function removeCache(key: string): void {
  localStorage.removeItem(CACHE_PREFIX + key);
}

/**
 * Hapus semua cache app ini
 */
export function clearAllCache(): void {
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (key.startsWith(CACHE_PREFIX)) {
      localStorage.removeItem(key);
    }
  });
}

/**
 * Cek apakah cache masih valid (ada & belum expired)
 */
export function isCacheValid(key: string): boolean {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return false;
    const entry: CacheEntry<unknown> = JSON.parse(raw);
    return Date.now() - entry.timestamp <= entry.ttl;
  } catch {
    return false;
  }
}
