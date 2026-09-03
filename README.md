# Receipts

A [bb](https://github.com/get-bb/bb) plugin that shows what each coding agent
actually cost — Claude Code, Codex, Hermes Agent, OpenCode, Pi and Cursor —
with a daily chart and a model / project / day breakdown.

Requires bb `>= 0.41`. Git installs need `npm` on PATH.

## Install

```bash
bb plugin install https://github.com/ChrBoebel/bb-plugin-receipts
```

That tracks `main`. Pin a branch, tag, or commit with:

```bash
bb plugin install git:https://github.com/ChrBoebel/bb-plugin-receipts.git@main
```

From a local checkout:

```bash
bb plugin install .
```

Open **Receipts** in the bb sidebar, or run:

```bash
bb receipts show [--days 7|30|90] [--force]
```

## Features

- Sidebar **Receipts** panel with 7 / 30 / 90 day windows
- Provider split, daily chart, and model / project / day breakdown
- Project rows map to bb projects when possible; personal `env_*` workspaces
  link to their thread; `~/Documents/Codex/*` chats merge into **Unassociated
  Codex chats**; unmatched folders stay as their own rows
- Durable on-disk caches — only re-parse transcripts whose size/mtime changed
- 7 / 30 / 90 day switches slice a warm 90-day base (no re-scan)
- Cursor dashboard results are reused for 15 minutes and are invalidated when
  the auth database path changes

## Data sources

Usage is read from the machine running the bb server, not from enrolled remote
hosts.

| Provider     | Source                                                    | Cost                             |
| ------------ | --------------------------------------------------------- | -------------------------------- |
| Claude Code  | `~/.claude/projects/**/*.jsonl` (and `CLAUDE_CONFIG_DIR`) | Transcript `costUSD` or rates    |
| Codex        | `~/.codex/sessions/**/*.jsonl` (or `CODEX_HOME`)          | LiteLLM model rates              |
| Hermes Agent | `~/.hermes/state.db` (or `HERMES_STATE_DB`)               | `actual_cost_usd`, else estimate |
| OpenCode     | `~/.local/share/opencode/opencode.db` (or `OPENCODE_DATABASE_PATH`) | OpenCode-recorded cost |
| Pi           | `~/.bb/pi-bridge-sessions`, `~/.pi/agent/sessions`        | `message.usage.cost.total`       |
| Cursor       | Cursor dashboard API using local desktop auth             | Cursor-reported cents            |

The two SQLite sources are opened read-only through `node:sqlite`, with a short
busy timeout so a running agent is never blocked. A missing database is normal
"no data", not an error. OpenCode's default path also honours `XDG_DATA_HOME`.

### Hermes project attribution

Hermes fills `sessions.cwd` only for CLI runs. Sessions that bb launches are
ACP sessions, which leave that column null and record the working directory
inside `model_config` instead; subagents record neither and inherit it from the
session that delegated to them. Receipts resolves the directory in that order —
column, then `model_config`, then by walking `parent_session_id` — so ACP
sessions and their subagents land on the right project instead of in
**Unknown**.

### OpenCode cost

OpenCode records the cost itself and Receipts takes that number as-is. A `0` is
meaningful: OpenCode's free and subscription-included models genuinely cost
nothing, and re-pricing them at API rates would invent spend that was never
billed. Sessions on those models therefore show real token counts against
`$0.00`.

### Cursor

Cursor support is opt-in under bb Settings → Plugins → Receipts. It reads the
Cursor desktop `state.vscdb` database in read-only mode and derives a
short-lived dashboard cookie in memory; the access token is not persisted by
this plugin. Cursor usage is account-level, so it cannot be attributed to
individual projects or sessions. The dashboard API is an undocumented web
endpoint and may change independently of the plugin.

## On-disk cache

All durable state lives under `~/.bb/plugins/receipts/`:

| File               | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `scan-cache.json`  | Per-transcript parse cache (records keyed by path + size + mtime) |
| `base-cache.json`  | Aggregated 90-day buckets/sessions for instant window slices      |
| `model-rates.json` | Cached LiteLLM pricing table                                      |

Refresh / `--force` deletes the scan + base caches and re-reads the sources.

## Develop

```bash
npm install
bb plugin install .
bb plugin dev
npm run typecheck
```

`dist/` is a local build artifact (gitignored). Git installs build from source.

## Notes

- Costs are **raw API-equivalent** estimates, not subscription invoices.
- `<synthetic>` Claude transcript rows are ignored (local/non-billed).
- After the first scan, unchanged loads are fingerprint hits (no re-parse / no re-aggregate).
- In-memory window slices stay instant; a short hot TTL avoids filesystem walks on day toggles.

## Credits

Receipts is a fork of
[`iamEvanYT/bb-usage-page`](https://github.com/iamEvanYT/bb-usage-page), which
is itself inspired by [t3code](https://github.com/pingdotgg/t3code)'s Usage
page. The Claude Code, Codex, Pi and Cursor scanners, the caching layer and the
dashboard are its work; this fork adds the Hermes Agent and OpenCode sources
and the provider brand marks. The original copyright is retained in `LICENSE`.

Provider logos are tinted from the
[True Colors](https://github.com/ChrBoebel/bb-plugin-provider-brand-marks)
palette when that plugin is installed, and fall back to built-in brand colours
otherwise.

## License

MIT
