// Raw reminder from Apple's Reminders database
export interface RawReminder {
  Z_PK: number
  ZTITLE: string | null
  ZNOTES: string | null
  ZCOMPLETED: number // 0 or 1
  ZFLAGGED: number // 0 or 1
  ZPRIORITY: number // 0=none, 1=high, 5=medium, 9=low
  ZDUEDATE: number | null // Apple Core Data timestamp (seconds since 2001-01-01)
  ZCREATIONDATE: number // Apple Core Data timestamp
  ZLASTMODIFIEDDATE: number | null
  ZCOMPLETIONDATE: number | null
  ZLIST: number // FK to list
  ZMARKEDFORDELETION: number // 0 or 1
}

// Raw list from Apple's Reminders database
export interface RawList {
  Z_PK: number
  ZNAME: string | null
  ZMARKEDFORDELETION: number
}

// Joined reminder with list info
export interface JoinedReminder {
  id: number
  title: string | null
  notes: string | null
  completed: number
  flagged: number
  priority: number
  dueDate: number | null
  creationDate: number
  lastModifiedDate: number | null
  completionDate: number | null
  listId: number
  listName: string | null
  markedForDeletion: number
}

// Indexed reminder stored in our FTS5 database
export interface IndexedReminder {
  id: number
  title: string
  notes: string
  listName: string
  listId: number
  completed: boolean
  flagged: boolean
  priority: number // 0=none, 1=high, 5=medium, 9=low
  dueDate: number | null // Unix timestamp (seconds) or null
  creationDate: number // Unix timestamp (seconds)
  completionDate: number | null // Unix timestamp (seconds) or null
}

// Search result with relevance score
export interface SearchResult {
  reminder: IndexedReminder
  score: number
  matchedTerms: string[]
}

// Search options for the CLI
export interface SearchOptions {
  query?: string
  list?: string // filter by list name
  completed?: boolean // filter by completion status
  flagged?: boolean // filter only flagged
  after?: Date // filter by creation date
  before?: Date // filter by due date
  limit: number
}

// Index stats
export interface IndexStats {
  totalReminders: number
  totalLists: number
  completedReminders: number
  pendingReminders: number
  indexedAt: Date
  oldestReminder: Date
  newestReminder: Date
  lastIndexedRowid?: number // for incremental updates
}

// Apple Core Data date constant (different from Messages!)
// Reminders uses seconds since 2001-01-01, not nanoseconds
export const APPLE_EPOCH_OFFSET = 978307200 // seconds between Unix epoch and Apple epoch (2001-01-01)

// Convert Apple Core Data timestamp (seconds) to Unix timestamp (seconds)
export function appleToUnix(appleDate: number): number {
  return Math.floor(appleDate) + APPLE_EPOCH_OFFSET
}

// Convert Unix timestamp to JavaScript Date
export function unixToDate(unixTimestamp: number): Date {
  return new Date(unixTimestamp * 1000)
}

// Convert Apple Core Data timestamp to JavaScript Date
export function appleToDate(appleDate: number): Date {
  return unixToDate(appleToUnix(appleDate))
}

// Format date for display
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Format date with time for display
export function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Priority label
export function priorityLabel(priority: number): string {
  switch (priority) {
    case 1:
      return 'High'
    case 5:
      return 'Medium'
    case 9:
      return 'Low'
    default:
      return ''
  }
}
