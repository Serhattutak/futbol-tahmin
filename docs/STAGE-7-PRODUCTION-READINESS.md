# ZEUS AI — Aşama 7 Üretime Hazırlık Kontrolü

Son doğrulama: 2026-10-15. Bu belge, canlıya geçiş onayı değildir.

## Mevcut dağıtım topolojisi (Render panelinden doğrulandı)

| Rol | Render servisi | Dal | URL |
|---|---|---|---|
| Web arayüzü | `zeus-one-betting` (static site) | `main` | https://zeus-one-betting.onrender.com |
| Üretim API'si | `zeus-one-betting-api` (web service) | `main` | https://zeus-one-betting-api.onrender.com |
| İzole ledger staging API'si | `zeus-ai-ledger-staging` (web service) | `feat/neon-durable-prediction-ledger` | https://zeus-ai-ledger-staging.onrender.com |

Üç servis de Render panelinde otomatik commit dağıtımı açık olarak görünüyor. Üretim frontend/backend servisleri `main` dalını izliyor; staging servisi yalnızca ledger özelliği dalını izliyor. Staging için görünen plan ücretsiz; çalışma ortamı Frankfurt. Bu nedenle ücretsiz servislerin soğuk başlangıç/gecikme davranışı ayrıca değerlendirilmelidir.

## Aşama 6 doğrulama kanıtları

- PR #34 açık, taslak ve birleştirilmemiş durumda: https://github.com/Serhattutak/futbol-tahmin/pull/34
- CI çalıştırması #350 başarılı: https://github.com/Serhattutak/futbol-tahmin/actions/runs/38782909143
- Staging dağıtımı `dep-db8hcd04ufvs73aqat60` canlı durumda; commit `3ec0138d6f4991213ca99bf5cf14e037a3ca5766`.
- Render loglarında yeniden başlatma sonrası `LEDGER_RUNTIME_READY` kaydı görüldü: Neon modu, 20 event, 20 tahmin, 0 settlement, 0 conflict.
- Loglarda sağlık, provider status, capture status, ledger status, ledger performance ve comparison uç noktaları için HTTP 200 kayıtları görüldü.
- Tarih bazlı fixture kontrolleri 2025-10-12, 2026-10-15 ve 2026-10-16 için HTTP 200 döndürdü. 2026-10-15 kontrolü yaklaşık 10,3 saniye, 2026-10-16 kontrolü yaklaşık 4,4 saniye sürdü; bu süreler tek gözlem olup SLA/ortalama değildir.
- Neon staging toplamı: 20 event / 20 benzersiz event ID / 20 benzersiz ledger ID / 20 tahmin / 0 settlement / 0 conflict / 0 null payload.

## Açık engeller — canlıya geçiş yapılmamalı

1. **Gerçek ileriye dönük doğrulama yok:** Staging ledger'da gerçek sonuçla kapatılmış tahmin sayısı sıfır. Gerçek maç sonuçlarıyla settlement oluşmadan yeni modelin performansı veya kalibrasyonu hakkında iddia yapılmamalı.
2. **Model üstünlüğü kanıtlanmadı:** Saklanan tarihsel Model 4.0 değerlendirmesi 1.686 maç, 1X2 doğruluğu %48,58, Brier 0,6277 ve log loss 1,0464 olarak raporlanmıştı. Bu, yeni bir Model 4.1 ileriye dönük testi değildir.
3. **Node sürümünü sabitleme:** Staging build logu varsayılan Node.js 24.21.0 kullandığını gösterdi. Üretim ve staging için desteklenen Node sürümü repo ve Render ayarlarıyla açıkça sabitlenip aynı sürümde test edilmelidir.
4. **Dağıtım belgeleri:** README'deki Vercel ifadesi gerçek Render servis topolojisiyle uyumlu değildi; bu aşama PR'ında Render olarak düzeltildi. Render dashboard ayarları ile repodaki açıklamalar ayrıca karşılaştırılmalı.
5. **Canlı uç nokta dış doğrulaması:** Bu doğrulama turunda web görüntüleyicisi staging API yanıt gövdelerini açamadı. HTTP 200 kanıtı Render uygulama loglarından geldi; harici istemciyle tam JSON şeması/alan doğrulaması tamamlanmış sayılmamalı.
6. **Veri sağlayıcı dayanıklılığı:** Sağlayıcıların boş veri, zaman aşımı, limit aşımı, eski veri ve birbiriyle çelişen sonuç durumlarında fail-closed davranışı staging'de tekrar test edilmeli. Sağlayıcı erişimi varmış gibi varsayım yapılmamalı.

## Canlıya geçiş öncesi zorunlu kapılar

- [ ] PR #34 gözden geçirildi; testler ve migration/şema davranışı bağımsız incelendi.
- [ ] Üretim veritabanı için ayrı bağlantı/kimlik bilgileri ve açık onaylı migration planı hazırlandı; staging kimlik bilgileri üretimde kullanılmıyor.
- [ ] Tahmin yazımı idempotent; yinelenen istek, yeniden başlatma, DB erişim kesintisi ve şema uyumsuzluğu senaryoları test edildi.
- [ ] Sonuç doğrulaması birden fazla güvenilir kaynağa dayanıyor; çelişkiler otomatik olarak kesin sonuç sayılmıyor.
- [ ] Gerçek bitmiş maçlarda settlement ve performans metrikleri toplandı; yeterli örneklem oluşmadan model değişimi yapılmıyor.
- [ ] İzleme, hata alarmları, loglarda hassas veri kontrolü, yedekleme ve geri dönüş prosedürü yazılı.
- [ ] Render üretim servislerinin env, branch, build/start komutları, CORS ve sağlık kontrolleri tekrar doğrulandı.
- [ ] Ayrı, açık kullanıcı onayı olmadan PR merge edilmedi, üretim env değiştirilmedi ve canlı cutover başlatılmadı.

## Karar

**Durum: staging teknik doğrulaması başarılı; üretim geçişi henüz onaylanabilir durumda değil.** Öncelik gerçek settlement verisi ve ileriye dönük performans kanıtı; sonrasında bağımsız PR incelemesi ve ayrı açık onay. Bu belge üretim sisteminde hiçbir ayar değiştirmez.
