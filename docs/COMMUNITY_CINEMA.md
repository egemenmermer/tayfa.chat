# Topluluk Sineması

[← README](../README.md) · [Mimari](ARCHITECTURE.md) · [Etkinlik protokolü](ACTIVITY_PROTOCOL.md) · [Sunucu kurulumu](SELF_HOSTING.md)

Sinema, sol menüde kalıcı duran ortak izleme salonudur. Topluluk sahibi sunucunun IPTV hesabını bir kez bağlar. Hesap kaldırılana kadar salon kanalını görebilen herkes canlı kanalları, yayın akışını, filmleri ve dizileri gezer ve birlikte açar. Aynı salonda YouTube bağlantıları ve ekran paylaşımı da açılır.

Sahip ayrıca bir Stremio hesabı bağlayabilir; salon o hesabın eklentilerinin (ör. Real-Debrid ile Torrentio) bulduğu kaynakları da oynatır. IPTV bağlı olmasa da çalışır ([Stremio](#stremio)).

Kişisel medya (Medyam) bundan ayrıdır ve özel kalır. Sinema'daki yeniden yayın yalnızca sahibin bağladığı IPTV ve Stremio hesapları içindir ([geliştirme kuralları](../AGENTS.md)).

## İçindekiler

- [Akış](#akış)
- [Güvenlik sınırları](#güvenlik-sınırları)
- [Aktarım](#aktarım)
- [Altyazılar](#altyazılar)
- [Etkinlik protokolü](#etkinlik-protokolü)
- [Filmler, diziler ve canlı TV](#filmler-diziler-ve-canlı-tv)
- [Stremio](#stremio)
- [RMDB (arayüzde Tayfa)](#rmdb)
- [Kurulum](#kurulum)
- [Doğrulama](#doğrulama)

## Akış

1. **Salon ve hesap.** Sahip, Sunucu ayarları → Sinema bölümünden bir salon kanalı seçer. Ardından Xtream bilgilerini (sunucu, kullanıcı adı, şifre) veya M3U adresini girer; isteğe bağlı bir XMLTV adresi de eklenebilir. `get.php?username=…` biçimindeki M3U dışa aktarma bağlantısı Xtream hesabı olarak tanınır.
2. **Doğrulama ve içe aktarma.** Servis hesabı sağlayıcıda doğrular. Sonra kanal, film ve dizileri içe aktarır, ardından rehberi akış hâlinde okur.
   - Rehber penceresi şu andan 6 saat öncesi ile 48 saat sonrası arasıdır; en fazla 300 bin program tutulur.
   - Rehber 12 saatte, katalog 24 saatte bir kendiliğinden yenilenir.
3. **Gezinme.** Salonu görebilen üyeler kategorileri, Türkçe duyarlı aramayı, rehberi ve detayları servisten okur.
   - Dizi bölümleri ve film ayrıntıları ilk açılışta sağlayıcıdan alınır ve saklanır.
   - Görseller servis üzerinden gelir; üyeler sağlayıcıya hiç bağlanmaz.
4. **Birlikte izleme.** Bir üye bir öğeyi açtığında salon etkinliğinin sırasına `community-media` öğesi eklenir. Herkesin istemcisi servisten aynı aktarımı ister.
   - Salon sayfasından ayrılınca (ör. bir ses odasına girince) oynayan şey köşedeki küçük oynatıcıda sürer ve koltuk korunur. Küçük oynatıcıyı kapatınca koltuk bırakılır; salon sayfası açılınca ekranı geri alır.
   - Sahnede ←/→ filmi veya bölümü herkes için 10 saniye sarar. Art arda basışlar ekranda toplanır ve tek komut olarak gider. Kumanda ev sahibindeyse ekran bunu söyler; canlı yayın sarılamaz.

## Güvenlik sınırları

- **Sağlayıcı bilgileri.**
  - Hesap bilgileri ve katalog anlık görüntüsü sunucuda AES-256-GCM ile şifreli tutulur. Dosyalar 0600, dizinler 0700 izinlidir; katalog önce sıkıştırılır.
  - M3U kayıt adresleri de anahtar taşıyabileceği için şifreli anlık görüntünün içindedir.
  - Anahtar `ROOMS_CINEMA_STORAGE_KEY` değişkenindedir. Anahtarı değiştirmek kayıtlı hesabı okunamaz yapar.
- **Kimin ne yapabildiği.**
  - Salon seçme, hesap bağlama, yeniden yükleme ve kaldırma yalnızca topluluk sahibine ve yöneticilerine (bütün izinleri veren rol, [Mimari](ARCHITECTURE.md)) açıktır.
  - Katalog, arama, rehber, detay, görsel ve izleme için salon kanalında görüntüleme izni (VIEW_CHANNEL) gerekir.
  - YouTube sekmesindeki metin araması (`POST /rooms-access/v1/halls/:kanal/youtube-search`) DJ'in yt-dlp aramasını kullanır; DJ yetkisi gerekmez, salon kanalında görüntüleme ve bağlanma izni yeter (üye başına dakikada 20). Seçilen sonuç yapıştırılan bağlantı gibi açılır: kumandası olmayan üye yalnızca sıraya önerir. Eski bir Access sunucusunda uç yoktur; arayüz bunu söyler, bağlantı yapıştırmak çalışmaya devam eder.
  - Sahip olmayan üyeler maskeli sunucu adını bile görmez.
- **İstemciye giden veri.**
  - İstemci yalnızca opak öğe kimliklerini (`l-…`, `m-…`, `s-…`, `e-…`, Stremio için `x-…`) ve opak görsel kimliklerini görür.
  - Etkinlik şeması URL, kullanıcı adı ve şifre taşıyan alanları reddeder.
- **Aktarımı yönlendirme.** Servis yalnızca salon etkinliğinde **seçili olan** öğeyi aktarır. Sunucunun tek sağlayıcı bağlantısını başka bir kanala çevirmek için salonun kumandası gerekir; kumandası olmayan kişi yalnızca sıraya öneri ekleyebilir.
- **Masaüstü tarafı.**
  - Stoat belirteci ve aktarım biletleri Electron ana sürecinde kalır.
  - Görünüm `rooms-cinema://stream/<oturum>/…` ve `rooms-cinema://art/<salon>/<kimlik>` adreslerini kullanır.
  - Biletler 120 saniyeliktir. Ana süreç süreyi kendi saatiyle sayar ve bitmeden `POST /v1/halls/:hall/sessions/:session/ticket` ile yeniler; bu uç röleyi asla başlatmaz veya yeniden başlatmaz. Salon başka bir öğeye geçtiyse veya hesap değiştiyse 410 (`CINEMA_SESSION_ENDED`) döner, oynatıcı yeniden bağlanır.
  - Stoat yetki yanıtları 20 saniye önbelleğe alınır (yalnızca başarılı olanlar); afiş ve rehber gezintisi üyenin Stoat hız sınırını tüketmez.
- **Kayıtlar.** Hiçbir log satırında sağlayıcı adresi veya kimlik bilgisi yer almaz; Kanal'dan taşınan maskeleme kullanılır.

## Aktarım

Sunucu 2 vCPU / 3,7 GB RAM'dir, bu yüzden video **dönüştürülmez**.

- **Kod çözücüler.** Önce `ffprobe` çalışır.
  - H.264 ve HEVC görüntü kopyalanır (`-c:v copy`).
  - Ses AAC stereoya çevrilir; bu, AC-3/E-AC-3 kanallarının Chromium'da sessiz kalmasını önler.
  - MPEG-2 gibi diğer görüntü kodekleri `CINEMA_CODEC_UNSUPPORTED` ile açıkça reddedilir.
- **Çıktı.** fMP4 segmentli HLS üretilir ve tmpfs'te tutulur.
  - Canlı yayında 8 segmentlik kayan pencere kullanılır. İstemciler rölenin canlı kenarının 3 segment (yaklaşık 6 saniye) gerisine hizalanır (hls.js `liveSyncPosition`). Herkes aynı listeyi okuduğu için izleyiciler en fazla yaklaşık bir segment farkla aynı anı görür ve hedef hiçbir zaman pencerenin dışına düşmez. Duvar saati kullanılmaz: canlı kaynak hız sınırı olmadan okunduğu için sağlayıcının bağlantı başındaki veri yığını PDT'yi gerçek saatin önüne geçirir; eski saat hedefi pencerenin dışında kalıp oynatıcıyı döngüye sokuyordu.
  - Film ve dizide okuma hızı sınırlanır ve yaklaşık 60 saniyelik pencere tutulur (`ROOMS_CINEMA_VOD_WINDOW_SEC`). Sarma işlemi aktarımı yeni konumdan yeniden başlatır.
  - Her liste `EXT-X-PROGRAM-DATE-TIME` taşır ve servis çıktı zamanı 0'ın PDT'sini (`originPdtMs`) bildirir; oynatıcılar eserdeki konumu `offsetSec + (oynatılan tarih − originPdtMs)` olarak hesaplar.
  - Röle salonun konumunun gerisinde kalabilir (servis 30 saniyeye kadar geride olanı yeniden kullanır, yavaş sağlayıcı daha da geri düşer). O zaman oynatıcı rölenin kenarını kovalamaz: bir kez kenarın 3 saniye gerisine atlar ve röle doldukça oynar. Eskiden her iki saniyede bir kenara geri sarıyordu.
  - İmaj, rölenin test edildiği sürümü kullanır: `mwader/static-ffmpeg:9.0.2` (Debian'ın ffmpeg 5.1'i gereken bayrakları tanımaz).
- **ffmpeg'in ağ erişimi.**
  - ffmpeg sağlayıcı adresini hiç görmez. Servis içindeki loopback vekil her adımı özel ağ engeli, sabitlenmiş DNS ve en fazla 4 yönlendirme ile `privateFetch` üzerinden yapar.
  - HLS listeleri yeniden yazılır. Böylece ffmpeg iç servislere ulaşamaz ve kimlik bilgisi süreç argümanlarında görünmez.
- **Okuma hızı.** Altyazısız filmler ffmpeg'in `-readrate 1` ayarıyla okunur. Altyazılı filmlerde bu ayar kullanılmaz; ayrıntısı [Altyazılar](#altyazılar) bölümündedir.
- **Bağlantı bütçesi.**
  - Aynı anda çalışan aktarım sayısı en fazla hesabın `max_connections` değeri ve `ROOMS_CINEMA_MAX_RELAYS` (varsayılan 1) kadardır. Bütçe doluysa en uzun süredir izlenmeyen aktarım kapanır.
  - 60 saniye izleyicisi olmayan aktarım durur.

## Altyazılar

Film ve dizi bölümlerinde altyazının üç kaynağı vardır: dosyanın kendi gömülü metin altyazıları (SubRip, ASS/SSA, mov_text, WebVTT), SubDL'de bulunanlar ve izleyicinin kendi dosyası. Altyazıyı her izleyici kendisi seçer; seçim başkasının ekranını değiştirmez.

### Gömülü altyazılar

- **Çıkarma.** Röle, aynı ffmpeg sürecinde her metin altyazısını ayrı bir WebVTT dosyasına (`sub<n>.vtt`) yazar. Sağlayıcıya ikinci bir bağlantı açılmaz. En fazla 16 iz aktarılır.
- **Desteklenmeyenler.** Görüntü tabanlı altyazılar (PGS, DVD, DVB) OCR gerektirdiği için aktarılmaz. Canlı kanallarda altyazı yoktur.
- **Zamanlama.** ffmpeg altyazıyı sarma noktasından (`startSec`) itibaren zamanlar. Servis cue'ları eserin kendi zamanına çevirerek sunar. Oynatıcı bunları salonun ortak konumuyla (`offsetSec` ve PROGRAM-DATE-TIME) eşleştirir. Hâlâ yazılan son cue sunulmaz.
- **Okuma hızı.** ffmpeg'in `-readrate` ayarı en yavaş akışı izler. Seyrek bir altyazı akışı neredeyse her zaman en yavaşıdır. Bu yüzden ffmpeg cue'lar arasında sınırsız okur, sonraki cue'da ise dakikalarca bekler. Altyazılı filmlerde okuma hızını loopback vekil belirler:
  - HLS çıktısı, ffmpeg başladığından beri geçen süreyi en fazla 15 saniye önde tutar.
  - İlk segmentten sonra baytlar, kaynağın ortalama bit hızının en fazla 1,5 katıyla geçer (2 saniyelik kova). Bu sınır olmasa vekil beklerken biriken veri ffmpeg'e loopback hızında akardı.

### Çevrimiçi altyazılar (SubDL)

- **Anahtar.** Topluluk sahibi Sunucu ayarları → Sinema → Altyazılar bölümüne kendi ücretsiz SubDL API anahtarını girer. Servis anahtarı bir aramayla doğrular ve IPTV bilgileri gibi şifreli yapılandırmada saklar. Anahtar hiçbir yanıtta ve günlükte yer almaz; üyeler yalnızca aramanın açık olup olmadığını görür.
- **Arama.** Servis, filmi veya bölümü TMDB kimliğiyle arar. Xtream satırlarında kimlik yoksa filmin `get_vod_info` yanıtına bir kez bakılır. Kimlik bulunamazsa ad ve yıl kullanılır. Türkçe ve İngilizce altyazılardan en fazla beşer tanesi listelenir; sonuç 12 saat önbellekte tutulur.
- **İndirme.** İzleyici bir altyazı seçtiğinde servis yalnızca o öğenin son aramasındaki kimliği indirir. Zip'ten SubRip, ASS/SSA veya WebVTT dosyasını alır; sezon paketlerinde istenen bölümü seçer. UTF-8 olmayan dosyalar Windows-1254 kabul edilir. Sonuç WebVTT'ye çevrilir ve yaklaşık 16 MB'lık bellek önbelleğinde tutulur. Masaüstü dosyayı `rooms-cinema://subtitle/<salon>/<öğe>/<kimlik>` adresinden, üyenin Stoat belirteci ana süreçte kalarak alır.
- **Neden SubDL?** OpenSubtitles'ın entegratör şartları (13 Ekim 2026) indirilen bir altyazının sunucuda tutulup diğer kullanıcılara sunulmasını yasaklıyor ve hesapsız indirme için ücretli plan istiyor. SubDL ise kullanıcının kendi anahtarını uygulamaya girmesine izin veriyor.

### Kendi dosyası ve zamanlama

- **Dosya.** "Dosyadan yükle…" ile izleyici kendi SRT, VTT veya ASS dosyasını (en fazla 2 MB) seçer. Ana süreç dosyayı okuyup WebVTT'ye çevirir; görünüme yalnızca metin geçer, dosya yolu geçmez. Dosya yalnızca o izleyicide görünür.
- **Zamanlama.** Menüdeki zamanlama satırı altyazıyı yarım saniyelik adımlarla erkene alır veya geciktirir. Bu, farklı bir sürüm için hazırlanmış altyazıları hizalamak içindir ve yalnızca izleyicinin kendisini etkiler.

### Arayüz

- Kontrol çubuğundaki altyazı menüsünde "Kapalı", filmin kendi altyazıları, SubDL'den gelenler, yüklenen dosya, "Dosyadan yükle…" ve zamanlama yer alır. Arama sürerken, anahtar yokken veya altyazı alınamadığında menü bunu açıkça yazar.
- Salon başka bir dil duyuyorsa Türkçe altyazı kendiliğinden açılır: önce filmin kendi Türkçe izi, yoksa SubDL'deki ilk Türkçe altyazı. Türkçe seste yalnız zorunlu Türkçe altyazı açılır. Altyazıyı kapatan izleyiciye bir daha kendiliğinden açılmaz.

## Etkinlik protokolü

Salon, `hall` adlı ana etkinliktir; `roomId` salon kanalının kimliğidir. Sıra `community-media` (`ref`, `title`, `live`, isteğe bağlı `art`) ve `youtube` öğelerini kabul eder.

- Katalog öğeleri herkes için hemen başlar; kaynak ortak olduğu için kişisel dosyadaki hazırlık adımı yoktur.
- Canlı kanalların ortak zaman çizelgesi yoktur. `playback` komutları `LIVE_PLAYBACK_FIXED` ile reddedilir; duraklatma yalnızca izleyicinin kendisinde olur.
- Filmler ve bölümler ortak zaman çizelgesiyle oynar, sarılır ve duraklatılır.
- Ev sahibi, kumanda modu ve devir kuralları [etkinlik protokolündeki](ACTIVITY_PROTOCOL.md) gibidir.

## Filmler, diziler ve canlı TV

- **Devam et.** Filmler ve Diziler'in en üstündeki satır `GET /v1/halls/:salon/continue?kind=` ile gelir. Satırda salonun yarım bıraktığı filmler ve bölümler, bölümü biten dizinin sıradaki bölümü ve henüz çıkmamış bölümün yayın tarihi (`Yakında · 08.12.2026`, 60 günden azsa `49g`) yer alır. Başlıklar platform ve kalite eklerinden arındırılır (`packages/community-cinema/src/titles.ts`). "Listeden kaldır" yalnızca o izleyicide geçerlidir ve salon yapımı yeniden izleyince kart geri gelir.
- **Yayın tarihleri.** Sağlayıcı bölümün tarihini (`releasedate`/`air_date`) verirse o kullanılır. Vermezse ve sahip Sinema ayarlarına TMDB anahtarı girdiyse tarih TMDB'deki `next_episode_to_air` alanından alınır. Anahtar SubDL anahtarı gibi şifreli saklanır, hiçbir yanıta girmez.
- **Sonraki bölüm.** Bölümün son dakikasında (uzun bölümde son %4'ünde) kumandası olan kişiye "Sonraki bölüm" düğmesi çıkar. Sıra boşsa bölüm bitince sonraki bölüm kendiliğinden açılır. Kuyruk kimliği biten öğeden türetilir (`next-<öğe>`), bu yüzden iki izleyici aynı anda denerse bölüm bir kez eklenir.
- **Bölüm işaretleri.** `GET` ve `PUT /v1/halls/:salon/episodes/:ref` uçları kullanılır. Salon üyesi bir bölümü izlendi ya da izlenmedi olarak işaretleyebilir. İşaret yapımın ilerlemesini en ileri izlenen bölüme taşır, böylece "Devam et" de değişir. İzlenmemiş bölümlerin bulanıklaştırılması izleyicinin kendi tercihidir.
- **IMDb ve Letterboxd.** Bu bağlantılar sağlayıcının verdiği TMDB kimliğinden kurulur. IMDb kimliği tıklanınca `GET /v1/halls/:salon/links/:ref` ile çözülür: önce TMDB'ye (anahtar varsa), sonra Wikidata'ya bakılır. Letterboxd bağlantısı yalnızca filmlerde vardır ve `letterboxd.com/tmdb/<kimlik>` adresine gider.
- **Ses dili.** Sahip "Türkçe dublaj" ile "Orijinal" arasında seçim yapar. Röle filmin ilk ses izini bu seçime göre seçer; kumandası olan kişi ses dilini film sırasında değiştirebilir. Altyazı dili (Türkçe, İngilizce ya da Kapalı) her izleyicinin kendi tercihidir.
- **Yayın bilgisi.** Röle ffprobe'dan çözünürlüğü, fps değerini ve kodeki bildirir; bit hızını oynatıcı son parçalardan ölçer. Canlı yayında "canlıdan X sn geride" bilgisi de gösterilir. Film ya da bölüm açılınca bu bilgi 3 saniye ekranda kalır.
- **Favori kanallar.** Her üyenin listesi Tayfa dosyasında, üye başına en fazla 300 kanal olarak tutulur ve `GET` ile `PUT /v1/halls/:salon/favorites` uçlarından okunup yazılır. Favoriler açıkken ↑/↓ yalnızca favori kanallar arasında gezer.
- **Hatırlatıcılar.** Bir programın hatırlatması cihazda saklanır. Program başlayınca "Salonda aç" kartı gelir; pencere önde değilse bir sistem bildirimi de çıkar (sohbet bildirimleri kapalı olsa bile). Uygulama kapalıysa hatırlatma çalışmaz. Kartta isteyen için "Salona duyur" düğmesi de var; salon sohbetine kişinin kendi adıyla yazar, kendiliğinden bir şey göndermez.
- **Kısayollar.** Salonun tuşları Ayarlar → Klavye'den değiştirilebilir. Çakışan tuş yeni komuta geçer ve eski komut kısayolsuz kalır; Esc, rakamlar ve ⌘/Ctrl K sabittir. `?` tuşu kısayol kartını açar.

## Stremio

Sahip, Sinema ayarlarındaki **Stremio** bölümünden hesabını bağlar. Salonda Filmler ile YouTube arasında bir **Stremio** sekmesi açılır.

- **Bağlama.** Stremio'nun kendi kodla bağlama akışı kullanılır (`link.stremio.com/api/v2/create` → tarayıcıda onay → `read`). Şifre Tayfa'ya hiç gelmez. Bekleyen ve süresi dolan kod Stremio'da aynı yanıtı verdiği için kod 15 dakika sonra bırakılır.
- **Saklama.** Stremio oturum anahtarı ve seçilen kaynakların adresleri topluluğun şifreli ayar dosyasında (`stremio`, `stremioPicks`, en fazla 300) tutulur. Debrid bağlantıları (Torrentio'nun Real-Debrid adresleri) debrid anahtarını içerdiği için hiçbir yanıtta istemciye gitmez.
- **Gezinme.** Salonu gören herkes Cinemeta'nın popüler başlıklarını, aramasını ve film/dizi ayrıntılarını görür. Hesabın "izlemeye devam et" satırı ve kitaplığı (`datastoreGet`) yalnızca hesabı bağlayan kişiye görünür. Görseller servis üzerinden gelir.
- **Kim seçer.** Kaynaklar sahibin eklentileri ve debrid hesabıyla bulunduğu için kaynakları listelemek ve seçmek topluluk sahibine ve yöneticilere açıktır. Seçilen şey salonda herkes için oynar.
- **Kaynaklar.** Bir film veya bölüm için hesabın `stream` sunan eklentileri sorulur (eklenti başına 20 sn). Her kaynak opak bir kimlikle döner (2 saat geçerli); kalite, boyut ve debrid önbelleği (`[RD+]` → Hazır, `[RD download]` → İndirilecek) gösterilir.
- **Cloudflare engeli.** Torrentio veri merkezi adreslerini (Hetzner dahil) Cloudflare ile reddeder (403). Servis bunu `blockedAddons` olarak bildirir. Hesabı bağlayan kişinin masaüstü uygulaması o eklentiyi kendi (ev) adresinden sorar (`/stremio/assist`). Eklenti adresleri ve Torrentio'nun yönlendirdiği bağlantılar Electron ana sürecinde kalır. Seçilen kaynağın yönlendirmesi (Torrentio → debrid indirme bağlantısı) yine orada izlenir ve yalnızca son indirme bağlantısı servise verilir (`/stremio/pick-direct`). Önbellekte olmayan bir kaynak Torrentio'nun "indiriliyor" klibinde kalır; bu durumda `CINEMA_STREMIO_NOT_CACHED` döner. Yerel ağ adresleri ve https olmayan bağlantılar atlanır.
- **Yalnızca doğrudan bağlantılar.** Sunucu yalnızca HTTP(S) adreslerini oynatır. Yalnızca `infoHash` taşıyan torrent kaynakları atlanır ve sayısı gösterilir; sunucu hiçbir zaman torrent indirmez veya paylaşmaz. Bütün istekler `privateFetch` üzerinden gider (özel ağ engeli, sabitlenmiş DNS).
- **Oynatma.** Seçilen kaynak `x-…` kimliği alır ve salonun sırasına `community-media` olarak girer. Aktarım katalog filmleriyle aynı yoldan gider. Ayrıntılar, IMDb bağlantısı ve hesabın altyazı eklentilerinden gelen Türkçe/İngilizce altyazılar da çalışır.
- **Kaldırma.** Bağlantı kaldırılınca oturum ve bütün seçimler silinir, `x-` aktarımları durur. Stremio oturumu geçersiz sayarsa (`CINEMA_STREMIO_LOGGED_OUT`) sahip yeniden bağlar.
- **iPhone.** Seçilen kaynak iPhone salonunda da oynar; Stremio'da gezinme şimdilik masaüstündedir.

## RMDB

RMDB, salonun kendi film ve dizi kaydıdır; Sinema'nın son sekmesidir. Arayüzde adı **Tayfa**'dır; kod, uç noktalar ve dosyalar `rmdb` adını korur. Salonda izlenenler kendiliğinden girer, üyeler puan, yorum ve günlük ekler.

- **Ne girer.**
  - Salonda bir film ya da dizi bölümü en az 5 dakika gerçekten oynayınca yapım kayda girer ve o izlemenin günlük satırı açılır. Sarmalar bu süreye sayılmaz. Canlı kanallar girmez.
  - Üyeler katalogdaki film ve dizileri elle de ekler. İzlenecekler, salonun ortak listesidir.
  - RMDB'de zaten olan bir yapımın ilerlemesi ilk andan güncellenir.
- **Konum nereden gelir.** İstemci kendi ilerlemesini bildirmez. Servis, bir üyenin oynatıcısı aktarım istediğinde (`watch`) ve bileti yenilediğinde (yaklaşık 90 saniyede bir) salon etkinliğini o üyenin belirteciyle okur ve zaman çizelgesindeki konumu kaydeder. Bu yüzden durdurulan bir izlemenin kayıtlı konumu en fazla birkaç dakika geride kalabilir. "Devam et", kayıtlı noktanın 5 saniye öncesinden başlar.
- **Bitti sayılması.** Eserin (dizide bölümün) %90'ı izlenince izleme bitmiş sayılır. Yapım sıraya yeniden eklenip izlenirse yeni bir günlük satırı açılır. Bitmiş bir bölümde "Devam et" sonraki bölümü baştan açar.
- **Aynı yapım.** RMDB katalog kimliğini değil kendi kimliğini (`w-…`) kullanır. Aynı yapım önce TMDB kimliğiyle, yoksa Türkçe katlanmış adı ve uyumlu yılıyla tanınır. IPTV hesabı değişse de yeni katalogda aynı ad ve yılla bulunan yapım yeniden açılabilir.
- **Kalıcılık.**
  - Kayıtlar, puanlar, yorumlar ve günlük `/state/rmdb/<topluluk>.enc` dosyasında, afiş ve arka plan kopyaları `/state/rmdb/<topluluk>/art/` altında, katalogla aynı anahtarla AES-256-GCM şifreli tutulur.
  - IPTV hesabını kaldırmak veya değiştirmek RMDB'ye dokunmaz. Kopyalanan afişler hesap yokken de görünür.
  - Kopyalar topluluk başına 256 MB'a kadar afiş ve arka planı, 512 MB'a kadar yalnız afişi kapsar. En fazla 5000 yapım ve yapım başına 200 günlük satırı tutulur.
- **Kimin ne yapabildiği.**
  - Salonu görebilen her üye listeyi ve ayrıntıları görür. Kendi puanını (yarım yıldız adımlarıyla 0,5–5), yorumunu (en fazla 4000 karakter, isterse spoiler işaretiyle) ve kalbini yazar ya da siler. Elle günlük satırı ekler ve kendi eklediği satırı siler.
  - Sunucu sahibi başkasının yorumunu, herhangi bir günlük satırını ve bir yapımı tümüyle kaldırabilir.
  - Yazma uçları üye başına dakikada 60 istekle sınırlıdır. Yanıtlarda sağlayıcı adresi, hesap bilgisi veya katalog kimliğinin kaynağı yer almaz.
- **Uçlar.** `GET` ve `POST /v1/halls/:salon/rmdb`, `GET` ve `DELETE /v1/halls/:salon/rmdb/:yapım`, `PUT` ve `DELETE …/review`, `DELETE …/reviews/:üye`, `PUT …/watchlist`, `POST …/diary`, `DELETE …/diary/:satır`. Masaüstü bunlara `CinemaBridge.rmdb*` yöntemleriyle ana süreç üzerinden ulaşır.

## Kurulum

`infra/cinema.Dockerfile` imajı ve `infra/cinema-compose.fragment.yml` parçası özel üretim yapılandırmasına eklenir. Ters vekil `/rooms-cinema/*` yolunu ön eki kaldırarak `cinema:3050` adresine iletir.

| Değişken                             | Anlamı                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROOMS_CINEMA_STORAGE_KEY`           | 64 onaltılık karakter; hesap ve katalog şifreleme anahtarı. Yedekle; değişirse kayıtlı hesap okunamaz ve servis başlamaz, sahibin hesabı yeniden bağlaması gerekir. |
| `ROOMS_CINEMA_TICKET_SECRET`         | En az 32 karakter; aktarım bileti imzası                                                                                                                            |
| `STOAT_INTERNAL_URL`                 | Özel ham Stoat API (`http://api:14702`)                                                                                                                             |
| `ROOMS_SOCIAL_READ_MONGO_URL`        | Yalnızca okuyabilen üyelik okuyucusu (Access ve Activities ile aynı)                                                                                                |
| `ROOMS_ACTIVITIES_INTERNAL_URL`      | Salon etkinliğini okumak için (`http://activities:3031`)                                                                                                            |
| `ROOMS_CINEMA_MAX_RELAYS`            | Aynı anda en fazla aktarım; hesabın sınırını aşamaz                                                                                                                 |
| `ROOMS_CINEMA_USER_AGENT`            | Sağlayıcıya giden istemci adı; varsayılan `ROOMS-Cinema/1.0`                                                                                                        |
| `ROOMS_CINEMA_ALLOW_PRIVATE_SOURCES` | Yalnızca yerel geliştirme. `1` olursa SSRF korumasının tamamı kapanır (özel ağlar ve yönlendirmeler serbest kalır); üretimde asla ayarlama                          |
| `ROOMS_CINEMA_VOD_WINDOW_SEC`        | Film rölesinin tuttuğu saniye (imajda 60)                                                                                                                           |

`/state` dizinini UID 10003 ve 0700 izniyle hazırla, diğer kalıcı depolar gibi şifreli yedekle. `/hls` yalnızca bellektedir.

## Doğrulama

- `tests/community-cinema-text.test.ts`: Kanal'ın Dart testlerinden çıkarılan 269 vaka. Kapsadığı kurallar: Türkçe arama normalizasyonu, kalite rozetleri, ülke bayrakları, EPG eşleştirme, URL maskeleme ve Türkçe sıralama.
- `tests/community-cinema-protocol.test.ts`: salon etkinliği, canlıda zaman çizelgesi reddi, medya türü ayrımı, şemanın URL reddi.
- `tests/community-cinema-service.test.ts`: taklit Xtream paneline karşı servis. Kapsadığı akışlar:
  - sahiplik ve hesabı doğrulama
  - içe aktarma ve rehber eşleştirme
  - Türkçe arama
  - dizi ve film ayrıntıları
  - yalnızca seçili öğenin aktarılması
  - yanıtlarda ve diskte hesap bilgisinin bulunmaması
  - M3U dışa aktarma bağlantısının Xtream'e çevrilmesi
- `tests/community-cinema-ipc.test.ts`: ana süreç IPC doğrulaması, biletin görünüme gitmemesi, 410 ve hesap değişimi, altyazı izlerinin aynı oturumun `sub<n>.vtt` dosyalarına eşlenmesi.
- `tests/community-cinema-subtitles.test.ts`: WebVTT okuma ve yazma, yazılmakta olan cue, ffmpeg altyazı çıktıları, eser zamanına çevirme, vekil hız kapısı ve kendiliğinden altyazı seçimi.
- `tests/community-cinema-online-subtitles.test.ts`: SubRip/ASS okuma, Windows-1254, sınırlı zip okuyucu, taklit SubDL ile arama, sıralama, bölüm süzme, anahtar/sonuç yok/kesinti ayrımı ve zip'ten WebVTT'ye çevirme.
- `tests/community-cinema-service.test.ts` (çevrimiçi altyazılar): anahtarın yalnız sahipçe girilmesi ve hiçbir yanıtta ya da diskte açık görünmemesi, TMDB kimliğiyle arama, eksik kimlik için `get_vod_info`, bölüm araması, yalnız listelenen kimliklerin bir kez indirilmesi.
- `tests/caption-file.test.ts`: izleyicinin seçtiği SRT/ASS/VTT dosyasının WebVTT'ye çevrilmesi.
- `tests/community-cinema-rmdb.test.ts`: RMDB'nin 5 dakika kuralı, sarmaların sayılmaması, %90'da bitiş, yeniden izleme, aynı yapımı tanıma, yorum doğrulaması, günlük yetkileri ve şifreli kalıcılık.
- `tests/community-cinema-service.test.ts` (RMDB): salonun izlediğinin kayda girmesi, bilet yenilemesiyle ilerleme, hesap kaldırılınca kaydın ve afiş kopyasının kalması, elle ekleme, dizide kaldığı bölümden ve sonraki bölümden devam, yetki matrisi.
- `tests/community-cinema-ipc.test.ts` (RMDB): ana sürecin kimlikleri ve yorumu istek çıkmadan doğrulaması.
- `tests/community-cinema-relay-native.test.ts` (`ROOMS_CINEMA_RELAY_NATIVE=1`, ffmpeg 9): seyrek SubRip ve ASS izli bir MKV ile hız sınırı, sarma sonrası zamanlama ve eser zamanındaki cue'lar.

Bunlar birim, taklit servis ve yerel kontrollerdir. Gerçek sağlayıcı hesabı, iki fiziksel bilgisayarda birlikte izleme, Windows ve uzun canlı yayın kabulü ayrıca yapılmalıdır.
