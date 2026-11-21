# İsteğe bağlı yerel stereo yayıncı

Genel müzik çalışma ortamı `infra/music.Dockerfile` ile kurulur. `Dockerfile.stereo`, açıkça seçilen uyumlu ve değişmez taban imajı ile doğrulanmış stereo derleme bağlamı gerektiren isteğe bağlı türevdir; açık bir bakımcı imajına işaret etmez.

Yalnızca derleme yapan `music-stereo` iş akışı üst LiveKit Rust SDK sürümünü, alt modülleri, araç zincirini, yamayı ve toplanan yerel lisans bildirimlerini sabitler. Kullanmadan önce kaynak, yama ve yerel bileşen özetlerini doğrulayın; LiveKit, libyuv ve üretilen WebRTC bildirimlerini koruyun. macOS modülünü Linux'a kopyalamayın.

Tayfa yalnızca iki kanallı kaynakta yayımlanan ses özelliği bildirimini değiştirir. Bu, sağlayıcı yetkisi ve mikrofon onayından bağımsızdır. Çalışan servisi değiştirmeden önce yalıtılmış ortamda gerçek yerel modül yükleme, ayrı kanal aktarımı, kaynak temizliği ve uyumlu geri dönüşü doğrulayın. Bit hızı tavanı gerçekleşen hız veya kayıpsızlık garantisi değildir.

Derleme ve fiziksel/sağlayıcı kabulü ayrı kontrollerdir. Önceki özel dağıtım kayıtları bu açık kaynak dağıtımına dahil değildir.

YouTube ayrıştırıcısı `music-cipher` her YouTube oynatıcı sürümü için yaklaşık 3 MB'lık bir betik indirir ve çalışırken eskileri silmez; yalnızca yeniden başlatma `/home/nonroot/.cache` belleğini temizler. 64 MB, beş haftada dolup her yeni oynatıcıda `ENOSPC` hatası verdi ve şarkı eklenemedi. [Compose parçası](../music-compose.fragment.yml) bu alanı 256 MB yapar (yaklaşık bir yıl yeter). Günlükte `No space left on device` görürsen `docker compose restart music-cipher` çalıştır; önbellek yeniden dolar.
