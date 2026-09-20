// ---------------------------------------------------------------------------------------------
// Stage 40 -- errors in human language.
//
// The server speaks in codes, which is right: a code is stable, translatable and safe to test
// against. What was wrong is that the CODE reached the operator's screen. Someone restocking a
// fridge should read "There is not enough of this product in stock to complete the order", not
// "Insufficient stock", and certainly not "Request failed with status 403".
//
// This maps the codes an operator can actually cause onto a sentence that says what happened and,
// where there is one, what to do next. It changes NO server behaviour and NO status code: the
// original code stays on the error object for tests and for the few screens that branch on it.
// An unmapped code falls back to the server's own message, so nothing is ever swallowed.
// ---------------------------------------------------------------------------------------------

type Lang = 'ru' | 'tk';

const MESSAGES: Record<string, { ru: string; tk: string }> = {
  // --- access -------------------------------------------------------------------------------
  FORBIDDEN:              { ru: 'У вас нет доступа к этому разделу.', tk: 'Bu bölüme elýeterliligiňiz ýok.' },
  BRANCH_ACCESS_DENIED:   { ru: 'Этот филиал вам недоступен.', tk: 'Bu şahamça size elýeterli däl.' },
  UNAUTHORIZED:           { ru: 'Войдите в систему заново — сессия истекла.', tk: 'Ulgama täzeden giriň — sessiýa gutardy.' },
  TOKEN_EXPIRED:          { ru: 'Сессия истекла. Войдите заново.', tk: 'Sessiýa gutardy. Täzeden giriň.' },

  // --- stock and kitchen --------------------------------------------------------------------
  INSUFFICIENT_STOCK:     { ru: 'Недостаточно товара на складе для выполнения заказа.', tk: 'Sargydy ýerine ýetirmek üçin ammarda haryt ýeterlik däl.' },
  INVENTORY_ITEM_NOT_FOUND: { ru: 'Этот товар не найден на складе филиала.', tk: 'Bu haryt şahamçanyň ammarynda tapylmady.' },
  KDS_NOT_READY_FOR_PAYMENT: { ru: 'Кухня ещё не отметила заказ готовым.', tk: 'Aşhana sargydy entek taýýar diýip bellemedi.' },

  // --- orders and payment -------------------------------------------------------------------
  ORDER_NOT_READY_FOR_PAYMENT: { ru: 'Этот заказ ещё нельзя оплатить.', tk: 'Bu sargydy entek tölemek bolmaýar.' },
  ORDER_NOT_FOUND:        { ru: 'Заказ не найден.', tk: 'Sargyt tapylmady.' },
  TABLE_REQUIRED:         { ru: 'Выберите стол для заказа в зале.', tk: 'Zaldaky sargyt üçin stol saýlaň.' },
  PAYMENT_AMOUNT_MUST_EQUAL_REMAINING: { ru: 'Сумма оплаты должна совпадать с остатком по счёту.', tk: 'Töleg möçberi hasabyň galyndysy bilen deň bolmaly.' },
  PAYMENT_AMOUNT_MUST_BE_POSITIVE: { ru: 'Сумма оплаты должна быть больше нуля.', tk: 'Töleg möçberi noldan uly bolmaly.' },
  OPEN_SHIFT_REQUIRED:    { ru: 'Сначала откройте кассовую смену.', tk: 'Ilki kassa çalyşygyny açyň.' },
  BILL_ALREADY_PAID:      { ru: 'Этот счёт уже оплачен.', tk: 'Bu hasap eýýäm tölenen.' },
  BILL_REQUIRED_FOR_SPLIT_ORDER: { ru: 'Выберите счёт гостя — заказ разделён.', tk: 'Myhmanyň hasabyny saýlaň — sargyt bölünen.' },
  CREDIT_LIMIT_EXCEEDED:  { ru: 'Превышен кредитный лимит клиента.', tk: 'Müşderiniň karz çägi aşyldy.' },
  MODIFIER_SELECTION_INVALID: { ru: 'Проверьте выбранные добавки — не хватает обязательных или выбрано слишком много.', tk: 'Saýlanan goşmaçalary barlaň — hökmanylary ýetmeýär ýa-da aşa köp saýlandy.' },
  MODIFIER_UNAVAILABLE:   { ru: 'Одна из добавок больше недоступна.', tk: 'Goşmaçalaryň biri indi elýeterli däl.' },
  MODIFIER_SOURCE_UNAVAILABLE: { ru: 'Один из компонентов снят с продажи.', tk: 'Komponentleriň biri satuwdan aýryldy.' },

  // --- menu ---------------------------------------------------------------------------------
  MENU_SKU_IN_USE:        { ru: 'Такой артикул уже используется другим блюдом.', tk: 'Bu artikul başga nahar tarapyndan ulanylýar.' },
  MENU_ITEM_NOT_FOUND:    { ru: 'Блюдо не найдено.', tk: 'Nahar tapylmady.' },
  MENU_CATEGORY_NOT_FOUND: { ru: 'Категория не найдена в этом филиале.', tk: 'Bu şahamçada kategoriýa tapylmady.' },
  INVALID_DISH_WEIGHT:    { ru: 'Укажите вес числом и выберите единицу измерения.', tk: 'Agramy san bilen ýazyň we ölçeg birligini saýlaň.' },
  INVALID_ALLERGEN:       { ru: 'Один из выбранных аллергенов больше не используется.', tk: 'Saýlanan allergenleriň biri indi ulanylmaýar.' },
  MEDIA_ASSET_NOT_FOUND:  { ru: 'Это изображение больше не доступно.', tk: 'Bu surat indi elýeterli däl.' },
  BLOCK_DUPLICATES_MENU_DATA: { ru: 'Название, фото и цена берутся из карточки блюда — здесь их задавать не нужно.', tk: 'At, surat we baha nahar kartasyndan alynýar — bu ýerde girizmeli däl.' },
  INVALID_DESIGN_PRESET:  { ru: 'Выберите один из доступных вариантов оформления.', tk: 'Elýeterli bezeg görnüşleriniň birini saýlaň.' },

  // --- generic ------------------------------------------------------------------------------
  VALIDATION_ERROR:       { ru: 'Проверьте заполненные поля.', tk: 'Doldurylan meýdanlary barlaň.' },
  CONFLICT:               { ru: 'Данные изменились — обновите страницу и повторите.', tk: 'Maglumatlar üýtgedi — sahypany täzeläp gaýtalaň.' },
  NOT_FOUND:              { ru: 'Запись не найдена.', tk: 'Ýazgy tapylmady.' },
};

