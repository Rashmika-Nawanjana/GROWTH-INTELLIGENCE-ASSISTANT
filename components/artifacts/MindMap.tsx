'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { MindMapOutput, MindMapNode } from '@/lib/agents/types';
import { Plus, Minus, Maximize2 } from 'lucide-react';

interface Props {
  output: MindMapOutput;
}

// ── Branch color palette (NotebookLM style) ──
const BRANCH_COLORS = [
  { bg: '#DBEAFE', border: '#93C5FD', text: '#1E40AF', line: '#93C5FD', dot: '#3B82F6', lightBg: '#EFF6FF' },
  { bg: '#D1FAE5', border: '#6EE7B7', text: '#065F46', line: '#6EE7B7', dot: '#10B981', lightBg: '#ECFDF5' },
  { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B', line: '#FCA5A5', dot: '#EF4444', lightBg: '#FEF2F2' },
  { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', line: '#FCD34D', dot: '#F59E0B', lightBg: '#FFFBEB' },
  { bg: '#E0E7FF', border: '#A5B4FC', text: '#3730A3', line: '#A5B4FC', dot: '#6366F1', lightBg: '#EEF2FF' },
  { bg: '#FCE7F3', border: '#F9A8D4', text: '#9D174D', line: '#F9A8D4', dot: '#EC4899', lightBg: '#FDF2F8' },
  { bg: '#CCFBF1', border: '#5EEAD4', text: '#134E4A', line: '#5EEAD4', dot: '#14B8A6', lightBg: '#F0FDFA' },
  { bg: '#F3E8FF', border: '#C4B5FD', text: '#5B21B6', line: '#C4B5FD', dot: '#8B5CF6', lightBg: '#FAF5FF' },
];

// ── Filter out empty / junk nodes recursively ──
function isValidNode(node: MindMapNode): boolean {
  return !!(node.label && node.label.trim().length > 1);
}

function filterBranches(branches: MindMapNode[]): MindMapNode[] {
  return branches
    .filter(isValidNode)
    .map(b => ({
      ...b,
      children: b.children ? b.children.filter(isValidNode) : undefined,
    }));
}

// ── Layout engine ──
interface PositionedNode {
  node: MindMapNode;
  x: number;
  y: number;
  colorIdx: number;
  depth: number;
  parentX?: number;
  parentY?: number;
}

function layoutNodes(
  branches: MindMapNode[],
  centerX: number,
  centerY: number,
): PositionedNode[] {
  const positioned: PositionedNode[] = [];
  const count = branches.length;
  if (count === 0) return positioned;

  const r1 = 200;
  const r2 = 140;

  branches.forEach((branch, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const bx = centerX + r1 * Math.cos(angle);
    const by = centerY + r1 * Math.sin(angle);

    positioned.push({
      node: branch,
      x: bx, y: by,
      colorIdx: i % BRANCH_COLORS.length,
      depth: 1,
      parentX: centerX, parentY: centerY,
    });

    const children = branch.children ?? [];
    if (children.length > 0) {
      const childCount = children.length;
      const spread = Math.min(Math.PI * 0.55, Math.PI * 0.2 * childCount);

      children.forEach((child, ci) => {
        const childAngle = childCount === 1
          ? angle
          : angle - spread / 2 + (spread * ci) / (childCount - 1);
        const cx = bx + r2 * Math.cos(childAngle);
        const cy = by + r2 * Math.sin(childAngle);

        positioned.push({
          node: child,
          x: cx, y: cy,
          colorIdx: i % BRANCH_COLORS.length,
          depth: 2,
          parentX: bx, parentY: by,
        });
      });
    }
  });

  return positioned;
}

// ── Compute bounding box from positioned nodes with padding ──
function computeViewBox(
  positioned: PositionedNode[],
  centerX: number,
  centerY: number,
): { x: number; y: number; w: number; h: number } {
  const nodeHalfW = 90; // half of widest node (180px)
  const nodeH = 40;
  const padding = 60;

  let minX = centerX - 100;
  let maxX = centerX + 100;
  let minY = centerY - 32;
  let maxY = centerY + 32;

  for (const p of positioned) {
    minX = Math.min(minX, p.x - nodeHalfW);
    maxX = Math.max(maxX, p.x + nodeHalfW);
    minY = Math.min(minY, p.y - nodeH);
    maxY = Math.max(maxY, p.y + nodeH);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  };
}

// ── SVG curved connector line ──
function ConnectorLine({
  x1, y1, x2, y2, color, opacity = 1,
}: {
  x1: number; y1: number; x2: number; y2: number; color: string; opacity?: number;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const curveAmount = len * 0.08;
  const cpx = mx + (-dy / len) * curveAmount;
  const cpy = my + (dx / len) * curveAmount;

  return (
    <path
      d={`M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`}
      stroke={color}
      strokeWidth={2}
      fill="none"
      opacity={opacity}
      strokeLinecap="round"
    />
  );
}

// ── Individual node ──
function MapNode({
  positioned,
  isSelected,
  onSelect,
}: {
  positioned: PositionedNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { node, x, y, colorIdx, depth } = positioned;
  const color = BRANCH_COLORS[colorIdx];
  const isBranch = depth === 1;

  const maxW = isBranch ? 170 : 150;
  const nodeH = isBranch ? 80 : 65;
  const px = isBranch ? 14 : 10;
  const py = isBranch ? 10 : 7;
  const fontSize = isBranch ? 12.5 : 11;
  const fontWeight = isBranch ? 600 : 500;

  return (
    <foreignObject
      x={x - maxW / 2}
      y={y - nodeH / 2}
      width={maxW}
      height={nodeH}
    >
      <div
        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div
          onClick={onSelect}
          style={{
            background: isSelected ? color.bg : (isBranch ? color.bg : color.lightBg),
            borderColor: isSelected ? color.dot : color.border,
            color: color.text,
            fontSize,
            fontWeight,
            maxWidth: maxW,
            padding: `${py}px ${px}px`,
            borderWidth: isSelected ? 2 : 1.5,
            borderStyle: 'solid',
            boxShadow: isSelected
              ? `0 0 0 3px ${color.dot}20, 0 4px 12px ${color.dot}15`
              : isBranch
                ? '0 2px 8px rgba(0,0,0,0.06)'
                : '0 1px 4px rgba(0,0,0,0.04)',
            borderRadius: 12,
            cursor: 'pointer',
            textAlign: 'center',
            lineHeight: '1.3',
            userSelect: 'none' as const,
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
        >
          <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {node.label}
          </span>
        </div>
      </div>
    </foreignObject>
  );
}

// ── Detail panel ──
function DetailPanel({
  node,
  colorIdx,
  onClose,
}: {
  node: MindMapNode;
  colorIdx: number;
  onClose: () => void;
}) {
  const color = BRANCH_COLORS[colorIdx];
  return (
    <div
      className="absolute bottom-3 left-3 right-3 rounded-xl border-2 p-4 flex flex-col gap-2 z-20 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={{ background: `${color.lightBg}F0`, borderColor: color.border }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold" style={{ color: color.text }}>{node.label}</h4>
        <button
          onClick={onClose}
          className="text-xs shrink-0 px-2 py-0.5 rounded-md hover:bg-black/5 transition-colors"
          style={{ color: color.text }}
        >
          &times;
        </button>
      </div>
      {node.detail && (
        <p className="text-xs leading-relaxed text-foreground/80">{node.detail}</p>
      )}
      {node.children && node.children.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {node.children.map((child, i) => (
            <span
              key={child.id || i}
              className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
              style={{ background: color.bg, borderColor: color.border, color: color.text }}
            >
              {child.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──
export function MindMap({ output }: Props) {
  const centralTopic = output.centralTopic ?? '';
  const rawBranches = output.branches ?? [];
  const summary = output.summary;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Filter out empty / meaningless nodes
  const branches = useMemo(() => filterBranches(rawBranches), [rawBranches]);

  // Layout with a generous center — we'll compute viewBox dynamically
  const layoutCx = 500;
  const layoutCy = 500;
  const positioned = useMemo(() => layoutNodes(branches, layoutCx, layoutCy), [branches]);

  // Dynamic viewBox that fits all nodes
  const vb = useMemo(() => computeViewBox(positioned, layoutCx, layoutCy), [positioned]);

  const selectedNode = selectedId
    ? positioned.find(p => p.node.id === selectedId)
    : null;

  const zoomIn = useCallback(() => setScale(s => Math.min(s + 0.15, 2)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(s - 0.15, 0.4)), []);
  const resetView = useCallback(() => { setScale(1); setPan({ x: 0, y: 0 }); }, []);

  // Scroll wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale(s => Math.max(0.4, Math.min(2, s - e.deltaY * 0.001)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Pan via drag
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, [isDragging]);

  const onPointerUp = useCallback(() => setIsDragging(false), []);

  if (branches.length === 0) {
    // Defensive fallback: a sparse run can leave us with zero branches even
    // though the artifact mounted. Show a small inline notice instead of a
    // blank panel so the user knows the mind-map step ran but yielded nothing.
    return (
      <div className="flex flex-col gap-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Mind Map</div>
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground leading-snug">
          Synthesis returned no usable branches for this query.
          {summary ? <span className="block mt-1 text-foreground/80">{summary}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Mind Map</div>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Zoom out">
            <Minus size={14} className="text-muted-foreground" />
          </button>
          <span className="text-[10px] font-mono text-muted-foreground w-10 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button onClick={zoomIn} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Zoom in">
            <Plus size={14} className="text-muted-foreground" />
          </button>
          <button onClick={resetView} className="p-1.5 rounded-lg hover:bg-muted transition-colors ml-1" title="Reset view">
            <Maximize2 size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative rounded-2xl border border-border bg-[#FAFBFC] overflow-hidden select-none"
        style={{ height: 540, cursor: isDragging ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Dot grid background */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.35]">
          <defs>
            <pattern id="mindmap-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.6" fill="#CBD5E1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#mindmap-grid)" />
        </svg>

        {/* SVG mind map */}
        <svg
          width="100%"
          height="100%"
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            transform: `scale(${scale}) translate(${pan.x / scale}px, ${pan.y / scale}px)`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
          }}
        >
          {/* Connector lines (behind nodes) */}
          {positioned.map((p, i) =>
            p.parentX !== undefined && p.parentY !== undefined ? (
              <ConnectorLine
                key={`line-${i}`}
                x1={p.parentX} y1={p.parentY}
                x2={p.x} y2={p.y}
                color={BRANCH_COLORS[p.colorIdx].line}
                opacity={selectedId && selectedId !== p.node.id ? 0.3 : 0.7}
              />
            ) : null
          )}

          {/* Central node */}
          <foreignObject
            x={layoutCx - 105}
            y={layoutCy - 30}
            width={210}
            height={60}
          >
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                style={{
                  background: 'linear-gradient(135deg, #0052FF, #4D7CFF)',
                  borderRadius: 16,
                  padding: '10px 20px',
                  textAlign: 'center',
                  cursor: 'default',
                  maxWidth: 210,
                  boxShadow: '0 4px 20px rgba(0, 82, 255, 0.2)',
                }}
              >
                <p style={{
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  lineHeight: 1.3,
                  margin: 0,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {centralTopic}
                </p>
              </div>
            </div>
          </foreignObject>

          {/* Branch + leaf nodes */}
          {positioned.map((p, i) => (
            <MapNode
              key={p.node.id || `node-${i}`}
              positioned={p}
              isSelected={selectedId === p.node.id}
              onSelect={() => setSelectedId(selectedId === p.node.id ? null : p.node.id)}
            />
          ))}
        </svg>

        {/* Detail panel */}
        {selectedNode && (
          <DetailPanel
            node={selectedNode.node}
            colorIdx={selectedNode.colorIdx}
            onClose={() => setSelectedId(null)}
          />
        )}

        {/* Summary */}
        {summary && (
          <div className="absolute top-3 left-3 text-[11px] text-muted-foreground bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-border max-w-[280px] leading-relaxed">
            {summary}
          </div>
        )}
      </div>
    </div>
  );
}
