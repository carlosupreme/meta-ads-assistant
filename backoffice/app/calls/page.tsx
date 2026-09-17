import Link from "next/link";
import { CallsTable } from "@/components/calls-table";
import { FEATURE_LABELS, RANGES, UUID, firstParam, formatNumber, resolveRange } from "@/lib/aggregate";
import { loadCalls, loadClients } from "@/lib/data";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const range = resolveRange(firstParam(query.range), new Date());
  const workspace = firstParam(query.workspace);
  const feature = firstParam(query.feature);
  const status = firstParam(query.status);
  const page = Math.max(1, Number.parseInt(firstParam(query.page) ?? "1", 10) || 1);
  const filters = {
    from: range.from,
    to: range.to,
    workspaceId: workspace && UUID.test(workspace) ? workspace : undefined,
    feature: feature && FEATURE_LABELS[feature] ? feature : undefined,
    status: status === "ok" || status === "error" ? status : undefined,
  };
  const [{ calls, total }, clients] = await Promise.all([loadCalls(filters, page, PAGE_SIZE), loadClients()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const baseParams = { range: range.key, workspace: filters.workspaceId, feature: filters.feature, status: filters.status };
  const pageHref = (target: number) => `/calls?${new URLSearchParams(Object.entries({ ...baseParams, page: String(target) }).filter((entry): entry is [string, string] => Boolean(entry[1])))}`;
  const exportHref = `/api/export?${new URLSearchParams(Object.entries(baseParams).filter((entry): entry is [string, string] => Boolean(entry[1])))}`;

  return <div className="page">
    <div className="page-head">
      <div><h1>Llamadas a OpenAI</h1><p>{formatNumber(total)} {total === 1 ? "llamada" : "llamadas"} con estos filtros, más recientes primero.</p></div>
      <a className="button" href={exportHref}>Descargar JSON</a>
    </div>
    <form className="filters form-filters" method="get">
      <label>Periodo<select name="range" defaultValue={range.key}>{RANGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label>Cliente<select name="workspace" defaultValue={filters.workspaceId ?? ""}><option value="">Todos</option>{clients.map((client) => <option key={client.workspaceId} value={client.workspaceId}>{client.email || client.workspaceId}</option>)}</select></label>
      <label>Función<select name="feature" defaultValue={filters.feature ?? ""}><option value="">Todas</option>{Object.entries(FEATURE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Estado<select name="status" defaultValue={filters.status ?? ""}><option value="">Todos</option><option value="ok">OK</option><option value="error">Error</option></select></label>
      <button type="submit" className="button">Filtrar</button>
    </form>
    <section className="panel"><CallsTable calls={calls}/></section>
    {pages > 1 && <nav className="pagination" aria-label="Páginas">
      {page > 1 ? <Link href={pageHref(page - 1)}>← Anterior</Link> : <span/>}
      <span>Página {page} de {pages}</span>
      {page < pages ? <Link href={pageHref(page + 1)}>Siguiente →</Link> : <span/>}
    </nav>}
  </div>;
}
