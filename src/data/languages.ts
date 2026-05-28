export interface Language {
  code: string;
  name: string;
  flag: string;
  nativeName: string;
}

export const LANGUAGES: Language[] = [
  { code: 'it', name: 'Italiano',   flag: '🇮🇹', nativeName: 'Italiano' },
  { code: 'en', name: 'Inglese',    flag: '🇬🇧', nativeName: 'English' },
  { code: 'es', name: 'Spagnolo',   flag: '🇪🇸', nativeName: 'Español' },
  { code: 'fr', name: 'Francese',   flag: '🇫🇷', nativeName: 'Français' },
  { code: 'de', name: 'Tedesco',    flag: '🇩🇪', nativeName: 'Deutsch' },
  { code: 'pt', name: 'Portoghese', flag: '🇵🇹', nativeName: 'Português' },
  { code: 'ru', name: 'Russo',      flag: '🇷🇺', nativeName: 'Русский' },
  { code: 'zh', name: 'Cinese',     flag: '🇨🇳', nativeName: '中文' },
  { code: 'ja', name: 'Giapponese', flag: '🇯🇵', nativeName: '日本語' },
  { code: 'ar', name: 'Arabo',      flag: '🇸🇦', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi',      flag: '🇮🇳', nativeName: 'हिन्दी' },
  { code: 'ko', name: 'Coreano',    flag: '🇰🇷', nativeName: '한국어' },
  { code: 'nl', name: 'Olandese',   flag: '🇳🇱', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polacco',    flag: '🇵🇱', nativeName: 'Polski' },
  { code: 'tr', name: 'Turco',      flag: '🇹🇷', nativeName: 'Türkçe' },
  { code: 'uk', name: 'Ucraino',    flag: '🇺🇦', nativeName: 'Українська' },
];

export function getLang(code: string): Language {
  return LANGUAGES.find(l => l.code === code) ?? LANGUAGES[0];
}
