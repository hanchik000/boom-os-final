import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Rotate3d, Scale, Leaf, TriangleAlert, ChevronLeft, ChevronRight } from 'lucide-react';

// ---------------------------------------------------------------------------------------------
// Stage 37 -- the guest-facing dish sheet.
//
// Everything rendered here arrives from the public Menu Engine payload: localized name and
// description, the customer-facing ingredient list, structured weight, declared allergens, the
// media gallery, and the dish's configurable components.
//
// Two things this sheet is NOT:
//  * It is not a price calculator. The component prices shown are the server's `price_delta`
//    values, displayed for information. The guest does not place an order here, and when an
//    order IS placed the server re-validates every selection and recomputes the total.
//  * It is not a window into the kitchen. There is no recipe, no quantity, no cost, no margin,
//    no supplier and no stock on this payload -- the public routes never select those columns.
// ---------------------------------------------------------------------------------------------

const money = (v: any) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toFixed(2) : String(v ?? '0.00'); };

// One localized unit table, shared with the menu card so the two never disagree.
export const UNIT_LABEL: Record<string, { ru: string; tk: string; en: string }> = {
  G: { ru: 'г', tk: 'g', en: 'g' },
  KG: { ru: 'кг', tk: 'kg', en: 'kg' },
  ML: { ru: 'мл', tk: 'ml', en: 'ml' },
  L: { ru: 'л', tk: 'l', en: 'l' },
  PCS: { ru: 'шт', tk: 'sany', en: 'pcs' },
};

/**
 * A drag-to-pan viewer for an equirectangular 360 image.
 *
 * This is an honest description of what it does: it pans the panorama horizontally (and clamps
 * vertically), wrapping around at the seam. It is NOT a WebGL sphere projection -- there is no
 * perspective correction and no gyroscope -- so straight lines near the poles still bend as they
 * do in the source image. It needs no extra dependency and works on a phone with a thumb.
 */
const Viewer360: React.FC<{ url: string; alt: string; label: string }> = ({ url, alt, label }) => {
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const start = (cx: number, cy: number) => { drag.current = { x: cx, y: cy, px: x, py: y }; };
  const move = useCallback((cx: number, cy: number, width: number) => {
    const d = drag.current;
    if (!d || !width) return;
    // 100% of the image width ≈ one full 360° turn, so the drag distance maps straight onto it.
    const nx = d.px - ((cx - d.x) / width) * 100;
    setX(((nx % 100) + 100) % 100);
    setY(Math.min(100, Math.max(0, d.py - ((cy - d.y) / width) * 60)));
  }, []);
  const end = () => { drag.current = null; };

  return (
    <div
      className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden border border-white/10 bg-black cursor-grab active:cursor-grabbing touch-none select-none"
      role="img"
      aria-label={`${label}: ${alt}`}
      onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); start(e.clientX, e.clientY); }}
      onPointerMove={e => move(e.clientX, e.clientY, (e.currentTarget as HTMLElement).clientWidth)}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
    >
      <img src={url} alt={alt} draggable={false} className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: `${x}% ${y}%`, transform: 'scale(1.9)' }} />
      <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-[10px] uppercase tracking-[.16em] text-amber-300">
        <Rotate3d className="w-3.5 h-3.5" /> {label}
      </div>
    </div>
  );
};

interface Props {
  item: any;
  lang: 'ru' | 'tk' | 'en';
  onClose: () => void;
}

