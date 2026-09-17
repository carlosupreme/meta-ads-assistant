"use client";

import { useState } from "react";
import { formatAxisUsd, formatNumber, formatUsd, niceMax } from "@/lib/aggregate";

export interface DailyPoint {
  day: string;
  label: string;
  costUsd: number;
  calls: number;
}

const WIDTH = 760;
const HEIGHT = 220;
const PLOT = { left: 64, right: 12, top: 14, bottom: 28 };
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2;
const RADIUS = 4;
const MAX_X_LABELS = 10;

/** Column with a rounded data end at the top and a square end on the baseline. */
function columnPath(x: number, y: number, width: number, height: number): string {
  const radius = Math.min(RADIUS, width / 2, height);
  return `M${x},${y + height} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height} Z`;
}

/** Daily estimated cost: one series, so the panel title names it and no legend is drawn. */
export function DailyChart({ points }: { points: DailyPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const max = niceMax(Math.max(0, ...points.map((point) => point.costUsd)));
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, slot - BAR_GAP));
  const labelEvery = Math.ceil(points.length / MAX_X_LABELS);
  const y = (value: number) => PLOT.top + plotHeight - (value / max) * plotHeight;
  const current = active === null ? undefined : points[active];
  const hasCalls = points.some((point) => point.calls > 0);

  return <div className="chart">
    <div className="chart-frame">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Costo diario estimado en dólares" onPointerLeave={() => setActive(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <g key={fraction}>
          <line className={fraction === 0 ? "baseline" : "gridline"} x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y(max * fraction)} y2={y(max * fraction)}/>
          <text className="tick" x={PLOT.left - 10} y={y(max * fraction) + 4} textAnchor="end">{formatAxisUsd(max * fraction, max)}</text>
        </g>)}
        {points.map((point, index) => {
          const height = (point.costUsd / max) * plotHeight;
          const slotStart = PLOT.left + index * slot;
          return <g key={point.day}>
            {height > 0 && <path className={active === index ? "column active" : "column"} d={columnPath(slotStart + (slot - barWidth) / 2, PLOT.top + plotHeight - height, barWidth, height)}/>}
            {index % labelEvery === 0 && <text className="tick" x={slotStart + slot / 2} y={HEIGHT - 8} textAnchor="middle">{point.label}</text>}
            <rect className="hit" x={slotStart} y={PLOT.top} width={slot} height={plotHeight} tabIndex={0}
              aria-label={`${point.label}: ${formatUsd(point.costUsd)} en ${point.calls} llamadas`}
              onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}/>
          </g>;
        })}
      </svg>
      {current && active !== null && <div className="tooltip" style={{ left: `${((PLOT.left + active * slot + slot / 2) / WIDTH) * 100}%`, top: `${(y(current.costUsd) / HEIGHT) * 100}%` }}>
        <strong>{formatUsd(current.costUsd)}</strong>
        <span>{current.label} · {formatNumber(current.calls)} {current.calls === 1 ? "llamada" : "llamadas"}</span>
      </div>}
      {!hasCalls && <p className="chart-empty">Sin llamadas a OpenAI en este periodo.</p>}
    </div>
    <details className="chart-table">
      <summary>Ver como tabla</summary>
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">Día</th><th scope="col" className="num">Llamadas</th><th scope="col" className="num">Costo USD</th></tr></thead>
        <tbody>{points.map((point) => <tr key={point.day}><td>{point.label}</td><td className="num">{formatNumber(point.calls)}</td><td className="num">{formatUsd(point.costUsd)}</td></tr>)}</tbody>
      </table></div>
    </details>
  </div>;
}
