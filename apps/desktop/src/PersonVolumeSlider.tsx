import { t } from './i18n';
import './person-volume-slider.css';
/** The loudest personal level: 200%. Mirrors MAX_PARTICIPANT_VOLUME in the media provider. */
export const PERSON_VOLUME_MAX = 2;
/** Arrow keys move by 5%; PageUp and PageDown by 25%. */
export const PERSON_VOLUME_STEP = 0.05;
const PAGE_STEP = 0.25;
/** Clamp to 0–200% and drop float noise from stepping (1.0500000000000003 becomes 1.05). */
export function clampPersonVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(PERSON_VOLUME_MAX, Math.max(0, value)) * 1000) / 1000;
}
/**
 * One listener's level for one person, 0–200% with 100% marked. Shared by the tile menu, the
 * member list menu, the voice context panel and the person card, so every entry behaves alike.
 */
export function PersonVolumeSlider({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange(value: number): void;
  label: string;
  disabled?: boolean;
}) {
  const level = clampPersonVolume(value);
  return (
    <span className="person-volume">
      <span className="person-volume-track">
        <input
          aria-label={label}
          aria-valuetext={`${Math.round(level * 100)}%`}
          type="range"
          min={0}
          max={PERSON_VOLUME_MAX}
          step={PERSON_VOLUME_STEP}
          value={level}
          disabled={disabled}
          onChange={(e) => onChange(clampPersonVolume(Number(e.target.value)))}
          onKeyDown={(e) => {
            const page = e.key === 'PageUp' ? 1 : e.key === 'PageDown' ? -1 : 0;
            if (!page) return;
            e.preventDefault();
            onChange(clampPersonVolume(level + page * PAGE_STEP));
          }}
          onDoubleClick={() => onChange(1)}
        />
        <i className="person-volume-mark" aria-hidden="true" />
      </span>
      {level !== 1 && (
        <button
          type="button"
          className="person-volume-reset"
          disabled={disabled}
          onClick={() => onChange(1)}
        >
          {t('Sıfırla')} <small>100%</small>
        </button>
      )}
    </span>
  );
}
