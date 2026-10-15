# ZEUS AI — Futbol Analizi

ZEUS AI, futbol maçlarını mevcut ve doğrulanabilir veriler üzerinden analiz eden bir web uygulamasıdır. Tahminler kesin sonuç veya kazanç garantisi değildir.

## Ürün ilkeleri

- **Gerçek veri:** Veri sağlayıcısından doğrulanamayan istatistikler, oranlar veya olasılıklar uydurulmaz.
- **Yetersiz veri:** Güvenilir analiz için veri yeterli değilse sistem tahmin üretmek yerine bunu açıkça belirtir.
- **Model güvenliği:** Üretimde kullanılan Model 4.0 varsayılan olarak korunur. Model 4.1, kronolojik ileriye dönük testlerle doğrulanmadan üretim modelinin yerine geçirilmez.
- **Şeffaflık:** Eksik kadro, sakatlık, oran veya diğer veri alanları mevcutmuş gibi gösterilmez.

## Teknoloji

- Frontend: React, Vite
- Backend: Node.js, Express
- Güvenlik ve istek sınırlandırma: Helmet, express-rate-limit
- Dağıtım yapılandırması: Vercel (vercel.json)

## Yerel geliştirme

Node.js 22 önerilir.

### Frontend

    npm ci
    npm run dev

### Backend

    cd backend
    npm ci
    cp .env.example .env
    npm test
    npm start

Frontend ve backend farklı adreslerde çalışıyorsa, backend/.env içindeki CORS_ORIGINS değerini yerel frontend adresine göre ayarlayın. Veri sağlayıcılarının token gerektiren özellikleri yalnızca geçerli anahtarlar tanımlandığında kullanılabilir. Gizli anahtarları GitHub'a commit etmeyin.

## Kontroller

    npm run lint
    npm run build
    cd backend
    npm test

Pull request doğrulamasında en son bilinen sonuç: Vite production build başarılı, 184 test başarılı ve 0 başarısız. Lint adımı halen uyarılar üretiyor; bu uyarılar üretim öncesi incelenmelidir.

## Reklam sistemi

Reklam altyapısı isteğe bağlıdır. AdSense ve Google Ad Manager kimlikleri tanımlı değilse gerçek reklam gösterimi veya reklam geliri varsayılmaz. Yayından önce yayıncı hesabı ve reklam birimleri onaylanmalı; hedef bölgeye uygun izin/CMP çözümü ile gizlilik ve çerez açıklamaları tamamlanmalıdır. Kurulum adımları için docs/AD-MONETIZATION-SETUP.md dosyasına bakın.

## Yayına alma yaklaşımı

1. Değişiklikleri geliştirme dalında doğrulayın.
2. CI, build ve regresyon testlerini kontrol edin.
3. Canlı maç/veri akışını, hata durumlarını ve mobil arayüzü kontrol edin.
4. Üretime geçişten önce gizlilik, güvenlik, sağlayıcı limitleri ve dağıtım ortamı ayarlarını doğrulayın.

Bu depo için hazırlanan geliştirmeler, açık onay olmadan ana dala birleştirilmez veya üretime dağıtılmaz.
