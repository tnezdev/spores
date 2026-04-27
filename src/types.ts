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
  wake: {
    template?: string | undefined // path to WAKE.md template (absolute or relative to baseDir)
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
 * Routing hint — advisory shape used by callers (run orchestrators) to map
 * a persona to an LLM model and provider. Spores never binds a persona to
 * a model directly; the routing layer owns that decision plus guardrails,
 * observability, and provider fallback. Three levels are enough vocabulary
 * to start; expand only when a real workload demands it.
 */
export type RoutingHint = "low" | "medium" | "high"

/**
 * Metadata-only persona reference — cheap to list. Frontmatter fields only,
 * no body content. Used by `listPersonas()` and by callers scanning the
 * persona catalog for activation targets.
 *
 * Descriptions should be phrased as activation triggers ("Activate when...")
 * rather than labels ("The X maintainer") — they're agent-facing lookup hooks.
 *
 * `effort` and `reasoning` are advisory hints — see `RoutingHint`. The
 * persona declares what it wants; the routing layer decides what model
 * gets it. Personas never name models directly: a persona can edit itself,
 * so capability-shaping fields belong outside the editable surface.
 */
export type PersonaRef = {
  name: string
  description: string
  memory_tags: string[]
  skills: string[]
  task_filter?: TaskQuery | undefined
  workflow?: string | undefined
  effort?: RoutingHint | undefined
  reasoning?: RoutingHint | undefined
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
// Dispatch types
//
// A Dispatch is a message that crosses a boundary into an agent's turn:
// from another agent (PA→ORG, ORG→PA), from a surface (Slack, email),
// from a scheduler (recurring or one-shot wakes), or addressed to self.
// Spores ships the message shape and pure match logic; the runtime
// (caller) ships transport, scheduling, and handler execution.
//
// See PROJECTS/spores/DESIGN-runtime-description.md §"Dispatch primitive
// shape" for the full design.
// ---------------------------------------------------------------------------

/** ULID-shaped identifier. Same monotonic-factory shape as Task.id. */
export type DispatchId = string

/**
 * The message shape that crosses every boundary into an agent's turn.
 * `from` and `to` are runtime-assigned addresses (e.g. `pa:user-x`,
 * `org:channel-y`, `scheduler`, `self`, `surface:slack`); the convention
 * is colon-separated kind:identifier but spores does not enforce it —
 * callers can use whatever address scheme their runtime prefers.
 *
 * `when` and `recurrence` are *delivery metadata* — sender-side scheduling.
 * The scheduler is just the runtime executor of recurring sends; from the
 * handler's perspective, every dispatch arrives the same way regardless
 * of source (scheduled, surface, agent-to-agent).
 */
export type Dispatch = {
  id: DispatchId
  from: string
  to: string
  payload: unknown
  timestamp: string // ISO 8601 — when the dispatch was emitted
  when?: string | undefined // ISO 8601 — deferred delivery
  recurrence?: string | undefined // cron expression or ISO 8601 duration
}

/**
 * Declarative predicate over `from` and `to`. A string matches by equality;
 * a string array matches by inclusion (one-of). An undefined field places
 * no constraint. An empty filter matches every dispatch.
 *
 * Payload-shape matching is intentionally absent at the foundation layer:
 * payload schemas are source-specific, and a one-size predicate language
 * would force premature decisions. Callers needing payload matching can
 * compose a function filter `(d) => match(d, baseFilter) && payloadCheck(d)`
 * outside this module.
 */
export type DispatchFilter = {
  from?: string | readonly string[] | undefined
  to?: string | readonly string[] | undefined
}

/**
 * Lifecycle hooks attached at handler registration. `onRegister` runs once
 * when the handler is brought up (idempotency is the registrar's
 * responsibility — spores stays stateless about prior runs). `onUnregister`
 * runs once at teardown. Both default to no-op when omitted.
 *
 * The caller (runtime) decides *when* to fire `onRegister` — at process
 * boot for long-running daemons, at deploy time for serverless. Spores
 * ships the hook shape; the runtime owns the policy.
 */
export type DispatchHandlerHooks = {
  onRegister?: () => Promise<void>
  onUnregister?: () => Promise<void>
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
 * Output of `task add`: the created task plus the result of any `task.added`
 * hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type TaskAddedOutput = {
  task: Task
  hook?: HookInvocation | undefined
}

/**
 * Output of `task start`: the updated task (now in_progress) plus the result
 * of any `task.started` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type TaskStartedOutput = {
  task: Task
  hook?: HookInvocation | undefined
}

/**
 * Output of `task annotate`: the updated task plus the result of any
 * `task.annotated` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type TaskAnnotatedOutput = {
  task: Task
  hook?: HookInvocation | undefined
}

/**
 * Output of `skill run`: the invoked skill ref plus the result of any
 * `skill.invoked` hook that fired. Human mode outputs the raw skill content
 * (pipe-friendly); JSON mode serializes the wrapper.
 * Design + catalog: tnezdev/spores#26.
 */
export type SkillInvokedOutput = {
  skill: Skill
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory remember`: the stored memory plus the result of any
 * `memory.remembered` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryRememberedOutput = {
  memory: Memory
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory recall`: the recall results plus the result of any
 * `memory.recalled` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryRecalledOutput = {
  results: RecallResult[]
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory reinforce`: the updated memory plus the result of any
 * `memory.reinforced` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryReinforcedOutput = {
  memory: Memory
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory forget`: the forgotten key plus the result of any
 * `memory.forgotten` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryForgottenOutput = {
  key: string
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory dream`: the consolidation result plus the result of any
 * `memory.dreamed` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryDreamedOutput = {
  result: DreamResult
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
 * Output of `workflow run <graph-id>` — the newly created run, plus the result
 * of any `workflow.run.started` hook that fired.
 * Design + catalog: tnezdev/spores#26.
 */
export type WorkflowRunStartedOutput = {
  run_id: string
  graph_id: string
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

/**
 * Output emitted on every node status change — `workflow start`, `workflow done`,
 * `workflow fail`. Fires *after* the transition is persisted, before any
 * `workflow.run.terminated` check. Env vars passed to the hook:
 *   SPORES_RUN_ID, SPORES_GRAPH_ID, SPORES_NODE_ID,
 *   SPORES_FROM_STATUS, SPORES_TO_STATUS, SPORES_PASS
 * Design + catalog: tnezdev/spores#26.
 */
export type WorkflowRunTransitionedOutput = {
  run_id: string
  graph_id: string
  node_id: string
  from_status: NodeStatus
  to_status: NodeStatus
  pass: number
  hook?: HookInvocation | undefined
}

// ---------------------------------------------------------------------------
// Wake types
// ---------------------------------------------------------------------------

/**
 * Output of `spores wake` — everything an agent needs to self-orient at
 * session start. The identity content is the raw text of the configured
 * identity file. Personas are listed as refs so the agent can decide which
 * to activate. Design: tnezdev/spores#34.
 */
export type WakeOutput = {
  rendered: string // fully resolved template output
  template_path?: string | undefined // resolved path to the template file
  situational: SituationalContext
  hook?: HookInvocation | undefined
}
