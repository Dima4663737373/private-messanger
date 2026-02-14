import React from 'react';

interface ToggleProps {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}

const Toggle: React.FC<ToggleProps> = ({ enabled, onChange, label, description }) => (
  <div className="flex items-center justify-between py-3">
    <div className="flex-1 mr-4">
      <p className="font-medium text-[#0A0A0A]">{label}</p>
      {description && <p className="text-sm text-[#666] mt-0.5">{description}</p>}
    </div>
    <button
      onClick={() => onChange(!enabled)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${enabled ? 'bg-[#FF8C00]' : 'bg-[#D1D5DB]'}`}
    >
      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  </div>
);

export default Toggle;
