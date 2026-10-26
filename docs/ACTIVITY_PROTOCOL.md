# Ortak etkinlik protokolü v1

Activity sunucusu oda sürümlerini, katılımcıları, oynatma saatini, kuyrukları, anketleri ve beyaz tahta öğelerini yönetir. Ses oturumları veya medya aktarımı ona ait değildir. Etkinliği bitirmek hiçbir zaman LiveKit'ten ayrılma API'sini çağırmaz.

## API

`GET /v1/rooms/:roomId/activity?afterRevision=0&waitMs=25000`, `ActivityResponse` döndürür. Güncelleme kaybını önlemek için ilk anlık görüntüyü almadan önce abone olun. Uzun sorgu uyandığında sunucu yetkiyi yeniden kontrol eder. Yetkilendirme çözümleyicisi verilmemiş istekler `AUTHORIZATION_NOT_CONFIGURED` ile reddedilir.

`POST /v1/rooms/:roomId/activity/commands` kesin kurallarla doğrulanan şu zarfı kabul eder:

```json
{"protocolVersion":1,"commandId":"550e8400-e29b-41d4-a716-446655440000","expectedRevision":0,"command":{"type":"join"}}
```

Her değişiklik, çağıranın sağladığı `authorize(bearer, roomId)` bağdaştırıcısıyla güncel üst sistem üyeliğini doğrular. Bağdaştırıcı gerçek üst sistem kimliğini ve etkin oluşturma/kontrol izinlerini döndürmelidir. Erişim belirteçleri anlık görüntü veya depolarda saklanmaz. Masaüstü görünümü belirteci almak yerine yerel `rooms.activity` IPC köprüsünü kullanır.

Komutlar oda içinde sırayla uygulanır. Beklenen sürüm uyuşmazsa HTTP 409 `REVISION_CONFLICT` gelir. Güncel durumu okuyup kullanıcıdan amaçlanan değişikliği yeniden denemesini isteyin. Aynı komut kimliğinin birebir tekrarı işlemi yeniden uygulamadan güncel durumu döndürür. Kimliği farklı içerikle kullanmak reddedilir. İşlem kayıtları son 2048 işlemi, olaylar son 256 sürümü tutar; eski komutlar iki kez uygulanmak yerine eski sürümden dolayı reddedilir. `replayRequired`, istemcinin yerel durumunu yanıttaki tam anlık görüntüyle değiştirmesi gerektiğini belirtir.

## Oynatma ve kaynak gizliliği

Çalarken konum `positionSec + (serverNow - effectiveServerTimeMs) * rate / 1000`, dururken `positionSec` değeridir. Medya seçimi oynatma neslini artırır. İstemci önceki neslin bitiş olayını yeni kaydın bitişi saymamalıdır. Varsayılan olarak yetkili tüm denetleyiciler oynatabilir, duraklatabilir, sarabilir ve kuyruğu yönetebilir.

## Kuyruk ilerlemesi ve ev sahibi kumandası

- `queue.add` isteğe bağlı `start: true` alır: öğe eklenir, hemen seçilir ve YouTube öğesiyse oynatılır.
- `queue.select` isteğe bağlı `play: true` alır. Alan yoksa eski davranış korunur (seçilir, duraklatılmış kalır).
- `queue.next {fromItemId, reason}` yalnızca `fromItemId` hâlâ güncel öğeyse etkili olur. Aynı bitişi bildiren diğer izleyicilerin komutları hata vermeden değişiklik yapmaz. `reason: "ended"` oynatma kararı sayılmaz: odada kontrol izni olan her katılımcı bildirebilir. Sırada öğe yoksa oda bitiş konumunda duraklar. `reason: "skip"` kumanda ister; liste sonunda `QUEUE_END` döner.
- Bağımsız kaynak (kişisel dosya) öğeleri hiçbir zaman kendiliğinden oynamaz; herkes önce kendi kaynağını hazırlar.
- `session.control {mode}` yalnızca ev sahibinindir. `everyone` (varsayılan, alan yoksa da) herkese kumanda verir. `host` modunda oynatma, sarma, seçme, atlama, sıralama, başkasının öğesini kaldırma ve etkinliği bitirme yalnızca ev sahibine ve `primary.controllers` listesindekilere açıktır (`SESSION_HOST_CONTROL`). Diğerleri sıraya öneri ekleyebilir ve kendi eklediklerini kaldırabilir.
- `session.permit {userId, allowed}` ev sahibinin bir katılımcıya kumanda vermesi ya da geri almasıdır; hedef etkinlikte olmalıdır.
- `session.host {userId}` ev sahipliğini kontrol izni olan bir katılımcıya devreder. Önceki ev sahibi kumanda listesinde kalır.
- Ev sahibi ayrılırsa önce kumanda verilmiş katılımcılar, sonra en eski katılımcı ev sahibi olur.

`directsSession(primary, userId, canControl)` yardımcı işlevi istemci ve sunucuda aynı kuralı uygular. Eski istemciler yeni alanları yok sayar; `host` modunda yetkisiz komutları sunucu reddeder.

