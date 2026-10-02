/**
 * Query-key registry (§2).
 *
 * Every cached resource gets its keys here so realtime handlers and
 * mutations can target the exact same keys the queries use.
 *
 * Hierarchy: resource → scope → id/variant
 *   ['tasks']                  all visible tasks (role-scoped server-side)
 *   ['tasks', 'detail', id]    full task detail (comments, attachments…)
 *   ['projects', 'list', archived?]
 *   ['projects', 'detail', id]
 *   ['clients', 'list', archived?]
 *   ['clients', 'detail', id]
 *   ['employees', 'list']
 *   ['employee', 'detail', id]
 *   ['notifications']          current user's notifications
 *   ['dashboard', role]
 *   ['payments', 'mine', weekOffset]
 *   ['payments', 'admin']
 *   ['labels'], ['saved-filters'], ['activity', scope, id, limit]
 *   ['profile', 'memo', updatedAt]   — profile memo cache
 */
export const qk = {
  tasks: () => ["tasks"] as const,
  taskDetail: (id: string) => ["tasks", "detail", id] as const,

  projectsList: (archived = false) => ["projects", "list", archived] as const,
  projectDetail: (id: string) => ["projects", "detail", id] as const,

  clientsList: (archived = false) => ["clients", "list", archived] as const,
  clientDetail: (id: string) => ["clients", "detail", id] as const,

  employeesList: () => ["employees", "list"] as const,
  employeeDetail: (id: string) => ["employee", "detail", id] as const,

  activeEmployees: () => ["employees", "active"] as const,

  notifications: () => ["notifications"] as const,

  dashboard: (role: "admin" | "employee") => ["dashboard", role] as const,

  myEarnings: (weekOffset: number) => ["payments", "mine", weekOffset] as const,
  /** Admin payout workspace: summary + employees + history. */
  paymentWorkspace: () => ["payments", "admin"] as const,
  /** A selected employee's payable tasks (admin payments flow). */
  payableTasks: (employeeId: string) => ["payments", "payable", employeeId] as const,

  labels: () => ["labels"] as const,

  /** Per-user Google Calendar connection + sync state. */
  googleCalendar: () => ["google-calendar", "status"] as const,
  savedFilters: () => ["saved-filters"] as const,

  /** ACTIVE projects (+client names) for task create/edit dropdowns. */
  projectsForTask: () => ["projects", "for-task"] as const,
  /** ACTIVE clients for project create/edit dropdowns. */
  activeClients: () => ["clients", "active"] as const,
  /** Agency settings (key/value map) for the settings form. */
  settings: () => ["settings"] as const,

  taskActivity: (taskId: string, limit: number) =>
    ["activity", "task", taskId, limit] as const,
  projectActivity: (projectId: string, limit: number) =>
    ["activity", "project", projectId, limit] as const,

  /**
   * Activity feeds carry their limit inside the key, so a realtime
   * INSERT cannot know which key to patch. The prefix keys below let
   * the realtime handler match every limit variant at once.
   */
  taskActivityPrefix: (taskId: string) => ["activity", "task", taskId] as const,
  projectActivityPrefix: (projectId: string) =>
    ["activity", "project", projectId] as const,

  /** Subtasks of a task, embedded in the task detail cache. */
  subtasks: (taskId: string) => ["subtasks", taskId] as const,

  /** Project resources — realtime needs this to patch live. */
  projectResources: (projectId: string) =>
    ["projects", "resources", projectId] as const,
} as const;

/** All list keys whose rows contain task-shaped data (for targeted patches). */
export const taskListKeys = [qk.tasks(), qk.projectsList(false), qk.projectsList(true)] as const;

/**
 * Tables the realtime provider subscribes to.
 *
 * Kept beside the keys so adding a subscription and adding the key it
 * patches happen in the same review. Each entry names the query keys
 * its events write to.
 */
export const REALTIME_TABLES = {
  notifications: [qk.notifications()],
  tasks: [qk.tasks(), qk.taskDetail("*" as string)],
  task_comments: [],
  payments: [qk.paymentWorkspace(), ["payments"]],
  activity: [["activity"]],
  project_resources: [["projects", "resources"]],
  task_subtasks: [["tasks", "detail"]],
  profiles: [qk.employeesList(), qk.activeEmployees(), ["employee", "detail"]],
  project_members: [qk.projectsList(false), qk.projectsList(true)],
  projects: [qk.projectsList(false), qk.projectsList(true), qk.projectsForTask()],
  clients: [qk.clientsList(false), qk.clientsList(true), qk.activeClients()],
} as const;
