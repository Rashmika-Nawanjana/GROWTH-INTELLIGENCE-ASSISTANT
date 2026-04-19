'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggle: () => void;
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
  bg: '#0a0a0a',
  surface: '#111111',
  surface2: '#161616',
  border: '#2e2e2e',
  borderStrong: '#484848',
  text: '#ededed',
  textMuted: '#c2c2c2',
  textSubtle: '#6b6b6b',
};

const LIGHT: Omit<ThemeContextValue, 'theme' | 'isDark' | 'toggle'> = {
  bg: '#fafafa',
  surface: '#ffffff',
  surface2: '#f5f5f5',
  border: '#e0e0e0',
  borderStrong: '#c0c0c0',
  text: '#111111',
  textMuted: '#383838',
  textSubtle: '#717171',
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  isDark: true,
  toggle: () => {},
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