Ortak kuyruk medyası resmî YouTube video kimliği veya bağımsız kaynağa ait opak referans ve görünen başlık içerir. Kesin şema özel dosyaları, sağlayıcı URL'lerini, kimlik bilgilerini ve kişisel medya bağlantılarını kabul etmez. Bu sistem üstveri eşzamanlaması yapar; medya kaynağı değildir. Katılımcı izinli kaynağını bağımsız çözmelidir. Gerçek YouTube IFrame oynatımı ve iki oynatıcı arasındaki kayma düzeltmesi ayrı masaüstü kabul testleri gerektirir.

Oda başına bir ana Sinema, YouTube veya Ekran etkinliği bulunabilir. Güncel masaüstü istemci `cinema` ve `youtube` oda etkinliklerini açmaz: eski istemcinin veya iPhone'un başlattığı oturumu açıklar ve yalnızca hostun bitirmesine izin verir. Servis bu türleri eski istemciler için kabul etmeye devam eder. Anketler ve beyaz tahta birlikte kullanılabilir. Ev sahibi ayrılırsa veya 30 saniyelik etkinlik kirası biterse bağlı uygun katılımcıların en eskisi ev sahibi olur. Ekran kaynağının sahipliği devrolmaz; yeni ev sahibi `awaiting-source` görür. Uygun katılımcı kalmazsa ana etkinlik biter. İzleme, ses odasında bulunmak anlamına gelmez.

## Kalıcılık ve dağıtım

`ActivityRepository`, load/save/list sağlar. `MemoryActivityRepository` yalnızca test içindir. `FileActivityRepository` yerel geliştirme sunucusunu 0600 izinli dosyalar ve atomik değiştirmeyle kalıcı tutar. Tek yazıcı süreç destekler; veritabanı düzeyinde çökme dayanıklılığı veya dağıtık kilit iddiası yoktur. Birden çok kopya dağıtmadan önce PostgreSQL işlem uygulaması ve çok süreçli sürüm kilidiyle değiştirilmelidir. Mevcut arayüz protokol değişmeden bunu mümkün kılar.

## Doğrulama

`pnpm test` içindeki `tests/activity-realtime.test.ts`, gerçek yerel TCP Fastify sunucusu ve ayrı yetkilendirilmiş iki HTTP istemcisiyle oynatma eşzamanlamasını, uzun sorgu güncellemelerini, eski sürüm reddini, komut tekilliğini, ev sahibi devrini, kalıcı anket oylarını, dış kullanıcı reddini ve kimlik bilgili medya URL'sinin kesin reddini sınar. Ayrı kontroller yetki yapılandırılmadığında reddi ve başka yazarın tahta öğesini silme reddini kanıtlar. `node scripts/activities-build.mjs` servis modülünü derler.

Durum: servis ve protokol, test üyelik çözümleyicisi verilerek yerelde doğrulandı. Üretim Stoat yetkisi, dağıtılmış servis, iki gerçek masaüstü oynatıcısı, yerel oynatma eşzamanlaması ve fiziksel bilgisayarın yeniden bağlanması ayrı entegrasyon kabul kontrolleridir. Oynanabilir sunucu yetkili masalar için `game.create` ve türlendirilmiş oyun komutlarını kullanın. Genel medya `start` komutu, oyun kurallarının açık seçilmesini sağlamak için oyun kimliklerini reddeder. Oyun durumları her yetkili kullanıcıya ayrı yansıtılır; özel deste/stok veya diğer oyuncuların açılmamış elleri gösterilmez. Sınanan kural profilleri ve kalan kabul için [oyun kurallarına](GAME_RULES.md) bakın.

## Stüdyo

Ortak müzik projeleri oda komut zarfını kullanmaz; `apps/services/activities/studio.ts` içinde kendi yollarıyla çalışır (sözleşme: `packages/studio`, Contract v1). Aynı `authorize(bearer, roomId)` kullanılır: görmek oda erişimi, düzenlemek `canControl`, proje açmak `canCreate`, silmek `canCreate` ya da projeyi açan kişi ister. Stüdyonun kullanıcı başına ayrı istek bütçesi vardır (varsayılan dakikada 600).

