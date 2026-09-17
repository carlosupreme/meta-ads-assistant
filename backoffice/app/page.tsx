import { DailyChart } from "@/components/daily-chart";
import { RangeTabs } from "@/components/range-tabs";
import { StatTiles } from "@/components/stat-tiles";
import { UsageTable, type UsageTableRow } from "@/components/usage-table";
import {
  FEATURE_LABELS, VIEW_LABELS, dailySeries, emptyTotals, firstParam, formatDay, groupUsage, labelFor, resolveRange, sumRows,
} from "@/lib/aggregate";
import { loadClients, loadUsage } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const range = resolveRange(firstParam((await searchParams).range), new Date());
  const [usage, clients] = await Promise.all([loadUsage(range.from, range.to), loadClients()]);
  const totals = sumRows(usage);
  const byWorkspace = new Map(groupUsage(usage, (row) => row.workspaceId ?? "sin-espacio").map((group) => [group.key, group]));
  const known = new Set(clients.map((client) => client.workspaceId));

  const clientRows: UsageTableRow[] = [
    ...clients.map((client) => ({
      key: client.workspaceId,
      label: client.email || client.name || client.workspaceId,
      detail: `${client.businesses.length ? client.businesses.join(", ") : "Sin cuentas publicitarias"} · ${client.metaConnected ? "Meta conectado" : "Meta sin conectar"}`,
      href: `/clients/${client.workspaceId}?range=${range.key}`,
      totals: byWorkspace.get(client.workspaceId)?.totals ?? emptyTotals(),
    })),
    // Calls whose workspace was deleted still count toward the period.
    ...[...byWorkspace.values()].filter((group) => !known.has(group.key)).map((group) => ({
      key: group.key, label: group.rows[0]?.ownerEmail ?? "Espacio eliminado", detail: "El espacio ya no existe", totals: group.totals,
    })),
  ].sort((a, b) => b.totals.costUsd - a.totals.costUsd || b.totals.calls - a.totals.calls);

  const features = groupUsage(usage, (row) => row.feature).map((group) => ({ key: group.key, label: labelFor(FEATURE_LABELS, group.key), totals: group.totals }));
  const views = groupUsage(usage, (row) => row.view ?? "").map((group) => ({ key: group.key || "none", label: labelFor(VIEW_LABELS, group.key || null), totals: group.totals }));
  const series = dailySeries(usage, range.from, range.to).map(({ day, totals: day_totals }) => ({ day, label: formatDay(day), costUsd: day_totals.costUsd, calls: day_totals.calls }));

  return <div className="page">
    <div className="page-head">
      <div><h1>Consumo de IA</h1><p>{clients.length} {clients.length === 1 ? "cliente" : "clientes"} · {formatDay(range.from)} al {formatDay(range.to)}, hora de Ciudad de México</p></div>
      <a className="button" href={`/api/export?range=${range.key}`}>Descargar JSON</a>
    </div>
    <div className="filters"><RangeTabs active={range.key} basePath="/"/></div>
    <StatTiles totals={totals}/>
    <section className="panel">
      <header className="panel-head"><h2>Costo diario</h2><p>USD estimado por día. Pasa el cursor sobre una barra para ver las llamadas.</p></header>
      <DailyChart points={series}/>
    </section>
    <UsageTable title="Consumo por cliente" subtitle="Cada usuario de Pulso con sus cuentas publicitarias." labelHeader="Cliente" rows={clientRows} totalCost={totals.costUsd}/>
    <div className="two-col">
      <UsageTable title="Por función" labelHeader="Función" rows={features} totalCost={totals.costUsd} compact/>
      <UsageTable title="Por página" labelHeader="Página" rows={views} totalCost={totals.costUsd} compact/>
    </div>
  </div>;
}
