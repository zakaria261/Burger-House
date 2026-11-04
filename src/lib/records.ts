import { State } from './model';
export const collections = ['entries', 'employees', 'shifts', 'notes', 'audit'] as const;
export type RecordRow = { kind: (typeof collections)[number]; id: string; data: string };
export function pack(state: State) {
  return collections.flatMap((kind) =>
    state[kind].map((item) => ({ kind, id: item.id, data: JSON.stringify(item) })),
  );
}
export function metadata(state: State) {
  return JSON.stringify({ goal: state.goal, requestIds: state.requestIds });
}
export function unpack(data: string, rows: RecordRow[]): State {
  const base = JSON.parse(data);
  const s: State = {
    entries: [],
    employees: [],
    shifts: [],
    notes: [],
    audit: [],
    goal: base.goal,
    requestIds: base.requestIds ?? [],
  };
  for (const row of rows) {
    if (collections.includes(row.kind))
      (s[row.kind] as { id: string }[]).push(JSON.parse(row.data));
  }
  s.entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  s.shifts.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  s.notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  s.audit.sort((a, b) => b.at.localeCompare(a.at));
  return s;
}
export function changes(before: State, after: State) {
  const old = new Map(pack(before).map((r) => [r.kind + ':' + r.id, r]));
  const next = pack(after);
  const put = next.filter((r) => old.get(r.kind + ':' + r.id)?.data !== r.data);
  const ids = new Set(next.map((r) => r.kind + ':' + r.id));
  return { put, remove: [...old.values()].filter((r) => !ids.has(r.kind + ':' + r.id)) };
}
