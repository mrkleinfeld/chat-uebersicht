import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatPlanItem, ChatRow, ChatView } from '../types'

// Seitenleiste „Chats“: zeigt alle Chats der Desktop-App, die gerade arbeiten
// oder in den letzten Stunden gearbeitet haben, mit Unterchats eingerückt.
// Die Aufgabe kommt aus dem Aufgaben-Plan (update_plan) des jeweiligen Chats:
// Jeder Chat, in dem dieser Mod läuft, schreibt seinen Stand in eine kleine
// Datei unter ~/.claude/chat-uebersicht/, und jedes Panel liest alle Dateien.

const PANE = 'chats'
const TITLE = 'Chats'
const POLL_MS = 4000
const RECENT_MS = 3 * 60 * 60 * 1000
const SERVER = 'ccd_session_mgmt'
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'
const ASK_TOOL = 'AskUserQuestion'
const NOT_FROM_PERSON = new Set<string>([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'channel',
  'coordinator',
  'observer',
  'observer-activity',
  'plugin',
])
// Farben: arbeitet blau, wartet orange, fertig grün.
const WORKING_COLOR = 'suggestion'
const WAITING_COLOR = 'claude'
const DONE_COLOR = 'success'

const plan = atom({ plugin: 'chat-uebersicht', key: 'plan' } as const, [] as ChatPlanItem[], {
  shape: 'plan-1',
})
const waiting = atom({ plugin: 'chat-uebersicht', key: 'waiting' } as const, false)
// Ob das Panel in diesem Chat schon einmal als Widget geöffnet wurde.
const seated = atom({ plugin: 'chat-uebersicht', key: 'seated' } as const, false)
const view = atom(
  { plugin: 'chat-uebersicht', key: 'view' } as const,
  { rows: [], offsetMin: 0 } as ChatView,
  { shape: 'view-2' },
)

type Session = {
  sessionId: string
  title?: string
  isArchived?: boolean
  isRunning?: boolean
  lastActivityAt?: string
  startedBy?: string
  // nur bei get_session: der Hauptchat, aus dem dieser Chat gestartet wurde
  parentSessionId?: string
  detached?: boolean
  link?: string
}

type StatusFile = { v: 1; plan: ChatPlanItem[]; agents: string[]; waiting?: boolean }

type PlanInput = {
  items?: { content?: unknown; status?: unknown }[]
  advance?: boolean
  done?: number[]
  start?: number
}

// Module variables start over on a reload; that only costs one extra write.
let isBusy = false
let lastWritten = ''
let hasOpened = false
let offsetMin: number | undefined

// Ersatz-Satz für Chats ohne Schritt: die letzte Meldung des Chats, je Chat
// zwischengespeichert, damit sein Verlauf nicht bei jeder Runde gelesen wird.
const NOTE_EVERY_MS = 15000
const notes = new Map<string, { activity: string; at: number; note?: string }>()

