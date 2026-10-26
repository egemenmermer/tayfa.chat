# RC34 — Stüdyo ve yeni görünüm

## Stüdyo: birlikte müzik yapın

- **Ortak proje:** Her odanın bir Stüdyo'su var. Kenar çubuğundaki **Stüdyo**'dan ya da sesli odanın üst çubuğundan açılır. Odadaki herkes aynı projeyi aynı anda düzenler; kimin projede olduğu, nerede çaldığı ve neyi seçtiği kendi rengiyle görünür.
- **Editör:**
  - Zaman çizelgesi: klip oluşturma, taşıma, uzatma, kopyalama; ızgara 1/4, 1/8, 1/16 ya da serbest.
  - Piyano rulosu: nota ekleme, taşıma, uzatma, çoklu seçim, kopyala/yapıştır, vuruş gücü şeridi.
  - Davul ızgarası: davul parçaları için adım adım vuruş.
- **Hazır enstrümanlar:** Piyano, davul seti, bas, synth lead ve synth pad.
- **Mikser:** Parça başına ses, pan, sustur/solo, yankı, eko ve üç bantlı EQ.
- **Çalma çubuğu:** Tempo, ölçü, döngü, metronom; geri al / yinele düğmeleri.
- **Dışa aktar ve paylaş:** Şarkının tamamı ya da döngü aralığı WAV olarak kaydedilir; sunucunun dosya sınırı izin veriyorsa odanın sohbetine de gönderilir.
- **Ses yerelde çalınır:** Ağdan yalnızca notalar ve ayarlar gider; her bilgisayar müziği kendisi çalar, bu yüzden gecikme düzenlemeyi etkilemez.
- **Henüz yok:** Mikrofon/ses kartıyla kayıt, MIDI klavye, Türk enstrümanları paketi ve birlikte canlı çalma (jam). Bunlar sonraki sürümlerde gelecek; ilgili düğmeler neden kapalı olduğunu söyler.

## Yeni görünüm

- **BoardUI tabanlı tasarım, Tayfa renkleriyle:** Butonlar, metin alanları, seçim kutuları, anahtarlar, kaydırıcılar, onay kutuları, kartlar, pencereler, menüler, sekmeler, rozetler ve kenar çubuğu yenilendi. Davranış değişmedi.
- **Kenar çubuğu:** Yuvarlak köşeli, yüzen bir kart; seçili satır vurgulu.

## Oyunlar

- **"Kıraathane" artık "Oyunlar":** Menülerde, başlıklarda ve geri dönüş bağlantılarında yeni ad var. Komut paletinde eski adı yazanlar yine Oyunlar'ı bulur.

## Sunucu

- **Stüdyo modülü:** Activities servisi projeleri saklar ve düzenlemeleri herkese anında dağıtır. İki kişi aynı anda düzenleyince değişiklikler çakışmadan birleşir.
- **Daha net hatalar:** Çok büyük istekler artık "servis kullanılamıyor" yerine kendi hatasını verir.

## Paketler ve doğrulama

Mac paketi imzalanıp noter onayı alır, Windows paketi aynı commit'ten derlenir. Sunucuda activities servisi güncellenir.

**Güncelleme önemli:** Stüdyo için hem uygulamanın hem sunucunun RC34 olması gerekir. Eski sürümlerde Stüdyo görünmez.

Otomatik testler (yaklaşık 2700 masaüstü testi, Stüdyo için iki istemcili sunucu testleri dahil) ve Stüdyo ile yeni görünümün ekran görüntüsü kontrolü geçti.

İki gerçek bilgisayarda birlikte Stüdyo kullanımı, kulakla dinleme ve paketlenmiş uygulamada ses ayrıca denenir.
