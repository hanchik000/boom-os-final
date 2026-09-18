# Phase 5 — Turkmen language foundation

BOOM OS supports Russian (`ru`) and Turkmen (`tk`) as first-class UI locales.

Rules:
- UI strings must come from the translation dictionaries; new screens must not hard-code Russian/English text.
- Turkmen uses Latin orthography including ä, ç, ň, ö, ş, ü, ý.
- Language choice is persisted in localStorage and applied to the document language attribute.
- Backend data values (product names, employee names, etc.) are not translated automatically; localized content belongs to the data model and CMS layer.
- Smart Search will later parse Russian, Turkmen, and mixed-language requests into the same structured intent model.