- `GET /v1/rooms/:roomId/studio/projects` → `{protocolVersion, projects:[{id, name, createdBy, createdAt, updatedAt, tempo, tracks}], access:{canCreate}}`.
- `POST …/projects {protocolVersion, name, tempo?, template?: "empty"|"drums-bass"}` → `{protocolVersion, project}`. Kimliği sunucu üretir. Oda başına en çok 20 proje (`STUDIO_ROOM_FULL`).
- `DELETE …/projects/:projectId` → `{protocolVersion, removed}`. Bekleyen uzun sorgular uyanır ve 404 alır.
- `GET …/projects/:projectId?afterSeq=N&waitMs≤25000` → `{protocolVersion, serverTimeMs, seq, batches | snapshot, presence, access:{canEdit, canDelete}}`. `batches` öğeleri `{seq, actorId, batchId, ops}` biçimindedir. `N=0`, `N>seq` ya da saklanan son gruplardan (en çok 512 grup ve 4 MB) daha geride kalan istemci `snapshot` (tüm proje) alır. Sorgu yalnızca `seq === N` iken bekler; oturumun ilk eşitlemesi `waitMs=0` ile gönderilmelidir. Uyanan sorgu yetkiyi yeniden denetler.
- `POST …/projects/:projectId/ops {protocolVersion, batchId (uuid), ops ≤200, ≤60 KB}` → `{protocolVersion, seq, applied, skipped}`. Beklenen sürüm yoktur: sunucu grupları sıraya koyar, alan düzeyinde son yazan kazanır. Silinmiş öğeye giden işlem ve belge sınırını aşan oluşturma hata değil, `skipped` kaydıdır. Tamamı atlanan grup da kayda girer. Aynı `(actorId, batchId)` tekrarı ilk yanıtı döndürür, farklı içerikle 409 `STUDIO_BATCH_CONFLICT` alır. Tekrar penceresi son 512 gruptur (küçük makbuzlar olarak saklanır; 4 MB'ı aşan eski işlem kayıtları atılsa da tekrar yanıtlanır). Proje listesi odada bir kez okunup bellekte tutulan özetten verilir. İstek gövdesi en çok 64 KB'tır (üstü 413).
- `POST …/projects/:projectId/presence {playheadBeat?, selection?:{clipId?, noteIds ≤64}, view?}` → `{protocolVersion, presence}`. Her gönderim kişinin varlık durumunu bütünüyle değiştirir. Yalnızca bellekte tutulur, 30 saniyede düşer, bekleyen sorguları proje başına en çok saniyede bir uyandırır. İzleyiciler de gönderebilir.

Kalıcılık: `FileStudioStore` her projeyi `<ROOMS_ACTIVITY_DATA>/studio/<roomId>/<projectId>.json` dosyasında (0600, atomik değiştirme) tutar; `ROOMS_ACTIVITY_DATABASE_URL` verilirse `PostgresStudioStore`. Değişiklikler yaklaşık 1 saniye içinde ve kapanışta yazılır; silinen proje bekleyen kayıtla geri yazılmaz. Yüklemede kayıt kesin doğrulanır (`decodeStudioProject`, `storage-codec.ts` kalıbı). Bozuk kayıt `<projectId>.json.corrupt-<zaman>` adıyla (Postgres'te `rooms_studio_quarantine` tablosuna) kenara alınır, `studio-load` işletim olayı yazılır ve servis çalışmayı sürdürür. `tests/studio-realtime.test.ts` iki gerçek HTTP istemcisiyle yakınsamayı, uzun sorguyu, tekrar ve 409'u, atlanan işlemleri, rolleri, sınırları, yeniden başlatmayı, karantinayı ve anlık görüntüye dönüşü sınar. Postgres deposu ve dağıtılmış servis yerelde sınanmadı.

## Oyun kaydı

Masa oyunlarının kuralları `packages/games/src/registry.ts` içindeki modüllerden gelir (`GameModule`, `packages/games/src/module.ts`). Yeni oyun bir modül dosyası ve kayıttaki bir satırdır; servis dağıtıcısı, botlar, geçmiş/istatistik ve depolama türü kayıttan okur. Şema `game.create.game` ve `game.action.action` alanlarında yalnızca biçimi denetler (küçük harf, rakam, `-`); sunucu kayıtta olmayan türü `UNKNOWN_GAME`, modülün tanımadığı eylemi `INVALID_GAME_ACTION` ile reddeder. Yeni oyunlar komut verisini `game.action.payload` (en çok 8 KB JSON), masa seçeneklerini `game.create.options` (düz değerler) altında taşır. Holdem, Blackjack, Batak ve 101'in düz alanları (`amount`, `cardId`, `tileIds`, `melds`, `trump`, `variant`, `folding`, `teams`, `holdem`) eski istemciler için aynen geçerlidir.

## Gerçek masaüstü örnek kabulü

`node scripts/verify-activity-desktop.mjs`, gerçek Activity HTTP sunucusuna bağlanan iki ayrı Electron profili açar. Sosyal yetkilendirme yalnızca test düzeneğindeki Playwright inceleyici işleyicileriyle değiştirilir; QA alt bilgisi ve QA kimlikleri sürekli görünür. Bu, üretim yetkisini aşan bir yol veya Stoat entegrasyon sonucu değildir.

Doğrulanan arayüz işlemleri: Holdem masası oluşturma, ikinci kullanıcının oturması, el başlatma, herkesin kendi özel kartları, pas/sonuç geçmişi, ikinci kullanıcının anket oyu, ortak tahta yazısı ve Sinema oynat/duraklat/sarma işlemlerinin ikinci gerçek HTML videoya ulaşması. Özel kabul ekran görüntüleri açık depoya dahil değildir. Kayıtlı çalışmada görünüm sayfası hatası sıfırdır. Dağıtılmış Stoat yetkisi ve resmî YouTube sağlayıcı kabulü ayrı koşullardır.
