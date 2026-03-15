# Veracity UI Theme Skill

When building any UI component or page in this project, always apply the Veracity design system:

## Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#FAFAFA` | Page backgrounds |
| `--foreground` | `#0F172A` | Primary text, dark elements |
| `--muted` | `#F1F5F9` | Secondary backgrounds, sidebars |
| `--muted-foreground` | `#64748B` | Secondary text, labels |
| `--accent` | `#0052FF` | Primary CTAs, active states, icons |
| `--accent-secondary` | `#4D7CFF` | Gradients, hover states |
| `--border` | `#E2E8F0` | Dividers, card borders |
| `--card` | `#FFFFFF` | Card surfaces |

## Typography

- **Display / Logo**: `font-serif` → Calistoga
- **Body / UI**: `font-sans` → Inter
- **Code / Labels / Pills**: `font-mono` → JetBrains Mono

## Utility Classes (defined in globals.css)

```css
.bg-gradient-signature   /* blue gradient: accent → accent-secondary, 135deg */
.text-gradient-signature /* same gradient applied as text fill */
.veracity-card           /* white card, 16px radius, border, subtle shadow */
.veracity-card-hover     /* lift on hover: translateY(-2px) + stronger shadow */
.animate-pulse-dot       /* pulsing dot animation (2s loop) */
.animate-pulse-line      /* skeleton loading line animation (1.5s loop) */
```

## Component Patterns

### Cards
```tsx
<div className="veracity-card veracity-card-hover p-6">
  {/* content */}
</div>
```

### Gradient Button (Primary CTA)
```tsx
<button className="bg-gradient-signature text-white rounded-xl py-3 px-4 font-medium transition-transform hover:-translate-y-[1px] hover:shadow-md">
  Action
</button>
```

### Status / Badge Pills
```tsx
{/* Active/Confidence */}
<span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-mono">
  High Confidence
</span>

{/* In Progress */}
<span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200">
  Running
</span>

{/* Completed */}
<span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
  Done ✓
</span>
```

### Agent Status Pills (row of agents)
```tsx
<div className="flex flex-wrap gap-2 mb-1">
  {agents.map(agent => (
    <span key={agent} className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1">
      {agent} <Check size={10} className="text-emerald-500" />
    </span>
  ))}
</div>
```

### Source Attribution Footer
```tsx
<div className="flex items-center gap-2 pt-2 border-t border-border/50">
  <span className="text-xs font-mono text-muted-foreground uppercase">Sources:</span>
  <div className="flex flex-wrap gap-2">
    {sources.map(source => (
      <span key={source} className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md flex items-center gap-1 hover:text-foreground cursor-pointer transition-colors">
        {source} <ArrowUpRight size={10} />
      </span>
    ))}
  </div>
</div>
```

### Suggestion Chips (follow-up questions)
```tsx
<button className="text-xs text-accent border border-accent/20 bg-accent/5 hover:bg-accent/10 hover:border-accent/30 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5">
  {suggestion} <ChevronRight size={12} />
</button>
```

### Confidence Score Bar
```tsx
<div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
  <div className="h-full bg-gradient-signature rounded-full" style={{ width: `${score}%` }} />
</div>
```

### Section Label
```tsx
<div className="text-xs font-mono text-muted-foreground mb-3 px-2 uppercase tracking-wider">
  Section Title
</div>
```

## Layout Conventions

- **Sidebar width**: `w-[260px]`
- **Chat max-width**: `max-w-3xl mx-auto`
- **Card padding**: `p-6`
- **Gap between messages**: `gap-8`
- **Gap within cards**: `gap-4` or `gap-5`
- **Rounded corners**: `rounded-xl` (buttons), `rounded-2xl` (input), `rounded-full` (pills)
- **Border radius for cards**: always via `.veracity-card` class

## Colors for Semantic States

| State | Background | Text | Border |
|-------|-----------|------|--------|
| Good / Win | `bg-emerald-50` | `text-emerald-600` | `border-emerald-200` |
| Warning / Partial | `bg-amber-50` | `text-amber-600` | `border-amber-200` |
| Bad / Loss | `bg-red-50` | `text-red-600` | `border-red-200` |
| Neutral | `bg-muted` | `text-muted-foreground` | `border-border` |
| Accent | `bg-accent/5` | `text-accent` | `border-accent/20` |

## Rules

1. **Never use bare hex colors** — always use the CSS variable tokens via Tailwind classes
2. **All cards use `.veracity-card`** — never custom bg + border + shadow separately
3. **Gradients only via `.bg-gradient-signature`** — do not hardcode gradient values
4. **Labels and pills always use `font-mono`**
5. **Section headers use `font-serif`** (Calistoga) for display text
6. **Keep spacing consistent** — use Tailwind spacing scale (don't mix px values with Tailwind)
7. **Animations**: only use `.animate-pulse-dot` and `.animate-pulse-line` for loading states
