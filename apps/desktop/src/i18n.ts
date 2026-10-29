import {
  configureI18n,
  intlLocale,
  isLocalePreference,
  lookup,
  parseLocale,
  resolveLocale,
  t,
  type Locale,
  type LocalePreference,
} from '@rooms/i18n';
import { activityMessages } from './messages.tr';
import { en } from './locales/en';

export { getLocale, intlLocale, t, type Locale, type LocalePreference } from '@rooms/i18n';

declare global {
  // Set by tests (tests/setup-locale.ts) to pin the interface language.
  var __roomsLocale: Locale | undefined;
}
const LOCALE_KEY = 'rooms.locale';
function storedPreference(): LocalePreference {
  try {
    const value = globalThis.localStorage?.getItem(LOCALE_KEY);
    return isLocalePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}
/**
 * The language is fixed for the life of the page: the desktop bridge carries the main process's
 * choice; the browser build (dev fixtures) reads `?lang=`, then its own stored choice.
 */
function startupLocale(): { preference: LocalePreference; locale: Locale } {
  const pinned = parseLocale(globalThis.__roomsLocale);
  if (pinned) return { preference: pinned, locale: pinned };
  const bridged = globalThis.window?.rooms?.locale;
  if (bridged) return { preference: bridged.preference, locale: bridged.resolved };
  let query: Locale | null = null;
  try {
    query = parseLocale(new URLSearchParams(globalThis.location?.search ?? '').get('lang'));
  } catch {
    /* No location outside the browser. */
  }
  if (query) return { preference: query, locale: query };
  const preference = storedPreference();
  const languages = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? ''];
  return { preference, locale: resolveLocale(preference, languages) };
}
const startup = startupLocale();
const warned = new Set<string>();
configureI18n({
  locale: startup.locale,
  catalog: en,
  onMissing: import.meta.env?.DEV
    ? (source) => {
        if (warned.has(source)) return;
        warned.add(source);
        console.warn(`[i18n] Missing English for: ${source}`);
      }
    : undefined,
});
if (typeof document !== 'undefined') document.documentElement.lang = startup.locale;
export const localePreference = startup.preference;

/** Save a language choice and reload so every surface renders in it. */
export async function changeLocale(preference: LocalePreference): Promise<void> {
  const bridge = globalThis.window?.rooms;
  if (bridge?.setLocale) await bridge.setLocale(preference);
  else localStorage.setItem(LOCALE_KEY, preference);
  location.reload();
}

