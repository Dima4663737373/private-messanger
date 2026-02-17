import React, { useEffect, useCallback } from 'react';
import { X, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ImageLightboxProps {
  src: string;
  alt?: string;
  isOpen: boolean;
  onClose: () => void;
}

const ImageLightbox: React.FC<ImageLightboxProps> = ({ src, alt = 'Image', isOpen, onClose }) => {
  const [scale, setScale] = React.useState(1);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === '+' || e.key === '=') setScale(s => Math.min(s + 0.25, 3));
    if (e.key === '-') setScale(s => Math.max(s - 0.25, 0.5));
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      setScale(1);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = src;
    link.download = alt || 'image';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={onClose}
        >
          {/* Top toolbar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10">
            <p className="text-white/70 text-sm truncate max-w-[50%]">{alt}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setScale(s => Math.max(s - 0.25, 0.5)); }}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Zoom out"
              >
                <ZoomOut size={20} />
              </button>
              <span className="text-white/50 text-xs font-mono min-w-[40px] text-center">{Math.round(scale * 100)}%</span>
              <button
                onClick={(e) => { e.stopPropagation(); setScale(s => Math.min(s + 0.25, 3)); }}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Zoom in"
              >
                <ZoomIn size={20} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Download"
              >
                <Download size={20} />
              </button>
              <button
                onClick={onClose}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Close (Esc)"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Image */}
          <motion.img
            src={src}
            alt={alt}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ transform: `scale(${scale})` }}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl transition-transform duration-200 cursor-default select-none"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ImageLightbox;
