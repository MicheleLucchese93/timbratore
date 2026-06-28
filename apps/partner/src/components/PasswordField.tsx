import { type InputHTMLAttributes, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Password input with a show/hide toggle. Shared by the login form and the
// change-password modal. Uses the `password.show`/`password.hide` common keys.
type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string };

export function PasswordField({ id, className = '', ...rest }: FieldProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} type={shown ? 'text' : 'password'} className={`input ${className}`} {...rest} />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t('password.hide') : t('password.show')}
        tabIndex={-1}
      >
        {shown ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-10-7-10-7a19.77 19.77 0 0 1 4.22-5.42" />
      <path d="M22.54 12.88A18.49 18.49 0 0 0 22 12s-3-7-10-7a10.97 10.97 0 0 0-1.59.12" />
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
    </svg>
  );
}
