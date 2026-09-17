# Historical Data Coverage Audit

Bu rapor 17 Eylül 2026 16:44:12.530 UTC anında dondurulmuş capture cohort'unu inceler. Yeni capture, inference, provider sorgusu veya Prediction Ledger yazımı yapılmadı. Önceki audit'in saklanmış gerçek kaynak yanıtları kullanıldı. Production koduna değişiklik uygulanmadı. Ayrıntılar ve fixture düzeyindeki kanıtlar: [historical-coverage-audit.json](historical-coverage-audit.json).

1. **Capture-window:** 253 fixture. Kaynak `forward-capture-resumed-dry-run.json`; bugün yeniden hesaplanan hareketli pencere değildir.

2. **Supported league coverage:** OpenFootball adapter'ında 8 lig yapılandırılmıştır. Cohort'ta bunların yalnızca La Liga'sı temsil edilir: 1/253 (%0,40). Diğer 252 fixture'ın bütün sağlayıcılarda desteksiz olduğu sonucu çıkarılamaz.

3. **League mapping:** Ülke + lig eşlemesi 1/253. Aynı lig adını başka ülkede taşıyan 25 fixture doğru şekilde kapsam dışındadır; örneğin başka ülkenin Premier League'i İngiltere'ye eşlenmemelidir. API-Football kimlikleri 253/253 fixture'da mevcuttur.

4. **Team mapping:** Desteklenen cohort fixture'ında 2/2 takım eşleşir; Malaga ve Villarreal için alias hatası yoktur. Toplam 506 takım slotunun yalnızca bu 2'si yapılandırılmış fallback liginde değerlendirilebilir. Diğer 504 slotu takım eşleme hatası diye sınıflandırmak yanlıştır. Genişletilmiş cache incelemesinde 9 farklı eşleşmeyen isim saptandı; bunların hiçbiri capture cohort'unda değildir.

5. **Historical data coverage:** Yapılandırılmış ligde her iki takım için geçmiş bulunan fixture 1/253 (Malaga 4, Villarreal 10). Yerel cache dahil herhangi bir geçmiş bulunan çift 2/253: diğer fixture 1640181, Uruguay U19–Venezuela U19, 1/1 örnek. Bu ikinci çift minimumu sağlamaz.

6. **Minimum sample:** İki takımın da en az 5 maçının bulunması şartını mevcut yerel/lig kapsamıyla sağlayan 0/253. Yetersiz veri null/NO_BET olarak korunur; tahmin üretilmedi.

7. **Coverage funnel:** 253 pencere fixture → 1 desteklenen lig → 1 lig eşlemesi → 1 çift takım eşlemesi → 1 lig geçmişi sorgulanabilir çift → 0 minimum örnek → 0 production input-ready. Önceki capture'ın eligible sayısı 0; audit inference sayısı 0. Production prediction eligibility, audit satırlarında bilinçli olarak null'dır.

8. **Lig bazında sonuçlar:** Aşağıdaki sayılar ilgili sezon dosyasında audit kesiminden önce tamamlanmış ve skoru bulunan maçları gösterir; takım başına örnek sayısı veya model eligibility değildir.

| Lig | Cohort fixture | 2024-25 | 2025-26 | 2026-27 |
|---|---:|---:|---:|---:|
| Premier League | 0 | 380 | 380 | 30 |
| La Liga | 1 | 370 | 380 | 41 |
| Bundesliga | 0 | 306 | 306 | 18 |
| Serie A | 0 | 370 | 380 | 30 |
| Ligue 1 | 0 | 306 | 305 | 27 |
| Eredivisie | 0 | 306 | 305 | 41 |
| Primeira Liga | 0 | 306 | 306 | 42 |
| Scottish Premiership | 0 | 228 | 63 | 0 — HTTP 404 |

