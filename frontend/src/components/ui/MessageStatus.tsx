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
      return <span title="Sending..."><Clock className={cn("w-3 h-3 text-white/40", className)} /></span>;
    case 'sent':
      return <span title="Sent"><Check className={cn("w-3 h-3 text-white/40", className)} /></span>;
    case 'included':
      return <span title="On-chain confirmed"><CheckCheck className={cn("w-3 h-3 text-[#FF8C00]", className)} /></span>;
    case 'confirmed':
      return <span title="Blockchain confirmed"><CheckCheck className={cn("w-3 h-3 text-[#FF8C00]", className)} /></span>;
    case 'read':
      return <span title={readAt ? formatReadAt(readAt) : 'Read'}><CheckCheck className={cn("w-3 h-3 text-blue-400", className)} /></span>;
    case 'failed':
      return <span title="Failed"><XCircle className={cn("w-3 h-3 text-red-500", className)} /></span>;
    default:
      return null;
  }
};
