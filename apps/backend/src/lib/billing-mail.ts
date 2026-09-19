import { color, formatEuroCents } from '@sonoqui/shared';
import { env } from '../env.js';
import { escapeHtml } from './mailer.js';

// Emails for self-service signup and Stripe billing (Specs/SELF_SERVICE_BILLING.md).
// Stripe's own customer emails are all switched off (D9): every message a
// customer receives about registration, activation, payment problems or a
// downgrade comes from here, in their language, with links into the app —
// never to a Stripe-hosted invoice page.

export type Lang = 'it' | 'en';

export interface BuiltMail {
  subject: string;
  text: string;
  html: string;
}

function webUrl(path: string): string {
  return env.WEB_PUBLIC_URL.replace(/\/$/, '') + path;
}

function siteUrl(path: string): string {
  return env.WEBSITE_PUBLIC_URL.replace(/\/$/, '') + path;
}

function partnerUrl(path: string): string {
  return env.PARTNER_PUBLIC_URL.replace(/\/$/, '') + path;
}

/** Shared shell: heading, paragraphs (already-escaped HTML), optional rows, CTA, note. */
function shell(parts: {
  heading: string;
  paragraphs: string[];
  rows?: { label: string; value: string }[];
  ctaLabel?: string;
  ctaUrl?: string;
  note?: string;
}): string {
  const paras = parts.paragraphs
    .map((p) => `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.55">${p}</p>`)
    .join('');
  const rows = parts.rows?.length
    ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:4px 0 12px">` +
      parts.rows
        .map(
          (r) =>
            `<tr><td style="color:#64748b;padding:2px 12px 2px 0;white-space:nowrap;vertical-align:top">${escapeHtml(r.label)}</td>` +
            `<td style="color:#0f172a">${escapeHtml(r.value)}</td></tr>`
        )
        .join('') +
      `</table>`
    : '';
  const cta =
    parts.ctaLabel && parts.ctaUrl
      ? `<p style="margin:20px 0 0"><a href="${escapeHtml(parts.ctaUrl)}" style="display:inline-block;background:${color.primary};` +
        `color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">${escapeHtml(parts.ctaLabel)}</a></p>`
      : '';
  const note = parts.note
    ? `<p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.5">${escapeHtml(parts.note)}</p>`
    : '';
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px">` +
    `<h2 style="color:${color.primary};font-size:19px;margin:0 0 14px">${escapeHtml(parts.heading)}</h2>` +
    paras +
    rows +
    cta +
    note +
    `<p style="margin-top:22px;color:#94a3b8;font-size:12px">sonoQui</p>` +
    `</div>`
  );
}

function textOf(lines: Array<string | null | undefined>): string {
  return lines.filter((l): l is string => l != null).join('\n');
}

// ---- signup ---------------------------------------------------------------

export function signupConfirmUrl(token: string): string {
  // Fragment, not query: the token never reaches access logs or a Referer.
  return webUrl(`/registrazione/conferma#t=${encodeURIComponent(token)}`);
}

export function buildSignupConfirmMail(p: {
  firstName: string;
  token: string;
  mode: 'new' | 'existing';
  ttlHours: number;
  language: Lang;
}): BuiltMail {
  const url = signupConfirmUrl(p.token);
  const name = escapeHtml(p.firstName);
  if (p.language === 'en') {
    const heading = p.mode === 'new' ? 'Confirm your email' : 'Create a new company with your account';
    const paragraphs =
      p.mode === 'new'
        ? [
            `Hi ${name}, thanks for choosing sonoQui.`,
            'Confirm your email address and choose a password: then you will add your company details and start right away on the Free plan.',
          ]
        : [
            `Hi ${name}, this address already has a sonoQui account.`,
            'Confirm to create a new company: you will sign in with your usual password and then add the company details.',
          ];
    const note = `The link is valid for ${p.ttlHours} hours. If you did not request this, ignore this email: nothing has been created.`;
    return {
      subject: p.mode === 'new' ? '[sonoQui] Confirm your email' : '[sonoQui] Create a new company',
      text: textOf([heading, '', ...paragraphs.map(stripTags), '', url, '', note]),
      html: shell({ heading, paragraphs, ctaLabel: p.mode === 'new' ? 'Confirm email' : 'Continue', ctaUrl: url, note }),
    };
  }
  const heading = p.mode === 'new' ? 'Conferma la tua email' : 'Crea una nuova azienda con il tuo account';
  const paragraphs =
    p.mode === 'new'
      ? [
          `Ciao ${name}, grazie per aver scelto sonoQui.`,
          'Conferma il tuo indirizzo email e scegli una password: subito dopo inserirai i dati della tua azienda e potrai iniziare con il piano gratuito.',
        ]
      : [
          `Ciao ${name}, questo indirizzo ha già un account sonoQui.`,
          'Conferma per creare una nuova azienda: accederai con la tua password abituale e poi inserirai i dati aziendali.',
        ];
  const note = `Il link è valido per ${p.ttlHours} ore. Se non hai richiesto tu la registrazione, ignora questa email: non è stato creato nulla.`;
  return {
    subject: p.mode === 'new' ? '[sonoQui] Conferma la tua email' : '[sonoQui] Crea una nuova azienda',
    text: textOf([heading, '', ...paragraphs.map(stripTags), '', url, '', note]),
    html: shell({ heading, paragraphs, ctaLabel: p.mode === 'new' ? 'Conferma email' : 'Continua', ctaUrl: url, note }),
  };
}

