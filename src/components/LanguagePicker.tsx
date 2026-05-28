import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { LANGUAGES, Language } from '../data/languages';

interface Props {
  value: string;
  onChange: (code: string) => void;
  label: string;
  disabled?: boolean;
}

export default function LanguagePicker({ value, onChange, label, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = LANGUAGES.find(l => l.code === value) ?? LANGUAGES[0];

  // Chiudi cliccando fuori
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="w-full" ref={ref}>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
        {label}
      </p>

      {/* Trigger */}
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className={`w-full flex items-center justify-between
                    bg-[#1a1a1a] border rounded-2xl px-4 py-3
                    transition-colors duration-150
                    ${open ? 'border-white/20' : 'border-[#2a2a2a]'}
                    ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-white/20 cursor-pointer'}`}
      >
        <span className="flex items-center gap-3">
          <span className="text-2xl">{selected.flag}</span>
          <span className="text-white font-semibold text-base">{selected.nativeName}</span>
          <span className="text-gray-500 text-sm">({selected.name})</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-2 w-64 max-h-72 overflow-y-auto
                        bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl shadow-2xl
                        scrollbar-thin">
          {LANGUAGES.map((lang: Language) => (
            <button
              key={lang.code}
              onClick={() => { onChange(lang.code); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left
                          hover:bg-white/5 transition-colors first:rounded-t-2xl last:rounded-b-2xl
                          ${lang.code === value ? 'bg-white/10' : ''}`}
            >
              <span className="text-xl">{lang.flag}</span>
              <span className="text-white text-sm font-medium">{lang.nativeName}</span>
              <span className="text-gray-500 text-xs ml-auto">{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
