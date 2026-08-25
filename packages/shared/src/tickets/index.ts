// Support tickets: a customer's request to us, and what we are doing about it.
//
// An admin of a tenant opens a ticket from the web app ("Assistenza"); whoever
// answers works it from the partner console ("Richieste"). Both sides read the
// same thread, so the answer arrives where the question was asked instead of in
// a mailbox the customer then has to correlate by hand.
//
// TWO STATUSES, DELIBERATELY INDEPENDENT.
//   status          — the CUSTOMER's opinion: `resolved` means "I no longer need
//                     an answer". Theirs to set and to take back; it mails nobody.
//   handling_status — the TEAM's state, written only by the console.
// Collapsing them would mean one party silently overwriting the other's
// statement: an admin marks a request resolved because they worked it out while
// an operator is mid-answer, and an operator closes a ticket the customer never
// came back to. Both are normal, and both readings matter.
//
// Dependency-free on purpose: consumed as source by web (Vite), the partner
// console (Vite) and the backend alike. Timestamps are ISO-8601 strings.

/**
 * The team's lifecycle, in order.
 *
 * `in_attesa_cliente` is the one that earns its place: without it, a ticket
 * waiting on the customer looks identical to one waiting on the operator, and
 * "what is on me today" stops being answerable from the console.
 *
 * Duplicated as a CHECK constraint in migration 061. A value added here and not
 * there is a runtime check_violation on the operator's click, not a type error.
 */
export const TICKET_HANDLING_STATUSES = [
  'nuovo',
  'in_lavorazione',
  'in_attesa_cliente',
  'risolto',
  'chiuso',
] as const;

export type TicketHandlingStatus = (typeof TICKET_HANDLING_STATUSES)[number];

export function isTicketHandlingStatus(value: string): value is TicketHandlingStatus {
  return (TICKET_HANDLING_STATUSES as readonly string[]).includes(value);
}

/** The customer's own flag. Not a triage state. */
export type TicketUserStatus = 'open' | 'resolved';

/** Who wrote a message: the customer's admin, or whoever answers from the console. */
export type TicketAuthorRole = 'user' | 'operator';

/**
 * The states that mail the customer when the team moves a ticket into them.
 *
 * Deliberately not all five. `nuovo` is the state a ticket is born in — there is
 * nothing to announce — and `in_attesa_cliente` is announced by the reply that
 * asks the question, which carries the actual question and goes out anyway. A
 * second mail saying "we are waiting for you" with no content in it is noise
 * arriving a minute after the message that matters.
 */
export const TICKET_STATUS_MAIL_STATES: readonly TicketHandlingStatus[] = [
  'in_lavorazione',
  'risolto',
  'chiuso',
];

/**
 * Where a customer's reply leaves the ticket.
 *
 * A reply always means the ball is back with the team, so every state resolves
 * to `in_lavorazione` — including `chiuso`. A closed ticket that silently
 * swallows a reply is worse than a reopened one: the customer has no way to tell
 * "nobody has answered yet" from "nobody will ever read this".
 *
 * `nuovo` is the exception and stays: an admin adding a second paragraph to a
 * request nobody has opened yet has not caused anyone to take it in charge.
 *
 * Mirrored in SQL by the reopen statement in routes/tickets.ts, which computes
 * the same transition from the old value so it cannot be passed in wrong.
 */
export function handlingAfterUserReply(current: TicketHandlingStatus): TicketHandlingStatus {
  return current === 'nuovo' ? 'nuovo' : 'in_lavorazione';
}

/** True when a customer's reply will visibly reopen the ticket, for the UI's warning. */
export function replyReopens(current: TicketHandlingStatus): boolean {
  return current === 'risolto' || current === 'chiuso';
}

/**
 * Triage hints the form offers.
 *
 * Stored as free text (no CHECK in migration 061) precisely because this list is
 * a UI concern: a constraint here would turn a copy edit into a migration. The
 * labels live in the i18n catalogues, one per app.
 */
