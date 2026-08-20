import { CopyButton } from "./CopyButton";
import type { SetupFieldProps } from "./types";

export function SetupField({
  copiedLabel,
  copyLabel,
  description,
  label,
  value,
}: SetupFieldProps) {
  return (
    <div className="setup-field">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <div className="code-row">
        <code>{value}</code>
        <CopyButton
          copiedLabel={copiedLabel}
          label={copyLabel ?? "Copy"}
          value={value}
        />
      </div>
    </div>
  );
}
