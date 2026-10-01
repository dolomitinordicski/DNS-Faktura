import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import type { Language } from '../types';

type SeasonOption = {
  id: string;
  label: { de: string; it: string; en?: string };
  status: string;
};

type MenuPosition = { top: number; left: number; width: number };

export function SeasonSelector({
  seasons,
  selectedSeasonId,
  language,
  onChange,
}: {
  seasons: readonly SeasonOption[];
  selectedSeasonId: string;
  language: Language;
  onChange: (seasonId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const t = language === 'it'
    ? { label: 'Stagione', choose: 'Seleziona la stagione', active: 'Attiva', history: 'Storico', hint: 'Dati della stagione' }
    : { label: 'Saison', choose: 'Saison auswählen', active: 'Aktuell', history: 'Archiv', hint: 'Saisondaten' };
  const selectedIndex = Math.max(0, seasons.findIndex((season) => season.id === selectedSeasonId));

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(276, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const estimatedHeight = Math.min(seasons.length * 68 + 76, window.innerHeight * .7);
    const below = window.innerHeight - rect.bottom;
    const top = below < estimatedHeight + 16
      ? Math.max(12, rect.top - estimatedHeight - 8)
      : rect.bottom + 8;
    setPosition({ top, left, width });
  }

  function openMenu() {
    updatePosition();
    setOpen(true);
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    const onViewportChange = () => updatePosition();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    optionRefs.current[selectedIndex]?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, selectedIndex]);

  function moveFocus(index: number) {
    const next = (index + seasons.length) % seasons.length;
    optionRefs.current[next]?.focus();
  }

  return (
    <div className="dns-tab-season-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="dns-tab-season"
        aria-label={`${t.label}: ${selectedSeasonId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        data-dns-press
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span className="dns-season-prefix">WS</span>
        <span className="dns-season-current">{selectedSeasonId}</span>
        <span aria-hidden="true" className={`dns-season-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={t.choose}
          className="dns-season-menu"
          style={{ top: position.top, left: position.left, width: position.width }}
        >
          <div className="dns-season-menu-heading">
            <span className="dns-season-menu-eyebrow">{t.hint}</span>
            <span className="dns-season-menu-title">{t.choose}</span>
          </div>
          <div className="dns-season-options">
            {seasons.map((season, index) => {
              const id = String(season.id);
              const isSelected = id === selectedSeasonId;
              const isHistorical = season.status === 'historical';
              const badge = isHistorical ? t.history : season.status === 'active' ? t.active : '';
              return (
                <button
                  key={id}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`dns-season-option${isSelected ? ' is-selected' : ''}${isHistorical ? ' is-historical' : ''}`}
                  onClick={() => { onChange(id); closeMenu(true); }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(index + 1); }
                    if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(index - 1); }
                    if (event.key === 'Home') { event.preventDefault(); moveFocus(0); }
                    if (event.key === 'End') { event.preventDefault(); moveFocus(seasons.length - 1); }
                  }}
                >
                  <span className="dns-season-option-mark" aria-hidden="true">{isHistorical ? '↺' : '→'}</span>
                  <span className="dns-season-option-copy">
                    <span className="dns-season-option-year">{id}</span>
                    <span className="dns-season-option-caption">{season.label[language]}</span>
                  </span>
                  {badge && <span className={`dns-season-badge${isHistorical ? ' is-history' : ''}`}>{badge}</span>}
                  {isSelected && <span className="dns-season-option-check" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
