import { createRequire } from 'module'
import { program } from 'commander'
import chalk from 'chalk'
import { buildIndex, updateIndex, getStats, ensureIndex } from './indexer.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json')
import {
  search,
  closeConnections,
  getRecentReminders,
  getPendingReminders,
  getCompletedReminders,
  getFlaggedReminders,
  getDueReminders,
  getLists,
  getRemindersInList,
} from './searcher.js'
import {
  formatSearchResult,
  formatReminderSimple,
  formatStats,
  formatNoResults,
  formatIndexProgress,
  formatListHeader,
} from './formatter.js'
import { createReminder, completeReminder } from './applescript.js'
import type { SearchOptions } from './types.js'

export function runCli(): void {
  program
    .name('reminders')
    .description('Fuzzy search through Apple Reminders. Run with --mcp for MCP server mode.')
    .version(version)

  program
    .command('index')
    .description('Build or update the search index from Apple Reminders')
    .option('-q, --quiet', 'Suppress progress output')
    .option('-u, --update', 'Incremental update (only index new reminders)')
    .action((options) => {
      const isIncremental = options.update
      console.log(chalk.bold(isIncremental ? 'Updating search index...' : 'Rebuilding search index...'))
      console.log(
        chalk.dim('Reading from ~/Library/Group Containers/group.com.apple.reminders/ (requires Full Disk Access)')
      )
      console.log()

      try {
        const progressCallback = (progress: { phase: string; current: number; total: number }) => {
          if (!options.quiet) {
            process.stdout.write(
              '\r' + formatIndexProgress(progress.phase, progress.current, progress.total)
            )
            if (progress.phase === 'done') {
              console.log()
            }
          }
        }

        let stats
        if (isIncremental) {
          stats = updateIndex(progressCallback)
          if (!stats) {
            console.log(chalk.yellow('No existing index found, performing full rebuild...'))
            console.log()
            stats = buildIndex(progressCallback)
          }
        } else {
          stats = buildIndex(progressCallback)
        }

        console.log()
        console.log(chalk.green(isIncremental ? '\u2713 Index updated successfully!' : '\u2713 Index rebuilt successfully!'))
        console.log()
        console.log(formatStats(stats))
      } catch (error) {
        console.error(chalk.red('Error building index:'), (error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('search <query>')
    .description('Search reminders with fuzzy matching')
    .option('-l, --list <name>', 'Filter by list name')
    .option('--completed', 'Show only completed reminders')
    .option('--pending', 'Show only pending reminders')
    .option('--flagged', 'Show only flagged reminders')
    .option('-n, --limit <number>', 'Maximum number of results', '20')
    .action((query, options) => {
      let completed: boolean | undefined
      if (options.completed) completed = true
      if (options.pending) completed = false

      const searchOptions: SearchOptions = {
        query,
        list: options.list,
        completed,
        flagged: options.flagged,
        limit: parseInt(options.limit, 10),
      }

      try {
        const results = search(searchOptions)

        if (results.length === 0) {
          console.log(formatNoResults(query))
          return
        }

        console.log(
          chalk.dim(`Found ${results.length} result${results.length === 1 ? '' : 's'}:`)
        )
        console.log()

        for (const result of results) {
          console.log(formatSearchResult(result))
          console.log()
        }
      } catch (error) {
        console.error(chalk.red('Search error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('lists')
    .description('Show all reminder lists with counts')
    .action(() => {
      try {
        const lists = getLists()

        if (lists.length === 0) {
          console.log(chalk.yellow('No lists found.'))
          return
        }

        console.log(chalk.dim('Reminder lists:\n'))

        for (const list of lists) {
          const pendingText = list.pendingCount > 0
            ? chalk.yellow(`${list.pendingCount} pending`)
            : chalk.dim('0 pending')
          const completedText = chalk.dim(`${list.completedCount} completed`)
          console.log(`${chalk.bold(list.name)}: ${pendingText}, ${completedText}`)
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('list <name>')
    .description('Show reminders in a specific list')
    .option('-a, --all', 'Include completed reminders')
    .option('-n, --limit <number>', 'Maximum number of reminders', '50')
    .action((name, options) => {
      try {
        const reminders = getRemindersInList(name, options.all, parseInt(options.limit, 10))

        if (reminders.length === 0) {
          console.log(chalk.yellow(`No reminders found in list "${name}"`))
          return
        }

        const pendingCount = reminders.filter(r => !r.completed).length
        console.log(formatListHeader(name, pendingCount))
        console.log()

        for (const reminder of reminders) {
          console.log(formatReminderSimple(reminder))
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('pending')
    .description('Show pending (incomplete) reminders')
    .option('-n, --limit <number>', 'Maximum number of reminders', '30')
    .action((options) => {
      try {
        const reminders = getPendingReminders(parseInt(options.limit, 10))

        if (reminders.length === 0) {
          console.log(chalk.green('No pending reminders!'))
          return
        }

        console.log(chalk.dim(`${reminders.length} pending reminders:\n`))

        let currentList = ''
        for (const reminder of reminders) {
          if (reminder.listName !== currentList) {
            if (currentList !== '') console.log()
            console.log(chalk.bold.magenta(reminder.listName))
            currentList = reminder.listName
          }
          console.log('  ' + formatReminderSimple(reminder))
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('completed')
    .description('Show recently completed reminders')
    .option('-n, --limit <number>', 'Maximum number of reminders', '20')
    .action((options) => {
      try {
        const reminders = getCompletedReminders(parseInt(options.limit, 10))

        if (reminders.length === 0) {
          console.log(chalk.yellow('No completed reminders found.'))
          return
        }

        console.log(chalk.dim(`${reminders.length} recently completed reminders:\n`))

        for (const reminder of reminders) {
          const completedDate = reminder.completionDate
            ? new Date(reminder.completionDate * 1000).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })
            : ''
          console.log(`${chalk.green('[x]')} ${reminder.title} ${chalk.dim(`(${completedDate})`)}`)
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('flagged')
    .description('Show flagged reminders')
    .option('-n, --limit <number>', 'Maximum number of reminders', '30')
    .action((options) => {
      try {
        const reminders = getFlaggedReminders(parseInt(options.limit, 10))

        if (reminders.length === 0) {
          console.log(chalk.dim('No flagged reminders.'))
          return
        }

        console.log(chalk.dim(`${reminders.length} flagged reminders:\n`))

        for (const reminder of reminders) {
          console.log(formatReminderSimple(reminder))
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('due')
    .description('Show reminders due soon')
    .option('-d, --days <number>', 'Days from now to check', '7')
    .option('-n, --limit <number>', 'Maximum number of reminders', '30')
    .action((options) => {
      try {
        const days = parseInt(options.days, 10)
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + days)

        const reminders = getDueReminders(futureDate, parseInt(options.limit, 10))

        if (reminders.length === 0) {
          console.log(chalk.dim(`No reminders due within ${days} days.`))
          return
        }

        console.log(chalk.dim(`${reminders.length} reminders due within ${days} days:\n`))

        for (const reminder of reminders) {
          console.log(formatReminderSimple(reminder))
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('recent')
    .description('Show most recently created reminders')
    .option('-n, --limit <number>', 'Maximum number of reminders', '20')
    .action((options) => {
      try {
        const reminders = getRecentReminders(parseInt(options.limit, 10))

        if (reminders.length === 0) {
          console.log(chalk.yellow('No reminders found.'))
          return
        }

        console.log(chalk.dim(`Most recent ${reminders.length} reminders:\n`))

        for (const reminder of reminders) {
          const date = new Date(reminder.creationDate * 1000)
          const dateStr = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
          const checkbox = reminder.completed ? chalk.green('[x]') : chalk.dim('[ ]')
          const list = chalk.dim(`[${reminder.listName}]`)
          console.log(`${chalk.dim(dateStr)} ${list} ${checkbox} ${reminder.title}`)
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      } finally {
        closeConnections()
      }
    })

  program
    .command('stats')
    .description('Show index statistics')
    .action(() => {
      const stats = getStats()
      if (!stats) {
        console.error(
          chalk.red('Index not found. Run `reminders index` first to build the search index.')
        )
        process.exit(1)
      }
      console.log(formatStats(stats))
    })

  program
    .command('add <title>')
    .description('Create a new reminder')
    .option('-l, --list <name>', 'List to add reminder to (default: Reminders)')
    .option('-n, --notes <text>', 'Notes/body for the reminder')
    .option('-d, --due <date>', 'Due date (YYYY-MM-DD, "today", or "tomorrow")')
    .option('-t, --time <time>', 'Due time in HH:MM format (requires --due)')
    .option('-p, --priority <level>', 'Priority: high, medium, or low')
    .option('-f, --flagged', 'Mark as flagged')
    .action((title, options) => {
      try {
        let dueDate: Date | undefined

        if (options.due) {
          const now = new Date()
          if (options.due === 'today') {
            dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0)
          } else if (options.due === 'tomorrow') {
            dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)
          } else {
            const parsed = new Date(options.due)
            if (isNaN(parsed.getTime())) {
              console.error(chalk.red(`Invalid date format: ${options.due}`))
              console.error(chalk.dim('Use YYYY-MM-DD, "today", or "tomorrow"'))
              process.exit(1)
            }
            dueDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 9, 0)
          }

          if (options.time) {
            const timeParts = options.time.split(':')
            if (timeParts.length === 2) {
              const hours = parseInt(timeParts[0], 10)
              const minutes = parseInt(timeParts[1], 10)
              if (!isNaN(hours) && !isNaN(minutes)) {
                dueDate.setHours(hours, minutes)
              }
            }
          }
        }

        // Get available lists for smart guessing when no list is specified
        let availableLists: { name: string }[] | undefined
        if (!options.list) {
          try {
            availableLists = getLists()
            closeConnections()
          } catch {
            // If we can't get lists (index not built), proceed without guessing
            availableLists = undefined
          }
        }

        const result = createReminder({
          title,
          list: options.list,
          notes: options.notes,
          dueDate,
          priority: options.priority,
          flagged: options.flagged,
          availableLists,
        })

        console.log(chalk.green('✓ Reminder created'))
        console.log(`  ${chalk.bold(result.title)}`)
        const listNote = result.wasGuessed ? chalk.cyan(' (auto-detected)') : ''
        console.log(`  ${chalk.dim(`List: ${result.list}`)}${listNote}`)
        if (dueDate) {
          console.log(`  ${chalk.dim(`Due: ${dueDate.toLocaleString()}`)}`)
        }
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('done <title>')
    .description('Mark a reminder as completed')
    .option('-l, --list <name>', 'Only search in this list')
    .action((title, options) => {
      try {
        let listToSearch = options.list

        // If no list specified, use the index to find the most likely list
        if (!listToSearch) {
          // Ensure index exists (will rebuild if needed)
          ensureIndex()

          const searchResults = search({ query: title, completed: false, limit: 1 })
          if (searchResults.length > 0) {
            listToSearch = searchResults[0].reminder.listName
          }
          closeConnections()
        }

        const result = completeReminder(title, listToSearch)

        console.log(chalk.green('✓ Reminder completed'))
        console.log(`  ${chalk.strikethrough(result.title)}`)
        console.log(`  ${chalk.dim(`List: ${result.list}`)}`)
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('mcp')
    .description('Start as MCP server (for Claude Code integration)')
    .action(async () => {
      const { startMcpServer } = await import('./mcp.js')
      startMcpServer()
    })

  // Default action: show pending reminders
  program.action(() => {
    try {
      const reminders = getPendingReminders(30)

      if (reminders.length === 0) {
        console.log(chalk.green('No pending reminders!'))
        return
      }

      console.log(chalk.dim(`${reminders.length} pending reminders:\n`))

      let currentList = ''
      for (const reminder of reminders) {
        if (reminder.listName !== currentList) {
          if (currentList !== '') console.log()
          console.log(chalk.bold.magenta(reminder.listName))
          currentList = reminder.listName
        }
        console.log('  ' + formatReminderSimple(reminder))
      }
    } catch (error) {
      console.error(chalk.red('Error:'), (error as Error).message)
      process.exit(1)
    } finally {
      closeConnections()
    }
  })

  program.parse()
}
