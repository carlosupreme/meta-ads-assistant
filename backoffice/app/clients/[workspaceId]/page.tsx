import Link from "next/link";
import { notFound } from "next/navigation";
import { CallsTable } from "@/components/calls-table";
import { DailyChart } from "@/components/daily-chart";
import { RangeTabs } from "@/components/range-tabs";
import { StatTiles } from "@/components/stat-tiles";
import { UsageTable } from "@/components/usage-table";
import {
  FEATURE_LABELS, UUID, VIEW_LABELS, dailySeries, firstParam, formatDateTime, formatDay, groupUsage, labelFor, resolveRange, sumRows,
} from "@/lib/aggregate";
import { loadCalls, loadClients, loadUsage } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  if (!UUID.test(workspaceId)) notFound();
  const range = resolveRange(firstParam((await searchParams).range), new Date());
  const filters = { from: range.from, to: range.to, workspaceId };
  const [usage, clients, recent] = await Promise.all([loadUsage(range.from, range.to, workspaceId), loadClients(), loadCalls(filters, 1, 20)]);
  const client = clients.find((item) => item.workspaceId === workspaceId);
  if (!client && !usage.length) notFound();

  const totals = sumRows(usage);
  const byBusiness = groupUsage(usage, (row) => row.organizationName ?? "").map((group) => ({ key: group.key || "none", label: group.key || "Sin negocio", totals: group.totals }));
  const features = groupUsage(usage, (row) => row.feature).map((group) => ({ key: group.key, label: labelFor(FEATURE_LABELS, group.key), totals: group.totals }));
  const views = groupUsage(usage, (row) => row.view ?? "").map((group) => ({ key: group.key || "none", label: labelFor(VIEW_LABELS, group.key || null), totals: group.totals }));
  const series = dailySeries(usage, range.from, range.to).map(({ day, totals: day_totals }) => ({ day, label: formatDay(day), costUsd: day_totals.costUsd, calls: day_totals.calls }));
  const title = client?.email || usage[0]?.ownerEmail || workspaceId;

  return <div className="page">
    <Link href={`/?range=${range.key}`} className="back">← Todos los clientes</Link>
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{client
          ? `${client.name ? `${client.name} · ` : ""}${client.businesses.length ? client.businesses.join(", ") : "Sin cuentas publicitarias"} · ${client.metaConnected ? "Meta conectado" : "Meta sin conectar"} · cliente desde ${formatDateTime(client.createdAt)}`
          : "El espacio ya no existe; se muestran sus llamadas registradas."}</p>
      </div>
      <a className="button" href={`/api/export?range=${range.key}&workspace=${workspaceId}`}>Descargar JSON</a>
    </div>
    <div className="filters"><RangeTabs active={range.key} basePath={`/clients/${workspaceId}`}/></div>
    <StatTiles totals={totals}/>
    <section className="panel">
      <header className="panel-head"><h2>Costo diario</h2><p>USD estimado por día para este cliente.</p></header>
      <DailyChart points={series}/>
    </section>
    <UsageTable title="Por negocio" subtitle="Cuenta publicitaria para la que se hizo cada llamada." labelHeader="Negocio" rows={byBusiness} totalCost={totals.costUsd}/>
    <div className="two-col">
      <UsageTable title="Por función" labelHeader="Función" rows={features} totalCost={totals.costUsd} compact/>
      <UsageTable title="Por página" labelHeader="Página" rows={views} totalCost={totals.costUsd} compact/>
    </div>
    <section className="panel">
      <header className="panel-head row">
        <div><h2>Últimas llamadas</h2><p>{recent.total} en el periodo. Abre una para ver la respuesta exacta de OpenAI.</p></div>
        <Link href={`/calls?workspace=${workspaceId}&range=${range.key}`}>Ver todas →</Link>
      </header>
      <CallsTable calls={recent.calls} showClient={false}/>
    </section>
  </div>;
}
