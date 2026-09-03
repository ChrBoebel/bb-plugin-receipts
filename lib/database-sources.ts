import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { localDayEndMs, localDayStartMs } from "./format";
import type { UsageProviderKind, UsageRecord, UsageSource } from "./types";

export interface UsageDatabaseResult {
  records: UsageRecord[];
  source: UsageSource;
  file: {
    path: string;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
  } | null;
}

interface HermesRow {
  id: unknown;
  model: unknown;
  started_at: unknown;
  cwd: unknown;
  input_tokens: unknown;
  output_tokens: unknown;
  cache_read_tokens: unknown;
  cache_write_tokens: unknown;
  reasoning_tokens: unknown;
  actual_cost_usd: unknown;
  estimated_cost_usd: unknown;
  cost_status: unknown;
  billing_provider: unknown;
}

interface OpenCodeRow {
  id: unknown;
  model: unknown;
  directory: unknown;
  cost: unknown;
  tokens_input: unknown;
  tokens_output: unknown;
  tokens_reasoning: unknown;
  tokens_cache_read: unknown;
  tokens_cache_write: unknown;
  time_created: unknown;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function finiteCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function defaultHermesPath(): string {
  const configured = process.env.HERMES_STATE_DB?.trim();
  return configured || NodePath.join(NodeOS.homedir(), ".hermes", "state.db");
}

function defaultOpenCodePath(): string {
  const configured = process.env.OPENCODE_DATABASE_PATH?.trim();
  if (configured) return configured;
  const dataHome =
    process.env.XDG_DATA_HOME?.trim() ||
    NodePath.join(NodeOS.homedir(), ".local", "share");
  return NodePath.join(dataHome, "opencode", "opencode.db");
}

async function statDatabase(path: string): Promise<UsageDatabaseResult["file"]> {
  try {
    const stats = await NodeFS.stat(path);
    if (!stats.isFile()) return null;
    return {
      path,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
    };
  } catch {
    return null;
  }
}

function sourceResult(
  provider: UsageProviderKind,
  path: string,
  records: UsageRecord[],
  file: UsageDatabaseResult["file"],
  message: string | null = null,
): UsageDatabaseResult {
  return {
    records,
    file,
    source: {
      provider,
      path,
      status: file === null ? "missing" : message === null ? "ok" : "failed",
      scannedFiles: file === null || message !== null ? 0 : 1,
      skippedFiles: message === null ? 0 : 1,
      distinctSessions: new Set(records.map((record) => record.sessionId)).size,
      message,
    },
  };
}

async function queryRows<T extends object>(
  databasePath: string,
  sql: string,
  ...parameters: Array<string | number>
): Promise<T[]> {
  // Keep node:sqlite optional at module load time for older bb hosts.
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout = 1000");
    return database.prepare(sql).all(...parameters) as T[];
  } finally {
    database.close();
  }
}

function safeDatabaseMessage(provider: string, error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const upper = text.toUpperCase();
  if (upper.includes("SQLITE_BUSY") || upper.includes("SQLITE_LOCKED")) {
    return `${provider} usage database is busy; try refreshing again.`;
  }
  if (upper.includes("SQLITE_NOTADB")) {
    return `${provider} usage database is not a valid SQLite database.`;
  }
  return `${provider} usage database could not be read.`;
}

