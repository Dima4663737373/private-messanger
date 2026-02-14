
import React from 'react';
import { Ghost } from 'lucide-react';

const Preloader: React.FC = () => {
  return (
    <div className="fixed inset-0 bg-[#0A0A0A] z-[100] flex flex-col items-center justify-center">
      <div className="relative">
        <div className="absolute inset-0 bg-[#FF8C00] blur-[40px] opacity-20 ghost-loader"></div>
        <Ghost size={64} className="text-[#FF8C00] relative z-10 ghost-loader" />
      </div>
      <h1 className="mt-8 text-white font-bold text-2xl tracking-[0.2em] mono uppercase">Initializing GHOST</h1>
      <div className="mt-4 w-48 h-[2px] bg-[#1A1A1A] overflow-hidden rounded-full">
        <div className="h-full bg-[#FF8C00] animate-[loading-bar_2s_infinite_ease-in-out]"></div>
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default Preloader;
