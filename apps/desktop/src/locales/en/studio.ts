import type { Catalog } from '@rooms/i18n';

/** English for the Studio group. Keys are the Turkish source text exactly as written in the code. */
export const studio: Catalog = {
  Piyano: 'Piano',
  'Davul seti': 'Drum kit',
  Bas: 'Bass',
  'Lead synth': 'Lead synth',
  'Pad synth': 'Pad synth',
  'Ses kaydı': 'Audio recording',
  'Bilinmeyen enstrüman': 'Unknown instrument',
  'Bu enstrüman için Tayfa’yı güncelle': 'Update Tayfa to play this instrument',
  'Ses kayıtları bu sürümde henüz çalınmıyor': 'Audio recordings don’t play in this version yet',
  Kick: 'Kick',
  Trampet: 'Snare',
  'El çırpma': 'Clap',
  Rim: 'Rim',
  'Kapalı hi-hat': 'Closed hi-hat',
  'Açık hi-hat': 'Open hi-hat',
  'Alçak tom': 'Low tom',
  'Yüksek tom': 'High tom',
  'Dışa aktarılacak aralık boş.': 'The export range is empty.',
  'Dışa aktarma en fazla 10 dakika olabilir.': 'An export can be at most 10 minutes long.',
  'Bu proje silinmiş ya da artık yok.': 'This project was deleted or no longer exists.',
  'Bu odada Stüdyo projesi oluşturma iznin yok.':
    'You don’t have permission to create Studio projects in this room.',
  'Bu projeyi yalnızca oluşturan kişi ya da oda yöneticisi silebilir.':
    'Only the person who created this project or a room manager can delete it.',
  'Bu projeyi düzenleme iznin yok. Dinleyebilir ve izleyebilirsin.':
    'You don’t have permission to edit this project. You can still listen and follow along.',
  'Bu odadaki proje sınırına ulaşıldı. Kullanılmayan bir projeyi silip yeniden dene.':
    'This room has reached its project limit. Delete a project you no longer use and try again.',
  'Son değişiklik sunucudakiyle çakıştı ve uygulanmadı. Proje güncel haliyle yüklendi.':
    'Your last change conflicted with the server and wasn’t applied. The project shows its current state.',
  'Değişiklik tek seferde gönderilemeyecek kadar büyük. Daha küçük parçalar halinde yap.':
    'This change is too large to send at once. Make it in smaller steps.',
  'Bu değişiklik geçersiz olduğu için uygulanmadı.': 'This change was invalid and wasn’t applied.',
  'Bu sunucuda Stüdyo henüz etkin değil. Sunucunun güncellenmesi gerekiyor.':
    'Studio isn’t enabled on this server yet. The server needs an update.',
  'Stüdyo sunucusuna ulaşılamıyor. Bağlantı otomatik olarak yeniden denenecek.':
    'Can’t reach the Studio server. It will reconnect automatically.',
  'Oturum değişti. Projeyi yeniden aç.': 'Your session changed. Open the project again.',
  'Stüdyo masaüstü uygulaması ve yapılandırılmış sunucu gerektirir.':
    'Studio needs the desktop app and a configured server.',
};
