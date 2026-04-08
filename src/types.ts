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
  workflow: {
    graphsDir: string
    runsDir: string
  }
}

// ---------------------------------------------------------------------------
// Workflow types (digraph runtime)
// ---------------------------------------------------------------------------

export type NodeType = "automated" | "manual"

export type NodeDef = {
  id: string
  label: string
  description?: string
  artifact_type: string
  type?: NodeType
  claims?: string[]
  subgraph?: GraphDef
}

export type EdgeDef = {
  from: string
  to: string
  condition?: "always" | EvaluatorRef
}

export type EvaluatorRef = {
  type: "evaluator"
  criteria: string
}

export type GraphDef = {
  id: string
  name: string
  description?: string
  version: string
  nodes: NodeDef[]
  edges: EdgeDef[]
}

export type NodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "invalidated"

export type Artifact = {
  type: string
  content: unknown
  produced_at: string
}

export type Transition = {
  node_id: string
  pass: number
  from_status: NodeStatus
  to_status: NodeStatus
  identity: string
  timestamp: string
  artifact?: Artifact
  reason?: string
  metadata?: Record<string, unknown>
}

export type NodeState = {
  node_id: string
  status: NodeStatus
  pass: number
  artifact?: Artifact
}

export type Run = {
  run_id: string
  graph_id: string
  name?: string
  created_at: string
  history: Transition[]
}

// ---------------------------------------------------------------------------
// Skill types
// ---------------------------------------------------------------------------

/**
 * A branded URI string for SPORES-owned resources.
 * The `spores://` scheme is reserved for SPORES runtime compute, referenced
 * from within skill bodies and dispatched by the host runtime (e.g. Beacon).
 * Example: `spores://dream`, `spores://reflect`
 */
export type SporesUri = `spores://${string}`

/** Lightweight skill reference — metadata without body content. */
export type SkillRef = {
  name: string
  description: string
  tags: string[]
  path: string // absolute path to skill.md
}

/** Fully loaded skill with body content. */
export type Skill = SkillRef & {
  content: string // body of skill.md after frontmatter
}

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "ready"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled"

export type TaskAnnotation = {
  text: string
  timestamp: string // ISO 8601
}

export type Task = {
  id: string // ULID (monotonic factory)
  description: string
  status: TaskStatus
  parent_id?: string | undefined // subtask link
  workflow_run_id?: string | undefined // link to SPORES workflow run
  tags: string[]
  annotations: TaskAnnotation[]
  recurrence?: string | undefined // deferred — field exists, semantics TBD
  wait_until?: string | undefined // ISO 8601 — nextReadyTask skips until elapsed
  created_at: string // ISO 8601
  updated_at: string // ISO 8601
  metadata?: Record<string, unknown> | undefined
}

export type TaskQuery = {
  status?: TaskStatus | undefined
  tags?: string[] | undefined
  parent_id?: string | undefined
}