/** Stable source-message keys. Add locale dictionaries without changing view logic. */
const trMessages: Record<string, string> = {
  'Make a night of it.': 'Bu akşam birlikte.',
  'Same people. A new way to spend the evening.': 'Aynı dostlar. Birlikte yapacak yeni şeyler.',
  'Search activities': 'Etkinlik ara',
  'What are you in the mood for?': 'Bu akşam ne yapalım?',
  'Activity categories': 'Etkinlik kategorileri',
  'Open voice room': 'Ses odasını aç',
  'Ready locally': 'Bu cihazda hazır',
  'Coming later': 'Yakında',
  'Requires setup': 'Kurulum gerekli',
  'Your voice room stays with you. Each activity shows its own availability.':
    'Etkinlik değişse de ses odanız açık kalır.',
  'TOGETHER / LOCAL ACTIVITY': 'BİRLİKTE / YEREL DEMO',
  'Everyone gets a say.': 'Herkesin bir fikri var.',
  'Big plans start with a small decision.': 'Güzel bir akşam, küçük bir kararla başlar.',
  'Create a poll': 'Anket oluştur',
  'What should we do tonight?': 'Bu akşam ne yapalım?',
  'Ask a question. Add a few options. Make a little plan.':
    'Sorunu sor. Seçenekleri ekle. Birlikte karar verin.',
  'Create your first poll': 'İlk anketini oluştur',
  'LOCAL POLL / REVISION': 'YEREL ANKET / SÜRÜM',
  'local vote': 'yerel oy',
  '· You can change your mind.': '· Oyunuzu değiştirebilirsiniz.',
  'A small Activity. A bigger foundation.': 'Birlikte karar verin.',
  'This poll uses the versioned Activity contract. Votes are local to this device; shared voting requires the Activity service.':
    'Bu demo anketin oyları yalnızca bu cihazda saklanır. Ortak anketler için bir odaya bağlanın.',
  'Put it to the room.': 'Odaya sor.',
  'YOUR QUESTION': 'SORUNUZ',
  'Poll question': 'Anket sorusu',
  'What are we watching tonight?': 'Bu akşam ne izliyoruz?',
  'THE OPTIONS': 'SEÇENEKLER',
  'Add an option': 'Seçenek ekle',
  'Start local poll': 'Demo anketi başlat',
  'Movie night': 'Film gecesi',
  'In the lounge': 'Salonda',
  'Taking it slow': 'Dinleniyor',
  'Your private community.': 'Size özel topluluk.',
  Messages: 'Sohbet',
  You: 'Sen',
  'Your community': 'Topluluğun',
  Tonight: 'Bu akşam',
  'Your spaces': 'Mekânların',
  'The lounge': 'Salon',
  Cinema: 'Sinema',
  Settings: 'Ayarlar',
  'Quick polls': 'Anketler',
  'DESKTOP PREVIEW': 'MASAÜSTÜ ÖNİZLEME',
  'A little closer, even from here.': 'Uzakta da olsak, bir arada.',
  'Spaces rail': 'Mekânlar çubuğu',
  'Tayfa home': 'Tayfa ana sayfa',
  'Create a local space': 'Demo mekân oluştur',
  'Invite a friend': 'Arkadaş davet et',
  'Help and keyboard shortcuts': 'Yardım ve klavye kısayolları',
  'YOUR PRIVATE PLACE': 'SİZE ÖZEL BİR YER',
  'Find your people': 'Dostlarını bul',
  'Main navigation': 'Ana gezinme',
  Spaces: 'Mekânlar',
  'Voice lounge': 'Sesli salon',
  'YOUR SPACES': 'MEKÂNLARIN',
  'YOUR COMMUNITY': 'TOPLULUĞUN',
  'Add a space': 'Mekân ekle',
  'TEXT CHANNELS': 'SOHBET KANALLARI',
  VOICE: 'SES',
  'DIRECT MESSAGES': 'ÖZEL MESAJLAR',
  'Make a night of it': 'Bu akşam birlikte',
  'Start an activity': 'Etkinlik başlat',
  'Local demo': 'Yerel demo',
  Connected: 'Bağlandı',
  'Go back': 'Geri dön',
  'LOCAL DEMO': 'YEREL DEMO',
  'PRIVATE COMMUNITY': 'ÖZEL TOPLULUK',
  'Search commands': 'Komut ara',
  'Hide friends panel': 'Arkadaş panelini gizle',
  'Show friends panel': 'Arkadaş panelini göster',
  'Reconnecting to your community. Your last conversation is still here.':
    'Topluluğuna yeniden bağlanılıyor. Son sohbetin burada.',
  'Connecting to your private community…': 'Özel topluluğuna bağlanılıyor…',
  'Your community connection is interrupted.': 'Topluluk bağlantısı kesildi.',
  'Connection settings': 'Bağlantı ayarları',
  'Dismiss community error': 'Bağlantı hatasını kapat',
  'Opening your room…': 'Odan açılıyor…',
  'The circle': 'Dost meclisi',
  'About invites': 'Davetler hakkında',
  'A familiar face. A better evening.': 'Tanıdık yüzler. Güzel bir akşam.',
  'DEMO FRIENDS': 'DEMO ARKADAŞLAR',
  'No friends yet. Connect your private server to bring your circle here.':
    'Henüz arkadaş yok. Dostlarını görmek için özel sunucuna bağlan.',
  'Room for a little downtime.': 'Biraz dinlenmeye yer var.',
  'No feeds. No noise.': 'Akış yok. Gürültü yok.',
  'Just your favorite people.': 'Sadece sevdiğin insanlar.',
  'A LITTLE LATER': 'BİRAZ SONRA',
  'late show': 'gece seansı',
  'Friday, made for friends.': 'Cuma, dostlara ayrıldı.',
  'A sample movie-night ritual.': 'Demo film gecesi planı.',
  'Plan a movie night': 'Film gecesi planla',
  'Private by design': 'Baştan sona özel',
  'Demo mode': 'Demo modu',
  'Your circle': 'Dostların',
  'YOUR VOICE ROOM': 'SES ODAN',
  ' · you': ' · sen',
  'Mic off': 'Mikrofon kapalı',
  Speaking: 'Konuşuyor',
  Listening: 'Dinliyor',
  'Join a voice room to see who’s there.':
    'Kimlerin burada olduğunu görmek için ses odasına katıl.',
  'Social presence is unavailable.': 'Çevrimiçi bilgisi kullanılamıyor.',
  'Voice room membership is live.': 'Ses odası üyeleri canlı gösterilir.',
  'Private conversation': 'Özel sohbet',
  'Your private community': 'Özel topluluğun',
  'Local preview · no audio connection': 'Yerel demo · ses bağlantısı yok',
  'Unmute preview': 'Demo mikrofonunu aç',
  'Mute preview': 'Demo mikrofonunu kapat',
  'Undeafen preview': 'Demo sesi aç',
  'Deafen preview': 'Demo sesi kapat',
  'Voice device settings': 'Ses aygıtı ayarları',
  'Leave preview room': 'Demo odadan ayrıl',
  'Where shall we go?': 'Nereye gidelim?',
  'Find a room, a friend, or a little inspiration…': 'Oda, arkadaş veya bir fikir ara…',
  'Your evening, at a glance': 'Bu akşam, bir bakışta',
  'Open the local theater': 'Kişisel sinemayı aç',
  'Explore a demo voice room': 'Demo ses odasını keşfet',
  'Join a private voice room': 'Özel ses odasına katıl',
  'The Clubhouse / general': 'Kulüp / genel',
  'Your private community conversations': 'Özel topluluk sohbetlerin',
  'Decide what’s next · local activity': 'Birlikte karar ver · yerel demo',
  'Make yourself at home': 'Rahatına bak',
  'Tab to choose · Enter to open · Escape to return': 'Tab ile seç · Enter ile aç · Esc ile dön',
  'A place of your own.': 'Sana ait bir yer.',
  'Set the mood.': 'Akşamı başlat.',
  'Create a local demo space. Nothing is sent to a server.':
    'Yerel demo mekân oluştur. Sunucuya veri gönderilmez.',
  'Open a local room preview. Voice transport is not connected yet.':
    'Yerel oda demosunu aç. Gerçek ses bağlantısı kurulmaz.',
  'SPACE NAME': 'MEKÂN ADI',
  'ROOM NAME': 'ODA ADI',
  'The good company club': 'Dostlar kulübü',
  'The late-night lounge': 'Gece salonu',
  'Create demo space': 'Demo mekân oluştur',
  'Open room preview': 'Oda demosunu aç',
  'A few quiet shortcuts.': 'Küçük kısayollar.',
  'Made for your keyboard, too.': 'Klavyen için de tasarlandı.',
  'Command palette': 'Komut menüsü',
  'Tonight → Cinema': 'Bu akşam → Sinema',
  'Mute your room mic': 'Oda mikrofonunu kapat',
  'Push to talk (when enabled)': 'Bas konuş (açıksa)',
  'Play / pause (Cinema)': 'Oynat / duraklat (Sinema)',
  'Seek backward / forward': 'Geri / ileri sar',
  'Close an overlay': 'Açılır pencereyi kapat',
  'Send a message': 'Mesaj gönder',
  'New line in a message': 'Mesajda yeni satır',
  'Playback keys never interrupt typing in a message.':
    'Oynatma kısayolları mesaj yazarken devreye girmez.',
  'Your people belong here.': 'Dostlarının yeri burada.',
  'Private invitations will be issued by your Spacebar server. Connect the social backend in Milestone 2 to invite real friends.':
    'Gerçek arkadaşlarını davet etmek için özel Stoat sunucuna bağlan.',
  'Spacebar · not configured': 'Stoat · yapılandırılmadı',
  'DEMO FRIEND': 'DEMO ARKADAŞ',
  'This is a local fixture. Messages and room previews stay on this computer.':
    'Bu bir demo profili. Mesajlar ve oda demosu bu bilgisayarda kalır.',
  'Local message': 'Demo mesaj',
  'Room preview': 'Oda demosu',
  'Dismiss notification': 'Bildirimi kapat',
  'The local video could not start. Try loading the demo again.':
    'Video başlatılamadı. Demoyu yeniden yüklemeyi dene.',
  'Fullscreen could not open. Try the native window fullscreen control.':
    'Tam ekran açılamadı. Pencerenin tam ekran düğmesini dene.',
  'THE CLUBHOUSE / LOCAL THEATER': 'KULÜP / KİŞİSEL SİNEMA',
  'A seat for you.': 'Yerin hazır.',
  'Sample company': 'Demo arkadaşlar',
  'Your private theater': 'Kişisel sineman',
  'Local playback · no broadcast': 'Kişisel oynatma · yayın yapılmaz',
  'Blue hour has ended. Replay it or choose your next activity.':
    'Mavi saat sona erdi. Yeniden oynat veya yeni bir etkinlik seç.',
  'The bundled demonstration video is unavailable. Reload it to try again.':
    'Demo video kullanılamıyor. Yeniden yüklemeyi dene.',
  'Blue hour original local demo video': 'Mavi saat özgün demo videosu',
  'Tayfa ORIGINAL DEMO': 'Tayfa ÖZGÜN DEMO',
  'PERSONAL PLAYBACK': 'KİŞİSEL OYNATMA',
  'Resume Blue hour': 'Mavi saate devam et',
  'Play Blue hour': 'Mavi saati oynat',
  'A pause in the evening.': 'Akşama kısa bir ara.',
  'Reload demo': 'Demoyu yeniden yükle',
  'AN ORIGINAL VISUAL STUDY': 'ÖZGÜN BİR GÖRSEL ÇALIŞMA',
  'Blue hour': 'Mavi saat',
  'A moment between the mountains and the night.': 'Dağlar ve gece arasında bir an.',
  'Seek back 5 seconds': '5 saniye geri sar',
  'Pause local video': 'Videoyu duraklat',
  'Play local video': 'Videoyu oynat',
  'Seek forward 5 seconds': '5 saniye ileri sar',
  'LOCAL ·': 'YEREL ·',
  'Picture in picture is unavailable until the local video is loaded.':
    'Resim içinde resim için videonun yüklenmesini bekle.',
  'Original artwork & local motion study · 30 seconds': 'Özgün görsel çalışma · 30 saniye',
  'Hide room dock': 'Oda panelini gizle',
  'Open room dock': 'Oda panelini aç',
  'You have the remote': 'Kumanda sende',
  'Local controls, just for you': 'Kişisel oynatma denetimleri',
  'Each viewer needs their own permitted source.': 'Her izleyicinin kendi yetkili kaynağı gerekir.',
  'Shared synchronization is not connected.': 'Ortak oynatma bağlı değil.',
  'The movie is only half the night.': 'Film, akşamın sadece yarısı.',
  'Your local room preview stays with you while you watch.': 'İzlerken demo odan açık kalır.',
  'Keep your people nearby. Open a room preview while you watch.': 'İzlerken bir oda demosu aç.',
  'Your voice room stays connected while you watch.': 'İzlerken ses odan bağlı kalır.',
  'Open a voice room to keep your people nearby.': 'Dostlarınla olmak için ses odası aç.',
  'The room': 'Oda',
  'Close room dock': 'Oda panelini kapat',
  'Cinema room panels': 'Sinema oda panelleri',
  'UP NEXT / LOCAL QUEUE': 'SIRADAKİ / YEREL LİSTE',
  'Original demo · 0:30': 'Özgün demo · 0:30',
  'An open evening.': 'Akşam daha yeni başlıyor.',
  'Add the local demo to your queue.': 'Demoyu listene ekle.',
  'Blue hour — original local demo': 'Mavi saat — özgün yerel demo',
  'Original local demo added to the queue.': 'Özgün demo listeye eklendi.',
  'Add demo to queue': 'Demoyu listeye ekle',
  'A local planning list. Automatic playback and shared requests arrive with the activity service.':
    'Bu liste yalnızca cihazında saklanır. Ortak liste için bir odaya bağlan.',
  'LOCAL ROSTER PREVIEW': 'YEREL ÜYE DEMOSU',
  'Demo member': 'Demo üye',
  'You · local only': 'Sen · yalnızca yerel',
  'No microphone is transmitted. Configure the media service to talk together.':
    'Mikrofon iletilmez. Konuşmak için gerçek bir ses odasına katıl.',
  'NO VOICE ROOM JOINED': 'SES ODASINA KATILMADIN',
  'Join a voice room from the Voice lounge.': 'Sesli salondan bir odaya katıl.',
  'Cinema local message': 'Sinema demo mesajı',
  'A quiet comment…': 'Bir şey söyle…',
  'Send cinema local message': 'Sinema demo mesajını gönder',
  'General conversation · stored on this device': 'Genel sohbet · bu cihazda saklanır',
  'Stay in the conversation.': 'Sohbetten kopma.',
  'Open Messages to chat with your community. Voice stays connected while you move.':
    "Topluluğunla konuşmak için Sohbet'i aç. Geçiş sırasında ses odan bağlı kalır.",
  'Open Messages': 'Sohbeti aç',
  'Cinema playback is local. Shared media synchronization is not connected.':
    'Sinema kişisel oynatmadır. Ortak oynatma bağlı değil.',
  'Your kind of cinema.': 'Senin sineman.',
  'PLAYBACK SPEED': 'OYNATMA HIZI',
  ' · Normal': ' · Normal',
  'Blue hour is a bundled original visual study with no audio or subtitle tracks. Volume controls apply to the player; this silent source has nothing to mute.':
    'Mavi saat, ses ve altyazı içermeyen özgün bir görsel çalışmadır. Ses denetimleri oynatıcıya uygulanır.',
  'Start again': 'Baştan başlat',
  'YOUR EVENING STARTS HERE': 'AKŞAMIN BURADA BAŞLAR',
  'Good evening,': 'İyi akşamlar,',
  'A little less scrolling. A little more together.':
    'Biraz daha az ekran. Biraz daha çok beraber.',
  'Stay a while.': 'Biraz kal.',
  'Original cinematic mountain valley at blue hour': 'Mavi saatte özgün dağ vadisi görseli',
  'THE CLUBHOUSE CINEMA': 'KULÜP SİNEMASI',
  'LOCAL PREVIEW': 'YEREL DEMO',
  'SOME NIGHTS ARE BETTER TOGETHER.': 'BAZI AKŞAMLAR BİRLİKTE DAHA GÜZEL.',
  'Good company.': 'Güzel insanlar.',
  'Great stories.': 'Güzel hikâyeler.',
  'Pull up a seat. Leave the day behind.': 'Bir sandalye çek. Günü geride bırak.',
  'There’s always room for you here.': 'Burada sana her zaman yer var.',
  'Enter Cinema': 'Sinemaya gir',
  'Pick an activity': 'Etkinlik seç',
  'A familiar kind of evening': 'Tanıdık bir akşam',
  'Sample friends · local demo': 'Demo arkadaşlar · yerel demo',
  'BLUE HOUR': 'MAVİ SAAT',
  'Original artwork': 'Özgün görsel',
  'A room for every kind of night.': 'Her akşama bir oda.',
  'Start a room': 'Oda başlat',
  WATCH: 'İZLE',
  'The Clubhouse': 'Kulüp',
  'Cinema preview': 'Sinema demosu',
  'HANG OUT': 'TAKIL',
  'Nothing planned.': 'Plan yok.',
  'Everything welcome.': 'Her şeye yer var.',
  'After Hours': 'Gece Kuşları',
  'Voice preview': 'Ses odası demosu',
  TOGETHER: 'BİRLİKTE',
  'What’s': 'Bu akşam',
  'the plan?': 'ne yapalım?',
  'A little group decision': 'Küçük bir ortak karar',
  'Quick Poll': 'Hızlı anket',
  'Local activity': 'Yerel demo',
  'It’s quiet here.': 'Burası şimdilik sakin.',
  'Start a local room, or connect your server to find your friends.':
    'Demo oda aç veya dostlarını bulmak için sunucuna bağlan.',
  'Your little corners': 'Size ait köşeler',
  'All spaces': 'Tüm mekânlar',
  'Private demo space': 'Özel demo mekân',
  'The best part of tonight isn’t on a screen. It’s who’s on the other side.':
    'Bu akşamın en güzel yanı, ekranın diğer ucundakiler.',
  'Original mountain valley at blue hour': 'Mavi saatte özgün dağ vadisi',
  'ORIGINAL LOCAL FILM': 'ÖZGÜN YEREL FİLM',
  'A place to catch up. A moment to slow down.': 'Hasret giderecek bir yer. Yavaşlayacak bir an.',
  'Make a little room for each other.': 'Birbirinize biraz yer açın.',
  'Find your room': 'Odanı bul',
  'Local Cinema': 'Kişisel sinema',
  'An evening with your people': 'Dostlarınla bir akşam',
  'Voice stays connected while you explore.': 'Dolaşırken ses odan açık kalır.',
  'Private community · presence unavailable': 'Özel topluluk · çevrimiçi bilgisi yok',
  'Open voice room · join with mic off': 'Ses odası · mikrofon kapalı katıl',
  'Start with a hello': 'Bir merhabayla başla',
  'Open your private conversation': 'Özel sohbetini aç',
  'Cinema, a local poll, or a new ritual': 'Sinema, bir anket veya yeni bir alışkanlık',
  'The best part of tonight is who’s on the other side.':
    'Bu akşamın en güzel yanı, ekranın diğer ucundakiler.',
  'The connection could not be established. Check your server and try again.':
    'Bağlantı kurulamadı. Sunucu adresini kontrol edip yeniden dene.',
  'Spacebar · accounts, channels and conversations': 'Stoat · hesaplar, kanallar ve sohbetler',
  'Connecting…': 'Bağlanıyor…',
  'Reconnecting…': 'Yeniden bağlanıyor…',
  Disconnected: 'Bağlı değil',
  'Sign in': 'Giriş yap',
  'Your community is connected.': 'Topluluğuna bağlandın.',
  'Your session is saved. Waiting for the server.': 'Oturumun kayıtlı. Sunucu bekleniyor.',
  'Sign out': 'Çıkış yap',
  'private space': 'özel mekân',
  'Real community mode': 'Gerçek topluluk modu',
  'Demo view': 'Demo görünümü',
  'Open community': 'Topluluğu aç',
  'Account access': 'Hesap erişimi',
  'Join with an invitation': 'Davetle katıl',
  'SERVER ADDRESS': 'SUNUCU ADRESİ',
  'Community server address': 'Topluluk sunucusu adresi',
  'Use this computer’s server': 'Bu bilgisayardaki sunucuyu kullan',
  'YOUR NAME': 'ADIN',
  'Account username': 'Kullanıcı adı',
  'How your friends know you': 'Arkadaşların seni nasıl tanıyor?',
  EMAIL: 'E-POSTA',
  'Account email': 'Hesap e-postası',
  PASSWORD: 'PAROLA',
  'Account password': 'Hesap parolası',
  'Join your friends': 'Dostlarına katıl',
  'Come on in': 'İçeri gel',
  'An invitation is required to create an account. Your server handles sign-in; Tayfa keeps the session in the desktop’s secure storage.':
    'Hesap oluşturmak için davet gerekir. Girişi sunucun yönetir; Tayfa oturumunu güvenli masaüstü deposunda tutar.',
  'We couldn’t complete that.': 'İşlem tamamlanamadı.',
  'Push-to-talk could not access the microphone.': 'Bas konuş mikrofonuna erişemedi.',
  'Please try again.': 'Lütfen yeniden dene.',
  'Your conversations': 'Sohbetlerin',
  'The everyday conversations, with your people.': 'Dostlarınla gündelik sohbetler.',
  'Community messages': 'Topluluk mesajları',
  'Loading…': 'Yükleniyor…',
  'Earlier messages': 'Önceki mesajlar',
  'A PLACE FOR YOUR PEOPLE': 'DOSTLARINA BİR YER',
  'A conversation starts here.': 'Sohbet burada başlar.',
  'Find your corner.': 'Köşeni bul.',
  'Send the first hello.': 'İlk merhabayı sen gönder.',
  'Select a channel or join a private space with an invitation.':
    'Bir kanal seç veya davetle özel bir mekâna katıl.',
  'Opening the conversation…': 'Sohbet açılıyor…',
  'Open member actions': 'Üye işlemlerini aç',
  you: 'sen',
  edited: 'düzenlendi',
  'Sending…': 'Gönderiliyor…',
  'Not sent': 'Gönderilemedi',
  Retry: 'Yeniden dene',
  'Edit your message': 'Mesajını düzenle',
  'Delete your message': 'Mesajını sil',
  'New messages ↓': 'Yeni mesajlar ↓',
  'Community message composer': 'Topluluk mesajı yaz',
  'Choose a channel to begin': 'Başlamak için kanal seç',
  'Send community message': 'Topluluk mesajını gönder',
  'Private community ·': 'Özel topluluk ·',
  'Enter to send · Shift + Enter for a new line': 'Enter ile gönder · Shift + Enter ile yeni satır',
  'Remove this member?': 'Üye çıkarılsın mı?',
  'PRIVATE COMMUNITY MEMBER': 'ÖZEL TOPLULUK ÜYESİ',
  Remove: 'Çıkar',
  from: 'şuradan',
  '? They will need a new invitation to return. The server verifies your permission.':
    '? Geri dönmek için yeni davet gerekir. Yetkiniz sunucuda doğrulanır.',
  'Keep member': 'Üye kalsın',
  'Member removed from this private space.': 'Üye özel mekândan çıkarıldı.',
  'Removing…': 'Çıkarılıyor…',
  'Remove member': 'Üyeyi çıkar',
  'Open direct message': 'Özel mesaj aç',
  'Member blocked. Your server applies the relationship.':
    'Üye engellendi. Engel sunucunda uygulanır.',
  'Block member': 'Üyeyi engelle',
  'Member unblocked.': 'Üyenin engeli kaldırıldı.',
  'Unblock member': 'Engeli kaldır',
  'Remove from this space': 'Bu mekândan çıkar',
  'A second thought.': 'Bir daha düşününce.',
  'Edit community message': 'Topluluk mesajını düzenle',
  'Save changes': 'Değişiklikleri kaydet',
  'Delete this message?': 'Mesaj silinsin mi?',
  'This removes the message from your private community.':
    'Bu işlem mesajı özel topluluğundan siler.',
  'Keep it': 'Vazgeç',
  'Delete message': 'Mesajı sil',
  'YOUR PRIVATE COMMUNITY': 'ÖZEL TOPLULUĞUN',
  'A place to belong.': 'Ait olduğun bir yer.',
  'The people you know. A corner of your own.': 'Tanıdığın insanlar. Size ait bir köşe.',
  'Join with an invite': 'Davetle katıl',
  'YOUR PRIVATE SPACE': 'ÖZEL MEKÂNIN',
  'Open the conversation.': 'Sohbeti aç.',
  'Your circle starts here.': 'Dost meclisin burada başlar.',
  'Join your friends with an invitation from your private server.':
    'Özel sunucundan gelen davetle dostlarına katıl.',
  'Only the people you invite.': 'Yalnızca davet ettiklerin.',
  'Your server controls space membership and channel access.':
    'Mekân üyeliğini ve kanal erişimini sunucun yönetir.',
  'Come on in.': 'İçeri gel.',
  'Joining…': 'Katılıyor…',
  'Join private space': 'Özel mekâna katıl',
  'This stream has ended.': 'Bu yayın sona erdi.',
  'YOUR PEOPLE / VOICE': 'DOSTLARIN / SES',
  'Just being here is enough.': 'Burada olmak yeter.',
  'Choose a room. Settle in.': 'Bir oda seç. Rahatına bak.',
  CONNECTED: 'BAĞLANDI',
  CONNECTING: 'BAĞLANIYOR',
  RECONNECTING: 'YENİDEN BAĞLANIYOR',
  'READY WHEN YOU ARE': 'SEN HAZIRSAN',
  'A quiet corner.': 'Sakin bir köşe.',
  'This space has no visible voice channels. Choose another space or ask its owner to create one.':
    'Bu mekânda ses kanalı yok. Başka bir mekân seç veya sahibinden kanal açmasını iste.',
  'Connecting securely…': 'Güvenli bağlantı kuruluyor…',
  Participant: 'Katılımcı',
  'Someone is already sharing in this room. Ask them to stop before you share.':
    'Bu odada biri zaten ekranını paylaşıyor. Paylaşmadan önce durdurmasını iste.',
  'Your room role does not allow screen sharing.':
    'Bu odadaki rolün ekran paylaşımına izin vermiyor.',
  'Choose a voice room before joining.': 'Katılmadan önce bir ses odası seç.',
  'Your access to this voice room changed. Rejoin after your membership is restored.':
    'Bu ses odasına erişimin değişti. Üyeliğin yeniden açıldıktan sonra katıl.',
  'The conversation session changed. Join the voice room again.':
    'Oturumun değişti. Ses odasına yeniden katıl.',
  'A moderator disconnected you from the voice room.':
    'Bir yönetici seni ses odasından çıkardı. İstersen yeniden katılabilirsin.',
  'Voice disconnected. Rejoin to obtain a fresh membership grant.':
    'Ses bağlantısı kesildi. Oda erişimini yeniden doğrulamak için tekrar katıl.',
  'Your screen is being shared': 'Ekranın paylaşılıyor',
  'Shared screen': 'Paylaşılan ekran',
  '· System audio is off': '· Sistem sesi kapalı',
  'Your mic is off. Unmute when you’re ready.': 'Mikrofonun kapalı. Hazır olduğunda aç.',
  'Your microphone is on.': 'Mikrofonun açık.',
  'Voice stays connected when you move between activities.':
    'Etkinlikler arasında geçerken ses bağlantın sürer.',
  'Leave room': 'Odadan ayrıl',
  'Let’s get you connected.': 'Seni bağlayalım.',
  'Voice room': 'Ses odası',
  'Retry connection': 'Yeniden bağlan',
  'Do something together': 'Birlikte bir şey yapın',
  'Keep the conversation going.': 'Sohbet devam etsin.',
  'Sound like yourself': 'Sesin sana benzesin',
  'Choose devices and test your microphone.': 'Aygıtları seç ve mikrofonunu dene.',
  'Your audio': 'Ses ayarların',
  'In the room': 'Odadakiler',
  'CONNECTION ·': 'BAĞLANTI ·',
  'VOLUME FOR YOU ·': 'SENİN İÇİN SES ·',
  'Participant volume': 'Katılımcı ses düzeyi',
  'Use the room control bar to mute your mic, deafen, or leave.':
    'Mikrofonu, oda sesini ve ayrılmayı alttaki denetimlerden yönet.',
  'Screen sources are unavailable. Check macOS Screen Recording permission.':
    'Ekran kaynaklarına erişilemiyor. macOS Ekran Kaydı iznini kontrol et.',
  'mic off': 'mikrofon kapalı',
  'mic on': 'mikrofon açık',
  'Connection interrupted': 'Bağlantı kesildi',
  'Unmute microphone': 'Mikrofonu aç',
  'Mute microphone': 'Mikrofonu kapat',
  'Undeafen audio': 'Oda sesini aç',
  'Deafen audio': 'Oda sesini kapat',
  'Turn camera off': 'Kamerayı kapat',
  'Turn camera on': 'Kamerayı aç',
  'Stop sharing': 'Paylaşımı durdur',
  'Share a screen or window': 'Ekran veya pencere paylaş',
  'Leave voice room': 'Ses odasından ayrıl',
  'Enable sound': 'Sesi aç',
  'Open room': 'Odayı aç',
  'A window into your world.': 'Dünyana bir pencere.',
  'Choose exactly what your room can see. Capture starts only after you press Share. System audio is off on this macOS build.':
    "Odanın göreceği ekranı seç. Yakalama, Paylaş'a bastığında başlar. Bu macOS sürümünde sistem sesi kapalıdır.",
  'Finding screens and windows…': 'Ekranlar ve pencereler bulunuyor…',
  'No capture sources are available. Allow Tayfa in System Settings → Privacy & Security → Screen & System Audio Recording, then retry.':
    "Ekran kaynağı bulunamadı. Sistem Ayarları → Gizlilik ve Güvenlik → Ekran ve Sistem Sesi Kaydı bölümünden Tayfa'ya izin verip yeniden dene.",
  Cancel: 'Vazgeç',
  'Screen sharing could not start.': 'Ekran paylaşımı başlatılamadı.',
  'Starting…': 'Başlatılıyor…',
  'Share selected source': 'Seçili kaynağı paylaş',
  'Make room for a friend.': 'Bir dostuna yer aç.',
  'Create an invitation to this private space. It can be used once and expires after 24 hours. Your server checks invitation permissions.':
    'Bu mekân için davet oluştur. Davet kullanım koşullarını ve yetkilerini sunucun belirler.',
  'Creating…': 'Oluşturuluyor…',
  'Create invitation': 'Davet oluştur',
  'Open a space with a text channel first.': 'Önce sohbet kanalı olan bir mekân aç.',
  Appearance: 'Görünüm',
  'Voice & audio': 'Ses ve mikrofon',
  Connections: 'Bağlantılar',
  'Your profile': 'Profilin',
  Keyboard: 'Klavye',
  Desktop: 'Masaüstü',
  Diagnostics: 'Tanılama',
  'Not requested': 'İstenmedi',
  'Audio devices are unavailable. Open the desktop app and try again.':
    'Ses aygıtlarına erişilemiyor. Masaüstü uygulamasını açıp yeniden dene.',
  'Requesting permission…': 'İzin isteniyor…',
  'Granted · local meter only': 'İzin verildi · yalnızca yerel ölçüm',
  'Microphone disconnected. Choose an available input device and retry.':
    'Mikrofon bağlantısı kesildi. Kullanılabilir bir giriş aygıtı seçip yeniden dene.',
  Unavailable: 'Kullanılamıyor',
  'Microphone access was denied. Allow Tayfa in macOS System Settings → Privacy & Security → Microphone, then retry.':
    "Mikrofon erişimi reddedildi. macOS Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon bölümünden Tayfa'ya izin verip yeniden dene.",
  'The selected microphone is unavailable. Refresh devices and choose another input.':
    'Seçili mikrofon kullanılamıyor. Aygıtları yenile ve başka bir giriş seç.',
  'Playing a quiet test tone through your selected output.':
    'Seçili çıkıştan düşük sesli bir deneme tonu çalıyor.',
  'The selected output could not be used. Choose System default and retry.':
    'Seçili çıkış kullanılamadı. Sistem varsayılanını seçip yeniden dene.',
  'Sanitized diagnostics exported.': 'Özel bilgilerden arındırılmış tanılama dışa aktarıldı.',
  'Export cancelled.': 'Dışa aktarma iptal edildi.',
  'MAKE YOURSELF AT HOME': 'RAHATINA BAK',
  'The little things matter.': 'Küçük ayrıntılar önemli.',
  'A space that feels like you.': 'Sana benzeyen bir yer.',
  'Settings categories': 'Ayar kategorileri',
  'Desktop · private by design': 'Masaüstü · baştan sona özel',
  'Quiet by design.': 'Sadelik, tasarımın özü.',
  'A few thoughtful touches, just the way you like them.':
    'Birkaç ince dokunuş, tam istediğin gibi.',
  'good company.': 'iyi ki beraberiz.',
  'DARK /': 'KOYU /',
  SOLID: 'OPAK',
  GLASS: 'CAM',
  'Dark first. System and light themes are planned.':
    'Koyu görünüm hazır. Sistem ve açık tema henüz desteklenmiyor.',
  'System appearance is planned': 'Sistem görünümü henüz desteklenmiyor',
  System: 'Sistem',
  'Dark appearance is selected.': 'Koyu görünüm seçili.',
  Dark: 'Koyu',
  'Light appearance is planned': 'Açık görünüm henüz desteklenmiyor',
  Light: 'Açık',
  Accent: 'Vurgu rengi',
  'A little color. Never too much.': 'Biraz renk. Tam kararında.',
  'Pearl accent': 'İnci vurgu rengi',
  'Sage accent': 'Adaçayı vurgu rengi',
  'Reduce transparency': 'Saydamlığı azalt',
  'Solid navigation and controls. Less work for your GPU.':
    'Opak gezinme ve denetimler. Grafik işlemcisi için daha az yük.',
  'Reduce motion': 'Hareketi azalt',
  'Keep transitions immediate and comfortable.': 'Geçişleri hızlı ve sakin tut.',
  'Compact conversations': 'Kompakt sohbetler',
  'A little more conversation in a little less space.': 'Daha az alanda daha çok sohbet.',
  'Friends panel': 'Arkadaş paneli',
  'Keep your circle nearby while browsing.': 'Gezinirken dostlarını yanında tut.',
  'Show demo fixtures': 'Demo içeriğini göster',
  'Turn off sample friends and rooms to explore empty states.':
    'Boş görünümü görmek için örnek arkadaşları ve odaları kapat.',
  'Sound like yourself.': 'Sesin sana benzesin.',
  'Local device tests are real. Room voice is available after signing in to your private server.':
    'Aygıt testleri bu cihazda gerçekten çalışır. Ses odaları için özel sunucuna giriş yap.',
  'Voice / SFU · not configured': 'Ses hizmeti · bağlı değil',
  'INPUT DEVICE': 'GİRİŞ AYGITI',
  'Input device': 'Giriş aygıtı',
  'System default microphone': 'Sistem varsayılan mikrofonu',
  'OUTPUT DEVICE': 'ÇIKIŞ AYGITI',
  'Output device': 'Çıkış aygıtı',
  'System default speakers': 'Sistem varsayılan hoparlörü',
  'Try your microphone': 'Mikrofonunu dene',
  'Microphone input level': 'Mikrofon giriş düzeyi',
  'Your microphone stays on this device. You won’t hear feedback.':
    'Mikrofon sesi bu cihazda kalır. Geri besleme duymazsın.',
  'Stop test': 'Testi durdur',
  'Test microphone': 'Mikrofonu dene',
  'Test speaker': 'Hoparlörü dene',
  'Refresh devices': 'Aygıtları yenile',
  'Microphone access begins only when you press Test. Leaving this page stops the test and releases the device.':
    'Mikrofon erişimi yalnızca test düğmesine bastığında başlar. Bu sayfadan ayrıldığında test durur ve aygıt serbest bırakılır.',
  'Your people. Your media.': 'Dostların. İçeriklerin.',
  'Private services, with clear boundaries.': 'Her bağlantının yeri belli.',
  'Voice, video & screen sharing': 'Ses, video ve ekran paylaşımı',
  'Sign in, open a voice channel, and join with your mic off. Screen capture starts only after you select a source.':
    'Giriş yap ve bir ses kanalına mikrofon kapalı katıl. Ekran yakalama yalnızca kaynak seçtiğinde başlar.',
  'YouTube Together': 'Birlikte YouTube',
  'Each viewer uses the official player': 'Her izleyici resmî oynatıcıyı kullanır',
  'Requires Activity state synchronization and embed verification. Milestone 4.':
    'Ortak oda bağlantısı ve resmî oynatıcı doğrulaması gerekir.',
  'Personal IPTV': 'Kişisel IPTV',
  'Your own authorized media source': 'Kendi yetkili medya kaynağın',
  'Personal playlist validation and codec testing. Milestone 5.':
    'Kişisel oynatma listesi ve uyumlu medya biçimi gerekir.',
  'Your personal account, kept personal': 'Kişisel hesabın, sana özel',
  'OAuth and secure OS credential storage. Milestone 5.':
    'Kişisel yetkilendirme ve güvenli sistem deposu gerekir.',
  'Ready to join': 'Katılmaya hazır',
  'Sign in first': 'Önce giriş yap',
  'Not configured': 'Yapılandırılmadı',
  'Your community session is stored by the desktop in OS-protected storage. Personal media providers are not connected; no provider credentials are collected.':
    'Topluluk oturumun masaüstünün güvenli sistem deposunda saklanır. Kişisel medya bağlantıların yalnızca sana aittir.',
  'A familiar face.': 'Tanıdık bir yüz.',
  'Your local demo identity.': 'Yerel demo kimliğin.',
  'LOCAL PROFILE': 'YEREL PROFİL',
  'DISPLAY NAME': 'GÖRÜNEN AD',
  'Display name': 'Görünen ad',
  'Saved automatically on this device. Account profiles require Spacebar.':
    'Bu cihazda otomatik kaydedilir. Hesap profilini Stoat sunucun yönetir.',
  'Less clicking. More living.': 'Daha az tık. Daha çok hayat.',
  'Keyboard-native from the start.': 'En başından beri klavyene göre.',
  'Find a room or command': 'Oda veya komut bul',
  'Home / Spaces / Chat / Voice / Cinema': 'Ana sayfa / Mekânlar / Sohbet / Ses / Sinema',
  'Open settings': 'Ayarları aç',
  'Mute the local room preview': 'Demo oda mikrofonunu kapat',
  'Play / pause local media': 'Kişisel medyayı oynat / duraklat',
  'Seek local media 5 seconds': 'Kişisel medyayı 5 saniye sar',
  'Close topmost dialog': 'En üst pencereyi kapat',
  'Send local message': 'Demo mesaj gönder',
  'New line': 'Yeni satır',
  'Media shortcuts respect text fields. Enable push-to-talk in Voice & audio, then hold Ctrl + Shift + Space while Tayfa is focused.':
    'Medya kısayolları metin alanlarında çalışmaz. Bas konuşu açtıktan sonra Tayfa odaktayken Ctrl + Shift + Space tuşlarına basılı tut.',
  'A proper place on your desktop.': 'Masaüstünde kendine ait bir yer.',
  'Native controls, with you in charge.': 'Yerel denetimler, karar sende.',
  'Push to talk': 'Bas konuş',
  'Hold Ctrl + Shift + Space to speak while Tayfa is focused. Typing fields are excluded; releasing the keys or switching apps mutes you.':
    'Tayfa odaktayken Ctrl + Shift + Space ile konuş. Yazı alanları hariçtir; tuşları bırakınca veya uygulama değiştirince mikrofon kapanır.',
  'Keep window on top': 'Pencereyi üstte tut',
  'Keep Tayfa nearby while using other apps.':
    'Diğer uygulamaları kullanırken Tayfa yanında kalsın.',
  'Always on top': 'Her zaman üstte',
  'Always on top is available in the Electron app.':
    'Her zaman üstte seçeneği masaüstü uygulamasında kullanılabilir.',
  'Open at login': 'Oturum açınca başlat',
  'Opt-in. Available in the packaged macOS application.':
    'İsteğe bağlı. Paketlenmiş macOS uygulamasında kullanılabilir.',
  'Login behavior requires the packaged desktop app.':
    'Oturumda başlatma için paketlenmiş masaüstü uygulaması gerekir.',
  'Login launch is unavailable in development. Use the packaged app.':
    'Geliştirme sürümünde oturumda başlatma kullanılamaz. Paketlenmiş uygulamayı kullan.',
  'Native fullscreen': 'Tam ekran',
  'Give your room the whole screen.': 'Bütün ekran odana kalsın.',
  'Toggle fullscreen': 'Tam ekranı değiştir',
  'Local demo storage': 'Yerel demo verileri',
  'Remove demo messages, polls and preferences from this device.':
    'Bu cihazdaki demo mesajları, anketleri ve tercihleri sil.',
  'Reset local demo': 'Yerel demoyu sıfırla',
  'macOS uses real native traffic lights. Window size is restored between launches. Signed updates and deep links are planned for the release milestone.':
    'macOS yerel pencere denetimlerini kullanır. Pencere boyutu yeniden açılışta korunur. İmzalı güncellemeler henüz kullanılamaz.',
  'Clear signals. No secrets.': 'Durum açık. Sırlar güvende.',
  'An honest view of what’s connected.': 'Bağlantılarının gerçek durumu.',
  Application: 'Uygulama',
  'Tayfa 0.1.0 / Desktop development': 'Tayfa 0.1.0 / Masaüstü geliştirme',
  Runtime: 'Çalışma ortamı',
  'Browser preview': 'Tarayıcı önizlemesi',
  Platform: 'Platform',
  Browser: 'Tarayıcı',
  'Social / gateway': 'Sosyal bağlantı',
  'Activity service': 'Etkinlik hizmeti',
  'Provider connections': 'Medya bağlantıları',
  'Microphone permission': 'Mikrofon izni',
  'Bitrate / packet loss / ping': 'Bit hızı / paket kaybı / gecikme',
  'Unavailable — no active transport': 'Kullanılamıyor — etkin bağlantı yok',
  'Data mode': 'Veri modu',
  'Local demo / no server transmission': 'Yerel demo / sunucuya veri iletilmez',
  'Private community / server connected': 'Özel topluluk / sunucu bağlantısı',
  'Export sanitized diagnostics': 'Güvenli tanılamayı dışa aktar',
  'Exports contain app and connection status only. No messages, provider tokens, device IDs, or personal paths are included.':
    'Dışa aktarma yalnızca uygulama ve bağlantı durumlarını içerir. Mesajlar, anahtarlar, aygıt kimlikleri veya kişisel dosya yolları eklenmez.',
  'Let’s check that.': 'Bir kontrol edelim.',
  'Start fresh locally?': 'Yerel veriler sıfırlansın mı?',
  'This clears local demo messages, spaces, polls, and preferences. No server data is affected.':
    'Demo mesajlar, mekânlar, anketler ve tercihler silinir. Sunucu verileri etkilenmez.',
  'Keep my demo': 'Demom kalsın',
  'Reset demo data': 'Demo verilerini sıfırla',
  'Local conversation with a demo friend.': 'Demo arkadaşla yerel sohbet.',
  'LOCAL ONLY': 'YALNIZCA YEREL',
  'Local messages': 'Demo mesajlar',
  'THE START OF SOMETHING GOOD': 'GÜZEL BİR ŞEYİN BAŞLANGICI',
  'This is your corner.': 'Burası senin köşen.',
  'Small talk. Big ideas. Plans that become memories.':
    'Gündelik sohbetler. Büyük fikirler. Anıya dönüşen planlar.',
  'Demo conversation · nothing is sent to a server.': 'Demo sohbet · sunucuya veri gönderilmez.',
  Today: 'Bugün',
  'React to message': 'Mesaja tepki ver',
  'Message actions': 'Mesaj işlemleri',
  'Edit message': 'Mesajı düzenle',
  'Attachments require Spacebar integration': 'Ekler bu sürümde desteklenmiyor',
  'Message composer': 'Mesaj yaz',
  'Message ': 'Mesaj yaz ',
  'Add a smile': 'Gülümseme ekle',
  'Send locally': 'Yerel gönder',
  'Stored on this device only': 'Yalnızca bu cihazda saklanır',
  'Enter to send': 'Enter ile gönder',
  'Shift + Enter for a new line': 'Shift + Enter ile yeni satır',
  'Edit message text': 'Mesaj metnini düzenle',
  'Message updated locally.': 'Mesaj bu cihazda güncellendi.',
  'This removes your local demo message from this device.': 'Demo mesaj bu cihazdan silinir.',
  'Local message deleted.': 'Demo mesaj silindi.',
  'AFTER HOURS / VOICE LOUNGE': 'GECE KUŞLARI / SESLİ SALON',
  'No agenda. No need to fill the silence.': 'Gündem yok. Sessizliği doldurmak zorunda değilsin.',
  'LOCAL ROOM PREVIEW': 'YEREL ODA DEMOSU',
  'Media server not configured': 'Medya sunucusu bağlı değil',
  good: 'iyi ki',
  'company.': 'beraberiz.',
  'A quiet room. A good place to start.': 'Sakin bir oda. Başlamak için güzel bir yer.',
  'You’re in the local preview': 'Yerel demodasın',
  'No microphone is being transmitted.': 'Mikrofon iletilmiyor.',
  'Leave preview': 'Demodan ayrıl',
  'A working room interface.': 'Bir oda demosu.',
  'Real voice arrives with a configured SFU.': 'Gerçek ses için özel sunucuna bağlan.',
  'Enter room preview': 'Oda demosuna gir',
  'Movie night, a poll, or a new ritual.': 'Film gecesi, bir anket veya yeni bir alışkanlık.',
  'Devices, microphone test, preferences.': 'Aygıtlar, mikrofon testi, tercihler.',
  'Screen sharing requires LiveKit integration': 'Ekran paylaşımı için gerçek ses odasına katıl',
  'Camera requires LiveKit integration': 'Kamera için gerçek ses odasına katıl',
  Activity: 'Etkinlik',
  'Preview controls change local state. No call, camera, or screen capture is active.':
    'Demo denetimleri yalnızca yerel durumu değiştirir. Arama, kamera ve ekran yakalama etkin değildir.',
  'Local roster preferences. Applied to real audio after transport integration.':
    'Demo üye ses tercihleri. Gerçek sese uygulanmaz.',
  'PREVIEW VOLUME ·': 'DEMO SESİ ·',
  'Member preview volume': 'Demo üye ses düzeyi',
  'Mute for myself (preview)': 'Benim için sustur (demo)',
  'SMALL CIRCLES. GOOD COMPANY.': 'KÜÇÜK BİR ÇEVRE. GÜZEL İNSANLAR.',
  'Your private corners of the internet.': 'İnternette size ait köşeler.',
  'New demo space': 'Yeni demo mekân',
  'INVITE ONLY / LOCAL DEMO': 'DAVETLE / YEREL DEMO',
  '3 text channels': '3 sohbet kanalı',
  'Made for the people you already know.': 'Zaten tanıdığın insanlar için.',
  'Connect Spacebar in the next milestone to turn these local spaces into a real private community.':
    'Gerçek bir özel topluluk için Stoat sunucuna bağlan.',
  'Let’s get you back in.': 'Seni geri alalım.',
  'The local view could not open. Your settings are still saved.':
    'Görünüm açılamadı. Ayarların hâlâ kayıtlı.',
  'Reload Tayfa': "Tayfa'yı yeniden yükle",
};
/** Intl tag of the interface language; fixed for the life of the page. */
export const locale = intlLocale();
/**
 * Legacy lookup keyed by English (or Turkish) source text. English returns the key itself unless
 * the catalog has the key, which is how Turkish keys in messages.tr.ts get their English.
 */
