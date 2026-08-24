/**
 * Short, human-quotable reference for a support ticket: `SQ-20260824-0431`.
 *
 * The code appears in the subject line of every mail about the ticket, in both
 * UIs and in the audit log's target_label, so a phone call can start with "sto
 * chiamando per la SQ-20260824-0431" and everyone is looking at the same row.
 *
 * The date prefix makes it sortable and instantly datable by eye; the four random
 * digits give ten thousand codes per day. A collision is therefore unlikely but
 * not impossible, which is why the insert uses ON CONFLICT (ref) and retries
 * rather than trusting the draw — see routes/tickets.ts.
 */
export function ticketRef(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replaceAll('-', '');
  const rand = Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0');
  return `SQ-${stamp}-${rand}`;
}
