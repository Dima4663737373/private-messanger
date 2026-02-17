import React from 'react';
import { Check, CheckCheck, Clock, XCircle } from 'lucide-react';
import { cn } from './Spinner';

export type MessageStatusType = 'pending' | 'sent' | 'included' | 'confirmed' | 'failed' | 'read';

interface MessageStatusProps {
  status?: string;
  readAt?: number;
  className?: string;
}

function formatReadAt(ts: number): string {
  const d = new Date(ts);
  return `Read ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export const MessageStatus: React.FC<MessageStatusProps> = ({ status, readAt, className }) => {
  if (!status) return null;

  switch (status) {
    case 'pending':
      return <Clock className={cn("w-3 h-3 text-white/40", className)} title="Sending..." />;
    case 'sent':
      return <Check className={cn("w-3 h-3 text-white/40", className)} title="Sent" />;
    case 'included':
      return <CheckCheck className={cn("w-3 h-3 text-[#FF8C00]", className)} title="On-chain confirmed" />;
    case 'confirmed':
      return <CheckCheck className={cn("w-3 h-3 text-[#FF8C00]", className)} title="Blockchain confirmed" />;
    case 'read':
      return <CheckCheck className={cn("w-3 h-3 text-blue-400", className)} title={readAt ? formatReadAt(readAt) : 'Read'} />;
    case 'failed':
      return <XCircle className={cn("w-3 h-3 text-red-500", className)} title="Failed" />;
    default:
      return null;
  }
};
