import Database from 'better-sqlite3'
import MiniSearch from 'minisearch'
import { existsSync, readFileSync } from 'node:fs'
import { getIndexDbPath, getFuzzyIndexPath, ensureIndex } from './indexer.js'
import type { IndexedReminder, SearchResult, SearchOptions } from './types.js'

let cachedDb: ReturnType<typeof Database> | null = null
let cachedMiniSearch: MiniSearch<IndexedReminder> | null = null

function getDb(): ReturnType<typeof Database> {
  if (!cachedDb) {
    const dbPath = getIndexDbPath()
    if (!existsSync(dbPath)) {
      throw new Error('Index not found. Run `reminders index` first.')
    }
    cachedDb = new Database(dbPath, { readonly: true })
  }
  return cachedDb
}

function getMiniSearch(): MiniSearch<IndexedReminder> {
  if (!cachedMiniSearch) {
    const fuzzyPath = getFuzzyIndexPath()
    if (!existsSync(fuzzyPath)) {
      throw new Error('Fuzzy index not found. Run `reminders index` first.')
    }
    const raw = readFileSync(fuzzyPath, 'utf-8')
    cachedMiniSearch = MiniSearch.loadJSON<IndexedReminder>(raw, {
      fields: ['title', 'notes', 'listName'],
      storeFields: ['id', 'title', 'notes', 'listName', 'listId', 'completed', 'flagged', 'priority', 'dueDate', 'creationDate', 'completionDate'],
    })
  }
  return cachedMiniSearch
}

function rowToReminder(row: unknown): IndexedReminder {
  const r = row as {
    id: number
    title: string
    notes: string | null
    list_name: string
    list_id: number
    completed: number
    flagged: number
    priority: number
    due_date: number | null
    creation_date: number
    completion_date: number | null
  }
  return {
    id: r.id,
    title: r.title,
    notes: r.notes || '',
    listName: r.list_name,
    listId: r.list_id,
    completed: r.completed === 1,
    flagged: r.flagged === 1,
    priority: r.priority,
    dueDate: r.due_date,
    creationDate: r.creation_date,
    completionDate: r.completion_date,
  }
}

// Search by list name using SQLite
function searchByList(
  db: ReturnType<typeof Database>,
  list: string,
  completed: boolean | undefined,
  limit: number
): SearchResult[] {
  const listLower = list.toLowerCase()

  let completedFilter = ''
  if (completed === true) {
    completedFilter = 'AND completed = 1'
  } else if (completed === false) {
    completedFilter = 'AND completed = 0'
  }

  const query = db.prepare(`
    SELECT id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date
    FROM reminders
    WHERE LOWER(list_name) LIKE ?
      ${completedFilter}
    ORDER BY due_date ASC NULLS LAST, creation_date DESC
    LIMIT ?
  `)

  const pattern = `%${listLower}%`
  const rows = query.all(pattern, limit)

  return rows.map((row) => ({
    reminder: rowToReminder(row),
    score: 1.0,
    matchedTerms: [],
  }))
}

// Search by text with optional filters
function searchByText(
  query: string,
  list: string | undefined,
  completed: boolean | undefined,
  flagged: boolean | undefined,
  limit: number
): SearchResult[] {
  const miniSearch = getMiniSearch()

  const listLower = list?.toLowerCase()

  // When filtering, search with a higher limit
  const hasFilters = list || completed !== undefined || flagged !== undefined
  const searchLimit = hasFilters ? limit * 20 : limit

  const fuzzyResults = miniSearch.search(query, {
    fuzzy: 0.2,
    prefix: true,
    boost: { title: 2, notes: 1.5, listName: 1 },
    filter: (result) => {
      if (listLower) {
        const resultList = (result.listName as string).toLowerCase()
        if (!resultList.includes(listLower)) return false
      }
      if (completed !== undefined) {
        if (result.completed !== completed) return false
      }
      if (flagged === true) {
        if (result.flagged !== true) return false
      }
      return true
    },
  })

  if (fuzzyResults.length === 0) {
    return []
  }

  const results: SearchResult[] = fuzzyResults.slice(0, searchLimit).map((result) => ({
    reminder: {
      id: result.id as number,
      title: result.title as string,
      notes: result.notes as string,
      listName: result.listName as string,
      listId: result.listId as number,
      completed: result.completed as boolean,
      flagged: result.flagged as boolean,
      priority: result.priority as number,
      dueDate: result.dueDate as number | null,
      creationDate: result.creationDate as number,
      completionDate: result.completionDate as number | null,
    },
    score: result.score,
    matchedTerms: result.terms,
  }))

  return results.slice(0, limit)
}