function firstSentence(text: string) {
  const plain = text
    .replace(/\*\*|__|`|^#+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const end = plain.search(/[.!?:](\s|$)/)
  const sentence = end > 0 ? plain.slice(0, end + 1) : plain
  if (sentence.length <= 90) return sentence

  return `${sentence.slice(0, 88).replace(/\s+\S*$/, '')} …`
}

// Aus dem Verlauf (neueste Meldung zuletzt) die letzte Textmeldung des Chats,
// solange danach keine neue Nachricht an ihn kam.
function lastNote(transcript: string) {
  const parts = transcript.split(/^\[(assistant|user)\] /m)
  for (let i = parts.length - 2; i >= 1; i -= 2) {
    const role = parts[i]
    const body = (parts[i + 1] ?? '').trim()
    if (role === 'user') return undefined
    if (body === '' || /^\(called [^)]*\)$/.test(body)) continue

    return firstSentence(body)
  }

  return undefined
}

async function noteFor($: EngineInterface, id: string, activity: string, now: number) {
  const cached = notes.get(id)
  if (cached && (cached.activity === activity || now - cached.at < NOTE_EVERY_MS)) {
    return cached.note
  }
  let note: string | undefined
  try {
    const result = await $.mcp.call(SERVER, 'list_events', { session_id: id, limit: 40 })
    let text = ''
    for (const block of result.content) if (block.type === 'text') text += block.text
    if (!result.isError) note = lastNote(text)
  } catch {
    note = cached?.note
  }
  notes.set(id, { activity, at: now, note })

  return note
}

// Zeitverschiebung des Macs einmal pro Laden lesen („+0100“ → 60).
async function localOffset($: EngineInterface) {
  if (offsetMin !== undefined) return offsetMin
  try {
    const { stdout } = await $.process.run(['date', '+%z'])
    const match = /^([+-])(\d\d)(\d\d)/.exec(stdout.trim())
    if (match) {
      const minutes = Number(match[2]) * 60 + Number(match[3])
      offsetMin = match[1] === '-' ? -minutes : minutes
    }
  } catch {
    // ohne Ortszeit bleibt es bei UTC
  }
  offsetMin ??= 0

  return offsetMin
}

function clock(ms: number, offset: number) {
  const time = new Date(ms + offset * 60000)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}`
}

function asStatus(value: unknown): ChatPlanItem['status'] {
  return value === 'in_progress' || value === 'completed' ? value : 'pending'
}

function applyPlan(prev: readonly ChatPlanItem[], input: PlanInput): ChatPlanItem[] {
  if (Array.isArray(input.items)) {
    return input.items.map(item => ({
      content: String(item.content ?? ''),
      status: asStatus(item.status),
    }))
  }
  const list = prev.map(item => ({ ...item }))
  if (input.advance) {
    const current = list.find(item => item.status === 'in_progress')
    if (current) current.status = 'completed'
    const following = list.find(item => item.status === 'pending')
    if (following) following.status = 'in_progress'
  }
  for (const n of input.done ?? []) {
    const item = list[n - 1]
    if (item) item.status = 'completed'
  }
  const started = typeof input.start === 'number' ? list[input.start - 1] : undefined
  if (started) {
    for (const item of list) if (item.status === 'in_progress') item.status = 'pending'
    started.status = 'in_progress'
  }

  return list
}

async function mcpJson($: EngineInterface, tool: string, args: Record<string, unknown>) {
  const result = await $.mcp.call(SERVER, tool, args)
  let text = ''
  for (const block of result.content) if (block.type === 'text') text += block.text
  if (result.isError) throw new Error(text || `${tool} fehlgeschlagen`)

  return JSON.parse(text) as unknown
}

async function statusDir($: EngineInterface) {
  const home = await $.env.get('HOME')

  return `${home ?? '~'}/.claude/chat-uebersicht`
}

async function refresh($: EngineInterface) {
  if (isBusy) return
  isBusy = true
  try {
    const [listed, self] = await Promise.all([
      mcpJson($, 'list_sessions', { limit: 30 }),
      mcpJson($, 'get_session', { session_id: 'self' }),
    ])
    const selfSession = { ...(self as Session) }
    // get_session nennt den Hauptchat „parentSessionId“, list_sessions „startedBy“.
    if (!selfSession.startedBy && selfSession.parentSessionId && !selfSession.detached) {
      selfSession.startedBy = selfSession.parentSessionId
    }
    const dir = await statusDir($)

    // Den eigenen Stand für die anderen Chats ablegen.
    const agents = (await $.agent.list())
      .filter(agent => agent.status === 'running' || agent.status === 'pending')
      .map(agent => agent.description)
      .filter(text => text.length > 0)
    const own: StatusFile = {
      v: 1,
      plan: [...(await read($, plan))],
      agents,
      waiting: await read($, waiting),
    }
    const ownText = JSON.stringify(own)
    if (ownText !== lastWritten) {
      await $.fs.write(`${dir}/${selfSession.sessionId}.json`, ownText)
      lastWritten = ownText
    }

    const now = await $.clock.now()
    const seen = new Set<string>()
    const sessions = [selfSession, ...(Array.isArray(listed) ? (listed as Session[]) : [])].filter(
      session => {
        if (!session?.sessionId || session.isArchived || seen.has(session.sessionId)) return false
        seen.add(session.sessionId)
        const last = Date.parse(session.lastActivityAt ?? '') || 0

        return (
          session.sessionId === selfSession.sessionId ||
          session.isRunning === true ||
          now - last < RECENT_MS
        )
      },
    )

    const names = new Set(
      (await $.fs.list(dir).catch(() => [])).map(entry => entry.name),
    )
    const rows: ChatRow[] = []
    for (const session of sessions) {
      const isSelf = session.sessionId === selfSession.sessionId
      let status: StatusFile | undefined = isSelf ? own : undefined
      if (!isSelf && names.has(`${session.sessionId}.json`)) {
        status = await $.fs
          .read(`${dir}/${session.sessionId}.json`)
          .then(text => JSON.parse(text) as StatusFile)
          .catch(() => undefined)
      }
      const steps = Array.isArray(status?.plan) ? status.plan : []
      const row: ChatRow = {
        id: session.sessionId,
        title: session.title?.trim() || 'Neuer Chat',
        isRunning: session.isRunning === true,
        isWaiting: status?.waiting === true,
        isSelf,
        lastActivityAt: Date.parse(session.lastActivityAt ?? '') || 0,
        agents: Array.isArray(status?.agents) ? status.agents.map(String) : [],
      }
      if (session.startedBy) row.parentId = session.startedBy
      if (session.link?.startsWith('claude://')) row.link = session.link
      const task = steps.find(step => step.status === 'in_progress')?.content
      if (task) row.task = task
      else if (!isSelf && row.isRunning && !row.isWaiting) {
        const note = await noteFor($, session.sessionId, session.lastActivityAt ?? '', now)
        if (note) row.note = note
      }
      if (steps.length > 0) {
        row.stepTotal = steps.length
        row.stepDone = steps.filter(step => step.status === 'completed').length
      }
      rows.push(row)
    }

    const next: ChatView = { rows, offsetMin: await localOffset($) }
    const before = await read($, view)
    if (JSON.stringify(before) !== JSON.stringify(next)) await update($, view, () => next)
    // Das Panel erst öffnen, wenn die Chat-Liste der Desktop-App erreichbar ist.
    if (!hasOpened) {
      hasOpened = true
      // Die App liest „Widget“ nur beim ersten Zeigen. Ein Panel, das noch als
      // eigene Spalte offen ist, wird deshalb einmal geschlossen und neu geöffnet.
      if (!(await read($, seated))) {
        await $.ui.close({ id: PANE })
        await update($, seated, () => true)
      }
      void $.ui.open({ id: PANE, title: TITLE, placement: 'widget' })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, view, old => ({ ...old, error: message.slice(0, 200) }))
  } finally {
    isBusy = false
  }
}

// Reihenfolge: Familien, in denen gerade jemand arbeitet, zuerst; sonst die
// zuletzt aktive oben. Unterchats stehen unter ihrem Hauptchat.
function ordered(rows: readonly ChatRow[]) {
  const ids = new Set(rows.map(row => row.id))
  const childrenOf = (id: string) => rows.filter(row => row.parentId === id)
  const family = (row: ChatRow): ChatRow[] => [row, ...childrenOf(row.id).flatMap(family)]
  const rank = (members: ChatRow[]) => ({
    isRunning: members.some(member => member.isRunning),
    last: Math.max(...members.map(member => member.lastActivityAt)),
  })
  const byRank = (a: ChatRow, b: ChatRow) => {
    const ra = rank(family(a))
    const rb = rank(family(b))
    if (ra.isRunning !== rb.isRunning) return ra.isRunning ? -1 : 1

    return rb.last - ra.last
  }
  const out: { row: ChatRow; depth: number }[] = []
  const walk = (row: ChatRow, depth: number, trail: Set<string>) => {
    if (trail.has(row.id)) return
    out.push({ row, depth })
    const next = new Set(trail).add(row.id)
    for (const child of [...childrenOf(row.id)].sort(byRank)) walk(child, depth + 1, next)
  }
  const tops = rows.filter(row => !row.parentId || !ids.has(row.parentId)).sort(byRank)
  for (const top of tops) walk(top, 0, new Set())

  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chats',
      description: 'Zeigt, welche Chats gerade arbeiten und woran',
    })
    $.clock.every(POLL_MS, () => {
      void refresh($)
    })
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'chats' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, placement: 'widget' })
    void refresh($)

    return { text: 'Die Chat-Übersicht ist offen.' }
  })

  // Neue Nachricht: Der alte Plan gilt nicht mehr.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text.trim() !== '') {
      await update($, plan, () => [])
      void refresh($)
    }

    return next(e)
  })

  // „Wartet auf dich“ endet erst, wenn du selbst schreibst. Nachrichten anderer
  // Chats oder fertige Hintergrund-Aufgaben beantworten deine Frage nicht.
  on('prompt.submit', async ($, e, next) => {
    if (!NOT_FROM_PERSON.has(e.origin.kind)) {
      await update($, waiting, () => false)
      void refresh($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Eine Frage mit Auswahl an dich: wartet, bis du geantwortet hast.
  on('tool.call', { tool: ASK_TOOL }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, waiting, () => true)
    void refresh($)
    try {
      return await next(e)
    } finally {
      await update($, waiting, () => false)
      void refresh($)
    }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: PLAN_TOOL }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && !('deny' in result && result.deny)) {
      const input = e as unknown as PlanInput
      await update($, plan, prev => applyPlan(prev, input))
      void refresh($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: WRAP_TOOL }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await update($, plan, prev => prev.map(item => ({ ...item, status: 'completed' as const })))
      // Endet die Runde mit einer Frage an dich, wartet der Chat auf dich.
      const ask = (e as unknown as { ask?: unknown }).ask
      if (typeof ask === 'string' && ask.trim() !== '') await update($, waiting, () => true)
      void refresh($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Ein Klick auf den Namen öffnet den Chat über seinen App-Link (macOS „open“).
    const openChat = (link: string) => {
      void $.process.run(['open', link]).catch(() => undefined)
    }
    const { rows, error, offsetMin: offset } = await read($, view)
    const list = ordered(rows)
    const waits = rows.filter(row => row.isWaiting).length
    const working = rows.filter(row => row.isRunning && !row.isWaiting).length
    const done = rows.length - working - waits
    const summary = [
      working > 0 ? `${working} ${working === 1 ? 'arbeitet' : 'arbeiten'}` : '',
      waits > 0 ? `${waits} ${waits === 1 ? 'wartet' : 'warten'} auf dich` : '',
      done > 0 ? `${done} fertig` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const dot = (row: ChatRow) =>
      row.isWaiting ? WAITING_COLOR : row.isRunning ? WORKING_COLOR : DONE_COLOR

    // Als Widget (z. B. in der Spalte unter „Konnektoren“) etwas enger.
    const isWidget = e.props.placement === 'widget'

    return (
      <Box flexDirection="column" gap={isWidget ? 'sm' : 1}>
        {summary !== '' && <Text dimColor>{summary}</Text>}
        {list.length === 0 && <Text dimColor>Gerade arbeitet kein Chat.</Text>}
        {list.map(({ row, depth }) => (
          <Box key={row.id} flexDirection="column" paddingLeft={depth * 2}>
            {row.link && !row.isSelf ? (
              <Button key={`open-${row.id}`} plain onPress={() => openChat(row.link ?? '')}>
                {depth > 0 ? '↳ ' : ''}
                <Text color={dot(row)}>●</Text> <Text weight="semibold">{row.title}</Text>
              </Button>
            ) : (
              <Text weight="semibold" wrap="truncate-end">
                {depth > 0 ? '↳ ' : ''}
                <Text color={dot(row)}>●</Text> {row.title}
                {row.isSelf && (
                  <Text dimColor weight="regular">
                    {' '}
                    · dieser Chat
                  </Text>
                )}
              </Text>
            )}
            {row.isWaiting ? (
              <Text color={WAITING_COLOR} weight="semibold">
                Wartet auf dich
              </Text>
            ) : row.isRunning ? (
              <Text dimColor wrap="truncate-end">
                {row.task ?? row.note ?? 'arbeitet …'}
                {row.task && row.stepTotal ? ` · ${(row.stepDone ?? 0) + 1}/${row.stepTotal}` : ''}
              </Text>
            ) : (
              <Text color={DONE_COLOR} weight="semibold">
                ✓ Fertig
                {row.lastActivityAt > 0 && (
                  <Text dimColor weight="regular">
                    {` · ${clock(row.lastActivityAt, offset ?? 0)}`}
                  </Text>
                )}
              </Text>
            )}
            {row.isRunning &&
              !row.isWaiting &&
              !isWidget &&
              row.agents.map(agent => (
                <Text dimColor wrap="truncate-end">
                  {'   ↳ '}
                  {agent}
                </Text>
              ))}
          </Box>
        ))}
        {error !== undefined && <Text dimColor>Liste nicht lesbar: {error}</Text>}
      </Box>
    )
  })
}
