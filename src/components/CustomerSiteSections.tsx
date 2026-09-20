import React from 'react';
import { ArrowRight, UtensilsCrossed, Rotate3d } from 'lucide-react';

// ---------------------------------------------------------------------------------------------
// Stage 39 -- the Customer Menu's visual sections.
//
// Two kinds of section exist, and the difference is the whole point of this stage:
//
//  * CONTENT sections (HERO, BANNER, TEXT, MEDIA, CTA) own their own words and media. They are
//    website design, so the Visual Catalog stores them.
//
//  * REFERENCE sections (MENU_ITEM, CATEGORY, PROMOTION) own NOTHING. They carry an id, and the
//    dish's name, description, price and photo are read here from the live Menu Engine rows that
//    arrive in the same payload. Change a price in the Menu Builder and this re-renders; the
//    section itself never knew the price to begin with.
//
// Appearance comes from server-validated preset identifiers rendered as data-* attributes, which
// the stylesheet keys off. No component here interpolates an administrator's string into a class,
// a style or any markup.
// ---------------------------------------------------------------------------------------------

const money = (v: any) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toFixed(2) : String(v ?? '0.00'); };

export interface SiteDesign {
  theme: string; accent: string; typography: string;
  card_style: string; density: string; radius: string; image_ratio: string; show_hero: boolean;
}

export const DEFAULT_DESIGN: SiteDesign = {
  theme: 'MIDNIGHT', accent: 'GOLD', typography: 'EDITORIAL',
  card_style: 'STANDARD', density: 'NORMAL', radius: 'ROUNDED', image_ratio: 'LANDSCAPE', show_hero: true,
};

/** The wrapper attributes that turn a server-side design into CSS custom properties. */
export const siteAttrs = (d: SiteDesign) => ({
  'data-theme': d.theme, 'data-accent': d.accent, 'data-typography': d.typography,
  'data-density': d.density, 'data-radius': d.radius,
});

