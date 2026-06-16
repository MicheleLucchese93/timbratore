import { createElement, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { color } from '@sonoqui/shared';
import { fmtDate, fmtTime } from '../i18n/format';

// Lazy-require the native picker so the web bundle doesn't try to load it.
// Mirrors the pattern used in Documents/Penno.
type RNDateTimePickerEvent =
  import('@react-native-community/datetimepicker').DateTimePickerEvent;
type RNDateTimePickerType =
  typeof import('@react-native-community/datetimepicker').default;
let RNDateTimePicker: RNDateTimePickerType | null = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RNDateTimePicker = require('@react-native-community/datetimepicker').default;
}

type Mode = 'date' | 'time';

interface DateFieldProps {
  mode: Mode;
  value: string;
  onChange: (next: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  /**
   * Restrict the time picker to minute slots that are multiples of this value.
   * Native iOS honours this directly (`minuteInterval`); Android's stock dialog
   * accepts any minute, so we round the selection to the nearest slot.
   */
  minuteInterval?: 1 | 5 | 10 | 15 | 20 | 30;
}

function roundMinutes(d: Date, step: number): Date {
  const minutes = d.getHours() * 60 + d.getMinutes();
  const rounded = Math.round(minutes / step) * step;
  const next = new Date(d);
  next.setHours(Math.floor(rounded / 60), rounded % 60, 0, 0);
  return next;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function parse(value: string, mode: Mode): Date {
  const now = new Date();
  if (mode === 'date') {
    const [y, mo, d] = value.split('-').map((s) => parseInt(s, 10));
    if (!y || !mo || !d) return now;
    return new Date(y, mo - 1, d, 12, 0, 0, 0);
  }
  const [h, m] = value.split(':').map((s) => parseInt(s, 10));
  const dt = new Date(now);
  dt.setHours(h ?? 0, m ?? 0, 0, 0);
  return dt;
}

function serialize(d: Date, mode: Mode): string {
  if (mode === 'date') {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function displayLabel(value: string, mode: Mode): string {
  const d = parse(value, mode);
  if (mode === 'date') {
    return fmtDate(d, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  return fmtTime(d, { hour: '2-digit', minute: '2-digit' });
}

export function DateField({
  mode,
  value,
  onChange,
  minimumDate,
  maximumDate,
  minuteInterval,
}: DateFieldProps) {
  // Hooks must run unconditionally on every render — call them before the
  // web-only early return below (Platform.OS is constant, but the linter and
  // the rules of hooks require the call order to be stable regardless).
  const { t } = useTranslation(['components', 'common']);
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(() => parse(value, mode));

  if (Platform.OS === 'web') {
    return (
      <View style={styles.fieldBox}>
        {createElement('input', {
          type: mode === 'date' ? 'date' : 'time',
          value,
          onChange: (e: { target: { value: string } }) =>
            onChange(e.target.value),
          style: {
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 15,
            width: '100%',
            color: color.onSurface,
            fontFamily: 'inherit',
          },
        })}
      </View>
    );
  }

  function openPicker() {
    setTempDate(parse(value, mode));
    setOpen(true);
  }

  function handleChange(event: RNDateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') {
      // Android dialog closes itself on each change. Commit on 'set', drop on
      // 'dismissed'. Round to minuteInterval since Android's stock dialog
      // doesn't honour the prop.
      setOpen(false);
      if (event.type === 'set' && selected) {
        const final =
          mode === 'time' && minuteInterval
            ? roundMinutes(selected, minuteInterval)
            : selected;
        onChange(serialize(final, mode));
      }
      return;
    }
    // iOS spinner stays open inside our modal; just track the wheel state.
    if (selected) {
      setTempDate(selected);
    }
  }

  function handleConfirm() {
    const final =
      mode === 'time' && minuteInterval
        ? roundMinutes(tempDate, minuteInterval)
        : tempDate;
    onChange(serialize(final, mode));
    setOpen(false);
  }

  function handleCancel() {
    setOpen(false);
  }

  if (Platform.OS === 'android') {
    return (
      <>
        <Pressable onPress={openPicker} style={styles.fieldBox}>
          <Text style={styles.fieldText}>{displayLabel(value, mode)}</Text>
        </Pressable>
        {open && RNDateTimePicker ? (
          <RNDateTimePicker
            value={tempDate}
            mode={mode}
            display="default"
            is24Hour
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            minuteInterval={minuteInterval}
            onChange={handleChange}
          />
        ) : null}
      </>
    );
  }

  // iOS — Penno pattern: tappable field opens a slide-up modal with the
  // spinner picker and Annulla / Fatto buttons.
  return (
    <>
      <Pressable onPress={openPicker} style={styles.fieldBox}>
        <Text style={styles.fieldText}>{displayLabel(value, mode)}</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={handleCancel}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={handleCancel} hitSlop={8}>
                <Text style={styles.modalCancel}>{t('common:btn.cancel')}</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {mode === 'date' ? t('dateField.selectDate') : t('dateField.selectTime')}
              </Text>
              <TouchableOpacity onPress={handleConfirm} hitSlop={8}>
                <Text style={styles.modalDone}>{t('dateField.done')}</Text>
              </TouchableOpacity>
            </View>
            {RNDateTimePicker ? (
              <RNDateTimePicker
                value={tempDate}
                mode={mode}
                display="spinner"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                minuteInterval={minuteInterval}
                onChange={handleChange}
                style={styles.iosPicker}
                themeVariant="light"
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fieldBox: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: color.surfaceVariant,
    minHeight: 48,
    justifyContent: 'center',
  },
  fieldText: {
    fontSize: 15,
    color: color.onSurface,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceVariant,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: color.onSurface,
  },
  modalCancel: {
    fontSize: 15,
    color: color.onSurfaceVariant,
  },
  modalDone: {
    fontSize: 15,
    fontWeight: '700',
    color: color.primary,
  },
  iosPicker: {
    alignSelf: 'stretch',
  },
});