export function buildSignupReminderMail(p: { firstName: string; language: Lang }): BuiltMail {
  const url = webUrl('/login');
  if (p.language === 'en') {
    const heading = 'Your company is one step away';
    const paragraphs = [
      `Hi ${escapeHtml(p.firstName)}, you confirmed your email but have not added your company yet.`,
      'Sign in and enter your VAT number: it takes a minute, and the Free plan (3 users, 1 site) starts immediately.',
    ];
    return {
      subject: '[sonoQui] Complete your registration',
      text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
      html: shell({ heading, paragraphs, ctaLabel: 'Sign in', ctaUrl: url }),
    };
  }
  const heading = 'Manca solo un passo';
  const paragraphs = [
    `Ciao ${escapeHtml(p.firstName)}, hai confermato la tua email ma non hai ancora inserito la tua azienda.`,
    'Accedi e inserisci la Partita IVA: basta un minuto, e il piano gratuito (3 utenti, 1 sede) parte subito.',
  ];
  return {
    subject: '[sonoQui] Completa la registrazione',
    text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
    html: shell({ heading, paragraphs, ctaLabel: 'Accedi', ctaUrl: url }),
  };
}

export function buildOrphanNoticeMail(p: { firstName: string; days: number; language: Lang }): BuiltMail {
  const url = webUrl('/login');
  if (p.language === 'en') {
    const heading = 'Your sonoQui account will be deleted';
    const paragraphs = [
      `Hi ${escapeHtml(p.firstName)}, you registered but never added a company, so we will delete the account in ${p.days} days (we keep no data we do not need).`,
      'To keep it, sign in and add your company before then.',
    ];
    return {
      subject: '[sonoQui] Your account will be deleted',
      text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
      html: shell({ heading, paragraphs, ctaLabel: 'Sign in', ctaUrl: url }),
    };
  }
  const heading = 'Il tuo account sonoQui verrà eliminato';
  const paragraphs = [
    `Ciao ${escapeHtml(p.firstName)}, ti sei registrato ma non hai mai inserito un'azienda: tra ${p.days} giorni eliminiamo l'account (non conserviamo dati che non servono).`,
    "Per mantenerlo, accedi e inserisci la tua azienda entro quella data.",
  ];
  return {
    subject: '[sonoQui] Il tuo account verrà eliminato',
    text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
    html: shell({ heading, paragraphs, ctaLabel: 'Accedi', ctaUrl: url }),
  };
}