export const TICKET_CATEGORIES = [
  'problema',
  'domanda',
  'richiesta',
  'fatturazione',
  'altro',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_PRIORITIES = ['bassa', 'media', 'alta'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_SUBJECT_MAX = 200;
/** Ceiling on the opening request and on any single reply. */
export const TICKET_BODY_MAX = 5000;
/** Operator triage note. Never rendered to the customer. */
export const TICKET_NOTE_MAX = 4000;

// ── attachments ─────────────────────────────────────────────────────────────

/**
 * Per-file ceiling: 10 MB. A support attachment is evidence of a malfunction —
 * a screenshot, an export, the PDF that would not open — and 10 MB covers all
 * three. The bytes are stored (R2), so the ceiling is also a storage decision.
 */
export const TICKET_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Files per message. Three screenshots is a bug report; thirty is an archive. */
export const TICKET_ATTACHMENT_MAX_FILES = 3;

/**
 * Accepted content types: images and PDFs, plus plain text and the two log-ish
 * types because "mandaci l'export" is a real answer. Deliberately no archives —
 * a zip is a container whose contents nothing here scans.
 */
export const TICKET_ATTACHMENT_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
];

export function isTicketAttachmentMime(mime: string): boolean {
  const bare = (mime.split(';')[0] ?? '').trim().toLowerCase();
  return TICKET_ATTACHMENT_MIME_TYPES.includes(bare);
}

// ── row and view shapes ─────────────────────────────────────────────────────

export interface TicketAttachment {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  uploaded_by: TicketAuthorRole;
}

export interface TicketMessage {
  id: string;
  /**
   * `operator` is "l'assistenza". The operator's NAME is deliberately absent
   * from the customer's payload: naming an individual invites the next request
   * to be addressed to that person, who may be on holiday or may have left.
   */
  author: TicketAuthorRole;
  body: string;
  created_at: string;
  attachments: TicketAttachment[];
}

/** A ticket as the customer's admin sees it in the list. */
export interface TicketFeedItem {
  id: string;
  ref: string;
  subject: string;
  body: string;
  category: string | null;
  priority: string | null;
  status: TicketUserStatus;
  /** The team's state, read-only on this side. */
  handling_status: TicketHandlingStatus;
  handling_updated_at: string;
  last_message_at: string | null;
  /** Operator replies newer than the last time anyone here opened the ticket. */
  unread_count: number;
  /** Which admin of the company opened it. */
  opened_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
  /**
   * Only on the create response: the id of message #1, which IS the opening
   * request (see routes/tickets.ts). The client POSTs its attachments onto it.
   */
  first_message_id?: string;
}

/**
 * One step of a request's history (migration 063).
 *
 * Carries no actor on purpose: the transition itself is what both surfaces
 * render, and an actor column would put an operator's identity in front of the
 * customer. `kind` says WHOSE state moved — the team's or the customer's own
 * flag — which is all the label needs.
 */
export interface TicketEvent {
  id: string;
  kind: 'created' | 'handling' | 'user_status';
  from_status: string | null;
  to_status: string;
  at: string;
}

export interface TicketDetail {
  ticket: TicketFeedItem;
  messages: TicketMessage[];
  events: TicketEvent[];
}

/** A ticket as the console sees it: adds the customer's identity and team-only fields. */
export interface ConsoleTicket extends TicketFeedItem {
  tenant_id: string;
  tenant_name: string | null;
  /** The partner who provisioned the tenant. Null for a directly created one. */
  managed_by_partner: string | null;
  partner_email: string | null;
  opened_by_email: string | null;
  assigned_to: string | null;
  assignee_label: string | null;
  /** Operator-only. Never sent to the customer's surface. */
  internal_note: string | null;
  message_count: number;
}

export interface ConsoleTicketDetail {
  ticket: ConsoleTicket;
  messages: TicketMessage[];
  events: TicketEvent[];
}

/** An operator a ticket may be assigned to (platform-admin picker). */
export interface ConsoleAssignee {
  user_id: string;
  label: string;
  email: string;
  role: 'admin' | 'partner';
}

export type TicketHandlingFilter = 'aperti' | 'tutti' | TicketHandlingStatus;
export type TicketAssignmentFilter = 'tutte' | 'mie' | 'non_assegnate';
