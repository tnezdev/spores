export type MemoryTier = "L1" | "L2" | "L3"

export type Memory = {
  key: string
  content: string
  source?: string | undefined
  weight: number // 0..1, set at remember time
  confidence: number // 0..1, bumped by reinforce
  tier: MemoryTier
  tags: string[]
  timestamp: string // ISO 8601
}

export type RecallQuery = {
  text?: string | undefined
  tags?: string[] | undefined
  tier?: MemoryTier | undefined
  limit: number
}

export type RecallResult = {
  memory: Memory
  score: number // adapter-determined relevance, 0..1
}

export type DreamResult = {
  promoted: string[] // keys promoted to higher tier
  pruned: string[] // keys removed (below threshold)
}

export type SporesConfig = {
  adapter: string
  memory: {
    dir: string
    defaultTier: MemoryTier
    dreamDepth: number
  }
}