const BY_STATUS: Record<number, { ru: string; tk: string }> = {
  401: MESSAGES.UNAUTHORIZED,
  403: MESSAGES.FORBIDDEN,
  404: MESSAGES.NOT_FOUND,
  409: MESSAGES.CONFLICT,
  500: { ru: 'Что-то пошло не так. Повторите попытку.', tk: 'Bir zat ýalňyş boldy. Gaýtadan synanyşyň.' },
};

/**
 * A sentence an operator can act on, for an error the API client threw.
 * Falls back to the server's own message, then to a plain status sentence -- never to a raw code.
 */
export function humanError(error: any, lang: Lang = 'ru'): string {
  const code = error?.code || error?.error;
  const mapped = code && MESSAGES[String(code)];
  if (mapped) return mapped[lang];
  const byStatus = error?.status && BY_STATUS[Number(error.status)];
  // A server message is already a sentence; a bare code is not, so only fall through to one that
  // looks like prose.
  const raw = typeof error?.message === 'string' ? error.message.trim() : '';
  const looksLikeCode = /^[A-Z][A-Z0-9_]{3,}$/.test(raw) || /^HTTP \d+$/.test(raw);
  if (!looksLikeCode && raw) return raw;
  if (byStatus) return byStatus[lang];
  return lang === 'tk' ? 'Bir zat ýalňyş boldy. Gaýtadan synanyşyň.' : 'Что-то пошло не так. Повторите попытку.';
}

/** The codes this module knows about -- exported so a guard can assert coverage. */
export const HUMAN_ERROR_CODES = Object.keys(MESSAGES);
