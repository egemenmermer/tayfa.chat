import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal, Toggle } from '@rooms/design';
import { ReferenceIcon } from './ReferenceIcon';
import { useRealtime } from './realtime';
import { t, uiError } from './i18n';
import './reference-about.css';

type UpdateStatus = Awaited<ReturnType<NonNullable<Window['rooms']>['updates']['status']>>;
type ApplicationInfo = Awaited<ReturnType<NonNullable<Window['rooms']>['applicationInfo']>>;
const stateNames: Record<UpdateStatus['state'], string> = {
  unavailable: t('Dağıtım bekleniyor'),
  idle: t('Kontrol edilebilir'),
  checking: t('Kontrol ediliyor'),
  available: t('Güncelleme var'),
  downloading: t('İndiriliyor'),
  verifying: t('İmza doğrulanıyor'),
  ready: t('Yeniden başlatmaya hazır'),
  error: t('Güncelleme başarısız'),
};

/** The operating system's product name for a Node `process.platform` value. */
export function platformName(platform: string | undefined) {
  return platform === 'darwin'
    ? 'macOS'
    : platform === 'win32'
      ? 'Windows'
      : platform === 'linux'
        ? 'Linux'
        : (platform ?? '—');
}
/** States in which `status.version` names a newer build than the one running. */
const newerStates: UpdateStatus['state'][] = ['available', 'downloading', 'verifying', 'ready'];

