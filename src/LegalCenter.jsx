import { useState } from "react";
import "./LegalCenter.css";

const OPERATOR = String(import.meta.env.VITE_OPERATOR_NAME || "").trim();
const CONTACT_EMAIL = String(import.meta.env.VITE_CONTACT_EMAIL || "").trim();

const SECTIONS = [
  { id: "privacy", label: "Gizlilik", title: "Gizlilik politikası" },
  { id: "cookies", label: "Çerezler", title: "Çerez ve yerel depolama" },
  { id: "terms", label: "Kullanım", title: "Kullanım koşulları" },
];

export default function LegalCenter() {
  const [active, setActive] = useState("privacy");
  const section = SECTIONS.find(item => item.id === active) || SECTIONS[0];

  return <div className="view-stack legal-center">
    <section className="legal-hero">
      <span className="eyebrow">ZEUS AI · ŞEFFAFLIK</span>
      <h1>Gizlilik ve kullanım</h1>
      <p>Veri kullanımı, yerel tercihler ve istatistiksel tahminlerin sınırları hakkında açık bilgilendirme.</p>
      <div className={OPERATOR && CONTACT_EMAIL ? "legal-config-status ready" : "legal-config-status"}>
        {OPERATOR && CONTACT_EMAIL
          ? "İşletmeci ve iletişim bilgileri yapılandırılmış."
          : "Yayın öncesi işletmeci ve iletişim bilgileri tamamlanmalı."}
      </div>
    </section>

    <nav className="legal-tabs" aria-label="Yasal bilgilendirme">
      {SECTIONS.map(item => <button key={item.id} type="button" className={active === item.id ? "selected" : ""} onClick={() => setActive(item.id)}>{item.label}</button>)}
    </nav>

    <section className="detail-section legal-copy">
      <h2>{section.title}</h2>
      {active === "privacy" && <>
        <h3>İşletmeci ve iletişim</h3>
        <p><strong>İşletmeci:</strong> {OPERATOR || "Henüz yapılandırılmadı"}</p>
        <p><strong>İletişim:</strong> {CONTACT_EMAIL || "Henüz yapılandırılmadı"}</p>
        <p>İşletmeci ve iletişim alanları yayın öncesinde doğru bilgilerle doldurulmalıdır. Bu alanlar tamamlanmadan bu metin tek başına nihai hukuki bildirim sayılmaz.</p>
        <h3>Hangi veriler kullanılır?</h3>
        <p>ZEUS AI; fikstür, takım formu, istatistikler, oranlar ve sonuçlar gibi futbol verilerini ilgili veri sağlayıcılarından alarak analiz ekranlarında sunabilir. Sağlayıcıların kullanılabilirliği ve kapsamı lige, zamana ve hizmet koşullarına göre değişebilir.</p>
        <p>Şu an uygulamada hesap açma veya kullanıcı profili oluşturma akışı bulunmamaktadır. Favori maç tercihleri bu tarayıcıdaki yerel depolamada tutulur. Sunucuya gönderilen istekler, hizmetin güvenliği ve hata ayıklama için teknik erişim kayıtları oluşturabilir.</p>
        <h3>Veri doğruluğu ve üçüncü taraflar</h3>
        <p>Harici veri sağlayıcılarının kendi gizlilik ve kullanım koşulları geçerlidir. Eksik, gecikmiş veya çelişkili veriler analizi etkileyebilir; uygulama doğrulanmamış bilgileri kesin gerçek olarak sunmamalıdır.</p>
        <h3>Hak talepleri</h3>
        <p>Veri koruma talepleri ve sorular için yukarıdaki işletmeci iletişim kanalı kullanılmalıdır. Saklama süreleri, hukuki dayanaklar ve varsa veri sorumlusu/temsilci bilgileri, gerçek işletme ve altyapı yapılandırması doğrulanarak yayın öncesinde tamamlanmalıdır.</p>
      </>}
      {active === "cookies" && <>
        <h3>Yerel depolama</h3>
        <p>Favori maçlar ve kullanıcı tercihleri tarayıcıdaki localStorage alanında tutulabilir. Tarayıcı verilerini temizlemek bu tercihleri silebilir. Bu mekanizma hesaplar arasında senkronizasyon sağlamaz.</p>
        <h3>Üçüncü taraf çerezleri</h3>
        <p>Reklamlar şu anda yapılandırılmamışsa reklam etiketleri yüklenmez. Google AdSense veya Google Ad Manager daha sonra etkinleştirilirse reklam teknolojileri ve ilgili rıza yönetimi gereksinimleri ayrıca devreye alınmalıdır.</p>
        <p>Avrupa Ekonomik Alanı, Birleşik Krallık ve İsviçre gibi bölgelerde gerekli olduğunda Google tarafından sertifikalı bir rıza yönetim platformu (CMP) kullanılmalıdır. Basit bir kabul/reddet düğmesi tek başına bu gereksinimi karşıladığı varsayılmamalıdır.</p>
      </>}
      {active === "terms" && <>
        <h3>Bilgilendirme amaçlı istatistik</h3>
        <p>ZEUS AI futbol karşılaşmalarına ilişkin istatistiksel analiz ve model olasılıkları sunar. Bu çıktılar kesin sonuç, garanti, profesyonel tavsiye veya kazanç vaadi değildir.</p>
        <h3>Veri ve model sınırlamaları</h3>
        <p>Model çıktıları veri kapsamı, örneklem büyüklüğü, veri gecikmesi, kadro/sakatlık bilgisi ve matematiksel varsayımlardan etkilenebilir. Yeterli veri bulunmadığında tahmin gösterilmeyebilir. Model güveni ile bir sonucun gerçekleşme olasılığı aynı kavram değildir.</p>
        <h3>Kullanıcının sorumluluğu</h3>
        <p>Herhangi bir karar öncesinde maç bilgilerini ve kaynakları bağımsız olarak doğrulayın. Hizmetin kullanılabilirliği ve üçüncü taraf veri kapsamı değişebilir. Siteyi kullanmanız, herhangi bir sonucun garanti edildiği anlamına gelmez.</p>
        <h3>Yayın öncesi tamamlanacaklar</h3>
        <p>İşletmeci kimliği, iletişim bilgileri, veri işleme amaçları ve saklama süreleri gerçek yapılandırmaya göre doğrulanmalı; geçerli mevzuata uygun nihai metinler yayınlanmalıdır.</p>
      </>}
      <p className="legal-updated">Metin durumu: teknik taslak. Yayın öncesi gerçek işletmeci bilgileri ve kullanılan servisler ile karşılaştırılarak gözden geçirilmelidir.</p>
    </section>
  </div>;
}