9. **Alias/name normalization:** İncelenecek adaylar: Deportivo La Coruna → RC Deportivo La Coruña; Levante → Levante UD; Union Berlin → 1. FC Union Berlin; Monza → AC Monza; Sassuolo → US Sassuolo Calcio; Monaco → AS Monaco FC; Lens → Racing Club de Lens; Espanyol → RCD Espanyol de Barcelona. Racing Santander için incelenen lig/sezonlarda aday bulunamadı; bu tek başına alias hatasını kanıtlamaz. Manchester United / Manchester Utd / Man United mevcut normalizasyonda aynı anahtara dönüşür. Adayların hiçbiri otomatik uygulanmadı; ülke, takım kimliği ve dönem doğrulaması gerekir.

10. **Season coverage:** 24 lig/sezon çiftinin 23'ünde veri bulunuyor; bu, sezonların tamamının eksiksiz olduğu anlamına gelmez. Scottish 2026-27 dosyası ayrıca alınmış HTTP 404 kanıtıyla doğrulandı; adapter 404'ü boş diziye çevirdiği için ilk rapordaki `error:null` açıklığa kavuşturuldu. Scottish 2025-26 dosyasında 198 fixture / yalnızca 63 tamamlanmış sonuç var; son sonuç 1 Kasım 2025, final split kapsamı eksik. API-Football geçmiş erişiminde Malaga için 2025 ve 2026 sezonları HTTP 200 içinde plan hatası verdi: yalnızca 2022–2024 erişimine yönlendiriyor. Bu hata boş sonuçla karıştırılmamalı.

11. **Malaga–Villarreal, 1570390:** Malaga'nın mevcut üst lig sezonunda kesim öncesi yalnızca dört tamamlanmış maçı var: 19 Ağustos, 24 Ağustos, 30 Ağustos ve 6 Eylül 2026. Önceki iki La Liga sezonunda Malaga yok; Segunda División 2024-25 ve 2025-26 dosyalarında sezon başına 42 takım fixture'ı var. Adapter yalnızca hedef ligde mevcut ve önceki sezonu taradığından önceki division geçmişine ulaşmıyor. Mapping çalışıyor; kök neden lig değiştiren takımın geçmiş division kapsamı ve güncel API sezonuna plan engeli. Segunda verisi audit içinde eklendiğinde 10/10 örnek ve input-ready elde ediliyor; üretime uygulanmadı. API 2024 erişimi de Malaga için 46 ham maç döndürmüş; seçilen 10 maçın en yenisi 31 Mayıs 2025 olduğu için veri eskiliği ayrıca değerlendirilmelidir.

12. **250 deferred fixture:** 250/250'nin doğrudan ertelenme nedeni `HISTORY_COVERAGE_PROBE_LIMIT`; 20 analiz üst limitine takılan 0. Aynı 250/250 fixture yapılandırılmış OpenFootball ligleri dışındadır. Bunlar birbirine eklenen ayrı kümeler değil, aynı fixture'ların iki farklı özelliğidir. Yalnızca bütçe artırımıyla yeterli geçmişe ulaşacağı kanıtlanan fixture sayısı 0; provider'daki gerçek yeterlilik 250 fixture için tek tek sorgulanmadığından bilinmiyor. Diğer üç denenmiş fixture Malaga–Villarreal, Manchester City–Norwich ve Central Espanol–Oriental olup yetersiz production veri nedeniyle ertelenmiştir.

13. **Provider budget etkisi:** Yapılandırılmış günlük API bütçesi 100; capture başına analiz limiti 20, kapsamı bilinmeyen fixture probe limiti 2. Önceki audit kanıtları 5 metered API sorgusu ve 16 bulk-source kaydı içerir; ayrıca Scottish 404 kontrolü ayrı kanıttır. Bu devam oturumunda yeni provider isteği 0. Güncel sezon plan kısıtlaması, istek sayısını artırarak çözülmez. Malaga üzerindeki plan sonucu diğer 250 takım için bireysel ölçüm olarak sunulmamıştır.

