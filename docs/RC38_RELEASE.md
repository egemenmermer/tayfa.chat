# RC38 — Yayın, durum seçimi ve arka plan yükü

## Yayın ve mikrofon

- Ekran paylaşımı açılırken veya kapanırken mikrofon yakalaması sonlanırsa, önceden açık olan
  mikrofon yeniden hazırlanır. İşlem sırasında mikrofonu kapattıysan veya sağırlaştırdıysan kapalı
  kalır. Canlı bir mikrofonun sunucudan sessize alınması ve filtre hataları bu korumayla geri açılmaz.
- Yayın kalitesine “Düşük trafik · 480p / 15 fps” eklendi. Video kodlayıcısının hedef üst sınırı
  450 kbps; ek görüntü katmanı gönderilmez. Sistem sesi, mikrofon ve protokol trafiği buna eklenir.
  Bu seçenek bütün uygulamanın internet kullanımına kesin bir kota koymaz.
- Mikrofon düğmesinin ipucunda kendi sessize alma kısayolun görünür; atanmadıysa ayarlara yönlendirir.

## Sinema ve durum seçimi

- Kenar çubuğundaki Sinema satırının stilleri ilk açılışta yüklenir. Yazı, Sinema'ya tıklayana kadar
  sağa kaymış görünmez.
- Sol alttaki adına tıklayınca doğrudan durum seçimi açılır: Çevrimiçi, Uzakta, Rahatsız etmeyin ve
  Görünmez. Seçim, bulunduğun kanaldan ayrılmadan uygulanır; sunucu onayından sonra kendi göstergen de
  güncellenir. Profil ayarları Ayarlar'da durur.

## Arka plan yükü ve tanılama

- Sessize alınan mikrofonun ses işleme grafiği duraklatılır. Mikrofonu açınca veya filtre/cihaz ayarı
  değiştirirken gerektiğinde yeniden çalışır; ayar işlemi bitince mikrofon kapalıysa tekrar durur.
- Kenar çubuğu, ana sayfa ve Sinema aynı taze durum sonucunu kullanır. İçe aktarma sırasında pencere
  arka plandaysa durum sorguları seyrekleşir. Önbellek hesap ve sunucuya göre ayrılır.
- Sesli oda listesi arka planda 5 saniye yerine 30 saniyede bir sorgulanır; pencereye dönünce hemen
  yenilenir. Kanal erişimi iptal edilirse kayıt yine hemen kaldırılır.
- Ayarlar → Tanılama'da WebRTC gönderim hızı görünür. Bu değer DJ indirmelerini, güncelleme
  dosyalarını ve HTTPS/WebSocket trafiğini kapsamaz.

## Sunucu

Bu sürümde sunucu değişikliği yok.

## Doğrulama sınırları

- İlk açılıştaki Sinema hizası ve durum menüsü yerel tarayıcı örneğinde görsel olarak kontrol edildi.
- Mikrofonun yayın açma/kapatma sırasında korunması gerçek Mac ve Windows'ta, yayın kalitesi de iki
  bilgisayarla denenecek. Birim testleri bu cihaz kabulünün yerine geçmez.
- Bildirilen 226 MB yüklemenin kaynağı ve oyundaki ping sıçramaları yeniden üretilemedi. O sırada
  açık olan medya özellikleri kesin bilinmiyor; DJ açık olmuş olabilir. Bu sürüm ölçülebilen arka
  plan yükünü azaltır ve gönderim hızını görünür yapar; belirli bir CPU veya ping düşüşü doğrulanmadı.
