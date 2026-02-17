import { useEffect, RefObject } from 'react';

/**
 * Auto-resizes a textarea element based on its content
 *
 * @param textareaRef - Reference to the textarea element
 * @param value - Current value of the textarea
 * @param minHeight - Minimum height in pixels (default: 44)
 * @param maxHeight - Maximum height in pixels (default: 160)
 */
export function useAutoResizeTextarea(
  textareaRef: RefObject<HTMLTextAreaElement>,
  value: string,
  minHeight: number = 44,
  maxHeight: number = 160
) {
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to recalculate
    textarea.style.height = `${minHeight}px`;

    // Calculate new height based on scroll height
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;

    // Add scrollbar if content exceeds maxHeight
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [textareaRef, value, minHeight, maxHeight]);
}
