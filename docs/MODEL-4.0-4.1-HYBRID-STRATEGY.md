# ZEUS AI — Model 4.0 + 4.1 hibrit stratejisi

Tarih: 2026-10-15

## Karar

Model 4.0 silinmez veya değiştirilmez; karşılaştırma ve geri dönüş referansı olarak korunur. Model 4.1, 4.0'ın Poisson tabanlı olasılıklarını başlangıç/prior sinyali olarak alıp tarihsel takım özelliklerinden öğrenilmiş sınıflandırıcı ve kalibrasyon katmanıyla 1X2 olasılıklarını düzeltir. 4.1'in Poisson gol modeli de beklenen gol ve gol pazarlarını üretir. Bu mimari, 4.0'ın açıklanabilir form/Poisson temelini ve 4.1'in öğrenilmiş düzeltme + kalibrasyon katmanını bir araya getiren aday hibrit yaklaşımdır.

## Kilitli tarihsel test

Model 4.1 raporunda test örneklemi 533 maçtır. Aynı kilitli test karşılaştırmasında:

| Ölçüt | Model 4.0 referansı | Model 4.1 kalibre edilmiş |
|---|---:|---:|
| 1X2 Brier (düşük daha iyi) | 0.6381 | 0.6221 |
| 1X2 log loss (düşük daha iyi) | 1.0584 | 1.0325 |
| 1X2 doğru sınıf | — | 252 / 533 |

Model 4.1'in bu örneklemde olasılık kalitesi bakımından daha iyi sonuç verdiği görülüyor. Bu, garanti edilmiş kârlılık veya her lig/pazar için üstünlük anlamına gelmez. Bu test dönemi önceki Model 4.0 benchmark'ında da yer aldığından tamamen hiç görülmemiş dış veri sayılmaz; Model 4.1 optimizasyonunda kilitli tutulmuştur. Test sonucu yeniden ayar yapmak için kullanılmamalıdır.

## Güvenlik ve veri ilkeleri

- Model 4.0 referans raporu ve tahmin dosyaları değiştirilmeyecek.
- Model 4.1'in kilitli artifact'i, kod hash'i ve final raporu değiştirilmeyecek.
- Test seti üzerinde yeni ağırlık, eşik veya kalibrasyon ayarı yapılmayacak.
- Eksik, eski veya çelişkili veri güvenilir veriymiş gibi doldurulmayacak; yetersiz veri için NO_BET / INSUFFICIENT_DATA davranışı korunacak.
- Model 4.1 yalnızca açık model seçimiyle çalıştırılabilir; bu doküman üretim ortamındaki `PREDICTION_MODEL` değişkenini değiştirmez.
- Canlı varsayılan 4.0 olarak kalır. 4.1/hibridin üretim varsayılanı olması için ayrı onay, staging'de doğrulama ve gerçek ileriye dönük settlement verisi gerekir.

## Aşama 7 kabul kapıları

1. Kilitli tarihsel test ve baseline bütünlük testleri geçmeli.
2. Sağlayıcı boş yanıtı, zaman aşımı, kota/429, eski veri ve çelişkili sonuç senaryolarında fail-closed davranış test edilmeli.
3. Staging endpoint'lerinin yanıt şeması dış istemciyle doğrulanmalı; yalnızca HTTP 200 yeterli sayılmamalı.
4. Ledger idempotency, yeniden başlatma, DB kesintisi, şema uyumsuzluğu ve settlement çatışmaları test edilmeli.
5. Render üretim ayarları, geri dönüş adımları, loglarda hassas veri kontrolü ve alarm planı gözden geçirilmeli.
6. PR'lar incelenip tüm CI kontrolleri geçmeden ve ayrı açık canlıya geçiş onayı alınmadan merge/cutover yapılmamalı.

## Durum

Hibrit model mimarisi ve kilitli tarihsel değerlendirme belgelenmiştir. Bu belge tek başına Aşama 7'nin tamamen bittiği veya üretime hazır olduğu anlamına gelmez. Üretim ayarları bu değişiklikle değiştirilmez.
