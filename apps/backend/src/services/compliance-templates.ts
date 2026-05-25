export function renderDpiaHtml(tenant: { ragione_sociale: string; country: string; retention_years: number }): string {
  return `<!doctype html>
<html lang="it">
<head><meta charset="utf-8"><title>DPIA — ${escapeHtml(tenant.ragione_sociale)}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.5}h1,h2{font-family:Georgia,serif}</style>
</head>
<body>
<h1>Valutazione d'Impatto sulla Protezione dei Dati (DPIA)</h1>
<p><strong>Titolare:</strong> ${escapeHtml(tenant.ragione_sociale)} (${escapeHtml(tenant.country)})</p>
<h2>1. Finalità del trattamento</h2>
<p>Rilevazione presenze ai fini gestionali e amministrativi, per il calcolo delle ore lavorate del personale dipendente.</p>
<h2>2. Categorie di dati</h2>
<ul><li>Identificativi del dipendente (nome, email)</li>
<li>Eventi di timbratura (ingresso, uscita, pausa) con orario</li>
<li>Coordinate GPS al momento della timbratura (cancellate dopo 90 giorni)</li>
<li>Identificativo della sede</li></ul>
<h2>3. Base giuridica</h2>
<p>Art. 6.1.b GDPR (esecuzione del contratto di lavoro), art. 88 GDPR e provvedimenti del Garante Privacy in materia di rilevazione presenze.</p>
<h2>4. Conservazione</h2>
<p>Dati conservati per <strong>${tenant.retention_years} anni</strong>. Coordinate GPS anonimizzate dopo 90 giorni: viene mantenuto solo l'identificativo della sede.</p>
<h2>5. Sub-fornitori</h2>
<ul><li>OVHcloud (hosting, IT/FR)</li><li>Cloudflare (CDN/DNS, EU)</li><li>Apple/Google (notifiche push, EU/US — SCC)</li><li>Brevo (email transazionale, EU)</li></ul>
<h2>6. Misure di sicurezza</h2>
<ul><li>Cifratura TLS in transito; cifratura at-rest del database</li>
<li>Isolamento multi-tenant via Row-Level Security PostgreSQL</li>
<li>Backup giornalieri 30gg; audit log immutabile</li>
<li>Nessun tracciamento continuo della posizione; nessun riconoscimento facciale</li></ul>
<h2>7. Diritti dell'interessato</h2>
<p>Accesso, rettifica, cancellazione tramite l'app o richiesta scritta al titolare.</p>
<p style="margin-top:3rem;font-size:0.9rem;color:#666"><em>Modello generato da sonoQui. Da rivedere e personalizzare con il proprio DPO o legale prima della firma.</em></p>
</body></html>`;
}

export function renderPrivacyNoticeHtml(tenant: { ragione_sociale: string; country: string }): string {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Informativa privacy — ${escapeHtml(tenant.ragione_sociale)}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.5}</style></head>
<body>
<h1>Informativa sul trattamento dei dati personali (art. 13 GDPR)</h1>
<p><strong>Titolare:</strong> ${escapeHtml(tenant.ragione_sociale)} (${escapeHtml(tenant.country)})</p>
<p><strong>Responsabile del trattamento:</strong> Archiva Group — sonoQui.</p>
<p>I dati raccolti tramite l'app sonoQui sono utilizzati esclusivamente per la rilevazione presenze. La posizione GPS è acquisita solo al momento della timbratura e mai in background.</p>
<p>L'interessato può esercitare i propri diritti contattando il titolare oppure scrivendo a <code>privacy@${tenant.ragione_sociale.toLowerCase().replace(/[^a-z0-9]+/g, '')}.it</code>.</p>
<p style="margin-top:3rem;font-size:0.9rem;color:#666"><em>Modello generato da sonoQui — da personalizzare con il proprio referente legale.</em></p>
</body></html>`;
}

export function renderArt4ChecklistHtml(tenant: { ragione_sociale: string }): string {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Checklist Art. 4 — ${escapeHtml(tenant.ragione_sociale)}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.5}.check{margin:0.6rem 0}</style></head>
<body>
<h1>Checklist art. 4 Statuto dei Lavoratori — ${escapeHtml(tenant.ragione_sociale)}</h1>
<p>Passi consigliati per adempiere all'art. 4 L. 300/1970 quando si introduce un sistema di rilevazione presenze.</p>
<div class="check">☐ Verificare se l'attività rientra fra gli strumenti di lavoro (comma 2) — SonoQui lo è.</div>
<div class="check">☐ Predisporre informativa preventiva ai lavoratori sulle modalità d'uso.</div>
<div class="check">☐ Predisporre accordo aziendale con RSA/RSU (se presenti) oppure istanza all'Ispettorato Territoriale del Lavoro.</div>
<div class="check">☐ Conservare copia firmata di accordo o autorizzazione.</div>
<div class="check">☐ Aggiornare il Registro dei trattamenti (art. 30 GDPR).</div>
<div class="check">☐ Conservare valutazione di impatto (DPIA) firmata dal Titolare.</div>
<div class="check">☐ Formare il personale e gli amministratori sull'uso dell'app.</div>
<p style="margin-top:3rem;font-size:0.9rem;color:#666"><em>Da rivedere con il proprio legale del lavoro / consulente.</em></p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
  );
}
