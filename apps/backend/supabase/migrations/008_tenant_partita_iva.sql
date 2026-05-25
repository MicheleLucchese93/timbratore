-- Tenant Partita IVA (Italian VAT). Set at provisioning, exposed read-only in app settings.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS partita_iva text;
