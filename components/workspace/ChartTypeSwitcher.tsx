'use client';

import React from 'react';
import { useTheme } from '@/lib/theme-provider';
import { type ChartType, CHART_TYPE_LABELS } from '@/lib/workspace/chart-adapters';

interface Props {
  types: ChartType[];
  value: ChartType;
  onChange: (type: ChartType) => void;
}

export function ChartTypeSwitcher({ types, value, onChange }: Props) {
  const { isDark, textMuted, border } = useTheme();

  if (types.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {types.map(type => {
        const active = type === value;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded transition-colors"
            style={{
              color: active ? '#0052FF' : textMuted,
              background: active
                ? (isDark ? 'rgba(0,82,255,0.12)' : 'rgba(0,82,255,0.08)')
                : 'transparent',
              border: active ? '1px solid rgba(0,82,255,0.25)' : `1px solid ${border}`,
            }}
          >
            {CHART_TYPE_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}
