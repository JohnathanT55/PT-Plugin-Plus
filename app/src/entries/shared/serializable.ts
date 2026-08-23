/**
 * Convert message/UI values into plain IndexedDB-safe data. Runtime objects
 * such as Vue proxies, URL instances, class instances and function-valued
 * metadata must never cross the download-history persistence boundary.
 */
export function toPlainSerializable<T>(value: T): T {
  const json = JSON.stringify(value, (_key, nestedValue) => {
    if (["function", "symbol", "undefined"].includes(typeof nestedValue)) return undefined;
    if (typeof nestedValue === "bigint") return nestedValue.toString();
    return nestedValue;
  });
  if (json === undefined) throw new TypeError("Value cannot be serialized");
  return JSON.parse(json) as T;
}
