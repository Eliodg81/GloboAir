import { Radio, Headphones } from 'lucide-react';
import type { AppMode } from '../App';

interface Props { onSelect: (mode: AppMode) => void; }

export default function ModeSelect({ onSelect }: Props) {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-8 gap-8 overflow-y-auto">
      {/* Logo */}
      <div className="text-center mb-4">
        <h1 className="text-4xl font-bold tracking-tight text-white">GloboAir</h1>
        <p className="text-sm text-gray-400 mt-2">Broadcast audio via Bluetooth</p>
      </div>

      {/* Mode buttons */}
      <div className="w-full max-w-xs flex flex-col gap-4">
        {/* BROADCAST */}
        <button
          onClick={() => onSelect('broadcast')}
          className="group w-full rounded-3xl bg-[#1a1a1a] border border-[#2a2a2a] p-6
                     flex flex-col items-center gap-3
                     active:scale-95 transition-transform duration-100
                     hover:border-green-500/50"
        >
          <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center
                          shadow-[0_0_40px_rgba(34,197,94,0.4)]">
            <Radio className="w-9 h-9 text-white" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-white">Trasmetti</p>
            <p className="text-xs text-gray-400 mt-0.5">Parla — gli altri ti ascoltano</p>
          </div>
        </button>

        {/* RECEIVE */}
        <button
          onClick={() => onSelect('receive')}
          className="group w-full rounded-3xl bg-[#1a1a1a] border border-[#2a2a2a] p-6
                     flex flex-col items-center gap-3
                     active:scale-95 transition-transform duration-100
                     hover:border-blue-500/50"
        >
          <div className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center
                          shadow-[0_0_40px_rgba(59,130,246,0.4)]">
            <Headphones className="w-9 h-9 text-white" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-white">Ascolta</p>
            <p className="text-xs text-gray-400 mt-0.5">Cerca una sessione vicino a te</p>
          </div>
        </button>
      </div>

      <p className="text-xs text-gray-600 text-center">
        Nessun internet richiesto · Solo Bluetooth
      </p>
    </div>
  );
}
