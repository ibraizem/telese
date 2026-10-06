/**
 * Boîte à outils d'interface : boutons, champs, fenêtres modales, badges.
 * volontairement sobre — pas d'animation inutile, contraste élevé,
 * cibles tactiles généreuses (usage quotidien en télésecrétariat).
 */
import { useEffect, useRef } from 'react';
import { statusMeta } from './status';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* Boutons                                                             */
/* ------------------------------------------------------------------ */
export function Button({ variant = 'secondary', size, icon, className, children, block, ...rest }) {
  return (
    <button
      type="button"
      className={cx('btn', `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', className)}
      {...rest}
    >
      {icon && <span className="btn__icon" aria-hidden="true">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
}

export const IconButton = ({ label, children, ...rest }) => (
  <button type="button" className="icon-btn" title={label} aria-label={label} {...rest}>
    {children}
  </button>
);

/* ------------------------------------------------------------------ */
/* Champs de formulaire                                                */
/* ------------------------------------------------------------------ */
export function Field({ label, required, error, hint, children, className }) {
  return (
    <label className={cx('field', error && 'field--error', className)}>
      <span className="field__label">
        {label}
        {required && <span className="field__required" title="Obligatoire"> *</span>}
      </span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export const Input = ({ className, error, ...rest }) => (
  <input className={cx('input', error && 'input--error', className)} {...rest} />
);

export const Select = ({ className, error, children, ...rest }) => (
  <select className={cx('input', 'select', error && 'input--error', className)} {...rest}>
    {children}
  </select>
);

export const Textarea = ({ className, ...rest }) => (
  <textarea className={cx('input', 'textarea', className)} {...rest} />
);

/* ------------------------------------------------------------------ */
/* Fenêtres modales                                                    */
/* ------------------------------------------------------------------ */
export function Modal({ title, subtitle, onClose, children, footer, size = 'md', className }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    // Le focus reste dans la fenêtre (accessibilité clavier).
    const first = ref.current?.querySelector('input, select, textarea, button');
    first?.focus?.();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('modal', `modal--${size}`, className)} role="dialog" aria-modal="true" ref={ref}>
        <header className="modal__header">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          <IconButton label="Fermer" onClick={onClose}>×</IconButton>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* États divers                                                        */
/* ------------------------------------------------------------------ */
export function StatusBadge({ status, small }) {
  const meta = statusMeta(status);
  return (
    <span className={cx('badge', meta.className, small && 'badge--sm')}>
      <span aria-hidden="true">{meta.icon}</span> {meta.label}
    </span>
  );
}

export const Badge = ({ tone = 'neutral', children }) => (
  <span className={cx('badge', `badge--${tone}`)}>{children}</span>
);

export const Spinner = ({ label = 'Chargement…' }) => (
  <div className="spinner"><span className="spinner__dot" /> {label}</div>
);

export const Empty = ({ title, hint, action }) => (
  <div className="empty">
    <div className="empty__icon" aria-hidden="true">☐</div>
    <p className="empty__title">{title}</p>
    {hint && <p className="empty__hint">{hint}</p>}
    {action}
  </div>
);

export const Card = ({ title, action, children, className, padded = true, ...rest }) => (
  <section className={cx('card', padded && 'card--padded', className)} {...rest}>
    {(title || action) && (
      <header className="card__header">
        <h2 className="card__title">{title}</h2>
        {action}
      </header>
    )}
    {children}
  </section>
);

export const PageHeader = ({ title, subtitle, actions }) => (
  <header className="page-header">
    <div>
      <h1 className="page-header__title">{title}</h1>
      {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
    </div>
    {actions && <div className="page-header__actions">{actions}</div>}
  </header>
);

/** Compteur mis en valeur du tableau de bord. */
export const StatCard = ({ label, value, tone = 'neutral', icon, hint, onClick }) => (
  <button type="button" className={cx('stat', `stat--${tone}`)} onClick={onClick} disabled={!onClick}>
    <span className="stat__label">{label}</span>
    <span className="stat__value">{value}</span>
    {hint && <span className="stat__hint">{hint}</span>}
    {icon && <span className="stat__icon" aria-hidden="true">{icon}</span>}
  </button>
);
