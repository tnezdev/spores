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

// ---------------------------------------------------------------------------
// Persona types
// ---------------------------------------------------------------------------

/**
 * Situational facts resolved at activation time, substituted into a
 * persona body via `{{key}}` tokens. v0.1 is static-only — no command
 * execution, no API calls. Bodies needing richer context should instruct
 * the agent to gather it in prose.
 */
export type SituationalContext = {
  cwd: string
  timestamp: string // ISO 8601
  hostname: string
  git_branch?: string | undefined
}

/**
 * Metadata-only persona reference — cheap to list. Frontmatter fields only,
 * no body content. Used by `listPersonas()` and by callers scanning the
 * persona catalog for activation targets.
 *
 * Descriptions should be phrased as activation triggers ("Activate when...")
 * rather than labels ("The X maintainer") — they're agent-facing lookup hooks.
 */
export type PersonaRef = {
  name: string
  description: string
  memory_tags: string[]
  skills: string[]
  task_filter?: TaskQuery | undefined
  workflow?: string | undefined
}

/**
 * A persona as it exists on disk: metadata + raw body with unsubstituted
 * `{{template}}` tokens. Returned by `loadPersona()`. Pair with
 * `activatePersona(file, situational)` to produce a fully rendered `Persona`.
 */
export type PersonaFile = PersonaRef & {
  body: string
  path: string // absolute path to persona file
}

/**
 * A fully activated persona — template tokens replaced with live situational
 * facts. This is what gets piped into an LLM as focus context.
 */
export type Persona = PersonaRef & {
  body: string // rendered: `{{key}}` tokens substituted
  situational: SituationalContext
  path: string
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

/**
 * Result of firing a hook script. `ran: false` means no hook was found or it
 * was not executable — a non-error quiet no-op. `ran: true` with a non-zero
 * `exit_code` or an `error` string means the hook ran but failed; by design
 * this is a warning, not a fatal error — the primary verb still succeeds.
 *
 * See tnezdev/spores#26 for the design rationale and event catalog.
 */
export type HookInvocation = {
  event: string
  ran: boolean
  stdout: string
  stderr: string
  exit_code: number | null
  error?: string | undefined
}

/**
 * Output of `persona activate`: the rendered persona plus the result of any
 * `persona.activated` hook that fired. The hook's stdout is appended to the
 * human-formatted activation output; JSON mode serializes the whole wrapper.
 */
export type PersonaActivationOutput = {
  persona: Persona
  hook?: HookInvocation | undefined
}

/**
 * Output of `task done`: the updated task plus the result of any `task.done`
 * hook that fired. The hook's stdout is appended to the human-formatted output;
 * JSON mode serializes the whole wrapper. Design + catalog: tnezdev/spores#26.
 */
export type TaskDoneOutput = {
  task: Task
  hook?: HookInvocation | undefined
}

/**
 * Output of `workflow done` / `workflow fail` when the transition causes a run
 * to reach a terminal state. Contains the final transition, the run outcome
 * ("completed" if all terminal nodes completed, "failed" if any failed), and
 * the result of any `workflow.run.terminated` hook that fired.
 * Design + catalog: tnezdev/spores#26.
 */
export type WorkflowRunTerminatedOutput = {
  run_id: string
  graph_id: string
  outcome: "completed" | "failed"
  hook?: HookInvocation | undefined
}
