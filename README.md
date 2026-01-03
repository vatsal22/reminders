# reminders

Fuzzy search and browse Apple Reminders from the command line or as an MCP server.

## Features

- **Fuzzy search** with typo tolerance across all your reminders
- **Create reminders** - add new reminders via CLI or MCP
- **Browse by list** - view reminders organized by list
- **Filter by status** - pending, completed, flagged, or due soon
- **Auto-indexing** - index automatically rebuilds when reminders change
- **Multiple interfaces** - CLI, MCP server, or Claude Code plugin

## Requirements

- macOS (reads from Apple Reminders database)
- Node.js 22+
- Full Disk Access permission for your terminal

## Installation

### Homebrew

```bash
brew install cardmagic/tap/reminders
```

### npm

```bash
npm install -g @cardmagic/reminders
```

### Claude Code Plugin (recommended)

Install as a plugin to get skills (auto-invoked) and slash commands:

```bash
# Add the marketplace
claude plugin marketplace add cardmagic/ai-marketplace

# Install the plugin
claude plugin install reminders@cardmagic
```

This gives you:
- **Skill**: Claude automatically searches reminders when you ask about tasks/todos
- **Slash commands**: `/reminders:search`, `/reminders:pending`, `/reminders:lists`, and more

### MCP Server

For direct MCP tool access without the plugin:

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

# Then add as plugin OR MCP server:
claude plugin marketplace add cardmagic/ai-marketplace
claude plugin install reminders@cardmagic
# OR
claude mcp add --transport stdio reminders -- reminders --mcp
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

# Create a new reminder (auto-detects list from content)
reminders add "Buy milk"                    # → Groceries list
reminders add "Call mom" --list "Family" --due tomorrow
reminders add "Meeting prep" --due 2024-01-15 --time 09:00 --priority high
reminders add "Important task" --flagged --notes "Don't forget!"

# Mark a reminder as completed
reminders done "Buy milk"                   # Searches all lists
reminders done "meeting" --list "Work"      # Search in specific list
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

### Claude Code Plugin

When installed as a plugin, you get:

**Skill** (auto-invoked): Claude automatically manages reminders when you ask things like:
- "What's on my grocery list?"
- "Show my pending tasks"
- "What reminders are due this week?"
- "Add milk to my grocery list"
- "Mark the milk reminder as done"

**Slash Commands**:

| Command | Description |
|---------|-------------|
| `/reminders:search <query>` | Fuzzy search with optional filters |
| `/reminders:pending` | Show pending reminders |
| `/reminders:completed` | Show recently completed |
| `/reminders:flagged` | Show flagged reminders |
| `/reminders:due` | Show reminders due soon |
| `/reminders:lists` | List all reminder lists |
| `/reminders:list "Name"` | Show reminders in a specific list |
| `/reminders:create "Title"` | Create a new reminder (auto-detects list) |
| `/reminders:done "Title"` | Mark a reminder as completed |

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
| `create_reminder` | Create a new reminder (auto-detects list) |
| `complete_reminder` | Mark a reminder as completed |

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
