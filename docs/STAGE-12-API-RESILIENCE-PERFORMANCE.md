# ZEUS AI — Aşama 12: API dayanıklılığı ve performans güvenliği

Durum: dal üzerinde kod ve regresyon testleri; CI ve uçtan uca doğrulama geçmeden tamamlanmış sayılmaz.

## Kapsam

- Mevcut `backend/services/concurrencyGuard.js` IP + rota bazlı eşzamanlılık sınırını uygular; istek `finish` veya erken `close` olduğunda slotu yalnızca bir kez bırakmalıdır.
- Mevcut `backend/services/forEachConcurrent.js` işleyici sayısını verilen pozitif tam sayı ile sınırlar, boş diziyi güvenle işler ve işleyici hatalarını çağırana iletir.
- `backend/test/forEachConcurrent.test.js` bu yardımcı için tekrarlanabilir regresyon testleri ekler.

## Kabul ölçütleri

1. Her girdi tam bir kez işlenir; eşzamanlı işleyici sayısı tanımlanan sınırı aşmaz.
2. Boş girdi işleyici çağırmadan tamamlanır.
3. Dizi olmayan girdiler ve geçersiz eşzamanlılık değerleri doğru hata türüyle reddedilir.
4. İşleyici hatası sessizce yutulmaz; çağırana iletilir.
5. Mevcut concurrency guard testleri ve tüm backend test paketi geçer.
6. İlgili GitHub Actions kontrolleri geçer; staging API sözleşme kontrolü yalnızca salt okunur GET istekleri kullanır.

## Doğrulama sınırları

- Sentetik testler canlı veri sağlayıcılarının erişilebilirliğini, fikstür kapsamını veya tahmin kalitesini kanıtlamaz.
- CI'daki salt okunur staging kontrolleri üretim tahmini/sonuç kayıtlarına yazmamalıdır.
- Canlı sağlayıcı, veri kalitesi, kalıcılık/yeniden yükleme, sonuç kesinleştirme ve çakışma/hata senaryoları ayrı kanıtlarla doğrulanmadan bu aşama tamamlanmış kabul edilmez.
- Test sonuçları çalıştırılmadan başarılı olarak raporlanmaz.

## Değişiklik ve yayın güvenliği

- Bu aşama için production deploy, production DB/ledger yazımı veya model değişikliği yapılmaz.
- Model 4.0 varsayılan kalır; Model 4.1/4.2'ye geçiş bu aşamanın parçası değildir.
- Birleştirme sırası korunur: #37 → #38 → #39 → #40 → Stage 12 PR.
