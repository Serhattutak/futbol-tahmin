# ZEUS AI — Aşama 09: Sağlayıcı Dayanıklılığı ve Fallback

Durum: sentetik sağlayıcı arıza testleri ve CI doğrulaması başarılı. Bu aşama canlı sağlayıcıların bugün erişilebilir olduğunu iddia etmez.

## Kapsam

Aşama 09, çoklu sağlayıcı keşif akışının arıza durumlarında doğru davranmasını sınar:

- Bir sağlayıcı hata verirken diğer sağlayıcıdan alınan geçerli fikstürlerin korunması.
- Tüm sağlayıcılar başarısız olduğunda sahte fikstür üretilmemesi ve hataların kategoriyle raporlanması.
- Boş sağlayıcı yanıtının başarıyla veri sağlanmış gibi değerlendirilmemesi; `no_data` olarak kaydedilmesi.
- Son başarılı fikstür listesinin yeniden doğrulama sırasında sağlayıcı hatası olsa da silinmemesi; listenin `stale` olarak işaretlenmesi.
- Kota hatasından sonra cooldown süresince sağlayıcıya tekrar istek gönderilmemesi.

## Test dosyası

`backend/test/providerResilience.test.js`

Bu testler kontrollü/sentetik sağlayıcı adaptörleriyle çalışır; gerçek API çağrısı yapmaz ve canlı tahmin/ledger kaydı üretmez. CI çalıştırması [#361](https://github.com/Serhattutak/futbol-tahmin/actions/runs/38791991482) tüm adımlarda başarılı tamamlandı.

## Kabul ölçütleri

1. `npm test` ve CI doğrulama akışı başarılı.
2. Fallback sağlayıcısı geçerli veri döndürürken birincil kaynağın hata kategorisi kaybolmaz.
3. Tüm sağlayıcılar başarısızsa sonuç listesi boş kalır; veri uydurulmaz.
4. Stale cache açıkça işaretlenir ve son başarılı kayıt korunur.
5. Kota cooldown'ı aynı sağlayıcıya tekrarlanan istekleri engeller.

## Sınırlar ve sonraki doğrulama kapıları

- Bu aşama tarihsel olarak ölçülmüş sağlayıcı uptime puanı üretmez.
- Bağımsız çapraz sağlayıcı maç durumu doğrulaması ve canlı staging arıza enjeksiyonu henüz yapılmadı.
- PR taslak kalır; Stage 08 taban dalı birleştirilmeden bu aşama da ana dala alınmamalıdır.
- Üretim modeli Model 4.0 olarak kalır; Render ve üretim veritabanı değişmez.
