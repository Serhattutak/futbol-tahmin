# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.


## Veri Sağlayıcıları (Sadece Ücretsiz Kaynaklar)

Bu proje futbol verilerini **yalnızca ücretsiz** kaynaklardan alır. Ücretli
`api-football` sağlayıcısı tamamen devre dışı bırakılmıştır ve hiçbir istek
yapılmaz.

Kullanılan ücretsiz kaynaklar:

- **OpenFootball** — tamamen ücretsiz (GitHub üzerinden JSON), anahtar gerektirmez.
- **football-data.org** — ücretsiz tier. Premier League, La Liga, Bundesliga,
  Serie A ve Ligue 1 dahil büyük ligleri kapsar. Ücretsiz anahtar:
  https://www.football-data.org/client/register — alınan anahtarı
  `backend/.env` dosyasında `FOOTBALL_DATA_API_TOKEN` olarak tanımlayın.
- **TheSportsDB** — ücretsiz tier. Ücretsiz genel anahtar `123` ile çalışır,
  kayıt gerektirmez.
- **Sportmonks** — opsiyonel ve ücretlidir; yalnızca `SPORTMONKS_API_TOKEN`
  tanımlıysa etkinleşir, varsayılan olarak kapalıdır.

Ortam değişkenleri için `backend/.env.example` dosyasına bakın.
