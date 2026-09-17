import Link from "next/link";
import { FEATURE_LABELS, VIEW_LABELS, formatDateTime, formatDuration, formatNumber, formatUsd, labelFor, type CallRow } from "@/lib/aggregate";

export function StatusBadge({ status }: { status: string }) {
  return status === "error"
    ? <span className="status error"><span aria-hidden="true">!</span> Error</span>
    : <span className="status ok"><span aria-hidden="true">✓</span> OK</span>;
}

/** Individual OpenAI calls; the date links to the full JSON. */
export function CallsTable({ calls, showClient = true }: { calls: CallRow[]; showClient?: boolean }) {
  return <div className="table-scroll"><table>
    <thead><tr>
      <th scope="col">Fecha</th>
      {showClient && <th scope="col">Cliente</th>}
      <th scope="col">Negocio</th>
      <th scope="col">Función</th>
      <th scope="col">Página</th>
      <th scope="col" className="num">Tokens</th>
      <th scope="col" className="num">Costo USD</th>
      <th scope="col" className="num">Duración</th>
      <th scope="col">Estado</th>
    </tr></thead>
    <tbody>
      {calls.length ? calls.map((call) => <tr key={call.id}>
        <td><Link href={`/calls/${call.id}`}>{formatDateTime(call.createdAt)}</Link></td>
        {showClient && <td>{call.ownerEmail ?? "—"}</td>}
        <td>{call.organizationName ?? "—"}</td>
        <td>{labelFor(FEATURE_LABELS, call.feature)}</td>
        <td>{labelFor(VIEW_LABELS, call.view)}{call.trigger === "cron" && <small className="cell-detail">Automático</small>}</td>
        <td className="num">{formatNumber(call.totalTokens)}</td>
        <td className="num">{formatUsd(call.costUsd)}</td>
        <td className="num">{formatDuration(call.durationMs)}</td>
        <td><StatusBadge status={call.status}/>{call.error && <small className="cell-detail">{call.error}</small>}</td>
      </tr>) : <tr><td colSpan={showClient ? 9 : 8} className="empty">No hay llamadas con estos filtros.</td></tr>}
    </tbody>
  </table></div>;
}
