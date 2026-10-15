const env = process.env;
const client = String(env.VITE_ADSENSE_CLIENT_ID || "").trim();
const slot = String(env.VITE_ADSENSE_BANNER_SLOT_ID || "").trim();
const rewarded = String(env.VITE_GAM_REWARDED_AD_UNIT_PATH || "").trim();
const operator = String(env.VITE_OPERATOR_NAME || "").trim();
const contact = String(env.VITE_CONTACT_EMAIL || "").trim();
const required = /^(1|true|yes)$/i.test(String(env.ZEUS_ADS_REQUIRED || "").trim());
const configured = Boolean(client || slot || rewarded);
const errors = [];

if (Boolean(client) !== Boolean(slot)) {
  errors.push("AdSense banner için yayıncı kimliği ve reklam birimi kimliği birlikte tanımlanmalı.");
}
if (client && !/^ca-pub-\d{8,}$/.test(client)) {
  errors.push("VITE_ADSENSE_CLIENT_ID biçimi geçersiz; AdSense yayıncı kimliğini kontrol et.");
}
if (slot && !/^\d+$/.test(slot)) {
  errors.push("VITE_ADSENSE_BANNER_SLOT_ID sayısal reklam birimi kimliği olmalı.");
}
if (rewarded && !/^\/[^\s]+\/[^\s]+$/.test(rewarded)) {
  errors.push("VITE_GAM_REWARDED_AD_UNIT_PATH /network/code biçiminde olmalı.");
}
if (configured && !operator) {
  errors.push("Reklam yapılandırılmış; gerçek VITE_OPERATOR_NAME eksik.");
}
if (configured && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
  errors.push("Reklam yapılandırılmış; geçerli VITE_CONTACT_EMAIL eksik.");
}
if (required && !client) {
  errors.push("ZEUS_ADS_REQUIRED etkin; AdSense yayıncı kimliği eksik.");
}
if (required && !slot) {
  errors.push("ZEUS_ADS_REQUIRED etkin; AdSense banner birimi eksik.");
}
if (required && !operator) {
  errors.push("ZEUS_ADS_REQUIRED etkin; işletmeci bilgisi eksik.");
}
if (required && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
  errors.push("ZEUS_ADS_REQUIRED etkin; iletişim e-postası eksik/geçersiz.");
}

if (errors.length) {
  console.error("ZEUS AI reklam yapılandırması: BAŞARISIZ");
  for (const error of errors) console.error(`- ${error}`);
  console.error("Not: Bu kontrol AdSense site onayını veya CMP/yasal uygunluğu doğrulamaz.");
  process.exitCode = 1;
} else if (!configured) {
  console.log("ZEUS AI reklam yapılandırması: REKLAMLAR KAPALI (beklenen güvenli durum).");
  console.log("Gerçek hesap ve birim kimlikleri sağlanmadan reklam/gelir varsayımı yapılmaz.");
  if (required) process.exitCode = 1;
} else {
  console.log("ZEUS AI reklam yapılandırması: biçim kontrolleri başarılı.");
  console.log("Not: Bu kontrol AdSense site onayını, reklam gösterimini veya CMP/yasal uygunluğu doğrulamaz.");
}
