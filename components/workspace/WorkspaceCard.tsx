'use client';

import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import { ArtifactRenderer } from '@/components/artifacts/ArtifactRenderer';
import { ChartTypeSwitcher } from '@/components/workspace/ChartTypeSwitcher';
import { WorkspaceChart } from '@/components/workspace/WorkspaceChart';
import { ArtifactChatPanel } from '@/components/workspace/ArtifactChatPanel';
import {
  updateWorkspaceItem,
  deleteWorkspaceItem,
  requestWorkspaceIndex,
  type WorkspaceItem,
  type WorkspaceWidth,
} from '@/lib/workspace';
import {
  supportedChartTypes,
  toChartSeries,
  type ChartType,
} from '@/lib/workspace/chart-adapters';

interface Props {
  item: WorkspaceItem;
  onChange: (item: WorkspaceItem) => void;
  onDelete: (id: string) => void;
}

export function WorkspaceCard({ item, onChange, onDelete }: Props) {
  const { isDark, surface, surface2, border, text, textMuted, textSubtle } = useTheme();
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const chartType: ChartType = item.view_config.chartType ?? 'native';
  const width: WorkspaceWidth = item.view_config.width ?? 'half';
  const types = supportedChartTypes(item.payload);
  const series = toChartSeries(item.payload);

  useEffect(() => {
    setTitle(item.title);
    setNotes(item.notes ?? '');
  }, [item.id, item.title, item.notes]);

  async function persistView(patch: Partial<{ chartType: ChartType; width: WorkspaceWidth }>) {
    const nextConfig = { ...item.view_config, ...patch };
    const next = { ...item, view_config: nextConfig };
    onChange(next);
    await updateWorkspaceItem(item.id, { view_config: nextConfig });
  }

  async function persistTitle() {
    const trimmed = title.trim() || item.title;
    if (trimmed === item.title) return;
    const next = { ...item, title: trimmed };
    onChange(next);
    await updateWorkspaceItem(item.id, { title: trimmed });
  }

  async function persistNotes() {
    const nextNotes = notes.trim() || null;
    if ((nextNotes ?? '') === (item.notes ?? '')) return;
    const next = { ...item, notes: nextNotes };
    onChange(next);
    await updateWorkspaceItem(item.id, { notes: nextNotes });
    requestWorkspaceIndex(item.id);
  }

  async function handleDelete() {
    await deleteWorkspaceItem(item.id);
    onDelete(item.id);
  }

  return (
    <div
      className="veracity-card flex flex-col gap-4 p-4"
      style={{
        gridColumn: width === 'full' ? '1 / -1' : undefined,
        background: surface,
        border: `1px solid ${border}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={persistTitle}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="text-[15px] font-semibold bg-transparent outline-none truncate"
            style={{ color: text }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
              style={{
                color: '#0052FF',
                background: isDark ? 'rgba(0,82,255,0.1)' : 'rgba(0,82,255,0.06)',
                border: '1px solid rgba(0,82,255,0.2)',
              }}
            >
              {item.artifact_type}
            </span>
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
              style={{
                color: item.payload.confidence === 'high' ? '#059669'
                  : item.payload.confidence === 'medium' ? '#b45309' : '#dc2626',
                background: item.payload.confidence === 'high'
                  ? 'rgba(16,185,129,0.1)'
                  : item.payload.confidence === 'medium'
                    ? 'rgba(245,158,11,0.1)'
                    : 'rgba(239,68,68,0.1)',
                border: `1px solid ${
                  item.payload.confidence === 'high' ? 'rgba(16,185,129,0.25)'
                    : item.payload.confidence === 'medium' ? 'rgba(245,158,11,0.25)'
                      : 'rgba(239,68,68,0.25)'
                }`,
              }}
            >
              {item.payload.confidence}
            </span>
            {item.product ? (
              <span className="text-[10px] font-mono truncate" style={{ color: textSubtle }}>
                {item.product}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={width === 'full' ? 'Half width' : 'Full width'}
            onClick={() => persistView({ width: width === 'full' ? 'half' : 'full' })}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: textMuted }}
          >
            {width === 'full' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                className="text-[10px] font-mono uppercase px-2 py-1 rounded"
                style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] font-mono uppercase px-2 py-1 rounded"
                style={{ color: textMuted, border: `1px solid ${border}` }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              title="Delete"
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: textMuted }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <ChartTypeSwitcher
        types={types}
        value={types.includes(chartType) ? chartType : 'native'}
        onChange={next => persistView({ chartType: next })}
      />

      <div className="rounded-lg p-3" style={{ background: surface2, border: `1px solid ${border}` }}>
        {(types.includes(chartType) ? chartType : 'native') === 'native' ? (
          <ArtifactRenderer output={item.payload} product={item.product} />
        ) : (
          <WorkspaceChart
            series={series}
            chartType={types.includes(chartType) ? chartType : 'bar'}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-mono uppercase tracking-wider" style={{ color: textSubtle }}>
          Notes
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={persistNotes}
          rows={2}
          placeholder="Add a private note…"
          className="text-[12.5px] px-3 py-2 rounded-lg outline-none resize-y min-h-[56px]"
          style={{
            background: surface2,
            border: `1px solid ${border}`,
            color: text,
          }}
        />
      </div>

      <ArtifactChatPanel
        itemId={item.id}
        chartType={types.includes(chartType) ? chartType : 'native'}
      />
    </div>
  );
}
