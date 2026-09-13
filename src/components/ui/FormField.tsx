import React, { useId } from 'react';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
  labelClassName?: string;
  /** Tek bir input/textarea/select elemanı — id, aria-invalid ve
   * aria-describedby otomatik olarak enjekte edilir. */
  children: React.ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}

interface ClonedFieldProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
}

// Formlarda alan-seviyesi hata/ipucu YOKTU — hata yalnızca sağ üstte toast
// olarak çıkıyordu, kullanıcı hangi alanın sorunlu olduğunu kendisi
// eşleştirmek zorundaydı; aria-invalid/aria-describedby de hiç yoktu (bkz.
// premium denetim, bölüm 14). Bu primitif label + kontrol + hata/ipucu
// metnini tek bir tutarlı desende birleştirir.
export function FormField({ label, htmlFor, error, hint, required, className = '', labelClassName, children }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const clonedProps: ClonedFieldProps = {
    id: fieldId,
    'aria-invalid': !!error,
    'aria-describedby': describedBy,
  };

  // labelClassName verildiğinde varsayılan (authority-title tabanlı) stili
  // TAMAMEN değiştirir — çağıranların çoğu kendi form etiketi tipografisini
  // zaten taşıyor, ekleme (append) yerine değiştirme (replace) burada daha
  // öngörülebilir.
  const resolvedLabelClassName = labelClassName ?? 'authority-title !text-2xs opacity-50 ml-1 tracking-wide';

  return (
    <div className={`space-y-2 ${className}`}>
      <label htmlFor={fieldId} className={resolvedLabelClassName}>
        {label}
        {required && <span className="text-[var(--status-danger)] ml-1">*</span>}
      </label>
      {React.cloneElement(children, clonedProps)}
      {hint && !error && (
        <p id={hintId} className="text-xs text-[var(--text-secondary)]/60 ml-1 leading-relaxed">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[var(--status-danger)] ml-1 leading-relaxed font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
