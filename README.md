# reminders

Fuzzy search and browse Apple Reminders from the command line or as an MCP server.

## Features

- **Fuzzy search** with typo tolerance across all your reminders
- **Browse by list** - view reminders organized by list
- **Filter by status** - pending, completed, flagged, or due soon
- **Auto-indexing** - index automatically rebuilds when reminders change
- **Multiple interfaces** - CLI or MCP server

## Requirements

- macOS (reads from Apple Reminders database)
- Node.js 22+
- Full Disk Access permission for your terminal

## Installation

### npm

```bash
npm install -g @cardmagic/reminders
```

### MCP Server

```bash
claude mcp add --transport stdio reminders -- npx -y @cardmagic/reminders --mcp
```

Or install globally first:

```bash
npm install -g @cardmagic/reminders
claude mcp add --transport stdio reminders -- reminders --mcp
```

### From source

```bash
git clone https://github.com/cardmagic/reminders.git
cd reminders
pnpm install
pnpm build
pnpm link --global
```

## Granting Full Disk Access

The tool needs to read your Reminders database:

1. Open **System Settings** > **Privacy & Security** > **Full Disk Access**
2. Click **+** and add your terminal app (Terminal.app, iTerm, Warp, etc.)
3. Restart your terminal

## Usage

### CLI

```bash
# Show pending reminders (default action)
reminders

# Show all reminder lists with counts
reminders lists

# Show reminders in a specific list
reminders list "Groceries"
reminders list "Groceries" --all  # include completed

# Show pending/completed/flagged
reminders pending
reminders completed
reminders flagged

# Show reminders due within N days
reminders due --days 7

# Fuzzy search
reminders search "milk"
reminders search "meeting" --list "Work"
reminders search "groceries" --pending

# Show recently created reminders
reminders recent

# Show index statistics
reminders stats

# Force rebuild the index
reminders index
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-l, --list <name>` | Filter by list name |
| `--completed` | Show only completed |
| `--pending` | Show only pending |
| `--flagged` | Show only flagged |
| `-n, --limit <n>` | Max results (default varies by command) |
| `-a, --all` | Include completed (for `list` command) |
| `-d, --days <n>` | Days to look ahead (for `due` command) |

### MCP Server

When installed as an MCP server, these tools are available:

| Tool | Description |
|------|-------------|
| `search_reminders` | Fuzzy search with optional filters |
| `get_pending_reminders` | Get incomplete reminders |
| `get_completed_reminders` | Get recently completed |
| `get_flagged_reminders` | Get flagged reminders |
| `get_due_reminders` | Get reminders due within N days |
| `list_reminder_lists` | List all lists with counts |
| `get_list_reminders` | Get reminders in a specific list |
| `get_reminder_stats` | Get index statistics |

#### Manual MCP Configuration

For Claude Desktop or VS Code, add to your MCP configuration:

```json
{
  "mcpServers": {
    "reminders": {
      "command": "npx",
      "args": ["-y", "@cardmagic/reminders", "--mcp"]
    }
  }
}
```

## How It Works

1. **Auto-Indexing**: On first run (or when reminders change), the tool:
   - Reads Apple Reminders SQLite databases
   - Builds a SQLite FTS5 full-text search index
   - Creates a MiniSearch fuzzy search index

2. **Searching**: Queries both indexes for best results with typo tolerance

3. **Storage**: Index files are stored in `~/.reminders/`:
   - `index.db` - SQLite FTS5 database
   - `fuzzy.json` - MiniSearch index
   - `stats.json` - Index statistics

## License

MIT
