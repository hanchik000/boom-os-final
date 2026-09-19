import { Router } from 'express';
import { query, queryOne } from '../db';
import { activePromotionMap } from './promotions';

const router = Router();

function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ё]/g, 'е')
    .replace(/[ə]/g, 'e')
    .replace(/[ş]/g, 's')
    .replace(/[ç]/g, 'c')
    .replace(/[ž]/g, 'z')
    .replace(/[ö]/g, 'o')
    .replace(/[ü]/g, 'u')
    .replace(/[ý]/g, 'y')
    .replace(/[ä]/g, 'a')
    .replace(/[^a-z0-9а-я\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// RU "без X" and TK "X-syz/-siz" (Turkmen negation suffix) are the two ways this menu's real
// audience expresses an exclusion. Both are resolved to a small set of ingredient/attribute
// keys that are actually checked against name/description/smart_tags text -- never invented,
// never applied to a field the item doesn't have.
const EXCLUSION_SYNONYMS: Record<string, RegExp> = {
  onion: /лук|sogan/,
  spicy: /остр|перц|ajy|burc/,
  pork: /свинин|pork|doňuz/,
  cheese: /сыр|cheese|peýnir/,
  meat: /мясо|мясн|et\b/,
  mayo: /майонез|mayonez/,
  ketchup: /кетчуп|ketçup/,
  garlic: /чеснок|sarymsak/,
};
function parseExclusions(n: string): string[] {
  const found = new Set<string>();
  // RU: "без лука", "без острого", "без сыра" ...
  for (const m of n.matchAll(/без\s+([a-zа-я]+)/g)) {
    const word = m[1];
    let matched = false;
    for (const [key, rx] of Object.entries(EXCLUSION_SYNONYMS)) if (rx.test(word)) { found.add(key); matched = true; }
    if (!matched && word.length >= 3) found.add(word); // best-effort raw word, still checked against real text only
  }
  // TK: "sogansyz", "etsiz" -- word ending in -syz/-siz is "without <root>"
  for (const m of n.matchAll(/\b([a-z]{3,})(?:syz|siz)\b/g)) {
    const root = m[1];
    let matched = false;
    for (const [key, rx] of Object.entries(EXCLUSION_SYNONYMS)) if (rx.test(root) || rx.test(m[0])) { found.add(key); matched = true; }
    if (!matched) found.add(root);
  }
  return [...found];
}

function parseRequest(q: string) {
  const n = normalize(q);
  // People: anchored on a people-noun (человек/чел/гост/adam/kişi) right after the number, in
  // either order, so "нас 6 человек", "на 6 человек" and "6 adam" all resolve the same way --
  // not just the "на/для N" prefix form.
  const people = n.match(/(\d+)\s*(?:человек|чел|гост|persona|adam|kişi)/)?.[1]
    ?? n.match(/(?:на|для)\s*(\d+)/)?.[1];
  // Budget: anchored on a currency word right after the number ("2000 манат", "1500 manat"),
  // optionally preceded by a budget/limit word -- this is what actually disambiguates a budget
  // figure from a people-count figure in the same sentence, not word order.
  const budget = n.match(/(\d+(?:[.,]\d+)?)\s*(?:тмт|манат|manat|tmt|sum|сум)\b/)?.[1]
    ?? n.match(/(?:бюджет|budget|бюджет|до|не более|максимум|bujet)\s*(\d+(?:[.,]\d+)?)/)?.[1];
  const maxBudget = budget ? Number(budget.replace(',', '.')) : undefined;
  const wants = {
    breakfast: /завтрак|утр|saharlyk|ertirlik/.test(n),
    sweet: /слад|десерт|торт|ice cream|tatly|desert/.test(n),
    drink: /напит|кофе|чай|мохито|смузи|сок|içgi|cay|caj|kofe|şire/.test(n),
    burger: /бургер|гамбургер|burger/.test(n),
    pizza: /пицц|pizza/.test(n),
    side: /гарнир|картофель фри|фри\b|snack|garnir|fri\b/.test(n),
    light: /легк|лайт|light|yengil/.test(n),
    spicy: /остр|spicy|ajy/.test(n),
    filling: /сытн|плотн|doýur/.test(n),
    noMeat: /без мяса|вегет|etsiz|vegetarian/.test(n),
  };
  const exclusions = parseExclusions(n);
  const tokens = n.split(' ').filter(x => x.length >= 2 && !/^\d/.test(x));
  return { normalized: n, people: people ? Number(people) : undefined, maxBudget, wants, exclusions, tokens };
}

function excludedText(item: any): string {
  return normalize([item.name_ru, item.name_tk, item.description_ru, item.description_tk, item.smart_tags_ru, item.smart_tags_tk].join(' '));
}
function isExcluded(item: any, exclusions: string[]): boolean {
  if (!exclusions.length) return false;
  const hay = excludedText(item);
  return exclusions.some(word => {
    const rx = EXCLUSION_SYNONYMS[word];
    return rx ? rx.test(hay) : hay.includes(word);
  });
}

// -- Money as integer cents (matching the BigInt-cents convention used throughout the Order
// Core -- orders.ts/payments.ts) so the recommendation engine never touches floating point.
function moneyCents(v: unknown): bigint {
  const s = String(v ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return 0n;
  const [a, b = ''] = s.split('.');
  return BigInt(a) * 100n + BigInt((b + '00').slice(0, 2));
}
function centsText(c: bigint): string { return `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`; }

// No structured course/serving-size taxonomy exists on menu_items (only name/description/
// smart_tags/category free text) -- these bucket heuristics reuse the exact same keyword sets
// `scoreItem` already uses for "wants", so a combination never disagrees with what the plain
// search already considers a drink/side/main for the same query.
function bucketOf(item: any): 'drink' | 'side' | 'main' {
  const hay = excludedText(item) + ' ' + normalize(item.category_name_ru + ' ' + item.category_name_tk);
  if (/напит|кофе|чай|мохито|смузи|сок|içgi|cay|kofe|şire|drink/.test(hay)) return 'drink';
  if (/гарнир|фри\b|snack|garnir|fri\b|side/.test(hay)) return 'side';
  return 'main';
}

// Deterministic serving-size fallback, documented per Stage "Smart Search" spec section 6:
// the schema has no per-item serving-size field, so quantities are derived from a fixed,
// explainable ratio rather than guessed per request -- 1 main course per person (everyone
// eats), 1 drink per person, and 1 shared side portion per 3 people (a common bar-food
// sharing ratio). Budget is the hard constraint (section 7): if the full ratio does not fit,
// sides are dropped first, then drinks, before a main-course-only combination is attempted;
// if even that does not fit, no combination is returned for that candidate main.
function buildCombination(people: number, mains: any[], drinks: any[], sides: any[], budgetCents: bigint | null, lang: 'ru' | 'tk', label: string) {
  for (const main of mains.slice(0, 3)) {
    const mainUnit = moneyCents(main.item.price);
    const drinkUnit = drinks[0] ? moneyCents(drinks[0].item.price) : 0n;
    const sideUnit = sides[0] ? moneyCents(sides[0].item.price) : 0n;
    const sideQtyTarget = Math.max(1, Math.ceil(people / 3));
    const variants: Array<{ drinkQty: number; sideQty: number }> = [
      { drinkQty: people, sideQty: sides[0] ? sideQtyTarget : 0 },
      { drinkQty: people, sideQty: 0 },
      { drinkQty: 0, sideQty: 0 },
    ];
    for (const v of variants) {
      const mainTotal = mainUnit * BigInt(people);
      const drinkTotal = drinkUnit * BigInt(v.drinkQty);
      const sideTotal = sideUnit * BigInt(v.sideQty);
      const total = mainTotal + drinkTotal + sideTotal;
      if (budgetCents !== null && total > budgetCents) continue;
      const lines: any[] = [{ id: main.item.id, name: lang === 'tk' ? main.item.name_tk : main.item.name_ru, quantity: people, unit_price: centsText(mainUnit), line_total: centsText(mainTotal) }];
      if (v.drinkQty > 0 && drinks[0]) lines.push({ id: drinks[0].item.id, name: lang === 'tk' ? drinks[0].item.name_tk : drinks[0].item.name_ru, quantity: v.drinkQty, unit_price: centsText(drinkUnit), line_total: centsText(drinkTotal) });
      if (v.sideQty > 0 && sides[0]) lines.push({ id: sides[0].item.id, name: lang === 'tk' ? sides[0].item.name_tk : sides[0].item.name_ru, quantity: v.sideQty, unit_price: centsText(sideUnit), line_total: centsText(sideTotal) });
      return {
        label,
        people,
        items: lines,
        total: centsText(total),
        remaining_budget: budgetCents !== null ? centsText(budgetCents - total) : null,
      };
    }
  }
  return null;
}

function buildRecommendations(people: number | undefined, maxBudget: number | undefined, scored: any[], lang: 'ru' | 'tk') {
  if (!people || people < 1) return [];
  const budgetCents = maxBudget !== undefined ? moneyCents(String(maxBudget)) : null;
  const byBucket = { main: [] as any[], drink: [] as any[], side: [] as any[] };
  for (const s of scored) byBucket[bucketOf(s.item)].push(s);
  for (const k of Object.keys(byBucket) as Array<keyof typeof byBucket>) byBucket[k].sort((a, b) => b.ranking.score - a.ranking.score);
  if (!byBucket.main.length) return [];

  const options: any[] = [];
  const labelBest = lang === 'tk' ? `${people} adam üçin` : `На ${people} человек`;
  const opt1 = buildCombination(people, byBucket.main, byBucket.drink, byBucket.side, budgetCents, lang, labelBest);
  if (opt1) options.push(opt1);

  // A second, distinctly cheaper option using the next-best main course, if one exists and
  // produces a genuinely different combination within budget.
  if (byBucket.main.length > 1) {
    const labelAlt = lang === 'tk' ? `Alternatiw wariant` : `Альтернативный вариант`;
    const opt2 = buildCombination(people, byBucket.main.slice(1), byBucket.drink, byBucket.side, budgetCents, lang, labelAlt);
    if (opt2 && (!opt1 || opt2.items[0].id !== opt1.items[0].id)) options.push(opt2);
  }
  return options.slice(0, 3);
}

function scoreItem(item: any, parsed: ReturnType<typeof parseRequest>, lang: 'ru'|'tk') {
  const hay = normalize([item.name_ru, item.name_tk, item.description_ru, item.description_tk, item.smart_tags_ru, item.smart_tags_tk, item.category_name_ru, item.category_name_tk].join(' '));
  let score = 0;
  const matched: string[] = [];
  for (const token of parsed.tokens) {
    if (hay.includes(token)) { score += 8; matched.push(token); }
  }
  const w = parsed.wants;
  const checks: Array<[boolean, RegExp, number, string]> = [
    [w.breakfast, /завтрак|saharlyk|ertirlik/, 18, 'подходит для завтрака'],
    [w.sweet, /слад|десерт|tatly|desert/, 18, 'подходит для сладкого'],
    [w.drink, /напит|кофе|чай|мохито|смузи|сок|içgi|cay|kofe|şire/, 18, 'подходит как напиток'],
    [w.burger, /бургер|гамбургер|burger/, 22, 'подходит под запрос на бургер'],
    [w.pizza, /пицц|pizza/, 22, 'подходит под запрос на пиццу'],
    [w.side, /гарнир|фри|snack|garnir|fri/, 16, 'хороший гарнир'],
    [w.light, /легк|лайт|light|yengil/, 12, 'отмечено как лёгкий вариант'],
    [w.spicy, /остр|spicy|ajy/, 12, 'соответствует запросу на острое'],
    [w.filling, /сытн|плотн|doýur|бургер|burger|пицц|pizza/, 10, 'подходит, чтобы наесться'],
    [w.noMeat, /без мяса|вегет|etsiz|vegetarian/, 25, 'соответствует ограничению без мяса'],
  ];
  for (const [active, rx, pts, reason] of checks) if (active && rx.test(hay)) { score += pts; matched.push(reason); }
  if (parsed.maxBudget !== undefined) {
    if (Number(item.price) <= parsed.maxBudget) { score += 15; matched.push('в пределах бюджета'); }
    else score -= 20;
  }
  return { score, matched: [...new Set(matched)].slice(0, 4), name: lang === 'tk' ? item.name_tk : item.name_ru };
}

router.get('/branches', async (_req, res) => {
  const branches = await query<any>(`SELECT id,name,code,address,phone,currency FROM branches WHERE status='ACTIVE' ORDER BY name`);
  res.json({ branches });
});

// Stage 35.6 -- QR menu entry. The QR code encodes ONLY this opaque token; the branch it opens is
// resolved here, server-side, from that token. The client never supplies a branch id for a QR
// flow, so a scanned code can never be redirected onto another branch's data (no IDOR surface).
// Only the same public-safe branch fields as /branches are returned -- no recipes, no cost, no
// stock, no employee or CRM data exists on this path at all.
router.get('/qr/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error:'VALIDATION_ERROR', code:'QR_TOKEN_REQUIRED', message:'A QR token is required.', details:{} });
  const b = await queryOne<any>(`SELECT id,name,code,address,phone,currency FROM branches WHERE qr_token=? AND status='ACTIVE'`, [token]);
  if (!b) return res.status(404).json({ error:'NOT_FOUND', code:'QR_CODE_NOT_FOUND', message:'This QR code is not recognised.', details:{} });
  res.json({ branch: b });
});

router.get('/menu', async (req, res) => {
  const branch = String(req.query.branch_id || '').trim();
  const lang = String(req.query.lang || 'ru').toLowerCase() === 'tk' ? 'tk' : 'ru';
  if (!branch) return res.status(400).json({ error:'VALIDATION_ERROR', code:'BRANCH_REQUIRED', message:'branch_id is required.', details:{} });
  const b = await queryOne<any>(`SELECT id,name,code,address,phone,currency FROM branches WHERE id=? AND status='ACTIVE'`, [branch]);
  if (!b) return res.status(404).json({ error:'NOT_FOUND', code:'BRANCH_NOT_FOUND', message:'Branch not found.', details:{} });
  const rows = await query<any>(`SELECT mi.id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.description_ru,mi.description_tk,mi.price,mi.smart_tags_ru,mi.smart_tags_tk,mc.name_ru AS category_name_ru,mc.name_tk AS category_name_tk
    FROM menu_items mi JOIN menu_categories mc ON mc.id=mi.category_id
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL) AND mi.status='ACTIVE' AND mi.deleted_at IS NULL AND mc.status='ACTIVE' AND mc.deleted_at IS NULL
    ORDER BY mc.sort_order,mi.sort_order,mi.name_ru`, [branch]);
  // Stage 35.6: the real promotional price, if this item is genuinely inside an active promotion
  // window right now -- computed by the ONE shared rule (activePromotionMap), never invented here.
  const promos = await activePromotionMap(branch, new Date().toISOString());
  const items = rows.map((x:any) => { const promo = promos.get(x.id); return { id:x.id, category_id:x.category_id, sku:x.sku, name:lang==='tk'?x.name_tk:x.name_ru, description:lang==='tk'?x.description_tk:x.description_ru, category_name:lang==='tk'?x.category_name_tk:x.category_name_ru, price:String(x.price), tags:lang==='tk'?x.smart_tags_tk:x.smart_tags_ru, promo_price: promo ? promo.promo_price : null, promo_badge: promo ? (lang==='tk'?promo.badge_tk:promo.badge_ru) : null, promo_ends_at: promo ? promo.ends_at : null }; });
  res.json({ branch:b, language:lang, items });
});

router.get('/smart-search', async (req, res) => {
  const branch = String(req.query.branch_id || '').trim();
  const q = String(req.query.q || '').trim();
  const lang = String(req.query.lang || 'ru').toLowerCase() === 'tk' ? 'tk' : 'ru';
  if (!branch || !q) return res.status(400).json({ error:'VALIDATION_ERROR', code:'SEARCH_INPUT_REQUIRED', message:'branch_id and q are required.', details:{} });
  const b = await queryOne<any>(`SELECT id,name,code,currency FROM branches WHERE id=? AND status='ACTIVE'`, [branch]);
  if (!b) return res.status(404).json({ error:'NOT_FOUND', code:'BRANCH_NOT_FOUND', message:'Branch not found.', details:{} });
  const parsed = parseRequest(q);
  // Availability == the same "currently orderable" definition the rest of BOOM OS already
  // uses (menu.ts, orders.ts order creation): ACTIVE status, not soft-deleted, correct branch
  // (or a network-wide item with branch_id NULL), category ACTIVE too. No second availability
  // system -- this is the exact WHERE clause the order-creation path itself uses.
  const rows = await query<any>(`SELECT mi.id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.description_ru,mi.description_tk,mi.price,mi.smart_tags_ru,mi.smart_tags_tk,mc.name_ru AS category_name_ru,mc.name_tk AS category_name_tk
    FROM menu_items mi JOIN menu_categories mc ON mc.id=mi.category_id
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL) AND mi.status='ACTIVE' AND mi.deleted_at IS NULL AND mc.status='ACTIVE' AND mc.deleted_at IS NULL`, [branch]);
  const candidates = rows.filter((item: any) => !isExcluded(item, parsed.exclusions));
  const allScored = candidates.map((item:any) => ({ item, ranking:scoreItem(item, parsed, lang) })).sort((a:any,b:any)=>b.ranking.score- a.ranking.score);
  const scored = allScored.filter((x:any)=>x.ranking.score>0).slice(0, 20);
  const items = scored.map((x:any)=>({ id:x.item.id, category_id:x.item.category_id, sku:x.item.sku, name:lang==='tk'?x.item.name_tk:x.item.name_ru, description:lang==='tk'?x.item.description_tk:x.item.description_ru, category_name:lang==='tk'?x.item.category_name_tk:x.item.category_name_ru, price:String(x.item.price), score:x.ranking.score, reasons:x.ranking.matched }));
  const recommendations = buildRecommendations(parsed.people, parsed.maxBudget, allScored, lang);
  res.json({
    branch:b, query:q,
    parsed:{people:parsed.people,max_budget:parsed.maxBudget,currency:b.currency,preferences:parsed.wants,exclusions:parsed.exclusions},
    items, recommendations,
    disclaimer:'Recommendations use only active menu data from the selected branch. No dishes or prices are invented, availability is not invented, and totals are calculated server-side and never exceed the requested budget.'
  });
});

export default router;
