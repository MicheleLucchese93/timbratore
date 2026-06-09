import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';

export interface PlaceSuggestion {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export interface PlaceDetail {
  place_id: string;
  description: string;
  display_name: string | null;
  formatted_address: string | null;
  geometry: { location: { lat: number; lng: number } } | null;
}

interface Props {
  value: string;
  onChange: (address: string) => void;
  onSelect: (detail: PlaceDetail) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Show the loading indicator from an external operation (e.g. reverse geocoding a map pin). */
  busy?: boolean;
}

export interface PlaceSearchHandle {
  /**
   * Skip the search that the next `value` change would otherwise trigger. Call
   * before programmatically setting the address (e.g. from a map pin) so the
   * autocomplete dropdown stays closed instead of querying the new text.
   */
  suppressNextSearch: () => void;
}

export const PlaceSearchInput = forwardRef<PlaceSearchHandle, Props>(function PlaceSearchInput({
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
  required,
  busy,
}, ref) {
  const { t } = useTranslation('components');
  const listId = useId();
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const skipSearchRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({
    suppressNextSearch() {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Invalidate any in-flight search so its late response can't reopen the list.
      reqIdRef.current++;
      skipSearchRef.current = true;
      setLoading(false);
      setOpen(false);
      setSuggestions([]);
    },
  }), []);

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myReq = ++reqIdRef.current;
    timerRef.current = setTimeout(async () => {
      try {
        const results = await api<PlaceSuggestion[]>(
          `/api/v1/places/search?q=${encodeURIComponent(trimmed)}`
        );
        if (myReq !== reqIdRef.current) return;
        setSuggestions(results);
        setHighlight(0);
        setOpen(results.length > 0);
        setError(null);
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        setSuggestions([]);
        setOpen(false);
        setError(e instanceof Error ? e.message : t('placeSearch.searchError'));
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function pick(s: PlaceSuggestion) {
    setOpen(false);
    setSuggestions([]);
    skipSearchRef.current = true;
    onChange(s.description);
    try {
      const detail = await api<PlaceDetail>(
        `/api/v1/places/details/${encodeURIComponent(s.place_id)}`
      );
      onSelect(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('placeSearch.detailsError'));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick0 = suggestions[highlight];
      if (pick0) void pick(pick0);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className="input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
      />
      {(loading || busy) && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">…</span>
      )}
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.place_id}
              role="option"
              aria-selected={i === highlight}
              className={`px-3 py-2 cursor-pointer text-sm ${
                i === highlight ? 'bg-neutral-100' : 'hover:bg-neutral-50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                void pick(s);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <div className="font-medium">{s.structured_formatting.main_text}</div>
              {s.structured_formatting.secondary_text && (
                <div className="text-xs text-neutral-500">
                  {s.structured_formatting.secondary_text}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-[color:var(--color-error)] mt-1">{error}</p>}
    </div>
  );
});
