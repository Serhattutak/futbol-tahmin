# Historical Coverage V2 — tamamlanma raporu

Doğrulama, önceki audit'in 17 Eylül 2026 16:44:12.530 UTC anındaki aynı 253 gerçek fixture'ı üzerinde yapıldı. Yeni API/provider ağ isteği: **0**. Production capture: **0**. Prediction Ledger yazımı: **0**. Çalışan backend yeniden başlatılmadı; production adapter ve model akışı izole doğrulama sürecinde çalıştırıldı.

Makine raporu: [historical-coverage-v2.json](historical-coverage-v2.json). Dry-run: [historical-v2-forward-dry-run.json](historical-v2-forward-dry-run.json). Bütünlük: [historical-v2-integrity.json](historical-v2-integrity.json).

1. **Yeni historical akışı:** Mevcut registry ve model giriş formatı korunarak OpenFootball adapter'ına division-aware toplayıcı bağlandı. Önce kurulu gerçek OpenFootball kaynakları ve mevcut read-only yerel sezon dosyaları değerlendirilir. Yeterli sonuç yoksa mevcut provider hattı devreye girebilir. Model matematiği veya eşikleri değiştirilmedi.

2. **Division geçişi:** Aynı ülkenin yapılandırılmış historical division'ları taranır; İspanya için La Liga ve Segunda División. Her maç kendi lig, sezon, tarih, takım, skor ve provider bilgisini korur. Cross-country veya fuzzy isim eşleşmesi yapılmaz.

3. **Season fallback:** Mevcut sezon, önceki sezon, iki sezon önce; en çok 10 tamamlanmış maç. Mevcut sezon yeterliyse eski sezonlara gidilmez. Tüm local-first geçişi tamamlanmadan network fallback başlamaz. Yerelde yeterli tarihçe bulunması en yeni upstream verinin eksiksiz olduğu garantisi değildir; aşağıdaki freshness sınırları geçerlidir.

4. **Source priority:** Yerel OpenFootball kanıtı önce; yetersizse mevcut registry sırası OpenFootball → Sportmonks → football-data → API-Football → TheSportsDB. Kullanılabilirlik ve mevcut kotalar korunur. API plan engeli aşılmaya çalışılmaz. Bu doğrulamada remote kaynaklar çağrılmadı.

5. **Deduplication:** Provider içi fixture ID ve provider'lar arası ülke, lig, gün, ev/deplasman kimliği kullanılır. Provider'lar arasında saat veya skor çelişkisi varsa aynı meeting karantinaya alınır. Farklı gerçek fixture ID'lerine sahip aynı-provider kayıtları sadece benzer isim diye birleştirilmez. Kaynaklar arasındaki çelişkiler sonraki provider tarafından yeniden canlandırılmaz.

6. **Team identity:** Mevcut canonical takım kimliği ve provider ID'leri kullanılır. Belirsiz normalize isimler reddedilir. Doğrulanmış explicit OpenFootball ID geçişi: `of-team-realvalladolid` → `of-team-realvalladolidcf`; Real Valladolid'in iki division dosyasındaki ad farkı için regression testi var. Otomatik fuzzy alias: 0. Malaga eşlemesi zaten çalışıyordu.

7. **Historical ligler:** Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Scottish Premiership ve yeni Segunda División. Bunlar historical lookup yapılandırmasıdır; her sezonun eksiksiz olduğu anlamına gelmez. Fixture discovery listesi genişletilmedi; Segunda yalnızca historical kabiliyete eklendi. Cup ve diğer kapsam dışı ligler bu değişiklikte otomatik desteklenmiş sayılmadı.

8. **Segunda:** Audit'teki gerçek 2024-25 ve 2025-26 kaynakları kurulu historical kaynak setine alındı. Tüm yeni kurulu kaynaktaki 4.938 satırın tarih, durum, takım isimleri ve skorları orijinal audit kanıtıyla birebir karşılaştırıldı. Normalizasyon kaynak kimlikleriyle sınırlı; maç/sonuç uydurulmadı. Benchmark dosyaları yalnızca okunur.

9. **Malaga–Villarreal (1570390):** Önce **4/10**, şimdi **10/10**. Malaga: 4 La Liga + 6 Segunda sonucu; Villarreal: 10 La Liga sonucu. Her iki takım ≥5 şartını sağlıyor; Model 4.1 input gate ready. Eşikler düşürülmedi.