export function search(options: SearchOptions): SearchResult[] {
  const updateResult = ensureIndex()
  if (updateResult !== 'none') {
    clearCaches()
  }

  const { query, list, completed, flagged, limit } = options
  const db = getDb()

  const hasTextQuery = query && query !== '*' && query.trim() !== ''

  if (list && !hasTextQuery) {
    return searchByList(db, list, completed, limit)
  } else if (hasTextQuery) {
    return searchByText(query, list, completed, flagged, limit)
  }

  // No query - return all based on filters
  return getAllReminders(db, completed, flagged, limit)
}

function getAllReminders(
  db: ReturnType<typeof Database>,
  completed: boolean | undefined,
  flagged: boolean | undefined,
  limit: number
): SearchResult[] {
  let completedFilter = ''
  if (completed === true) {
    completedFilter = 'AND completed = 1'
  } else if (completed === false) {
    completedFilter = 'AND completed = 0'
  }

  let flaggedFilter = ''
  if (flagged === true) {
    flaggedFilter = 'AND flagged = 1'
  }

  const query = db.prepare(`
    SELECT id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date
    FROM reminders
    WHERE 1=1
      ${completedFilter}
      ${flaggedFilter}
    ORDER BY due_date ASC NULLS LAST, creation_date DESC
    LIMIT ?
  `)

  const rows = query.all(limit)

  return rows.map((row) => ({
    reminder: rowToReminder(row),
    score: 1.0,
    matchedTerms: [],
  }))
}

function clearCaches(): void {
  if (cachedDb) {
    cachedDb.close()
    cachedDb = null
  }
  cachedMiniSearch = null
}

export function closeConnections(): void {
  clearCaches()
}

// Browse functions

export function getRecentReminders(limit: number): IndexedReminder[] {
  ensureIndex()
  const db = getDb()

  const query = db.prepare(`
    SELECT id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date
    FROM reminders
    ORDER BY creation_date DESC
    LIMIT ?
  `)

  const rows = query.all(limit)
  return rows.map(rowToReminder)
}

export function getPendingReminders(limit: number): IndexedReminder[] {
  ensureIndex()
  const db = getDb()

  const query = db.prepare(`
    SELECT id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date
    FROM reminders
    WHERE completed = 0
    ORDER BY due_date ASC NULLS LAST, creation_date DESC
    LIMIT ?
  `)

  const rows = query.all(limit)
  return rows.map(rowToReminder)
}

export function getCompletedReminders(limit: number): IndexedReminder[] {
  ensureIndex()
  const db = getDb()

  const query = db.prepare(`
    SELECT id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date
    FROM reminders
    WHERE completed = 1
    ORDER BY completion_date DESC
    LIMIT ?
  `)

  const rows = query.all(limit)
  return rows.map(rowToReminder)
}

export function getFlaggedReminders(limit: number): IndexedReminder[] {
  ensureIndex()
  const db = getDb()

  const query = db.prepare(`
    SELECT id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date
    FROM reminders
    WHERE flagged = 1 AND completed = 0
    ORDER BY due_date ASC NULLS LAST, creation_date DESC
    LIMIT ?
  `)

  const rows = query.all(limit)
  return rows.map(rowToReminder)
}

export function getDueReminders(beforeDate: Date, limit: number): IndexedReminder[] {
  ensureIndex()
  const db = getDb()

  const timestamp = Math.floor(beforeDate.getTime() / 1000)

  const query = db.prepare(`
    SELECT id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date
    FROM reminders
    WHERE completed = 0
      AND due_date IS NOT NULL
      AND due_date <= ?
    ORDER BY due_date ASC
    LIMIT ?
  `)

  const rows = query.all(timestamp, limit)
  return rows.map(rowToReminder)
}

export interface ListInfo {
  name: string
  pendingCount: number
  completedCount: number
}

export function getLists(): ListInfo[] {
  ensureIndex()
  const db = getDb()

  const query = db.prepare(`
    SELECT
      list_name as name,
      SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) as pendingCount,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completedCount
    FROM reminders
    WHERE list_name != ''
    GROUP BY list_name
    ORDER BY name
  `)

  const rows = query.all() as ListInfo[]
  return rows
}

export function getRemindersInList(listName: string, showCompleted: boolean, limit: number): IndexedReminder[] {
  ensureIndex()
  const db = getDb()

  const listLower = listName.toLowerCase()
  const completedFilter = showCompleted ? '' : 'AND completed = 0'

  const query = db.prepare(`
    SELECT id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date
    FROM reminders
    WHERE LOWER(list_name) LIKE ?
      ${completedFilter}
    ORDER BY completed ASC, due_date ASC NULLS LAST, creation_date DESC
    LIMIT ?
  `)

  const pattern = `%${listLower}%`
  const rows = query.all(pattern, limit)
  return rows.map(rowToReminder)
}
