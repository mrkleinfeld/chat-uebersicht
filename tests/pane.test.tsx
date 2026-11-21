import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'chat-uebersicht',
  component: 'Pane',
  requestId: 'chats',
  props: {
    title: 'Chats',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-11-20T23:00:00Z')
const SESSIONS = [
  {
    sessionId: 'local_main',
    title: 'Projekt Hauptchat',
    isRunning: false,
    lastActivityAt: '2026-11-20T22:50:00Z',
  },
  {
    sessionId: 'local_child',
    title: 'Landingpage',
    link: 'claude://claude.ai/epitaxy/local_child',
    isRunning: true,
    lastActivityAt: '2026-11-20T22:59:00Z',
    startedBy: 'local_main',
  },
  {
    sessionId: 'local_nomod',
    title: 'Chat ohne Mod',
    isRunning: true,
    lastActivityAt: '2026-11-20T22:58:00Z',
  },
  {
    sessionId: 'local_old',
    title: 'Alter Chat',
    isRunning: false,
    lastActivityAt: '2026-11-19T10:00:00Z',
  },
]
const SELF = {
  sessionId: 'local_self',
  parentSessionId: 'local_main',
  title: 'Sidebar-Mod',
  isRunning: true,
  lastActivityAt: '2026-11-20T22:59:30Z',
}
const CHILD_STATUS = {
  v: 1,
  plan: [
    { content: 'Video einbauen', status: 'completed' },
    { content: 'Untertitel prüfen', status: 'in_progress' },
    { content: 'Hochladen', status: 'pending' },
  ],
  agents: ['Seite durchsuchen'],
}

const text = (value: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false },
})

test('das Panel zeigt Arbeit, Unterchats und Fertig', async ($, on) => {
  const files = new Map<string, string>([
    ['/home/.claude/chat-uebersicht/local_child.json', JSON.stringify(CHILD_STATUS)],
  ])
  on('command.register', () => ({ value: { command: 'chats' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.env(on, { HOME: '/home' })
  const clock = mock.clock(on, { now: NOW })
  on('agent.list', () => ({ value: [] }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [...files.keys()].map(path => ({
      name: path.split('/').pop() ?? '',
      kind: 'file',
      size: 1,
      mtimeMs: 0,
      isLink: false,
    })),
  }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'list_sessions') return text(SESSIONS)
    if (e.tool === 'list_events') {
      return {
        value: {
          content: [
            {
              type: 'text',
              text: [
                'Session "Chat ohne Mod" (running) — showing 3 of 90 messages',
                '',
                '[user] Bitte lade den Build hoch.',
                '[assistant] Ich baue jetzt **Build 3** und lade ihn zu TestFlight hoch. Das dauert etwa zehn Minuten.',
                '[assistant] (called Bash)',
              ].join('\n'),
            },
          ],
          isError: false,
        },
      }
    }

    return text(SELF)
  })
  on('tool.call', () => ({ result: {} }))
  const opened: string[] = []
  on('process.run', (_, e) => {
    if (e.argv[0] === 'open') opened.push(String(e.argv[1]))

    return {
      value: {
        exitCode: 0,
        stdout: '+0100\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Panel bauen', status: 'completed' },
      { content: 'Panel prüfen', status: 'in_progress' },
    ],
  } as never)
  await clock.advance(4000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Projekt Hauptchat/ }))?.text).toContain(
      'Projekt Hauptchat',
    )
    expect((await ui.find({ type: 'Text', text: /Fertig/ }))?.text).toContain('✓ Fertig')
    expect(await ui.find({ type: 'Button', key: 'open-local_child' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Untertitel/ }))?.text).toBe(
      'Untertitel prüfen · 2/3',
    )
    expect((await ui.find({ type: 'Text', text: /Seite durchsuchen/ }))?.text).toContain('↳')
    expect((await ui.find({ type: 'Text', text: /Panel prüfen/ }))?.text).toBe('Panel prüfen · 2/2')
    expect((await ui.find({ type: 'Text', text: /dieser Chat/ }))?.text).toContain('↳')
    expect(await ui.find({ type: 'Text', text: /Alter Chat/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /arbeiten/ }))?.text).toBe('3 arbeiten · 1 fertig')
    expect((await ui.find({ type: 'Text', text: /Build 3/ }))?.text).toBe(
      'Ich baue jetzt Build 3 und lade ihn zu TestFlight hoch.',
    )
    expect((await ui.find({ type: 'Text', text: /Fertig/ }))?.text).toBe('✓ Fertig · 23:50')
    await ui.unmount()
  }

  // Klick auf den Namen öffnet den Chat.
  const clicked = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clicked.press({ plugin: 'chat-uebersicht', key: 'open-local_child' })
  expect(opened).toEqual(['claude://claude.ai/epitaxy/local_child'])
  await clicked.unmount()

  // Als Widget in der Seitenspalte: dieselben Zeilen, ohne Hilfs-Agenten.
  const widget = await $.ui.mount({
    ...PANE,
    surface: 'desktop',
    props: { ...PANE.props, placement: 'widget', anchoredEdges: [] },
  })
  expect((await widget.find({ type: 'Text', text: /Untertitel/ }))?.text).toBe(
    'Untertitel prüfen · 2/3',
  )
  expect(await widget.find({ type: 'Text', text: /Seite durchsuchen/ })).toBeUndefined()
  await widget.unmount()

  // Frage an dich: Der Chat wartet, bis du antwortest.
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'x', ask: 'Weiter?' } as never)
  await clock.advance(4000)
  const asked = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await asked.find({ type: 'Text', text: /Wartet/ }))?.text).toBe('Wartet auf dich')
  expect((await asked.find({ type: 'Text', text: /auf dich ·|warten|wartet auf/ }))?.text).toContain(
    '1 wartet auf dich',
  )
  await asked.unmount()

  // Abschluss der Runde: alle Schritte erledigt, keine Aufgabe mehr offen.
  const own = JSON.parse(files.get('/home/.claude/chat-uebersicht/local_self.json') ?? '{}')
  expect(own.plan.every((step: { status: string }) => step.status === 'completed')).toBe(true)
  expect(own.waiting).toBe(true)
})
