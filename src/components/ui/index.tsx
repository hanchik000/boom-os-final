// BOOM OS -- Stage 41: the shared UX vocabulary of the administrative screens.
//
// These are not new features and not a second design system: they are the five things every admin
// screen already did by hand, each in its own way -- a page toolbar with one primary action, a
// loading state, an empty state, a notice, and a confirmation before something irreversible.
// Written once, in the existing design tokens, so the same situation looks and behaves the same
// everywhere. Every string is bilingual through the existing LanguageContext; nothing here talks
// to the API, decides a permission, or holds business state.
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Info, Search, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

/** The row under the page title: filters and search on the left, THE primary action on the right. */
export const Toolbar: React.FC<{ left?: React.ReactNode; children?: React.ReactNode }> = ({ left, children }) => (
  <div className="boom-toolbar">
    <div className="boom-toolbar-left">{left}</div>
    <div className="boom-toolbar-right">{children}</div>
  </div>
);

/** One search field, with a placeholder that says what can actually be searched. */
export const SearchInput: React.FC<{
  value: string; onChange: (v: string) => void; placeholder: string; id?: string;
}> = ({ value, onChange, placeholder, id }) => (
  <label className="boom-search">
    <Search aria-hidden="true" />
    <input id={id} type="search" value={value} placeholder={placeholder} aria-label={placeholder}
      onChange={e => onChange(e.target.value)} />
  </label>
);

/** "Загружаем данные…" -- never a blank screen, never a bare "Loading...". */
export const LoadingState: React.FC<{ label?: string }> = ({ label }) => {
  const { language } = useLanguage();
  return (
    <div className="boom-state" role="status" aria-live="polite">
      <span className="boom-spinner" aria-hidden="true" />
      <span className="boom-state-title">{label || (language === 'ru' ? 'Загружаем данные…' : 'Maglumatlar ýüklenýär…')}</span>
    </div>
  );
};

/** What belongs here, why it is empty, and the one thing that can be done about it. */
export const EmptyState: React.FC<{
  title: string; hint?: string; action?: React.ReactNode; icon?: React.ReactNode;
}> = ({ title, hint, action, icon }) => (
  <div className="boom-state">
    <span className="boom-state-icon" aria-hidden="true">{icon || <Inbox className="w-6 h-6" />}</span>
    <span className="boom-state-title">{title}</span>
    {hint && <span className="boom-state-hint">{hint}</span>}
    {action && <span className="boom-state-action">{action}</span>}
  </div>
);

/** Success, failure and plain information, told the same way on every screen. */
export const Notice: React.FC<{ kind?: 'success' | 'error' | 'info'; children: React.ReactNode }> = ({ kind = 'info', children }) => (
  <div className={`boom-notice is-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'success' ? <CheckCircle2 aria-hidden="true" /> : kind === 'error' ? <AlertTriangle aria-hidden="true" /> : <Info aria-hidden="true" />}
    <span>{children}</span>
  </div>
);

/** The one modal shell: title, close control, scrollable body, footer with cancel before confirm. */
export const Modal: React.FC<{
  open: boolean; title: string; description?: string; onClose: () => void;
  children?: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}> = ({ open, title, description, onClose, children, footer, wide }) => {
  const { language } = useLanguage();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    // A dialog must not leak its clicks to whatever is underneath it: several screens close their
    // own editor when the area around it is clicked, and without this a click INSIDE the dialog --
    // "Остаться", for instance -- reached that handler as well and reopened the dialog it had just
    // dismissed.
    <div className="boom-modal-backdrop" role="presentation"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="boom-modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: '48rem' } : undefined}
        onMouseDown={e => e.stopPropagation()}>
        <div className="boom-modal-head">
          <div>
            <div className="boom-modal-title">{title}</div>
            {description && <div className="boom-modal-desc">{description}</div>}
          </div>
          <button ref={closeRef} type="button" className="boom-modal-close" onClick={onClose}
            aria-label={language === 'ru' ? 'Закрыть' : 'Ýap'}><X className="w-4 h-4" /></button>
        </div>
        {children !== undefined && <div className="boom-modal-body">{children}</div>}
        {footer && <div className="boom-modal-foot">{footer}</div>}
      </div>
    </div>
  );
};

/**
 * One confirmation for everything irreversible. It says what will happen in plain words -- an
 * archived dish stops being sold but its order history stays -- instead of a browser dialog
 * carrying an English sentence from a catch block.
 */
export const ConfirmDialog: React.FC<{
  open: boolean; title: string; description?: string; confirmLabel?: string; cancelLabel?: string;
  tone?: 'danger' | 'primary'; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}> = ({ open, title, description, confirmLabel, cancelLabel, tone = 'danger', busy, onConfirm, onCancel }) => {
  const { language } = useLanguage();
  return (
    <Modal open={open} title={title} description={description} onClose={onCancel}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel || (language === 'ru' ? 'Отмена' : 'Goý bolsun')}
        </button>
        <button type="button" className={tone === 'danger' ? 'btn-danger' : 'btn'} onClick={onConfirm} disabled={busy}>
          {confirmLabel || (language === 'ru' ? 'Подтвердить' : 'Tassykla')}
        </button>
      </>} />
  );
};

/** Form actions, always in the same order and the same place: [Сохранить] [Отмена]. */
export const FormActions: React.FC<{
  submitLabel?: string; cancelLabel?: string; busy?: boolean; disabled?: boolean;
  onCancel?: () => void; onSubmit?: () => void;
}> = ({ submitLabel, cancelLabel, busy, disabled, onCancel, onSubmit }) => {
  const { language } = useLanguage();
  return (
    <div className="boom-modal-foot">
      {onCancel && <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
        {cancelLabel || (language === 'ru' ? 'Отмена' : 'Goý bolsun')}
      </button>}
      <button type={onSubmit ? 'button' : 'submit'} className="btn" onClick={onSubmit} disabled={busy || disabled}>
        {submitLabel || (language === 'ru' ? 'Сохранить' : 'Sakla')}
      </button>
    </div>
  );
};