export const DishCard: React.FC<{
  item: any; design: SiteDesign; cardStyle?: string | null; imageRatio?: string | null;
  lang: 'ru' | 'tk'; onOpen: (item: any) => void;
}> = ({ item, design, cardStyle, imageRatio, lang, onOpen }) => {
  const ru = lang === 'ru';
  const card = cardStyle || design.card_style;
  const ratio = imageRatio || design.image_ratio;
  const has360 = (item.gallery || []).some((g: any) => g.kind === 'MEDIA_360');
  return (
    <button className="site-card boom-focusable relative" data-card={card} onClick={() => onOpen(item)} aria-label={item.name || item.name_ru}>
      {item.promo_price && (
        <span className="absolute top-3 left-3 z-10 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide" style={{ background: 'var(--site-accent)', color: '#111' }}>
          {item.promo_badge || (ru ? 'Акция' : 'BOOM DEAL')}
        </span>
      )}
      {has360 && <span className="absolute top-3 right-3 z-10 rounded-full bg-black/70 p-1.5 site-accent" title="360"><Rotate3d className="w-3.5 h-3.5" /></span>}
      <span className="site-card-media" data-ratio={ratio}>
        {item.media_url
          ? (item.media_kind === 'VIDEO'
            ? <video src={item.media_url} poster={item.media_poster_url || undefined} muted loop playsInline />
            : <img src={item.media_url} alt={item.media_alt || item.name || item.name_ru} style={{ objectPosition: `${item.media_focal_x ?? 50}% ${item.media_focal_y ?? 50}%` }} />)
          : <span className="w-full h-full grid place-items-center"><UtensilsCrossed className="w-8 h-8 text-white/15" /></span>}
      </span>
      <span className="site-card-body block mt-3">
        <span className="site-card-title block">{item.name || (ru ? item.name_ru : item.name_tk)}</span>
        <span className="block text-xs text-slate-500 mt-1 line-clamp-2">{item.description ?? (ru ? item.description_ru : item.description_tk)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
          {item.weight_value && <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--site-border)' }}>{Number(item.weight_value)} {String(item.weight_unit || '').toLowerCase()}</span>}
          {(item.modifier_groups || []).length > 0 && <span className="rounded-full px-2 py-0.5 site-accent" style={{ border: '1px solid var(--site-accent-soft)' }}>{ru ? 'собрать по-своему' : 'öz islegiňe görä'}</span>}
          {(item.allergens || []).length > 0 && <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--site-border)' }}>{ru ? 'аллергены' : 'allergenler'}: {item.allergens.length}</span>}
        </span>
        {/* The PRICE is the Menu Engine's, read from the live item row -- never from the section. */}
        <span className="mt-2 block font-black site-accent">
          {item.promo_price ? <><s className="text-xs text-slate-500 mr-2">{money(item.price)}</s>{money(item.promo_price)}</> : money(item.price)}
        </span>
      </span>
    </button>
  );
};

interface SectionProps {
  block: any; design: SiteDesign; items: any[]; categories: any[];
  lang: 'ru' | 'tk'; onOpenItem: (item: any) => void; onOpenBlock: (b: any) => void;
}

export const SiteSection: React.FC<SectionProps> = ({ block: b, design, items, categories, lang, onOpenItem, onOpenBlock }) => {
  const ru = lang === 'ru';

  // ---- REFERENCE sections: resolve the live Menu Engine entity, own nothing ----
  if (b.type === 'MENU_ITEM') {
    const item = items.find(i => i.id === b.menu_item_id);
    if (!item) return null;                       // archived since: the section drops out, never renders broken
    return (
      <section className="mt-8">
        <div className="text-[10px] uppercase tracking-[.24em] site-accent mb-3">{ru ? 'Рекомендуем' : 'Maslahat berýäris'}</div>
        <div className="site-grid"><DishCard item={item} design={design} cardStyle={b.card_style} imageRatio={b.image_ratio} lang={lang} onOpen={onOpenItem} /></div>
      </section>
    );
  }
  if (b.type === 'CATEGORY') {
    const cat = categories.find(c => c.id === b.category_id);
    if (!cat) return null;
    const list = items.filter(i => i.category_id === cat.id);
    return (
      <section className="mt-10">
        <h2 className="site-display font-black mb-5">{cat.name || (ru ? cat.name_ru : cat.name_tk)}</h2>
        <div className="site-grid">
          {list.map(i => <DishCard key={i.id} item={i} design={design} cardStyle={b.card_style} imageRatio={b.image_ratio} lang={lang} onOpen={onOpenItem} />)}
        </div>
      </section>
    );
  }
  if (b.type === 'PROMOTION' || b.type === 'NEW_ITEMS') {
    const list = b.type === 'PROMOTION' ? items.filter(i => i.promo_price) : items.slice(0, 6);
    if (!list.length) return null;
    return (
      <section className="mt-10">
        <div className="text-[10px] uppercase tracking-[.24em] site-accent mb-3">{b.type === 'PROMOTION' ? (ru ? 'Акции' : 'Aksiýalar') : (ru ? 'Новинки' : 'Täzelikler')}</div>
        <div className="site-grid">
          {list.map(i => <DishCard key={i.id} item={i} design={design} cardStyle={b.card_style} imageRatio={b.image_ratio} lang={lang} onOpen={onOpenItem} />)}
        </div>
      </section>
    );
  }

  // ---- CONTENT sections: their own words and media, which is website design ----
  if (b.type === 'SPACER') return <div style={{ height: 'var(--site-gap)' }} aria-hidden />;

  if (b.type === 'TEXT') {
    return (
      <section className="site-section mt-8" data-align={b.alignment || 'LEFT'} style={{ padding: 'var(--site-pad)' }}>
        {b.title && <h2 className="site-display font-black">{b.title}</h2>}
        {b.subtitle && <p className="mt-3 text-slate-300 max-w-2xl" style={{ marginInline: (b.alignment === 'CENTER') ? 'auto' : undefined }}>{b.subtitle}</p>}
      </section>
    );
  }

  if (b.type === 'MEDIA') {
    if (!b.media_url) return null;
    return (
      <section className="site-section mt-8">
        <span className="site-card-media" data-ratio={b.image_ratio || design.image_ratio}>
          {b.media_kind === 'VIDEO'
            ? <video src={b.media_url} poster={b.poster_url || undefined} autoPlay muted loop playsInline />
            : <img src={b.media_url} alt={b.media_alt || ''} style={{ objectPosition: `${b.focal_x ?? 50}% ${b.focal_y ?? 50}%` }} />}
        </span>
      </section>
    );
  }

  // HERO / BANNER / CTA
  const tall = b.type === 'HERO';
  return (
    <section className={`site-section mt-8 ${tall ? 'min-h-[56vh]' : 'min-h-52'} flex items-end`} data-align={b.alignment || 'LEFT'}>
      {b.media_url && (b.media_kind === 'VIDEO'
        ? <video src={b.media_url} poster={b.poster_url || undefined} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />
        : <img src={b.media_url} alt={b.media_alt || b.title || ''} style={{ objectPosition: `${b.focal_x ?? 50}% ${b.focal_y ?? 50}%` }} className="absolute inset-0 w-full h-full object-cover" />)}
      <div className="site-overlay" data-overlay={b.overlay || 'SOFT'} />
      <div className="relative w-full" style={{ padding: 'calc(var(--site-pad) * 1.6)' }}>
        <div className="text-[10px] uppercase tracking-[.24em] site-accent">{b.type}</div>
        {b.title && <div className={`${tall ? 'site-display' : 'text-2xl'} font-black mt-1`}>{b.title}</div>}
        {b.subtitle && <div className="text-sm text-slate-300 mt-2 max-w-xl" style={{ marginInline: b.alignment === 'CENTER' ? 'auto' : undefined }}>{b.subtitle}</div>}
        {(b.cta_label || b.link_type !== 'NONE') && (
          <button className="site-cta boom-focusable" onClick={() => onOpenBlock(b)}>
            {b.cta_label || (ru ? 'Открыть' : 'Aç')} <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </section>
  );
};