10. **Kullanılan maçlar:** Raporun sonundaki iki tabloda tüm 20 kayıt yer alıyor. Hedef kickoff: **2026-09-17 19:30 UTC**. Tarihler normalize edilmiş kaynak zamanlarıdır. Tüm kayıtlar hem hedef kickoff'tan hem dondurulmuş audit zamanından önce.

11. **Eski funnel:** **253 → 1 → 1 → 1 → 0 → 0**.

12. **Yeni funnel:** **253 → 1 → 1 → 1 → 1 → 1**. Sıra: pencere → desteklenen historical lig → eşleşen iki takım → iki takımın geçmişi mevcut → ≥5/5 → input-ready. League mapping **1/253**, desteklenen fixture içinde team mapping **2/2**. Diğer 252 fixture'ın tüm sağlayıcılarda verisiz olduğu sonucu çıkarılamaz.

13. **Örneklem dağılımı ve artış:** Aynı configured-route karşılaştırmasında 506 takım slotu: önce 504 sıfır, 1 adet 1–4, 1 adet 10; şimdi 504 sıfır, 0 adet 1–4, 0 adet 5–9, 2 adet 10. ≥5 takım slotu **1 → 2**; ≥5/5 fixture **0 → 1**; input-ready **0 → 1**. Eski audit'te V1 cache dahil bulunan Uruguay U19 çiftinin 1/1 örneği yeni V2 cache'e otomatik taşınmadı; eski cache silinmedi. Bu iki slot zaten hiçbir minimum örnek şartını sağlamıyordu.

14. **Forward Capture DRY-RUN:** Üretimde kullanılan ForwardCapture ve ProductionAnalysis sınıfları, aynı gerçek frozen cohort ve izole docs state diziniyle çalıştırıldı. 253 pencere fixture, 3 analiz, 1 eligible çift, 2 would-capture model kaydı, 250 probe-limit deferred, 2 insufficient, 0 hata. Yazılan fixture/tahmin/ledger kaydı **0**. Bu, dondurulmuş cohort tekrarını gösterir; bugünkü canlı capture performansı olarak sunulmaz. Scheduler başlatılmadı.

15. **Leakage:** Seçilen 20 geçmiş maçta strict kickoff karşılaştırmasının ihlali **0**. Regression testleri hedef fixture'ı, eşit kickoff'u, aynı gün daha sonraki maçı ve kickoff sonrasını dışladığını doğruluyor. Date-only kayıtlar gün sonunda değerlendirilir. Model 4.1'in mevcut previous-day kesimi değişmedi. OpenFootball'ın timezone belirtilmeyen zamanlarının gerçek saat dilimi doğruluğu ayrı, çözülmemiş kaynak sorunudur.

16. **Cache/versioning:** `cross-division-v2` ve `sources-v1`, takım provider/ID, ülke/lig ve hedef kickoff cache key'e girer. Yeni `.v2.json` dosyası eskisinden ayrıdır; V1 sonuçları V2'yi override edemez. Concurrent istekler birleştirilir, başarılı sonuçlar 6 saat; boş/geçici hata 1 dakika. Analysis cache statisticsVersion da V2'yi içerir. Yanıtta `history` metadata'sı: home/away sayıları, ligleri, kaynakları, en eski/yeni tarih ve strategy version. Frontend'e yeni arayüz eklenmedi.

17. **Test/build/syntax/lint:** **176/176 PASS** (önceki 165 + 11 regression). Build PASS. Sekiz dosyada syntax PASS. Değişen yedi JS dosyasında lint temiz. Tam `npm run lint` exit 0; mevcut unrelated/generated browser dosyalarında uyarılar var, bu görevde değiştirilmediler.

18. **Integrity:** 28 korunan dosyada sapma 0; önceki manifestteki 18 benchmark dosyası aynı, benchmark 1.686 maç. Model 4.0/4.1 matematiği, calibration, artifact, .env değişmedi. Artifact codeHash valid. SHA-256: `8a2be7d9c4fe131bbf6959c43be2b0245152478dec339d2f783ffb6bc2d72b82`. İki mevcut ledger dosyasının içeriği ve dosya kümesi değişmedi; yeni kayıt yok.

