# RC39 — Hız, DJ ve mikrofon

## Hız

- Her tıklamadan sonra 10 saniyeye varan bekleme kalktı. Access, oyunlar ve Sinema her istekte
  Stoat'a "bu oturum kimin?" diye soruyordu; Stoat bu soruyu servis başına sınırladığı için herkes
  aynı kotayı paylaşıyor, kota dolunca istekler 10 saniyelik pencerenin sıfırlanmasını bekliyordu.
  Kimlik artık token başına 30 saniye hatırlanır; üyelik ve yetkiler her istekte taze okunur. Çıkış
  yapılan bir oturum servislerde en fazla 30 saniye daha geçerli sayılır.

## DJ

- 23 Kasım'da YouTube oynatıcısını değiştirdi ve DJ hiçbir şarkıyı çalamaz oldu. YouTube
  ayrıştırıcısı yeni oynatıcıyı okuyan sürüme sabitlendi.
- DJ şarkıyı başlatmadan önce 2 saniye tamponlar, çalarken 12 saniye önden okur; ses kuyruğu
  200 ms'den 1 saniyeye çıktı. YouTube'dan parça beklerken veya sunucu bir an durduğunda ses artık
  takılmaz. Her şarkı ve ileri sarma yaklaşık 0,3 saniye geç başlar.

## Mikrofon

- macOS, sistem sesli bir yayın açılıp kapanırken veya kulaklık çıkıp takılırken ses aygıtını yeniden
  kurar; bu sırada mikrofon kendiliğinden kapanabiliyordu. Senin istemediğin bir kapanma artık
  mikrofonu yeniden açar (dakikada en fazla üç kez). Sessize aldıysan, sağırlaştırdıysan, odadan
  çıktıysan veya gürültü filtresi hata verdiyse dokunulmaz.
- Geri takılan bir kulaklık ilk anda açılmazsa 0,4 ve 1,2 saniye sonra yeniden denenir; ancak sonra
  mikrofon nedeni yazılarak kapatılır.
- Gürültü filtresinin ses zinciri durursa yeniden başlatılır; başlamazsa yeni bir zincir kurulur.
  Mikrofon açık görünürken odaya sessizlik gitmesi ve çıkıp girmeden düzelmemesi bununla giderilir.

## Profil

- Ayarlar'da profil fotoğrafı seçince kırpma penceresi Ayarlar'ın arkasında açılıyordu; başka bir
  sayfaya geçince görünüyordu. Pencere artık önde açılır.

## Sunucu

- YouTube ayrıştırıcısı (`music-cipher`), kimlik önbelleği (access, oyunlar) ve DJ tamponu
  (müzik servisi) 25 Kasım'da sunucuya kuruldu. Sinema servisindeki kimlik önbelleği kurulmadı;
  imajının yeniden derlenmesi gerekiyor.

## Doğrulama sınırları

- Kimlik önbelleğinden sonra sunucudaki hız sınırı uyarıları dakikada 60–90'dan neredeyse sıfıra
  indi. Tıklamaların ne kadar hızlandığı uygulamada ayrıca ölçülmedi.
- DJ ayrıştırıcısı gerçek bir şarkı eklenerek doğrulandı; takılmanın geçtiği gerçek odada dinlenerek
  doğrulanacak.
- Mikrofon düzeltmeleri birim testleriyle sınandı. Mac'te AirPods çıkarıp takma, sistem sesli
  yayını açıp kapama ve karşı tarafın gerçekten duyması iki bilgisayarla denenecek.
