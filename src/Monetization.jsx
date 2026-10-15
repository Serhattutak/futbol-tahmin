import { useEffect, useRef, useState } from "react";
import "./Monetization.css";

const ADSENSE_CLIENT = String(import.meta.env.VITE_ADSENSE_CLIENT_ID || "").trim();
const ADSENSE_BANNER_SLOT = String(import.meta.env.VITE_ADSENSE_BANNER_SLOT_ID || "").trim();
const GAM_REWARDED_UNIT = String(import.meta.env.VITE_GAM_REWARDED_AD_UNIT_PATH || "").trim();
const CONSENT_KEY = "zeus-ai-ad-consent-v1";

function readConsent() {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "accepted" || value === "rejected" ? value : "unset";
  } catch {
    return "unset";
  }
}

function loadScript(src, id) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Reklam betiği yüklenemedi.")), { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.async = true;
    script.src = src;
    script.onload = () => { script.dataset.loaded = "true"; resolve(); };
    script.onerror = () => reject(new Error("Reklam betiği yüklenemedi."));
    document.head.appendChild(script);
  });
}

function AdBanner() {
  const pushed = useRef(false);
  useEffect(() => {
    if (!ADSENSE_CLIENT || !ADSENSE_BANNER_SLOT || pushed.current) return;
    let cancelled = false;
    loadScript(
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(ADSENSE_CLIENT),
      "zeus-adsense-script",
    ).then(() => {
      if (cancelled || pushed.current) return;
      try {
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
        pushed.current = true;
      } catch {
        // Ad blockers and unavailable inventory should never break the match experience.
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!ADSENSE_CLIENT || !ADSENSE_BANNER_SLOT) return null;
  return (
    <section className="zeus-ad-banner" aria-label="Reklam">
      <span className="zeus-ad-label">REKLAM</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block", minHeight: 90 }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_BANNER_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </section>
  );
}

function RewardedAd() {
  const slotRef = useRef(null);
  const readyEventRef = useRef(null);
  const unlockedRef = useRef(false);
  const [status, setStatus] = useState("idle");
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (!GAM_REWARDED_UNIT) return undefined;
    let cancelled = false;
    let pubads = null;
    const listeners = [];
    loadScript("https://securepubads.g.doubleclick.net/tag/js/gpt.js", "zeus-gpt-script")
      .then(() => {
        if (cancelled || !window.googletag) return;
        window.googletag = window.googletag || { cmd: [] };
        window.googletag.cmd.push(() => {
          if (cancelled) return;
          const googletag = window.googletag;
          const slot = googletag.defineOutOfPageSlot(GAM_REWARDED_UNIT, googletag.enums.OutOfPageFormat.REWARDED);
          if (!slot) {
            setStatus("unavailable");
            return;
          }
          slotRef.current = slot;
          slot.addService(googletag.pubads());
          pubads = googletag.pubads();
          const onReady = (event) => {
            if (event.slot === slot) {
              readyEventRef.current = event;
              setStatus("ready");
            }
          };
          const onGranted = (event) => {
            if (event.slot === slot) {
              unlockedRef.current = true;
              setUnlocked(true);
              setStatus("earned");
            }
          };
          const onClosed = (event) => {
            if (event.slot === slot && !unlockedRef.current) setStatus("closed");
          };
          for (const [name, listener] of [
            ["rewardedSlotReady", onReady],
            ["rewardedSlotGranted", onGranted],
            ["rewardedSlotClosed", onClosed],
          ]) {
            pubads.addEventListener(name, listener);
            listeners.push([name, listener]);
          }
          googletag.enableServices();
          googletag.display(slot);
        });
      })
      .catch(() => setStatus("unavailable"));
    return () => {
      cancelled = true;
      if (pubads) {
        for (const [name, listener] of listeners) pubads.removeEventListener(name, listener);
      }
      if (slotRef.current && window.googletag?.destroySlots) {
        window.googletag.cmd.push(() => window.googletag.destroySlots([slotRef.current]));
      }
    };
  }, []);

  function showRewardedAd() {
    if (!readyEventRef.current) {
      setStatus("loading");
      return;
    }
    setStatus("showing");
    try {
      readyEventRef.current.makeRewardedVisible();
    } catch {
      setStatus("unavailable");
    }
  }

  if (!GAM_REWARDED_UNIT) return null;
  return (
    <section className="zeus-rewarded-card">
      <div>
        <span className="zeus-ad-label">İSTEĞE BAĞLI ÖDÜLLÜ REKLAM</span>
        <h3>Bonus analiz kontrol listesini aç</h3>
        <p>Reklamı tamamladığında maç öncesi kontrol listesi açılır. Tahmin olasılıklarını veya model sonucunu değiştirmez.</p>
      </div>
      {!unlocked ? (
        <button type="button" className="zeus-ad-button" onClick={showRewardedAd} disabled={["loading", "showing", "unavailable"].includes(status)}>
          {status === "ready" ? "Reklamı izle" : status === "loading" ? "Reklam hazırlanıyor…" : status === "showing" ? "Reklam devam ediyor…" : status === "closed" ? "Reklam tamamlanmadı" : status === "unavailable" ? "Şu an kullanılamıyor" : "Reklam hazırlanıyor…"}
        </button>
      ) : (
        <div className="zeus-rewarded-unlocked" role="status">
          <strong>Bonus açıldı</strong>
          <ul>
            <li>Maç öncesi ilk 11 ve sakatlık haberlerinin güncelliğini kontrol et.</li>
            <li>Model olasılıklarını tek başına kesin sonuç gibi yorumlama.</li>
            <li>Veri kalitesi ve eksik veri uyarılarını birlikte değerlendir.</li>
            <li>Karar vermeden önce maç saati ve organizasyon bilgisini doğrula.</li>
          </ul>
        </div>
      )}
    </section>
  );
}

export default function Monetization({ showRewarded = false }) {
  const [consent, setConsent] = useState(readConsent);
  const adsConfigured = Boolean((ADSENSE_CLIENT && ADSENSE_BANNER_SLOT) || GAM_REWARDED_UNIT);

  function chooseConsent(value) {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // The preference still applies for this page session if storage is blocked.
    }
    setConsent(value);
  }

  if (!adsConfigured) return null;
  return (
    <div className="zeus-monetization">
      {consent === "unset" && (
        <section className="zeus-ad-consent" aria-label="Reklam tercihleri">
          <div>
            <strong>ZEUS AI reklam tercihleri</strong>
            <p>Reklamlar, ücretsiz hizmeti sürdürmemize yardımcı olur. Tercihini istediğin zaman değiştirebilirsin.</p>
          </div>
          <div className="zeus-consent-actions">
            <button type="button" className="zeus-ad-button" onClick={() => chooseConsent("accepted")}>Reklamları kabul et</button>
            <button type="button" className="zeus-ad-secondary" onClick={() => chooseConsent("rejected")}>Reddet</button>
          </div>
        </section>
      )}
      {consent === "accepted" && (
        <>
          <AdBanner />
          {showRewarded && <RewardedAd />}
          <div className="zeus-ad-preferences"><button type="button" onClick={() => chooseConsent("unset")}>Reklam tercihlerini değiştir</button></div>
        </>
      )}
      {consent === "rejected" && (
        <div className="zeus-ad-preferences"><span>Reklamlar kapalı.</span><button type="button" onClick={() => chooseConsent("unset")}>Reklam tercihlerini değiştir</button></div>
      )}
    </div>
  );
}