export const CustomerDishSheet: React.FC<Props> = ({ item, lang, onClose }) => {
  const t = (ru: string, tk: string, en: string) => (lang === 'tk' ? tk : lang === 'en' ? en : ru);
  const [shot, setShot] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The primary photo plus the gallery, as one ordered strip.
  const media: any[] = [
    ...(item.media_url ? [{ id: 'primary', url: item.media_url, kind: item.media_kind || 'IMAGE', poster_url: item.media_poster_url, alt: item.media_alt, focal_x: item.media_focal_x, focal_y: item.media_focal_y }] : []),
    ...(item.gallery || []),
  ];
  const current = media[Math.min(shot, Math.max(0, media.length - 1))];
  const name = item.name || (lang === 'tk' ? item.name_tk : item.name_ru);
  const description = item.description ?? (lang === 'tk' ? item.description_tk : item.description_ru);
  const unit = item.weight_unit ? (UNIT_LABEL[item.weight_unit]?.[lang] || item.weight_unit.toLowerCase()) : '';

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#0b0b0b] p-5 sm:p-7"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={name}
      >
        <div className="flex items-start gap-4">
          <div className="mr-auto min-w-0">
            <h2 className="text-2xl sm:text-3xl font-black leading-tight">{name}</h2>
            {description && <p className="text-sm text-slate-400 mt-1.5">{description}</p>}
          </div>
          <button className="shrink-0 rounded-full border border-white/10 p-2 text-slate-300 hover:text-white hover:border-white/30" aria-label={t('Закрыть', 'Ýap', 'Close')} onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {current && (
          <div className="mt-5">
            {current.kind === 'MEDIA_360'
              ? <Viewer360 url={current.url} alt={current.alt || name} label={t('Обзор 360 — потяните', '360 synlama — çekiň', '360 view — drag')} />
              : current.kind === 'VIDEO'
                ? <video src={current.url} poster={current.poster_url || undefined} controls muted playsInline className="w-full aspect-[16/9] rounded-2xl object-cover border border-white/10 bg-black" />
                : <img src={current.url} alt={current.alt || name} className="w-full aspect-[16/9] rounded-2xl object-cover border border-white/10 bg-black" style={{ objectPosition: `${current.focal_x ?? 50}% ${current.focal_y ?? 50}%` }} />}
            {media.length > 1 && (
              <div className="mt-3 flex items-center gap-2">
                <button className="rounded-full border border-white/10 p-1.5 text-slate-300 hover:text-white" aria-label={t('Предыдущее', 'Öňki', 'Previous')} onClick={() => setShot(s => (s - 1 + media.length) % media.length)}><ChevronLeft className="w-4 h-4" /></button>
                <div className="flex gap-2 overflow-x-auto">
                  {media.map((m, idx) => (
                    <button key={m.id || idx} onClick={() => setShot(idx)} aria-label={`${t('Кадр', 'Kadr', 'Shot')} ${idx + 1}`} aria-current={idx === shot}
                      className={`relative w-16 h-12 shrink-0 rounded-lg overflow-hidden border ${idx === shot ? 'border-amber-400' : 'border-white/10'}`}>
                      <img src={m.kind === 'VIDEO' ? (m.poster_url || m.url) : m.url} alt="" className="w-full h-full object-cover" />
                      {m.kind === 'MEDIA_360' && <Rotate3d className="absolute bottom-0.5 right-0.5 w-3 h-3 text-amber-300" />}
                    </button>
                  ))}
                </div>
                <button className="rounded-full border border-white/10 p-1.5 text-slate-300 hover:text-white" aria-label={t('Следующее', 'Indiki', 'Next')} onClick={() => setShot(s => (s + 1) % media.length)}><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="text-2xl font-black text-amber-300">
            {item.promo_price ? <><span className="text-base text-slate-500 line-through mr-2">{money(item.price)}</span>{money(item.promo_price)}</> : money(item.price)} TMT
          </div>
          {item.weight_value && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
              <Scale className="w-3.5 h-3.5 text-amber-300" />{Number(item.weight_value)} {unit}
            </span>
          )}
        </div>

        {item.ingredients && (
          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[.2em] text-amber-300 flex items-center gap-1.5"><Leaf className="w-3.5 h-3.5" />{t('Состав', 'Düzümi', 'Ingredients')}</div>
            <p className="text-sm text-slate-300 mt-1.5">{item.ingredients}</p>
          </div>
        )}

        {(item.allergens || []).length > 0 && (
          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[.2em] text-amber-300 flex items-center gap-1.5"><TriangleAlert className="w-3.5 h-3.5" />{t('Аллергены', 'Allergenler', 'Allergens')}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.allergens.map((a: any) => (
                <span key={a.code} className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">{a.label}</span>
              ))}
            </div>
          </div>
        )}

        {(item.modifier_groups || []).length > 0 && (
          <div className="mt-6">
            <div className="text-[10px] uppercase tracking-[.2em] text-amber-300">{t('Соберите по-своему', 'Öz islegiňize görä ýygnaň', 'Build it your way')}</div>
            <div className="mt-3 space-y-3">
              {item.modifier_groups.map((g: any) => (
                <div key={g.id} className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
                  <div className="flex items-baseline gap-2">
                    <strong className="text-sm">{g.name}</strong>
                    <span className="text-[11px] text-slate-500">
                      {g.required ? t('обязательно', 'hökmany', 'required') : t('по желанию', 'islege görä', 'optional')} · {g.min_select}–{g.max_select}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(g.modifiers || []).map((m: any) => (
                      <span key={m.id} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                        {m.name}{Number(m.price_delta) > 0 && <span className="text-amber-300"> +{money(m.price_delta)}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-3">
              {t('Окончательную цену рассчитывает сервер при оформлении заказа.',
                 'Jemi bahany sargyt edilende serwer hasaplaýar.',
                 'The final price is calculated by the server when the order is placed.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
