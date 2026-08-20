import type { CareSpriteProps } from "./types";

export function CareSprite({ state }: CareSpriteProps) {
  if (state === "dancing") {
    return (
      <g className="salsa-effects" data-care-effect="dancing" aria-hidden="true">
        <path d="M34 54h8v28h-8zM42 54h18v7H42zM51 73h9v8h-9z" />
        <path d="M210 35h7v25h-7zM217 35h16v7h-16zM226 52h8v8h-8z" />
        <path d="M25 163h9v9h-9zM226 145h8v8h-8z" />
      </g>
    );
  }

  if (state === "showering") {
    return (
      <g className="shower-effects" data-care-effect="showering" aria-hidden="true">
        <path className="shower-pipe" d="M181 27h30v13h-18v12" />
        <path className="shower-head" d="M177 49h34v11h-34z" />
        <g className="shower-drops">
          <path d="M183 65h6v17h-6zM194 67h6v20h-6zM205 65h6v17h-6z" />
        </g>
        <g className="shower-bubbles">
          <circle cx="68" cy="144" r="8" />
          <circle cx="82" cy="158" r="6" />
          <circle cx="177" cy="146" r="9" />
          <circle cx="189" cy="161" r="5" />
        </g>
      </g>
    );
  }

  if (state === "napping") {
    return (
      <g className="nap-effects" data-care-effect="napping" aria-hidden="true">
        <g className="nap-eyes">
          <rect x="86" y="109" width="17" height="5" />
          <rect x="157" y="109" width="17" height="5" />
        </g>
        <g className="nap-zzz">
          <path d="M190 75h24v7h-13l13 15v7h-24v-7h13l-13-15z" />
          <path d="M216 50h20v6h-10l10 12v6h-20v-6l10-12h-10z" />
          <path d="M231 29h15v5h-8l8 9v5h-15v-5l8-9h-8z" />
        </g>
      </g>
    );
  }

  return null;
}
