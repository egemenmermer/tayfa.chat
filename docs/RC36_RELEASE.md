# RC36 — Stremio baştan, IDIOT TRIO istekleri

Bu sürüm Sinema'nın Stremio sekmesini Stremio'nun kendisine benzetir ve IDIOT TRIO'nun "bugs & features" kanalındaki 15
isteği karşılar. Windows'ta RC35'ten RC36'ya geçiş, uygulama içi güncellemenin ilk gerçek denemesidir.

## Stremio

- **Vitrin:** Üstte popüler film ve dizilerin arka plan görseli, logosu, puanı, türleri ve özeti. Dokuz saniyede bir
  değişir; oklar ve noktalarla elle geçilir. "Kaynak seç" filmi açar.
- **Türler:** Filmler/Diziler anahtarı ve tür çipleri (Aksiyon, Komedi, Korku, Bilim kurgu…). Bir tür, o türün tam
  listesini açar.
- **Daha çok satır:** Popüler filmler ve diziler, bu yılın filmleri ve dizileri, öne çıkan filmler ve diziler. Stremio
  hesabında kurulu eklentilerin kendi katalogları da satır olarak gelir.
- **Tümünü gör:** Bir satırın bütün kataloğu ızgara olarak açılır; aşağı kaydırdıkça yeni sayfalar yüklenir. Üstte tür
  filtresi vardır. Izgaradan açılan filmden geri dönünce aynı ızgaraya dönülür.
- **Puanlar:** Posterin köşesinde IMDb puanı.
- **Ayrıntılar her zaman açılır:** Film ve dizi bilgileri önce Cinemeta'dan gelir; eklenti listesi okunamasa da sayfa
  açılır.

## Windows

- **Tepsi simgesi:** Tek ya da çift tıklama Tayfa'yı açar; sağ tık menüsü yerinde. Simge beyaz Tayfa logosudur, açık
  renkli görev çubuğunda koyulaşır.
- **Görev çubuğu ve arama:** Görev çubuğunda Electron değil Tayfa simgesi görünür. Kısayol ve "Program ekle/kaldır" adı
  Tayfa'dır; Başlat'ta "Tayfa" diye aranınca bulunur. Kurulum klasörü ve güncelleme yolu değişmez.

## Bildirimler

- **Özel mesaj ve etiket:** Özel mesaj ya da bir kanalda @adın geçince, genel bildirimler kapalı olsa da bildirim gelir.
  Ayarlar'da yeni "Özel mesajlar ve etiketlenmeler" anahtarı bunu yönetir.
- **Mikrofon, sağırlaştırma ve yayın sesleri:** Mikrofonu ya da sesi açıp kapatınca, odanda bir yayın başlayıp bitince
  kısa bir ses çalar (kendi yayının da). Ayarlar'da "Mikrofon, sağırlaştırma ve yayın sesleri" ile kapatılır.

## Sesli oda ve yayın

- **Yayın kalitesi:** "Otomatik (en yüksek)" yayını kaynağın en yüksek kalitesiyle açar; bağlantı yetmezse sunucu
  düşürür. Eskiden izlenen pencerenin boyutuna göre 540p–720p geliyordu (Windows'ta %150 ölçeklemede daha da düşük).
  Seçtiğin kalite artık hatırlanır.
- **CANLI rozeti:** Yayın açan kişinin yanında kırmızı CANLI yazar. Rozete tıklayınca o kişinin yayını açılır; başka bir
  odadaysa önce o odaya katılınır.
- **Kısayollar:** Mikrofon ve sağırlaştırma düğmeleri kısayolunu gösterir; sağ tık kısayol ayarına götürür.
- **Arkadaş ekle:** Sesli odadaki birinin profilinden "Arkadaş ekle" artık çalışır.
- **Ses tahtası:** Her sesin yanında "Dene" düğmesi; ses yalnızca sende çalar. Hazır seslerin varsayılan seviyesi %20.

## Sohbet ve profil

- **Üyeler paneli:** Üyeler simgesi paneli sağa sabitler; kapatana kadar açık kalır, başka yere tıklayınca kapanmaz.
  Çevrimiçi ve çevrimdışı üyeler görünür.
- **2000 karakter:** Mesaj kutusu 1800 karakterden sonra kalan karakteri gösterir; sınırı aşan mesaj gönderilmez.
  Gönderilemeyen mesajın nedeni yazar ve "Sil" ile kaldırılır.
- **Profilden mesaj:** Arkadaşının profilinin en altında tek satırlık mesaj kutusu; Enter onunla özel mesajda gönderir.
- **Avatar kırpma:** Fotoğraf seçince çemberin içine sürükleyip yakınlaştırarak yerleştirilir; 10 MB'a kadar fotoğraf
  seçilebilir.

## Düzeltmeler

- **Satırlarda takılan sürükleme:** Fare satırın dışında bırakılınca satır sürükleme modunda kalıyor, üzerinde gezinince
  kayıyor ve sonraki tıklamayı yutuyordu.
- **Silinen hesabın mesajları:** Hesabı silinmiş birinin eski mesajı, o kanalın mesaj sayfasını herkes için açılmaz hale
  getirebiliyordu. Mesaj artık yerinde kalır.
- **Fotoğraf hataları Türkçe:** Fotoğraf boyutu ve türü hataları İngilizce görünüyordu.

## Sunucu

- **Cinema:** Stremio ana sayfası satırları, vitrini ve tür listelerini verir; yeni katalog ucu yalnızca Cinemeta'ya ve
  hesapta kurulu eklentilere sorar. Eski uygulamalar eskisi gibi iki satır görür. Bu sürümde başka sunucu değişikliği
  yok.

## Bilinen sınırlar

- Yeni Stremio ekranı örnek veriyle ve canlı Cinemeta'yla denendi; eklenti satırları ve kaynaklar gerçek hesapla
  sunucuda denenecek.
- Windows'a özgü değişiklikler (tepsi, simge, kısayol adı, bildirimler) ve RC35→RC36 güncellemesi gerçek bir Windows'ta
  denenecek.
- Yayın kalitesi, yayın sesleri ve CANLI rozeti iki bilgisayarla denenecek. Yayın kalitesi düzeltmesi LiveKit
  istemcisinin `adaptiveStreamSettings` alanını yayın başına değiştirir; livekit-client güncellenince yeniden
  denenmeli.
- Avatar kırpma tarayıcıda denendi; paketlenmiş uygulamada denenecek.
- iPhone'da Stremio'da gezinme sekmesi yok; masaüstünde seçilen film iPhone'da oynar.