export function buildWelcomeMail(p: {
  firstName: string;
  companyName: string;
  pendingPlan: 'piccola' | 'media' | null;
  language: Lang;
}): BuiltMail {
  const url = webUrl('/');
  const manual = webUrl('/manual');
  if (p.language === 'en') {
    const heading = `Welcome to sonoQui, ${p.firstName}`;
    const paragraphs = [
      `<strong>${escapeHtml(p.companyName)}</strong> is ready on the Free plan: 3 users (you included) and 1 site.`,
      'Four steps to start: 1) create your site, 2) invite your colleagues, 3) set the working hours, 4) install the sonoQui app on their phones.',
      p.pendingPlan
        ? `You chose the <strong>${p.pendingPlan === 'piccola' ? 'Piccola' : 'Media'}</strong> plan: complete the payment from Settings → Plan and modules whenever you are ready.`
        : 'When you need more users or sites, upgrade from the "Go Premium" badge in the app.',
    ];
    return {
      subject: `[sonoQui] ${p.companyName} is ready`,
      text: textOf([heading, '', ...paragraphs.map(stripTags), '', url, `Manual: ${manual}`]),
      html: shell({ heading, paragraphs, ctaLabel: 'Open sonoQui', ctaUrl: url, note: `User manual: ${manual}` }),
    };
  }
  const heading = `Benvenuto in sonoQui, ${p.firstName}`;
  const paragraphs = [
    `<strong>${escapeHtml(p.companyName)}</strong> è pronta con il piano gratuito: 3 utenti (tu compreso) e 1 sede.`,
    "Quattro passi per partire: 1) crea la tua sede, 2) invita i collaboratori, 3) configura l'orario, 4) fai installare l'app sonoQui sui loro telefoni.",
    p.pendingPlan
      ? `Hai scelto il piano <strong>${p.pendingPlan === 'piccola' ? 'Piccola' : 'Media'}</strong>: completa il pagamento da Impostazioni → Piano e moduli quando vuoi.`
      : 'Quando ti servono più utenti o sedi, passa a Premium dal badge nell\'app.',
  ];
  return {
    subject: `[sonoQui] ${p.companyName} è pronta`,
    text: textOf([heading, '', ...paragraphs.map(stripTags), '', url, `Manuale: ${manual}`]),
    html: shell({ heading, paragraphs, ctaLabel: 'Apri sonoQui', ctaUrl: url, note: `Manuale d'uso: ${manual}` }),
  };
}

// ---- operator (super-user) notices — always Italian -------------------------

export function buildOperatorSignupMail(p: {
  companyName: string;
  partitaIva: string;
  vatStatus: string;
  headcountBand: string | null;
  planHint: string | null;
  adminName: string;
  adminEmail: string;
  phone: string | null;
  tenantId: string;
}): BuiltMail {
  const rows = [
    { label: 'Azienda', value: p.companyName },
    { label: 'P.IVA', value: `${p.partitaIva} (${vatLabel(p.vatStatus)})` },
    { label: 'Dipendenti', value: p.headcountBand ?? '—' },
    { label: 'Piano scelto', value: p.planHint ?? 'Free' },
    { label: 'Amministratore', value: `${p.adminName} <${p.adminEmail}>` },
    { label: 'Telefono', value: p.phone ?? '—' },
  ];
  const url = partnerUrl('/?tenant=' + encodeURIComponent(p.tenantId));
  return {
    subject: `[sonoQui] Nuova registrazione: ${p.companyName}`,
    text: textOf(['Nuova azienda registrata in autonomia.', '', ...rows.map((r) => `${r.label}: ${r.value}`), '', url]),
    html: shell({
      heading: 'Nuova azienda registrata',
      paragraphs: ['Una nuova azienda si è registrata in autonomia dal sito.'],
      rows,
      ctaLabel: 'Apri nella console',
      ctaUrl: url,
      note: p.vatStatus === 'valid' ? undefined : 'P.IVA non confermata dal VIES: da verificare (Registrazioni).',
    }),
  };
}

export function buildOperatorDuplicateVatMail(p: {
  partitaIva: string;
  email: string;
  existingCompany: string;
}): BuiltMail {
  const rows = [
    { label: 'P.IVA', value: p.partitaIva },
    { label: 'Già usata da', value: p.existingCompany },
    { label: 'Tentativo da', value: p.email },
  ];
  return {
    subject: `[sonoQui] Registrazione con P.IVA già presente (${p.partitaIva})`,
    text: textOf(["Un utente ha provato a registrare un'azienda con una P.IVA già presente.", '', ...rows.map((r) => `${r.label}: ${r.value}`)]),
    html: shell({
      heading: 'P.IVA già registrata',
      paragraphs: [
        "Un utente con email confermata ha provato a creare un'azienda con una P.IVA già presente. Potrebbe essere un collaboratore da aggiungere o il cliente di un partner.",
      ],
      rows,
    }),
  };
}

