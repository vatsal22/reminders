import { execFileSync } from 'child_process'

export interface CreateReminderOptions {
  title: string
  list?: string
  notes?: string
  dueDate?: Date
  priority?: 'low' | 'medium' | 'high'
  flagged?: boolean
}

export interface CreatedReminder {
  title: string
  list: string
  id: string
  wasGuessed: boolean
}

export interface ListForGuessing {
  name: string
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Common keywords that might indicate a specific list
const LIST_KEYWORDS: Record<string, string[]> = {
  groceries: ['grocery', 'groceries', 'food', 'milk', 'bread', 'eggs', 'vegetables', 'fruit', 'meat', 'cheese', 'butter', 'shopping', 'store', 'market', 'supermarket'],
  shopping: ['buy', 'purchase', 'order', 'amazon', 'shop'],
  work: ['work', 'meeting', 'project', 'client', 'deadline', 'presentation', 'report', 'email', 'call', 'office', 'boss', 'colleague'],
  home: ['home', 'house', 'clean', 'repair', 'fix', 'maintenance', 'yard', 'garden', 'laundry'],
  family: ['family', 'mom', 'dad', 'parent', 'kid', 'child', 'spouse', 'wife', 'husband', 'brother', 'sister'],
  health: ['health', 'doctor', 'appointment', 'medicine', 'prescription', 'gym', 'exercise', 'workout', 'dentist'],
  finance: ['pay', 'bill', 'bank', 'money', 'finance', 'tax', 'invoice', 'budget'],
  travel: ['travel', 'trip', 'flight', 'hotel', 'vacation', 'pack', 'passport'],
}

export function guessListForReminder(
  title: string,
  notes: string | undefined,
  availableLists: ListForGuessing[]
): string | null {
  if (availableLists.length === 0) {
    return null
  }

  const text = `${title} ${notes || ''}`.toLowerCase()
  const listNames = availableLists.map(l => l.name)
  const listNamesLower = listNames.map(n => n.toLowerCase())

  // 1. Check for exact list name match in the text
  for (let i = 0; i < listNames.length; i++) {
    const listLower = listNamesLower[i]
    if (listLower && text.includes(listLower)) {
      return listNames[i]
    }
  }

  // 2. Check for keyword matches
  for (const [category, keywords] of Object.entries(LIST_KEYWORDS)) {
    const hasKeyword = keywords.some(kw => text.includes(kw))
    if (hasKeyword) {
      // Find a list that matches this category
      for (let i = 0; i < listNames.length; i++) {
        const listLower = listNamesLower[i]
        if (listLower && (listLower.includes(category) || category.includes(listLower))) {
          return listNames[i]
        }
      }
    }
  }

  // 3. No match found - return null (will use default "Reminders")
  return null
}

function formatAppleScriptDate(date: Date): string {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `date "${month}/${day}/${year} ${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}"`
}

export interface CreateReminderWithGuessOptions extends CreateReminderOptions {
  availableLists?: ListForGuessing[]
}

export function createReminder(options: CreateReminderWithGuessOptions): CreatedReminder {
  const { title, list, notes, dueDate, priority, flagged, availableLists } = options

  let listName: string
  let wasGuessed = false

  if (list) {
    listName = list
  } else if (availableLists && availableLists.length > 0) {
    const guessed = guessListForReminder(title, notes, availableLists)
    if (guessed) {
      listName = guessed
      wasGuessed = true
    } else {
      listName = 'Reminders'
    }
  } else {
    listName = 'Reminders'
  }

  const escapedTitle = escapeAppleScript(title)
  const escapedList = escapeAppleScript(listName)

  let properties = `name:"${escapedTitle}"`

  if (notes) {
    properties += `, body:"${escapeAppleScript(notes)}"`
  }

  if (dueDate) {
    properties += `, due date:${formatAppleScriptDate(dueDate)}`
  }

  if (priority) {
    const priorityValue = priority === 'high' ? 1 : priority === 'medium' ? 5 : 9
    properties += `, priority:${priorityValue}`
  }

  if (flagged) {
    properties += `, flagged:true`
  }

  const script = `
tell application "Reminders"
  set targetList to list "${escapedList}"
  set newReminder to make new reminder at end of targetList with properties {${properties}}
  set reminderId to id of newReminder
  return reminderId
end tell
`

  try {
    const result = execFileSync('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf-8',
      timeout: 30000,
    }).trim()

    return {
      title,
      list: listName,
      id: result,
      wasGuessed,
    }
  } catch (error) {
    const message = (error as Error).message
    if (message.includes('list') && message.includes("doesn't exist")) {
      throw new Error(`List "${listName}" does not exist in Reminders`)
    }
    throw new Error(`Failed to create reminder: ${message}`)
  }
}

export function getAvailableLists(): string[] {
  const script = `
tell application "Reminders"
  set listNames to {}
  repeat with aList in lists
    set end of listNames to name of aList
  end repeat
  return listNames
end tell
`

  try {
    const result = execFileSync('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf-8',
      timeout: 30000,
    }).trim()

    return result.split(', ').filter(Boolean)
  } catch (error) {
    throw new Error(`Failed to get reminder lists: ${(error as Error).message}`)
  }
}

