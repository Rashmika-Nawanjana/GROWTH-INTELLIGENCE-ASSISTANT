'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { MindMapOutput, MindMapNode, ConfidenceLevel } from '@/lib/agents/types';
import { Plus, Minus, Maximize2, BookOpen, HelpCircle, X, ExternalLink, ChevronDown } from 'lucide-react';

interface Props {
  output: MindMapOutput;
}

// ── Branch color palette ──────────────────────────────────────────────────────
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

// ── Sentiment visual config ───────────────────────────────────────────────────
const SENTIMENT_CONFIG = {
  positive: { color: '#10B981', label: 'Positive' },
  negative: { color: '#EF4444', label: 'Negative' },
  warning:  { color: '#F59E0B', label: 'Warning'  },
  neutral:  { color: null,      label: 'Neutral'  },
} as const;

// ── Confidence badge config ───────────────────────────────────────────────────
const CONF_BADGE: Record<ConfidenceLevel, { bg: string; text: string; label: string }> = {
  high:   { bg: '#D1FAE5', text: '#065F46', label: 'High'   },
  medium: { bg: '#FEF3C7', text: '#92400E', label: 'Med'    },
  low:    { bg: '#FEE2E2', text: '#991B1B', label: 'Low'    },
};

// ── Domain short labels ───────────────────────────────────────────────────────
const DOMAIN_SHORT: Record<string, string> = {
  'market-trends': 'Market',
  'competitive':   'Comp.',
  'win-loss':      'Win/Loss',
  'pricing':       'Pricing',
  'positioning':   'Position',
  'adjacent':      'Adjacent',
};

// ── Node filtering ────────────────────────────────────────────────────────────
function isValidNode(n: MindMapNode): boolean {
  return !!(n.label && n.label.trim().length > 1);
}

function filterBranches(branches: MindMapNode[]): MindMapNode[] {
  return branches.filter(isValidNode).map(b => ({
    ...b,
    children: b.children
      ? b.children.filter(isValidNode).map(c => ({
          ...c,
          children: c.children ? c.children.filter(isValidNode) : undefined,
        }))
      : undefined,
  }));
}

// ── Layout engine — supports 3 depths ─────────────────────────────────────────
interface PositionedNode {
  node: MindMapNode;
  x: number;
  y: number;
  colorIdx: number;
  depth: number;
  parentX?: number;
  parentY?: number;
  branchId: string;
}

function layoutNodes(
  branches: MindMapNode[],
  cx: number,
  cy: number,
  collapsed: Set<string>,
): PositionedNode[] {
  const positioned: PositionedNode[] = [];
  const count = branches.length;
  if (count === 0) return positioned;

  // Scale r1 with branch density to reduce overlap between adjacent sectors
  const r1 = Math.max(235, 185 + count * 12);
  const r2 = 162;
  const r3 = 118;

  branches.forEach((branch, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const bx = cx + r1 * Math.cos(angle);
    const by = cy + r1 * Math.sin(angle);

    positioned.push({
      node: branch,
      x: bx, y: by,
      colorIdx: i % BRANCH_COLORS.length,
      depth: 1,
      parentX: cx, parentY: cy,
      branchId: branch.id,
    });

    if (collapsed.has(branch.id)) return;

    const children = branch.children ?? [];
    if (!children.length) return;

    // Spread angle proportional to sector size so adjacent branches don't collide
    const sectorAngle = (2 * Math.PI) / count;
    const spread2 = Math.min(sectorAngle * 0.72, Math.PI * 0.58);

    children.forEach((child, ci) => {
      const childAngle = children.length === 1
        ? angle
        : angle - spread2 / 2 + (spread2 * ci) / (children.length - 1);
      const lx = bx + r2 * Math.cos(childAngle);
      const ly = by + r2 * Math.sin(childAngle);

      positioned.push({
        node: child,
        x: lx, y: ly,
        colorIdx: i % BRANCH_COLORS.length,
        depth: 2,
        parentX: bx, parentY: by,
        branchId: branch.id,
      });

      // Grandchildren (depth 3)
      const grandchildren = child.children ?? [];
      if (!grandchildren.length) return;

      const spread3 = Math.min(Math.PI * 0.38, Math.PI * 0.14 * grandchildren.length);

      grandchildren.forEach((gc, gi) => {
        const gcAngle = grandchildren.length === 1
          ? childAngle
          : childAngle - spread3 / 2 + (spread3 * gi) / (grandchildren.length - 1);
        const gx = lx + r3 * Math.cos(gcAngle);
        const gy = ly + r3 * Math.sin(gcAngle);

        positioned.push({
          node: gc,
          x: gx, y: gy,
          colorIdx: i % BRANCH_COLORS.length,
          depth: 3,
          parentX: lx, parentY: ly,
          branchId: branch.id,
        });
      });
    });
  });

  return positioned;
}

