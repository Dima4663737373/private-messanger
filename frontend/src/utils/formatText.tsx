import React from 'react';

/**
 * Apply inline formatting markers to plain text.
 * Supports WhatsApp/Telegram-style syntax:
 *   __text__ → underline
 *   *text*   → bold
 *   _text_   → italic
 *   ~text~   → strikethrough
 *
 * Order matters: __ is matched before _ to avoid conflicts.
 */
const FORMAT_REGEX = /__([^_]+)__|\*([^*]+)\*|_([^_]+)_|~([^~]+)~/g;

export function applyFormatting(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  FORMAT_REGEX.lastIndex = 0;

  while ((match = FORMAT_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    const key = `f${match.index}`;
    if (match[1] !== undefined) {
      result.push(<u key={key}>{match[1]}</u>);
    } else if (match[2] !== undefined) {
      result.push(<strong key={key}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      result.push(<em key={key}>{match[3]}</em>);
    } else if (match[4] !== undefined) {
      result.push(<s key={key}>{match[4]}</s>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}
