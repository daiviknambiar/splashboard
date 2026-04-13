'use client';

import { useRef, type FormEvent } from 'react';

interface MoodBoardProps {
  value: string;
  onValueChange: (value: string) => void;
  onSearch: (description: string) => void;
  disabled?: boolean;
}

const PLACEHOLDERS = [
  'overcast coastal cliffs, muted blues and grays, solitary figure',
  'brutalist concrete corridor, harsh fluorescent shadows, empty',
  'golden hour through redwood canopy, shafts of light, mossy ground',
  'late-night diner, neon reflections on wet pavement, quiet',
  'abandoned greenhouse, overgrown and beautiful, diffused natural light',
];

export function MoodBoard({ value, onValueChange, onSearch, disabled }: MoodBoardProps) {
  const placeholder = PLACEHOLDERS[0] ?? '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSearch(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !disabled) onSearch(trimmed);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full h-full">
      <div className="input-zone relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          aria-label="Describe a visual vibe or concept"
          className="mood-textarea"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">
            <kbd className="kbd">Enter</kbd> runs it. <kbd className="kbd">Shift+Enter</kbd> adds a new line.
          </p>
          <button
            type="submit"
            disabled={!value.trim() || disabled}
            className="search-btn"
            aria-label="Search for images"
          >
            <span>Pin it</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="prompt-row mt-3" aria-label="Suggested prompts">
          {PLACEHOLDERS.slice(0, 4).map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="prompt-chip"
              onClick={() => {
                onValueChange(prompt);
                textareaRef.current?.focus();
              }}
              disabled={disabled}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
