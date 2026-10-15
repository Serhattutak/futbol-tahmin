# ZEUS AI reklam gelir sistemi

- Banner reklamları Google AdSense üzerinden, gerçek yayıncı ve slot kimlikleriyle çalışır.
- Ödüllü reklam Google Ad Manager rewarded formatı üzerinden ve kullanıcı isteğiyle açılır.
- Ödül yalnızca reklam gerçekten tamamlandığında verilir; tahmin olasılıklarını veya model sonuçlarını değiştirmez.
- Reklam kimlikleri eksikse reklam alanları gösterilmez. Sahte reklam veya gelir verisi üretilmez.

## Kamuya açık yasal bilgilendirme
- `VITE_OPERATOR_NAME`: Gizlilik/kullanım ekranında gösterilecek gerçek işletmeci veya işletme unvanı.
- `VITE_CONTACT_EMAIL`: Kullanıcıların gizlilik ve veri talepleri için kullanacağı, yayınlanmasına izin verilen iletişim adresi.
- Bu iki değer doğrulanmadan siteyi reklam onayına hazır kabul etme. Ekran, eksik değerlerde yapılandırma uyarısı gösterir; uydurma kimlik veya iletişim bilgisi kullanmaz.

## Ortam değişkenleri
- `VITE_ADSENSE_CLIENT_ID`: AdSense yayıncı kimliği (`ca-pub-...`)
- `VITE_ADSENSE_BANNER_SLOT_ID`: AdSense banner birimi kimliği
- `VITE_GAM_REWARDED_AD_UNIT_PATH`: Google Ad Manager rewarded birim yolu (ör. `/1234567/zeus/rewarded`)

Bunlar Vercel projesinin frontend build environment variables bölümüne eklenir. Gerçek reklam için hesap onayı ve geçerli reklam birimleri gerekir.

## Uygulama sırası
1. ZEUS AI'nin gerçek alan adını netleştir ve AdSense hesabına site olarak ekle.
2. AdSense site doğrulamasını ve inceleme/onay sürecini tamamla. Alan adı ve yayıncı kimliği olmadan `ads.txt` içeriği uydurma.
3. AdSense'ten gerçek yayıncı kimliğini (`ca-pub-...`) ve oluşturulan banner reklam birimi kimliğini al.
4. Bu değerleri önce **Vercel Preview** ortam değişkenlerine ekle: `VITE_ADSENSE_CLIENT_ID`, `VITE_ADSENSE_BANNER_SLOT_ID`. Gerçek işletmeci ve iletişim bilgilerini de `VITE_OPERATOR_NAME`, `VITE_CONTACT_EMAIL` olarak gir. Değerleri Git'e yazma.
5. Preview build'de `npm run ads:check` çalıştır. Zorunlu reklam yapılandırmasını doğrulamak için `ZEUS_ADS_REQUIRED=true npm run ads:check` kullan; bu kontrol sadece biçimi doğrular.
6. Hedef coğrafyaya uygun, Google tarafından sertifikalı CMP/consent çözümünü yapılandır ve reddetme/tercih değiştirme akışlarını test et. Mevcut basit kabul/reddet arayüzü tek başına sertifikalı CMP yerine geçmez.
7. Boş reklam envanteri, reklam engelleyici, mobil yerleşim, tekrar script yüklenmesi ve reklam yokken uygulamanın çalışması senaryolarını doğrula.
8. Ödüllü reklamı ayrı aşamada Google Ad Manager birim yolu ile etkinleştir; ödül yalnızca Google'ın `rewardedSlotGranted` olayı geldiğinde verilsin.
9. Yayına geçişten önce gizlilik/çerez metinlerini ve alan adına uygun `ads.txt` kaydını tamamla.

## Güvenli varsayılanlar
- Reklam kimlikleri boşsa gerçek reklamlar yüklenmez ve gelir varmış gibi raporlanmaz.
- `npm run ads:check` boş yapılandırmayı, reklamlar kapalı olduğu sürece beklenen durum sayar. `ZEUS_ADS_REQUIRED=true` ise eksik yapılandırma build öncesi kontrolü başarısız kılar.
- `npm run ads:check` AdSense site onayını, CMP uygunluğunu, gerçek reklam gösterimini veya gelir oluştuğunu doğrulamaz.
- Hesap/alan adı/kimlik bilgileri verilmediğinden bu değişiklik reklamları etkinleştirmez; sadece güvenli ön kontrol sağlar.

Bu çalışma geliştirme dalında kalır; üretim reklamlarını veya ortam değişkenlerini değiştirmez.