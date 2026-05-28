import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Headphones, Search, Wifi, Volume2, X, Radio, Languages, Sparkles, Eye, EyeOff, Mic } from 'lucide-react';
import { BLEReceiver, BroadcastSession } from '../ble/BLEReceiver';
import { TranslationEngine } from '../audio/TranslationEngine';
import { OpenAITranslator } from '../audio/OpenAITranslator';
import { SpeechPlayer } from '../audio/SpeechPlayer';
import { AudioStreamPlayer } from '../audio/AudioStreamPlayer';
import LanguagePicker from './LanguagePicker';

interface Props { onBack: () => void; }

type ViewState = 'idle' | 'scanning' | 'connecting' | 'listening' | 'error';
type ReceiveMode = 'voice' | 'translation';

export default function ReceiverView({ onBack }: Props) {
  const [viewState, setViewState] = useState<ViewState>('idle');
  const [receiveMode, setReceiveMode] = useState<ReceiveMode>('translation');
  const [sessions, setSessions] = useState<BroadcastSession[]>([]);
  const [framesReceived, setFramesReceived] = useState(0);
  const [error, setError] = useState('');
  const [targetLang, setTargetLang] = useState('en');
  const [originalText, setOriginalText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [translationMode, setTranslationMode] = useState<'free' | 'ai' | 'preTranslated'>('free');
  const receiveModeRef = useRef<ReceiveMode>('translation');

  // Modalità OpenAI receiver-side
  const [useOpenAI, setUseOpenAI] = useState(OpenAITranslator.hasKey('receiver'));
  const [apiKey, setApiKey] = useState(OpenAITranslator.getStoredKey('receiver'));
  const [showKey, setShowKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);

  const receiverRef    = useRef<BLEReceiver | null>(null);
  const myMemoryRef    = useRef<TranslationEngine | null>(null);
  const openAIRef      = useRef<OpenAITranslator | null>(null);
  const playerRef      = useRef<SpeechPlayer | null>(null);
  const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);
  const targetLangRef = useRef(targetLang);
  const useOpenAIRef  = useRef(useOpenAI);
  const apiKeyRef     = useRef(apiKey);

  // Mantieni ref aggiornate per uso nei callback BLE
  useEffect(() => { receiveModeRef.current = receiveMode; }, [receiveMode]);
  useEffect(() => { targetLangRef.current = targetLang; }, [targetLang]);
  useEffect(() => { useOpenAIRef.current = useOpenAI; }, [useOpenAI]);
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);

  // Aggiorna player lingua se cambia targetLang durante ascolto
  useEffect(() => {
    playerRef.current?.updateTargetLang(targetLang);
    myMemoryRef.current?.update('', targetLang);
  }, [targetLang]);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    OpenAITranslator.saveKey('receiver', key);
  };

  const hasApiKey = apiKey.startsWith('sk-');

  const startScan = useCallback(async () => {
    setViewState('scanning');
    setSessions([]);
    setError('');

    // Inizializza player SUBITO (gesto utente diretto — richiesto da iOS AudioContext)
    try {
      const ap = new AudioStreamPlayer();
      await ap.initialize();
      audioPlayerRef.current = ap;
    } catch (e) {
      console.warn('[AudioStreamPlayer] init error:', e);
    }

    try {
      const receiver = new BLEReceiver();
      receiver.targetLang = targetLangRef.current;
      await receiver.initialize();
      receiverRef.current = receiver;

      receiver.onStateChange = (s) => {
        if (s === 'error') setViewState('error');
        if (s === 'connected') {
          setViewState('listening');
          // Inizializza player audio per modalità Voce diretta
          const ap = new AudioStreamPlayer();
          ap.initialize().then(() => {
            audioPlayerRef.current = ap;
          }).catch(e => console.warn('[AudioStreamPlayer] init error:', e));
        }
        if (s === 'idle') {
          audioPlayerRef.current?.stop();
          audioPlayerRef.current = null;
          setViewState('idle');
        }
      };

      // ── Pipeline audio diretto (modalità Voce) ───────────────────────────
      receiver.onFrame = (pcm8: Uint8Array) => {
        audioPlayerRef.current?.playChunk(pcm8);
        setFramesReceived(r => r + 1);
      };
      receiver.onSessionFound = (session) => {
        setSessions(prev =>
          prev.find(s => s.device.deviceId === session.device.deviceId) ? prev : [...prev, session]
        );
      };

      // ── Pipeline testo → traduzione → TTS ────────────────────────────────
      receiver.onText = async (text, isFinal, isPreTranslated) => {
        if (receiveModeRef.current === 'voice') return; // in voce diretta ignora il testo
        setFramesReceived(r => r + 1);
        setOriginalText(isPreTranslated ? '' : text); // se già tradotto non mostrare l'originale

        if (!isFinal) return; // mostra testo ma non parla finché non è finale

        try {
          let translated: string;

          if (isPreTranslated) {
            // ✅ BROADCASTER HA GIÀ TRADOTTO (lui ha pagato OpenAI)
            translated = text;
            setTranslationMode('preTranslated');
            setTranslatedText(translated);
          } else if (useOpenAIRef.current && apiKeyRef.current.startsWith('sk-')) {
            // ✅ RECEIVER USA OPENAI (paga lui)
            if (!openAIRef.current) {
              openAIRef.current = new OpenAITranslator(apiKeyRef.current);
            }
            // sourceLang unknown → usiamo 'auto' come convenzione (OpenAI lo capisce dal contesto)
            translated = await openAIRef.current.translate(text, 'auto', targetLangRef.current);
            setTranslationMode('ai');
            setTranslatedText(translated);
          } else {
            // ✅ TRADUZIONE GRATUITA (MyMemory)
            if (!myMemoryRef.current) {
              myMemoryRef.current = new TranslationEngine('it', targetLangRef.current);
            }
            translated = await myMemoryRef.current.translate(text);
            setTranslationMode('free');
            setTranslatedText(translated);
          }

          playerRef.current?.speak(translated);
          setTimeout(() => { setOriginalText(''); setTranslatedText(''); }, 3500);
        } catch (e) {
          console.warn('[ReceiverView] translate/speak error:', e);
        }
      };

      await receiver.startScan();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore BLE');
      setViewState('error');
    }
  }, []);

  const connect = useCallback(async (session: BroadcastSession) => {
    setViewState('connecting');
    try {
      if (receiverRef.current) {
        receiverRef.current.targetLang = targetLangRef.current;
      }
      myMemoryRef.current = new TranslationEngine('it', targetLangRef.current);
      if (useOpenAI && hasApiKey) {
        openAIRef.current = new OpenAITranslator(apiKey);
      }
      playerRef.current = new SpeechPlayer(targetLangRef.current);
      await receiverRef.current?.connect(session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connessione fallita');
      setViewState('error');
    }
  }, [useOpenAI, hasApiKey, apiKey]);

  const stopAll = useCallback(async () => {
    playerRef.current?.stop();
    audioPlayerRef.current?.stop();
    myMemoryRef.current?.destroy();
    openAIRef.current?.destroy();
    await receiverRef.current?.disconnect();
    receiverRef.current = null;
    myMemoryRef.current = null;
    openAIRef.current = null;
    playerRef.current = null;
    audioPlayerRef.current = null;
    setSessions([]);
    setFramesReceived(0);
    setOriginalText('');
    setTranslatedText('');
    setViewState('idle');
  }, []);

  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      myMemoryRef.current?.destroy();
      openAIRef.current?.destroy();
      receiverRef.current?.disconnect().catch(() => {});
    };
  }, []);

  const isListening = viewState === 'listening';

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center px-4 pt-4 pb-2">
        <button onClick={isListening ? stopAll : onBack}
          className="p-2 rounded-full text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="ml-3 text-base font-semibold text-white">Modalità Ascolto</h2>
        {(viewState === 'scanning' || isListening) && (
          <button onClick={stopAll} className="ml-auto p-2 text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-between px-6 py-4 gap-4">

        {/* Language selector — solo in modalità traduzione */}
        {receiveMode === 'translation' && (
          <div className="w-full max-w-xs relative">
            <LanguagePicker
              label="Voglio ascoltare in"
              value={targetLang}
              onChange={(lang) => {
                setTargetLang(lang);
                if (receiverRef.current) receiverRef.current.targetLang = lang;
              }}
              disabled={isListening}
            />
          </div>
        )}

        {/* ── OpenAI Toggle (solo traduzione e non in ascolto) ── */}
        {receiveMode === 'translation' && !isListening && (
          <div className="w-full max-w-xs">
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
                    Traduzione Premium (OpenAI)
                  </p>
                  <p className="text-xs text-gray-600">
                    {useOpenAI && hasApiKey ? 'Qualità massima · Pago io' : 'Usa MyMemory (gratis)'}
                  </p>
                </div>
              </div>
              <div className={`w-11 h-6 rounded-full transition-colors relative
                              ${useOpenAI && hasApiKey ? 'bg-purple-500' : 'bg-gray-700'}`}>
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                                ${useOpenAI && hasApiKey ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
            </button>

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
                    ⚠ Inserisci la chiave API per la traduzione premium
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Main content per stato */}
        <div className="flex flex-col items-center gap-5 w-full max-w-xs">

          {/* IDLE */}
          {viewState === 'idle' && (
            <>
              {/* Mode cards */}
              <div className="w-full flex flex-col gap-3">
                <p className="text-xs text-gray-500 uppercase tracking-widest text-center">Modalità di ascolto</p>

                {/* Voce diretta */}
                <button
                  onClick={() => setReceiveMode('voice')}
                  className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl border transition-all
                              ${receiveMode === 'voice'
                                ? 'bg-green-500/10 border-green-500/50'
                                : 'bg-[#1a1a1a] border-[#2a2a2a]'}`}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0
                                  ${receiveMode === 'voice' ? 'bg-green-500/20' : 'bg-[#252525]'}`}>
                    <Mic className={`w-5 h-5 ${receiveMode === 'voice' ? 'text-green-400' : 'text-gray-500'}`} />
                  </div>
                  <div className="text-left flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold ${receiveMode === 'voice' ? 'text-green-300' : 'text-gray-300'}`}>
                        Voce diretta
                      </p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">
                        Gratis
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">Audio diretto, come una telefonata</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0
                                  ${receiveMode === 'voice' ? 'border-green-400' : 'border-gray-600'}`}>
                    {receiveMode === 'voice' && <div className="w-2.5 h-2.5 rounded-full bg-green-400" />}
                  </div>
                </button>

                {/* Con traduzione */}
                <button
                  onClick={() => setReceiveMode('translation')}
                  className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl border transition-all
                              ${receiveMode === 'translation'
                                ? 'bg-blue-500/10 border-blue-500/50'
                                : 'bg-[#1a1a1a] border-[#2a2a2a]'}`}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0
                                  ${receiveMode === 'translation' ? 'bg-blue-500/20' : 'bg-[#252525]'}`}>
                    <Languages className={`w-5 h-5 ${receiveMode === 'translation' ? 'text-blue-400' : 'text-gray-500'}`} />
                  </div>
                  <div className="text-left flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold ${receiveMode === 'translation' ? 'text-blue-300' : 'text-gray-300'}`}>
                        Con traduzione
                      </p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">
                        Testo + audio
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">Trascrivi e traduci in tempo reale</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0
                                  ${receiveMode === 'translation' ? 'border-blue-400' : 'border-gray-600'}`}>
                    {receiveMode === 'translation' && <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />}
                  </div>
                </button>
              </div>

              <button onClick={startScan}
                className={`px-8 py-4 rounded-full text-white font-semibold text-base
                           active:scale-95 transition-transform
                           ${receiveMode === 'voice'
                             ? 'bg-green-500 shadow-[0_0_30px_rgba(34,197,94,0.4)]'
                             : 'bg-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.4)]'}`}>
                Cerca sessioni
              </button>
            </>
          )}

          {/* SCANNING */}
          {viewState === 'scanning' && (
            <>
              <div className="relative w-28 h-28 flex items-center justify-center">
                <div className="absolute w-28 h-28 rounded-full border border-blue-500/30 animate-ping"
                     style={{ animationDuration: '2s' }} />
                <div className="absolute w-20 h-20 rounded-full border border-blue-500/50 animate-ping"
                     style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
                <div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <Search className="w-6 h-6 text-blue-400 animate-pulse" />
                </div>
              </div>
              <p className="text-gray-300">Ricerca sessioni in corso...</p>
              {sessions.length === 0
                ? <p className="text-xs text-gray-600">Avvicina il telefono al broadcaster</p>
                : (
                  <div className="w-full flex flex-col gap-3">
                    {sessions.map(s => (
                      <SessionCard key={s.device.deviceId} session={s} onConnect={() => connect(s)} />
                    ))}
                  </div>
                )}
            </>
          )}

          {/* CONNECTING */}
          {viewState === 'connecting' && (
            <>
              <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Wifi className="w-8 h-8 text-blue-400 animate-pulse" />
              </div>
              <p className="text-gray-300 animate-pulse">Connessione in corso...</p>
            </>
          )}

          {/* LISTENING */}
          {isListening && (
            <>
              {receiveMode === 'voice' ? (
                /* ── VOCE DIRETTA ── */
                <>
                  <div className="relative w-36 h-36 flex items-center justify-center">
                    <div className="absolute w-36 h-36 rounded-full bg-green-500/10 animate-ping"
                         style={{ animationDuration: '1.5s' }} />
                    <div className="absolute w-28 h-28 rounded-full bg-green-500/10 animate-ping"
                         style={{ animationDuration: '1.5s', animationDelay: '0.4s' }} />
                    <div className="w-24 h-24 rounded-full bg-green-500 flex items-center justify-center
                                    shadow-[0_0_40px_rgba(34,197,94,0.5)]">
                      <Mic className="w-10 h-10 text-white" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-green-400 font-semibold text-lg">Voce diretta</p>
                    <p className="text-gray-500 text-sm mt-0.5">🎙️ Audio in tempo reale</p>
                  </div>
                  <StatCard label="Pacchetti audio ricevuti" value={framesReceived.toString()} />
                </>
              ) : (
                /* ── CON TRADUZIONE ── */
                <>
                  <div className="relative w-36 h-36 flex items-center justify-center">
                    <div className="absolute w-36 h-36 rounded-full bg-blue-500/10 animate-ping"
                         style={{ animationDuration: '2s' }} />
                    <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center
                                    shadow-[0_0_40px_rgba(59,130,246,0.5)]">
                      <Volume2 className="w-10 h-10 text-white" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-blue-400 font-semibold text-lg">In ascolto</p>
                    <p className="text-gray-500 text-sm mt-0.5">
                      {translationMode === 'preTranslated' && '✨ Tradotto dalla guida'}
                      {translationMode === 'ai'            && '🤖 Traduzione AI (OpenAI)'}
                      {translationMode === 'free'          && '🌐 Traduzione gratuita'}
                    </p>
                  </div>

                  {/* Live translation */}
                  {(originalText || translatedText) && (
                    <div className="w-full flex flex-col gap-2">
                      {originalText && (
                        <div className="bg-[#111] border border-[#2a2a2a] rounded-2xl px-4 py-3">
                          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">Originale</p>
                          <p className="text-gray-400 text-sm leading-relaxed">{originalText}</p>
                        </div>
                      )}
                      {translatedText && (
                        <div className={`border rounded-2xl px-4 py-3 flex items-start gap-2
                                        ${translationMode === 'preTranslated'
                                          ? 'bg-purple-500/10 border-purple-500/30'
                                          : translationMode === 'ai'
                                            ? 'bg-purple-500/10 border-purple-500/30'
                                            : 'bg-blue-500/10 border-blue-500/30'}`}>
                          {translationMode !== 'free'
                            ? <Sparkles className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
                            : <Languages className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                          }
                          <div>
                            <p className={`text-[10px] uppercase tracking-widest mb-1
                                          ${translationMode !== 'free' ? 'text-purple-400/70' : 'text-blue-400/70'}`}>
                              Traduzione
                            </p>
                            <p className="text-white text-sm font-medium leading-relaxed">{translatedText}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <StatCard label="Frasi ricevute" value={framesReceived.toString()} />
                </>
              )}

              <button onClick={stopAll}
                className="px-6 py-3 rounded-full border border-[#2a2a2a] text-gray-400
                           hover:text-white hover:border-gray-500 transition-colors text-sm">
                Disconnetti
              </button>
            </>
          )}

          {/* ERROR */}
          {viewState === 'error' && (
            <>
              <p className="text-red-400 text-center">{error}</p>
              <button onClick={() => setViewState('idle')}
                className="px-6 py-3 rounded-full bg-[#1a1a1a] text-gray-300 text-sm">
                Riprova
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-gray-700 text-center">
          {isListening
            ? receiveMode === 'voice'
              ? 'Solo Bluetooth · Nessuna connessione internet'
              : 'Bluetooth · Traduzione via internet'
            : 'Solo Bluetooth'}
        </p>
      </div>
    </div>
  );
}

function SessionCard({ session, onConnect }: { session: BroadcastSession; onConnect: () => void }) {
  return (
    <button onClick={onConnect}
      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-4
                 flex items-center justify-between hover:border-blue-500/50 active:scale-95 transition-all">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
          <Radio className="w-5 h-5 text-green-400" />
        </div>
        <div className="text-left">
          <p className="text-white text-sm font-semibold">{session.name}</p>
          <p className="text-gray-500 text-xs">{session.rssi} dBm</p>
        </div>
      </div>
      <span className="text-blue-400 text-xs font-medium">Connetti →</span>
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-full bg-[#1a1a1a] rounded-2xl p-4">
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="text-white text-xl font-bold mt-1">{value}</p>
    </div>
  );
}
