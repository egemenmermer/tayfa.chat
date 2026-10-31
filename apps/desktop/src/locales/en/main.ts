import type { Catalog } from '@rooms/i18n';

/** English for the main group. Keys are the Turkish source text exactly as written in the code. */
export const main: Catalog = {
  // Native menus and tray
  // Must match the settings group, which translates the same key as "Appearance".
  Görünüm: 'Appearance',
  'Tayfa’yı aç': 'Open Tayfa',

  // Window close dialog
  'Pencereyi kapat?': 'Close the window?',
  'Ses bağlantın sonlanacak.': 'Your voice connection will end.',
  Vazgeç: 'Cancel',
  'Pencereyi kapat': 'Close window',

  // Notifications
  'Topluluğunda biri seni etiketledi.': 'Someone mentioned you in your community.',
  'Yeni bir özel mesajın var.': 'You have a new direct message.',
  'Topluluğunda yeni bir mesaj var.': 'There’s a new message in your community.',

  // Session and account
  'Oturum değişti.': 'The session changed.',
  'Oturum değişti. Aramayı yeniden başlat.': 'The session changed. Start the search again.',
  'Oturum doğrulanamadı. Bağlantıyı yenileyip yeniden dene.':
    'Couldn’t verify the session. Refresh the connection and try again.',
  'Hesap değişti.': 'The account changed.',
  'Hesap değişti. Yeniden bağlan.': 'The account changed. Reconnect.',
  'Hesap veya terminal değişti.': 'The account or terminal changed.',
  'Ekran veya hesap değişti.': 'The screen or account changed.',
  'Oda değişti.': 'The room changed.',
  'Önce hesabına giriş yap.': 'Sign in to your account first.',
  'Önce topluluğa giriş yap.': 'Sign in to the community first.',
  'Oturumunun süresi doldu. Yeniden giriş yap.': 'Your session expired. Sign in again.',

  // Password recovery
  'Kurtarma isteği sürüyor. Tamamlanmasını bekle.':
    'A recovery request is in progress. Wait for it to finish.',
  'Sunucuda kurtarma e-postası yapılandırılmamış.': 'Recovery email isn’t set up on the server.',
  'Sunucu hCaptcha doğrulaması istiyor. Kurtarmayı Stoat web uygulamasından başlat.':
    'The server requires hCaptcha verification. Start recovery from the Stoat web app.',
  'Seçili sunucunun kurtarma bağlantısını kopyalayıp yeniden dene.':
    'Copy the selected server’s recovery link and try again.',
  'Parola kurtarma işlemi tamamlanamadı. Bağlantıyı yeniden seç.':
    'Password recovery couldn’t be completed. Choose the link again.',

  // Images and files
  'Görsel en fazla {size} MB olabilir.': 'Images can be up to {size} MB.',
  'Görsel okunamadı.': 'Couldn’t read the image.',
  'PNG, JPEG, WebP ya da GIF bir görsel seç.': 'Choose a PNG, JPEG, WebP or GIF image.',
  '2 MB’tan küçük bir PNG, JPEG ya da WebP fotoğraf seç.':
    'Choose a PNG, JPEG or WebP photo under 2 MB.',
  '10 MB’tan küçük bir PNG, JPEG ya da WebP fotoğraf seç.':
    'Choose a PNG, JPEG or WebP photo under 10 MB.',
  'PNG, JPEG ya da WebP bir fotoğraf seç.': 'Choose a PNG, JPEG or WebP photo.',
  'Fotoğraf okunamadı.': 'The photo could not be read.',
  'Fotoğrafını değiştirmeden önce yeniden giriş yap.': 'Sign in again before changing your photo.',
  'Sunucu ikonu seç': 'Choose a server icon',
  'Sunucu afişi seç': 'Choose a server banner',
  Görseller: 'Images',
  'Dosyayı kaydet': 'Save file',
  '{name} sunucunun {limit} MB sınırını aşıyor.': '{name} is over the server’s {limit} MB limit.',
  'Uzun videoları Sinema’da “Kendi dosyamla” ile birlikte izleyebilirsiniz.':
    'You can watch long videos together in Cinema with “My own file”.',

  // Screen sharing and screen control
  'Bu odada çok fazla ekran kontrolü kaydı var. Bir paylaşımı kapatıp yeniden dene.':
    'There are too many screen control registrations in this room. Stop a share and try again.',
  'Ekran kontrolü yalnızca odadaki insanlar arasında kullanılabilir.':
    'Screen control is only available between people in the room.',
  'Senin veya arkadaşının başka bir kontrol oturumu açık. Önce onu bırak.':
    'You or your friend already has another control session open. Release it first.',
  'Kontrol isteğin gönderildi. Paylaşan kişinin onayını bekle.':
    'Your control request was sent. Wait for the person sharing to approve it.',
  'Çok fazla kontrol isteği var. Biraz sonra yeniden dene.':
    'There are too many control requests. Try again in a moment.',
  'Kontrol isteği sona erdi veya ekran değişti. Yeniden kontrol iste.':
    'The control request expired or the screen changed. Request control again.',
  'Bu ekran paylaşımı değişti. Paylaşımı yenileyip tekrar kontrol iste.':
    'This screen share changed. Refresh the share and request control again.',
  'Ekran yayını henüz hazır değil. Biraz sonra yeniden dene.':
    'The screen stream isn’t ready yet. Try again in a moment.',
  'Bu odada başka biri ekran paylaşıyor.': 'Someone else is sharing their screen in this room.',
  'Oda rolün ekran paylaşma izni vermiyor.': 'Your room role doesn’t allow screen sharing.',
  'Önce bir ses odası seç.': 'Choose a voice room first.',
  'Ses odasına erişimin değişti. Üyeliğin doğrulandıktan sonra yeniden katıl.':
    'Your access to the voice room changed. Rejoin once your membership is confirmed.',
  'Sunum sahibi değişti. Odayı yenileyip yeniden dene.':
    'The presenter changed. Refresh the room and try again.',
  'Devir süresi doldu. Yeniden sunum isteği gönder.':
    'The handoff expired. Send a new presenting request.',
  'Başka bir ekran devri devam ediyor.': 'Another screen handoff is in progress.',
  'Bekleyen bir sunum talebin zaten var.': 'You already have a pending presenting request.',
  'Sunum talebi sona erdi veya artık kullanılamıyor.':
    'The presenting request expired or is no longer available.',
  'Bu talebi yalnızca mevcut sunum sahibi yanıtlayabilir.':
    'Only the current presenter can respond to this request.',
  'Yalnızca kendi sunum talebini iptal edebilirsin.':
    'You can only cancel your own presenting request.',
  'Zaten ekran paylaşıyorsun.': 'You’re already sharing your screen.',
  'Sunum istemeden önce ses odasına katıl.': 'Join the voice room before requesting to present.',
  'Bu odadaki kişileri taşıma veya sesten çıkarma yetkin yok.':
    'You don’t have permission to move people or disconnect them from voice in this room.',
  'Bu kişi artık bu odada değil.': 'This person is no longer in this room.',
  'Çok fazla sunum talebi var. Biraz sonra yeniden dene.':
    'There are too many presenting requests. Try again in a moment.',
  'Kontrol isteğinin bilgileri geçersiz.': 'The control request details are invalid.',
  'Kontrol oturumu sona erdi. Yeniden kontrol iste.':
    'The control session ended. Request control again.',
  'Kontrol işlemi tamamlanamadı.': "The control action couldn't be completed.",
  'macOS ekran kaydı izni kapalı. Sistem Ayarları → Gizlilik ve Güvenlik → Ekran ve Sistem Sesi Kaydı bölümünden Tayfa’ya izin ver; ardından uygulamayı yeniden aç.':
    'Screen recording is turned off for Tayfa on macOS. Allow Tayfa in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen the app.',
  'Ekran ve pencere listesi macOS tarafından alınamadı. Ekran kaydı iznini kontrol et; izin açıksa Tayfa’yı normal şekilde kapatıp yeniden aç.':
    'macOS couldn’t provide the list of screens and windows. Check the screen recording permission; if it’s on, quit Tayfa normally and reopen it.',

  // Remote control
  'Uzaktan kontrol Mac ve Windows sürümlerinde kullanılabilir.':
    'Remote control is available in the Mac and Windows versions.',
  'Bu sürümde yerel uzaktan kontrol modülü bulunmuyor.':
    'This version doesn’t include the local remote control module.',
  'Yerel kontrol modülü yüklenemedi. Uygulamayı yeniden başlat.':
    'The local control module couldn’t be loaded. Restart the app.',
  'Bağlantı kontrol için fazla gecikiyor. Yeniden dene.':
    'The connection is too slow for control. Try again.',
  'Uzaktan kontrol için bir pencere yerine tüm ekranını paylaş.':
    'For remote control, share your entire screen instead of a window.',
  'Kontrol vermeden önce Tayfa için Erişilebilirlik ve Giriş İzleme izinlerini açmalısın.':
    'Before you give control, turn on the Accessibility and Input Monitoring permissions for Tayfa.',
  'Yerel kontrol kullanılamıyor.': 'Local control isn’t available.',
  'Bir kontrol isteği zaten yanıtlanıyor.': 'A control request is already being answered.',
  'Kontrol isteği veya paylaşılan ekran değişti.':
    'The control request or the shared screen changed.',
  'Sistem Ayarları → Gizlilik ve Güvenlik bölümünde Tayfa için Erişilebilirlik ve Giriş İzleme izinlerini aç.':
    'Turn on the Accessibility and Input Monitoring permissions for Tayfa in System Settings → Privacy & Security.',
  'Paylaşılan ekran artık bağlı değil.': 'The shared screen is no longer connected.',
  'Tayfa penceresi kapandı.': 'The Tayfa window was closed.',
  Reddet: 'Decline',
  'Kontrol ver': 'Give control',
  'Ekran kontrolü': 'Screen control',
  '{name} paylaştığın ekranın fare ve klavyesini kontrol etmek istiyor.':
    '{name} wants to control the mouse and keyboard of the screen you’re sharing.',
  '{screen} · Yalnızca bu paylaşım. Kendi fare/klavyenle işlem yapman kontrolü geri alır. Acil bırakma: Control + Alt/Option + Shift + K. Dosya ve pano aktarımı yok.':
    '{screen} · This share only. Using your own mouse or keyboard takes control back. Emergency release: Control + Alt/Option + Shift + K. No file or clipboard transfer.',
  'Seçilen ekran': 'Selected screen',
  'Acil bırakma kısayolu kullanılamıyor; kontrol açılmadı.':
    'The emergency release shortcut isn’t available, so control wasn’t turned on.',
  'Kontrol onayı artık geçerli değil.': 'The control approval is no longer valid.',
  'Yerel kontrol başlatılamadı. Sistem izinlerini ve seçilen ekranı kontrol et.':
    'Local control couldn’t start. Check the system permissions and the selected screen.',

  // Community sounds and entrance sounds
  'Sunucunun topluluk sesleri henüz yapılandırılmadı.':
    'The server’s community sounds aren’t set up yet.',
  'Bu odada ses ekleme iznin yok.': 'You don’t have permission to add sounds in this room.',
  'Yalnızca kendi sesini kaldırabilirsin.': 'You can only remove your own sound.',
  'Toplulukta en fazla 32 ses saklanabilir.': 'A community can keep up to 32 sounds.',
  'Bu ses kaldırılmış.': 'This sound was removed.',
  'En fazla 8 saniyelik mono veya stereo ses seç.':
    'Choose a mono or stereo sound of up to 8 seconds.',
  'Sunucu henüz güncel değil; sesi düzenlemek için sunucunun güncellenmesi gerekir.':
    'The server is not up to date yet; it has to be updated before sounds can be edited.',
  'Topluluk sesleri alınamadı. Yeniden dene.': 'Couldn’t load community sounds. Try again.',
  'Ses dosyası alınamadı.': 'Couldn’t get the sound file.',
  'Ses dosyası çok büyük.': 'The sound file is too large.',
  'Bu sunucuda giriş sesleri henüz açılmadı.':
    'Entrance sounds aren’t turned on for this server yet.',
  'Sunucu yöneticisi ses yüklemeyi kapattı. Tayfa seslerinden birini seçebilirsin.':
    'The server admin turned off sound uploads. You can choose one of the Tayfa sounds.',
  'Ses dosyası okunamadı. En fazla 4 saniyelik bir kesit seç.':
    'Couldn’t read the sound file. Choose a clip of up to 4 seconds.',
  'Seçtiğin kesit neredeyse sessiz. Başka bir bölüm seç.':
    'The section you chose is almost silent. Choose another part.',
  'En fazla {count} ses saklayabilirsin. Önce birini sil.':
    'You can keep up to {count} sounds. Delete one first.',
  'Sunucudaki ses alanı doldu. Yöneticiye haber ver.':
    'The server’s sound storage is full. Let an admin know.',
  'Bu ses artık yok.': 'This sound no longer exists.',
  'Giriş sesleri alınamadı. Yeniden dene.': 'Couldn’t load entrance sounds. Try again.',
  'Ses kaydedilemedi. Yeniden dene.': 'Couldn’t save the sound. Try again.',
  'Seçimin kaydedilemedi. Yeniden dene.': 'Couldn’t save your choice. Try again.',
  'Ses silinemedi. Yeniden dene.': 'Couldn’t delete the sound. Try again.',

  // DJ, music and playlists
  'Spotify listesi okunamadı. Listenin herkese açık olduğundan emin olup yeniden dene.':
    "Couldn't read the Spotify playlist. Make sure it's public and try again.",
  'Spotify listesinin herkese açık görünümünde şarkı bulunamadı. Özel veya boş bir liste olabilir.':
    'No songs were found in the public view of the Spotify playlist. It may be private or empty.',
  'Spotify bu listenin tamamını göstermeyebilir. Eksik aktarmamak için 100 parçadan az bir liste kullan.':
    'Spotify may not show this whole playlist. To avoid a partial import, use a playlist with fewer than 100 tracks.',
  'Spotify listesindeki bazı kayıtların şarkı bilgisi okunamadı. Liste eklenmedi; yerel dosya veya podcast içermeyen bir liste dene.':
    "Some tracks in the Spotify playlist had unreadable song info. The playlist wasn't added; try one without local files or podcasts.",
  'Kuyruk değişti. Güncel sırayla yeniden dene.':
    'The queue changed. Try again with the current order.',
  'Geçmiş liste bulunamadı.': 'The previous playlist wasn’t found.',
  'DJ geçmişi kaydedilemedi. Müzik bağlantısı korunuyor.':
    'Couldn’t save the DJ history. The music connection is still active.',
  'Arama meşgul. Biraz sonra yeniden dene.': 'Search is busy. Try again in a moment.',
  'Arama şu anda kullanılamıyor. Yeniden dene.': 'Search isn’t available right now. Try again.',
  'Bu parçanın süresi doğrulanmadı veya seçilen konum geçersiz.':
    'This track’s length couldn’t be verified, or the chosen position is invalid.',
  'Sunucunun YouTube ses erişimi doğrulanamadı. DJ şu anda bu kaynaktan çalamıyor.':
    'The server’s YouTube audio access couldn’t be verified. The DJ can’t play from this source right now.',
  'YouTube parçası şu anda alınamıyor. Yeniden dene.':
    'The YouTube track can’t be fetched right now. Try again.',
  'Parça yüklenmesi zaman aşımına uğradı. Yeniden dene.': 'Loading the track timed out. Try again.',
  'Müzik botu sunucuda yapılandırılmadı.': 'The music bot isn’t set up on the server.',
  'Geçerli bir YouTube, Spotify, SoundCloud veya ses bağlantısı gir.':
    'Enter a valid YouTube, Spotify, SoundCloud or audio link.',
  'Şarkı bilgisi alınamadı. Herkese açık tek şarkı bağlantısını yeniden dene.':
    'Couldn’t get the song info. Try the public single-song link again.',
  'Spotify şarkısı veya herkese açık çalma listesi; SoundCloud için tek şarkı bağlantısı gir. Albümler desteklenmiyor.':
    'Enter a Spotify song or public playlist; for SoundCloud, a single-song link. Albums aren’t supported.',
  'Spotify/SoundCloud parçasıyla aynı sanatçı ve sürede bir YouTube kaydı bulunamadı. Şarkı adını arayıp uygun sonucu seçebilirsin.':
    'No YouTube recording by the same artist and length as the Spotify/SoundCloud track was found. You can search for the song name and pick a fitting result.',
  'Spotify/SoundCloud şarkısı “{title}” ({artists}) için aynı sanatçı ve sürede bir YouTube kaydı bulunamadı. Şarkı adını arayıp uygun sonucu seçebilirsin.':
    'No YouTube recording by the same artist and length was found for the Spotify/SoundCloud song “{title}” ({artists}). You can search for the song name and pick a fitting result.',
  'Önce ses odasına katıl.': 'Join a voice room first.',
  'Bu odada müzik kontrol yetkin yok.': 'You don’t have permission to control music in this room.',
  'Kuyruk dolu. En fazla 100 parça eklenebilir.':
    'The queue is full. You can add up to 100 tracks.',
  'Müzik dosyaları toplam boyut sınırını aştı.': 'The music files exceeded the total size limit.',
  'Müzik botu ses odasına bağlanamadı.': 'The music bot couldn’t connect to the voice room.',
  'Çalan parçayı kaldırmadan önce başka parçaya geç.':
    'Skip to another track before removing the one that’s playing.',
  'DJ sunucusu yanıt vermedi. Biraz sonra yeniden dene.':
    'The DJ server didn’t respond. Try again in a moment.',
  'Liste başka biri tarafından değiştirildi. Yenileyip tekrar dene.':
    'Someone else changed the playlist. Refresh and try again.',
  'Kaydedilebilecek parça yok.': 'There are no tracks to save.',
  'Ortak listeler sunucuda henüz açılmadı.':
    'Shared playlists aren’t turned on for the server yet.',
  'Sunucunun DJ hizmeti henüz açılmadı.': 'The server’s DJ service isn’t turned on yet.',
  'Topluluğun liste sınırına ulaşıldı. Kullanılmayan listeleri veya parçaları kaldır.':
    'The community has reached its playlist limit. Remove unused playlists or tracks.',
  'Liste bilgisi geçersiz. Desteklenen YouTube/Spotify bağlantılarını ve parça sınırını kontrol et.':
    'The playlist details are invalid. Check the supported YouTube/Spotify links and the track limit.',
  'Çalma listesi veya DJ geçmişi alınamadı. Kaynak erişimini kontrol edip yeniden dene.':
    'Couldn’t get the playlist or DJ history. Check access to the source and try again.',
  'Liste işleminin sonucu doğrulanamadı. Yenileyip kaydı kontrol et; değişiklik otomatik tekrarlanmadı.':
    'The result of the playlist action couldn’t be verified. Refresh and check the record; the change wasn’t retried automatically.',
  'Şarkı sözleri yükleniyor. Biraz sonra yeniden dene.':
    'Lyrics are loading. Try again in a moment.',
  'Çalan parça değişti.': 'The playing track changed.',
  'Çalan parça bulunamadı.': 'The playing track wasn’t found.',
  'DJ geçmişi alınamadı.': 'Couldn’t get the DJ history.',
  'Arama isteği tamamlanamadı.': 'The search request couldn’t be completed.',

  // GIF search
  'GIF araması için sunucuya KLIPY anahtarı eklenmeli.':
    'A KLIPY key must be added to the server for GIF search.',
  'Bu sunucu GIF aramasını henüz desteklemiyor.': 'This server doesn’t support GIF search yet.',
  'Çok fazla GIF araması yapıldı. Biraz bekleyip yeniden dene.':
    'There have been too many GIF searches. Wait a moment and try again.',
  'GIF servisine şu an ulaşılamıyor. Biraz sonra yeniden dene.':
    'The GIF service isn’t reachable right now. Try again in a moment.',
  'Sunucu bu işlemi henüz desteklemiyor.': 'The server doesn’t support this action yet.',

  // Direct message calls
  'Bu kişi başka bir aramada. Daha sonra tekrar dene.':
    'This person is on another call. Try again later.',
  'Özel arama için önce arkadaş olmalısınız.': 'You need to be friends first to start a call.',
  'Bu özel görüşmeye erişimin yok.': 'You don’t have access to this conversation.',
  'Arama sona erdi.': 'The call ended.',
  'Arama henüz kabul edilmedi.': 'The call hasn’t been accepted yet.',
  'Bu sunucuda özel arama servisi etkin değil.': 'Direct calls aren’t turned on for this server.',
  'Arama sunucusu geçersiz yanıt verdi.': 'The call server sent an invalid response.',
  'Arama sunucusuna ulaşılamıyor. Yeniden dene.': 'Can’t reach the call server. Try again.',
  'Arama isteği reddedildi.': 'The call request was declined.',
  'Arama medya izni geçersiz.': 'The call media grant is invalid.',

  // Host operations and terminals
  'Alanları kontrol et. Girilen değerlerden biri geçerli değil.':
    'Check the fields. One of the values you entered isn’t valid.',
  'Bu sunucu işlemi için yetkin yok.': 'You don’t have permission for this server action.',
  'Bu işlemi yalnızca topluluk sahibi yapabilir.': 'Only the community owner can do this.',
  'Sunucu yönetimine ulaşılamıyor. Yeniden dene.': 'Can’t reach server management. Try again.',
  'Bu sunucuda terminal henüz kurulmadı.': 'Terminal isn’t set up on this server yet.',
  'Terminal kullanıcı profili henüz yapılandırılmadı.':
    'The terminal user profile isn’t set up yet.',
  'Bu Linux profili başka bir operatöre ait. Ayrı bir profil gerekiyor.':
    'This Linux profile belongs to another operator. A separate profile is needed.',
  'En fazla üç terminal açabilirsin. Önce bir oturumu sonlandır.':
    'You can open up to three terminals. End a session first.',
  'Bu terminale erişimin yok.': 'You don’t have access to this terminal.',
  'Terminali başka bir operatör kullanıyor.': 'Another operator is using the terminal.',
  'Bu işlemi terminalin sahibi yapabilir.': 'Only the terminal’s owner can do this.',
  'Sunucu yönetimi için güvenli bağlantı gerekiyor.':
    'A secure connection is required for server management.',
  'Sunucu yanıtı çok büyük.': 'The server response is too large.',
  'Sunucu yönetimi bu toplulukta henüz yapılandırılmadı.':
    'Server management isn’t set up in this community yet.',
  'Sunucu işlemi tamamlanamadı. Yetkini ve bağlantını kontrol et.':
    'The server action couldn’t be completed. Check your permissions and connection.',
  'İşlem doğrulanamadı. Alanları ve sunucu sürümünü kontrol et.':
    'The action couldn’t be verified. Check the fields and the server version.',
  'Terminal için güvenli bağlantı gerekiyor.': 'A secure connection is required for the terminal.',
  'Terminal yanıtı doğrulanamadı.': 'The terminal response couldn’t be verified.',
  'Terminal bağlantısı kapandı. Yetkin varsa yeniden bağlanabilirsin.':
    'The terminal connection closed. If you have permission, you can reconnect.',
  'Terminal bağlantısı kurulamadı. Oturumun korunuyor.':
    'Couldn’t connect to the terminal. Your session is still preserved.',
  'Terminal bağlantısı kurulamadı.': 'Couldn’t connect to the terminal.',
  'Terminal bağlantısı kapandı.': 'The terminal connection closed.',
  'Terminal bağlı değil.': 'The terminal isn’t connected.',
  'Terminal bağlantısı yoğun. Biraz bekle.': 'The terminal connection is busy. Wait a moment.',

  // Agent workspace terminal
  'Çalışma terminali bağlı değil.': 'The workspace terminal isn’t connected.',
  'Çalışma terminali erişimi doğrulanamadı.': 'Workspace terminal access couldn’t be verified.',
  'Güvenli Agent bağlantısı gerekli.': 'A secure Agent connection is required.',
  'Çalışma terminaline bağlanılamadı. Yeniden dene.':
    'Couldn’t connect to the workspace terminal. Try again.',
  'Çalışma terminali bağlantısı kesildi.': 'The workspace terminal connection was lost.',
  'Çalışma terminaline bağlanılamadı.': 'Couldn’t connect to the workspace terminal.',
  'Çalışma terminali bağlantısı kapandı.': 'The workspace terminal connection closed.',

  // Personal media (VLC)
  'VLC motoru bu kurulumda bulunmuyor.': 'The VLC engine isn’t included in this installation.',
  'Oynatma oturumu değişti. Kaynağı yeniden aç.':
    'The playback session changed. Reopen the source.',
  'Oynatma hedefi değişti.': 'The playback target changed.',
  'Oynatıcı penceresi kapandı.': 'The player window was closed.',
  'VLC yayını başlatamadı. Kaynak bağlantısını kontrol edip yeniden dene.':
    "VLC couldn't start the stream. Check the source link and try again.",
  // Application menu (main.ts).
  Görüntü: 'View',
  'Bu istek için onaylı kayıt bağlantısı yok.':
    'There’s no approved sign-up link for this request.',
  'Hesabın oluştu ama oturum açılamadı. {email} ile giriş yap.':
    'Your account was created, but the session couldn’t start. Sign in with {email}.',
  'Bu odanın listelerine erişimin yok ya da listeleri değiştirmek için odada konuşma iznin yok.':
    'You don’t have access to this room’s playlists, or you don’t have permission to speak in the room, which changing them needs.',
  'Özel bir arama geliyor.': 'A private call is coming in.',
  'Tayfa · Sunucu uyarısı': 'Tayfa · Server alert',
  '{count} uyarı daha. Ayrıntılar için Sunucu makinesi sayfasını aç.': {
    one: '{count} more alert. Open the Host machine page for details.',
    other: '{count} more alerts. Open the Host machine page for details.',
  },

  // In-app updates (reasons and errors from the update service)
  'İmzalı güncellemeler, doğrulanmış imzalı bir sürüm ve HTTPS güncelleme adresi ister.':
    'Signed updates need a verified signed release and an HTTPS update address.',
  'Uygulama içi güncellemeler macOS ve Windows sürümlerinde var; burada yeni sürümü elle kur.':
    'In-app updates are available on macOS and Windows; install new versions by hand here.',
  'Geliştirme sürümü güncellenmez; güncellemeler yalnızca kurulu uygulamada çalışır.':
    'Development builds don’t update; updates only work in the installed app.',
  'Bu Windows paketi güncelleme adresi olmadan derlendi; yeni sürümü GitHub sürümler sayfasından elle kur.':
    'This Windows package was built without an update address; install new versions by hand from the GitHub releases page.',
  'Kurulum yapılmadan açılan uygulama kendini güncelleyemez; Tayfa’yı Windows kurulum dosyasıyla kur.':
    'An app opened without installing can’t update itself; install Tayfa with the Windows installer.',
  'Güncelleme indirilemedi veya SHA-512 özeti tutmadı. Mevcut sürüm kurulu kalır; sonra yeniden dene.':
    'The update couldn’t be downloaded or its SHA-512 didn’t match. Your current version stays installed; try again later.',
  'Önce otomatik güncellemeleri etkinleştir.': 'Enable automatic updates first.',
  'İndirilecek güncelleme yok. Önce güncellemeleri kontrol et.':
    'There’s no update to download. Check for updates first.',
  'İndirmeden önce güncellemeleri yeniden kontrol et.':
    'Check for updates again before downloading.',
  'Süren bir güncelleme indirmesi yok.': 'No update download is in progress.',
  'Önce güncellemenin inip doğrulanması gerekiyor.':
    'The update has to finish downloading and verifying first.',
};
