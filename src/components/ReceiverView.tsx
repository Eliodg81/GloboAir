import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Headphones, Search, Wifi, Volume2, X, Radio } from 'lucide-react';
import { BLEReceiver, BroadcastSession } from '../ble/BLEReceiver';
import { AudioPlayer } from '../audio/AudioPlayer';
import LanguagePicker from './LanguagePicker';

interface Props { onBack: () => void; }

type ViewState = 'idle' | 'scanning' | 'connecting' | 'listening' | 'error';

export default function ReceiverView({ onBack }: Props) {
  const [viewState, setViewState] = useState<ViewState>('idle');
  const [sessions, setSessions] = useState<BroadcastSession[]>([]);
  const [framesReceived, setFramesReceived] = useState(0);
  const [bufferSize, setBufferSize] = useState(0);
  const [error, setError] = useState('');
  const [targetLang, setTargetLang] = useState('en'); // lingua in cui voglio ascoltare

  const receiverRef = useRef<BLEReceiver | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const statsInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const startScan = useCallback(async () => {
    setViewState('scanning');
    setSessions([]);
    setError('');
    try {
      const receiver = new BLEReceiver();
      await receiver.initialize();
      receiverRef.current = receiver;

      receiver.onStateChange = (s) => {
        if (s === 'error') setViewState('error');
        if (s === 'connected') setViewState('listening');
      };
      receiver.onSessionFound = (session) => {
        setSessions(prev =>
          prev.find(s => s.device.deviceId === session.device.deviceId) ? prev : [...prev, session]
        );
      };
      receiver.onFrame = (encoded) => {
        playerRef.current?.receiveFrame(encoded);
        setFramesReceived(r => r + 1);
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
      const player = new AudioPlayer();
      player.start();
      playerRef.current = player;
      await receiverRef.current?.connect(session);
      statsInterval.current = setInterval(() => {
        setBufferSize(playerRef.current?.bufferSize ?? 0);
      }, 500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connessione fallita');
      setViewState('error');
    }
  }, []);

  const stopAll = useCallback(async () => {
    if (statsInterval.current) clearInterval(statsInterval.current);
    playerRef.current?.stop();
    await receiverRef.current?.disconnect();
    receiverRef.current = null;
    playerRef.current = null;
    setSessions([]);
    setFramesReceived(0);
    setBufferSize(0);
    setViewState('idle');
  }, []);

  useEffect(() => {
    return () => {
      if (statsInterval.current) clearInterval(statsInterval.current);
      playerRef.current?.stop();
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

      <div className="flex-1 flex flex-col items-center justify-between px-6 py-4">

        {/* Language selector — sempre visibile (bloccata quando in ascolto) */}
        <div className="w-full max-w-xs relative">
          <LanguagePicker
            label="Voglio ascoltare in"
            value={targetLang}
            onChange={setTargetLang}
            disabled={isListening}
          />
        </div>

        {/* Main content per stato */}
        <div className="flex flex-col items-center gap-6 w-full max-w-xs">

          {/* IDLE */}
          {viewState === 'idle' && (
            <>
              <div className="w-24 h-24 rounded-full bg-[#1a1a1a] border border-[#2a2a2a]
                              flex items-center justify-center">
                <Headphones className="w-10 h-10 text-gray-500" />
              </div>
              <button onClick={startScan}
                className="px-8 py-4 rounded-full bg-blue-500 text-white font-semibold text-base
                           shadow-[0_0_30px_rgba(59,130,246,0.4)] active:scale-95 transition-transform">
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
                <p className="text-gray-500 text-sm mt-0.5">Audio tradotto in arrivo</p>
              </div>
              <div className="w-full flex gap-3">
                <StatCard label="Frame ricevuti" value={framesReceived.toString()} />
                <StatCard label="Buffer" value={`${bufferSize}f`} />
              </div>
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
              <p className="text-red-400">{error}</p>
              <button onClick={() => setViewState('idle')}
                className="px-6 py-3 rounded-full bg-[#1a1a1a] text-gray-300 text-sm">
                Riprova
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-gray-700 text-center">
          {isListening ? 'Tieni lo schermo acceso durante l\'ascolto' : 'Solo Bluetooth · Nessun internet'}
        </p>
      </div>
    </div>
  );
}

function SessionCard({ session, onConnect }: { session: BroadcastSession; onConnect: () => void }) {
  return (
    <button onClick={onConnect}
      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-4
                 flex items-center justify-between
                 hover:border-blue-500/50 active:scale-95 transition-all">
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
    <div className="flex-1 bg-[#1a1a1a] rounded-2xl p-4">
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="text-white text-xl font-bold mt-1">{value}</p>
    </div>
  );
}
