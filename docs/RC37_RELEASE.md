# RC37 — IDIOT TRIO istekleri, ikinci dalga

Bu sürüm IDIOT TRIO'nun "bugs & features" kanalında RC36'dan sonra yazılan 13 isteği karşılar (H01–H13). İkisi
RC36'daki düzeltmelerin gerçek Windows'ta tam oturmadığını gösterdi: yazarken Ctrl+Shift+M ve otomatik yayın kalitesi.

## Kısayollar

- **Ctrl+Shift+M yazarken de çalışır:** Kısayol, imleç mesaj kutusundayken yok sayılıyordu. Yazı kanalında imleç hep
  orada durduğu için Windows'ta hiç çalışmıyor gibiydi. Bu kısayol yalnızca Tayfa öndeyken çalışır.
- **Kısayolu istediğin tuşa ata:** Klavye sekmesinin başında "Ses kısayolları" var: mikrofon, sağırlaştırma ve bas
  konuş tuşu buradan atanır. Bu tuşlar oyundayken de çalışır. Mikrofon ya da sağırlaştırma düğmesine sağ tıklamak bu
  sekmeyi açar.

## Sesler

- **Kendi giriş ve çıkış sesin:** Seçtiğin giriş ve çıkış sesini artık sen de duyarsın. Eskiden sana hep varsayılan ses
  çalıyordu, bu yüzden ayar çalışmıyor gibi görünüyordu. Başkalarının sesi oda dolmasın diye kişi başına iki dakikada bir
  çalar; Ayarlar'da bunu anlatan bir not var. iPhone'da kendi sesin hâlâ varsayılan sesle çalar.
- **Yayınını izleyen:** Biri yayınını izlemeye başlayınca ya da bırakınca kısa bir ses çalar. "Mikrofon, sağırlaştırma
  ve yayın sesleri" anahtarı bunu da kapatır.

## Yayın

- **Kaynak kalitesi:** Kalite seçicide "Otomatik (pencereye göre)", "Kaynak (en yüksek)" ve çözünürlükler var. Varsayılan
  Kaynak'tır: yayın en yüksek katmanla istenir. Otomatik, zayıf bağlantı için pencerenin boyutuna göre ister. RC36'dan
  kalan Otomatik seçimi Kaynak'a geçer.
- **Gelen çözünürlük:** Seçicinin yanında gerçekte gelen çözünürlük yazar ("Gelen: 1080p"). Kaynak seçiliyken düşük
  geliyorsa sorun bağlantıda ya da sunucudadır.
- **Ses simgesi:** Yayındaki ses simgesine tıklamak yayının sesini kapatır; simge kırmızı olur. Yeniden tıklamak önceki
  seviyeyi geri getirir.
- **Diğer yayınları gizle:** Birden çok yayın varken yeni bir düğme alttaki küçük resimleri gizler; seçtiğin yayın alanı
  doldurur.
- **Kamera ve yayın düğmeleri:** "Ses bağlı" kartında kamera ve yayın açıkken düğmeler yeşil yanar; yayın açıkken
  simge değişir.

## Sesli oda ve üyeler

- **Sesli kanala gir, sayfan kalsın:** Sesli kanala tıklamak bağlanır ama açık yazı kanalını değiştirmez. Sesli oda
  ekranı, bulunduğun kanala yeniden tıklayınca açılır.
- **Üyeler paneli yalnızca yazı kanallarında:** Sesli odada ve yayın ekranında panel yayını küçültüyordu. Orada üyeler
  düğmesi paneli üstte açar.
- **"Konuşuyor" yazısı kalktı:** Üyeler panelinde konuşan kişinin satırı her kelimede değişiyordu. Artık avatarında ince
  yeşil bir halka çıkar.

## Ayarlar

- **Arama:** Ayarlar menüsünün başında arama kutusu var. Sekme adlarında ve sekmelerdeki ayarlarda arar ("saat biçimi"
  Görünüm'ü bulur), eşleşen ayar sekmenin yanında yazar. Enter ilk sonucu açar.
- **Saat biçimi:** Saatler artık bilgisayarın bölge ayarına uyar. Windows İngilizce, bölge Türkiye ise 14:30 görünür.
  Görünüm'de "Saat biçimi: Sistem / 24 saat / 12 saat" seçilebilir; değiştirince pencere yeniden yüklenir.

## Sunucu

Bu sürümde sunucu değişikliği yok.

## Bilinen sınırlar

- Hepsi birim testleriyle denendi. Yayın kalitesi, izleyici sesi ve kamera/yayın düğmeleri iki bilgisayarla, Windows
  kısayolu ve saat biçimi gerçek bir Windows'ta denenecek.
- Kaynak'ta yayın hâlâ düşük geliyorsa ("Gelen" değeri düşükse) neden LiveKit sunucusunun bant genişliği tahminidir.
  Sunucu ayarı ayrı bir öneri olarak ele alınacak.
- Kaynak ve Otomatik farkı, LiveKit istemcisinin `adaptiveStreamSettings` ve `updateDimensions` alanlarına dayanır
  (livekit-client 2.22.3'te private); kütüphane güncellenince yeniden denenmeli.