export function buildOperatorPaymentMail(p: {
  kind: 'paid' | 'failed' | 'refunded' | 'disputed';
  companyName: string;
  partitaIva: string | null;
  totalCents: number;
  description: string;
}): BuiltMail {
  const titles = {
    paid: 'Pagamento ricevuto — da fatturare',
    failed: 'Pagamento non riuscito',
    refunded: 'Rimborso emesso — serve una nota di credito',
    disputed: 'Contestazione aperta su un pagamento',
  } as const;
  const rows = [
    { label: 'Azienda', value: p.companyName },
    { label: 'P.IVA', value: p.partitaIva ?? '—' },
    { label: 'Importo', value: formatEuroCents(p.totalCents) },
    { label: 'Voci', value: p.description },
  ];
  const url = partnerUrl('/payments');
  return {
    subject: `[sonoQui] ${titles[p.kind]}: ${p.companyName}`,
    text: textOf([titles[p.kind], '', ...rows.map((r) => `${r.label}: ${r.value}`), '', url]),
    html: shell({ heading: titles[p.kind], paragraphs: [], rows, ctaLabel: 'Apri Pagamenti', ctaUrl: url }),
  };
}

// ---- billing notices to the company's admins --------------------------------

export function buildBillingActivatedMail(p: { companyName: string; itemLabel: string; language: Lang }): BuiltMail {
  const url = webUrl('/settings/subscription');
  if (p.language === 'en') {
    const heading = `${p.itemLabel} is active`;
    const paragraphs = [
      `Payment received: <strong>${escapeHtml(p.itemLabel)}</strong> is now active for ${escapeHtml(p.companyName)}.`,
      'You will receive the electronic invoice (fattura elettronica) through the SDI system.',
    ];
    return {
      subject: `[sonoQui] ${p.itemLabel} active`,
      text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
      html: shell({ heading, paragraphs, ctaLabel: 'Plan and modules', ctaUrl: url }),
    };
  }
  const heading = `${p.itemLabel} attivo`;
  const paragraphs = [
    `Pagamento ricevuto: <strong>${escapeHtml(p.itemLabel)}</strong> è attivo per ${escapeHtml(p.companyName)}.`,
    'Riceverai la fattura elettronica tramite il Sistema di Interscambio (SDI).',
  ];
  return {
    subject: `[sonoQui] ${p.itemLabel} attivo`,
    text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
    html: shell({ heading, paragraphs, ctaLabel: 'Piano e moduli', ctaUrl: url }),
  };
}

export function buildPaymentFailedMail(p: { companyName: string; itemLabel: string; language: Lang }): BuiltMail {
  const url = webUrl('/settings/subscription?action=payment-method');
  if (p.language === 'en') {
    const heading = 'Payment failed';
    const paragraphs = [
      `We could not collect the payment for <strong>${escapeHtml(p.itemLabel)}</strong> (${escapeHtml(p.companyName)}).`,
      'We will retry automatically over the next days. To avoid losing the service, update the payment method now.',
    ];
    return {
      subject: '[sonoQui] Payment failed — update your payment method',
      text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
      html: shell({ heading, paragraphs, ctaLabel: 'Update payment method', ctaUrl: url }),
    };
  }
  const heading = 'Pagamento non riuscito';
  const paragraphs = [
    `Non siamo riusciti a incassare il pagamento per <strong>${escapeHtml(p.itemLabel)}</strong> (${escapeHtml(p.companyName)}).`,
    'Riproveremo automaticamente nei prossimi giorni. Per non perdere il servizio, aggiorna subito il metodo di pagamento.',
  ];
  return {
    subject: '[sonoQui] Pagamento non riuscito — aggiorna il metodo di pagamento',
    text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
    html: shell({ heading, paragraphs, ctaLabel: 'Aggiorna il metodo di pagamento', ctaUrl: url }),
  };
}

