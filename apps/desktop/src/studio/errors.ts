import { t, uiError } from '../i18n';

/** The public code an error from `window.rooms.studio` carries (Electron prefixes the message with its own text). */
export function studioErrorCode(error: unknown): string | null {
  const message = (error instanceof Error ? error.message : String(error ?? ''))
    .replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, '')
    .trim();
  return /^[A-Z_]{1,64}$/.test(message) ? message : null;
}

/** Worth retrying with the same request: the service or the network was unavailable, or it asked to slow down. */
export function isRetryableStudioError(code: string | null): boolean {
  return (
    code === null ||
    code === 'ACTIVITY_SERVICE_UNAVAILABLE' ||
    code === 'RATE_LIMITED' ||
    code === 'INVALID_ACTIVITY_RESPONSE' ||
    code === 'REQUEST_CANCELLED'
  );
}

/** The project cannot be used any more in this session: retrying would only repeat the refusal. */
export function isTerminalStudioError(code: string | null): boolean {
  return (
    code === 'STUDIO_PROJECT_NOT_FOUND' ||
    code === 'STUDIO_UNAVAILABLE' ||
    code === 'ROOM_ACCESS_DENIED' ||
    code === 'ROOM_UNAVAILABLE' ||
    code === 'SESSION_EXPIRED' ||
    code === 'SESSION_CHANGED' ||
    code === 'SIGN_IN_REQUIRED' ||
    code === 'AUTH_REQUIRED'
  );
}

/** Interface text for a Studio failure; codes shared with other features fall back to the common messages. */
export function studioErrorMessage(error: unknown): string {
  switch (studioErrorCode(error)) {
    case 'STUDIO_PROJECT_NOT_FOUND':
      return t('Bu proje silinmiş ya da artık yok.');
    case 'STUDIO_CREATE_DENIED':
      return t('Bu odada Stüdyo projesi oluşturma iznin yok.');
    case 'STUDIO_DELETE_DENIED':
      return t('Bu projeyi yalnızca oluşturan kişi ya da oda yöneticisi silebilir.');
    case 'STUDIO_EDIT_DENIED':
      return t('Bu projeyi düzenleme iznin yok. Dinleyebilir ve izleyebilirsin.');
    case 'STUDIO_ROOM_FULL':
      return t('Bu odadaki proje sınırına ulaşıldı. Kullanılmayan bir projeyi silip yeniden dene.');
    case 'STUDIO_BATCH_CONFLICT':
      return t('Son değişiklik sunucudakiyle çakıştı ve uygulanmadı. Proje güncel haliyle yüklendi.');
    case 'PAYLOAD_TOO_LARGE':
      return t('Değişiklik tek seferde gönderilemeyecek kadar büyük. Daha küçük parçalar halinde yap.');
    case 'INVALID_COMMAND':
    case 'STUDIO_INVALID_INPUT':
      return t('Bu değişiklik geçersiz olduğu için uygulanmadı.');
    case 'STUDIO_UNAVAILABLE':
      return t('Bu sunucuda Stüdyo henüz etkin değil. Sunucunun güncellenmesi gerekiyor.');
    case 'REQUEST_CANCELLED':
    case 'ACTIVITY_SERVICE_UNAVAILABLE':
    case 'INVALID_ACTIVITY_RESPONSE':
      return t('Stüdyo sunucusuna ulaşılamıyor. Bağlantı otomatik olarak yeniden denenecek.');
    case 'SESSION_CHANGED':
      return t('Oturum değişti. Projeyi yeniden aç.');
    default:
      return uiError(error);
  }
}
