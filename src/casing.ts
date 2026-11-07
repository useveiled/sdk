/**
 * Key renaming between the two naming styles in play. JSON on the wire uses
 * snake_case, while TypeScript callers work with camelCase. Outgoing bodies
 * and query strings get snake_case keys; parsed responses get camelCase keys.
 * Only arrays and plain objects are walked recursively. Values themselves,
 * along with class instances such as `Date`, are returned as they are.
 */

function toSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function transformKeys(value: unknown, mapKey: (key: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformKeys(item, mapKey));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[mapKey(key)] = transformKeys(val, mapKey);
    }
    return result;
  }
  return value;
}

/** Returns a deep copy of `value` with every object key rewritten from camelCase to snake_case. */
export function snakeifyKeys<T = unknown>(value: unknown): T {
  return transformKeys(value, toSnakeKey) as T;
}

/** Returns a deep copy of `value` with every object key rewritten from snake_case to camelCase. */
export function camelizeKeys<T = unknown>(value: unknown): T {
  return transformKeys(value, toCamelKey) as T;
}
