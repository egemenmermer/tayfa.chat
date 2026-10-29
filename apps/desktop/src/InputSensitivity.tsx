import { useEffect, useState } from 'react';
import { Toggle } from '@rooms/design';
import { t } from './i18n';
import {
  MIC_GATE_MAX_DB,
  MIC_GATE_MIN_DB,
  type MicGateReport,
} from '../../../packages/media-providers/src/mic-gate';
import './input-sensitivity.css';

/** The meter spans -60…0 dBFS; the threshold line sits on the same scale. */
const METER_FLOOR_DB = -60;
export const meterPercent = (db: number) =>
  Math.max(0, Math.min(100, ((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100));
/** A source that stops reporting (microphone closed, test ended) no longer shows a level. */
const STALE_MS = 600;

export type InputMeterSource = (listener: (report: MicGateReport) => void) => () => void;

/**
 * "Giriş hassasiyeti": automatic or a manual threshold, with the live level of what would be sent.
 * `source` is the running microphone (the room's, or the Settings test); null shows a hint.
 */
export function InputSensitivity({
  auto,
  threshold,
  onAuto,
  onThreshold,
  source,
}: {
  auto: boolean;
  threshold: number;
  onAuto(value: boolean): void;
  onThreshold(value: number): void;
  source: InputMeterSource | null;
}) {
  const [report, setReport] = useState<MicGateReport | null>(null);
  useEffect(() => {
    setReport(null);
    if (!source) return;
    let stale: ReturnType<typeof setTimeout> | undefined;
    const stop = source((next) => {
      setReport(next);
      clearTimeout(stale);
      stale = setTimeout(() => setReport(null), STALE_MS);
    });
    return () => {
      clearTimeout(stale);
      stop();
    };
  }, [source]);
  // Automatic mode shows the threshold the gate found; manual shows the slider (also before saving).
  const line = auto ? (report?.threshold ?? null) : threshold;
  const level = report ? Math.round(report.level) : null;
  const sending = !!report && (auto ? report.open : report.level >= threshold);
  return (
    <div className="input-sensitivity">
      <div className="settings-row">
        <div>
          <h4>{t('Giriş hassasiyeti')}</h4>
          <p>
            {t(
              'Eşiğin altındaki sesler (klavye, nefes) gönderilmez. Konuşma halkan tam olarak sesin gittiği anda yanar.',
            )}
          </p>
        </div>
        <label className="input-sensitivity-auto">
          <span>{t('Otomatik')}</span>
          <Toggle label={t('Otomatik giriş hassasiyeti')} value={auto} onChange={onAuto} />
        </label>
      </div>
      <div
        className={`input-sensitivity-meter${sending ? ' sending' : ''}`}
        role="meter"
        aria-label={t('Gönderilecek mikrofon seviyesi')}
        aria-valuemin={METER_FLOOR_DB}
        aria-valuemax={0}
        aria-valuenow={level ?? METER_FLOOR_DB}
        aria-valuetext={
          level === null
            ? t('Ölçüm yok')
            : sending
              ? t('{level} dB · gönderiliyor', { level })
              : t('{level} dB · gönderilmiyor', { level })
        }
      >
        <span className="fill" style={{ width: `${level === null ? 0 : meterPercent(level)}%` }} />
        {line !== null && (
          <span
            className="threshold"
            data-testid="input-sensitivity-threshold"
            style={{ left: `${meterPercent(line)}%` }}
          />
        )}
      </div>
      {!auto && (
        <label className="input-sensitivity-slider">
          <input
            type="range"
            aria-label={t('Giriş hassasiyeti eşiği')}
            aria-valuetext={t('{value} dB', { value: threshold })}
            min={MIC_GATE_MIN_DB}
            max={MIC_GATE_MAX_DB}
            step={1}
            value={threshold}
            onChange={(event) => onThreshold(Number(event.target.value))}
          />
          <span>{t('{value} dB', { value: threshold })}</span>
        </label>
      )}
      <p className="ref-settings-note">
        {!source || level === null
          ? t('Seviyeyi görmek için mikrofonu dene ya da odada mikrofonunu aç.')
          : auto
            ? t('Otomatik eşik: {value} dB · ortam gürültüsüne göre ayarlanır.', {
                value: Math.round(line ?? MIC_GATE_MIN_DB),
              })
            : sending
              ? t('Bu seviye gönderilir.')
              : t('Bu seviye gönderilmez.')}
      </p>
      <p className="ref-settings-note">
        {t(
          'Bas konuş ve mikrofon kapatma önce gelir: tuş bırakılınca ya da mikrofon kapalıyken hiçbir şey gitmez; tuş basılıyken de yalnızca eşiği geçen ses gider.',
        )}
      </p>
    </div>
  );
}
