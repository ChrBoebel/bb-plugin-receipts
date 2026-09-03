import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** On-disk cache root for the Receipts plugin. */
export const RECEIPTS_DATA_DIR = NodePath.join(
  NodeOS.homedir(),
  ".bb",
  "plugins",
  "receipts",
);

/** Parsed transcript records, keyed by file path (size + mtime validated). */
export const SCAN_CACHE_FILE = "scan-cache.json";

/** Aggregated 90-day base summary (buckets + sessions) for instant window slices. */
export const BASE_CACHE_FILE = "base-cache.json";

/** Cached LiteLLM model rate table. */
export const RATES_CACHE_FILE = "model-rates.json";

export function receiptsDataPath(
  fileName: string,
  dataDir = RECEIPTS_DATA_DIR,
): string {
  return NodePath.join(dataDir, fileName);
}
