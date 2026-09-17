import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/calls-table";
import { FEATURE_LABELS, VIEW_LABELS, formatDateTime, formatDuration, formatNumber, formatUsd, labelFor } from "@/lib/aggregate";
import { loadCall } from "@/lib/data";

export const dynamic = "force-dynamic";

type Entry = { request?: unknown; response?: { output_text?: unknown } | null; result?: unknown; error?: unknown; trace?: unknown };

const json = (value: unknown) => JSON.stringify(value, null, 2);

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await loadCall(id);
  if (!found) notFound();
  const { call } = found;
  const entry = (found.entry ?? {}) as Entry;
  const outputText = typeof entry.response?.output_text === "string" ? entry.response.output_text : null;

  const facts: Array<[string, React.ReactNode]> = [
    ["Fecha", formatDateTime(call.createdAt)],
    ["Cliente", call.workspaceId ? <Link href={`/clients/${call.workspaceId}`}>{call.ownerEmail ?? call.workspaceId}</Link> : call.ownerEmail ?? "—"],
    ["Negocio", call.organizationName ?? "—"],
    ["Función", labelFor(FEATURE_LABELS, call.feature)],
    ["Página", `${labelFor(VIEW_LABELS, call.view)}${call.trigger === "cron" ? " (automático)" : ""}`],
    ["Ruta", call.route ?? "—"],
    ["Modelo", call.model],
    ["Estado", <StatusBadge key="status" status={call.status}/>],
    ["Duración", formatDuration(call.durationMs)],
    ["Tokens", `${formatNumber(call.inputTokens)} entrada (${formatNumber(call.cachedInputTokens)} en caché) · ${formatNumber(call.outputTokens)} salida (${formatNumber(call.reasoningTokens)} razonando)`],
    ["Costo estimado", `${formatUsd(call.costUsd)} USD`],
    ["ID de respuesta OpenAI", call.responseId ?? "—"],
  ];

  return <div className="page">
    <Link href="/calls" className="back">← Llamadas</Link>
    <div className="page-head">
      <div><h1>{labelFor(FEATURE_LABELS, call.feature)}</h1><p>{call.ownerEmail ?? "Sin cliente"} · {formatDateTime(call.createdAt)}</p></div>
      <a className="button" href={`/api/calls/${call.id}`}>Descargar JSON</a>
    </div>
    <section className="panel"><dl className="facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    {call.error && <section className="panel"><header className="panel-head"><h2>Error</h2></header><pre className="json">{json(entry.error ?? call.error)}</pre></section>}
    {outputText !== null && <section className="panel"><header className="panel-head"><h2>Texto devuelto por OpenAI</h2></header><pre className="json">{outputText}</pre></section>}
    <section className="panel"><header className="panel-head"><h2>Resultado usado por Pulso</h2><p>Lo que la app leyó de la respuesta.</p></header><pre className="json">{json(entry.result ?? null)}</pre></section>
    <details className="panel" open><summary className="panel-head"><h2>Respuesta completa de OpenAI</h2></summary><pre className="json">{json(entry.response ?? null)}</pre></details>
    <details className="panel"><summary className="panel-head"><h2>Solicitud enviada</h2></summary><pre className="json">{json(entry.request ?? null)}</pre></details>
  </div>;
}