export async function readHermesUsage(options: {
  sinceDay: string;
  untilDay: string;
  timeZone: string;
  databasePath?: string;
}): Promise<UsageDatabaseResult> {
  const databasePath = options.databasePath?.trim() || defaultHermesPath();
  const file = await statDatabase(databasePath);
  if (file === null) return sourceResult("hermes", databasePath, [], null);

  try {
    const rows = await queryRows<HermesRow>(
      databasePath,
      `SELECT id, model, started_at, cwd,
              input_tokens, output_tokens, cache_read_tokens,
              cache_write_tokens, reasoning_tokens,
              actual_cost_usd, estimated_cost_usd, cost_status,
              billing_provider
         FROM sessions
        WHERE started_at >= ? AND started_at <= ?`,
      localDayStartMs(options.sinceDay, options.timeZone) / 1_000,
      localDayEndMs(options.untilDay, options.timeZone) / 1_000,
    );
    const records = rows.map((row): UsageRecord => {
      const model = stringValue(row.model) || "unknown";
      const billingProvider = stringValue(row.billing_provider);
      const displayModel = billingProvider ? `${billingProvider}/${model}` : model;
      const outputTokens = finiteNonNegative(row.output_tokens);
      const actual = finiteCost(row.actual_cost_usd);
      const estimated = finiteCost(row.estimated_cost_usd);
      const included = row.cost_status === "included";
      return {
        provider: "hermes",
        timestampMs: finiteNonNegative(row.started_at) * 1_000,
        model: displayModel,
        sessionId: stringValue(row.id),
        projectPath: stringValue(row.cwd),
        totals: {
          uncachedInputTokens: finiteNonNegative(row.input_tokens),
          cachedInputTokens: finiteNonNegative(row.cache_read_tokens),
          cacheCreationTokens: finiteNonNegative(row.cache_write_tokens),
          outputTokens,
          reasoningTokens: Math.min(
            finiteNonNegative(row.reasoning_tokens),
            outputTokens,
          ),
        },
        reportedCostUsd: actual ?? estimated ?? (included ? 0 : null),
        dedupeKey: stringValue(row.id) || null,
      };
    });
    return sourceResult("hermes", databasePath, records, file);
  } catch (error) {
    return sourceResult(
      "hermes",
      databasePath,
      [],
      file,
      safeDatabaseMessage("Hermes", error),
    );
  }
}

function openCodeModel(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  try {
    const parsed = JSON.parse(value) as { id?: unknown; providerID?: unknown };
    const id = stringValue(parsed.id);
    const provider = stringValue(parsed.providerID);
    if (id && provider) return `${provider}/${id}`;
    return id || value;
  } catch {
    return value;
  }
}

export async function readOpenCodeUsage(options: {
  sinceDay: string;
  untilDay: string;
  timeZone: string;
  databasePath?: string;
}): Promise<UsageDatabaseResult> {
  const databasePath = options.databasePath?.trim() || defaultOpenCodePath();
  const file = await statDatabase(databasePath);
  if (file === null) return sourceResult("opencode", databasePath, [], null);

  try {
    const rows = await queryRows<OpenCodeRow>(
      databasePath,
      `SELECT id, model, directory, cost,
              tokens_input, tokens_output, tokens_reasoning,
              tokens_cache_read, tokens_cache_write, time_created
         FROM session
        WHERE time_created >= ? AND time_created <= ?`,
      localDayStartMs(options.sinceDay, options.timeZone),
      localDayEndMs(options.untilDay, options.timeZone),
    );
    const records = rows.map((row): UsageRecord => {
      const outputTokens = finiteNonNegative(row.tokens_output);
      return {
        provider: "opencode",
        timestampMs: finiteNonNegative(row.time_created),
        model: openCodeModel(row.model),
        sessionId: stringValue(row.id),
        projectPath: stringValue(row.directory),
        totals: {
          uncachedInputTokens: finiteNonNegative(row.tokens_input),
          cachedInputTokens: finiteNonNegative(row.tokens_cache_read),
          cacheCreationTokens: finiteNonNegative(row.tokens_cache_write),
          outputTokens,
          reasoningTokens: Math.min(
            finiteNonNegative(row.tokens_reasoning),
            outputTokens,
          ),
        },
        // OpenCode's aggregate is the provider-reported cost. Zero is meaningful
        // for free and subscription-included models and must not be re-priced.
        reportedCostUsd: finiteCost(row.cost),
        dedupeKey: stringValue(row.id) || null,
      };
    });
    return sourceResult("opencode", databasePath, records, file);
  } catch (error) {
    return sourceResult(
      "opencode",
      databasePath,
      [],
      file,
      safeDatabaseMessage("OpenCode", error),
    );
  }
}