// ── Dynamic viewBox ───────────────────────────────────────────────────────────
function computeViewBox(
  positioned: PositionedNode[],
  cx: number,
  cy: number,
): { x: number; y: number; w: number; h: number } {
  const pad = 72;
  let minX = cx - 120, maxX = cx + 120;
  let minY = cy - 38,  maxY = cy + 38;

  for (const p of positioned) {
    const hw = p.depth === 1 ? 92 : p.depth === 2 ? 80 : 68;
    const hh = p.depth === 1 ? 46 : p.depth === 2 ? 38 : 30;
    minX = Math.min(minX, p.x - hw);
    maxX = Math.max(maxX, p.x + hw);
    minY = Math.min(minY, p.y - hh);
    maxY = Math.max(maxY, p.y + hh);
  }

  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

// ── Bezier connector line ─────────────────────────────────────────────────────
function ConnectorLine({
  x1, y1, x2, y2, color, opacity = 1, depth,
}: {
  x1: number; y1: number; x2: number; y2: number;
  color: string; opacity?: number; depth?: number;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const curve = len * (depth === 3 ? 0.05 : 0.1);
  const cpx = mx + (-dy / len) * curve;
  const cpy = my + (dx / len) * curve;
  const sw = depth === 1 ? 2.5 : depth === 2 ? 2 : 1.5;

  return (
    <path
      d={`M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`}
      stroke={color}
      strokeWidth={sw}
      fill="none"
      opacity={opacity}
      strokeLinecap="round"
    />
  );
}

// ── Individual node ───────────────────────────────────────────────────────────
function MapNode({
  positioned,
  isSelected,
  isHovered,
  isCollapsed,
  onSelect,
  onHover,
}: {
  positioned: PositionedNode;
  isSelected: boolean;
  isHovered: boolean;
  isCollapsed: boolean;
  onSelect: () => void;
  onHover: (h: boolean) => void;
}) {
  const { node, x, y, colorIdx, depth } = positioned;
  const color = BRANCH_COLORS[colorIdx];
  const isBranch = depth === 1;
  const sentiment = node.sentiment ? SENTIMENT_CONFIG[node.sentiment] : null;

  const maxW = depth === 1 ? 178 : depth === 2 ? 158 : 136;
  const nodeH = depth === 1 ? 88 : depth === 2 ? 70 : 56;
  const px = depth === 1 ? 14 : 10;
  const py = depth === 1 ? 10 : 8;
  const fontSize = depth === 1 ? 12.5 : depth === 2 ? 11 : 10.5;
  const fw = depth === 1 ? 600 : 500;

  const bgColor = isSelected || isHovered
    ? color.bg
    : isBranch ? color.bg : color.lightBg;
  const borderColor = isSelected ? color.dot : color.border;
  const bw = isSelected ? 2 : 1.5;
  const shadow = isSelected
    ? `0 0 0 3px ${color.dot}28, 0 4px 18px ${color.dot}22`
    : isHovered
      ? '0 4px 18px rgba(0,0,0,0.11)'
      : isBranch
        ? '0 2px 8px rgba(0,0,0,0.06)'
        : '0 1px 4px rgba(0,0,0,0.04)';

  return (
    <foreignObject
      x={x - maxW / 2}
      y={y - nodeH / 2}
      width={maxW}
      height={nodeH}
    >
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          data-node="true"
          onClick={onSelect}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
          style={{
            background: bgColor,
            borderColor,
            color: color.text,
            fontSize,
            fontWeight: fw,
            width: '100%',
            padding: `${py}px ${px}px`,
            paddingTop: isBranch ? py + 2 : py,
            borderWidth: bw,
            borderStyle: 'solid',
            boxShadow: shadow,
            borderRadius: 12,
            cursor: 'pointer',
            textAlign: 'center',
            lineHeight: '1.3',
            userSelect: 'none' as const,
            transition: 'box-shadow 0.15s, background 0.15s',
            position: 'relative',
          }}
        >
          {/* Sentiment indicator dot — top-right corner */}
          {sentiment?.color && (
            <span style={{
              position: 'absolute',
              top: 5,
              right: 5,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: sentiment.color,
              boxShadow: `0 0 0 2px white`,
              display: 'block',
              flexShrink: 0,
            }} />
          )}

          {/* Collapse chevron — bottom-right corner for branch nodes */}
          {isBranch && (
            <span style={{
              position: 'absolute',
              bottom: 4,
              right: 5,
              fontSize: 7,
              color: color.dot,
              opacity: 0.65,
              lineHeight: 1,
            }}>
              {isCollapsed ? '▶' : '▼'}
            </span>
          )}

          {/* Label */}
          <span style={{
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {node.label}
          </span>

          {/* Source agent badge — branches only */}
          {isBranch && node.sourceAgent && (
            <span style={{
              display: 'block',
              marginTop: 3,
              fontSize: 8.5,
              fontFamily: 'monospace',
              opacity: 0.6,
              letterSpacing: '0.04em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {DOMAIN_SHORT[node.sourceAgent] ?? node.sourceAgent}
            </span>
          )}

          {/* Confidence badge — branches only */}
          {isBranch && node.confidence && (
            <span style={{
              display: 'inline-block',
              marginTop: 2,
              fontSize: 8,
              fontFamily: 'monospace',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 20,
              background: CONF_BADGE[node.confidence]?.bg,
              color: CONF_BADGE[node.confidence]?.text,
              letterSpacing: '0.03em',
            }}>
              {CONF_BADGE[node.confidence]?.label}
            </span>
          )}
        </div>
      </div>
    </foreignObject>
  );
}

// ── Side detail panel ─────────────────────────────────────────────────────────
function SidePanel({
  node,
  colorIdx,
  onClose,
}: {
  node: MindMapNode;
  colorIdx: number;
  onClose: () => void;
}) {
  const color = BRANCH_COLORS[colorIdx];
  const sentiment = node.sentiment ? SENTIMENT_CONFIG[node.sentiment] : null;

  return (
    <div
      className="absolute right-0 top-0 h-full flex flex-col z-20 overflow-y-auto"
      style={{
        width: 264,
        background: `${color.lightBg}F8`,
        borderLeft: `2px solid ${color.border}`,
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="flex flex-col gap-1 min-w-0">
          {sentiment?.color && (
            <span style={{
              fontSize: 9,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: sentiment.color,
            }}>
              ● {sentiment.label.toUpperCase()}
            </span>
          )}
          <h4 className="text-sm font-semibold leading-snug" style={{ color: color.text }}>
            {node.label}
          </h4>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded-md hover:bg-black/10 transition-colors"
          style={{ color: color.text }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Detail text */}
      {node.detail && (
        <p
          className="px-4 pb-3 text-xs leading-relaxed border-b"
          style={{ color: `${color.text}CC`, borderColor: color.border }}
        >
          {node.detail}
        </p>
      )}

      {/* Metadata badges */}
      {(node.confidence || node.sourceAgent) && (
        <div className="px-4 py-3 flex flex-wrap gap-1.5 border-b" style={{ borderColor: color.border }}>
          {node.confidence && (
            <span style={{
              fontSize: 9,
              fontFamily: 'monospace',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 20,
              letterSpacing: '0.04em',
              background: CONF_BADGE[node.confidence]?.bg,
              color: CONF_BADGE[node.confidence]?.text,
            }}>
              {CONF_BADGE[node.confidence]?.label.toUpperCase()} CONFIDENCE
            </span>
          )}
          {node.sourceAgent && (
            <span style={{
              fontSize: 9,
              fontFamily: 'monospace',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 20,
              letterSpacing: '0.04em',
              background: color.bg,
              color: color.text,
              border: `1px solid ${color.border}`,
            }}>
              {DOMAIN_SHORT[node.sourceAgent] ?? node.sourceAgent}
            </span>
          )}
        </div>
      )}

      {/* Children list */}
      {node.children && node.children.length > 0 && (
        <div className="px-4 py-3 flex flex-col gap-2">
          <div style={{
            fontSize: 9,
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: color.text,
            opacity: 0.55,
            marginBottom: 4,
          }}>
            Sub-topics ({node.children.length})
          </div>
          {node.children.map((child, i) => {
            const cs = child.sentiment ? SENTIMENT_CONFIG[child.sentiment] : null;
            return (
              <div
                key={child.id || i}
                className="rounded-lg p-2.5"
                style={{ background: color.bg, border: `1px solid ${color.border}` }}
              >
                <div className="flex items-start gap-1.5 mb-1">
                  {cs?.color && (
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: cs.color,
                      display: 'inline-block',
                      flexShrink: 0,
                      marginTop: 3,
                    }} />
                  )}
                  <span style={{ fontSize: 11, fontWeight: 600, color: color.text, lineHeight: 1.3 }}>
                    {child.label}
                  </span>
                </div>
                {child.detail && (
                  <p style={{ fontSize: 10, color: color.text, opacity: 0.65, margin: 0, lineHeight: 1.4 }}>
                    {child.detail}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Legend panel ──────────────────────────────────────────────────────────────
function LegendPanel({
  branches,
  onClose,
}: {
  branches: MindMapNode[];
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-3 left-3 z-30 rounded-xl border border-border bg-white/96 backdrop-blur-sm shadow-lg p-3 w-52">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Legend</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Branch color key */}
      <div className="flex flex-col gap-1.5 mb-3">
        {branches.map((b, i) => {
          const c = BRANCH_COLORS[i % BRANCH_COLORS.length];
          return (
            <div key={b.id || i} className="flex items-center gap-2">
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.dot, flexShrink: 0 }} />
              <span
                className="truncate"
                style={{ fontSize: 10, color: c.text, fontWeight: 500 }}
                title={b.label}
              >
                {b.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border my-2" />

      {/* Sentiment key */}
      <div className="flex flex-col gap-1.5">
        {(Object.entries(SENTIMENT_CONFIG) as [string, typeof SENTIMENT_CONFIG[keyof typeof SENTIMENT_CONFIG]][])
          .filter(([, v]) => v.color)
          .map(([key, v]) => (
            <div key={key} className="flex items-center gap-2">
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: v.color!,
                flexShrink: 0,
              }} />
              <span className="text-[10px] text-muted-foreground">{v.label}</span>
            </div>
          ))}
        <div className="flex items-center gap-2">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#CBD5E1', flexShrink: 0 }} />
          <span className="text-[10px] text-muted-foreground">Neutral</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function MindMap({ output }: Props) {
  const centralTopic = output.centralTopic ?? '';
  const rawBranches  = output.branches ?? [];
  const summary      = output.summary;
  const sources      = output.sources ?? [];

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale]             = useState(1);
  const [pan, setPan]                 = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging]   = useState(false);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [hoveredId, setHoveredId]     = useState<string | null>(null);
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set());
  const [showLegend, setShowLegend]   = useState(false);
  const [showSources, setShowSources] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const branches = useMemo(() => filterBranches(rawBranches), [rawBranches]);

  const layoutCx = 500;
  const layoutCy = 500;

  const positioned = useMemo(
    () => layoutNodes(branches, layoutCx, layoutCy, collapsedBranches),
    [branches, collapsedBranches],
  );

  const vb = useMemo(() => computeViewBox(positioned, layoutCx, layoutCy), [positioned]);

  const selectedNode = selectedId
    ? positioned.find(p => p.node.id === selectedId) ?? null
    : null;

  // ── Zoom controls ──────────────────────────────────────────────────────────
  const zoomIn  = useCallback(() => setScale(s => Math.min(s + 0.15, 3)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(s - 0.15, 0.3)), []);

  const fitToScreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) { setScale(1); setPan({ x: 0, y: 0 }); return; }
    const scaleX = el.clientWidth  / vb.w;
    const scaleY = el.clientHeight / vb.h;
    setScale(Math.min(scaleX, scaleY, 1.5) * 0.88);
    setPan({ x: 0, y: 0 });
  }, [vb]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === '=' || e.key === '+') zoomIn();
      if (e.key === '-') zoomOut();
      if (e.key === '0') fitToScreen();
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomIn, zoomOut, fitToScreen]);

  // ── Scroll-wheel zoom ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale(s => Math.max(0.3, Math.min(3, s - e.deltaY * 0.0012)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Pan via pointer drag ───────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, [isDragging]);

  const onPointerUp = useCallback(() => setIsDragging(false), []);

  // ── Node selection + branch collapse ──────────────────────────────────────
  const handleNodeSelect = useCallback((p: PositionedNode) => {
    if (p.depth === 1) {
      setCollapsedBranches(prev => {
        const next = new Set(prev);
        if (next.has(p.node.id)) next.delete(p.node.id);
        else next.add(p.node.id);
        return next;
      });
    }
    setSelectedId(prev => prev === p.node.id ? null : p.node.id);
  }, []);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (branches.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Mind Map</div>
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground leading-snug">
          Synthesis returned no usable branches for this query.
          {summary && <span className="block mt-1 text-foreground/80">{summary}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">

      {/* ── Header toolbar ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Mind Map</div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowLegend(v => !v)}
            className={`p-1.5 rounded-lg transition-colors ${showLegend ? 'bg-muted text-foreground' : 'hover:bg-muted text-muted-foreground'}`}
            title="Toggle legend"
          >
            <HelpCircle size={14} />
          </button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <button onClick={zoomOut} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Zoom out (-)">
            <Minus size={14} className="text-muted-foreground" />
          </button>
          <span className="text-[10px] font-mono text-muted-foreground w-10 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button onClick={zoomIn} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Zoom in (+)">
            <Plus size={14} className="text-muted-foreground" />
          </button>
          <button onClick={fitToScreen} className="p-1.5 rounded-lg hover:bg-muted transition-colors ml-1" title="Fit to screen (0)">
            <Maximize2 size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* ── Canvas ───────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="relative rounded-2xl border border-border bg-[#FAFBFC] overflow-hidden select-none"
        style={{ height: 560, cursor: isDragging ? 'grabbing' : 'grab' }}
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

        {/* Mind map SVG */}
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
          {/* Connector lines — rendered behind nodes */}
          {positioned.map((p, i) =>
            p.parentX !== undefined && p.parentY !== undefined ? (
              <ConnectorLine
                key={`line-${i}`}
                x1={p.parentX}
                y1={p.parentY}
                x2={p.x}
                y2={p.y}
                color={BRANCH_COLORS[p.colorIdx].line}
                opacity={
                  selectedId && p.branchId !== (selectedNode?.branchId)
                    ? 0.18
                    : 0.72
                }
                depth={p.depth}
              />
            ) : null
          )}

          {/* Central node — wider + 3-line clamp */}
          <foreignObject x={layoutCx - 112} y={layoutCy - 40} width={224} height={80}>
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{
                background: 'linear-gradient(135deg, #0052FF, #4D7CFF)',
                borderRadius: 16,
                padding: '11px 20px',
                textAlign: 'center',
                cursor: 'default',
                width: '100%',
                boxShadow: '0 4px 24px rgba(0, 82, 255, 0.26)',
              }}>
                <p style={{
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: 13,
                  lineHeight: 1.35,
                  margin: 0,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {centralTopic}
                </p>
              </div>
            </div>
          </foreignObject>

          {/* Branch + leaf + grandchild nodes */}
          {positioned.map((p, i) => (
            <MapNode
              key={p.node.id || `node-${i}`}
              positioned={p}
              isSelected={selectedId === p.node.id}
              isHovered={hoveredId === p.node.id}
              isCollapsed={collapsedBranches.has(p.node.id)}
              onSelect={() => handleNodeSelect(p)}
              onHover={h => setHoveredId(h ? p.node.id : null)}
            />
          ))}
        </svg>

        {/* Summary pill — hidden while a node is selected so it doesn't clash with side panel */}
        {summary && !selectedId && (
          <div className="absolute top-3 left-3 text-[11px] text-muted-foreground bg-white/85 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-border max-w-[260px] leading-relaxed pointer-events-none">
            {summary}
          </div>
        )}

        {/* Side detail panel */}
        {selectedNode && (
          <SidePanel
            node={selectedNode.node}
            colorIdx={selectedNode.colorIdx}
            onClose={() => setSelectedId(null)}
          />
        )}

        {/* Legend */}
        {showLegend && (
          <LegendPanel branches={branches} onClose={() => setShowLegend(false)} />
        )}

        {/* Keyboard hint */}
        <div className="absolute bottom-2.5 right-3 text-[9px] font-mono text-muted-foreground/50 pointer-events-none leading-relaxed text-right">
          scroll to zoom · drag to pan · click branch to collapse
        </div>
      </div>

      {/* ── Sources footer ────────────────────────────────────────────────── */}
      {sources.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowSources(v => !v)}
            className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider w-fit"
          >
            <BookOpen size={11} />
            {sources.length} Source{sources.length !== 1 ? 's' : ''}
            <ChevronDown
              size={10}
              className="transition-transform duration-200"
              style={{ transform: showSources ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </button>
          {showSources && (
            <div className="flex flex-wrap gap-1.5">
              {sources.map((src, i) => (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-md bg-muted hover:bg-muted/60 text-muted-foreground border border-border transition-colors max-w-[210px]"
                >
                  <ExternalLink size={9} className="shrink-0" />
                  <span className="truncate">{src.title || src.url}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
