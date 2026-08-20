import type { PixelPetProps } from "./types";

import { HOME_COPY } from "@/lib/homeCopy";
import { CareSprite } from "./CareSprite";
import { FoodSprite } from "./FoodSprite";

export function PixelPet({
  ariaLabel,
  callCount,
  food,
  language = "en",
  state,
}: PixelPetProps) {
  const isCalling = ["ringing", "on-call", "listening", "talking"].includes(
    state,
  );
  const copy = HOME_COPY[language].pet;

  return (
    <div className="pet-viewport" data-state={state}>
      <div className="pixel-grid" aria-hidden="true" />
      <svg
        className="pixel-pet"
        viewBox="0 0 260 240"
        role="img"
        aria-label={ariaLabel ?? `${copy.imageAria} ${state}`}
        shapeRendering="crispEdges"
      >
        <ellipse className="pet-shadow" cx="130" cy="209" rx="62" ry="11" />

        {isCalling && (
          <g className="signal-waves">
            <path d="M39 71c-15 15-15 39 0 54" />
            <path d="M27 59c-23 23-23 61 0 84" />
            <path d="M221 71c15 15 15 39 0 54" />
            <path d="M233 59c23 23 23 61 0 84" />
          </g>
        )}

        <g className="pet-body">
          <rect className="pet-outline" x="86" y="39" width="88" height="14" />
          <rect className="pet-outline" x="68" y="52" width="124" height="17" />
          <rect className="pet-outline" x="52" y="68" width="156" height="109" />
          <rect className="pet-outline" x="68" y="177" width="124" height="17" />
          <rect className="pet-outline" x="84" y="194" width="35" height="15" />
          <rect className="pet-outline" x="141" y="194" width="35" height="15" />

          <rect className="pet-fill" x="89" y="43" width="82" height="14" />
          <rect className="pet-fill" x="72" y="56" width="116" height="17" />
          <rect className="pet-fill" x="56" y="72" width="148" height="101" />
          <rect className="pet-fill" x="72" y="173" width="116" height="17" />
          <rect className="pet-fill" x="88" y="188" width="27" height="17" />
          <rect className="pet-fill" x="145" y="188" width="27" height="17" />

          <rect className="pet-highlight" x="67" y="77" width="13" height="55" />
          <rect className="pet-highlight" x="80" y="64" width="34" height="13" />
          <rect className="pet-cheek" x="72" y="128" width="22" height="10" />
          <rect className="pet-cheek" x="166" y="128" width="22" height="10" />

          <g className="pet-eyes">
            <rect x="86" y="99" width="17" height="22" />
            <rect x="157" y="99" width="17" height="22" />
            <rect className="eye-shine" x="89" y="102" width="5" height="6" />
            <rect className="eye-shine" x="160" y="102" width="5" height="6" />
          </g>

          <g className="pet-mouth">
            <rect className="mouth-closed" x="119" y="139" width="22" height="7" />
            <rect className="mouth-open" x="116" y="136" width="28" height="20" />
            <rect className="mouth-inner" x="122" y="144" width="16" height="8" />
          </g>
        </g>

        <g className="antenna">
          <rect x="126" y="17" width="8" height="24" />
          <rect x="117" y="9" width="26" height="12" />
          <rect className="antenna-light" x="121" y="12" width="18" height="6" />
        </g>

        {isCalling && (
          <g className="headset">
            <path d="M52 111V91c0-42 33-68 78-68s78 26 78 68v20" />
            <rect x="41" y="104" width="21" height="44" />
            <rect x="198" y="104" width="21" height="44" />
            <path d="M209 145v18h-31" />
            <rect x="169" y="158" width="16" height="10" />
          </g>
        )}

        {food && <FoodSprite food={food} />}
        <CareSprite state={state} />

        <g className="pixel-hearts">
          <path d="M52 43h8v-8h8v8h8v16H68v8h-8v-8h-8z" />
          <path d="M197 29h7v-7h7v7h7v14h-7v7h-7v-7h-7z" />
          <path d="M211 78h6v-6h6v6h6v12h-6v6h-6v-6h-6z" />
        </g>
      </svg>

      {callCount > 0 && (
        <div className="call-badge" aria-live="polite">
          <span className="live-dot" />
          {callCount} {callCount === 1 ? copy.liveCall : copy.liveCalls}
        </div>
      )}
    </div>
  );
}
