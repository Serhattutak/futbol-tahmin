# ZEUS AI — Aşama 08: Veri Kalitesi ve Maç Öncesi Kontrol Sistemi

Durum: uygulama ve otomatik testler eklendi; CI doğrulaması bekleniyor. Bu belge canlıya geçiş onayı değildir.

## Amaç

Tahmin analizine yalnızca doğrulanabilir, eksiksiz ve maç başlamadan önce kullanılabilir fikstürlerin girmesini sağlamak. Belirsiz veya çelişkili kayıtlar tahmin önerisine dönüştürülmez.

## Uygulanan kapılar

```js
assessPreMatchFixture(fixture, { now, stale, providerError })
```

- Başlama saati geçerli ve saat dilimi açık olmalı; yalnızca tarih içeren kayıtlar reddedilir.
- Başlama zamanı mevcut zamandan kesin olarak ileri olmalı.
- Durum yalnızca `SCHEDULED` kabul edilir. Canlı, bitmiş, ertelenmiş, iptal edilmiş ve tanınmayan durumlar reddedilir.
- Lig ve iki takım adı bulunmalı; ev/deplasman takımları aynı olamaz.
- Kaynak/sağlayıcı kökeni bulunmalı.
- Çelişkili fikstür, eski veri işareti veya sağlayıcı keşif hatası varsa kayıt reddedilir.
- Ret nedenleri makine tarafından okunabilir kodlar olarak döner ve `PRE_MATCH_QUALITY_REJECTED` kaydıyla loglanır.
- `/api/best-predictions` içinde kalite kapısından geçemeyen maç için analiz çalıştırılmaz; bu maç öneri listesine giremez.

## Test kapsamı

`backend/test/preMatchDataQuality.test.js` aşağıdaki durumları kapsar:
- Gelecekteki, eksiksiz ve kaynak bilgisi olan fikstür kabulü.
- Belirsiz/tarihsiz saat, saat dilimi eksikliği ve başlamış maç.
- Canlı, bitmiş, ertelenmiş, iptal edilmiş ve bilinmeyen durumlar.
- Veri çelişkisi, eksik lig/takım, aynı takımın iki tarafta olması.
- Kaynak bilgisinin olmaması, eski veri işareti ve sağlayıcı hatası.
- Ret nedenlerinin tekilleştirilmesi.

## Sınırlar ve kalan doğrulama

- Bu kapı bir sağlayıcının doğruluğunu kendi başına kanıtlamaz; yalnızca mevcut alanları ve açık hata/eskilik işaretlerini denetler.
- Fikstür kaynağına göre maç durumu ve ertelenme bilgisinin bağımsız doğrulaması, kaynaklar arası güvenilirlik puanlaması ve her sağlayıcı için hata enjeksiyon testleri sonraki alt görevlerdir.
- Staging/CI başarılı olmadan Aşama 08 tamamlandı sayılmaz.
- PR taslak ve birleştirilmemiş kalır. Model 4.0 üretim varsayılanı değişmez; Render ayarları, üretim veritabanı ve canlı dağıtım değiştirilmez.
