import { formatCompact, formatDuration, formatNumber, formatPercent, formatUsd, type Totals } from "@/lib/aggregate";

export function StatTiles({ totals }: { totals: Totals }) {
  const tiles = [
    { label: "Costo estimado", value: formatUsd(totals.costUsd), note: "USD, según precios de OpenAI" },
    { label: "Llamadas a OpenAI", value: formatNumber(totals.calls), note: totals.calls ? `${formatUsd(totals.costUsd / totals.calls)} por llamada` : "Sin llamadas" },
    { label: "Tokens", value: formatCompact(totals.totalTokens), note: `${formatCompact(totals.inputTokens)} entrada · ${formatCompact(totals.outputTokens)} salida (${formatCompact(totals.reasoningTokens)} razonando)` },
    { label: "Errores", value: formatNumber(totals.errors), note: totals.calls ? `${formatPercent(totals.errors, totals.calls)} de las llamadas` : "—" },
    { label: "Tiempo por llamada", value: totals.calls ? formatDuration(totals.durationMs / totals.calls) : "—", note: "promedio" },
  ];
  return <section className="tiles">
    {tiles.map((tile) => <div className="tile" key={tile.label}><span>{tile.label}</span><strong>{tile.value}</strong><small>{tile.note}</small></div>)}
  </section>;
}
