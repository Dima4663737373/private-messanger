import React from 'react';
import { Check, CheckCheck, Clock, XCircle, Link } from 'lucide-react';
import { cn } from './Spinner';

export type MessageStatusType = 'pending' | 'sent' | 'included' | 'confirmed' | 'failed' | 'read';

interface MessageStatusProps {
  status?: string; // string to match generic types, but we expect specific values
  className?: string;
}

export const MessageStatus: React.FC<MessageStatusProps> = ({ status, className }) => {
  if (!status) return null;

  switch (status) {
    case 'pending':
      return <Clock className={cn("w-3 h-3 text-white/40", className)} />;
    case 'sent':
      return <Check className={cn("w-3 h-3 text-white/40", className)} />; // Single check
    case 'included':
      return (
        <span className="inline-flex items-center gap-0.5" title="On-chain confirmed">
          <CheckCheck className={cn("w-3 h-3 text-white/60", className)} />
          <Link className={cn("w-2.5 h-2.5 text-[#FF8C00]", className)} />
        </span>
      );
    case 'confirmed':
      return (
        <span className="inline-flex items-center gap-0.5" title="Blockchain confirmed">
          <CheckCheck className={cn("w-3 h-3 text-[#FF8C00]", className)} />
          <Link className={cn("w-2.5 h-2.5 text-[#FF8C00]", className)} />
        </span>
      );
    case 'read':
        return <CheckCheck className={cn("w-3 h-3 text-blue-400", className)} />; // Read (blue)
    case 'failed':
      return <XCircle className={cn("w-3 h-3 text-red-500", className)} />;
    default:
      return null;
  }
};
