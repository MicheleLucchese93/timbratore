import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CantiereRecord, CantieriFieldDef } from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { CantieriTabs } from '../components/CantieriTabs.tsx';
import { CantieriFieldDefsSection } from '../components/CantieriFields.tsx';

/**
 * "Campi personalizzati" submenu: manages the entry-scope custom fields shown on
 * the mobile activity form, plus their per-cantiere association (a field with no
 * cantiere selected applies to every site). Vehicle (mezzo) custom fields stay
 * on the Mezzi page — they are not tied to a site.
 */
export function CantieriCampi() {
  const { t } = useTranslation(['cantieri', 'common']);
  const [fields, setFields] = useState<CantieriFieldDef[]>([]);
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([
        api<{ fields: CantieriFieldDef[] }>('/api/v1/cantieri/fields?scope=entry'),
        api<{ sites: CantiereRecord[] }>('/api/v1/cantieri/sites'),
      ]);
      setFields(f.fields);
      setSites(s.sites.map((x) => ({ id: x.id, name: x.name })));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const loadFields = useCallback(async () => {
    const f = await api<{ fields: CantieriFieldDef[] }>('/api/v1/cantieri/fields?scope=entry');
    setFields(f.fields);
  }, []);

  return (
    <div className="space-y-5">
      <CantieriTabs />
      <PageHeader title={t('campi.title')} subtitle={t('campi.subtitle')} />

      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

      <CantieriFieldDefsSection
        scope="entry"
        defs={fields}
        sites={sites}
        onChanged={loadFields}
      />
    </div>
  );
}