export function tr(key: string): string {
  if (startup.locale === 'en') {
    const message = lookup(key);
    return typeof message === 'string' ? message : key;
  }
  return trMessages[key] ?? activityMessages[key] ?? key;
}

export const dmFriendRequired = t('Özel mesaj için önce arkadaş olmanız gerekiyor.');
/** Server error codes and messages mapped to Turkish source text; uiError translates them. */
export const errorMessages: Record<string, string> = {
  SHARED_HOST_API_MODEL_REQUIRED:
    'Bu sunucuda yalnızca OpenRouter API bağlantısı kullanılabiliyor. Codex ve Claude CLI bağlantıları etkin değil.',
  INVALID_COMMAND:
    'Sunucudaki etkinlik servisi bu işlemi desteklemiyor. Servisin güncellenmesi gerekiyor.',
  AUTH_REQUIRED: 'Önce giriş yap.',
  SESSION_EXPIRED: 'Oturumun sona erdi. Yeniden giriş yap.',
  ROOM_ACCESS_DENIED: 'Bu odada işlem yapma iznin yok.',
  ROOM_UNAVAILABLE: 'Bu oda artık kullanılamıyor.',
  RATE_LIMITED: 'Çok fazla işlem yapıldı. Biraz bekleyip yeniden dene.',
  ACTIVITY_SERVICE_UNAVAILABLE: 'Etkinlik servisine ulaşılamıyor. Yeniden dene.',
  'The activity service is unavailable. It will reconnect automatically.':
    'Etkinlik hizmetine ulaşılamıyor. Bağlantı otomatik olarak yeniden denenecek.',
  'Invitation provisioning is not configured on this server. Ask your administrator.':
    'Bu sunucuda hesap davetleri henüz hazır değil. Sunucu yöneticine danış.',
  'Only the space owner can create account invitations.':
    'Hesap davetini yalnızca topluluk sahibi oluşturabilir.',
  'You do not have permission to invite people to this community.':
    'Bu toplulukta davet oluşturma iznin yok. Topluluk sahibinden izin iste.',
  'This Stoat release cannot enforce invitation expiry or one-time use. Ask your administrator to provide an invitation.':
    'Bu sunucuda süreli veya tek kullanımlık davet desteklenmiyor. Sunucu yöneticinden davet iste.',
  'A separate account invitation is required. Ask your administrator.':
    'Bu sunucuda davet bağlantısıyla kayıt henüz açık değil. Sunucu yöneticine danış.',
  'This invitation link has reached its limit. Ask for a new link.':
    'Bu davet bağlantısının kişi sınırı doldu. Seni davet eden kişiden yeni bir bağlantı iste.',
  'This invitation link has expired. Ask for a new link.':
    'Bu davet bağlantısının süresi doldu. Seni davet eden kişiden yeni bir bağlantı iste.',
  'This invitation link was cancelled. Ask for a new link.':
    'Bu davet bağlantısı iptal edildi. Seni davet eden kişiden yeni bir bağlantı iste.',
  'This invitation link was not found. It may have expired or been cancelled.':
    'Bu davet bağlantısı bulunamadı. Süresi dolmuş ya da iptal edilmiş olabilir.',
  'This community already has many active invitation links. Cancel one under Community management, Invitations.':
    'Bu toplulukta çok fazla etkin davet bağlantısı var. Topluluk yönetimi → Davetler bölümünden birini iptal et.',
  'Another signup is in progress. Try again in a moment.':
    'Şu anda başka bir kayıt sürüyor. Birkaç saniye sonra yeniden dene.',
  'This server does not accept sign-up requests without an invitation link.':
    'Bu sunucu davetsiz kaydı açmamış. Topluluktan bir davet bağlantısı iste.',
  'Many people are signing up right now. Try again later.':
    'Şu anda çok fazla kayıt isteği geliyor. Biraz sonra yeniden dene.',
  'Too many sign-up requests are waiting for approval. Try again later.':
    'Onay bekleyen çok fazla kayıt isteği var. Biraz sonra yeniden dene.',
  'This email address already has a sign-up request waiting.':
    'Bu e-posta adresiyle gönderilmiş, bekleyen bir kayıt isteği zaten var.',
  'This sign-up request is no longer open.': 'Bu kayıt isteği artık açık değil. Listeyi yenile.',
  'Approved sign-up is not enabled for this community.':
    'Bu topluluk için davetsiz kayıt açık değil.',
  'Create a channel in this community before approving requests.':
    'İstekleri onaylamadan önce toplulukta bir kanal oluştur.',
  'Verify your email before signing in.': 'Giriş yapmadan önce e-posta adresini doğrula.',
  'This account needs additional authentication. Complete the official Stoat sign-in flow.':
    'Bu hesap ek doğrulama istiyor. Sunucunun web uygulamasında girişini tamamla.',
  'The email or password is not correct.':
    'E-posta veya parola hatalı. Bilgilerini kontrol edip yeniden dene.',
  'Too many failed sign-in attempts. Wait a few minutes and try again.':
    'Çok fazla başarısız giriş denemesi yapıldı. Birkaç dakika bekleyip yeniden dene.',
  'This invitation is invalid or has already been used.':
    'Bu davet geçersiz ya da daha önce kullanılmış. Seni davet eden kişiden yenisini iste.',
  'The password is too short. Choose a longer one.': 'Parola çok kısa. Daha uzun bir parola seç.',
  'This password appears in known data leaks. Choose another one.':
    'Bu parola bilinen veri sızıntılarında geçiyor. Başka bir parola seç.',
  'The server could not be reached. Check your network connection and the server address.':
    'Sunucuya ulaşılamadı. Ağ bağlantısını ve sunucu adresini kontrol et.',
  'Your session expired. Sign in again.':
    'Oturumun doğrulanamadı. Hesap bilgilerini kontrol edip yeniden giriş yap.',
  'You do not have permission for this action.': 'Bu işlem için hesabının gerekli izni yok.',
  'You need to be friends before sending a private message.': dmFriendRequired,
  'Your friend request has not been accepted yet.':
    'Arkadaşlık isteğin henüz kabul edilmedi. Kabul edilince özel mesaj gönderebilirsin.',
  'This person sent you a friend request. Accept it to send a private message.':
    'Bu kişi sana arkadaşlık isteği göndermiş. Arkadaşlar → İstekler bölümünden kabul edince özel mesaj gönderebilirsin.',
  'You cannot send private messages to a blocked user.':
    'Engellenmiş biriyle özel mesajlaşamazsın.',
  'This room, message or invitation is unavailable.':
    'Bu oda, mesaj veya davet artık kullanılamıyor. Davetle geliyorsan arkadaşından yeni bir davet iste.',
  'Too many requests. Please wait and retry.':
    'Kısa sürede çok fazla işlem yapıldı. Biraz bekleyip yeniden dene.',
  'The social server is unavailable. Retry shortly.':
    'Topluluk hizmeti isteği tamamlayamadı. Daha sonra yeniden dene.',
  'This email address already has an account. Sign in with it, or use a different email address.':
    'Bu e-posta adresiyle zaten bir hesap var. O hesapla giriş yap veya farklı bir e-posta adresi kullan.',
  'Account creation could not be confirmed. Try signing in before submitting another invitation.':
    'Hesabın oluşturulup oluşturulmadığı doğrulanamadı. Yeni davet kullanmadan önce giriş yapmayı dene.',
  'The social server rejected this request. Check the supplied details.':
    'Sunucu bu bilgileri kabul etmedi. Girdiğin bilgileri kontrol edip yeniden dene.',
  'Use an HTTPS Stoat origin or /api endpoint, or HTTP loopback for development.':
    'Geçerli bir HTTPS sunucu adresi gir. Bu bilgisayardaki sunucu için HTTP kullanılabilir.',
  STOAT_REMINDERS_UNAVAILABLE:
    'Kaynak sohbete hatırlatma için sunucuda Stoat bot bağlantısı yapılandırılmalı.',
  REMINDER_TARGET_DENIED:
    'Bu kaynak mesaj için botun oda eşlemesi veya senin oda iznin doğrulanamadı.',
  SCHEDULE_IN_FUTURE_REQUIRED: 'Gelecekte, bir yıl içindeki bir zaman seç.',
  REVISION_CONFLICT:
    'Oda başka bir üye tarafından güncellendi. Son durum yüklendi; işlemini yeniden dene.',
  PRIMARY_ACTIVITY_ACTIVE: 'Odada başka bir etkinlik açık. Önce mevcut etkinliği bitirin.',
  JOIN_ACTIVITY_FIRST: 'Bu işlem için önce ortak etkinliğe katıl.',
  ACTIVITY_CONTROL_DENIED: 'Bu odada etkinliği yönetme iznin yok.',
  ACTIVITY_CREATE_DENIED: 'Bu odada etkinlik başlatma iznin yok.',
  SHARED_PLAYER_REQUIRED: 'Önce ortak Sinema veya YouTube etkinliğini başlat.',
  MEDIA_SOURCE_REQUIRED: 'Önce ortak sıradan bir medya seç.',
  TABLE_OWNER_REQUIRED: 'Bu işlemi yalnızca masa sahibi yapabilir.',
  NOT_YOUR_TURN: 'Şu anda sıra sende değil. Masa güncellendiğinde yeniden dene.',
  MORE_SEATS_REQUIRED: 'Bu oyunu başlatmak için daha fazla oyuncu veya bot gerekiyor.',
  SEAT_UNAVAILABLE: 'Bu koltuk artık uygun değil. Başka bir koltuk seç.',
  SEAT_EMPTY: 'Bu koltuk zaten boş.',
  SEAT_REMOVE_NOT_ALLOWED:
    'Yalnızca bir botun ya da masada olmayan bir oyuncunun koltuğu boşaltılabilir.',
  CHIP_CHANGE_NOT_ALLOWED:
    'Yeniden alış ancak puanın masanın alt sınırının altına düşünce yapılır.',
  TAKE_A_SEAT_FIRST: 'Önce masada boş bir koltuğa otur.',
  GAME_TABLE_REQUIRED: 'Bu masanın etkinliği sona erdi. Yeni bir masa kur.',
  HAND_FINISHED: 'Bu el tamamlandı. Masa sahibi yeni eli başlatabilir.',
  ROUND_FINISHED: 'Bu el tamamlandı. Masa sahibi yeni eli başlatabilir.',
  HAND_ALREADY_PLAYING: 'Bir el zaten devam ediyor. Tamamlanmasını bekle.',
  CHECK_UNAVAILABLE: 'Karşılanmamış bahis var. Gör, artır veya eli bırak.',
  INVALID_RAISE: 'Artırma miktarı geçersiz. Mevcut bahis ile puanın arasındaki bir miktarı seç.',
  RAISE_TOO_SMALL: 'Artırma, masanın en düşük artırma miktarından küçük olamaz.',
  BETTING_NOT_REOPENED: 'Bu turda yeniden artırma hakkın yok.',
  INVALID_VIRTUAL_BET: 'En az 2 ve puanını aşmayan çift bir sanal bahis miktarı gir.',
  DRAW_REQUIRED: 'Önce bir taş çek.',
  TILE_NOT_IN_HAND: 'Seçilen taş elinde değil. Güncel elinden yeniden seç.',
  KEEP_ONE_DISCARD_TILE: 'Elini açarken atmak için bir taş bırakmalısın.',
  PICKED_DISCARD_MUST_BE_USED:
    'Yerden aldığın taşı açarken veya işlerken kullanmalısın. Vazgeçmek için desteden taş çek.',
  DISCARD_EMPTY: 'Önceki oyuncunun alabileceğin bir taşı yok.',
  OPENING_MODE_LOCKED: 'Bu eldeki açılış türün zaten belirlendi. Aynı türle devam et.',
  OPEN_AND_SELECT_MELD_FIRST: 'İşlemek için önce elini aç ve masadan bir seri seç.',
  PAIR_CANNOT_EXTEND: 'Çift grubu uzatılamaz. İşlemek için bir seri seç.',
  INVALID_MELD_EXTENSION: 'Seçtiğin taşlar bu seriye işlenemiyor. Renk ve sırayı kontrol et.',
  EXACT_JOKER_REPLACEMENT_REQUIRED:
    'Okeyi almak için temsil ettiği renk ve sayıdaki tek taşı koymalısın.',
  WHITEBOARD_AUTHOR_REQUIRED: 'Yalnızca kendi çizimini veya notunu değiştirebilirsin.',
  WHITEBOARD_CLEAR_DENIED: 'Tahtayı yalnızca topluluk yöneticileri temizleyebilir.',
  WHITEBOARD_NOTES_FULL: 'Tahtada en fazla 60 yapışkan not olabilir. Yenisi için bir notu sil.',
  WHITEBOARD_KIND_IMMUTABLE: 'Bu öğe türü değiştirilemez.',
  POLL_CLOSED: 'Bu anket kapandı. Artık oy değiştirilemez.',
  POLL_CONTROL_DENIED: 'Anketi kapatma iznin yok.',
  ROOM_FULL: 'Bu oda dolu. Bir katılımcı ayrıldıktan sonra yeniden dene.',
  QUEUE_FULL: 'Ortak sıra dolu. Yeni içerik eklemek için bir öğeyi kaldır.',
  QUEUE_ITEM_NOT_FOUND: 'Bu öğe artık sırada değil. Güncel sıradan yeniden seç.',
  QUEUE_END: 'Sırada başka video yok.',
  QUEUE_ACTIVE_ITEM_FIXED: 'Şu an oynayan öğe kaldırılamaz veya taşınamaz.',
  MEDIA_KIND_MISMATCH: 'Bu içerik açık olan oturuma eklenemez. Önce oturumu değiştir.',
  SESSION_HOST_CONTROL:
    'Kumanda hostta. Oynatmayı host ve izin verdiği kişiler yönetiyor; sıraya öneri ekleyebilirsin.',
  SESSION_HOST_REQUIRED: 'Bunu yalnızca oturumun hostu yapabilir.',
  SESSION_PARTICIPANT_NOT_FOUND: 'Bu kişi şu an sinemada değil.',
  SESSION_HOST_TARGET_DENIED: 'Bu kişinin odada etkinlik yönetme izni yok; host yapılamaz.',
  SESSION_HOST_ALREADY: 'Bu kişi zaten oturumun hostu.',
  UNKNOWN_GAME: 'Bu oyun bu sunucuda yok. Uygulamayı güncelleyip yeniden dene.',
  SEAT_COUNT_UNSUPPORTED:
    'Bu oyun bu oyuncu sayısıyla oynanmıyor. Koltukları düzenleyip yeniden başlat.',
  GAME_OPTIONS_UNSUPPORTED: 'Seçilen masa kuralları bu oyunda kullanılamıyor.',
  INVALID_OPTIONS: 'Seçilen masa kuralları geçersiz.',
  INVALID_GAME_ACTION: 'Bu hamle bu oyunda yok. Masa güncellendiğinde yeniden dene.',
  INSURANCE_DECISION_REQUIRED: 'Krupiyenin açık kartı as. Önce sigorta alıp almayacağını seç.',
  INSURANCE_UNAVAILABLE: 'Şu anda sigorta alınamaz.',
  SURRENDER_UNAVAILABLE: 'Bu elde teslim olamazsın.',
  DOUBLE_UNAVAILABLE: 'Bu elde ikiye katlayamazsın.',
  SPLIT_UNAVAILABLE: 'Bu eli ayıramazsın.',
  PICKUP_UNDO_DISABLED:
    'Bu masada yerden aldığın taşı geri bırakamazsın. Kullan ya da at; kullanılmazsa 101 ceza yazılır.',
  GOSTERGE_NOT_ALLOWED: 'Göstergeyi yalnızca ilk sıranda, elindeki eşini göstererek açabilirsin.',
  CANNOT_SHOW_INDICATOR: 'Göstergeyi yalnızca ilk sıranda, elindeki eşini göstererek açabilirsin.',
  ILLEGAL_CARD: 'Bu kartı şimdi oynayamazsın. Kurala uyan bir kart seç.',
  CARD_NOT_IN_HAND: 'Seçilen kart elinde değil. Güncel elinden yeniden seç.',
  DISCARD_REQUIRED: 'Taşını çektin. Şimdi bir taş at.',
  STOCK_EMPTY: 'Ortada çekilecek taş kalmadı.',
  ROLL_REQUIRED: 'Önce zar at.',
  ALREADY_ROLLED: 'Zarı zaten attın. Taşlarını oyna.',
  ILLEGAL_MOVE: 'Bu hamle kurala uymuyor. Zarlara uyan bir hamle seç.',
  MOVES_REMAINING: 'Oynayabileceğin zar kaldı. Hamleni tamamla.',
  NOTHING_TO_UNDO: 'Geri alınacak hamle yok.',
  ROUND_OVER: 'Bu el bitti. Masa sahibi yeni eli başlatabilir.',
  WAIT_FOR_NEXT_HAND: 'El sürüyor. Sonraki elde oturabilirsin.',
  REQUEST_SEAT_RETURN_FIRST: 'Kontrolü geri almak için Masaya geri dön düğmesine bas.',
  'You do not have permission to manage roles.': 'Bu işlem için rol yönetme yetkin yok.',
  'You cannot change a role permission you do not have.':
    'Sahip olmadığın bir yetkiyi değiştiremez veya başka bir role veremezsin.',
  'The role change was saved, but the updated list could not be loaded. Refresh the roles before trying again.':
    'Rol değişikliği kaydedildi ama güncel liste alınamadı. Tekrar rol oluşturmadan önce listeyi yenile.',
  'Role names must contain 1 to 32 characters.': 'Rol adı 1–32 karakter olmalı.',
  'Choose a valid role color.': 'Geçerli bir rol rengi seç.',
  'This community has reached its role limit.':
    'Bu topluluktaki rol sınırına ulaşıldı. Kullanılmayan bir rolü kaldırıp yeniden dene.',
  unauthorized: 'Oturum doğrulanamadı. Bağlantı ayarlarını kontrol edip yeniden giriş yap.',
  forbidden: 'Bu işlem için hesabının gerekli izni yok.',
  'fetch failed': 'Sunucuya ulaşılamadı. Ağ bağlantısını ve sunucu adresini kontrol et.',
};
/** Keep actionable server errors readable while stripping Electron transport details. */
export function uiError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? '')).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );
  for (const [code, description] of Object.entries(errorMessages))
    if (message.includes(code)) return t(description);
  if (/^[A-Z_]{1,64}$/.test(message)) return t('İşlem tamamlanamadı. Yeniden dene.');
  return message ? tr(message) : t('İşlem tamamlanamadı. Bağlantını kontrol edip yeniden dene.');
}
