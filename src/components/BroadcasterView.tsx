import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Radio, Square, Users, Mic, Sparkles, Eye, EyeOff } from 'lucide-react';
import { BLEBroadcaster } from '../ble/BLEBroadcaster';
import { SpeechCapture } from '../audio/SpeechCapture';
import { OpenAITranslator } from '../audio/OpenAITranslator';
import LanguagePicker from './LanguagePicker';

interface Props { onBack: () => void; }

type BroadcastState = 'idle' | 'starting' | 'live' | 'stopping' | 'error';

export default function BroadcasterView({ onBack }: Props) {
  const [state, setState] = useState<BroadcastState>('idle');
  const [listeners, setListeners] = useState(0);
  const [framesSent, setFramesSent] = useState(0);
  const [error, setError] = useState('');
  const [sourceLang, setSourceLang] = useState('it');
  const [liveText, setLiveText] = useState('');

  // Modalità OpenAI
  const [useOpenAI, setUseOpenAI] = useState(OpenAITranslator.hasKey('broadcaster'));
  const [apiKey, setApiKey] = useState(OpenAITranslator.getStoredKey('broadcaster'));
  const [showKey, setShowKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);

  const broadcasterRef = useRef<BLEBroadcaster | null>(null);
  const captureRef     = useRef<SpeechCapture | null>(null);
  const translatorRef  = useRef<OpenAITranslator | null>(null);
  const sentRef        = useRef(0);

  const isLive    = state === 'live';
  const hasApiKey = apiKey.startsWith('sk-');

  const saveApiKey = (key: string) => {
    setApiKey(key);
    OpenAITranslator.saveKey('broadcaster', key);
    if (key.startsWith('sk-')) {
      translatorRef.current = new OpenAITranslator(key);
    }
  };

  const start = useCallback(async () => {
    setState('starting');
    setError('');
    sentRef.current = 0;

    // Crea translator OpenAI se abilitato
    if (useOpenAI && hasApiKey) {
      translatorRef.current = new OpenAITranslator(apiKey);
    }

    try {
      const broadcaster = new BLEBroadcaster();
      broadcaster.onConnectedCountChange = (count) => setListeners(count);
      await broadcaster.initialize();
      await broadcaster.startBroadcast();
      broadcasterRef.current = broadcaster;

      const capture = new SpeechCapture(sourceLang, async (text, isFinal) => {
        setLiveText(text);

        // Invia solo le frasi finali (o parziali lunghe)
        if (!isFinal && text.length < 40) return;

        try {
          if (useOpenAI && translatorRef.current && isFinal) {
            // ── MODELLO BROADCASTER PAGA ─────────────────────────────────
            // Traduci in parallelo in tutte le lingue comuni, poi invia
            // pacchetti con tag lingua — i receiver ricevono già tradotto, gratis
            const targetLangs = ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ar', 'pt', 'ru', 'ko']
              .filter(l => l !== sourceLang);
            const translations = await translatorRef.current.translateAll(text, sourceLang, targetLangs);
            // Aggiungi anche il testo originale per i receiver nella stessa lingua
            translations.set(sourceLang, text);
            await broadcaster.sendTranslatedTexts(translations, isFinal);
          } else {
            // ── MODELLO RECEIVER PAGA (o base gratuito) ───────────────────
            // Invia il testo originale — ogni receiver traduce da solo
            await broadcaster.sendText(text, isFinal);
          }

          sentRef.current++;
          setFramesSent(sentRef.current);
        } catch (e) {
          console.warn('[BroadcasterView] send error:', e);
        }

        if (isFinal) setTimeout(() => setLiveText(''), 1500);
      });

      await capture.start();
      captureRef.current = capture;
      setState('live');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto');
      setState('error');
    }
  }, [sourceLang, useOpenAI, hasApiKey, apiKey]);

  const stop = useCallback(async () => {
    setState('stopping');
    captureRef.current?.stop();
    translatorRef.current?.destroy();
    await broadcasterRef.current?.stopBroadcast();
    broadcasterRef.current?.destroy();
    captureRef.current = null;
    translatorRef.current = null;
    broadcasterRef.current = null;
    setListeners(0);
    setFramesSent(0);
    setLiveText('');
    setState('idle');
  }, []);

  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      translatorRef.current?.destroy();
      broadcasterRef.current?.stopBroadcast().catch(() => {});
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center px-4 pt-4 pb-2">
        <button onClick={onBack} disabled={isLive}
          className="p-2 rounded-full text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="ml-3 text-base font-semibold text-white">Modalità Broadcast</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-between px-6 py-4 gap-4">

        {/* Language selector */}
        <div className="w-full max-w-xs relative">
          <LanguagePicker
            label="Sto parlando in"
            value={sourceLang}
            onChange={setSourceLang}
            disabled={isLive}
          />
          {isLive && (
            <p className="text-xs text-gray-600 mt-2 text-center">
              Lingua bloccata durante la trasmissione
            </p>
          )}
        </div>

        {/* ── OpenAI Translation Toggle ── */}
        {!isLive && (
          <div className="w-full max-w-xs">
            {/* Toggle card */}
            <button
              onClick={() => {
                const next = !useOpenAI;
                setUseOpenAI(next);
                if (next && !hasApiKey) setShowKeyInput(true);
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-all
                          ${useOpenAI && hasApiKey
                            ? 'bg-purple-500/10 border-purple-500/40'
                            : 'bg-[#1a1a1a] border-[#2a2a2a]'}`}
            >
              <div className="flex items-center gap-3">
                <Sparkles className={`w-5 h-5 ${useOpenAI && hasApiKey ? 'text-purple-400' : 'text-gray-500'}`} />
                <div className="text-left">
                  <p className={`text-sm font-semibold ${useOpenAI && hasApiKey ? 'text-purple-300' : 'text-gray-300'}`}>
                    Traduzione AI (OpenAI)
                  </p>
                  <p className="text-xs text-gray-600">
                    {useOpenAI && hasApiKey
                      ? 'Pre-traduco per tutti · Receiver ricevono gratis'
                      : 'Ogni receiver traduce da solo'}
                  </p>
                </div>
              </div>
              {/* Toggle pill */}
              <div className={`w-11 h-6 rounded-full transition-colors relative
                              ${useOpenAI && hasApiKey ? 'bg-purple-500' : 'bg-gray-700'}`}>
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                                ${useOpenAI && hasApiKey ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
            </button>

            {/* API Key input */}
            {useOpenAI && (
              <div className="mt-2">
                <button
                  onClick={() => setShowKeyInput(v => !v)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors mb-1.5"
                >
                  {showKeyInput ? '▲ Nascondi chiave API' : '▼ Imposta chiave API OpenAI'}
                </button>
                {showKeyInput && (
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => saveApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5
                                 text-white text-sm font-mono placeholder-gray-600 focus:outline-none
                                 focus:border-purple-500/50 pr-10"
                    />
                    <button
                      onClick={() => setShowKey(v => !v)}
                      className="absolute right-2.5 top-2.5 text-gray-600 hover:text-gray-400"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                )}
                {useOpenAI && !hasApiKey && (
                  <p className="text-xs text-yellow-500/80 mt-1.5">
                    ⚠ Inserisci la chiave API per attivare la modalità AI
                  </p>
                )}
                {useOpenAI && hasApiKey && (
                  <p className="text-xs text-purple-400/70 mt-1.5">
                    ✓ Traduco in ~10 lingue per ogni frase · ~$0.002/ora
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Mic button + live text */}
        <div className="flex flex-col items-center gap-5 w-full max-w-xs">
          <div className="relative flex items-center justify-center">
            {isLive && (
              <>
                <div className="absolute w-52 h-52 rounded-full bg-red-500/10 animate-ping"
                     style={{ animationDuration: '2s' }} />
                <div className="absolute w-44 h-44 rounded-full bg-red-500/15 animate-ping"
                     style={{ animationDuration: '1.5s', animationDelay: '0.3s' }} />
              </>
            )}
            <button
              onClick={isLive ? stop : start}
              disabled={state === 'starting' || state === 'stopping'}
              className={`relative w-36 h-36 rounded-full flex items-center justify-center
                          shadow-2xl active:scale-95 transition-all duration-200 disabled:opacity-50
                          ${isLive
                            ? 'bg-red-500 shadow-red-500/40 hover:bg-red-600'
                            : 'bg-green-500 shadow-green-500/40 hover:bg-green-400'
                          }`}
            >
              {isLive
                ? <Square className="w-12 h-12 text-white fill-white" />
                : <Radio className="w-12 h-12 text-white" />
              }
            </button>
          </div>

          {/* Status */}
          <div className="text-center min-h-[40px]">
            {state === 'idle'     && <p className="text-gray-400">Premi per trasmettere</p>}
            {state === 'starting' && <p className="text-yellow-400 animate-pulse">Avvio...</p>}
            {state === 'live'     && (
              <div className="flex flex-col items-center gap-1">
                <p className="text-red-400 font-semibold animate-pulse">🔴 IN ONDA</p>
                {useOpenAI && hasApiKey && (
                  <p className="text-purple-400 text-xs flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> AI attiva
                  </p>
                )}
              </div>
            )}
            {state === 'stopping' && <p className="text-gray-400 animate-pulse">Interruzione...</p>}
            {state === 'error'    && <p className="text-red-400 text-sm">{error}</p>}
          </div>

          {/* Live transcription */}
          {isLive && (
            <div className="w-full min-h-[60px] bg-[#111] border border-[#2a2a2a] rounded-2xl px-4 py-3
                            flex items-start gap-2">
              <Mic className="w-4 h-4 text-red-400 mt-0.5 shrink-0 animate-pulse" />
              <p className="text-gray-300 text-sm leading-relaxed">
                {liveText || <span className="text-gray-600 italic">In ascolto...</span>}
              </p>
            </div>
          )}
        </div>

        {/* Stats */}
        {isLive ? (
          <div className="w-full max-w-xs flex gap-3">
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label="In ascolto"
              value={listeners.toString()}
              color="text-blue-400"
            />
            <StatCard
              icon={<Radio className="w-4 h-4" />}
              label="Frasi inviate"
              value={framesSent.toString()}
              color="text-green-400"
            />
          </div>
        ) : (
          <p className="text-xs text-gray-600 text-center">
            Raggio ~30m · {useOpenAI && hasApiKey ? 'Traduzione AI inclusa' : 'Nessun internet richiesto'}
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color: string;
}) {
  return (
    <div className="flex-1 bg-[#1a1a1a] rounded-2xl p-4 flex flex-col gap-1">
      <div className={`flex items-center gap-1.5 ${color}`}>
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-2xl font-bold text-white">{value}</span>
    </div>
  );
}
