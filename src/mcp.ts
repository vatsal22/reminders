import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getStats, ensureIndex } from './indexer.js'
import {
  search,
  closeConnections,
  getPendingReminders,
  getCompletedReminders,
  getFlaggedReminders,
  getDueReminders,
  getLists,
  getRemindersInList,
} from './searcher.js'
import { createReminder, completeReminder } from './applescript.js'
import type { SearchOptions, IndexedReminder } from './types.js'
import { priorityLabel, unixToDate } from './types.js'

function formatReminder(r: IndexedReminder): string {
  const checkbox = r.completed ? '[x]' : '[ ]'
  const flag = r.flagged ? ' !' : ''
  const priority = priorityLabel(r.priority)
  const priorityStr = priority ? ` (${priority})` : ''

  let dueStr = ''
  if (r.dueDate) {
    const due = unixToDate(r.dueDate)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())

    if (dueDay.getTime() < today.getTime()) {
      dueStr = ` - OVERDUE: ${due.toLocaleDateString()}`
    } else if (dueDay.getTime() === today.getTime()) {
      dueStr = ' - Due today'
    } else {
      dueStr = ` - Due: ${due.toLocaleDateString()}`
    }
  }

  let result = `${checkbox}${flag} ${r.title}${priorityStr}${dueStr}`
  if (r.notes) {
    const notesPreview = r.notes.slice(0, 100).replace(/\n/g, ' ')
    result += `\n   ${notesPreview}${r.notes.length > 100 ? '...' : ''}`
  }
  return result
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: 'reminders',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'search_reminders',
          description:
            'Search through Apple Reminders with fuzzy matching. Can search by text query, filter by list, or filter by status.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query for reminder title and notes - supports fuzzy matching and typos.',
              },
              list: {
                type: 'string',
                description: 'Filter by list name (e.g., "Groceries", "Work").',
              },
              completed: {
                type: 'boolean',
                description: 'Filter by completion status. true = completed only, false = pending only.',
              },
              flagged: {
                type: 'boolean',
                description: 'Filter for flagged reminders only.',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results (default: 20)',
                default: 20,
              },
            },
            required: [],
          },
        },
        {
          name: 'get_pending_reminders',
          description:
            'Get all pending (incomplete) reminders, sorted by due date then creation date.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of reminders to return (default: 30)',
                default: 30,
              },
            },
          },
        },
        {
          name: 'get_completed_reminders',
          description:
            'Get recently completed reminders, sorted by completion date.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of reminders to return (default: 20)',
                default: 20,
              },
            },
          },
        },
        {
          name: 'get_flagged_reminders',
          description:
            'Get all flagged (priority) reminders that are not yet completed.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of reminders to return (default: 30)',
                default: 30,
              },
            },
          },
        },
        {
          name: 'get_due_reminders',
          description:
            'Get reminders due within a specified number of days.',
          inputSchema: {
            type: 'object',
            properties: {
              days: {
                type: 'number',
                description: 'Number of days from now to check for due reminders (default: 7)',
                default: 7,
              },
              limit: {
                type: 'number',
                description: 'Maximum number of reminders to return (default: 30)',
                default: 30,
              },
            },
          },
        },
        {
          name: 'list_reminder_lists',
          description:
            'List all reminder lists with their pending and completed counts.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_list_reminders',
          description:
            'Get all reminders in a specific list.',
          inputSchema: {
            type: 'object',
            properties: {
              list: {
                type: 'string',
                description: 'Name of the list to get reminders from',
              },
              show_completed: {
                type: 'boolean',
                description: 'Include completed reminders (default: false)',
                default: false,
              },
              limit: {
                type: 'number',
                description: 'Maximum number of reminders to return (default: 50)',
                default: 50,
              },
            },
            required: ['list'],
          },
        },
        {
          name: 'get_reminder_stats',
          description:
            'Get statistics about the indexed reminders including counts and date range.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'create_reminder',
          description:
            'Create a new reminder in Apple Reminders. Returns the created reminder details.',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'The title/name of the reminder (required)',
              },
              list: {
                type: 'string',
                description: 'List to add reminder to (default: "Reminders")',
              },
              notes: {
                type: 'string',
                description: 'Notes/body text for the reminder',
              },
              due_date: {
                type: 'string',
                description: 'Due date in YYYY-MM-DD format, or "today" or "tomorrow"',
              },
              due_time: {
                type: 'string',
                description: 'Due time in HH:MM format (24-hour). Requires due_date.',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority level: high, medium, or low',
              },
              flagged: {
                type: 'boolean',
                description: 'Whether to mark the reminder as flagged',
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'complete_reminder',
          description:
            'Mark a reminder as completed. Searches for reminders by title (partial match) and marks the first match as done.',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'The title (or partial title) of the reminder to complete',
              },
              list: {
                type: 'string',
                description: 'Optional: only search in this specific list',
              },
            },
            required: ['title'],
          },
        },
      ],
    }
  })

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'search_reminders': {
          const searchArgs = args as {
            query?: string
            list?: string
            completed?: boolean
            flagged?: boolean
            limit?: number
          }

          const searchOptions: SearchOptions = {
            query: searchArgs.query,
            list: searchArgs.list,
            completed: searchArgs.completed,
            flagged: searchArgs.flagged,
            limit: searchArgs.limit ?? 20,
          }

          const results = search(searchOptions)
          closeConnections()

          if (results.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No reminders found matching the criteria.',
                },
              ],
            }
          }

          const formatted = results.map((r) => {
            return `[${r.reminder.listName}]\n${formatReminder(r.reminder)}`
          })

          return {
            content: [
              {
                type: 'text',
                text: `Found ${results.length} reminder${results.length === 1 ? '' : 's'}:\n\n${formatted.join('\n\n')}`,
              },
            ],
          }
        }

        case 'get_pending_reminders': {
          const limit = (args as { limit?: number }).limit ?? 30
          const reminders = getPendingReminders(limit)
          closeConnections()

          if (reminders.length === 0) {
            return {
              content: [{ type: 'text', text: 'No pending reminders!' }],
            }
          }

          // Group by list
          const byList: Record<string, IndexedReminder[]> = {}
          for (const r of reminders) {
            const list = r.listName || 'Reminders'
            if (!byList[list]) byList[list] = []
            byList[list].push(r)
          }

          const formatted = Object.entries(byList).map(([listName, items]) => {
            const lines = [`## ${listName}`]
            for (const r of items) {
              lines.push(formatReminder(r))
            }
            return lines.join('\n')
          })

          return {
            content: [
              {
                type: 'text',
                text: `${reminders.length} pending reminders:\n\n${formatted.join('\n\n')}`,
              },
            ],
          }
        }

        case 'get_completed_reminders': {
          const limit = (args as { limit?: number }).limit ?? 20
          const reminders = getCompletedReminders(limit)
          closeConnections()

          if (reminders.length === 0) {
            return {
              content: [{ type: 'text', text: 'No completed reminders found.' }],
            }
          }

          const formatted = reminders.map((r) => {
            const completedDate = r.completionDate
              ? unixToDate(r.completionDate).toLocaleDateString()
              : ''
            return `[x] ${r.title} (completed ${completedDate})`
          })

          return {
            content: [
              {
                type: 'text',
                text: `${reminders.length} recently completed reminders:\n\n${formatted.join('\n')}`,
              },
            ],
          }
        }

        case 'get_flagged_reminders': {
          const limit = (args as { limit?: number }).limit ?? 30
          const reminders = getFlaggedReminders(limit)
          closeConnections()

          if (reminders.length === 0) {
            return {
              content: [{ type: 'text', text: 'No flagged reminders.' }],
            }
          }

          const formatted = reminders.map((r) => formatReminder(r))

          return {
            content: [
              {
                type: 'text',
                text: `${reminders.length} flagged reminders:\n\n${formatted.join('\n')}`,
              },
            ],
          }
        }

        case 'get_due_reminders': {
          const dueArgs = args as { days?: number; limit?: number }
          const days = dueArgs.days ?? 7
          const limit = dueArgs.limit ?? 30

          const futureDate = new Date()
          futureDate.setDate(futureDate.getDate() + days)

          const reminders = getDueReminders(futureDate, limit)
          closeConnections()

          if (reminders.length === 0) {
            return {
              content: [{ type: 'text', text: `No reminders due within ${days} days.` }],
            }
          }

          const formatted = reminders.map((r) => formatReminder(r))

          return {
            content: [
              {
                type: 'text',
                text: `${reminders.length} reminders due within ${days} days:\n\n${formatted.join('\n')}`,
              },
            ],
          }
        }

        case 'list_reminder_lists': {
          const lists = getLists()
          closeConnections()

          if (lists.length === 0) {
            return {
              content: [{ type: 'text', text: 'No reminder lists found.' }],
            }
          }

          const formatted = lists.map((list) => {
            return `${list.name}: ${list.pendingCount} pending, ${list.completedCount} completed`
          })

          return {
            content: [
              {
                type: 'text',
                text: `Reminder Lists:\n\n${formatted.join('\n')}`,
              },
            ],
          }
        }

        case 'get_list_reminders': {
          const listArgs = args as { list: string; show_completed?: boolean; limit?: number }

          if (!listArgs.list) {
            return {
              content: [{ type: 'text', text: 'Please provide a list name.' }],
              isError: true,
            }
          }

          const reminders = getRemindersInList(
            listArgs.list,
            listArgs.show_completed ?? false,
            listArgs.limit ?? 50
          )
          closeConnections()

          if (reminders.length === 0) {
            return {
              content: [{ type: 'text', text: `No reminders found in list "${listArgs.list}".` }],
            }
          }

          const formatted = reminders.map((r) => formatReminder(r))

          return {
            content: [
              {
                type: 'text',
                text: `Reminders in "${listArgs.list}":\n\n${formatted.join('\n')}`,
              },
            ],
          }
        }

        case 'get_reminder_stats': {
          ensureIndex()

          const stats = getStats()
          if (!stats) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Unable to read reminder statistics. The Reminders database may not be accessible.',
                },
              ],
              isError: true,
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: `Reminder Index Statistics\n\nTotal: ${stats.totalReminders.toLocaleString()}\nPending: ${stats.pendingReminders.toLocaleString()}\nCompleted: ${stats.completedReminders.toLocaleString()}\nLists: ${stats.totalLists.toLocaleString()}\nIndexed at: ${stats.indexedAt.toLocaleString()}\nDate range: ${stats.oldestReminder.toLocaleDateString()} - ${stats.newestReminder.toLocaleDateString()}`,
              },
            ],
          }
        }

        case 'create_reminder': {
          const createArgs = args as {
            title: string
            list?: string
            notes?: string
            due_date?: string
            due_time?: string
            priority?: 'high' | 'medium' | 'low'
            flagged?: boolean
          }

          if (!createArgs.title) {
            return {
              content: [{ type: 'text', text: 'Title is required to create a reminder.' }],
              isError: true,
            }
          }

          let dueDate: Date | undefined

          if (createArgs.due_date) {
            const now = new Date()
            if (createArgs.due_date === 'today') {
              dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0)
            } else if (createArgs.due_date === 'tomorrow') {
              dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)
            } else {
              const parsed = new Date(createArgs.due_date)
              if (isNaN(parsed.getTime())) {
                return {
                  content: [{ type: 'text', text: `Invalid date format: ${createArgs.due_date}. Use YYYY-MM-DD, "today", or "tomorrow".` }],
                  isError: true,
                }
              }
              dueDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 9, 0)
            }

            if (createArgs.due_time) {
              const timeParts = createArgs.due_time.split(':')
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
          if (!createArgs.list) {
            try {
              availableLists = getLists()
              closeConnections()
            } catch {
              // If we can't get lists (index not built), proceed without guessing
              availableLists = undefined
            }
          }

          const result = createReminder({
            title: createArgs.title,
            list: createArgs.list,
            notes: createArgs.notes,
            dueDate,
            priority: createArgs.priority,
            flagged: createArgs.flagged,
            availableLists,
          })

          let response = `Reminder created successfully!\n\nTitle: ${result.title}\nList: ${result.list}`
          if (result.wasGuessed) {
            response += ` (auto-detected)`
          }
          if (dueDate) {
            response += `\nDue: ${dueDate.toLocaleString()}`
          }
          if (createArgs.priority) {
            response += `\nPriority: ${createArgs.priority}`
          }
          if (createArgs.flagged) {
            response += `\nFlagged: Yes`
          }

          return {
            content: [{ type: 'text', text: response }],
          }
        }

        case 'complete_reminder': {
          const completeArgs = args as {
            title: string
            list?: string
          }

          if (!completeArgs.title) {
            return {
              content: [{ type: 'text', text: 'Title is required to complete a reminder.' }],
              isError: true,
            }
          }

          let listToSearch = completeArgs.list

          // If no list specified, use the index to find the most likely list
          if (!listToSearch) {
            // Ensure index exists (will rebuild if needed)
            ensureIndex()

            const searchResults = search({ query: completeArgs.title, completed: false, limit: 1 })
            if (searchResults.length > 0) {
              listToSearch = searchResults[0].reminder.listName
            }
            closeConnections()
          }

          const result = completeReminder(completeArgs.title, listToSearch)

          return {
            content: [{
              type: 'text',
              text: `Reminder completed!\n\nTitle: ${result.title}\nList: ${result.list}`,
            }],
          }
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          }
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${(error as Error).message}`,
          },
        ],
        isError: true,
      }
    }
  })

  // Start the server
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
