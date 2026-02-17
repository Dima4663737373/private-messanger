import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

interface ScrollToBottomButtonProps {
  show: boolean;
  unreadCount?: number;
  onClick: () => void;
}

export const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({
  show,
  unreadCount = 0,
  onClick
}) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 10 }}
          transition={{ duration: 0.2 }}
          onClick={onClick}
          className="fixed bottom-28 right-8 w-12 h-12 bg-[var(--accent-primary)] text-black rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95 z-50 flex items-center justify-center"
          style={{
            boxShadow: '0 8px 24px rgba(255, 140, 0, 0.3)'
          }}
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={24} strokeWidth={2.5} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 bg-[var(--error)] text-white text-xs font-bold rounded-full flex items-center justify-center shadow-md">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
};
