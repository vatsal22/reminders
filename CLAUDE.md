# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build          # Compile TypeScript to dist/
pnpm dev            # Watch mode for development
pnpm typecheck      # Type check without emitting
pnpm lint           # Run oxlint
pnpm test           # Run tests
pnpm test:watch     # Run tests in watch mode
```

## Architecture

Dual-mode CLI/MCP tool for searching Apple Reminders:

```
src/
├── index.ts      # Entry point - routes to CLI or MCP mode based on --mcp flag
├── cli.ts        # Commander-based CLI (search, lists, pending, completed, etc.)
├── mcp.ts        # MCP server exposing tools via @modelcontextprotocol/sdk
├── indexer.ts    # Builds search indexes from ~/Library/Group Containers/group.com.apple.reminders/
├── searcher.ts   # Queries indexes with fuzzy matching via MiniSearch
├── formatter.ts  # Terminal output formatting with chalk
└── types.ts      # Shared types and Apple date conversion utilities
```

**Data flow:**
1. `indexer.ts` reads Apple's Reminders SQLite databases (multiple Data-*.sqlite files)
2. Creates two indexes in `~/.reminders/`: FTS5 SQLite for exact search, MiniSearch JSON for fuzzy matching
3. `searcher.ts` queries MiniSearch for fuzzy results, or SQLite directly for filtered queries

**Key dependencies:**
- `better-sqlite3`: Read Apple Reminders DB and create FTS5 index
- `minisearch`: Fuzzy search with typo tolerance
- `@modelcontextprotocol/sdk`: MCP server for Claude Code integration

## CLI Commands

```bash
reminders index           # Build or update search index
reminders search <query>  # Fuzzy search reminders
reminders lists           # Show all lists with counts
reminders list <name>     # Show reminders in a list
reminders pending         # Show pending reminders
reminders completed       # Show recently completed
reminders flagged         # Show flagged reminders
reminders due             # Show reminders due soon
reminders stats           # Show index statistics
reminders --mcp           # Start as MCP server
```

## MCP Tools

When running as MCP server (`--mcp` flag), exposes these tools:
- `search_reminders`: Fuzzy search with optional filters
- `get_pending_reminders`: Get incomplete reminders
- `get_completed_reminders`: Get recently completed
- `get_flagged_reminders`: Get flagged reminders
- `get_due_reminders`: Get reminders due within N days
- `list_reminder_lists`: List all lists with counts
- `get_list_reminders`: Get reminders in a specific list
- `get_reminder_stats`: Get index statistics

## Releasing

When asked to "bump version to X" or "tag vX.Y.Z":

1. Update `package.json` version field to the new version
2. Commit: `git add package.json && git commit -m "chore: bump version to X.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push && git push origin vX.Y.Z`

**First-time setup:**
1. Create GitHub repo and push code
2. Add NPM_TOKEN secret to GitHub repo settings
3. Create `.github/workflows/publish.yml` for automated publishing
