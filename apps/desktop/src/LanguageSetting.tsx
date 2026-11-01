import { useState } from 'react';
import { changeLocale, localePreference, t, uiError, type LocalePreference } from './i18n';
import { changeTimeFormat, isTimeFormat, storedTimeFormat } from './time-format';

/** Settings → Appearance row; native language names stay untranslated so either reader finds them. */
export function LanguageSetting() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="settings-row">
      <div>
        <h4>{t('Dil / Language')}</h4>
        <p>
          {t(
            'Uygulamanın dili. Değiştirince pencere yeniden yüklenir; ses bağlantın bir an kopar.',
          )}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <select
        aria-label={t('Dil / Language')}
        value={localePreference}
        disabled={busy}
        onChange={async (event) => {
          setBusy(true);
          setError('');
          try {
            await changeLocale(event.target.value as LocalePreference);
          } catch (cause) {
            setError(uiError(cause) || t('Dil değiştirilemedi. Yeniden dene.'));
            setBusy(false);
          }
        }}
      >
        <option value="system">{t('Sistem dili')}</option>
        {/* i18n-ignore: each language keeps its own name */}
        <option value="tr">Türkçe</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}

/** Settings → Appearance row: the 12- or 24-hour clock, by default the computer's region format. */
export function TimeFormatSetting() {
  const [error, setError] = useState('');
  return (
    <div className="settings-row">
      <div>
        <h4>{t('Saat biçimi')}</h4>
        <p>
          {t(
            'Sistem, bilgisayarının bölge ayarını izler. Değiştirince pencere yeniden yüklenir; ses bağlantın bir an kopar.',
          )}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <select
        aria-label={t('Saat biçimi')}
        defaultValue={storedTimeFormat()}
        onChange={(event) => {
          const value = event.target.value;
          if (!isTimeFormat(value)) return;
          setError('');
          try {
            changeTimeFormat(value);
          } catch {
            setError(t('Saat biçimi kaydedilemedi. Yeniden dene.'));
          }
        }}
      >
        <option value="system">{t('Sistem')}</option>
        <option value="24">{t('24 saat (14:30)')}</option>
        <option value="12">{t('12 saat (2:30 PM)')}</option>
      </select>
    </div>
  );
}
