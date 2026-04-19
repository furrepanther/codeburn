# Model Comparison Design

Compare two AI models side-by-side using normalized metrics derived from real
usage data. Answers "is Opus 4.7 actually better than 4.6 for my workflow?"
with hard numbers instead of vibes.

## Goals

1. Let users pick any two models and see a fair, normalized comparison
2. Surface efficiency metrics that raw cost/token dashboards don't show
   (one-shot rate, retry rate, self-correction rate)
3. Accessible from both the dashboard (press `c`) and standalone (`codeburn compare`)
4. Screenshot-friendly terminal output

## Non-Goals

- Multi-model comparison (3+) -- v2
- Time-frame filtering (`--period`) -- v2
- Charts/graphs in the comparison view -- v2
- Exporting comparison results to JSON/CSV -- v2
- Statistical significance testing (show sample sizes, let the user judge)

---

## 1. Entry Points

### Standalone command

```
codeburn compare [--provider <provider>] [--period <period>]
```

Period defaults to `all` (6 months). Provider defaults to `all`. Both flags
are accepted but optional. Launches the full-screen Ink TUI directly into the
model selection screen.

### Dashboard shortcut

Press `c` in the dashboard to switch to the compare view. Same component, same
flow. `Escape` returns to the dashboard (mirrors how `o` toggles optimize).

The status bar gains a `[c]ompare` hint next to the existing `[o]ptimize`.

---

## 2. Data Pipeline

### Aggregation

Reuse `parseAllSessions` to get `ProjectSummary[]` for the selected
period/provider. Then build per-model stats by iterating turns and calls:

```ts
type ModelStats = {
  model: string
  calls: number
  cost: number
  outputTokens: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTurns: number
  editTurns: number
  oneShotTurns: number    // edit turns with 0 retries
  retries: number         // total retry count
  selfCorrections: number // turns matching apology/mistake patterns
  firstSeen: string       // earliest timestamp (ISO)
  lastSeen: string        // latest timestamp (ISO)
}
```

Turn-level metrics are attributed to the primary model (first call in the
turn). This matches how the dashboard already attributes turns.

### Self-correction detection

Scan assistant message text for patterns that indicate the model acknowledged
an error. These patterns were validated against real session data:

```ts
const SELF_CORRECTION_PATTERNS = [
  /\bI('m| am) sorry\b/i,
  /\bmy mistake\b/i,
  /\bmy apolog/i,
  /\bI made (a |an )?(error|mistake)\b/i,
  /\bI was wrong\b/i,
  /\bmy bad\b/i,
  /\bI apologize\b/i,
  /\bsorry about that\b/i,
  /\bsorry for (the|that|this)\b/i,
  /\bI should have\b/i,
  /\bI shouldn't have\b/i,
  /\bI incorrectly\b/i,
  /\bI mistakenly\b/i,
]
```

This requires reading assistant message content from session JSONL files,
which the current parser does not expose. The aggregation function will need
to read raw JSONL entries for sessions that contain the selected models.

### Normalization

All comparison metrics are rates or per-call averages. Raw totals (cost, calls,
days) are shown as context, never as comparison metrics.

---

## 3. Comparison Metrics

| Metric | Formula | Better |
|---|---|---|
| Cost / call | `cost / calls` | Lower |
| Output tokens / call | `outputTokens / calls` | Lower |
| Cache hit rate | `cacheRead / (input + cacheRead + cacheWrite) * 100` | Higher |
| One-shot rate | `oneShotTurns / editTurns * 100` | Higher |
| Retry rate | `retries / editTurns` | Lower |
| Self-correction rate | `selfCorrections / totalTurns * 100` | Lower |

### Context row (not compared)

Displayed below the table to give sample-size context:

- Total calls
- Total cost
- Days of data (lastSeen - firstSeen)
- Edit turns (denominator for one-shot/retry metrics)

---

## 4. UI Screens

### Model Selection Screen

