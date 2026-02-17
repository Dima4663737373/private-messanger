import { describe, it, expect } from 'vitest';
import React from 'react';
import { applyFormatting } from './formatText';

describe('applyFormatting', () => {
  it('returns plain text unchanged', () => {
    const result = applyFormatting('hello world');
    expect(result).toEqual(['hello world']);
  });

  it('wraps *bold* in <strong>', () => {
    const result = applyFormatting('this is *bold* text');
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('this is ');
    expect((result[1] as React.ReactElement).type).toBe('strong');
    expect((result[1] as React.ReactElement).props.children).toBe('bold');
    expect(result[2]).toBe(' text');
  });

  it('wraps _italic_ in <em>', () => {
    const result = applyFormatting('this is _italic_ text');
    expect(result).toHaveLength(3);
    expect((result[1] as React.ReactElement).type).toBe('em');
    expect((result[1] as React.ReactElement).props.children).toBe('italic');
  });

  it('wraps ~strikethrough~ in <s>', () => {
    const result = applyFormatting('this is ~strike~ text');
    expect(result).toHaveLength(3);
    expect((result[1] as React.ReactElement).type).toBe('s');
    expect((result[1] as React.ReactElement).props.children).toBe('strike');
  });

  it('wraps __underline__ in <u>', () => {
    const result = applyFormatting('this is __underline__ text');
    expect(result).toHaveLength(3);
    expect((result[1] as React.ReactElement).type).toBe('u');
    expect((result[1] as React.ReactElement).props.children).toBe('underline');
  });

  it('handles multiple formats in one string', () => {
    const result = applyFormatting('*bold* and _italic_ here');
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it('returns empty string text as array', () => {
    const result = applyFormatting('');
    expect(result).toEqual(['']);
  });
});
