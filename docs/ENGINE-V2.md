# ZEUS Tahmin Motoru 2.0 — Geçmiş Maç Testi

Her maça tahmin verir: 1/X/2 olasılıkları + en olası tahmin (çifte şans, alt/üst, karşılıklı gol) ve ölçülmüş güven seviyesi.

## Yöntem

- Eğitim 2010-08-07–2021-05-30 (49660 maç), eşik seçimi 2021-07-23–2023-06-11 (6895), kilitli test 2023-07-28–2026-05-24 (14548).
- Özellikler: son 5/10 maç formu, iç/dış saha, H2H, lig eğilimleri ve Elo takım gücü (K=20, ev avantajı 60). Yalnızca maç gününden önceki sonuçlar.
- Elo eklenmesi 1X2 doğruluğunu %48,96 → %49,77, log loss'u 1,0236 → 1,0123 iyileştirdi; LR ve gradyan artırma (HGB) farkı ihmal edilebilir olduğu için dışa aktarılabilir LR seçildi.
- Elo, 3 sezonluk pencereyle hesaplandığında da aynı sonucu verdi (canlı sistem 4 sezon kullanır).

## Kilitli test (her maç tahmin edildi)

- Tüm maçlarda en olası tahminin isabeti: **%80.1** (14548 maç)
- 1X2 en olası sonuç doğruluğu: %49.8

| Seviye | Olasılık eşiği | Maç | Maçların payı | İsabet | %95 aralık |
|---|---|---|---|---|---|
| BANKO | ≥ %89.0 | 1094 | %7.5 | %92.0 | %90.3–%93.5 |
| GÜÇLÜ | ≥ %81.0 | 3953 | %27.2 | %83.7 | %82.5–%84.8 |
| ORTA | ≥ %55.0 | 9501 | %65.3 | %77.3 | %76.4–%78.1 |

## Sınırlar

- %90 üzeri isabet yalnızca BANKO seviyesinde (maçların ~%7,5'i). 1/X/2'nin tamamında doğruluk ~%50'dir.
- Arşiv dışı ligler (Brezilya, Japonya, MLS vb.) son 75 günün sağlayıcı sonuçlarıyla tahmin edilir; uzun dönem doğrulaması olmadığı için ORTA seviyesinin üstüne çıkmaz.
- Oran, kadro ve sakatlık verisi kullanılmaz. Geçmiş isabet garanti değildir.

Yeniden üretmek için: `python research/train_engine_v2.py --input backend/data/historical-feature-archive/rows.jsonl --model-out backend/data/engine-v2.json --report-out docs/engine-v2-backtest.json`