14. **Local-first potansiyeli:** Mevcut yerel veriyle minimumu sağlayan 0/253; buna rağmen ucuz kapsam kontrolü 252 fixture'ın yapılandırılmış fallback'e yönlendirilemeyeceğini önceden ayırabilir. Bu, bütün sağlayıcılarda veri yokluğu veya kalıcı ret kararı değildir. İncelenmiş Segunda kaynağıyla genişletme 1/253 fixture'ı input-ready adayı yapar. Ayrı 2024 API senaryolarında Malaga–Villarreal ve Manchester City–Norwich 10/10 input-ready olur; bu eski sezon senaryoları mevcut yerel başarıya eklenmemeli ve production eligibility sayılmamalıdır. Runtime tarihçe hattı benchmark dosyalarını okumuyor. Historical cache'teki 13 girişin 2 eski La Liga anahtarında ülke yok; migration/cache-hit sorunu adayı olarak raporlandı.

15. **Leakage:** Saklanmış seçili geçmişlerde 74 fixture-geçmiş karşılaştırması yeniden doğrulandı; `historicalMatch.kickoff < targetFixture.kickoff` ihlali 0. İlk audit'in tüm seçim kapsamındaki ihlal listesi de boş. `selectHistory` hedef ve audit zamanı minimumunu kullanır, hedef fixture'ı dışlar, tarih-only kaydı gün sonunda değerlendirir. Model 4.1 ayrıca hedef günün 00:00 UTC başlangıcını kesim olarak kullanır. Sayısal zaman sırası doğrulandı; OpenFootball'ın timezone belirtilmeyen saatlerine `Z` eklemesinin kaynak saat dilimini doğru temsil ettiği ayrıca kanıtlanmış değildir. Bu ayrı bir veri doğruluğu riskidir.

16. **Test/build ve bütünlük:** Mevcut 165 testin 165'i PASS; build PASS; server ve audit script syntax PASS. İlk sandbox `spawn EPERM` hatası izinli yeniden çalıştırmayla giderildi. Önceki hash manifestindeki 18 benchmark dosyası birebir aynı; rapor 1.686 değerlendirilmiş maç içeriyor. Artifact SHA-256: `8a2be7d9c4fe131bbf6959c43be2b0245152478dec339d2f783ffb6bc2d72b82`. Devam oturumunda 71 korunan dosyanın 70'i aynı; fixture-cache.json eşzamanlı değişmiş durumda, bu nedenle bütün runtime dosyaları değişmedi iddiası yoktur. Audit kodu cache yazmadı/provider çağırmadı; eşzamanlı değişikliği yapan süreç bu audit'te belirlenmedi. Model kodu, calibration, artifact, benchmark, .env ve Prediction Ledger hash'leri değişmedi.

17. **Bu devamda yazılan dosyalar:** `docs/historical-coverage-audit.json` tamamlandı; bu Markdown raporu eklendi; `docs/historical-coverage-tests.log` ve `docs/historical-coverage-build.log` son doğrulamalarla güncellendi. Build standart dist çıktısını üretti. Önceden bekleyen production değişikliklerine dokunulmadı; audit script'i de değiştirilmedi.

18. **Çözülmesi gereken teknik veri kategorileri:** Provider plan/season yetkisi; fallback league-country kapsamı; promoted/relegated takımın division geçiş geçmişi; doğrulanmış provider ID/alias registry; eksik veya eskimiş sezon sonuçları ve Scottish split aşaması; HTTP 200 içindeki plan hatası ile HTTP 404/boş veri ayrımı; ülke içermeyen eski historical cache anahtarları; açık kaynak saat dilimi/kickoff precision; eski sezon örneklerinde freshness ve competition uygunluğu; capture probe bütçesinden önce local eligibility ön elemesi. Hepsi öneri olarak raporlandı; otomatik production düzeltmesi veya Model 4.2 çalışması yapılmadı.
