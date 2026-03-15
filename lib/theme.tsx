'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggle: () => void;
  // Colour tokens — consume these in every component
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
}

const DARK: Omit<ThemeContextValue, 'theme' | 'isDark' | 'toggle'> = {
  bg:          '#0a0a0a',
  surface:     '#111111',
  surface2:    '#161616',
  border:      '#262626',
  borderStrong:'#404040',
  text:        '#f2f2f2',
  textMuted:   '#a0a0a0',
  textSubtle:  '#555555',
};

const LIGHT: Omit<ThemeContextValue, 'theme' | 'isDark' | 'toggle'> = {
  bg:          '#f9f9f9',
  surface:     '#ffffff',
  surface2:    '#f4f4f4',
  border:      '#e5e5e5',
  borderStrong:'#cccccc',
  text:        '#111111',
  textMuted:   '#555555',
  textSubtle:  '#999999',
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark', isDark: true, toggle: () => {},
  ...DARK,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const saved = localStorage.getItem('veracity-theme') as Theme | null;
    if (saved) setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  const toggle = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('veracity-theme', next);
      return next;
    });
  };

  const isDark = theme === 'dark';
  const tokens = isDark ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggle, ...tokens }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
