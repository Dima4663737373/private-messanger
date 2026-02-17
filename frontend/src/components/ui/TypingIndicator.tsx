import React from 'react';
import { motion } from 'framer-motion';

interface TypingIndicatorProps {
  userName?: string;
  isRoom?: boolean;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ userName, isRoom }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--text-secondary)]"
    >
      <div className="flex items-center gap-1">
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
      </div>
      <span>
        {userName ? (
          <>
            <span className="font-medium">{userName}</span> is typing...
          </>
        ) : (
          'Typing...'
        )}
      </span>
    </motion.div>
  );
};