/** Update actions remain native, opt-in and signature-gated; fixtures never invoke them. */
export function About({ notify }: { notify(message: string): void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null),
    [info, setInfo] = useState<ApplicationInfo | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [modal, setModal] = useState<'logs' | 'licenses' | 'restart' | null>(null),
    [content, setContent] = useState(''),
    [contentBusy, setContentBusy] = useState(false);
  const [fixture, setFixture] = useState(false);
  const voice = useRealtime();
  const [params, setParams] = useSearchParams();
  const contentEpoch = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      contentEpoch.current++;
    };
  }, []);
  const closeModal = () => {
    contentEpoch.current++;
    setContentBusy(false);
    setModal(null);
  };
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const query = new URLSearchParams(location.search);
    if (import.meta.env.DEV && query.get('fixture') === 'S71') {
      setFixture(true);
      void import('./dev/reference-fixtures').then((f) => {
        const data = f.getReferenceAbout();
        if (active && data) {
          setInfo(data.info);
          setStatus(data.status);
          setModal(data.modal);
          setContent(data.content);
        }
      });
    } else if (window.rooms) {
      const update = async () => {
        try {
          const data = await window.rooms!.updates.status();
          if (active) setStatus(data);
        } catch (e) {
          if (active) setError(uiError(e));
        }
      };
      void window.rooms
        .applicationInfo()
        .then((data) => {
          if (active) setInfo(data);
        })
        .catch((e) => {
          if (active) setError(uiError(e));
        });
      void update();
      timer = setInterval(() => void update(), 2500);
    }
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);
  // Only a downloaded, verified update can restart into the new version; 'available' is
  // still downloading, and "install" would just open Sparkle's own check.
  const installable = status?.state === 'ready';
  // The sidebar update notice links here with install=1 and expects the restart prompt at once.
  useEffect(() => {
    if (!params.has('install') || !status) return;
    if (installable) setModal('restart');
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('install');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams, status, installable]);
  const native = !!window.rooms && !fixture;
  const configured = native && !!status?.configured,
    enabled = configured && !!status?.enabled;
  // Windows (NSIS) checks the installer's SHA-512 from the release; it is not publisher-signed yet.
  const windows = status?.engine === 'nsis';
  const reason = fixture
    ? t('Yerel örnek durum; güncelleme işlemleri kapalı.')
    : !native
      ? t('Masaüstü uygulamasında kullanılabilir.')
      : !configured
        ? // macOS keeps its generic text; other platforms explain why updates are unavailable.
          status?.reason && status.engine !== 'sparkle'
          ? status.reason
          : t('İmzalı dağıtım ve HTTPS güncelleme adresi yapılandırılmalı.')
        : !status?.enabled
          ? windows
            ? t('Önce otomatik güncellemeleri etkinleştir.')
            : t('Önce imzalı güncellemeleri etkinleştir.')
          : '';
  const run = async (action: () => Promise<unknown>, download = false) => {
    if (!native) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setStatus(await window.rooms!.updates.status());
    } catch (e) {
      const current = await window.rooms!.updates.status().catch(() => null);
      if (current) setStatus(current);
      if (!(download && current?.state === 'idle')) setError(uiError(e));
    } finally {
      setBusy(false);
    }
  };
  const preview = async (kind: 'logs' | 'licenses') => {
    const ticket = ++contentEpoch.current;
    setModal(kind);
    setContent('');
    setError('');
    if (!native) {
      setContent(
        fixture
          ? t('DEMO · Yerel örnek durum.')
          : t('Bu içerik masaüstü uygulamasında okunabilir.'),
      );
      return;
    }
    setContentBusy(true);
    try {
      const value = await (kind === 'logs'
        ? window.rooms!.diagnosticsPreview()
        : window.rooms!.thirdPartyNotices());
      if (mounted.current && contentEpoch.current === ticket) setContent(value);
    } catch (e) {
      if (mounted.current && contentEpoch.current === ticket) setError(uiError(e));
    } finally {
      if (mounted.current && contentEpoch.current === ticket) setContentBusy(false);
    }
  };
  const working = busy || ['checking', 'downloading', 'verifying'].includes(status?.state ?? '');
  const platform = platformName(info?.platform);
  // The updater keeps the last offered version through later checks and errors.
  const newVersion = status?.version && newerStates.includes(status.state) ? status.version : null;
  return (
    <div className="reference-about">
      <div className="ref-settings-heading">
        <span>{t('UYGULAMA')}</span>
        <h1>{t('Güncelleme ve hakkında')}</h1>
        <p>{t('Tayfa’yı güncel tut ve destek bilgilerini yönet.')}</p>
      </div>
      <div className="about-hero">
        <img src="./reference-brand/app-icons/app-icon-128.png" alt="" />
        <div>
          <h1>Tayfa</h1>
          <p>{t('Arkadaşlarınla aynı yerde.')}</p>
          <small>
            {t('Sürüm {version}', { version: info?.version ?? '—' })} · {platform}
            {info?.arch ? ` · ${info.arch === 'arm64' ? 'Apple Silicon' : info.arch}` : ''}
          </small>
        </div>
        <span className={`about-state state-${status?.state ?? 'unavailable'}`}>
          {stateNames[status?.state ?? 'unavailable']}
        </span>
      </div>
      <section className="about-update">
        <div className="about-section-title">
          <h2>
            {newVersion
              ? t('Tayfa {version}', { version: newVersion })
              : t('Uygulama güncellemeleri')}
          </h2>
          {newVersion && <small>{t('Yeni sürüm')}</small>}
        </div>
        {!!status?.releaseNotes?.length && (
          <ul className="about-changelog">
            {status.releaseNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
        {status?.state === 'downloading' ? (
          <>
            <progress
              max={100}
              value={status.progress}
              aria-label={t('Güncelleme indirme ilerlemesi')}
            />
            <div className="about-progress-label">
              <span>{t('Güncelleme indiriliyor')}</span>
              <strong>{t('%{progress}', { progress: Math.round(status.progress) })}</strong>
            </div>
            <button
              className="button secondary"
              disabled={!native}
              onClick={() => {
                void window
                  .rooms!.updates.cancel()
                  .then(setStatus)
                  .catch((e) => setError(uiError(e)));
              }}
            >
              {t('İndirmeyi iptal et')}
            </button>
          </>
        ) : status?.state === 'ready' ? (
          <>
            <div className="about-callout warning">
              <ReferenceIcon name="refresh-cw" size={19} />
              <span>{t('Güncelleme hazır. Yeniden başlatma açık görüşmeleri sonlandırır.')}</span>
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => notify(t('Güncelleme hazır; istediğinde yeniden başlatabilirsin.'))}
              >
                {t('Şimdi değil')}
              </button>
              <button
                className="button primary"
                disabled={!enabled || busy}
                title={reason}
                onClick={() => setModal('restart')}
              >
                <ReferenceIcon name="refresh-cw" size={18} />
                {t('Yeniden başlat ve güncelle')}
              </button>
            </div>
          </>
        ) : (
          <>
            {status?.state === 'error' && (
              <div className="about-callout error">
                <ReferenceIcon name="alert-circle" size={19} />
                <span>{t('Güncelleme tamamlanamadı. Mevcut sürümle devam edebilirsin.')}</span>
              </div>
            )}
            {!fixture && reason && <p className="about-reason">{reason}</p>}
            {!fixture && windows && (
              <p className="about-reason">
                {t(
                  'Windows kurulum dosyası henüz yayıncı imzası taşımıyor; indirilen dosya GitHub sürümündeki SHA-512 özetiyle doğrulanır.',
                )}
              </p>
            )}
            <div className="button-row">
              {status?.state === 'available' && (
                <button
                  className="button primary"
                  disabled={!enabled || working}
                  title={reason}
                  onClick={() => void run(() => window.rooms!.updates.download(), true)}
                >
                  <ReferenceIcon name="download" size={18} />
                  {t('Güncellemeyi indir')}
                </button>
              )}
              <button
                className="button secondary"
                disabled={!enabled || working}
                title={reason}
                onClick={() => void run(() => window.rooms!.updates.check())}
              >
                <ReferenceIcon name="refresh-cw" size={18} />
                {status?.state === 'checking'
                  ? t('Kontrol ediliyor…')
                  : t('Güncellemeleri kontrol et')}
              </button>
            </div>
          </>
        )}
        {!status?.enabled && (
          <div className="about-setting">
            <div>
              <strong>{windows ? t('Otomatik güncellemeler') : t('İmzalı güncellemeler')}</strong>
              <p>
                {windows
                  ? t('Yeni sürüm arka planda iner, doğrulanır ve yeniden başlatınca kurulur.')
                  : t('İndirme ve yeniden başlatma isteğinle başlar.')}
              </p>
            </div>
            <Toggle
              label={
                windows
                  ? t('Otomatik güncellemeleri etkinleştir')
                  : t('İmzalı güncellemeleri etkinleştir')
              }
              disabled={!configured || working}
              value={status?.enabled ?? false}
              onChange={(value) => void run(() => window.rooms!.updates.setOptIn(value))}
            />
          </div>
        )}
      </section>
      <section className="about-support">
        <h2>{t('Destek ve gizlilik')}</h2>
        <div className="about-setting">
          <div>
            <strong>{t('Destek kaydı')}</strong>
            <p>
              {t('Mesaj içerikleri, hesap anahtarları ve kişisel dosya yolları dahil edilmez.')}
            </p>
          </div>
          <button className="button secondary" onClick={() => void preview('logs')}>
            <ReferenceIcon name="file" size={18} />
            {t('Önizle ve indir')}
          </button>
        </div>
        <div className="about-setting">
          <div>
            <strong>{t('Açık kaynak lisansları')}</strong>
            <p>{t('Yazı tipi, ikon ve kullanılan bileşenler.')}</p>
          </div>
          <button className="button subtle" onClick={() => void preview('licenses')}>
            <ReferenceIcon name="arrow-right" size={18} />
            {t('Lisansları aç')}
          </button>
        </div>
      </section>
      {error && (
        <p className="about-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <img src="./reference-brand/brand/logo-symbol-lilac.svg" alt="" />
        Tayfa · {t('Özel arkadaş toplulukları için')}
      </footer>
      {modal && (
        <Modal
          title={
            modal === 'logs'
              ? t('Destek kaydını paylaşmadan önce')
              : modal === 'licenses'
                ? t('Açık kaynak ve lisanslar')
                : t('Yeniden başlat ve güncelle')
          }
          className={`about-modal about-modal-${modal}`}
          onClose={() => {
            if (!busy) closeModal();
          }}
        >
          <div className="about-modal-body">
            {modal === 'restart' ? (
              <p>
                {status?.version
                  ? `${t('Tayfa {version} hazır.', { version: status.version })} `
                  : ''}
                {voice.channelId
                  ? t('Ses bağlantın ve açık görüşmeler kapanacak.')
                  : t('Uygulama kapanıp yeniden açılacak.')}{' '}
                {windows
                  ? t('Güncellemeyi şimdi kurmak istiyor musun?')
                  : t('İmzalı güncellemeyi şimdi kurmak istiyor musun?')}
              </p>
            ) : (
              <>
                <p>
                  {modal === 'logs'
                    ? t('Dosyayı indirip inceleyebilir, sonra kendin paylaşabilirsin.')
                    : t('Bu derlemede kullanılan yazılım ve varlık lisansları.')}
                </p>
                <pre aria-busy={contentBusy}>{contentBusy ? t('Yükleniyor…') : content}</pre>
                {modal === 'logs' && (
                  <div className="about-callout">
                    <ReferenceIcon name="lock" size={18} />
                    {t('Dosya cihazına kaydedilir; otomatik gönderilmez.')}
                  </div>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="about-error">
                {error}
              </p>
            )}
          </div>
          <div className="about-modal-footer">
            <button className="button secondary" disabled={busy} onClick={closeModal}>
              {t('Kapat')}
            </button>
            {modal === 'logs' && (
              <button
                className="button primary"
                disabled={!native || contentBusy || !!error}
                onClick={async () => {
                  try {
                    notify(
                      (await window.rooms!.exportDiagnostics())
                        ? t('Destek kaydı kaydedildi.')
                        : t('Kaydetme iptal edildi.'),
                    );
                  } catch (e) {
                    setError(uiError(e));
                  }
                }}
              >
                <ReferenceIcon name="download" size={18} />
                {t('Kayıt dosyasını indir')}
              </button>
            )}
            {modal === 'restart' && (
              <button
                className="button primary"
                disabled={!enabled || busy || !installable}
                onClick={() => void run(() => window.rooms!.updates.install())}
              >
                {t('Yeniden başlat ve güncelle')}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
