# ZEUS AI — Aşama 1–6 Model 4.0 + 4.1 revizyonu

Tarih: 2026-10-15  
Kapsam: Aşama 1–6 çalışmalarına hibrit model kararını eklemek. Bu değişiklik dokümantasyon ve entegrasyon planıdır; tek başına kodun veya canlı dağıtımın değiştiği anlamına gelmez.

## Sabit karar

- Model 4.0 mevcut üretim varsayılanı ve geri dönüş referansı olarak kalır.
- Model 4.1'in öğrenilmiş 1X2 düzeltmesi, kalibrasyon katmanı ve Poisson gol modeli hibrit adayın bileşenleridir.
- Model 4.1'in kilitli artifact'i, model41-report.json, model41-test-predictions.json, Model 4.0 baseline raporu ve baseline tahminleri yeniden üretilmez veya değiştirilmez.
- Yeni ağırlıklar, eşikler ya da kalibrasyonlar kilitli test setine göre ayarlanmaz.
- Yetersiz/çelişkili/eski veri, bozuk artifact veya geçersiz olasılıkta Model 4.1'e güvenilmez; Model 4.0'a kontrollü dönüş veya NO_BET/INSUFFICIENT_DATA uygulanır.
- Bu revizyon PREDICTION_MODEL değerini, Render environment değişkenlerini veya üretim varsayılanını değiştirmez.

## Aşama 1–6 ile eşleştirme

### Aşama 1 — Canlı sistem ve veri kaynakları
- Birden fazla sağlayıcıdan gelen fikstür ve geçmiş maçlar normalize edilir.
- Model katmanları sağlayıcıya özgü ham payload yerine normalize edilmiş istatistiklerle çalışır.
- Sağlayıcı hata/boş veri durumlarında istatistikler uydurulmaz; eksik alanlar görünür kalır.
- Kabul ölçütü: aynı maç için iki modelin aynı tarih kesitinden üretilmiş, izlenebilir girdileri kullanması.

### Aşama 2 — Tarihsel kapsam ve veri sızıntısı
- Her iki modelin girdileri yalnızca maç başlangıcından önce bilinen, tamamlanmış maçlarla sınırlandırılır.
- Aynı gün oynanan veya gelecekteki sonuçlar geriye dönük özelliklere sızdırılmaz; yalnızca tarih içeren fikstürler için güvenli cutoff uygulanır.
- 4.1 için en az beş geçmiş maç ve artifact'in seçim cutoff'u sonrasında fikstür gereksinimi korunur; eksik kritik özelliklerde 4.1 uygun sayılmaz.
- Kabul ölçütü: tarihsel replay testleri geçmiş veri cutoff'unu ve feature provenance'ı doğrular.

### Aşama 3 — Model 4.0/4.1 değerlendirmesi
- 4.0'ın Poisson/form temeli korunur; 4.1'in öğrenilmiş sınıflandırıcı, kalibrasyon ve gol modeli ayrı sürüm olarak değerlendirilir.
- Kilitli 533 maçlık 1X2 testinde kalibre edilmiş 4.1 Brier 0.6221 ve log loss 1.0325; 4.0 referansı Brier 0.6381 ve log loss 1.0584 olarak raporlanmıştır. 4.1 doğru sınıf sayısı 252/533'tür.
- Bu, o test örnekleminde olasılık skorlamasının daha iyi olduğunu gösterir; bahis kârlılığını veya her lig/pazarda üstünlüğü kanıtlamaz. Test dönemi önceki 4.0 benchmark'ında bulunduğundan tamamen bağımsız dış test değildir.
- Kabul ölçütü: baseline hash'leri, 4.1 artifact hash'i ve final raporu değişmeden kalır.

### Aşama 4 — API, gölge analiz ve cache
- 4.0 ve 4.1 ayrı sürüm anahtarlarıyla hesaplanır; 4.1 sonuçları 4.0 cache girdileriyle karışmaz.
- Model 4.1 artifact hash'i ve istatistik sürümü cache anahtarına katılır; artifact doğrulaması cache hit'ten önce yapılır.
- Shadow/karşılaştırma yolu kullanıcıya seçili modelin yanıtını döndürürken iki modelin çıktısını ve fallback sebebini ölçebilir.
- API hata yanıtları, bozuk artifact veya yetersiz veri durumunda belirsizliği gizlememelidir.
- Kabul ölçütü: cache izolasyonu, tekrar istekleri, model seçimi, fallback ve olasılık toplamı regresyon testleri geçer.

### Aşama 5 — Arayüz ve açıklanabilirlik
- Arayüz model sürümünü, veri kalitesini, geçmiş maç örneklem büyüklüğünü ve varsa fallback nedenini açık göstermelidir.
- İki model karşılaştırması yalnızca aynı fikstür ve aynı veri cutoff'u için sunulur; eksik model sonucu sıfır veya gerçekmiş gibi gösterilmez.
- Ayrıntı analizi gerektiğinde tembel yüklenir; model seçimi ve hata durumlarında arayüz güvenli geri dönüş yapar.
- Kabul ölçütü: masaüstü ve mobil smoke testleri, tarih/lig filtresi, maç ayrıntısı, model karşılaştırması ve erişilebilir hata durumu.

### Aşama 6 — Test, teslim ve kalıcı kayıt
- Unit/regresyon testleri; model seçimi, artifact bütünlüğü, tarihsel cutoff, fallback, cache izolasyonu, API yanıt şeması ve mobil akışları kapsamalıdır.
- Kalıcı tahmin ledger'ı ayrı staging altyapısında idempotency, yeniden başlatma, settlement ve sonuç çelişkilerini test eder.
- Staging ledger'da 20 tahmin olayı bulunması ileriye dönük performans kanıtı değildir; doğrulanmış settlement sayısı şu an sıfırdır.
- Kabul ölçütü: ilgili CI yeni commit üzerinde başarılı, staging JSON yanıtları dış istemciyle doğrulanmış, sağlayıcı hata senaryoları tamamlanmış ve test raporu kaydedilmiş olmalıdır.

## Kilitli sınırlar

- Bu revizyon üretimde model değiştirmez, migration çalıştırmaz, Render ayarlarını güncellemez ve PR birleştirmez.
- Model 4.1 üretim varsayılanı yapılmaz.
- Model 4.2 veya yeni optimizasyon turu başlatılmaz.
- Aşama 7'de tanımlanan açık üretim geçişi kapıları ayrıca tamamlanmalıdır.

## Mevcut durum

Model sürüm seçimi, kilitli 4.1 artifact doğrulaması, tarihsel test artefaktları ve gölge analiz servisi depoda mevcut. Bu belge bunları Aşama 1–6 kapsamına bağlar; her bir kabul ölçütünün mevcut başlıkta canlı olarak tekrar doğrulandığını iddia etmez. Özellikle bu revizyon commit'inin CI sonucu, sağlayıcı hata matrisi ve staging yanıt gövdelerinin dış doğrulaması ayrıca teyit edilmelidir.
