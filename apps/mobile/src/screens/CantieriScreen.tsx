import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  CANTIERE_ACTIVITY_TEXT_MAX,
  cantiereEntryFieldsFor,
  cantieriIntervalMinutes,
  color,
  space,
  type CantiereEntryRecord,
  type CantiereRecord,
  type CantieriCustomValues,
  type CantieriFieldDef,
  type MezzoRecord,
} from '@sonoqui/shared';
import i18n from '../i18n';
import { fmtDate } from '../i18n/format';
import { api } from '../lib/api';
import { useSession } from '../store/session';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { DateField } from '../components/DateField';

type MyEntry = CantiereEntryRecord & {
  cantiere_name: string | null;
  mezzo_name: string | null;
};

// Custom-field inputs are kept as raw UI values (string for everything typed,
// boolean for switches) and converted to typed custom_values on submit.
type RawCustomMap = Record<string, string | boolean>;

export function CantieriScreen() {
  const { t } = useTranslation(['cantieri', 'common']);
  const { me } = useSession();
  // Read once from the screen (outside the Modal): react-native-safe-area-context
  // reports 0 insets inside a RN <Modal>, so the modal header would slide under
  // the notch/status bar. Apply this top inset to the modal manually.
  const insets = useSafeAreaInsets();
  // Tab is hidden when the module is off, but the route can still be reached
  // (deep link / stale session) — same predicate as the tab-bar filter.
  const enabled =
    me?.tenant.cantieri_enabled === true && me?.user.cantieri_role != null;

  // The activity form lives in a full-screen modal opened by the FAB (new) or by
  // tapping an entry (edit); the screen itself is just the activity list.
  const [formOpen, setFormOpen] = useState(false);

  // Reference data for the form (assigned open sites, assigned mezzi,
  // entry-scope custom field definitions).
  const [sites, setSites] = useState<CantiereRecord[]>([]);
  const [mezzi, setMezzi] = useState<MezzoRecord[]>([]);
  const [fields, setFields] = useState<CantieriFieldDef[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Own entries, one month at a time.
  const [month, setMonth] = useState(() => currentMonth());
  const [entries, setEntries] = useState<MyEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // List filters: period (a single month with arrows, or all time) + cantiere.
  const [allTime, setAllTime] = useState(false);
  const [filterCantiereId, setFilterCantiereId] = useState<string | null>(null);
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);

  // Form state. `editing` non-null = the form PATCHes that entry.
  const [editing, setEditing] = useState<MyEntry | null>(null);
  const [cantiereId, setCantiereId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(() => isoLocal(new Date()));
  const [travelStart, setTravelStart] = useState<string | null>(null);
  const [travelEnd, setTravelEnd] = useState<string | null>(null);
  const [activityStart, setActivityStart] = useState<string | null>(null);
  const [activityEnd, setActivityEnd] = useState<string | null>(null);
  const [activityText, setActivityText] = useState('');
  const [mezzoId, setMezzoId] = useState<string | null>(null);
  const [custom, setCustom] = useState<RawCustomMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [mezzoPickerOpen, setMezzoPickerOpen] = useState(false);
  const [openSelectKey, setOpenSelectKey] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [s, m, f] = await Promise.all([
        api<{ sites: CantiereRecord[] }>('/api/v1/cantieri/my/sites'),
        api<{ mezzi: MezzoRecord[] }>('/api/v1/cantieri/my/mezzi'),
        api<{ fields: CantieriFieldDef[] }>('/api/v1/cantieri/fields?scope=entry'),
      ]);
      setSites(s.sites);
      setMezzi(m.mezzi);
      setFields(f.fields);
    } catch {
      /* ignore */
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const loadEntries = useCallback(async (m: string | null, cantiereId: string | null) => {
    try {
      const qs = new URLSearchParams();
      if (m) qs.set('month', m);
      if (cantiereId) qs.set('cantiere_id', cantiereId);
      const { entries: list } = await api<{ entries: MyEntry[] }>(
        `/api/v1/cantieri/my/entries?${qs.toString()}`
      );
      setEntries(list);
    } catch {
      /* ignore */
    } finally {
      setLoadingEntries(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadMeta();
  }, [enabled, loadMeta]);

  useEffect(() => {
    if (!enabled) return;
    setLoadingEntries(true);
    void loadEntries(allTime ? null : month, filterCantiereId);
  }, [enabled, month, allTime, filterCantiereId, loadEntries]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setCantiereId(null);
    setEntryDate(isoLocal(new Date()));
    setTravelStart(null);
    setTravelEnd(null);
    setActivityStart(null);
    setActivityEnd(null);
    setActivityText('');
    setMezzoId(null);
    setCustom({});
  }, []);

  function setCustomValue(key: string, value: string | boolean) {
    setCustom((prev) => ({ ...prev, [key]: value }));
  }

  function startEdit(e: MyEntry) {
    setEditing(e);
    setCantiereId(e.cantiere_id);
    setEntryDate(e.entry_date);
    setTravelStart(e.travel_start);
    setTravelEnd(e.travel_end);
    setActivityStart(e.activity_start);
    setActivityEnd(e.activity_end);
    setActivityText(e.activity_text ?? '');
    setMezzoId(e.mezzo_id);
    setCustom(rawFromValues(e.custom_values ?? {}, fields));
    setFormOpen(true);
  }

  function openNew() {
    resetForm();
    // Ask which cantiere FIRST, as a standalone step: one assigned site →
    // preselect it and go straight to the form; several → open the picker and
    // let its selection open the form; none → open the form's empty state.
    if (sites.length === 1) {
      setCantiereId(sites[0].id);
      setFormOpen(true);
    } else if (sites.length > 1) {
      setSitePickerOpen(true);
    } else {
      setFormOpen(true);
    }
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
  }

  function remove(e: MyEntry) {
    confirmAction(t('confirm.deleteTitle'), t('confirm.deleteMessage'), async () => {
      try {
        await api(`/api/v1/cantieri/entries/${e.id}`, { method: 'DELETE' });
        if (editing?.id === e.id) resetForm();
        await loadEntries(allTime ? null : month, filterCantiereId);
      } catch (err) {
        showError(err);
      }
    });
  }

  async function submit() {
    if (!cantiereId) {
      notify(t('form.siteRequiredTitle'), t('form.siteRequiredMessage'));
      return;
    }
    // Each time pair is optional, but an end needs its start and must follow it.
    const pairs: Array<{ start: string | null; end: string | null; section: string }> = [
      { start: travelStart, end: travelEnd, section: t('form.travelLabel') },
      { start: activityStart, end: activityEnd, section: t('form.activityTimeLabel') },
    ];
    for (const p of pairs) {
      if (p.end && !p.start) {
        notify(t('form.endWithoutStartTitle'), t('form.endWithoutStartMessage', { section: p.section }));
        return;
      }
      if (p.start && p.end && cantieriIntervalMinutes(p.start, p.end) === null) {
        notify(t('form.invertedRangeTitle'), t('form.invertedRangeMessage', { section: p.section }));
        return;
      }
    }
    // Client-side mirror of the backend validation: required non-empty,
    // number fields numeric. Booleans are always sent (false is a valid value).
    // Only the fields shown for the chosen cantiere are validated + sent.
    const custom_values: CantieriCustomValues = {};
    for (const f of cantiereEntryFieldsFor(fields, cantiereId)) {
      const raw = custom[f.key];
      if (f.field_type === 'boolean') {
        custom_values[f.key] = raw === true;
        continue;
      }
      const s = typeof raw === 'string' ? raw.trim() : '';
      if (!s) {
        if (f.required) {
          notify(t('form.fieldRequiredTitle'), t('form.fieldRequiredMessage', { label: f.label }));
          return;
        }
        continue;
      }
      if (f.field_type === 'number') {
        const n = Number(s.replace(',', '.'));
        if (!Number.isFinite(n)) {
          notify(t('form.fieldNumberTitle'), t('form.fieldNumberMessage', { label: f.label }));
          return;
        }
        custom_values[f.key] = n;
      } else {
        custom_values[f.key] = s;
      }
    }
    setSubmitting(true);
    try {
      const body = {
        entry_date: entryDate,
        travel_start: travelStart,
        travel_end: travelEnd,
        activity_start: activityStart,
        activity_end: activityEnd,
        activity_text: activityText.trim() || null,
        mezzo_id: mezzoId,
        custom_values,
      };
      const wasEdit = editing != null;
      if (editing) {
        await api(`/api/v1/cantieri/entries/${editing.id}`, { method: 'PATCH', json: body });
      } else {
        await api('/api/v1/cantieri/entries', {
          method: 'POST',
          json: { ...body, cantiere_id: cantiereId },
        });
      }
      setFormOpen(false);
      resetForm();
      setLoadingEntries(true);
      void loadEntries(allTime ? null : month, filterCantiereId);
      notify(
        t(wasEdit ? 'form.savedTitle' : 'form.createdTitle'),
        t(wasEdit ? 'form.savedMessage' : 'form.createdMessage')
      );
    } catch (e) {
      showError(e);
    } finally {
      setSubmitting(false);
    }
  }

  const byDay = useMemo(() => {
    // Server order is entry_date DESC, created_at DESC — grouping preserves it.
    const map = new Map<string, MyEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.entry_date) ?? [];
      arr.push(e);
      map.set(e.entry_date, arr);
    }
    return Array.from(map.entries()).map(([day, rows]) => ({ day, rows }));
  }, [entries]);

  // Custom fields shown for the chosen cantiere (global + site-specific). Before
  // a site is picked only the global fields (no association) are shown.
  const visibleFields = useMemo(
    () => cantiereEntryFieldsFor(fields, cantiereId),
    [fields, cantiereId]
  );

  const travelMin = cantieriIntervalMinutes(travelStart, travelEnd);
  const activityMin = cantieriIntervalMinutes(activityStart, activityEnd);
  const selectedSiteName = editing
    ? (editing.cantiere_name ?? sites.find((s) => s.id === cantiereId)?.name ?? null)
    : (sites.find((s) => s.id === cantiereId)?.name ?? null);
  const selectedMezzoName = mezzoId
    ? (mezzi.find((m) => m.id === mezzoId)?.name ?? editing?.mezzo_name ?? null)
    : null;
  const openSelectDef = openSelectKey
    ? (visibleFields.find((f) => f.key === openSelectKey) ?? null)
    : null;

  if (!enabled) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <AppHeader />
        <View style={styles.guardWrap}>
          <EmptyState
            icon="construct-outline"
            title={t('guard.title')}
            subtitle={t('guard.subtitle')}
            fill
            bare
          />
        </View>
      </SafeAreaView>
    );
  }

  function renderCustomField(f: CantieriFieldDef) {
    const raw = custom[f.key];
    const label = f.required ? `${f.label} *` : f.label;
    if (f.field_type === 'boolean') {
      return (
        <View key={f.id} style={styles.switchRow}>
          <Text style={styles.switchLabel}>{f.label}</Text>
          <Switch
            value={raw === true}
            onValueChange={(v) => setCustomValue(f.key, v)}
            trackColor={{ true: color.primary }}
          />
        </View>
      );
    }
    if (f.field_type === 'date' || f.field_type === 'time') {
      const s = typeof raw === 'string' ? raw : '';
      return (
        <OptionalDateTimeField
          key={f.id}
          mode={f.field_type}
          label={label}
          value={s || null}
          onChange={(v) => setCustomValue(f.key, v ?? '')}
        />
      );
    }
    if (f.field_type === 'select') {
      const s = typeof raw === 'string' ? raw : '';
      return (
        <View key={f.id}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Pressable onPress={() => setOpenSelectKey(f.key)} style={styles.pickerBtn}>
            <Text style={[styles.pickerBtnText, !s && styles.pickerPlaceholder]}>
              {s || t('form.selectPlaceholder')}
            </Text>
            <Ionicons name="chevron-down" size={18} color={color.onSurfaceVariant} />
          </Pressable>
        </View>
      );
    }
    // text / number
    const s = typeof raw === 'string' ? raw : '';
    return (
      <View key={f.id}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          value={s}
          onChangeText={(v) => setCustomValue(f.key, v)}
          keyboardType={f.field_type === 'number' ? 'decimal-pad' : 'default'}
          placeholderTextColor={color.onSurfaceVariant}
          style={styles.input}
        />
      </View>
    );
  }

  const renderNewPage = (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled">
        {loadingMeta ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : sites.length === 0 && !editing ? (
          <EmptyState
            icon="business-outline"
            title={t('form.noSitesTitle')}
            subtitle={t('form.noSitesSubtitle')}
            fill
            bare
          />
        ) : (
          <>
            <Text style={styles.fieldLabel}>{t('form.dateLabel')}</Text>
            <DateField mode="date" value={entryDate} onChange={setEntryDate} />

            <Text style={styles.fieldLabel}>{t('form.travelLabel')}</Text>
            <View style={styles.timeRow}>
              <OptionalDateTimeField
                mode="time"
                label={t('form.startLabel')}
                value={travelStart}
                onChange={setTravelStart}
                style={{ flex: 1 }}
              />
              <OptionalDateTimeField
                mode="time"
                label={t('form.endLabel')}
                value={travelEnd}
                onChange={setTravelEnd}
                style={{ flex: 1 }}
              />
            </View>
            {travelMin != null && (
              <Text style={styles.durationHint}>
                {t('form.duration', { value: fmtMinutes(travelMin) })}
              </Text>
            )}

            <Text style={styles.fieldLabel}>{t('form.activityTimeLabel')}</Text>
            <View style={styles.timeRow}>
              <OptionalDateTimeField
                mode="time"
                label={t('form.startLabel')}
                value={activityStart}
                onChange={setActivityStart}
                style={{ flex: 1 }}
              />
              <OptionalDateTimeField
                mode="time"
                label={t('form.endLabel')}
                value={activityEnd}
                onChange={setActivityEnd}
                style={{ flex: 1 }}
              />
            </View>
            {activityMin != null && (
              <Text style={styles.durationHint}>
                {t('form.duration', { value: fmtMinutes(activityMin) })}
              </Text>
            )}

            <Text style={styles.fieldLabel}>{t('form.activityTextLabel')}</Text>
            <TextInput
              value={activityText}
              onChangeText={setActivityText}
              placeholder={t('form.activityTextPlaceholder')}
              placeholderTextColor={color.onSurfaceVariant}
              multiline
              numberOfLines={4}
              maxLength={CANTIERE_ACTIVITY_TEXT_MAX}
              style={[styles.input, styles.textarea]}
            />

            {mezzi.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>{t('form.mezzoLabel')}</Text>
                <Pressable onPress={() => setMezzoPickerOpen(true)} style={styles.pickerBtn}>
                  <Text
                    style={[styles.pickerBtnText, !selectedMezzoName && styles.pickerPlaceholder]}>
                    {selectedMezzoName ?? t('form.mezzoPlaceholder')}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={color.onSurfaceVariant} />
                </Pressable>
              </>
            )}

            {visibleFields.map(renderCustomField)}
          </>
        )}
      </ScrollView>

      {/* Fixed submit footer — stays pinned above the Android nav bar / iOS home
          indicator (insets read from the screen; they are 0 inside a Modal). */}
      {!loadingMeta && (sites.length > 0 || editing) && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]}>
            {submitting ? (
              <ActivityIndicator color={color.onPrimary} />
            ) : (
              <>
                <Ionicons
                  name={editing ? 'save-outline' : 'send-outline'}
                  size={18}
                  color={color.onPrimary}
                />
                <Text style={styles.submitText}>
                  {editing ? t('form.submitEdit') : t('form.submitNew')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );

  const filterSiteName = filterCantiereId
    ? (sites.find((s) => s.id === filterCantiereId)?.name ?? t('filter.allSites'))
    : t('filter.allSites');

  const renderMinePage = (
    <View style={{ flex: 1 }}>
      <View style={styles.filterBar}>
        <Pressable
          style={[styles.filterChip, filterCantiereId != null && styles.filterChipActive]}
          onPress={() => setFilterPickerOpen(true)}>
          <Ionicons
            name="business-outline"
            size={14}
            color={filterCantiereId != null ? color.primary : color.onSurfaceVariant}
          />
          <Text
            style={[styles.filterChipText, filterCantiereId != null && styles.filterChipTextActive]}
            numberOfLines={1}>
            {filterSiteName}
          </Text>
          <Ionicons name="chevron-down" size={14} color={color.onSurfaceVariant} />
        </Pressable>
        <Pressable
          style={[styles.filterChip, allTime && styles.filterChipActive]}
          onPress={() => setAllTime((a) => !a)}>
          <Ionicons
            name={allTime ? 'infinite' : 'calendar-outline'}
            size={14}
            color={allTime ? color.primary : color.onSurfaceVariant}
          />
          <Text style={[styles.filterChipText, allTime && styles.filterChipTextActive]}>
            {allTime ? t('filter.allTime') : t('filter.byMonth')}
          </Text>
        </Pressable>
      </View>

      {!allTime && (
        <View style={styles.monthRow}>
          <TouchableOpacity
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
            style={styles.monthBtn}
            hitSlop={8}
            accessibilityLabel={t('list.prevMonthA11y')}>
            <Ionicons name="chevron-back" size={20} color={color.onSurface} />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
          <TouchableOpacity
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
            style={styles.monthBtn}
            hitSlop={8}
            accessibilityLabel={t('list.nextMonthA11y')}>
            <Ionicons name="chevron-forward" size={20} color={color.onSurface} />
          </TouchableOpacity>
        </View>
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadEntries(allTime ? null : month, filterCantiereId);
            }}
          />
        }>
        {loadingEntries && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!loadingEntries && entries.length === 0 && (
          <EmptyState
            icon="construct-outline"
            title={t('list.empty')}
            subtitle={t('list.emptySub')}
            fill
            bare
          />
        )}
        {byDay.map(({ day, rows }) => (
          <View key={day}>
            <Text style={styles.dayHeader}>{fmtDay(day)}</Text>
            {rows.map((e) => (
              <Pressable key={e.id} onPress={() => startEdit(e)} style={styles.entryCard}>
                <View style={styles.entryHeader}>
                  <Text style={styles.entrySite} numberOfLines={1}>
                    {e.cantiere_name ?? t('list.unknownSite')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => remove(e)}
                    hitSlop={8}
                    accessibilityLabel={t('list.deleteA11y')}>
                    <Ionicons name="trash-outline" size={18} color={color.error} />
                  </TouchableOpacity>
                </View>
                {rangeLine(e.travel_start, e.travel_end) && (
                  <View style={styles.metaRow}>
                    <Ionicons name="car-outline" size={14} color={color.onSurfaceVariant} />
                    <Text style={styles.metaText}>
                      {t('list.travel')} {rangeLine(e.travel_start, e.travel_end)}
                    </Text>
                  </View>
                )}
                {rangeLine(e.activity_start, e.activity_end) && (
                  <View style={styles.metaRow}>
                    <Ionicons name="hammer-outline" size={14} color={color.onSurfaceVariant} />
                    <Text style={styles.metaText}>
                      {t('list.activity')} {rangeLine(e.activity_start, e.activity_end)}
                    </Text>
                  </View>
                )}
                {e.mezzo_name && (
                  <View style={styles.metaRow}>
                    <Ionicons name="bus-outline" size={14} color={color.onSurfaceVariant} />
                    <Text style={styles.metaText}>{e.mezzo_name}</Text>
                  </View>
                )}
                {e.activity_text ? (
                  <Text style={styles.entryText} numberOfLines={2}>
                    {e.activity_text}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />

      {renderMinePage}

      <TouchableOpacity
        style={styles.fab}
        onPress={openNew}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('modal.newTitle')}>
        <Ionicons name="add" size={28} color={color.onPrimary} />
      </TouchableOpacity>

      {/* Step 1: pick the cantiere. Standalone (at screen root, not inside the
          form modal) so it is the first thing shown; selecting one opens the
          form. Dismissing it without a choice leaves the form closed. */}
      <ListPickerModal
        visible={sitePickerOpen}
        title={t('form.sitePickerTitle')}
        options={sites.map((s) => ({ id: s.id, label: s.name }))}
        selectedId={cantiereId}
        onSelect={(id) => {
          if (id) {
            setCantiereId(id);
            setFormOpen(true);
          }
        }}
        onClose={() => setSitePickerOpen(false)}
      />

      {/* List filter: which cantiere to show ("all" clears it). */}
      <ListPickerModal
        visible={filterPickerOpen}
        title={t('filter.siteTitle')}
        options={sites.map((s) => ({ id: s.id, label: s.name }))}
        selectedId={filterCantiereId}
        clearLabel={t('filter.allSites')}
        onSelect={setFilterCantiereId}
        onClose={() => setFilterPickerOpen(false)}
      />

      <Modal visible={formOpen} animationType="slide" onRequestClose={closeForm}>
        <View style={[styles.safe, { paddingTop: insets.top }]}>
          <View style={styles.formHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.formHeaderTitle} numberOfLines={1}>
                {editing ? t('modal.editTitle') : t('modal.newTitle')}
              </Text>
              {selectedSiteName ? (
                <Text style={styles.formHeaderSub} numberOfLines={1}>
                  {selectedSiteName}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={closeForm}
              hitSlop={8}
              accessibilityLabel={t('common:btn.cancel')}>
              <Ionicons name="close" size={26} color={color.onSurface} />
            </TouchableOpacity>
          </View>

          {renderNewPage}

          <ListPickerModal
            visible={mezzoPickerOpen}
            title={t('form.mezzoPickerTitle')}
            options={mezzi.map((m) => ({ id: m.id, label: m.name }))}
            selectedId={mezzoId}
            clearLabel={t('form.mezzoNone')}
            onSelect={setMezzoId}
            onClose={() => setMezzoPickerOpen(false)}
          />
          <ListPickerModal
            visible={openSelectDef != null}
            title={openSelectDef?.label ?? ''}
            options={(openSelectDef?.options ?? []).map((o) => ({ id: o, label: o }))}
            selectedId={
              openSelectDef && typeof custom[openSelectDef.key] === 'string'
                ? ((custom[openSelectDef.key] as string) || null)
                : null
            }
            clearLabel={openSelectDef && !openSelectDef.required ? t('form.selectNone') : undefined}
            onSelect={(id) => {
              if (openSelectDef) setCustomValue(openSelectDef.key, id ?? '');
            }}
            onClose={() => setOpenSelectKey(null)}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ----- pieces ----- */

// Optional date/time input: unset shows an "add" affordance, set shows the
// native DateField plus a clear button. '' and null both mean unset.
function OptionalDateTimeField({
  mode,
  label,
  value,
  onChange,
  style,
}: {
  mode: 'date' | 'time';
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation('cantieri');
  const set = value != null && value !== '';
  return (
    <View style={style}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {set ? (
        <View style={styles.optFieldRow}>
          <View style={{ flex: 1 }}>
            <DateField
              mode={mode}
              value={value ?? ''}
              onChange={onChange}
              minuteInterval={mode === 'time' ? 5 : undefined}
            />
          </View>
          <TouchableOpacity
            onPress={() => onChange(null)}
            hitSlop={8}
            accessibilityLabel={t('form.clearA11y')}>
            <Ionicons name="close-circle" size={20} color={color.onSurfaceVariant} />
          </TouchableOpacity>
        </View>
      ) : (
        <Pressable
          onPress={() => onChange(mode === 'time' ? nowTime() : isoLocal(new Date()))}
          style={styles.optFieldUnset}>
          <Ionicons name="add" size={16} color={color.onSurfaceVariant} />
          <Text style={styles.optFieldUnsetText}>
            {mode === 'time' ? t('form.setTime') : t('form.setDate')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

interface PickerOption {
  id: string;
  label: string;
}

// Bottom-sheet list picker (sites, mezzi, select custom fields). When
// `clearLabel` is given a "none" row is prepended that selects null.
function ListPickerModal({
  visible,
  title,
  options,
  selectedId,
  clearLabel,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId: string | null;
  clearLabel?: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.pickerOverlay} onPress={onClose}>
        <Pressable style={styles.pickerSheet} onPress={() => undefined}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={color.onSurface} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.pickerList}>
            {clearLabel != null && (
              <Pressable
                onPress={() => {
                  onSelect(null);
                  onClose();
                }}
                style={styles.pickerRow}>
                <Text style={[styles.pickerRowText, styles.pickerRowMuted]}>{clearLabel}</Text>
                {selectedId === null && (
                  <Ionicons name="checkmark" size={16} color={color.primary} />
                )}
              </Pressable>
            )}
            {options.map((o) => {
              const sel = o.id === selectedId;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => {
                    onSelect(o.id);
                    onClose();
                  }}
                  style={[styles.pickerRow, sel && styles.pickerRowSel]}>
                  <Text style={[styles.pickerRowText, sel && styles.pickerRowTextSel]}>
                    {o.label}
                  </Text>
                  {sel && <Ionicons name="checkmark" size={16} color={color.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ----- helpers ----- */

function confirmAction(title: string, msg: string, fn: () => void): void {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${msg}`)) fn();
    return;
  }
  Alert.alert(title, msg, [
    { text: i18n.t('common:btn.cancel'), style: 'cancel' },
    { text: i18n.t('common:btn.confirm'), onPress: fn },
  ]);
}

function notify(title: string, msg: string): void {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${msg}`);
    return;
  }
  Alert.alert(title, msg);
}

function showError(err: unknown): void {
  const e = err as { message?: string };
  if (Platform.OS === 'web') {
    window.alert(e.message ?? i18n.t('cantieri:error.operationFailed'));
    return;
  }
  Alert.alert(
    i18n.t('common:state.error'),
    e.message ?? i18n.t('cantieri:error.operationFailed')
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Current wall-clock time rounded to the nearest 5' slot (DateField step).
function nowTime(): string {
  const d = new Date();
  d.setMinutes(Math.round(d.getMinutes() / 5) * 5, 0, 0);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map((s) => parseInt(s, 10));
  const d = new Date(y ?? 2000, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map((s) => parseInt(s, 10));
  return fmtDate(new Date(y ?? 2000, (m ?? 1) - 1, 1), { month: 'long', year: 'numeric' });
}

function fmtDay(iso: string): string {
  return fmtDate(new Date(`${iso}T12:00:00`), {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

// 0 → "0m", 90 → "1h 30m", 120 → "2h".
function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// "08:00–12:30 · 4h 30m"; open-ended sides render as "—". Null when the
// entry carries no time at all for the pair.
function rangeLine(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const span = `${start ?? '—'}–${end ?? '—'}`;
  const min = cantieriIntervalMinutes(start, end);
  return min != null ? `${span} · ${fmtMinutes(min)}` : span;
}

// Seed the raw form map from stored custom_values (edit mode).
function rawFromValues(values: CantieriCustomValues, fields: CantieriFieldDef[]): RawCustomMap {
  const raw: RawCustomMap = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.field_type === 'boolean') raw[f.key] = v === true;
    else raw[f.key] = v == null ? '' : String(v);
  }
  return raw;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  guardWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: space.s4 },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 6, paddingBottom: 96 },
  formContent: { flexGrow: 1, padding: 6, paddingBottom: 16, gap: 14 },

  centered: { paddingVertical: 48, alignItems: 'center' },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    marginBottom: 4,
  },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(0,0,0,0.25)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 6,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceVariant,
  },
  formHeaderTitle: { fontSize: 17, fontWeight: '700', color: color.onSurface },
  formHeaderSub: { fontSize: 13, fontWeight: '600', color: color.primary, marginTop: 2 },

  footer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.surfaceVariant,
    backgroundColor: color.surface,
  },

  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.surfaceVariant,
    minHeight: 48,
  },
  pickerBtnDisabled: { opacity: 0.6 },
  pickerBtnText: { flex: 1, fontSize: 15, color: color.onSurface },
  pickerPlaceholder: { color: color.onSurfaceVariant },

  timeRow: { flexDirection: 'row', gap: 8 },
  optFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  optFieldUnset: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.surfaceVariant,
    borderStyle: 'dashed',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  optFieldUnsetText: { fontSize: 13, fontWeight: '600', color: color.onSurfaceVariant },
  durationHint: {
    fontSize: 12,
    color: color.onSurfaceVariant,
    paddingHorizontal: 4,
    marginTop: -8,
    fontVariant: ['tabular-nums'],
  },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.surfaceVariant,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 48,
  },
  switchLabel: { flex: 1, fontSize: 15, color: color.onSurface, paddingRight: 8 },

  input: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: color.onSurface,
    borderWidth: 1,
    borderColor: color.surfaceVariant,
  },
  textarea: { minHeight: 96, textAlignVertical: 'top' },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: color.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 24,
    marginTop: 8,
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  submitText: { fontSize: 16, fontWeight: '700', color: color.onPrimary },

  filterBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 6,
    paddingBottom: space.s2,
  },
  filterChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: color.surfaceVariant,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: { borderColor: color.primary, backgroundColor: color.primaryContainer },
  filterChipText: { flex: 1, fontSize: 13, fontWeight: '600', color: color.onSurfaceVariant },
  filterChipTextActive: { color: color.primary },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingBottom: space.s2,
  },
  monthBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceVariant,
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: color.onSurface,
    textTransform: 'capitalize',
  },

  dayHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    textTransform: 'capitalize',
    paddingHorizontal: 4,
    marginBottom: 6,
    marginTop: 4,
  },
  entryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    marginBottom: space.s3,
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  entrySite: { flex: 1, fontSize: 15, fontWeight: '700', color: color.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  metaText: {
    fontSize: 13,
    color: color.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  entryText: { marginTop: 10, fontSize: 14, color: color.onSurface, lineHeight: 20 },

  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceVariant,
  },
  pickerTitle: { fontSize: 15, fontWeight: '600', color: color.onSurface },
  pickerList: { paddingVertical: 4 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickerRowSel: { backgroundColor: color.surfaceVariant },
  pickerRowText: { flex: 1, fontSize: 15, color: color.onSurface },
  pickerRowTextSel: { fontWeight: '700', color: color.primary },
  pickerRowMuted: { color: color.onSurfaceVariant },
});
