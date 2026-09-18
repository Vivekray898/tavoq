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
} as const;

/** All list keys whose rows contain task-shaped data (for targeted patches). */
export const taskListKeys = [qk.tasks(), qk.projectsList(false), qk.projectsList(true)] as const;
