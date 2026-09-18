import React, { createContext, useContext, useState, useEffect } from 'react';
import { ru, TranslationKey } from '../translations/ru';
import { tk } from '../translations/tk';

export type Language = 'ru' | 'tk';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, fallback?: string) => string;
}

const translations: Record<Language, Record<TranslationKey, string>> = {
  ru,
  tk
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem('boom_os_language');
      if (stored === 'tk' || stored === 'ru') return stored;
    } catch {
      // ignore
    }
    return 'ru';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem('boom_os_language', lang);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    document.documentElement.lang = language === 'tk' ? 'tk' : 'ru';
    document.documentElement.dir = 'ltr';
  }, [language]);

  const t = (key: TranslationKey, fallback?: string): string => {
    const langDict = translations[language] || translations.ru;
    return langDict[key] || translations.ru[key] || fallback || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