export interface EditReminderOptions {
  searchTitle: string
  searchList?: string
  newTitle?: string
  notes?: string
  dueDate?: Date | null  // null to clear the due date
  priority?: 'low' | 'medium' | 'high' | 'none'
  flagged?: boolean
}

export interface EditReminderResult {
  originalTitle: string
  newTitle: string
  list: string
}

export function editReminder(options: EditReminderOptions): EditReminderResult {
  const { searchTitle, searchList, newTitle, notes, dueDate, priority, flagged } = options
  const escapedSearchTitle = escapeAppleScript(searchTitle)

  // Build the property updates
  const updates: string[] = []

  if (newTitle !== undefined) {
    updates.push(`set name of targetReminder to "${escapeAppleScript(newTitle)}"`)
  }

  if (notes !== undefined) {
    updates.push(`set body of targetReminder to "${escapeAppleScript(notes)}"`)
  }

  if (dueDate === null) {
    updates.push(`set due date of targetReminder to missing value`)
  } else if (dueDate !== undefined) {
    updates.push(`set due date of targetReminder to ${formatAppleScriptDate(dueDate)}`)
  }

  if (priority !== undefined) {
    const priorityValue = priority === 'high' ? 1 : priority === 'medium' ? 5 : priority === 'low' ? 9 : 0
    updates.push(`set priority of targetReminder to ${priorityValue}`)
  }

  if (flagged !== undefined) {
    updates.push(`set flagged of targetReminder to ${flagged}`)
  }

  if (updates.length === 0) {
    throw new Error('No updates specified')
  }

  const updatesScript = updates.join('\n        ')

  let script: string

  if (searchList) {
    const escapedList = escapeAppleScript(searchList)
    script = `
tell application "Reminders"
  set targetList to list "${escapedList}"
  repeat with r in reminders of targetList
    if completed of r is false and name of r contains "${escapedSearchTitle}" then
      set targetReminder to r
      set originalName to name of targetReminder
      ${updatesScript}
      return originalName & "|" & (name of targetReminder) & "|" & "${escapedList}"
    end if
  end repeat
  error "No matching reminder found"
end tell
`
  } else {
    script = `
tell application "Reminders"
  repeat with aList in lists
    repeat with r in reminders of aList
      if completed of r is false and name of r contains "${escapedSearchTitle}" then
        set targetReminder to r
        set originalName to name of targetReminder
        ${updatesScript}
        return originalName & "|" & (name of targetReminder) & "|" & (name of aList)
      end if
    end repeat
  end repeat
  error "No matching reminder found"
end tell
`
  }

  try {
    const result = execFileSync('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf-8',
      timeout: 60000,
    }).trim()

    const [originalTitle, finalTitle, listName] = result.split('|')
    return {
      originalTitle: originalTitle || searchTitle,
      newTitle: finalTitle || newTitle || searchTitle,
      list: listName || searchList || 'Unknown',
    }
  } catch (error) {
    const message = (error as Error).message
    if (message.includes('No matching reminder found')) {
      throw new Error(`No pending reminder found matching "${searchTitle}"`)
    }
    if (message.includes("doesn't exist")) {
      throw new Error(`List "${searchList}" does not exist`)
    }
    throw new Error(`Failed to edit reminder: ${message}`)
  }
}

export interface CompleteReminderResult {
  title: string
  list: string
  completed: boolean
}

export function completeReminder(title: string, list?: string): CompleteReminderResult {
  const escapedTitle = escapeAppleScript(title)

  let script: string

  if (list) {
    const escapedList = escapeAppleScript(list)
    script = `
tell application "Reminders"
  set targetList to list "${escapedList}"
  repeat with r in reminders of targetList
    if completed of r is false and name of r contains "${escapedTitle}" then
      set completed of r to true
      return (name of r) & "|" & "${escapedList}"
    end if
  end repeat
  error "No matching reminder found"
end tell
`
  } else {
    script = `
tell application "Reminders"
  repeat with aList in lists
    repeat with r in reminders of aList
      if completed of r is false and name of r contains "${escapedTitle}" then
        set completed of r to true
        return (name of r) & "|" & (name of aList)
      end if
    end repeat
  end repeat
  error "No matching reminder found"
end tell
`
  }

  try {
    const result = execFileSync('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf-8',
      timeout: 60000,
    }).trim()

    const [reminderName, listName] = result.split('|')
    return {
      title: reminderName || title,
      list: listName || list || 'Unknown',
      completed: true,
    }
  } catch (error) {
    const message = (error as Error).message
    if (message.includes('No matching reminder found')) {
      throw new Error(`No pending reminder found matching "${title}"`)
    }
    if (message.includes("doesn't exist")) {
      throw new Error(`List "${list}" does not exist`)
    }
    throw new Error(`Failed to complete reminder: ${message}`)
  }
}