```
  Model Comparison

  Select two models to compare:

    claude-opus-4-6          56,031 calls    $5,272
  > claude-opus-4-7           3,592 calls      $664   [selected]
    claude-sonnet-4-6         1,142 calls       $25
    claude-haiku-4-5             323 calls        $4
    gpt-5                        113 calls        $3   low data

  [space] select  [enter] compare  [esc] back  [q] quit
```

- Arrow keys navigate, spacebar toggles selection (max 2)
- Models sorted by cost descending (most-used first)
- Models with < 20 calls show "low data" dim label
- Enter is disabled until exactly 2 models are selected
- Filter out `<synthetic>` model entries

### Loading Screen

```
  Comparing claude-opus-4-6 vs claude-opus-4-7...
```

Simple spinner while aggregation runs. Should be fast (< 2 seconds) since
session data is already parsed.

### Comparison Results Screen

```
  claude-opus-4-6  vs  claude-opus-4-7

                       4.6          4.7
  Cost / call        $0.094       $0.185        4.6 wins
  Output tok / call     227          800        4.6 wins
  Cache hit rate      98.4%        98.8%        4.7 wins
  One-shot rate       88.8%        74.5%        4.6 wins
  Retry rate           0.18         0.46        4.6 wins
  Self-correction      0.18%        0.25%       4.6 wins

  ── Context ──────────────────────────────────
  Calls              56,031        3,592
  Cost             $5,272.13      $664.32
  Days of data           60            3
  Edit turns          1,577          102

  [esc] back  [q] quit
```

- Winner column uses green text for the better model on each metric
- Model names in the header are shortened for display (drop `claude-` prefix)
- Context section is dimmed to visually separate it from the comparison
- If a metric can't be computed (e.g., 0 edit turns), show `-` instead

---

## 5. File Structure

```
src/compare.tsx          -- Ink components: ModelSelector, ComparisonResults,
                            CompareView (top-level), loading state
src/compare-stats.ts     -- aggregateModelStats(), computeComparison(),
                            self-correction pattern matching, ModelStats type
src/cli.ts               -- new `compare` command registration
src/dashboard.tsx         -- add 'c' keybinding, CompareView integration
```

### compare-stats.ts

Pure data module, no UI. Exports:

```ts
function aggregateModelStats(projects: ProjectSummary[]): ModelStats[]
function computeComparison(a: ModelStats, b: ModelStats): ComparisonRow[]
```

The self-correction scanner needs raw assistant message text from JSONL files.
Two options: (a) extend the parser to expose message text on turns during
initial parse, or (b) have `compare-stats.ts` re-read JSONL files via provider
session discovery (same mechanism the parser uses). Option (a) is cleaner but
increases memory for all commands; option (b) is isolated to compare. The
implementation plan should decide.

### compare.tsx

Three Ink components:

- `ModelSelector` -- arrow navigation, spacebar toggle, enter to confirm
- `ComparisonResults` -- the formatted table with color-coded winners
- `CompareView` -- orchestrates the flow (selection -> loading -> results)

Exported `renderCompare()` function for the standalone command, and
`CompareView` component for embedding in the dashboard.

---

## 6. Dashboard Integration

### Status bar

Add `[c]ompare` to the status bar, after `[o]ptimize`:

```
  1-5 period  arrows switch  p provider  o optimize  c compare  q quit
```

### View state

Extend the existing `View` type:

```ts
type View = 'dashboard' | 'optimize' | 'compare'
```

Press `c` sets view to `'compare'`. Escape from compare returns to
`'dashboard'`. The compare view receives the already-parsed `projects`
from the dashboard state -- no re-parsing needed.

---

## 7. Edge Cases

- **Only one model in data**: Show message "Need at least 2 models to compare.
  Only found: claude-opus-4-6"
- **Model with 0 edit turns**: Show `-` for one-shot rate and retry rate
- **Model with < 20 calls**: Show "low data" warning on selection screen;
  allow selection but display a note on the results screen
- **Self-correction scanner fails to read JSONL**: Gracefully degrade --
  show `-` for self-correction rate, don't block the rest of the comparison
- **Both models have identical metrics**: Show "tie" instead of a winner
