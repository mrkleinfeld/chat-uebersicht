export type ChatPlanItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type ChatRow = {
  id: string
  title: string
  isRunning: boolean
  isWaiting: boolean
  isSelf: boolean
  parentId?: string
  // claude://-Link der App, öffnet den Chat wie ein Klick in der Seitenleiste
  link?: string
  lastActivityAt: number
  task?: string
  // erster Satz der letzten Meldung, wenn der Chat keinen Schritt meldet
  note?: string
  stepDone?: number
  stepTotal?: number
  agents: string[]
}

export type ChatView = {
  rows: ChatRow[]
  // Minuten, die die Ortszeit des Macs vor UTC liegt (Schweiz im Winter: 60).
  offsetMin: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'chat-uebersicht': {
      plan: Shaped<ChatPlanItem[]>
      waiting: boolean
      seated: boolean
      view: Shaped<ChatView>
    }
  }
}
