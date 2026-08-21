export type AppLanguage='zh'|'en'

export function languageFromLocale(locale:string|undefined):AppLanguage {
  return locale?.toLowerCase().startsWith('zh')?'zh':'en'
}
