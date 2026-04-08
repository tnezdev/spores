import type { Task, TaskStatus, TaskQuery } from "../types.js"

/**
 * Adapter interface for durable task storage.
 *
 * Implements a persistent backlog with a ready-queue projection:
 * - The backlog stores all tasks with full status history via annotations.
 * - `nextReadyTask()` projects the backlog into a "what should I do now?" view.
 *
 * Storage implementations (filesystem, sqlite) are separate issues.
 * This interface is the stable contract they must satisfy.
 */
export interface TaskAdapter {
  /**
   * Create a new task. `id`, `created_at`, `updated_at`, and `annotations`
   * are set by the adapter; callers provide everything else.
   */
  createTask(
    input: Omit<Task, "id" | "created_at" | "updated_at" | "annotations">,
  ): Promise<Task>

  /** Load a task by ID. Returns null if not found. */
  getTask(id: string): Promise<Task | null>

  /** List tasks matching the query. Returns all tasks if query is empty. */
  listTasks(query: TaskQuery): Promise<Task[]>

  /**
   * Transition a task's status. Records a status-change annotation
   * on the task for auditability.
   */
  updateTaskStatus(id: string, status: TaskStatus): Promise<Task>

  /**
   * Append a text annotation to a task. Annotations are agent breadcrumbs —
   * the primary mechanism for recording reasoning, observations, and progress.
   */
  annotateTask(id: string, text: string): Promise<Task>

  /**
   * Return the highest-priority `ready` task, or null if none is available.
   *
   * Priority for MVP = most recent by ULID (i.e. creation order). Tasks whose
   * `wait_until` has not yet elapsed are excluded. Filtered by the optional
   * query (everything except `status`, which is always `"ready"`).
   */
  nextReadyTask(query?: Omit<TaskQuery, "status">): Promise<Task | null>

  /** Permanently delete a task. */
  deleteTask(id: string): Promise<void>
}
