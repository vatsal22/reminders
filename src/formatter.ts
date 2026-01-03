import chalk from 'chalk'
import type { IndexedReminder, SearchResult, IndexStats } from './types.js'
import { unixToDate, priorityLabel } from './types.js'

function formatDate(unixTimestamp: number): string {
  const date = new Date(unixTimestamp * 1000)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDueDate(dueDate: number | null): string {
  if (!dueDate) return ''

  const date = unixToDate(dueDate)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 86400000)
  const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (dueDay.getTime() < today.getTime()) {
    return chalk.red(`Overdue: ${formatDate(dueDate)}`)
  } else if (dueDay.getTime() === today.getTime()) {
    return chalk.yellow('Due today')
  } else if (dueDay.getTime() === tomorrow.getTime()) {
    return chalk.cyan('Due tomorrow')
  }
  return chalk.dim(`Due: ${formatDate(dueDate)}`)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatCheckbox(completed: boolean): string {
  return completed ? chalk.green('[x]') : chalk.dim('[ ]')
}

function formatPriority(priority: number): string {
  const label = priorityLabel(priority)
  if (!label) return ''

  switch (priority) {
    case 1:
      return chalk.red('!')
    case 5:
      return chalk.yellow('!')
    case 9:
      return chalk.dim('!')
    default:
      return ''
  }
}

function formatReminder(
  reminder: IndexedReminder,
  isMatch: boolean,
  matchedTerms: string[] = []
): string {
  const checkbox = formatCheckbox(reminder.completed)
  const priority = formatPriority(reminder.priority)
  const flagged = reminder.flagged ? chalk.red('\u2691') : '' // Flag symbol

  let title = reminder.title
  if (isMatch && matchedTerms.length > 0) {
    for (const term of matchedTerms) {
      const regex = new RegExp(`(${escapeRegex(term)})`, 'gi')
      title = title.replace(regex, chalk.bgYellow.black('$1'))
    }
  }

  const parts = [checkbox]
  if (priority) parts.push(priority)
  parts.push(title)
  if (flagged) parts.push(flagged)

  const due = formatDueDate(reminder.dueDate)
  if (due) parts.push(due)

  const prefix = isMatch ? chalk.green('\u25b6 ') : '  '
  return prefix + parts.join(' ')
}

export function formatSearchResult(
  result: SearchResult,
  showList: boolean = true
): string {
  const { reminder, matchedTerms } = result
  const lines: string[] = []

  const mainLine = formatReminder(reminder, true, matchedTerms)
  lines.push(mainLine)

  if (showList) {
    lines.push(chalk.dim(`   List: ${reminder.listName}`))
  }

  if (reminder.notes) {
    const notesPreview = reminder.notes.slice(0, 100).replace(/\n/g, ' ')
    lines.push(chalk.dim(`   ${notesPreview}${reminder.notes.length > 100 ? '...' : ''}`))
  }

  return lines.join('\n')
}

export function formatReminderSimple(reminder: IndexedReminder): string {
  return formatReminder(reminder, false)
}

export function formatStats(stats: IndexStats): string {
  const lines: string[] = []

  lines.push(chalk.bold.green('Reminders Index Statistics'))
  lines.push(chalk.dim('\u2500'.repeat(40)))
  lines.push(`${chalk.dim('Total:')}      ${stats.totalReminders.toLocaleString()}`)
  lines.push(`${chalk.dim('Pending:')}    ${stats.pendingReminders.toLocaleString()}`)
  lines.push(`${chalk.dim('Completed:')}  ${stats.completedReminders.toLocaleString()}`)
  lines.push(`${chalk.dim('Lists:')}      ${stats.totalLists.toLocaleString()}`)
  lines.push(`${chalk.dim('Indexed at:')} ${stats.indexedAt.toLocaleString()}`)
  lines.push(`${chalk.dim('Date range:')} ${formatDateRange(stats.oldestReminder, stats.newestReminder)}`)

  return lines.join('\n')
}

function formatDateRange(oldest: Date, newest: Date): string {
  const format = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${format(oldest)} - ${format(newest)}`
}

export function formatNoResults(query: string): string {
  return chalk.yellow(`No reminders found matching "${query}"`)
}

export function formatIndexProgress(
  phase: string,
  current: number,
  total: number
): string {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0
  const bar = createProgressBar(percent)

  let phaseLabel: string
  switch (phase) {
    case 'reading':
      phaseLabel = 'Reading reminders'
      break
    case 'indexing-fts':
      phaseLabel = 'Building search index'
      break
    case 'indexing-fuzzy':
      phaseLabel = 'Building fuzzy index'
      break
    case 'done':
      phaseLabel = 'Done'
      break
    default:
      phaseLabel = phase
  }

  return `${phaseLabel}: ${bar} ${percent}% (${current.toLocaleString()}/${total.toLocaleString()})`
}

function createProgressBar(percent: number): string {
  const width = 20
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled
  return chalk.green('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty))
}

export function formatListHeader(listName: string, pendingCount: number): string {
  return `${chalk.bold.magenta(listName)} ${chalk.dim(`(${pendingCount} pending)`)}`
}
