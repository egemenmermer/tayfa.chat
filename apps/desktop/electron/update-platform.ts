import { t } from '@rooms/i18n';

/** Validated `dist/update-config.json`; only release builds write this file. */
export interface UpdateConfig {
  /** HTTPS base that serves `appcast.xml` (macOS) and `latest.yml` (Windows). */
  feed: string;
  /** Apple team the macOS bundle must be signed by; Windows builds carry none. */
  teamId: string | null;
}

/** Accepts only a credential-free HTTPS feed; anything else leaves updates unavailable. */
export function parseUpdateConfig(raw: unknown): UpdateConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const { feed, teamId } = raw as Record<string, unknown>;
  if (typeof feed !== 'string') return null;
  let url: URL;
  try {
    url = new URL(feed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    return null;
  return {
    feed: url.href,
    teamId: typeof teamId === 'string' && /^[A-Z0-9]{10}$/.test(teamId) ? teamId : null,
  };
}

export type UpdateEngine = 'sparkle' | 'nsis';
export type UpdateUnavailable = 'mac-unsigned' | 'platform' | 'unpackaged' | 'no-feed' | 'portable';
export type UpdateReason = UpdateUnavailable | 'failed';

export interface UpdatePlatformInput {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  config: UpdateConfig | null;
  /** macOS: strict codesign verification passed with the configured Developer ID team. */
  macSigned: boolean;
  /** Windows: electron-builder wrote `resources/app-update.yml` (release builds only). */
  windowsUpdateYml: boolean;
  /** Windows: the NSIS uninstaller sits next to the executable, so an installer can update it. */
  windowsInstalled: boolean;
}

/** Which updater runs on this machine, or why none can. */
export function selectUpdatePlatform(
  input: UpdatePlatformInput,
): { engine: UpdateEngine; reason: null } | { engine: null; reason: UpdateUnavailable } {
  if (input.platform === 'darwin')
    return input.isPackaged && input.config?.teamId && input.macSigned
      ? { engine: 'sparkle', reason: null }
      : { engine: null, reason: 'mac-unsigned' };
  if (input.platform !== 'win32') return { engine: null, reason: 'platform' };
  if (!input.isPackaged) return { engine: null, reason: 'unpackaged' };
  if (!input.config || !input.windowsUpdateYml) return { engine: null, reason: 'no-feed' };
  if (!input.windowsInstalled) return { engine: null, reason: 'portable' };
  return { engine: 'nsis', reason: null };
}

/** Text for a reason code. Call it when status is read: the main-process language can change. */
export function updateReasonText(reason: UpdateReason): string {
  switch (reason) {
    case 'mac-unsigned':
      return t('İmzalı güncellemeler, doğrulanmış imzalı bir sürüm ve HTTPS güncelleme adresi ister.');
    case 'platform':
      return t(
        'Uygulama içi güncellemeler macOS ve Windows sürümlerinde var; burada yeni sürümü elle kur.',
      );
    case 'unpackaged':
      return t('Geliştirme sürümü güncellenmez; güncellemeler yalnızca kurulu uygulamada çalışır.');
    case 'no-feed':
      return t(
        'Bu Windows paketi güncelleme adresi olmadan derlendi; yeni sürümü GitHub sürümler sayfasından elle kur.',
      );
    case 'portable':
      return t(
        'Kurulum yapılmadan açılan uygulama kendini güncelleyemez; Tayfa’yı Windows kurulum dosyasıyla kur.',
      );
    case 'failed':
      return t(
        'Güncelleme indirilemedi veya SHA-512 özeti tutmadı. Mevcut sürüm kurulu kalır; sonra yeniden dene.',
      );
  }
}
