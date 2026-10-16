# ZEUS AI — Aşama 11: Sağlayıcı sağlık telemetrisi

Durum: kod ve sentetik regresyon testleri eklendi; CI sonucu bekleniyor.

## Amaç

Aşama 09 sağlayıcı arıza/fallback davranışını, Aşama 10 ise kaynaklar arası maç durumu çelişkilerini kapsıyordu. Aşama 11, mevcut salt okunur sağlayıcı durum yanıtını ölçülebilir hâle getirir. Yeni alanlar `/api/health` içindeki mevcut `providers` durum nesnelerine eklenir; yeni bir uç nokta veya üretim yazımı gerekmez.

## Eklenen alanlar

- `totalOutcomes`: kaydedilen sağlayıcı durum sonuçlarının toplamı.
- `successfulOutcomes` / `failedOutcomes`: başarı ve başarısızlık sinyallerinin toplamı.
- `consecutiveFailures`: son başarılı sinyalden beri art arda kaydedilen başarısızlık sayısı.
- `lastOutcome`: `not_checked`, `success`, `failure` veya `unknown`.

Bunlar **istek sayısı veya uptime yüzdesi değildir**; mevcut durum güncelleme çağrılarının sayaçlarıdır. Bu ayrım, telemetrinin yanlışlıkla gerçek API çağrısı metriği gibi sunulmasını önler. Sayaçlar süreç belleğinde tutulur ve süreç yeniden başlatıldığında sıfırlanır.

## Testler

`backend/test/providerHealthTelemetry.test.js` aşağıdakileri denetler:
1. İlk durumun sağlayıcı erişilebilirliğini varsaymaması.
2. Başarı/arıza sayaçları, kota hata kategorisi ve son başarılı zamanın korunması.
3. Başarılı duruma dönüşte ardışık hata sayısının sıfırlanması.
4. Kayıtlı olmayan sağlayıcı için durum güncellemesinin güvenli biçimde yok sayılması.

## Sınırlar ve güvenlik

- Testler sentetik durum güncellemeleri kullanır; canlı sağlayıcı çağrısı yapmaz.
- Canlı sağlayıcı erişilebilirliği veya gerçek fikstür kapsamı bu aşamada doğrulanmış sayılmaz.
- PR taslak kalır; Stage 08 (#37) → Stage 09 (#38) → Stage 10 (#39) → Stage 11 sırası korunur.
- Merge, deploy, üretim DB/ledger değişikliği veya model geçişi yapılmaz. Model 4.0 varsayılan kalır.
