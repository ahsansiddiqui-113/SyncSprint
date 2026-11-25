import type { TaskDTO } from "@/lib/realtime-protocol";

export type BoardState = { tasks: Record<string, TaskDTO> };

export type BoardAction =
  /** Authoritative server state. Ignored if older than what we have (out-of-order packets). */
  | { type: "server"; task: TaskDTO }
  /** Server says our write lost: replace unconditionally with its current row. */
  | { type: "force"; task: TaskDTO }
  | { type: "remove"; taskId: string }
  | { type: "optimisticMove"; taskId: string; columnId: string; position: number }
  | { type: "rebalance"; positions: Record<string, number> }
  | { type: "reset"; tasks: TaskDTO[] };

export function initBoard(tasks: TaskDTO[]): BoardState {
  return { tasks: Object.fromEntries(tasks.map((t) => [t.id, t])) };
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "server": {
      const local = state.tasks[action.task.id];
      if (local && action.task.version <= local.version) return state; // stale / duplicate echo
      return { tasks: { ...state.tasks, [action.task.id]: action.task } };
    }
    case "force":
      return { tasks: { ...state.tasks, [action.task.id]: action.task } };
    case "remove": {
      if (!state.tasks[action.taskId]) return state;
      const { [action.taskId]: _removed, ...rest } = state.tasks;
      return { tasks: rest };
    }
    case "optimisticMove": {
      const t = state.tasks[action.taskId];
      if (!t) return state;
      // Version is intentionally untouched: the server's response carries the new one.
      return { tasks: { ...state.tasks, [t.id]: { ...t, columnId: action.columnId, position: action.position } } };
    }
    case "rebalance": {
      const next = { ...state.tasks };
      for (const [id, position] of Object.entries(action.positions)) {
        if (next[id]) next[id] = { ...next[id]!, position };
      }
      return { tasks: next };
    }
    case "reset":
      return initBoard(action.tasks);
  }
}

/** Column id → task ids ordered by fractional position. */
export function groupByColumn(tasks: Record<string, TaskDTO>, columnIds: string[]) {
  const out: Record<string, string[]> = Object.fromEntries(columnIds.map((c) => [c, []]));
  const sorted = Object.values(tasks).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  for (const t of sorted) out[t.columnId]?.push(t.id);
  return out;
}
