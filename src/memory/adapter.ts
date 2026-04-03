import type { Memory, RecallQuery, RecallResult } from "../types.js"

export type AdapterCapabilities = {
  semanticSearch: boolean
  maxMemories?: number | undefined
}

export interface MemoryAdapter {
  capabilities(): AdapterCapabilities
  save(memory: Memory): Promise<void>
  load(key: string): Promise<Memory | undefined>
  delete(key: string): Promise<boolean>
  list(): Promise<Memory[]>
  query(q: RecallQuery): Promise<RecallResult[]>
}
