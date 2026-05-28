/**
 * TranslationEngine — traduce testo usando MyMemory API (gratuita, no API key)
 *
 * MyMemory: https://mymemory.translated.net/
 *   - 5.000 parole/giorno gratis (anonimo) — più che sufficiente per guida turistica
 *   - Nessuna registrazione, nessuna chiave API
 *   - Supporta tutte le lingue BCP-47
 *
 * Fallback: restituisce il testo originale se offline / errore API
 * Cache LRU semplice: evita richieste duplicate per frasi già tradotte
 */

export class TranslationEngine {
  private cache = new Map<string, string>();
  private sourceLang: string;
  private targetLang: string;
  private pendingRequest: AbortController | null = null;

  constructor(sourceLang: string, targetLang: string) {
    this.sourceLang = sourceLang;
    this.targetLang = targetLang;
  }

  /** Aggiorna le lingue (chiamato quando l'utente cambia impostazione) */
  update(sourceLang: string, targetLang: string): void {
    if (this.sourceLang !== sourceLang || this.targetLang !== targetLang) {
      this.sourceLang = sourceLang;
      this.targetLang = targetLang;
      this.cache.clear();
    }
  }

  /**
   * Traduce `text` dalla lingua sorgente alla lingua target.
   * Restituisce il testo originale se le lingue sono uguali o in caso di errore.
   */
  async translate(text: string): Promise<string> {
    if (!text.trim()) return text;
    if (this.sourceLang === this.targetLang) return text;

    const cacheKey = `${this.sourceLang}|${this.targetLang}|${text}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    // Annulla la richiesta precedente se ancora in volo
    this.pendingRequest?.abort();
    const controller = new AbortController();
    this.pendingRequest = controller;

    try {
      const langPair = `${this.sourceLang}|${this.targetLang}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;

      const response = await fetch(url, {
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const json = await response.json() as {
        responseStatus: number;
        responseData: { translatedText: string };
      };

      if (json.responseStatus !== 200) throw new Error(`MyMemory status ${json.responseStatus}`);

      const translated = json.responseData?.translatedText ?? text;

      // Cache LRU semplice (max 200 voci)
      if (this.cache.size >= 200) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) this.cache.delete(firstKey);
      }
      this.cache.set(cacheKey, translated);

      return translated;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return text;
      console.warn('[TranslationEngine] fallback al testo originale:', err);
      return text; // fallback: mostra la frase in lingua originale
    } finally {
      if (this.pendingRequest === controller) this.pendingRequest = null;
    }
  }

  destroy(): void {
    this.pendingRequest?.abort();
    this.cache.clear();
  }
}
