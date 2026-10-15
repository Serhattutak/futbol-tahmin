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

## Yayına almadan önce
1. AdSense ve Google Ad Manager hesaplarını/reklam birimlerini oluşturup onayları tamamla.
2. Hedef coğrafyaya uygun Google sertifikalı CMP/consent çözümü kur. Basit tercih arayüzü, EEA/Birleşik Krallık/İsviçre için CMP gereksinimini tek başına karşılamaz.
3. Gerçek işletmeci bilgileri, veri işleme amaçları, saklama süreleri ve iletişim kanalıyla gizlilik/çerez bildirimlerini tamamla.
4. Reklam bulunmaması, reklam engelleyici ve ödül verilmemesi durumlarını test et.
5. Reklamları kesin kazanç veya garantili tahmin iddiası gibi sunma.

Bu dosya kod altyapısının tek başına gelir başlatmadığını açıklar. Değişiklikler geliştirme dalında kalır; üretime aktarılmaz.