const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function parisInput(value: string | Date) {
  return formatter.format(new Date(value)).replace(' ', 'T');
}
export function parisCandidates(wall: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) return [];
  const nominal = Date.parse(wall + ':00Z');
  if (!Number.isFinite(nominal)) return [];
  const offsets = new Set<number>();
  for (const hours of [-36, 0, 36]) {
    const probe = nominal + hours * 3600000;
    offsets.add(Date.parse(parisInput(new Date(probe)) + ':00Z') - probe);
  }
  return [...offsets]
    .map((offset) => new Date(nominal - offset).toISOString())
    .filter((iso) => parisInput(iso) === wall)
    .sort();
}
export function parisToISO(wall: string, occurrence = '', original?: string) {
  if (original && parisInput(original) === wall) return original;
  const candidates = parisCandidates(wall);
  if (!candidates.length)
    throw new Error('Cet horaire n’existe pas en heure de Paris (changement d’heure).');
  if (candidates.length > 1 && !['0', '1'].includes(occurrence))
    throw new Error('Précisez le passage été ou hiver pour cet horaire.');
  return candidates[candidates.length > 1 ? Number(occurrence) : 0];
}
