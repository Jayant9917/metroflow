"use client";

import { ChangeEvent, useState } from "react";

export function PasswordField({ label, value, onChange, autoComplete, minLength, maxLength }: { label: string; value: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void; autoComplete: string; minLength?: number; maxLength?: number }) {
  const [visible, setVisible] = useState(false);
  const fieldName = label.toLowerCase().replace(/\s+/g, "-");
  return <label className="field password-field" htmlFor={fieldName}>{label}<span className="password-input-wrap"><input id={fieldName} name={fieldName} required minLength={minLength} maxLength={maxLength} type={visible ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} /><button type="button" className="password-toggle" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(current => !current)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg></button></span></label>;
}
