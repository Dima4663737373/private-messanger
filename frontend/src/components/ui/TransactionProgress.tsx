import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from './Spinner';

export type TxStep = 'idle' | 'preparing' | 'signing' | 'broadcasting' | 'confirming' | 'confirmed' | 'failed';

interface TransactionProgressProps {
  step: TxStep;
  txId?: string;
  error?: string;
}

const STEPS: { id: TxStep; label: string }[] = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'signing', label: 'Signing' },
  { id: 'broadcasting', label: 'Broadcasting' },
  { id: 'confirming', label: 'Confirming' },
];

export const TransactionProgress: React.FC<TransactionProgressProps> = ({ step, txId, error }) => {
  if (step === 'idle') return null;
  if (step === 'failed') {
      return (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4">
              <p className="text-red-400 text-sm font-medium">Transaction Failed</p>
              {error && <p className="text-red-400/80 text-xs mt-1">{error}</p>}
          </div>
      )
  }

  const currentStepIndex = STEPS.findIndex(s => s.id === step);
  const isConfirmed = step === 'confirmed';

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-sm font-medium text-white/90">Transaction Progress</h4>
        {txId && (
            <a 
                href={`https://testnet3.aleoscan.io/transaction/${txId}`} 
                target="_blank" 
                rel="noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300"
            >
                View on Explorer
            </a>
        )}
      </div>

      <div className="relative flex justify-between">
         {/* Line */}
        <div className="absolute top-2.5 left-0 right-0 h-0.5 bg-white/10 -z-0" />
        
        {STEPS.map((s, idx) => {
            const isActive = s.id === step;
            const isCompleted = isConfirmed || (currentStepIndex > -1 && idx < currentStepIndex);
            
            return (
                <div key={s.id} className="flex flex-col items-center relative z-10 bg-[#0A0A0A] px-2">
                    <div className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center border-2 text-[10px] transition-all duration-300",
                        isActive ? "border-[#FF9900] text-[#FF9900] shadow-[0_0_10px_rgba(255,153,0,0.5)] animate-pulse" : 
                        isCompleted ? "border-[#FF9900] bg-[#FF9900] text-black" : "border-white/10 text-white/20"
                    )}>
                        {isCompleted ? <Check className="w-3 h-3" /> : (isActive ? <Loader2 className="w-3 h-3 animate-spin" /> : idx + 1)}
                    </div>
                    <span className={cn(
                        "text-[10px] mt-2 font-medium tracking-wider uppercase transition-colors duration-300",
                        isActive ? "text-[#FF9900]" : isCompleted ? "text-[#FF9900]" : "text-white/20"
                    )}>{s.label}</span>
                </div>
            )
        })}
      </div>
    </div>
  );
};
