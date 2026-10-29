import { useEffect, useState } from 'react';
import { shortcutProblem, type ShortcutProblem, type ShortcutStatus } from './global-shortcut';
import {
  formatPushToTalkKey,
  parsePushToTalkKey,
  pushToTalkKeyFromEvent,
  serializePushToTalkKey,
} from './push-to-talk-key';
import { t } from './i18n';

export function shortcutProblemText(problem: ShortcutProblem): string {
  switch (problem) {
    case 'needs-modifier':
      return t('Kısayola Ctrl, Alt veya ⌘ / Win ekle; tek başına harf yazmayı engeller.');
    case 'reserved':
      return t('Bu kısayol Tayfa veya sistem tarafından kullanılıyor. Başka bir tuş dene.');
    case 'duplicate':
      return t('Bu kısayol başka bir Tayfa kısayoluyla aynı.');
    case 'taken':
      return t(
        'Başka bir uygulama bu kısayolu kullanıyor, Tayfa kaydedemedi. Başka bir tuş seç.',
      );
    default:
      return t('Bu tuş kısayol olarak kullanılamıyor. Başka bir tuş dene.');
  }
}

/**
 * Records an optional system-wide shortcut. A combination Tayfa cannot accept is explained and
 * not saved; one the system refuses after saving is explained from `status`. Escape cancels.
 */
export function ShortcutKeyField({
  value,
  onChange,
  others,
  status,
  label,
}: {
  value: string;
  onChange(value: string): void;
  /** Other shortcuts Tayfa owns; an equal combination is a conflict. */
  others: readonly string[];
  status?: ShortcutStatus | null;
  label: string;
}) {
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<ShortcutProblem | null>(null);
  useEffect(() => {
    if (!capturing) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const modified = event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
      if (event.code === 'Escape' && !modified) {
        setCapturing(false);
        return;
      }
      const key = pushToTalkKeyFromEvent(event);
      if (!key) return;
      const serialized = serializePushToTalkKey(key);
      const found = shortcutProblem(serialized, others);
      setCapturing(false);
      setProblem(found);
      if (!found) onChange(serialized);
    };
    const cancel = () => setCapturing(false);
    window.addEventListener('keydown', capture, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', capture, true);
      window.removeEventListener('blur', cancel);
    };
  }, [capturing, onChange, others]);
  const key = parsePushToTalkKey(value);
  const failed = status?.state === 'failed' && key ? status.problem : null;
  const shown = problem ?? failed;
  return (
    <div className="ptt-key-field shortcut-key-field">
      <kbd aria-live="polite" aria-label={label}>
        {capturing
          ? t('Tuşlara bas… (Esc vazgeç)')
          : key
            ? formatPushToTalkKey(key)
            : t('Atanmadı')}
      </kbd>
      <button
        type="button"
        className="button secondary"
        aria-pressed={capturing}
        onClick={() => {
          setProblem(null);
          setCapturing((current) => !current);
        }}
      >
        {capturing ? t('Vazgeç') : key ? t('Değiştir') : t('Ata')}
      </button>
      {!capturing && key && (
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setProblem(null);
            onChange('');
          }}
        >
          {t('Temizle')}
        </button>
      )}
      {shown && (
        <p className="shortcut-key-problem" role="alert">
          {shortcutProblemText(shown)}
        </p>
      )}
    </div>
  );
}
