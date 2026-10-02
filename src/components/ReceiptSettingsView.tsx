import React, { useEffect, useState } from 'react';
import { Save, Printer } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Notice, Toolbar } from './ui';
import { errorText } from '../humanErrors';

// Receipt design settings for the CUSTOMER_RECEIPT print profile. Stored on the existing
// print_profiles table (branch-scoped, config_json holds the design fields) -- no new model.
// Hierarchy actually implemented: branch profile (if one exists and is active) -> built-in
// system default below. There is no separate organization/franchise-level profile row in the
// schema today, so "organization default" collapses into this system default until such a
// tier is added; that is a scope decision, not an oversight, and is called out in this file.

const SYSTEM_DEFAULT_CONFIG = {
  logo: true, logo_url: '', logo_align: 'center',
  business_name: 'BOOM OS', address: '', phone: '',
  header_text: '', footer_text: '', thank_you_text: '',
  text_align: 'left', font_size: 'NORMAL',
  show_waiter: true, show_cashier: true, show_table: true, show_modifiers: true,
  show_unit_price: true, show_service_charge: true, show_discount: true,
  show_payment_method: true, show_customer_note: true,
};

export const ReceiptSettingsView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const branchId = user?.branch_id || '';
  const canEdit = hasPermission('print.manage');

  const [profile, setProfile] = useState<any | null>(null);
  const [width, setWidth] = useState(80);
  const [cfg, setCfg] = useState<any>(SYSTEM_DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = async () => {
    // Stage 36: a holding-level user has no branch of their own. Before this the screen sat on
    // "Loading..." forever; now it stops and says what is missing, like the POS screens do.
    if (!branchId) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const r = await api.getPrintProfiles(branchId);
      const p = r.profiles.find((x: any) => x.name === 'CUSTOMER_RECEIPT') || null;
      setProfile(p);
      setWidth(p?.paper_width || 80);
      setCfg(p?.config_json ? { ...SYSTEM_DEFAULT_CONFIG, ...JSON.parse(p.config_json) } : SYSTEM_DEFAULT_CONFIG);
    } catch (e: any) { setError(errorText(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [branchId]);

  const save = async () => {
    if (!branchId || saving) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      if (profile) {
        const r = await api.updatePrintProfile(profile.id, { name: 'CUSTOMER_RECEIPT', paper_width: width, language: language, config: cfg });
        setProfile(r.profile);
      } else {
        const r = await api.createPrintProfile({ branch_id: branchId, name: 'CUSTOMER_RECEIPT', paper_width: width, language: language, config: cfg });
        setProfile(r.profile);
      }
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (e: any) { setError(e?.message || (ru ? 'Не удалось сохранить.' : 'Ýatda saklap bolmady.')); }
    finally { setSaving(false); }
  };

  const set = (key: string, value: any) => setCfg((c: any) => ({ ...c, [key]: value }));
  const toggle = (key: string) => set(key, !cfg[key]);

  if (!canEdit) {
    return <div className="p-6 text-slate-400">{ru ? 'У вас нет доступа к настройкам чеков.' : 'Çek sazlamalaryna girişiňiz ýok.'}</div>;
  }
  if (!branchId) return <div className="p-6 text-slate-400">{ru ? 'У вас нет назначенного филиала. Настройки чека задаются для конкретного филиала.' : 'Size şahamça bellenmedi. Çek sazlamalary anyk şahamça üçin kesgitlenýär.'}</div>;
  if (loading) return <div className="p-6 text-slate-500">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div>;

  const Toggle = ({ k, label }: { k: string; label: string }) => (
    <label className="flex items-center justify-between py-1.5 text-sm text-slate-300 cursor-pointer">
      <span>{label}</span>
      <input type="checkbox" checked={Boolean(cfg[k])} onChange={() => toggle(k)} className="w-4 h-4 accent-amber-500" />
    </label>
  );

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {/* Stage 41: title from the shell header; the branch this applies to is stated next to the
          save action, where it matters, instead of in a second page title. */}
      <Toolbar left={<span className="text-xs text-slate-400">{ru ? `Настройки филиала: ${user?.branch_name || branchId}` : `Şahamça sazlamalary: ${user?.branch_name || branchId}`}</span>}>
        <button className="btn" disabled={saving} onClick={() => void save()}>
          <Save className="w-4 h-4" /> {saving ? (ru ? 'Сохранение…' : 'Ýatda saklanýar…') : saved ? (ru ? 'Сохранено ✓' : 'Ýatda saklandy ✓') : (ru ? 'Сохранить' : 'Ýatda saklamak')}
        </button>
      </Toolbar>
      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <section className="border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-white font-semibold text-sm">{ru ? 'Заголовок' : 'Başlyk'}</h3>
            <input className="field" placeholder={ru ? 'URL логотипа' : 'Logo URL'} value={cfg.logo_url} onChange={e => set('logo_url', e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className="field" value={cfg.logo_align} onChange={e => set('logo_align', e.target.value)}>
                <option value="left">{ru ? 'Логотип: слева' : 'Logo: çepde'}</option>
                <option value="center">{ru ? 'Логотип: центр' : 'Logo: merkez'}</option>
                <option value="right">{ru ? 'Логотип: справа' : 'Logo: sagda'}</option>
              </select>
              <select className="field" value={cfg.text_align} onChange={e => set('text_align', e.target.value)}>
                <option value="left">{ru ? 'Текст: слева' : 'Tekst: çepde'}</option>
                <option value="center">{ru ? 'Текст: центр' : 'Tekst: merkez'}</option>
                <option value="right">{ru ? 'Текст: справа' : 'Tekst: sagda'}</option>
              </select>
            </div>
            <input className="field" placeholder={ru ? 'Название организации' : 'Guramanyň ady'} value={cfg.business_name} onChange={e => set('business_name', e.target.value)} />
            <input className="field" placeholder={ru ? 'Адрес' : 'Salgy'} value={cfg.address} onChange={e => set('address', e.target.value)} />
            <input className="field" placeholder={ru ? 'Телефон' : 'Telefon'} value={cfg.phone} onChange={e => set('phone', e.target.value)} />
            <input className="field" placeholder={ru ? 'Текст в шапке' : 'Başlyk teksti'} value={cfg.header_text} onChange={e => set('header_text', e.target.value)} />
          </section>

          <section className="border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-white font-semibold text-sm">{ru ? 'Футер' : 'Aşaky bölek'}</h3>
            <input className="field" placeholder={ru ? 'Текст в футере' : 'Aşaky tekst'} value={cfg.footer_text} onChange={e => set('footer_text', e.target.value)} />
            <input className="field" placeholder={ru ? 'Текст благодарности' : 'Sagbolsun teksti'} value={cfg.thank_you_text} onChange={e => set('thank_you_text', e.target.value)} />
          </section>

          <section className="border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-white font-semibold text-sm">{ru ? 'Формат печати' : 'Çap formaty'}</h3>
            <div className="grid grid-cols-2 gap-2">
              <select className="field" value={width} onChange={e => setWidth(Number(e.target.value))}>
                <option value={58}>58mm</option>
                <option value={80}>80mm</option>
              </select>
              <select className="field" value={cfg.font_size} onChange={e => set('font_size', e.target.value)}>
                <option value="SMALL">{ru ? 'Мелкий шрифт' : 'Kiçi şrift'}</option>
                <option value="NORMAL">{ru ? 'Обычный шрифт' : 'Adaty şrift'}</option>
                <option value="LARGE">{ru ? 'Крупный шрифт' : 'Uly şrift'}</option>
              </select>
            </div>
          </section>
        </div>

        <section className="border border-slate-800 rounded-xl p-4 h-fit">
          <h3 className="text-white font-semibold text-sm mb-2">{ru ? 'Видимые поля' : 'Görünýän meýdanlar'}</h3>
          <Toggle k="show_waiter" label={ru ? 'Официант' : 'Ofisiant'} />
          <Toggle k="show_cashier" label={ru ? 'Кассир' : 'Kassir'} />
          <Toggle k="show_table" label={ru ? 'Стол' : 'Stol'} />
          <Toggle k="show_modifiers" label={ru ? 'Модификаторы' : 'Modifikatorlar'} />
          <Toggle k="show_unit_price" label={ru ? 'Цена за единицу' : 'Birlik bahasy'} />
          <Toggle k="show_service_charge" label={ru ? 'Сервисный сбор' : 'Hyzmat tölegi'} />
          <Toggle k="show_discount" label={ru ? 'Скидка' : 'Arzanladyş'} />
          <Toggle k="show_payment_method" label={ru ? 'Способ оплаты' : 'Töleg usuly'} />
          <Toggle k="show_customer_note" label={ru ? 'Заметка клиента' : 'Müşderi belligi'} />
          <p className="text-[11px] text-slate-600 mt-3">{ru ? 'Внутренние заметки никогда не показываются в чеке.' : 'Içerki bellikler çekde hiç haçan görkezilmeýär.'}</p>
        </section>
      </div>
    </div>
  );
};
