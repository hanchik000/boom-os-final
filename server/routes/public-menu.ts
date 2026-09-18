import { Router } from 'express';
import { query, queryOne } from '../db';

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

function parseRequest(q: string) {
  const n = normalize(q);
  const people = n.match(/(?:на|для)\s*(\d+)\s*(?:чел|челов|гост|адам|adam|kişi)?/)?.[1];
  const budget = n.match(/(?:до|не более|максимум|bujet|baha|<=?)\s*(\d+(?:[.,]\d+)?)\s*(?:тмт|манат|manat|tm[t]?|m)?/)?.[1];
  const maxBudget = budget ? Number(budget.replace(',', '.')) : undefined;
  const wants = {
    breakfast: /завтрак|утр|saharlyk|ertirlik/.test(n),
    sweet: /слад|десерт|торт|ice cream|tatly|desert/.test(n),
    drink: /напит|кофе|чай|мохито|смузи|сок|içgi|cay|caj|kofe|şire/.test(n),
    burger: /бургер|гамбургер|burger/.test(n),
    pizza: /пицц|pizza/.test(n),
    light: /легк|лайт|light|yengil/.test(n),
    spicy: /остр|spicy|ajy/.test(n),
    noMeat: /без мяса|вегет|et[siz]*|etsiz|vegetarian/.test(n),
  };
  const tokens = n.split(' ').filter(x => x.length >= 2 && !/^\d/.test(x));
  return { normalized: n, people: people ? Number(people) : undefined, maxBudget, wants, tokens };
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
    [w.light, /легк|лайт|light|yengil/, 12, 'отмечено как лёгкий вариант'],
    [w.spicy, /остр|spicy|ajy/, 12, 'соответствует запросу на острое'],
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
  const items = rows.map((x:any) => ({ id:x.id, category_id:x.category_id, sku:x.sku, name:lang==='tk'?x.name_tk:x.name_ru, description:lang==='tk'?x.description_tk:x.description_ru, category_name:lang==='tk'?x.category_name_tk:x.category_name_ru, price:String(x.price), tags:lang==='tk'?x.smart_tags_tk:x.smart_tags_ru }));
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
  const rows = await query<any>(`SELECT mi.id,mi.category_id,mi.sku,mi.name_ru,mi.name_tk,mi.description_ru,mi.description_tk,mi.price,mi.smart_tags_ru,mi.smart_tags_tk,mc.name_ru AS category_name_ru,mc.name_tk AS category_name_tk
    FROM menu_items mi JOIN menu_categories mc ON mc.id=mi.category_id
    WHERE (mi.branch_id=? OR mi.branch_id IS NULL) AND mi.status='ACTIVE' AND mi.deleted_at IS NULL AND mc.status='ACTIVE' AND mc.deleted_at IS NULL`, [branch]);
  const scored = rows.map((item:any) => ({ item, ranking:scoreItem(item, parsed, lang) })).filter((x:any)=>x.ranking.score>0).sort((a:any,b:any)=>b.ranking.score- a.ranking.score).slice(0, 20);
  const items = scored.map((x:any)=>({ id:x.item.id, category_id:x.item.category_id, sku:x.item.sku, name:lang==='tk'?x.item.name_tk:x.item.name_ru, description:lang==='tk'?x.item.description_tk:x.item.description_ru, category_name:lang==='tk'?x.item.category_name_tk:x.item.category_name_ru, price:String(x.item.price), score:x.ranking.score, reasons:x.ranking.matched }));
  res.json({ branch:b, query:q, parsed:{people:parsed.people,max_budget:parsed.maxBudget,preferences:parsed.wants}, items, disclaimer:'Recommendations use only active menu data from the selected branch. No dishes or prices are invented.' });
});

export default router;
