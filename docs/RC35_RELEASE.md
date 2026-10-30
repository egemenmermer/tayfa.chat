# RC35 — IDIOT TRIO geri bildirimleri

Bu sürüm, IDIOT TRIO topluluğunun "bugs & features" kanalına yazılanlardan çıktı. Çoğumuz Windows kullandığı için her
özellik Windows'ta ve macOS'ta aynı çalışacak şekilde yapıldı.

## Ses

- **Kişi başına %200 ses:** Herkesin sesi 0–%200 arasında ayarlanır ve hesaba kaydedilir. Kaydırıcıda %100 işaretli;
  çift tık ya da sıfırla düğmesi %100'e döndürür.
- **Ses seviyesini dengele:** Gürültü azaltmadan sonra hafif bir dengeleyici, kısık ve yüksek konuşanları birbirine
  yaklaştırır. Ayarlar'dan kapatılabilir.
- **Giriş hassasiyeti:** Konuşma halkan yanmıyorsa ses gitmez; klavye tıkırtısı gibi kısa sesler artık iletilmez.
  Otomatik ya da elle eşik; canlı mikrofon seviyesi çubuğu.
- **Kendi kısayolların:** Mikrofonu aç/kapat ve sesi kapat için kısayol atanabilir; başka bir uygulama öndeyken de çalışır.
  Bas-konuş yalnızca Tayfa öndeyken çalışır ve bunu söyler.
- **Daha hızlı kanal değiştirme:** Yeni odanın bağlantısı tıklandığı anda istenir, mikrofon yeniden açılmadan taşınır,
  kanalın üzerine gelince bağlantı önceden hazırlanır.

## Yayın

- **Daha akıcı yayın:** Hareketli içerikte kare hızı korunur; zayıf bağlantıda yayın daha düşük katmana iner.
- **İzleyen kaliteyi seçer:** Yayının üstünde "Görüntü kalitesi": Otomatik, 1080p, 720p, 360p.
- **Yayın sesi:** "Sesi de paylaş" artık varsayılan olarak açık. Windows 11 ve macOS 14.2+ Tayfa'nın kendi seslerini
  yayına katmaz; Windows 10'da yankı olabilir ve paylaşım penceresi bunu söyler.
- **Sağ tık yayın ayarları:** Kendi yayınına sağ tıklayıp ekranı/pencereyi, kaliteyi ve sesi yayını durdurmadan
  değiştirebilirsin.

## Topluluk ve sohbet

- **Davet bağlantıları uygulamayı açar:** "Tayfa'da aç" artık Windows'ta da çalışır. Hesabı olan tek tıkla topluluğa
  katılır; topluluk menüsünde "Davet bağlantısıyla katıl" var.
- **Kanalda anket:** Yazı kanalındaki "Anket" düğmesiyle kurulan anket o kanala kart olarak düşer, herkes orada oy verir.
  iPhone'da da kart olarak görünür; eski sürümler düz bir cümle görür.
- **Üyeler paneli hemen açılır:** Son bilinen liste anında görünür, arka planda yenilenir.
- **Topluluk oluştururken çift kayıt yok:** Başarı ekranı artık kaybolmuyor; pencere açık topluluğun adıyla dolu açılmıyor.

## Etkinlikler

- **Beyaz tahtada post-it:** Renkli notlar, sürükleme, kenarlara yapışma; "Tahtayı temizle" (yöneticiler, onaylı).
- **Sinema'da YouTube arama:** Link yapıştırmak yerine yazarak ara, sonuçtan seç.
- **Soundboard:** Küçük tuşlar, her sese emoji; çalınca emoji herkeste aşağıdan yükselir. Ses eklerken ve düzenlerken
  dalga formunda kesme.

## Windows

- **Uygulama içi güncelleme:** Windows uygulaması yeni sürümü kendisi bulur, indirir, SHA-512 ile doğrular ve yeniden
  başlatınca kurar. İlk otomatik güncelleme RC35'ten RC36'ya geçerken çalışır; RC35'i elle kurun.
- **Yeni üst bar:** Uygulamanın renklerinde, logolu ve "Tayfa" yazılı bütünleşik bar; tam ekranda gizlenir.

## Sunucu

- **Activities:** Beyaz tahta notları ve temizleme (masaüstünden önce deploy edildi).
- **Access:** Yeni davet sayfası, Sinema YouTube araması (dakikada 20 istek), soundboard ses adı düzenleme.

## Bilinen sınırlar

- Yayın, ses ve kısayol değişiklikleri birim testleriyle doğrulandı; iki bilgisayarla gerçek kabul testi bu sürümle
  arkadaşlarla yapılacak.
- rc.34'te tahtada not varken PNG dışa aktarma hata verir; rc.35'e geçince düzelir.
- Yakınlaştırma (Ctrl +/-) sonrasında Windows üst barı ile pencere düğmelerinin yüksekliği hafifçe farklı olabilir.
