import Link from "next/link";
import { formatCompact, formatDateTime, formatNumber, formatPercent, formatUsd, type Totals } from "@/lib/aggregate";

export interface UsageTableRow {
  key: string;
  label: string;
  detail?: string;
  href?: string;
  totals: Totals;
}

/** Usage broken down by one dimension. Compact tables drop token columns to fit side by side. */
export function UsageTable({ title, subtitle, labelHeader, rows, totalCost, compact = false }: {
  title: string; subtitle?: string; labelHeader: string; rows: UsageTableRow[]; totalCost: number; compact?: boolean;
}) {
  const columns = compact ? 4 : 8;
  return <section className="panel">
    <header className="panel-head"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>
    <div className="table-scroll"><table>
      <thead><tr>
        <th scope="col">{labelHeader}</th>
        <th scope="col" className="num">Llamadas</th>
        {!compact && <th scope="col" className="num">Errores</th>}
        {!compact && <th scope="col" className="num">Tokens entrada</th>}
        {!compact && <th scope="col" className="num">Tokens salida</th>}
        <th scope="col" className="num">Costo USD</th>
        <th scope="col" className="num">% del costo</th>
        {!compact && <th scope="col">Última llamada</th>}
      </tr></thead>
      <tbody>
        {rows.length ? rows.map((row) => <tr key={row.key}>
          <td>{row.href ? <Link href={row.href}>{row.label}</Link> : row.label}{row.detail && <small className="cell-detail">{row.detail}</small>}</td>
          <td className="num">{formatNumber(row.totals.calls)}</td>
          {!compact && <td className="num">{formatNumber(row.totals.errors)}</td>}
          {!compact && <td className="num">{formatCompact(row.totals.inputTokens)}</td>}
          {!compact && <td className="num">{formatCompact(row.totals.outputTokens)}</td>}
          <td className="num">{formatUsd(row.totals.costUsd)}</td>
          <td className="num">{formatPercent(row.totals.costUsd, totalCost)}</td>
          {!compact && <td>{formatDateTime(row.totals.lastCallAt)}</td>}
        </tr>) : <tr><td colSpan={columns} className="empty">Sin llamadas en este periodo.</td></tr>}
      </tbody>
    </table></div>
  </section>;
}
