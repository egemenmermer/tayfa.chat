import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, ShieldCheck } from 'lucide-react';
import { Toggle } from '@rooms/design';
import { t, uiError } from './i18n';
type UpdateStatus = Awaited<ReturnType<NonNullable<Window['rooms']>['updates']['status']>>;
const names: Record<UpdateStatus['state'], string> = {
  unavailable: t('Dağıtım bekleniyor'),
  idle: t('Denetlemeye hazır'),
  checking: t('Güncelleme aranıyor'),
  available: t('Yeni sürüm hazır'),
  downloading: t('İndiriliyor'),
  verifying: t('İmza doğrulanıyor'),
  ready: t('Yüklemeye hazır'),
  error: t('Güncelleme tamamlanamadı'),
};
export function DesktopUpdates() {
  const [status, setStatus] = useState<UpdateStatus | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (window.rooms?.updates) setStatus(await window.rooms.updates.status());
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(uiError(e)));
    const timer = setInterval(() => void refresh().catch((e) => setError(uiError(e))), 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(uiError(e));
    } finally {
      setBusy(false);
    }
  };
  const working = busy || ['checking', 'downloading', 'verifying'].includes(status?.state ?? '');
  // Windows (NSIS) checks the installer's SHA-512 from the release; it is not publisher-signed yet.
  const windows = status?.engine === 'nsis';
  return (
    <section className="desktop-updates">
      <div className="settings-row">
        <div>
          <h4>{windows ? t('Otomatik güncellemeler') : t('İmzalı güncellemeler')}</h4>
          <p>
            {windows
              ? t(
                  'Windows kurulum dosyası henüz yayıncı imzası taşımıyor; indirilen dosya GitHub sürümündeki SHA-512 özetiyle doğrulanır.',
                )
              : t('Yeni sürümleri isteğinle denetle; kurulumdan önce yayıncı imzası doğrulanır.')}
          </p>
        </div>
        <Toggle
          value={status?.enabled ?? false}
          disabled={!status?.configured || working}
          label={
            windows
              ? t('Otomatik güncellemeleri etkinleştir')
              : t('İmzalı güncellemeleri etkinleştir')
          }
          onChange={(value) => void run(() => window.rooms!.updates.setOptIn(value))}
        />
      </div>
      <div className="settings-note">
        <ShieldCheck size={19} />
        <div>
          <strong>
            {names[status?.state ?? 'unavailable']}
            {status?.version ? ` · ${status.version}` : ''}
          </strong>
          <p>
            {status?.reason
              ? uiError(status.reason)
              : !status?.enabled
                ? windows
                  ? t('Önce otomatik güncellemeleri etkinleştir.')
                  : t('Denetlemek için imzalı güncellemeleri etkinleştir.')
                : t('Güncelleme kurulumu açık uygulamayı yeniden başlatır.')}
          </p>
          {status?.state === 'downloading' && (
            <progress max={100} value={status.progress} aria-label={t('İndirme ilerlemesi')} />
          )}
        </div>
      </div>
      <div className="button-row">
        <button
          className="button secondary small"
          disabled={!status?.configured || !status.enabled || working}
          title={
            !status?.configured
              ? (status?.reason ?? t('İmzalı dağıtım ve güncelleme adresi yapılandırılmalı.'))
              : undefined
          }
          onClick={() => void run(() => window.rooms!.updates.check())}
        >
          <RefreshCw size={15} />
          {t('Güncellemeleri denetle')}
        </button>
        {status?.state === 'available' && (
          <button
            className="button primary small"
            disabled={working || !status.enabled}
            onClick={() => void run(() => window.rooms!.updates.download())}
          >
            <ArrowDownToLine size={15} />
            {t('Güncellemeyi indir')}
          </button>
        )}
        {status?.state === 'ready' && (
          <button
            className="button primary small"
            disabled={busy || !status.enabled}
            onClick={() => void run(() => window.rooms!.updates.install())}
          >
            {t('Yükle ve yeniden başlat')}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="error-pane">
          {error}
        </div>
      )}
    </section>
  );
}
