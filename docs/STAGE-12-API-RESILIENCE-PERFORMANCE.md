# ZEUS AI — Aşama 12: API dayanıklılığı ve performans güvenliği

Durum: kod ve regresyon testleri güncellendi; canlı veri kapsamı ile üretim telemetrisi bulguları çözülmeden aşama tamamlanmış sayılmaz.

## Kod değişikliği

- `backend/services/forEachConcurrent.js`: pozitif tam sayı concurrency sınırı ve giriş doğrulamasına ek olarak, ilk işleyici hatasında yeni iş başlatmayı durdurur, hâlihazırda çalışan işleri bekler ve hatayı çağırana iletir.
- `backend/test/forEachConcurrent.test.js`: sınır, her girdinin bir kez işlenmesi, boş dizi, geçersiz argümanlar, hata iletimi ve hata sonrası yeni iş başlatılmaması senaryolarını kapsar.
- `backend/services/concurrencyGuard.js`: IP + rota bazlı eşzamanlılık sınırının mevcut regresyon testleri ayrıca çalıştırılmalıdır.

## Canlı telemetride gözlenen, henüz çözülmemiş engeller

15 Ekim 2026 tarihli Render uygulama hata kayıtlarında:
- Model 4.1 istekleri bazı maçlarda `INSUFFICIENT_HISTORY` ile Model 4.0'a düşüyor; bazı örneklerde ev/deplasman geçmiş örnek sayılarından biri sıfır veya çok düşük.
- Bazı tarihsel veri denemeleri `football-data` için HTTP 400 ve HTTP 429 olarak kaydedilmiş.
- Bazı sağlayıcı denemeleri `not_installed`, `league_not_supported`, `disabled_or_cooling_down` veya `fixture_not_matched` olarak raporlanmış.
- H2H, iç/dış saha ayrımı, ilk yarı verileri ve bazı diğer istatistik alanları kimi karşılaşmalarda bulunmuyor.

Bunlar yalnızca concurrency helper değişikliğiyle giderilmiş olmaz. Sağlayıcı bazında gerçek istek parametreleri, erişim/plan kısıtları, lig eşlemesi ve geçmiş veri kapsamı ayrı ayrı düzeltilip canlı kanıtla doğrulanmalıdır. API anahtarları veya gizli ortam değişkenleri loglara yazılmamalıdır.

## Kabul ölçütleri

1. Backend test paketinin tamamı geçer.
2. İlk worker hatasından sonra yeni iş başlatılmaz; hâlihazırda çalışan işler sonuçlanır ve özgün hata çağırana iletilir.
3. PR CI kontrolleri geçer.
4. Salt okunur canlı kontroller sağlık, sağlayıcı durumu, capture, ledger performansı ve maç/lig kapsamını doğrular.
5. Gerçek maç örnekleri için her iki takımın geçmiş verisi ve gerekli özelliklerin kapsaması ölçülür; eksik veri sessizce uydurulmaz.
6. Sağlayıcı HTTP 400/429, yetkilendirme, kota ve lig kapsamı sorunları için kök neden ve yeniden test kanıtı kaydedilir.
7. Ledger tutarlılığı, sonuç kesinleştirme/çakışma ve yeniden başlatma sonrası kalıcılık senaryoları doğrulanır.

## Doğrulama sınırları ve güvenlik

- PR üzerindeki başarılı CI; canlı sağlayıcı kapsamının ve üretim ledger doğrulamasının başarılı olduğunu kanıtlamaz. Mevcut workflow canlı kontrolleri yalnızca `push` olayında çalıştırır; PR çalışmasında bu adımlar atlanmıştır.
- Sentetik testler tahmin kalitesini veya canlı sağlayıcı erişimini kanıtlamaz.
- Production deploy, production DB/ledger yazımı veya model değişikliği yapılmaz. Model 4.0 varsayılan kalır.
- Aşama; yukarıdaki canlı ve regresyon kabul koşulları kanıtlanana kadar açık kalır.
- Birleştirme sırası korunur: #37 → #38 → #39 → #40 → Stage 12 PR.
