import Database from 'better-sqlite3'
import MiniSearch from 'minisearch'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IndexedReminder, IndexStats, JoinedReminder } from './types.js'
import { appleToUnix } from './types.js'

const REMINDERS_DIR = join(homedir(), '.reminders')
const INDEX_DB_PATH = join(REMINDERS_DIR, 'index.db')
const FUZZY_INDEX_PATH = join(REMINDERS_DIR, 'fuzzy.json')
const STATS_PATH = join(REMINDERS_DIR, 'stats.json')
const SOURCE_DIR = join(homedir(), 'Library', 'Group Containers', 'group.com.apple.reminders', 'Container_v1', 'Stores')

export function ensureIndexDir(): void {
  if (!existsSync(REMINDERS_DIR)) {
    mkdirSync(REMINDERS_DIR, { recursive: true })
  }
}

export function getIndexDbPath(): string {
  return INDEX_DB_PATH
}

export function getFuzzyIndexPath(): string {
  return FUZZY_INDEX_PATH
}

export function indexExists(): boolean {
  return existsSync(INDEX_DB_PATH) && existsSync(FUZZY_INDEX_PATH)
}

// Find all Reminders SQLite databases
function findRemindersDatabases(): string[] {
  if (!existsSync(SOURCE_DIR)) {
    return []
  }

  return readdirSync(SOURCE_DIR)
    .filter(f => f.startsWith('Data-') && f.endsWith('.sqlite'))
    .map(f => join(SOURCE_DIR, f))
}

// Get the newest modification time of any source database
function getSourceModTime(): number {
  const dbs = findRemindersDatabases()
  let newest = 0
  for (const db of dbs) {
    try {
      const mtime = statSync(db).mtime.getTime()
      if (mtime > newest) newest = mtime
    } catch {
      // Skip if can't stat
    }
  }
  return newest
}

// Check if the source databases have been modified since the index was built
export function indexNeedsRebuild(): boolean {
  if (!indexExists()) {
    return true
  }

  const dbs = findRemindersDatabases()
  if (dbs.length === 0) {
    return false // No source db, can't rebuild anyway
  }

  try {
    const sourceModTime = getSourceModTime()
    const indexModTime = statSync(INDEX_DB_PATH).mtime.getTime()
    return sourceModTime > indexModTime
  } catch {
    return true // If we can't check, rebuild to be safe
  }
}

// Ensure index is up to date
export function ensureIndex(
  onProgress?: (progress: IndexProgress) => void
): 'none' | 'incremental' | 'full' {
  if (!indexNeedsRebuild()) {
    return 'none'
  }

  // Try incremental update first
  const stats = getStats()
  if (stats?.lastIndexedRowid && indexExists()) {
    const result = updateIndex(onProgress)
    if (result !== null) {
      return 'incremental'
    }
  }

  // Fall back to full rebuild
  buildIndex(onProgress)
  return 'full'
}

export function getStats(): IndexStats | null {
  if (!existsSync(STATS_PATH)) {
    return null
  }
  const raw = readFileSync(STATS_PATH, 'utf-8')
  const data = JSON.parse(raw)
  return {
    ...data,
    indexedAt: new Date(data.indexedAt),
    oldestReminder: new Date(data.oldestReminder),
    newestReminder: new Date(data.newestReminder),
  }
}

function saveStats(stats: IndexStats): void {
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2))
}

export interface IndexProgress {
  current: number
  total: number
  phase: 'reading' | 'indexing-fts' | 'indexing-fuzzy' | 'done'
}

