import type { Catalog } from '@rooms/i18n';

/** English for the language picker and other shared i18n plumbing. */
export const core: Catalog = {
  'Dil / Language': 'Language / Dil',
  'Uygulamanın dili. Değiştirince pencere yeniden yüklenir; ses bağlantın bir an kopar.':
    'The app language. Changing it reloads the window; your voice connection drops for a moment.',
  'Sistem dili': 'System language',
  'Dil değiştirilemedi. Yeniden dene.': 'The language could not be changed. Try again.',
  'İşlem tamamlanamadı. Yeniden dene.': 'The action could not be completed. Try again.',
  'İşlem tamamlanamadı. Bağlantını kontrol edip yeniden dene.':
    'The action could not be completed. Check your connection and try again.',
  'Özel mesaj için önce arkadaş olmanız gerekiyor.':
    'You need to be friends before you can send a direct message.',
  // Built-in labels of the BoardUI components (apps/desktop/src/boardui).
  Değer: 'Value',
  'Değer {number}': 'Value {number}',
  'En az': 'Minimum',
  'En çok': 'Maximum',
};