export function buildSubscriptionEndedMail(p: {
  companyName: string;
  itemLabel: string;
  kind: 'plan' | 'module';
  overLimit: boolean;
  graceDays: number;
  language: Lang;
}): BuiltMail {
  const url = webUrl('/settings/subscription');
  if (p.language === 'en') {
    const heading = `${p.itemLabel} has ended`;
    const paragraphs = [
      p.kind === 'plan'
        ? `The <strong>${escapeHtml(p.itemLabel)}</strong> plan of ${escapeHtml(p.companyName)} has ended: the company is back on the Free plan (3 users, 1 site).`
        : `The <strong>${escapeHtml(p.itemLabel)}</strong> of ${escapeHtml(p.companyName)} has ended. Its data is kept: re-activate it to see it again.`,
      p.overLimit
        ? `You are above the Free limits: within ${p.graceDays} days remove the extra users/sites or re-activate a plan, otherwise exports will be locked (clocking in keeps working).`
        : '',
    ].filter(Boolean);
    return {
      subject: `[sonoQui] ${p.itemLabel} ended`,
      text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
      html: shell({ heading, paragraphs, ctaLabel: 'Plan and modules', ctaUrl: url }),
    };
  }
  const heading = `${p.itemLabel} terminato`;
  const paragraphs = [
    p.kind === 'plan'
      ? `Il piano <strong>${escapeHtml(p.itemLabel)}</strong> di ${escapeHtml(p.companyName)} è terminato: l'azienda torna al piano gratuito (3 utenti, 1 sede).`
      : `Il <strong>${escapeHtml(p.itemLabel)}</strong> di ${escapeHtml(p.companyName)} è terminato. I dati restano conservati: riattivalo per vederli di nuovo.`,
    p.overLimit
      ? `Sei oltre i limiti del piano gratuito: entro ${p.graceDays} giorni elimina gli utenti/le sedi in eccesso o riattiva un piano, altrimenti gli export verranno bloccati (le timbrature continuano a funzionare).`
      : '',
  ].filter(Boolean);
  return {
    subject: `[sonoQui] ${p.itemLabel} terminato`,
    text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
    html: shell({ heading, paragraphs, ctaLabel: 'Piano e moduli', ctaUrl: url }),
  };
}

export function buildOverLimitMail(p: {
  companyName: string;
  daysLeft: number;
  kinds: Array<'users' | 'branches' | 'admins'>;
  language: Lang;
}): BuiltMail {
  const url = webUrl('/settings/subscription');
  const what = (lang: Lang): string =>
    p.kinds
      .map((k) =>
        lang === 'it'
          ? { users: 'utenti', branches: 'sedi', admins: 'amministratori' }[k]
          : { users: 'users', branches: 'sites', admins: 'administrators' }[k]
      )
      .join(', ');
  if (p.language === 'en') {
    const heading = p.daysLeft > 0 ? `${p.daysLeft} days left to fix your plan limits` : 'Exports are locked';
    const paragraphs = [
      `${escapeHtml(p.companyName)} is above the Free plan limits (${escapeHtml(what('en'))}).`,
      p.daysLeft > 0
        ? `Within ${p.daysLeft} days delete the extra ones or re-activate a paid plan, otherwise exports will be locked. Clocking in keeps working.`
        : 'Exports are locked until the company fits the Free limits or a paid plan is active. Clocking in keeps working.',
    ];
    return {
      subject: `[sonoQui] ${heading}`,
      text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
      html: shell({ heading, paragraphs, ctaLabel: 'Plan and modules', ctaUrl: url }),
    };
  }
  const heading = p.daysLeft > 0 ? `Mancano ${p.daysLeft} giorni per rientrare nei limiti` : 'Export bloccati';
  const paragraphs = [
    `${escapeHtml(p.companyName)} è oltre i limiti del piano gratuito (${escapeHtml(what('it'))}).`,
    p.daysLeft > 0
      ? `Entro ${p.daysLeft} giorni elimina quelli in eccesso o riattiva un piano a pagamento, altrimenti gli export verranno bloccati. Le timbrature continuano a funzionare.`
      : "Gli export sono bloccati finché l'azienda non rientra nei limiti del piano gratuito o non attiva un piano a pagamento. Le timbrature continuano a funzionare.",
  ];
  return {
    subject: `[sonoQui] ${heading}`,
    text: textOf([heading, '', ...paragraphs.map(stripTags), '', url]),
    html: shell({ heading, paragraphs, ctaLabel: 'Piano e moduli', ctaUrl: url }),
  };
}

export function vatLabel(status: string): string {
  return status === 'valid'
    ? 'verificata VIES'
    : status === 'not_in_vies'
      ? 'non presente nel VIES'
      : 'VIES non raggiungibile';
}

/** Public website link used in some copy (kept here so the host lives in one place). */
export function websiteRegistrationUrl(): string {
  return siteUrl('/it/registrazione/');
}

/** Plain-text part: drop tags and undo escapeHtml (names like "D'Amico & C."). */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
