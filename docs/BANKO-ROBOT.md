# ZEUS Banko Robotu — Geçmiş Maç Testi

Seçici tahmin robotu: yalnızca güven eşiğini geçen maçlarda tahmin verir.

## Veri ve yöntem

- Kaynak: OpenFootball (CC0), 19 Avrupa ligi, 71103 maç (her iki takımın en az 3 geçmiş maçı olanlar).
- Eğitim: 2010-08-07 – 2021-05-30 (49660 maç)
- Doğrulama (eşik seçimi): 2021-07-23 – 2023-06-11 (6895 maç)
- Kilitli test (yalnızca raporlama): 2023-07-28 – 2026-05-24 (14548 maç)
- Özellikler yalnızca maç gününden önceki günlerin sonuçlarından hesaplanır; maç skoru yalnızca etikettir.
- Seviye doğrulama dönemine göre belirlenir: BANKO ≥ %90, GÜÇLÜ ≥ %80. Test dönemi eşik ayarında kullanılmadı.

## Kilitli test sonuçları

| Market | Seviye | Test seçimi | İsabet | %95 aralık | Tüm maçlarda taban oran |
|---|---|---|---|---|---|
| 1X | banko | 457 | %92.3 | %89.5–%94.4 | %69.5 |
| U4.5 | strong | 856 | %91.7 | %89.7–%93.4 | %86.1 |
| X2 | strong | 322 | %87.3 | %83.2–%90.5 | %56.6 |
| O1.5 | strong | 345 | %86.7 | %82.7–%89.9 | %75.8 |
| 1 | strong | 329 | %80.2 | %75.6–%84.2 | %43.4 |

## Sınırlar

- %90'ın üzerindeki tek seviye BANKO (1X). Maç sonucu (MS 1) bu yöntemle ~%80'de kalır; 1/X/2'nin tamamında %90 ulaşılabilir değildir.
- Robot test döneminde maçların yalnızca ~%3'ünde BANKO seçimi yaptı. Az seçim, yüksek isabetin bedelidir.
- Canlı sitede ayrıca içinde bulunulan sezon için son 60 günlük, modelin hiç görmediği maçlarla süren bir kontrol gösterilir.
- Oran, sakatlık, kadro verisi kullanılmaz. Geçmiş isabet gelecekteki isabetin garantisi değildir.

Yeniden üretmek için: `python research/train_banko.py --input backend/data/historical-feature-archive/rows.jsonl --model-out backend/data/banko-model.json --report-out docs/banko-backtest.json`