19. **Değiştirilen/eklenen dosyalar:** `backend/providers/openFootball.js`, `backend/services/divisionHistory.js`, `backend/services/historyCacheV2.js`, `backend/services/multiProviderRegistry.js`, `backend/services/productionAnalysis.js`, `backend/data/historical-sources.json`, `backend/test/divisionHistory.test.js`, `backend/scripts/auditHistoricalCoverageV2.js`; bu Markdown, JSON audit/dry-run/integrity raporları, doğrulama logları ve izole dry-run docs state çıktısı. Build standart dist çıktısını üretti. Önceden bekleyen değişiklikler geri alınmadı; server/model dosyaları bu görevde değiştirilmedi.

20. **Kalan teknik sorunlar:** 252 fixture yapılandırılmış historical lig kapsamı dışında. Güncel API sezon plan engeli devam ediyor. Scottish 2026-27 yok; önceki sezon eksik. Segunda'nın yerel 2025-26 sonuçları eksik: Malaga için en yeni önceki-division sonucu **2 Kasım 2025**; kullanılan eski geçmiş Eylül–Kasım 2025 aralığında. Bu yüzden 10/10 örnek, tam güncel form veya yüksek tahmin kalitesi garantisi değildir. Local-first yeterli veri bulduğunda upstream tazelemez; veri güncelleme/freshness politikası sonraki ayrı çalışmadır. Kaynak saat dilimi, diğer takım alias'ları ve kapsam dışı ligler ayrıca ele alınmalıdır. Model 4.2 veya yayın/deploy işlemi yapılmadı.


## Malaga ? 10 historical matches

| UTC | League/division | Home | Away | Score | Source |
|---|---|---|---|---|---|
| 2026-09-06 18:30:00 | La Liga | Málaga CF | Levante UD | 0-0 | openfootball |
| 2026-08-30 17:00:00 | La Liga | Real Madrid CF | Málaga CF | 4-0 | openfootball |
| 2026-08-24 21:30:00 | La Liga | Málaga CF | RC Deportivo La Coruña | 1-1 | openfootball |
| 2026-08-19 21:00:00 | La Liga | Club Atlético de Madrid | Málaga CF | 2-0 | openfootball |
| 2025-11-02 17:30:00 | Segunda División | CD Castellón | Málaga CF | 2-1 | openfootball |
| 2025-10-26 13:00:00 | Segunda División | Málaga CF | FC Andorra | 4-1 | openfootball |
| 2025-10-19 13:00:00 | Segunda División | CD Leganés | Málaga CF | 2-0 | openfootball |
| 2025-10-12 20:00:00 | Segunda División | Málaga CF | Deportivo La Coruña | 3-0 | openfootball |
| 2025-10-05 17:30:00 | Segunda División | Racing Santander | Málaga CF | 3-0 | openfootball |
| 2025-09-28 15:15:00 | Segunda División | Burgos CF | Málaga CF | 2-1 | openfootball |

## Villarreal ? 10 historical matches

| UTC | League/division | Home | Away | Score | Source |
|---|---|---|---|---|---|
| 2026-09-05 21:00:00 | La Liga | Villarreal CF | RC Deportivo La Coruña | 2-3 | openfootball |
| 2026-08-28 21:30:00 | La Liga | Deportivo Alavés | Villarreal CF | 1-0 | openfootball |
| 2026-08-23 17:00:00 | La Liga | Club Atlético de Madrid | Villarreal CF | 2-2 | openfootball |
| 2026-08-16 17:00:00 | La Liga | Real Racing Club de Santander | Villarreal CF | 2-2 | openfootball |
| 2026-05-24 21:00:00 | La Liga | Villarreal CF | Club Atlético de Madrid | 5-1 | openfootball |
| 2026-05-17 19:00:00 | La Liga | Rayo Vallecano de Madrid | Villarreal CF | 2-0 | openfootball |
| 2026-05-13 19:00:00 | La Liga | Villarreal CF | Sevilla FC | 2-3 | openfootball |
| 2026-05-10 14:00:00 | La Liga | RCD Mallorca | Villarreal CF | 1-1 | openfootball |
| 2026-05-02 14:00:00 | La Liga | Villarreal CF | Levante UD | 5-1 | openfootball |
| 2026-04-26 21:00:00 | La Liga | Villarreal CF | RC Celta de Vigo | 2-1 | openfootball |
