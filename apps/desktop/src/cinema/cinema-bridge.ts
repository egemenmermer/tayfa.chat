import {
  cinemaArtUrl,
  type CinemaBridge,
  type CinemaErrorCode,
} from '../../../../packages/community-cinema/src/bridge';
import { t } from '../i18n';

/** A local development stand-in; it never reaches a cinema service or a provider. */
export interface CinemaFixture {
  bridge: CinemaBridge;
  /** Generated artwork for fixture art ids. */
  art(artId: string): string | null;
}

const fixtures: CinemaFixture[] = [];

/** Production always uses the native bridge; a DEV fixture only exists when one was installed. */
export function getCinemaBridge(): CinemaBridge | undefined {
  if (import.meta.env.DEV && fixtures.length) return fixtures[fixtures.length - 1]!.bridge;
  return typeof window === 'undefined' ? undefined : window.rooms?.cinema;
}

export function installCinemaFixture(fixture: CinemaFixture): () => void {
  if (!import.meta.env.DEV) throw new Error('Cinema fixtures are unavailable in production.');
  fixtures.push(fixture);
  return () => {
    const index = fixtures.indexOf(fixture);
    if (index !== -1) fixtures.splice(index, 1);
  };
}

/** The image URL for an artwork id; the main process serves it on `rooms-cinema:`. */
export function cinemaArt(hallId: string, artId: string | null | undefined): string | null {
  if (!artId) return null;
  if (import.meta.env.DEV && fixtures.length) return fixtures[fixtures.length - 1]!.art(artId);
  return cinemaArtUrl(hallId, artId);
}

const copy: Record<CinemaErrorCode, string> = {
  CINEMA_UNAVAILABLE: t('Sinema servisi şu an yanıt vermiyor. Biraz sonra yeniden dene.'),
  CINEMA_OWNER_REQUIRED: t('Bunu yalnızca topluluk sahibi yapabilir.'),
  CINEMA_HALL_REQUIRED: t('Bu toplulukta henüz bir sinema salonu seçilmedi.'),
  CINEMA_ACCESS_DENIED: t('Sinema salonunu görme iznin yok.'),
  CINEMA_NOT_CONNECTED: t('Sunucuya bağlı bir IPTV hesabı yok.'),
  CINEMA_SOURCE_INVALID: t('Bilgiler eksik ya da hatalı. Sunucu adresini ve hesabı kontrol et.'),
  CINEMA_PROVIDER_DENIED: t(
    'Sağlayıcı bu hesabı kabul etmedi. Kullanıcı adını ve şifreyi kontrol et.',
  ),
  CINEMA_PROVIDER_UNREACHABLE: t('Sağlayıcıya ulaşılamadı. Yayın kaynağı şu an kapalı olabilir.'),
  CINEMA_ACCOUNT_EXPIRED: t('IPTV hesabının süresi dolmuş. Sahibin hesabı yenilemesi gerekiyor.'),
  CINEMA_IMPORT_RUNNING: t('Katalog şu an yükleniyor. Bitince yeniden dene.'),
  CINEMA_ITEM_NOT_FOUND: t('Bu içerik artık katalogda yok.'),
  CINEMA_NOTHING_SELECTED: t('Salonda şu an açık bir şey yok.'),
  CINEMA_RELAY_BUSY: t('Hesabın aynı anda açabileceği yayın sınırı dolu.'),
  CINEMA_CODEC_UNSUPPORTED: t(
    'Bu kanalın görüntü biçimi salonda oynatılamıyor. Başka bir kanal dene.',
  ),
  CINEMA_STREAM_FAILED: t('Yayın açılamadı. Biraz sonra yeniden dene.'),
  CINEMA_SESSION_ENDED: t('Salondaki yayın değişti. Yeniden bağlanılıyor…'),
  CINEMA_RATE_LIMITED: t('Çok hızlı istek gönderildi. Birkaç saniye sonra yeniden dene.'),
  CINEMA_SUBTITLE_KEY_INVALID: t('SubDL bu API anahtarını kabul etmedi. Anahtarı kontrol et.'),
  CINEMA_SUBTITLE_UNAVAILABLE: t(
    'Altyazı servisine şu an ulaşılamadı ya da günlük indirme sınırı doldu. Biraz sonra yeniden dene.',
  ),
  CINEMA_METADATA_KEY_INVALID: t(
    'TMDB bu anahtarı kabul etmedi. API anahtarını ya da okuma jetonunu kontrol et.',
  ),
  CINEMA_METADATA_UNAVAILABLE: t('Yapım bilgisine şu an ulaşılamadı. Biraz sonra yeniden dene.'),
  CINEMA_RMDB_NOT_FOUND: t("Bu kayıt artık Tayfa'da yok."),
  CINEMA_RMDB_INVALID: t('Puan veya yorum kaydedilemedi; uzunluğu ve tarihi kontrol et.'),
  CINEMA_STREMIO_NOT_LINKED: t('Topluluk sahibi henüz bir Stremio hesabı bağlamadı.'),
  CINEMA_STREMIO_LOGGED_OUT: t(
    "Stremio bu oturumu artık kabul etmiyor. Sahibin Sinema ayarlarından Stremio'yu yeniden bağlaması gerekiyor.",
  ),
  CINEMA_STREMIO_UNAVAILABLE: t("Stremio'ya şu an ulaşılamadı. Biraz sonra yeniden dene."),
  CINEMA_STREMIO_LINK_EXPIRED: t('Bağlantı kodunun süresi doldu. Yeniden bağlanmayı dene.'),
  CINEMA_STREMIO_STREAM_EXPIRED: t('Kaynak listesi eskidi. Kaynakları yeniden yükle.'),
  CINEMA_STREMIO_NOT_CACHED: t(
    'Bu kaynak debrid önbelleğinde değil; indirme başladı. Biraz sonra yeniden dene ya da “Hazır” bir kaynak seç.',
  ),

  CINEMA_YOUTUBE_SEARCH_UNAVAILABLE: t(
    'YouTube araması şu an kullanılamıyor. Bağlantıyı yapıştırarak açabilirsin.',
  ),};

/** The bridge code inside an error, if any (IPC wraps messages). */
export function cinemaErrorCode(error: unknown): CinemaErrorCode | null {
  const text = String(error instanceof Error ? error.message : error);
  const code = /CINEMA_[A-Z_]+/.exec(text)?.[0];
  return code && code in copy ? (code as CinemaErrorCode) : null;
}

export function cinemaErrorText(error: unknown): string {
  const code = cinemaErrorCode(error);
  if (code) return copy[code];
  const text = String(error instanceof Error ? error.message : error);
  if (/LIVE_PLAYBACK_FIXED/.test(text))
    return t('Canlı yayın herkes için aynı anda akar; sarılamaz.');
  if (/SESSION_HOST_CONTROL/.test(text)) return t('Kumanda ev sahibinde.');
  if (/ACTIVITY_CONTROL_DENIED/.test(text)) return t('Bu salonda oynatmayı yönetme iznin yok.');
  if (/QUEUE_FULL/.test(text)) return t('Sıra dolu. Önce birkaç öğeyi kaldır.');
  return t('Bir şeyler ters gitti. Yeniden dene.');
}

export const cinemaErrorCopy = copy;