// Query all databases and combine results
// Returns reminders with globally unique IDs (combining db index and original ID)
function queryAllDatabases(): JoinedReminder[] {
  const dbs = findRemindersDatabases()
  if (dbs.length === 0) {
    throw new Error(
      `Reminders databases not found at ${SOURCE_DIR}. Make sure you have Full Disk Access enabled for your terminal.`
    )
  }

  const allReminders: JoinedReminder[] = []
  const seenTitles = new Set<string>() // Dedupe by title+list combo
  const tempDir = join(REMINDERS_DIR, 'temp')
  let globalIdCounter = 1

  // Create temp directory for database copies
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }

  for (const dbPath of dbs) {
    // Copy database to temp to avoid locking
    const tempPath = join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`)
    try {
      copyFileSync(dbPath, tempPath)
      const db = new Database(tempPath, { readonly: true })

      const query = `
        SELECT
          r.Z_PK as id,
          r.ZTITLE as title,
          r.ZNOTES as notes,
          r.ZCOMPLETED as completed,
          r.ZFLAGGED as flagged,
          r.ZPRIORITY as priority,
          r.ZDUEDATE as dueDate,
          r.ZCREATIONDATE as creationDate,
          r.ZLASTMODIFIEDDATE as lastModifiedDate,
          r.ZCOMPLETIONDATE as completionDate,
          r.ZLIST as listId,
          l.ZNAME as listName,
          r.ZMARKEDFORDELETION as markedForDeletion
        FROM ZREMCDREMINDER r
        LEFT JOIN ZREMCDBASELIST l ON r.ZLIST = l.Z_PK
        WHERE r.ZMARKEDFORDELETION = 0
        ORDER BY r.ZCREATIONDATE ASC
      `

      const reminders = db.prepare(query).all() as JoinedReminder[]

      // Assign globally unique IDs and dedupe
      for (const r of reminders) {
        const key = `${r.title}|${r.listName}|${r.creationDate}`
        if (!seenTitles.has(key)) {
          seenTitles.add(key)
          r.id = globalIdCounter++
          allReminders.push(r)
        }
      }

      db.close()
    } catch {
      // Skip databases that can't be read
    } finally {
      // Clean up temp file
      try {
        unlinkSync(tempPath)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // Clean up temp directory
  try {
    const tempFiles = readdirSync(tempDir)
    for (const f of tempFiles) {
      try {
        unlinkSync(join(tempDir, f))
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore
  }

  return allReminders
}

export function buildIndex(
  onProgress?: (progress: IndexProgress) => void
): IndexStats {
  ensureIndexDir()

  const reminders = queryAllDatabases()
  const total = reminders.length
  onProgress?.({ current: 0, total, phase: 'reading' })

  // Create our index database
  if (existsSync(INDEX_DB_PATH)) {
    unlinkSync(INDEX_DB_PATH)
  }

  const indexDb = new Database(INDEX_DB_PATH)

  // Create FTS5 virtual table
  indexDb.exec(`
    CREATE VIRTUAL TABLE reminders_fts USING fts5(
      id,
      title,
      notes,
      list_name,
      list_id,
      completed,
      flagged,
      priority,
      due_date,
      creation_date,
      completion_date,
      tokenize = 'porter unicode61'
    );
  `)

  // Also create a regular table for lookups
  indexDb.exec(`
    CREATE TABLE reminders (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      list_name TEXT,
      list_id INTEGER,
      completed INTEGER NOT NULL,
      flagged INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      due_date INTEGER,
      creation_date INTEGER NOT NULL,
      completion_date INTEGER
    );
    CREATE INDEX idx_reminders_list ON reminders(list_id);
    CREATE INDEX idx_reminders_completed ON reminders(completed);
    CREATE INDEX idx_reminders_due_date ON reminders(due_date);
    CREATE INDEX idx_reminders_creation_date ON reminders(creation_date);
  `)

  const insertFts = indexDb.prepare(`
    INSERT INTO reminders_fts (id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertReminders = indexDb.prepare(`
    INSERT INTO reminders (id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Build MiniSearch index for fuzzy matching
  const miniSearch = new MiniSearch<IndexedReminder>({
    fields: ['title', 'notes', 'listName'],
    storeFields: ['id', 'title', 'notes', 'listName', 'listId', 'completed', 'flagged', 'priority', 'dueDate', 'creationDate', 'completionDate'],
    searchOptions: {
      boost: { title: 2, notes: 1.5, listName: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  })

  let oldestDate = Infinity
  let newestDate = 0
  let completedCount = 0
  let pendingCount = 0
  const indexedReminders: IndexedReminder[] = []

  const insertBatch = indexDb.transaction(
    (batch: IndexedReminder[]) => {
      for (const r of batch) {
        insertFts.run(
          r.id,
          r.title,
          r.notes,
          r.listName,
          r.listId,
          r.completed ? 1 : 0,
          r.flagged ? 1 : 0,
          r.priority,
          r.dueDate,
          r.creationDate,
          r.completionDate
        )
        insertReminders.run(
          r.id,
          r.title,
          r.notes,
          r.listName,
          r.listId,
          r.completed ? 1 : 0,
          r.flagged ? 1 : 0,
          r.priority,
          r.dueDate,
          r.creationDate,
          r.completionDate
        )
      }
    }
  )

  const BATCH_SIZE = 1000
  let batch: IndexedReminder[] = []
  let processed = 0

  onProgress?.({ current: 0, total, phase: 'indexing-fts' })

  for (const r of reminders) {
    if (!r.title) continue // Skip reminders without titles

    const creationDate = r.creationDate ? appleToUnix(r.creationDate) : Math.floor(Date.now() / 1000)
    const dueDate = r.dueDate ? appleToUnix(r.dueDate) : null
    const completionDate = r.completionDate ? appleToUnix(r.completionDate) : null

    if (creationDate < oldestDate) oldestDate = creationDate
    if (creationDate > newestDate) newestDate = creationDate

    const isCompleted = r.completed === 1
    if (isCompleted) {
      completedCount++
    } else {
      pendingCount++
    }

    const indexed: IndexedReminder = {
      id: r.id,
      title: r.title || '',
      notes: r.notes || '',
      listName: r.listName || 'Reminders',
      listId: r.listId || 0,
      completed: isCompleted,
      flagged: r.flagged === 1,
      priority: r.priority || 0,
      dueDate,
      creationDate,
      completionDate,
    }

    batch.push(indexed)
    indexedReminders.push(indexed)

    if (batch.length >= BATCH_SIZE) {
      insertBatch(batch)
      batch = []
      processed += BATCH_SIZE
      onProgress?.({ current: processed, total, phase: 'indexing-fts' })
    }
  }

  // Insert remaining reminders
  if (batch.length > 0) {
    insertBatch(batch)
    processed += batch.length
    onProgress?.({ current: processed, total, phase: 'indexing-fts' })
  }

  indexDb.close()

  // Build fuzzy index
  onProgress?.({ current: 0, total: indexedReminders.length, phase: 'indexing-fuzzy' })

  const MINI_BATCH = 5000
  for (let i = 0; i < indexedReminders.length; i += MINI_BATCH) {
    const slice = indexedReminders.slice(i, i + MINI_BATCH)
    miniSearch.addAll(slice)
    onProgress?.({
      current: Math.min(i + MINI_BATCH, indexedReminders.length),
      total: indexedReminders.length,
      phase: 'indexing-fuzzy',
    })
  }

  // Save fuzzy index
  const serialized = JSON.stringify(miniSearch.toJSON())
  writeFileSync(FUZZY_INDEX_PATH, serialized)

  // Count unique lists
  const uniqueLists = new Set(indexedReminders.map(r => r.listId))

  // Find the highest id for incremental updates
  let lastIndexedRowid = 0
  for (const r of indexedReminders) {
    if (r.id > lastIndexedRowid) lastIndexedRowid = r.id
  }

  const stats: IndexStats = {
    totalReminders: indexedReminders.length,
    totalLists: uniqueLists.size,
    completedReminders: completedCount,
    pendingReminders: pendingCount,
    indexedAt: new Date(),
    oldestReminder: new Date(oldestDate * 1000),
    newestReminder: new Date(newestDate * 1000),
    lastIndexedRowid,
  }

  saveStats(stats)
  onProgress?.({ current: total, total, phase: 'done' })

  return stats
}

// Incremental update - only index new reminders since last build
export function updateIndex(
  onProgress?: (progress: IndexProgress) => void
): IndexStats | null {
  const existingStats = getStats()
  if (!existingStats?.lastIndexedRowid) {
    return null
  }

  const dbs = findRemindersDatabases()
  if (dbs.length === 0) {
    throw new Error(
      `Reminders databases not found at ${SOURCE_DIR}. Make sure you have Full Disk Access enabled for your terminal.`
    )
  }

  // Query new reminders from all databases
  const newReminders: JoinedReminder[] = []
  const tempDir = join(REMINDERS_DIR, 'temp')

  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }

  for (const dbPath of dbs) {
    const tempPath = join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`)
    try {
      copyFileSync(dbPath, tempPath)
      const db = new Database(tempPath, { readonly: true })

      const query = `
        SELECT
          r.Z_PK as id,
          r.ZTITLE as title,
          r.ZNOTES as notes,
          r.ZCOMPLETED as completed,
          r.ZFLAGGED as flagged,
          r.ZPRIORITY as priority,
          r.ZDUEDATE as dueDate,
          r.ZCREATIONDATE as creationDate,
          r.ZLASTMODIFIEDDATE as lastModifiedDate,
          r.ZCOMPLETIONDATE as completionDate,
          r.ZLIST as listId,
          l.ZNAME as listName,
          r.ZMARKEDFORDELETION as markedForDeletion
        FROM ZREMCDREMINDER r
        LEFT JOIN ZREMCDBASELIST l ON r.ZLIST = l.Z_PK
        WHERE r.ZMARKEDFORDELETION = 0
          AND r.Z_PK > ?
        ORDER BY r.ZCREATIONDATE ASC
      `

      const reminders = db.prepare(query).all(existingStats.lastIndexedRowid) as JoinedReminder[]
      newReminders.push(...reminders)
      db.close()
    } catch {
      // Skip databases that can't be read
    } finally {
      try {
        unlinkSync(tempPath)
      } catch {
        // Ignore
      }
    }
  }

  if (newReminders.length === 0) {
    const updatedStats: IndexStats = {
      ...existingStats,
      indexedAt: new Date(),
    }
    saveStats(updatedStats)
    onProgress?.({ current: 0, total: 0, phase: 'done' })
    return updatedStats
  }

  const total = newReminders.length
  onProgress?.({ current: 0, total, phase: 'indexing-fts' })

  // Open existing index database
  const indexDb = new Database(INDEX_DB_PATH)

  const insertFts = indexDb.prepare(`
    INSERT INTO reminders_fts (id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertReminders = indexDb.prepare(`
    INSERT INTO reminders (id, title, notes, list_name, list_id, completed, flagged, priority, due_date, creation_date, completion_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Load existing MiniSearch index
  const fuzzyData = readFileSync(FUZZY_INDEX_PATH, 'utf-8')
  const miniSearch = MiniSearch.loadJSON<IndexedReminder>(fuzzyData, {
    fields: ['title', 'notes', 'listName'],
    storeFields: ['id', 'title', 'notes', 'listName', 'listId', 'completed', 'flagged', 'priority', 'dueDate', 'creationDate', 'completionDate'],
    searchOptions: {
      boost: { title: 2, notes: 1.5, listName: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  })

  const indexedReminders: IndexedReminder[] = []
  let newestDate = existingStats.newestReminder.getTime() / 1000
  let lastRowid = existingStats.lastIndexedRowid
  let newCompleted = 0
  let newPending = 0

  const insertBatch = indexDb.transaction(
    (batch: IndexedReminder[]) => {
      for (const r of batch) {
        insertFts.run(
          r.id,
          r.title,
          r.notes,
          r.listName,
          r.listId,
          r.completed ? 1 : 0,
          r.flagged ? 1 : 0,
          r.priority,
          r.dueDate,
          r.creationDate,
          r.completionDate
        )
        insertReminders.run(
          r.id,
          r.title,
          r.notes,
          r.listName,
          r.listId,
          r.completed ? 1 : 0,
          r.flagged ? 1 : 0,
          r.priority,
          r.dueDate,
          r.creationDate,
          r.completionDate
        )
      }
    }
  )

  const BATCH_SIZE = 1000
  let batch: IndexedReminder[] = []
  let processed = 0

  for (const r of newReminders) {
    if (!r.title) continue

    const creationDate = r.creationDate ? appleToUnix(r.creationDate) : Math.floor(Date.now() / 1000)
    const dueDate = r.dueDate ? appleToUnix(r.dueDate) : null
    const completionDate = r.completionDate ? appleToUnix(r.completionDate) : null

    if (creationDate > newestDate) newestDate = creationDate
    if (r.id > lastRowid) lastRowid = r.id

    const isCompleted = r.completed === 1
    if (isCompleted) {
      newCompleted++
    } else {
      newPending++
    }

    const indexed: IndexedReminder = {
      id: r.id,
      title: r.title || '',
      notes: r.notes || '',
      listName: r.listName || 'Reminders',
      listId: r.listId || 0,
      completed: isCompleted,
      flagged: r.flagged === 1,
      priority: r.priority || 0,
      dueDate,
      creationDate,
      completionDate,
    }

    batch.push(indexed)
    indexedReminders.push(indexed)

    if (batch.length >= BATCH_SIZE) {
      insertBatch(batch)
      batch = []
      processed += BATCH_SIZE
      onProgress?.({ current: processed, total, phase: 'indexing-fts' })
    }
  }

  if (batch.length > 0) {
    insertBatch(batch)
    processed += batch.length
    onProgress?.({ current: processed, total, phase: 'indexing-fts' })
  }

  indexDb.close()

  // Add new reminders to MiniSearch
  onProgress?.({ current: 0, total: indexedReminders.length, phase: 'indexing-fuzzy' })
  miniSearch.addAll(indexedReminders)
  onProgress?.({ current: indexedReminders.length, total: indexedReminders.length, phase: 'indexing-fuzzy' })

  // Save updated fuzzy index
  const serialized = JSON.stringify(miniSearch.toJSON())
  writeFileSync(FUZZY_INDEX_PATH, serialized)

  const updatedStats: IndexStats = {
    totalReminders: existingStats.totalReminders + indexedReminders.length,
    totalLists: existingStats.totalLists,
    completedReminders: existingStats.completedReminders + newCompleted,
    pendingReminders: existingStats.pendingReminders + newPending,
    indexedAt: new Date(),
    oldestReminder: existingStats.oldestReminder,
    newestReminder: new Date(newestDate * 1000),
    lastIndexedRowid: lastRowid,
  }

  saveStats(updatedStats)
  onProgress?.({ current: total, total, phase: 'done' })

  return updatedStats
}
