"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Bell, Bot, BrainCircuit,
  CalendarDays, Check, ChevronDown, ChevronRight, CircleDollarSign, CircleGauge, Eye, Facebook,
  Copy, FileText, Gauge, Image as ImageIcon, Instagram, LayoutDashboard, Lightbulb, Link2, LoaderCircle, LogOut, Megaphone,
  MessageCircle, MoreHorizontal, Pause, Play, Plus, RefreshCcw, Rocket, Search, Settings,
  Send, ShieldCheck, SlidersHorizontal, Sparkles, Target, TrendingUp, UserRound, WandSparkles, X, Zap,
} from "lucide-react";
import type { Ad, AgentAction, AutomationMode, Campaign, MetricPoint, NavView, Organization } from "@/lib/types";
import { MODE_LABELS } from "@/lib/types";
import type { AiStatus } from "@/lib/ai/contracts";
import { accountHealth, describeAction, lastStatusChanges, monitoringSummary, projectedMonthSpend, targetRoas, type MonitoringSummary } from "@/lib/optimizer";
import type { SafeWorkspace } from "@/lib/safe-workspace";

type Decision = "approve" | "reject" | "resume";

async function fetchAiStatus(): Promise<{ status: AiStatus; models: string[] } | null> {
  try {
    const response = await fetch("/api/ai/status", { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return iso;
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 60 * 24) return `Hace ${Math.round(minutes / 60)} h`;
  return `Hace ${Math.round(minutes / (60 * 24))} d`;
}

/** Percent change between the older and newer half of the chart window. */
function periodTrend(metrics: MetricPoint[], key: "spend" | "revenue" | "roas"): number | null {
  if (metrics.length < 4) return null;
  const half = Math.floor(metrics.length / 2);
  const aggregate = (points: MetricPoint[]) => {
    const spend = points.reduce((sum, point) => sum + point.spend, 0);
    const revenue = points.reduce((sum, point) => sum + point.revenue, 0);
    return key === "roas" ? (spend ? revenue / spend : 0) : key === "spend" ? spend : revenue;
  };
  const previous = aggregate(metrics.slice(0, half));
  const recent = aggregate(metrics.slice(-half));
  return previous ? ((recent - previous) / previous) * 100 : null;
}

const ACTION_STATUS: Record<AgentAction["status"], { label: string; badge: string }> = {
  executed: { label: "Ejecutado", badge: "active" },
  pending: { label: "Pendiente", badge: "draft" },
  executing: { label: "En curso", badge: "draft" },
  recommended: { label: "Sugerido", badge: "paused" },
  rejected: { label: "Rechazado", badge: "paused" },
  expired: { label: "Expirado", badge: "paused" },
  blocked: { label: "Bloqueado", badge: "blocked" },
  failed: { label: "Falló", badge: "blocked" },
};

const money = (value: number, compact = false) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", maximumFractionDigits: 0, notation: compact ? "compact" : "standard",
}).format(value);

const navItems: Array<{ id: NavView; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Resumen", icon: LayoutDashboard },
  { id: "campaigns", label: "Campañas", icon: Megaphone },
  { id: "agents", label: "Agentes IA", icon: BrainCircuit },
  { id: "creatives", label: "Creativos", icon: ImageIcon },
  { id: "alerts", label: "Alertas", icon: Bell },
  { id: "reports", label: "Reportes", icon: FileText },
];

const lowerNav: Array<{ id: NavView; label: string; icon: typeof Settings }> = [
  { id: "connections", label: "Conexiones", icon: Zap },
  { id: "settings", label: "Configuración", icon: Settings },
];

const viewTitles: Record<NavView, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "CENTRO DE CONTROL", title: "Resumen" },
  campaigns: { eyebrow: "RENDIMIENTO", title: "Campañas" },
  agents: { eyebrow: "AUTOMATIZACIÓN", title: "Agentes IA" },
  creatives: { eyebrow: "LABORATORIO", title: "Creativos" },
  alerts: { eyebrow: "MONITOREO", title: "Alertas" },
  reports: { eyebrow: "CLIENTES", title: "Reportes" },
  connections: { eyebrow: "INTEGRACIONES", title: "Conexiones" },
  settings: { eyebrow: "PREFERENCIAS", title: "Configuración" },
};

const agentMeta = {
  Supervisor: { icon: ShieldCheck, color: "violet", description: "Coordina acciones y hace cumplir tus límites." },
  Estratega: { icon: Target, color: "blue", description: "Diseña campañas y encuentra oportunidades." },
  Analista: { icon: Activity, color: "cyan", description: "Interpreta rendimiento y detecta anomalías." },
  Presupuesto: { icon: CircleDollarSign, color: "green", description: "Distribuye inversión hacia lo que funciona." },
  Audiencias: { icon: UserRound, color: "orange", description: "Prueba segmentos y controla la fatiga." },
  Creativos: { icon: WandSparkles, color: "pink", description: "Produce y prueba variantes de anuncios." },
} as const;

export function AppShell({ initialData, account }: { initialData: SafeWorkspace; account: { name: string; email: string } }) {
  const [data, setData] = useState(initialData);
  const [view, setView] = useState<NavView>("dashboard");
  const [organizationId, setOrganizationId] = useState(initialData.organizations[0]?.id || "");
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [campaignModal, setCampaignModal] = useState(false);
  const [modeModal, setModeModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiModels, setAiModels] = useState<string[]>([]);
  const organization = data.organizations.find((item) => item.id === organizationId) || data.organizations[0];
  const campaigns = data.campaigns.filter((item) => item.organizationId === organization?.id);
  const activities = data.activities.filter((item) => item.organizationId === organization?.id);
  const alerts = data.alerts.filter((item) => item.organizationId === organization?.id);
  const creatives = data.creatives.filter((item) => item.organizationId === organization?.id);
  const ads = data.ads.filter((item) => item.organizationId === organization?.id);
  const actions = data.actions.filter((item) => item.organizationId === organization?.id);
  const pendingCount = actions.filter((item) => item.status === "pending").length;
  const metrics = data.metrics[organization?.id] || [];
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("connection");
    const messages: Record<string, string> = {
      success: "Meta se conectó y sincronizó correctamente.",
      "missing-config": "Configura META_APP_ID y META_APP_SECRET para conectar Meta.",
      denied: "Cancelaste la conexión con Meta.",
      "invalid-state": "La sesión de conexión expiró. Intenta de nuevo.",
      error: "Meta no pudo completar la conexión. Revisa la configuración.",
    };
    if (status && messages[status]) {
      setToast(messages[status]);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    fetchAiStatus().then((result) => {
      if (!result) return;
      setAiStatus(result.status);
      setAiModels(result.models);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function refreshWorkspace() {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }

  async function runAnalysis() {
    setRunning(true);
    try {
      const response = await fetch("/api/agents/run", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await refreshWorkspace();
      setToast(result.summary);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo ejecutar el análisis");
    } finally { setRunning(false); }
  }

  async function syncMeta() {
    setSyncing(true);
    try {
      const response = await fetch("/api/meta/sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await refreshWorkspace();
      setToast(result.message || "Datos sincronizados con Meta.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo sincronizar");
    } finally { setSyncing(false); }
  }

  async function updateMode(mode: AutomationMode) {
    const response = await fetch("/api/workspace", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "organization", organizationId: organization.id, mode }),
    });
    if (response.ok) setData(await response.json());
    setModeModal(false);
    setToast(`Modo ${MODE_LABELS[mode]} activado.`);
  }

  /** Manual changes on campaigns and ads: applied on Meta and logged as the user's. */
  async function control(body: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch("/api/control", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (result.workspace) setData(result.workspace);
      setToast(result.message || result.error || "No fue posible aplicar el cambio.");
      return response.ok;
    } catch {
      setToast("No fue posible aplicar el cambio.");
      return false;
    }
  }

  function toggleCampaign(campaign: Campaign) {
    void control({ kind: "campaign-status", campaignId: campaign.id, status: campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE" });
  }

  async function decideAction(actionId: string, decision: Decision) {
    setDecidingId(actionId);
    try {
      const response = await fetch("/api/actions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actionId, decision }),
      });
      const result = await response.json();
      await refreshWorkspace();
      setToast(result.message || result.error || "No fue posible resolver la propuesta");
    } catch {
      setToast("No fue posible resolver la propuesta");
    } finally { setDecidingId(null); }
  }

  async function readAlert(alertId: string) {
    const response = await fetch("/api/workspace", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "alert-read", alertId }),
    });
    if (response.ok) setData(await response.json());
  }

  if (!organization) {
    const connected = data.metaConnection.status === "connected";
    return <div className="empty-state"><div className="panel empty-large no-accounts">
      <Megaphone size={30}/>
      <h3>{connected ? "No encontramos cuentas publicitarias" : "Conecta tus cuentas de Meta"}</h3>
      <p>{connected ? "Tu usuario de Meta no tiene cuentas publicitarias o no autorizaste ninguna. Revisa los permisos y vuelve a conectar." : "Pulso importará tus cuentas publicitarias, campañas y anuncios."}</p>
      <div className="empty-actions">
        <a className="primary-button" href="/api/meta/connect"><Zap size={16}/> Conectar con Meta</a>
        <form action="/auth/signout" method="post"><button className="secondary-button">Cerrar sesión</button></form>
      </div>
    </div></div>;
  }

  const weekSummary = monitoringSummary(data, organization.id, new Date());

  const pageContent: Record<NavView, React.ReactNode> = {
    dashboard: <DashboardView organization={organization} campaigns={campaigns} activities={activities} alerts={alerts} actions={actions} metrics={metrics} summary={weekSummary} onRun={runAnalysis} running={running} onNavigate={setView} />,
    campaigns: <CampaignsView campaigns={campaigns} ads={ads} onToggle={toggleCampaign} onControl={control} onAdCreated={(workspace, message) => { setData(workspace); setToast(message); }} onCreate={() => setCampaignModal(true)} />,
    agents: <AgentsView organization={organization} activities={activities} actions={actions} decidingId={decidingId} onDecide={decideAction} running={running} onRun={runAnalysis} onMode={() => setModeModal(true)} aiStatus={aiStatus} />,
    creatives: <CreativesView creatives={creatives} onCreate={() => setCampaignModal(true)} />,
    alerts: <AlertsView alerts={alerts} onRead={readAlert} />,
    reports: <ReportsView key={organization.id} organization={organization} branding={data.branding} setToast={setToast} onSaved={refreshWorkspace} />,
    connections: <ConnectionsView data={data} syncing={syncing} onSync={syncMeta} setToast={setToast} />,
    settings: <SettingsView key={organization.id} organization={organization} aiStatus={aiStatus} aiModels={aiModels} onAiModelSaved={async (message) => { const result = await fetchAiStatus(); if (result) { setAiStatus(result.status); setAiModels(result.models); } setToast(message); }} onSaved={async () => { await refreshWorkspace(); setToast("Configuración guardada."); }} />,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><span>PULSO</span><span className="ai-pill">AI</span></div>
        <div className="side-label">ESPACIO DE TRABAJO</div>
        <div className="org-picker-wrap">
          <button className="org-picker" onClick={() => setOrganizationOpen((open) => !open)}>
            <span className="org-avatar" style={{ background: organization.color }}>{organization.initials}</span>
            <span><b>{organization.name}</b><small>{organization.objective}</small></span><ChevronDown size={15} />
          </button>
          {organizationOpen && <div className="org-menu">
            {data.organizations.map((org) => <button key={org.id} onClick={() => { setOrganizationId(org.id); setOrganizationOpen(false); }}>
              <span className="org-avatar small" style={{ background: org.color }}>{org.initials}</span><span>{org.name}</span>{org.id === organization.id && <Check size={15} />}
            </button>)}
            <button className="add-org"><Plus size={15} /> Conectar otro negocio</button>
          </div>}
        </div>
        <nav>
          <div className="side-label">NAVEGACIÓN</div>
          {navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
            <item.icon size={18} /><span>{item.label}</span>
            {item.id === "alerts" && alerts.filter((alert) => !alert.read).length > 0 && <em>{alerts.filter((alert) => !alert.read).length}</em>}
            {item.id === "agents" && pendingCount > 0 && <em title="Propuestas esperando aprobación">{pendingCount}</em>}
          </button>)}
          <div className="nav-divider" />
          {lowerNav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><item.icon size={18} /><span>{item.label}</span></button>)}
        </nav>
        <div className="agent-mini-card">
          <div className="agent-mini-head"><span className="live-dot" /><span>Agentes activos</span><b>6</b></div>
          <p suppressHydrationWarning>{weekSummary.lastRunAt ? `Última revisión ${timeAgo(weekSummary.lastRunAt).toLowerCase()} · ${weekSummary.runs} esta semana` : "Tu cuenta está siendo monitoreada."}</p>
          <button onClick={() => setView("agents")}>Ver actividad <ChevronRight size={14} /></button>
        </div>
        <div className="user-card">
          <div className="user-avatar">{account.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</div>
          <span><b>{account.name}</b><small>{account.email}</small></span>
          <form action="/auth/signout" method="post"><button className="sign-out" title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={16} /></button></form>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><span className="eyebrow">{viewTitles[view].eyebrow}</span><h1>{viewTitles[view].title}</h1></div>
          <div className="top-actions">
            <div className={`connection-chip ${data.metaConnection.status}`}><span />{data.metaConnection.status === "connected" ? "Meta conectado" : data.metaConnection.status === "demo" ? "Modo demo" : "Sin conexión"}</div>
            <button className="date-button"><CalendarDays size={16} /> Últimos 14 días <ChevronDown size={14} /></button>
            <button className="icon-button" onClick={() => setView("alerts")}><Bell size={18} />{alerts.some((alert) => !alert.read) && <i />}</button>
            <button className="primary-button" onClick={() => setCampaignModal(true)}><Plus size={17} /> Nueva campaña</button>
          </div>
        </header>
        <div className="content">{pageContent[view]}</div>
      </main>

      {campaignModal && <CampaignModal organization={organization} connected={data.metaConnection.status === "connected"} defaultPublish={organization.mode === "autonomous" || organization.mode === "yolo"} onClose={() => setCampaignModal(false)} onCreated={async (message) => { setCampaignModal(false); await refreshWorkspace(); setView("campaigns"); setToast(message); }} />}
      {modeModal && <ModeModal current={organization.mode} onClose={() => setModeModal(false)} onSelect={updateMode} />}
      {toast && <div className="toast"><Check size={17} />{toast}<button onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  );
}

function ValueStrip({ summary, limit }: { summary: MonitoringSummary; limit: number }) {
  if (!summary.runs) {
    return <section className="value-strip"><ShieldCheck size={18}/><p><b>Pulso empezará a vigilar tu cuenta en el próximo ciclo</b><span>Cada revisión quedará registrada aquí, aunque no haga falta cambiar nada.</span></p></section>;
  }
  const quiet = !summary.anomalies && !summary.blocked && !summary.executed;
  return <section className="value-strip">
    <ShieldCheck size={18}/>
    <p><b>{quiet ? "Semana tranquila: todo dentro de tus metas" : "Pulso cuidó tu cuenta esta semana"}</b><span suppressHydrationWarning>Última revisión {summary.lastRunAt ? timeAgo(summary.lastRunAt).toLowerCase() : "pendiente"}</span></p>
    <div><strong>{summary.runs}</strong><small>revisiones</small></div>
    <div><strong>{summary.adsWatched}</strong><small>anuncios vigilados</small></div>
    <div><strong>{summary.pacingChecks}</strong><small>verificaciones de ritmo</small></div>
    <div><strong>{summary.anomalies}</strong><small>señales de riesgo</small></div>
    <div><strong>{money(limit, true)}</strong><small>límite protegido</small></div>
  </section>;
}

function FundingStrip({ organization }: { organization: Organization }) {
  const funding = organization.funding;
  if (!funding) return null;
  const empty = funding.prepaid && funding.availableBalance === 0;
  const title = !funding.prepaid ? "Cuenta con pago automático"
    : funding.availableBalance !== undefined ? `Saldo disponible: ${money(funding.availableBalance)}` : "Cuenta de prepago";
  const detail = empty ? "Meta reporta $0 de saldo: los anuncios no se entregarán hasta que acredite tu recarga."
    : funding.paymentMethod ?? "Método de pago configurado en Meta";
  return <section className={`funding-strip ${empty ? "empty" : ""}`}>
    <CircleDollarSign size={18}/>
    <p><b>{title}</b><span suppressHydrationWarning>{detail} · Según Meta, actualizado {timeAgo(funding.syncedAt).toLowerCase()}</span></p>
    {funding.spendCap > 0 && <div><strong>{money(funding.spendCap)}</strong><small>tope de gasto de la cuenta</small></div>}
  </section>;
}

function DashboardView({ organization, campaigns, activities, alerts, actions, metrics, summary, onRun, running, onNavigate }: {
  organization: Organization; campaigns: Campaign[]; activities: SafeWorkspace["activities"]; alerts: SafeWorkspace["alerts"];
  actions: AgentAction[]; metrics: MetricPoint[]; summary: MonitoringSummary; onRun: () => void; running: boolean; onNavigate: (view: NavView) => void;
}) {
  const now = new Date();
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "ACTIVE");
  const active = activeCampaigns.length;
  const results = campaigns.reduce((sum, campaign) => sum + campaign.results, 0);
  const roas = organization.spentThisMonth ? organization.revenueThisMonth / organization.spentThisMonth : 0;
  const target = targetRoas(organization);
  const returnValue = organization.revenueThisMonth - organization.spentThisMonth;
  const budgetPercent = Math.min(100, Math.round((organization.spentThisMonth / organization.monthlyLimit) * 100));
  const health = accountHealth(organization, campaigns, actions, now);
  const projection = projectedMonthSpend(organization, campaigns, now);
  const overPace = projection > organization.monthlyLimit;
  const pending = actions.filter((action) => action.status === "pending").length;
  const revenueTrend = periodTrend(metrics, "revenue");
  const ranked = [...activeCampaigns].filter((campaign) => campaign.spend > 0).sort((a, b) => b.roas - a.roas);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked.at(-1) : undefined;
  const latestAction = actions.find((action) => action.status !== "blocked");
  const pulseTitle = pending ? `${pending} ${pending === 1 ? "cambio espera" : "cambios esperan"} tu aprobación`
    : overPace ? "El ritmo de gasto supera tu límite"
      : roas >= target ? "Buen momento para escalar" : "El retorno está por debajo de la meta";
  const insights = [
    best && { icon: ArrowUpRight, color: "green", title: `${best.name} destaca`, detail: `${best.roas.toFixed(2)}× ROAS · mejor campaña activa` },
    worst && worst.roas < target && { icon: AlertCircle, color: "orange", title: `${worst.name} requiere atención`, detail: `${worst.roas.toFixed(2)}× frente a la meta de ${target.toFixed(2)}×` },
    latestAction && { icon: Lightbulb, color: "violet", title: capitalize(describeAction(latestAction)), detail: `${ACTION_STATUS[latestAction.status].label} · ${latestAction.agent}` },
  ].filter((item): item is { icon: typeof ArrowUpRight; color: string; title: string; detail: string } => Boolean(item));
  return <>
    <section className="welcome-row">
      <div><h2>Hola, {organization.name} <span>👋</span></h2><p>Esto es lo que está pasando con tu publicidad hoy.</p></div>
      <button className="run-button" onClick={onRun} disabled={running}>{running ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} {running ? "Analizando…" : "Analizar ahora"}</button>
    </section>

    <section className="health-banner">
      <div className="health-icon"><TrendingUp size={24} /></div>
      <div className="health-copy"><span>ESTADO DE TU INVERSIÓN</span><h3>{returnValue >= 0 ? "Tu publicidad está generando retorno" : "Tu publicidad necesita atención"}</h3><p>Por cada $1 invertido, Meta reporta <b>${roas.toFixed(2)}</b> en ingresos.</p></div>
      <div className="return-amount"><span>RETORNO DESPUÉS DE ADS</span><strong>{money(returnValue)}</strong>{revenueTrend !== null && <small>{revenueTrend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {revenueTrend >= 0 ? "+" : ""}{revenueTrend.toFixed(1)}% ingresos vs. periodo anterior</small>}</div>
      <div className="health-score"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="16" /><circle className="progress" cx="21" cy="21" r="16" strokeDasharray={`${health} 100`} /></svg><b>{health}</b><span>Salud</span></div>
    </section>

    <section className="metric-grid">
      <MetricCard label="Inversión" value={money(organization.spentThisMonth)} note={`${budgetPercent}% de ${money(organization.monthlyLimit)}`} trend={periodTrend(metrics, "spend")} icon={CircleDollarSign} color="violet" progress={budgetPercent} />
      <MetricCard label="Ingresos atribuidos" value={money(organization.revenueThisMonth)} note="Reportado por Meta" trend={revenueTrend} icon={TrendingUp} color="green" />
      <MetricCard label="ROAS" value={`${roas.toFixed(2)}×`} note={`Meta de la cuenta: ${target.toFixed(2)}×`} trend={periodTrend(metrics, "roas")} icon={CircleGauge} color="blue" />
      <MetricCard label="Resultados" value={String(Math.round(results))} note={`${active} campañas activas`} trend={null} icon={Target} color="orange" />
    </section>

    <ValueStrip summary={summary} limit={organization.monthlyLimit} />
    <FundingStrip organization={organization} />

    <section className="dashboard-grid">
      <div className="panel performance-panel">
        <PanelHeader title="Rendimiento" subtitle="Ingresos e inversión publicitaria" action={<button className="ghost-select">Ingresos vs. inversión <ChevronDown size={14} /></button>} />
        <div className="chart-legend"><span><i className="revenue" /> Ingresos</span><span><i className="spend" /> Inversión</span></div>
        <div className="chart-wrap"><PerformanceChart metrics={metrics}/></div>
      </div>
      <div className="panel pulse-panel">
        <PanelHeader title="Pulso IA" subtitle="Lectura rápida de tu cuenta" action={<span className="ai-live"><i /> EN VIVO</span>} />
        <div className="pulse-score"><div className="pulse-orb"><Sparkles size={22} /></div><div><strong>{pulseTitle}</strong><p>Proyección del mes: {money(projection)} de {money(organization.monthlyLimit)}{overPace ? ". Los agentes ajustarán el ritmo." : "."}</p></div></div>
        <div className="insight-list">
          {insights.length ? insights.map((insight) => <div key={insight.title}><span className={`insight-icon ${insight.color}`}><insight.icon size={15}/></span><p><b>{insight.title}</b><small>{insight.detail}</small></p></div>)
            : <div><span className="insight-icon violet"><Lightbulb size={15}/></span><p><b>Aún no hay suficientes datos</b><small>Ejecuta un análisis cuando tus campañas tengan gasto.</small></p></div>}
        </div>
        <button className="text-button" onClick={() => onNavigate("agents")}>Ver análisis completo <ChevronRight size={15}/></button>
      </div>
    </section>

    <section className="dashboard-grid lower">
      <div className="panel campaign-panel"><PanelHeader title="Campañas activas" subtitle={`${active} campañas generando resultados`} action={<button className="text-button" onClick={() => onNavigate("campaigns")}>Ver todas <ChevronRight size={14}/></button>} /><CampaignTable campaigns={campaigns.slice(0, 4)} compact /></div>
      <div className="panel activity-panel"><PanelHeader title="Actividad de agentes" subtitle="Últimas decisiones y hallazgos" action={<button className="icon-plain"><MoreHorizontal size={18}/></button>} /><ActivityList activities={activities.slice(0, 4)} /></div>
    </section>
    {alerts.some((alert) => !alert.read) && <button className="floating-alert" onClick={() => onNavigate("alerts")}><Bell size={16}/><span>{alerts.filter((a) => !a.read).length} alertas requieren tu atención</span><ChevronRight size={15}/></button>}
  </>;
}

function PerformanceChart({ metrics }: { metrics: SafeWorkspace["metrics"][string] }) {
  const width = 720;
  const height = 190;
  const plot = { left: 52, right: 12, top: 10, bottom: 27 };
  const chartWidth = width - plot.left - plot.right;
  const chartHeight = height - plot.top - plot.bottom;
  const maxValue = Math.max(20000, ...metrics.flatMap((point) => [point.revenue, point.spend]));
  const roundMax = Math.ceil(maxValue / 5000) * 5000;
  const points = (key: "revenue" | "spend") => metrics.map((point, index) => {
    const x = plot.left + (index / Math.max(metrics.length - 1, 1)) * chartWidth;
    const y = plot.top + chartHeight - (point[key] / roundMax) * chartHeight;
    return [x, y] as const;
  });
  const revenuePoints = points("revenue");
  const spendPoints = points("spend");
  const line = (values: ReadonlyArray<readonly [number, number]>) => values.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = (values: ReadonlyArray<readonly [number, number]>) => values.length ? `${line(values)} L${values.at(-1)?.[0]},${plot.top + chartHeight} L${values[0][0]},${plot.top + chartHeight} Z` : "";
  const levels = [0, .25, .5, .75, 1];
  return <svg className="performance-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfica de ingresos e inversión">
    <defs><linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#765cf6" stopOpacity=".28"/><stop offset="100%" stopColor="#765cf6" stopOpacity="0"/></linearGradient><linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#20b486" stopOpacity=".16"/><stop offset="100%" stopColor="#20b486" stopOpacity="0"/></linearGradient></defs>
    {levels.map((level) => { const y = plot.top + chartHeight * (1 - level); return <g key={level}><line x1={plot.left} x2={width - plot.right} y1={y} y2={y} stroke="#e8e9ef" strokeDasharray="4 5"/><text x={plot.left - 9} y={y + 3} textAnchor="end" fill="#9697a1" fontSize="11">${Math.round((roundMax * level) / 1000)}k</text></g>; })}
    <path d={area(revenuePoints)} fill="url(#revenueGradient)"/><path d={area(spendPoints)} fill="url(#spendGradient)"/><path d={line(revenuePoints)} fill="none" stroke="#765cf6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/><path d={line(spendPoints)} fill="none" stroke="#20b486" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
    {revenuePoints.map(([x, y], index) => <circle key={`r-${index}`} cx={x} cy={y} r="2.4" fill="#fff" stroke="#765cf6" strokeWidth="1.5"/>)}
    {metrics.map((point, index) => { const x = plot.left + (index / Math.max(metrics.length - 1, 1)) * chartWidth; return <text key={point.date} x={x} y={height - 6} textAnchor="middle" fill="#8b8d98" fontSize="11">{point.date}</text>; })}
  </svg>;
}

function MetricCard({ label, value, note, trend, icon: Icon, color, progress }: { label: string; value: string; note: string; trend: number | null; icon: typeof Target; color: string; progress?: number }) {
  return <div className="metric-card"><div className={`metric-icon ${color}`}><Icon size={19}/></div>{trend !== null && <div className={`metric-trend ${trend >= 0 ? "positive" : "negative"}`}>{trend >= 0 ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>}{trend >= 0 ? "+" : ""}{trend.toFixed(1)}%</div>}<span className="metric-label">{label}</span><strong>{value}</strong><p>{note}</p>{progress !== undefined && <div className="tiny-progress"><i style={{ width: `${progress}%` }}/></div>}</div>;
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="panel-header"><div><h3>{title}</h3><p>{subtitle}</p></div>{action}</div>;
}

type ControlRequest = (body: Record<string, unknown>) => Promise<boolean>;
type AdCreatedHandler = (workspace: SafeWorkspace, message: string) => void;

function CampaignTable({ campaigns, compact = false, onToggle, ads, onControl, onAdCreated }: { campaigns: Campaign[]; compact?: boolean; onToggle?: (campaign: Campaign) => void; ads?: Ad[]; onControl?: ControlRequest; onAdCreated?: AdCreatedHandler }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!campaigns.length) return <div className="empty-panel"><Megaphone size={24}/><b>Aún no hay campañas</b><span>Crea la primera con ayuda de los agentes.</span></div>;
  return <div className={`campaign-table ${compact ? "compact" : ""}`}>
    <div className="campaign-row table-head"><span>CAMPAÑA</span><span>ESTADO</span><span>INVERSIÓN</span><span>RESULTADOS</span><span>ROAS</span>{!compact && <span>PRESUPUESTO</span>}<span /></div>
    {campaigns.map((campaign) => {
      const open = expanded === campaign.id;
      const editableBudget = Boolean(onControl) && campaign.status !== "DRAFT" && campaign.budgetLevel !== "none" && campaign.dailyBudget > 0;
      return <Fragment key={campaign.id}>
        <div className={`campaign-row ${open ? "expanded" : ""}`}>
          <div className="campaign-name">
            {ads && <button className="expand-button" aria-expanded={open} title={open ? "Ocultar anuncios" : "Ver anuncios"} onClick={() => setExpanded(open ? null : campaign.id)}><ChevronRight size={15}/></button>}
            <span className="campaign-logo"><Megaphone size={15}/></span><p><b>{campaign.name}</b><small>{campaign.channel}</small></p>
          </div>
          <div><span className={`status-badge ${campaign.status.toLowerCase()}`}><i />{campaign.status === "ACTIVE" ? "Activa" : campaign.status === "PAUSED" ? "Pausada" : "Borrador"}</span></div>
          <div className="number-cell"><b>{money(campaign.spend)}</b><small>este mes</small></div>
          <div className="number-cell"><b>{campaign.results}</b><small>{campaign.costPerResult ? `${money(campaign.costPerResult)} c/u` : "Sin datos"}</small></div>
          <div className="roas-cell"><b>{campaign.roas.toFixed(2)}×</b><small className={campaign.trend >= 0 ? "up" : "down"}>{campaign.trend >= 0 ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>} {Math.abs(campaign.trend)}%</small></div>
          {!compact && <div className="number-cell">{editableBudget && onControl
            ? <BudgetEditor campaign={campaign} onSave={(dailyBudget) => onControl({ kind: "campaign-budget", campaignId: campaign.id, dailyBudget })}/>
            : <><b>{money(campaign.dailyBudget)}</b><small>{campaign.budgetLevel === "none" ? "presupuesto total" : "por día"}</small></>}</div>}
          <button className="row-action" disabled={campaign.status === "DRAFT"} onClick={() => onToggle?.(campaign)} title={campaign.status === "ACTIVE" ? "Pausar" : "Activar"}>{campaign.status === "ACTIVE" ? <Pause size={15}/> : <Play size={15}/>}</button>
        </div>
        {ads && open && <AdList ads={ads.filter((ad) => ad.campaignId === campaign.id)} onControl={onControl} onAdCreated={onAdCreated}/>}
      </Fragment>;
    })}
  </div>;
}

function BudgetEditor({ campaign, onSave }: { campaign: Campaign; onSave: (dailyBudget: number) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(campaign.dailyBudget));
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    const saved = await onSave(amount);
    setSaving(false);
    if (saved) setEditing(false);
  }
  if (!editing) {
    return <button className="budget-edit" title="Editar presupuesto diario" onClick={() => { setValue(String(campaign.dailyBudget)); setEditing(true); }}><b>{money(campaign.dailyBudget)}</b><small>por día · editar</small></button>;
  }
  return <form className="budget-form" onSubmit={save}>
    <input type="number" min="1" step="1" autoFocus aria-label="Presupuesto diario en MXN" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }}/>
    <button className="row-action" title="Guardar" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}</button>
    <button type="button" className="row-action" title="Cancelar" onClick={() => setEditing(false)}><X size={14}/></button>
  </form>;
}

function AdList({ ads, onControl, onAdCreated }: { ads: Ad[]; onControl?: ControlRequest; onAdCreated?: AdCreatedHandler }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const reusable = ads.filter((ad) => ad.creative?.reusable);
  async function toggle(ad: Ad) {
    if (!onControl) return;
    setBusyId(ad.id);
    await onControl({ kind: "ad-status", adId: ad.id, status: ad.status === "ACTIVE" ? "PAUSED" : "ACTIVE" });
    setBusyId(null);
  }
  if (!ads.length) return <div className="ad-list empty">Esta campaña no tiene anuncios sincronizados todavía.</div>;
  return <div className="ad-list">
    <div className="ad-row ad-head"><span>ANUNCIO</span><span>ESTADO</span><span>GASTO 7 D</span><span>CTR</span><span>FRECUENCIA</span><span>RESULTADOS</span><span/></div>
    {ads.map((ad) => <div className="ad-row" key={ad.id}>
      <b title={ad.name}>{ad.name}</b>
      <span><span className={`status-badge ${ad.status.toLowerCase()}`}><i/>{ad.status === "ACTIVE" ? "Activo" : "Pausado"}</span></span>
      <span>{money(ad.spend)}</span>
      <span>{ad.ctr.toFixed(2)}%</span>
      <span className={ad.frequency >= 4 ? "warn" : ""} title={ad.frequency >= 4 ? "Frecuencia alta: posible fatiga" : undefined}>{ad.frequency.toFixed(1)}</span>
      <span>{ad.results}</span>
      <button className="row-action" disabled={!onControl || busyId === ad.id} onClick={() => toggle(ad)} title={ad.status === "ACTIVE" ? "Pausar anuncio" : "Reactivar anuncio"}>{busyId === ad.id ? <LoaderCircle className="spin" size={14}/> : ad.status === "ACTIVE" ? <Pause size={14}/> : <Play size={14}/>}</button>
    </div>)}
    {onAdCreated && <div className="ad-list-footer">
      {reusable.length
        ? <button className="text-button" onClick={() => setCreating(true)}><WandSparkles size={14}/> Nuevo anuncio con texto renovado</button>
        : <small>Para crear variantes aquí, la campaña necesita un anuncio de imagen con enlace.</small>}
    </div>}
    {creating && onAdCreated && <AdVariantModal ads={reusable} onClose={() => setCreating(false)} onCreated={(workspace, message) => { setCreating(false); onAdCreated(workspace, message); }}/>}
  </div>;
}

function AdVariantModal({ ads, onClose, onCreated }: { ads: Ad[]; onClose: () => void; onCreated: AdCreatedHandler }) {
  const best = [...ads].sort((a, b) => b.results - a.results || b.ctr - a.ctr)[0];
  const [sourceId, setSourceId] = useState(best?.id ?? "");
  const [headline, setHeadline] = useState(best?.creative?.headline ?? "");
  const [primaryText, setPrimaryText] = useState(best?.creative?.primaryText ?? "");
  const [variants, setVariants] = useState<Array<{ headline: string; primaryText: string; angle: string }>>([]);
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState<"suggest" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = headline.trim().length >= 3 && headline.trim().length <= 60 && primaryText.trim().length >= 10 && primaryText.trim().length <= 500;

  function chooseSource(id: string) {
    const next = ads.find((ad) => ad.id === id);
    setSourceId(id);
    setHeadline(next?.creative?.headline ?? "");
    setPrimaryText(next?.creative?.primaryText ?? "");
    setVariants([]);
  }

  function chooseImage(file: File | null) {
    if (file && (!["image/jpeg", "image/png"].includes(file.type) || file.size > MAX_IMAGE_BYTES)) {
      setImage(null);
      setError("Usa una imagen JPG o PNG de hasta 4 MB.");
      return;
    }
    setError(null);
    setImage(file);
  }

  async function suggest() {
    setBusy("suggest"); setError(null);
    try {
      const response = await fetch("/api/creatives/variants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adId: sourceId }) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) setVariants(result.variants ?? []);
      else setError(result.error || "No fue posible sugerir variantes.");
    } catch {
      setError("No fue posible sugerir variantes.");
    } finally { setBusy(null); }
  }

  async function create() {
    setBusy("create"); setError(null);
    const body = new FormData();
    body.set("sourceAdId", sourceId);
    body.set("headline", headline);
    body.set("primaryText", primaryText);
    if (image) body.set("image", image);
    try {
      const response = await fetch("/api/creatives", { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.workspace) onCreated(result.workspace, result.message);
      else setError(result.message || result.error || "No fue posible crear el anuncio.");
    } catch {
      setError("No fue posible crear el anuncio.");
    } finally { setBusy(null); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal">
    <div className="modal-head"><div><span>RENOVACIÓN DE CREATIVOS</span><h2>Nuevo anuncio</h2></div><button onClick={onClose}><X size={19}/></button></div>
    <div className="modal-body"><div className="form-step">
      <div className="field"><label>Anuncio base</label><select value={sourceId} onChange={(event) => chooseSource(event.target.value)}>{ads.map((ad) => <option key={ad.id} value={ad.id}>{ad.name} · {ad.results} resultados · CTR {ad.ctr.toFixed(2)}%</option>)}</select><small>El anuncio nuevo usa su destino y su botón; la imagen también, salvo que subas otra.</small></div>
      <div className="suggest-row"><p className="field-note">¿Sin ideas? OpenAI propone tres ángulos con la misma oferta.</p><button type="button" className="secondary-button" onClick={suggest} disabled={!sourceId || Boolean(busy)}>{busy === "suggest" ? <LoaderCircle className="spin" size={15}/> : <Sparkles size={15}/>} Sugerir con IA</button></div>
      {variants.length > 0 && <div className="variant-grid">{variants.map((variant, index) => <button type="button" key={`${variant.angle}-${index}`} className={`variant-card ${variant.headline === headline && variant.primaryText === primaryText ? "selected" : ""}`} onClick={() => { setHeadline(variant.headline); setPrimaryText(variant.primaryText); }}><small>{variant.angle}</small><b>{variant.headline}</b><span>{variant.primaryText}</span></button>)}</div>}
      <div className="field"><label>Título <span className="char-count">{headline.length}/60</span></label><input maxLength={60} value={headline} onChange={(event) => setHeadline(event.target.value)}/></div>
      <div className="field"><label>Texto principal <span className="char-count">{primaryText.length}/500</span></label><textarea maxLength={500} value={primaryText} onChange={(event) => setPrimaryText(event.target.value)}/></div>
      <div className="field"><label>Imagen nueva (opcional)</label><input type="file" accept="image/jpeg,image/png" onChange={(event) => chooseImage(event.target.files?.[0] ?? null)}/><small>JPG o PNG de hasta 4 MB. En modo demo la imagen no se sube.</small></div>
    </div></div>
    {error && <div className="modal-error"><AlertCircle size={15}/>{error}</div>}
    <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={create} disabled={!valid || !sourceId || Boolean(busy)}>{busy === "create" ? <LoaderCircle className="spin" size={16}/> : <Rocket size={16}/>} Publicar anuncio</button></div>
  </div></div>;
}

function ActivityList({ activities }: { activities: SafeWorkspace["activities"] }) {
  return <div className="activity-list">{activities.length ? activities.map((item) => {
    const meta = agentMeta[item.agent]; const Icon = meta.icon;
    return <div className="activity-item" key={item.id}><span className={`agent-icon ${meta.color}`}><Icon size={15}/></span><div><div><b>{item.agent}</b><small>{item.createdAt}</small></div><strong>{item.title}</strong><p>{item.detail}</p><em>{item.impact}</em></div></div>;
  }) : <div className="empty-panel"><Activity size={22}/><b>Sin actividad reciente</b></div>}</div>;
}

function CampaignsView({ campaigns, ads, onToggle, onControl, onAdCreated, onCreate }: { campaigns: Campaign[]; ads: Ad[]; onToggle: (campaign: Campaign) => void; onControl: ControlRequest; onAdCreated: AdCreatedHandler; onCreate: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = campaigns.filter((campaign) => campaign.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="page-stack">
    <div className="page-intro"><div><h2>Todas tus campañas</h2><p>Supervisa resultados y deja que Pulso optimice la inversión.</p></div><button className="primary-button" onClick={onCreate}><WandSparkles size={17}/> Crear con IA</button></div>
    <div className="summary-strip"><div><span>Campañas</span><b>{campaigns.length}</b></div><div><span>Activas</span><b className="green-text">{campaigns.filter((c) => c.status === "ACTIVE").length}</b></div><div><span>Inversión total</span><b>{money(campaigns.reduce((sum, c) => sum + c.spend, 0))}</b></div><div><span>ROAS promedio</span><b>{(campaigns.reduce((sum, c) => sum + c.roas, 0) / Math.max(campaigns.length, 1)).toFixed(2)}×</b></div></div>
    <div className="panel full-table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input placeholder="Buscar campaña…" value={query} onChange={(event) => setQuery(event.target.value)}/></div><button className="secondary-button"><SlidersHorizontal size={15}/> Filtros</button><button className="secondary-button"><FileText size={15}/> Exportar</button></div><CampaignTable campaigns={filtered} ads={ads} onToggle={onToggle} onControl={onControl} onAdCreated={onAdCreated}/></div>
  </div>;
}

function AgentsView({ organization, activities, actions, decidingId, onDecide, running, onRun, onMode, aiStatus }: { organization: Organization; activities: SafeWorkspace["activities"]; actions: AgentAction[]; decidingId: string | null; onDecide: (id: string, decision: Decision) => void; running: boolean; onRun: () => void; onMode: () => void; aiStatus: AiStatus | null }) {
  const modeHint: Record<AutomationMode, string> = {
    observer: "Modo Observador: los agentes solo sugieren cambios.",
    copilot: "Modo Copiloto: cada cambio espera tu aprobación.",
    autonomous: "Modo Autónomo: los cambios que pasan los guardrails se aplican solos.",
    yolo: "Modo YOLO: los cambios que pasan los guardrails se aplican solos.",
  };
  return <div className="page-stack">
    <div className="agent-hero"><div className="agent-hero-icon"><BrainCircuit size={27}/></div><div><span>PILOTO AUTOMÁTICO · {aiStatus?.configured ? `OPENAI · ${aiStatus.model?.toUpperCase()}` : "MOTOR DE REGLAS"}</span><h2>Tu equipo de medios, trabajando 24/7</h2><p>{modeHint[organization.mode]}</p></div><div className="hero-controls"><button className={`mode-chip ${organization.mode}`} onClick={onMode}><span/><b>{MODE_LABELS[organization.mode]}</b><ChevronDown size={15}/></button><button className="run-button light" onClick={onRun} disabled={running}>{running ? <LoaderCircle className="spin" size={17}/> : <Sparkles size={17}/>} Ejecutar análisis</button></div></div>
    <div className="agents-actions"><ApprovalsPanel actions={actions} decidingId={decidingId} onDecide={onDecide}/><ActionLog actions={actions} decidingId={decidingId} onDecide={onDecide}/></div>
    <AiAssistantPanel organization={organization} status={aiStatus}/>
    <div className="section-title"><div><h3>Equipo de agentes</h3><p>Todos comparten las métricas de la cuenta y reportan al Supervisor.</p></div><span className="live-label"><i/> 6 OPERANDO</span></div>
    <div className="agents-grid">{Object.entries(agentMeta).map(([name, meta]) => { const Icon = meta.icon; const last = actions.find((action) => action.agent === name); return <div className="agent-card" key={name}><div className="agent-card-top"><span className={`agent-big-icon ${meta.color}`}><Icon size={21}/></span><span className="agent-status"><i/> ACTIVO</span></div><h3>{name}</h3><p>{meta.description}</p><div className="agent-stat"><span>Última decisión</span><b suppressHydrationWarning>{last ? timeAgo(last.createdAt) : "Sin decisiones"}</b></div><button>Ver decisiones <ChevronRight size={14}/></button></div>; })}</div>
    <div className="agents-lower"><div className="panel"><PanelHeader title="Cómo decide Pulso" subtitle="Proceso de una optimización autónoma"/><div className="decision-flow"><div><span>01</span><b>Observa</b><p>Recopila gasto, resultados y señales de fatiga.</p></div><ChevronRight size={17}/><div><span>02</span><b>Contrasta</b><p>Compara con objetivos y límites configurados.</p></div><ChevronRight size={17}/><div><span>03</span><b>Decide</b><p>El Supervisor valida impacto y riesgo.</p></div><ChevronRight size={17}/><div><span>04</span><b>Actúa</b><p>Ejecuta, registra y vuelve a medir.</p></div></div></div><div className="panel activity-panel expanded"><PanelHeader title="Decisiones recientes" subtitle="Registro explicable"/><ActivityList activities={activities.slice(0, 5)}/></div></div>
  </div>;
}

function ApprovalsPanel({ actions, decidingId, onDecide }: { actions: AgentAction[]; decidingId: string | null; onDecide: (id: string, decision: Decision) => void }) {
  const pending = actions.filter((action) => action.status === "pending");
  return <div className="panel approvals-panel">
    <PanelHeader title="Aprobaciones pendientes" subtitle={pending.length ? "Se revalidan contra tus guardrails al aprobarlas" : "No hay cambios esperando tu decisión"} action={<span className="count-pill">{pending.length} pendientes</span>}/>
    {pending.length ? <div className="approval-list">{pending.map((action) => {
      const Icon = agentMeta[action.agent].icon;
      const busy = decidingId === action.id;
      return <div className="approval-row" key={action.id}>
        <span className={`agent-icon ${agentMeta[action.agent].color}`}><Icon size={15}/></span>
        <div><strong>{capitalize(describeAction(action))}</strong><p>{action.reason}</p>{action.variant && <blockquote className="variant-copy"><b>{action.variant.headline}</b>{action.variant.primaryText}</blockquote>}<em>{action.impact}{action.source === "ai" ? " · Propuesto por IA" : ""}</em></div>
        <div className="approval-side">
          {action.fromBudget !== undefined && action.toBudget !== undefined && <div className="budget-diff">{money(action.fromBudget)}<ChevronRight size={11}/><b>{money(action.toBudget)}</b></div>}
          <div className="approval-actions">
            <button className="secondary-button" disabled={Boolean(decidingId)} onClick={() => onDecide(action.id, "reject")}><X size={14}/> Rechazar</button>
            <button className="primary-button" disabled={Boolean(decidingId)} onClick={() => onDecide(action.id, "approve")}>{busy ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>} Aprobar</button>
          </div>
        </div>
      </div>;
    })}</div> : <div className="empty-panel"><ShieldCheck size={22}/><b>Todo al día</b><span>En modo Copiloto las propuestas aparecerán aquí.</span></div>}
  </div>;
}

function ActionLog({ actions, decidingId, onDecide }: { actions: AgentAction[]; decidingId: string | null; onDecide: (id: string, decision: Decision) => void }) {
  const history = actions.filter((action) => action.status !== "pending").slice(0, 20);
  const latestStatus = lastStatusChanges(actions);
  // Only the pause that is still in effect for its campaign or ad can be undone.
  const canResume = (action: AgentAction) => action.status === "executed"
    && (action.type === "pause_campaign" || action.type === "pause_ad")
    && latestStatus.get(action.type === "pause_ad" ? `ad:${action.adId}` : `campaign:${action.campaignId}`)?.id === action.id;
  return <div className="panel action-log-panel">
    <PanelHeader title="Registro de cambios" subtitle="Cada decisión con su razón y resultado"/>
    {history.length ? <div className="action-log">{history.map((action) => <div className="action-log-row" key={action.id}>
      <span className={`status-badge ${ACTION_STATUS[action.status].badge}`}><i/>{ACTION_STATUS[action.status].label}</span>
      <div><strong>{capitalize(describeAction(action))}</strong><p>{action.reason}</p>{(action.guardrail || action.error) && <p className="guardrail-note">{action.guardrail || action.error}</p>}</div>
      <div className="action-log-side">
        <small suppressHydrationWarning>{timeAgo(action.resolvedAt || action.createdAt)}</small>
        {canResume(action) && <button className="text-button" disabled={Boolean(decidingId)} onClick={() => onDecide(action.id, "resume")}>{decidingId === action.id ? <LoaderCircle className="spin" size={13}/> : <Play size={13}/>} Reactivar</button>}
      </div>
    </div>)}</div> : <div className="empty-panel"><Activity size={22}/><b>Sin cambios registrados</b><span>Ejecuta un análisis para ver las decisiones.</span></div>}
  </div>;
}

function AiAssistantPanel({ organization, status }: { organization: Organization; status: AiStatus | null }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setAsking(true); setAnswer(null);
    try {
      const response = await fetch("/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, question }) });
      const result = await response.json();
      setAnswer(response.ok ? result.answer : result.error);
    } catch { setAnswer("No fue posible contactar al proveedor de IA."); }
    finally { setAsking(false); }
  }
  const available = Boolean(status?.configured);
  return <div className="panel assistant-panel"><div className="assistant-head"><div className="assistant-orb"><Sparkles size={18}/></div><div><span>ASESOR ESTRATÉGICO</span><h3>Pregúntale a Pulso sobre tu cuenta</h3><p>{available ? `OpenAI · ${status?.model}` : status?.reason || "Comprobando OpenAI…"}</p></div><span className={`provider-state ${available ? "ready" : "offline"}`}><i/>{available ? "CONECTADO" : "SIN CONFIGURAR"}</span></div><form className="assistant-input" onSubmit={ask}><input value={question} onChange={(event) => setQuestion(event.target.value)} disabled={!available || asking} placeholder={available ? "Ej. ¿Qué campaña debería escalar esta semana?" : "El asesor no está disponible por ahora"}/><button className="primary-button" disabled={!available || asking}>{asking ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>} Preguntar</button></form>{answer && <div className="assistant-answer"><Bot size={17}/><p>{answer}</p></div>}<div className="assistant-suggestions"><button type="button" disabled={!available} onClick={() => setQuestion("¿Qué campaña tiene la mejor oportunidad de escalar hoy y por qué?")}>Qué escalar</button><button type="button" disabled={!available} onClick={() => setQuestion("¿Cuál es el riesgo principal de esta cuenta esta semana?")}>Detectar riesgo</button><button type="button" disabled={!available} onClick={() => setQuestion("Dame tres ideas de copy basadas en la mejor campaña.")}>Ideas de copy</button></div></div>;
}

function CreativesView({ creatives, onCreate }: { creatives: SafeWorkspace["creatives"]; onCreate: () => void }) {
  return <div className="page-stack"><div className="page-intro"><div><h2>Laboratorio creativo</h2><p>Conceptos, copies y variantes producidas por el agente creativo.</p></div><button className="primary-button" onClick={onCreate}><WandSparkles size={17}/> Generar creativo</button></div>
    <div className="creative-grid">{creatives.map((creative, index) => <div className="creative-card" key={creative.id}><div className={`creative-preview preview-${index % 3}`} style={{ background: `linear-gradient(145deg, ${creative.palette[0]}, ${creative.palette[1]})` }}><span className="preview-brand">PULSO / CONCEPTO</span><div className="preview-copy"><small>NUEVA COLECCIÓN</small><b>{creative.headline}</b><span>CONOCER MÁS →</span></div><div className="preview-shape one"/><div className="preview-shape two"/></div><div className="creative-info"><div><span className={`creative-status ${creative.status.toLowerCase()}`}>{creative.status}</span><span>{creative.format}</span><b><Sparkles size={13}/>{creative.score}</b></div><h3>{creative.title}</h3><p>{creative.primaryText}</p><button>Ver variantes <ChevronRight size={14}/></button></div></div>)}</div>
    {creatives.length === 0 && <div className="panel empty-large"><ImageIcon size={30}/><h3>Aún no hay creativos</h3><p>Genera una campaña para crear el primer concepto.</p><button className="primary-button" onClick={onCreate}>Crear con IA</button></div>}
  </div>;
}

function AlertsView({ alerts, onRead }: { alerts: SafeWorkspace["alerts"]; onRead: (id: string) => void }) {
  return <div className="page-stack"><div className="page-intro"><div><h2>Centro de alertas</h2><p>Solo lo importante: anomalías, límites y oportunidades.</p></div><span className="count-pill">{alerts.filter((alert) => !alert.read).length} sin leer</span></div><div className="panel alerts-panel">{alerts.map((alert) => <button key={alert.id} className={`alert-row ${alert.read ? "read" : ""}`} onClick={() => onRead(alert.id)}><span className={`alert-severity ${alert.severity}`}>{alert.severity === "success" ? <Check size={18}/> : alert.severity === "info" ? <Lightbulb size={18}/> : <AlertCircle size={18}/>}</span><div><div><h3>{alert.title}</h3><small>{alert.createdAt}</small></div><p>{alert.detail}</p></div>{!alert.read && <i className="unread-dot"/>}<ChevronRight size={17}/></button>)}</div></div>;
}

function ConnectionsView({ data, syncing, onSync, setToast }: { data: SafeWorkspace; syncing: boolean; onSync: () => void; setToast: (message: string) => void }) {
  const connected = data.metaConnection.status === "connected";
  async function disconnect() { await fetch("/api/meta/disconnect", { method: "POST" }); window.location.reload(); }
  return <div className="page-stack narrow"><div className="page-intro"><div><h2>Conecta tus activos de Meta</h2><p>Pulso necesita acceso para leer métricas y ejecutar optimizaciones autorizadas.</p></div></div>
    <div className="panel connection-card"><div className="meta-lockup"><span><Facebook size={25}/></span><span><Instagram size={25}/></span></div><div className="connection-main"><div><span className={`status-badge ${connected ? "active" : "draft"}`}><i/>{connected ? "Conectado" : data.metaConnection.status === "demo" ? "Demostración" : "Sin conectar"}</span><h2>Facebook + Instagram Ads</h2><p>Campañas, cuentas publicitarias, páginas, públicos, creativos e Insights.</p></div><div className="connection-actions">{connected ? <><button className="secondary-button" onClick={onSync} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={16}/> : <RefreshCcw size={16}/>} Sincronizar</button><button className="danger-text" onClick={disconnect}>Desconectar</button></> : <a className="primary-button" href="/api/meta/connect"><Zap size={16}/> Conectar con Meta</a>}</div></div>
      <div className="permission-grid"><div><Eye size={17}/><span><b>Lectura</b><small>Campañas y métricas</small></span><Check size={15}/></div><div><SlidersHorizontal size={17}/><span><b>Administración</b><small>Presupuestos y estados</small></span><Check size={15}/></div><div><ImageIcon size={17}/><span><b>Creativos</b><small>Facebook e Instagram</small></span><Check size={15}/></div></div>
      {connected && <div className="connected-details"><span><b>Usuario de Meta</b>{data.metaConnection.userName}</span><span><b>Cuentas encontradas</b>{data.organizations.length}</span><span><b>Última sincronización</b>{data.metaConnection.lastSyncAt ? new Date(data.metaConnection.lastSyncAt).toLocaleString("es-MX") : "—"}</span></div>}
    </div>
    {!connected && <div className="config-note"><ShieldCheck size={20}/><div><b>Tus credenciales no pasan por el navegador</b><p>La autorización se realiza en Meta. Pulso cifra el token antes de guardarlo y nunca solicita tu contraseña.</p></div></div>}
    <div className="panel setup-card"><PanelHeader title="Lista para conectar" subtitle="Verifica estos pasos en Meta for Developers"/><div className="setup-steps"><div className="done"><span><Check size={15}/></span><p><b>Cuenta de negocio creada</b><small>Ya nos confirmaste este paso.</small></p></div><div className="done"><span><Check size={15}/></span><p><b>Usuario tester agregado</b><small>Ya nos confirmaste este paso.</small></p></div><div><span>3</span><p><b>Variables del servidor</b><small>Agrega App ID, App Secret y la llave de cifrado.</small></p><button onClick={() => setToast("Consulta .env.example para copiar las variables necesarias.")}>Ver configuración</button></div><div><span>4</span><p><b>URI de redirección</b><small>Registra /api/meta/callback en Facebook Login.</small></p></div></div></div>
  </div>;
}

interface ReportStatus {
  link: { url: string; createdAt: string } | null;
  emailConfigured: boolean;
}

function ReportsView({ organization, branding, setToast, onSaved }: { organization: Organization; branding: SafeWorkspace["branding"]; setToast: (message: string) => void; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [agencyName, setAgencyName] = useState(branding?.agencyName ?? "");
  const [accentColor, setAccentColor] = useState(branding?.accentColor ?? "#7056e8");
  const [emails, setEmails] = useState((organization.report?.clientEmails ?? []).join(", "));
  const [weekly, setWeekly] = useState(organization.report?.weeklyEmail ?? false);
  const savedEmails = organization.report?.clientEmails ?? [];

  useEffect(() => {
    fetch(`/api/reports?organizationId=${encodeURIComponent(organization.id)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => result.error ? setToast(result.error) : setStatus(result))
      .catch(() => setToast("No fue posible cargar el enlace del reporte."));
  }, [organization.id, setToast]);

  async function send(label: string, url: string, method: string, body: unknown) {
    setBusy(label);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      return { ok: response.ok, result };
    } catch {
      return { ok: false, result: { error: "No hubo respuesta del servidor." } };
    } finally { setBusy(null); }
  }

  async function changeLink(method: "POST" | "DELETE") {
    const { ok, result } = await send(method, "/api/reports", method, { organizationId: organization.id });
    if (!ok) return setToast(result.error || "No fue posible actualizar el enlace.");
    setStatus((current) => ({ emailConfigured: current?.emailConfigured ?? false, link: result.link }));
    setToast(method === "POST" ? "Enlace listo para compartir." : "Enlace desactivado; ya no abre el reporte.");
  }

  async function copyLink() {
    if (!status?.link) return;
    try {
      await navigator.clipboard.writeText(status.link.url);
      setToast("Enlace copiado.");
    } catch {
      setToast("Copia el enlace manualmente.");
    }
  }

  async function saveBranding(event: FormEvent) {
    event.preventDefault();
    const { ok, result } = await send("branding", "/api/workspace", "PATCH", { action: "branding", agencyName, accentColor });
    if (!ok) return setToast(result.error || "No fue posible guardar tu marca.");
    await onSaved();
    setToast("Marca guardada.");
  }

  async function saveEmails(event: FormEvent) {
    event.preventDefault();
    const clientEmails = [...new Set(emails.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
    const { ok, result } = await send("emails", "/api/workspace", "PATCH", { action: "report-settings", organizationId: organization.id, clientEmails, weeklyEmail: weekly });
    if (!ok) return setToast(result.error || "Revisa los correos: deben ser válidos y máximo 20.");
    await onSaved();
    setToast(weekly ? "Resumen semanal activado." : "Correos guardados.");
  }

  async function sendNow() {
    const { ok, result } = await send("send", "/api/reports/send", "POST", { organizationId: organization.id });
    if (ok) await onSaved();
    setToast(result.message || result.error || "No fue posible enviar el resumen.");
  }

  return <div className="page-stack narrow">
    <div className="page-intro"><div><h2>Reportes para tus clientes</h2><p>Comparte los resultados de {organization.name} con tu marca, sin darles acceso a Pulso.</p></div></div>

    <div className="panel report-card">
      <PanelHeader title="Enlace del reporte" subtitle="Página de solo lectura con los últimos 7 días; tu cliente la puede descargar en PDF"/>
      <div className="report-card-body">
        {!status ? <p className="field-note"><LoaderCircle className="spin" size={13}/> Cargando…</p>
          : status.link ? <>
            <div className="report-link"><Link2 size={16}/><input readOnly value={status.link.url} onFocus={(event) => event.target.select()}/></div>
            <div className="report-actions">
              <button className="primary-button" type="button" onClick={copyLink}><Copy size={15}/> Copiar</button>
              <a className="secondary-button" href={status.link.url} target="_blank" rel="noreferrer"><Eye size={15}/> Abrir</a>
              <button className="secondary-button" type="button" onClick={() => changeLink("POST")} disabled={Boolean(busy)}><RefreshCcw size={15}/> Generar nuevo</button>
              <button className="danger-text" type="button" onClick={() => changeLink("DELETE")} disabled={Boolean(busy)}>Desactivar</button>
            </div>
            <small>Generar uno nuevo desactiva el anterior.</small>
          </>
            : <div><button className="primary-button" type="button" onClick={() => changeLink("POST")} disabled={Boolean(busy)}>{busy ? <LoaderCircle className="spin" size={15}/> : <Link2 size={15}/>} Crear enlace</button></div>}
      </div>
    </div>

    <form className="panel report-card" onSubmit={saveBranding}>
      <PanelHeader title="Tu marca" subtitle="Aparece en los reportes y correos de todos tus negocios"/>
      <div className="report-card-body two-fields">
        <div className="field"><label>Nombre de tu agencia</label><input maxLength={60} placeholder="Ej. Agencia Norte" value={agencyName} onChange={(event) => setAgencyName(event.target.value)}/></div>
        <div className="field"><label>Color principal</label><div className="color-input"><input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)}/><code>{accentColor}</code></div></div>
      </div>
      <div className="form-footer"><button className="primary-button" disabled={agencyName.trim().length < 2 || Boolean(busy)}><Check size={15}/> Guardar marca</button></div>
    </form>

    <form className="panel report-card" onSubmit={saveEmails}>
      <PanelHeader title="Resumen semanal por correo" subtitle={status?.emailConfigured === false ? "Falta configurar RESEND_API_KEY y REPORTS_FROM_EMAIL en el servidor" : "Se envía los lunes con el enlace al reporte completo"}/>
      <div className="report-card-body">
        <div className="field"><label>Correos de tu cliente</label><textarea placeholder="cliente@empresa.mx, direccion@empresa.mx" value={emails} onChange={(event) => setEmails(event.target.value)}/><small>Hasta 20, separados por comas. Cada persona recibe su propio correo; incluye el tuyo para ver lo mismo que tu cliente.</small></div>
        <label className="publish-toggle"><input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)}/><span/><div><b>Enviar cada lunes</b><small suppressHydrationWarning>{organization.report?.lastSentAt ? `Último envío: ${new Date(organization.report.lastSentAt).toLocaleString("es-MX")}` : "Aún no se ha enviado."}</small></div></label>
      </div>
      <div className="form-footer report-form-footer">
        <button type="button" className="secondary-button" onClick={sendNow} disabled={!status?.emailConfigured || !savedEmails.length || Boolean(busy)}>{busy === "send" ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>} Enviar ahora</button>
        <button className="primary-button" disabled={Boolean(busy)}><Check size={15}/> Guardar</button>
      </div>
    </form>
  </div>;
}

function AiModelPanel({ status, models, onSaved }: { status: AiStatus | null; models: string[]; onSaved: (message: string) => void }) {
  const [choice, setChoice] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = choice || status?.model || "";
  const options = status?.model && !models.includes(status.model) ? [status.model, ...models] : models;
  async function save() {
    setSaving(true);
    const response = await fetch("/api/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ai-model", model: selected }) });
    const result = await response.json();
    setSaving(false);
    onSaved(response.ok ? `Modelo ${selected} guardado.` : result.error || "No fue posible guardar el modelo.");
  }
  return <div className="panel ai-settings">
    <div><span>MODELO DE IA · OPENAI</span><h3>{status?.model || "Sin modelo elegido"}</h3><p>{status?.configured ? "Los agentes y el asesor usan este modelo en tu workspace." : status?.reason || "Comprobando OpenAI…"}</p></div>
    <div><span className={`provider-state ${status?.configured ? "ready" : "offline"}`}><i/>{status?.configured ? "ACTIVO" : "PENDIENTE"}</span></div>
    {options.length > 1 ? <div className="ai-model-picker">
      <select value={selected} onChange={(event) => setChoice(event.target.value)} disabled={saving}>
        <option value="" disabled>Elige un modelo</option>
        {options.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
      <button className="primary-button" type="button" onClick={save} disabled={!selected || selected === status?.model || saving}>{saving ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>} Guardar modelo</button>
    </div> : <p className="field-note" style={{ gridColumn: "1 / -1" }}>Por ahora todos los workspaces usan este modelo.</p>}
    <small>La llave de OpenAI vive solo en el servidor. Los guardrails siguen siendo la autoridad final sobre cualquier cambio que proponga el modelo.</small>
  </div>;
}

function SettingsView({ organization, onSaved, aiStatus, aiModels, onAiModelSaved }: { organization: Organization; onSaved: () => void; aiStatus: AiStatus | null; aiModels: string[]; onAiModelSaved: (message: string) => void }) {
  const [limit, setLimit] = useState(String(organization.monthlyLimit));
  const [value, setValue] = useState(String(organization.resultValue));
  const [roasTarget, setRoasTarget] = useState(String(targetRoas(organization)));
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) { event.preventDefault(); setSaving(true); await fetch("/api/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "organization", organizationId: organization.id, monthlyLimit: Number(limit), targetRoas: Number(roasTarget), resultValue: Number(value) }) }); setSaving(false); onSaved(); }
  return <div className="page-stack narrow"><div className="page-intro"><div><h2>Límites y medición</h2><p>Estas reglas siempre se respetan, incluso en modo YOLO.</p></div></div><AiModelPanel status={aiStatus} models={aiModels} onSaved={onAiModelSaved}/><form className="panel settings-form" onSubmit={save}><PanelHeader title="Guardrails obligatorios" subtitle={`Aplican a ${organization.name}`}/><label><span>Límite mensual de inversión <small>MXN</small></span><div className="money-input"><b>$</b><input type="number" min="100" value={limit} onChange={(event) => setLimit(event.target.value)}/><em>MXN</em></div><small>El agente no permitirá que el gasto administrado supere esta cantidad.</small></label><label><span>ROAS objetivo <small>INGRESOS ÷ INVERSIÓN</small></span><div className="money-input"><input type="number" min="0.5" max="50" step="0.1" value={roasTarget} onChange={(event) => setRoasTarget(event.target.value)}/><em>×</em></div><small>Por debajo de 80% de esta meta el agente reduce presupuesto; 20% por encima, lo escala.</small></label><label><span>Valor estimado por resultado <small>MXN</small></span><div className="money-input"><b>$</b><input type="number" min="0" value={value} onChange={(event) => setValue(event.target.value)}/><em>MXN</em></div><small>Se usa para estimar retorno cuando Meta no reporta el valor de una compra.</small></label><div className="hard-rules"><div><ShieldCheck size={17}/><span><b>Ritmo de gasto</b><small>La proyección a fin de mes nunca puede superar el límite</small></span><em>FIJO</em></div><div><ShieldCheck size={17}/><span><b>Variación máxima de presupuesto</b><small>20% acumulado por campaña en 24 horas</small></span><em>FIJO</em></div><div><ShieldCheck size={17}/><span><b>Entrega continua</b><small>Nunca se pausa el último anuncio activo de un conjunto</small></span><em>FIJO</em></div><div><ShieldCheck size={17}/><span><b>Acción destructiva</b><small>El agente nunca elimina campañas, solo las pausa</small></span><em>FIJO</em></div><div><ShieldCheck size={17}/><span><b>Interruptor de emergencia</b><small>Puedes pasar a Observador en cualquier momento</small></span><em>ACTIVO</em></div></div><div className="form-footer"><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Guardar cambios</button></div></form></div>;
}

type MessagingApp = "WHATSAPP" | "MESSENGER";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const OBJECTIVE_HINTS: Record<Organization["objective"], string> = {
  Ventas: "Compras en tu sitio",
  Prospectos: "Formularios instantáneos",
  Mensajes: "WhatsApp o Messenger",
};

function defaultPrimaryText(offer: string, objective: Organization["objective"]): string {
  if (objective === "Ventas") return `Descubre ${offer}. Conoce todos los detalles y compra hoy.`;
  if (objective === "Prospectos") return `¿Te interesa ${offer}? Déjanos tus datos y te contactamos hoy mismo.`;
  return `¿Tienes dudas sobre ${offer}? Escríbenos y te respondemos al momento.`;
}

function isWebsite(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function CampaignModal({ organization, connected, defaultPublish, onClose, onCreated }: { organization: Organization; connected: boolean; defaultPublish: boolean; onClose: () => void; onCreated: (message: string) => void }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState({ offer: "", objective: organization.objective, destination: "", leadFormId: "", messagingApp: "WHATSAPP" as MessagingApp, dailyBudget: 500, headline: "", primaryText: "", publish: defaultPublish });
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [leadForms, setLeadForms] = useState<{ forms: Array<{ id: string; name: string }>; reason?: string } | null>(null);
  const estimatedMonth = form.dailyBudget * 30;

  useEffect(() => {
    if (form.objective !== "Prospectos" || !connected || leadForms) return;
    fetch(`/api/meta/lead-forms?organizationId=${encodeURIComponent(organization.id)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => setLeadForms({ forms: result.forms ?? [], reason: result.reason ?? result.error }))
      .catch(() => setLeadForms({ forms: [], reason: "No fue posible cargar los formularios." }));
  }, [form.objective, connected, leadForms, organization.id]);

  function chooseImage(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    if (file && (!["image/jpeg", "image/png"].includes(file.type) || file.size > MAX_IMAGE_BYTES)) {
      setImage(null); setPreview(null); setImageError("Usa una imagen JPG o PNG de hasta 4 MB.");
      return;
    }
    setImageError(null); setImage(file); setPreview(file ? URL.createObjectURL(file) : null);
  }

  const destinationReady = form.objective === "Ventas" ? isWebsite(form.destination)
    : form.objective === "Prospectos" ? !connected || Boolean(form.leadFormId)
      : true;
  const copyReady = form.headline.trim().length >= 3 && form.headline.trim().length <= 60 && form.primaryText.trim().length >= 10 && form.primaryText.trim().length <= 500;
  const canContinue = step === 1
    ? form.offer.trim().length >= 3 && destinationReady
    : estimatedMonth <= organization.monthlyLimit && copyReady && (!connected || Boolean(image));

  function next() {
    if (step === 1) {
      setForm((current) => ({
        ...current,
        headline: current.headline || current.offer.trim().slice(0, 60),
        primaryText: current.primaryText || defaultPrimaryText(current.offer.trim(), current.objective),
      }));
    }
    setStep(step + 1);
  }

  async function submit() {
    setSubmitting(true); setSubmitError(null);
    const body = new FormData();
    body.set("organizationId", organization.id);
    body.set("offer", form.offer);
    body.set("objective", form.objective);
    body.set("headline", form.headline);
    body.set("primaryText", form.primaryText);
    body.set("dailyBudget", String(form.dailyBudget));
    body.set("publish", String(form.publish));
    if (form.objective === "Ventas") body.set("destination", form.destination);
    if (form.objective === "Prospectos" && form.leadFormId) body.set("leadFormId", form.leadFormId);
    if (form.objective === "Mensajes") body.set("messagingApp", form.messagingApp);
    if (image) body.set("image", image);
    try {
      const response = await fetch("/api/campaigns", { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (response.ok) onCreated(result.message || "Campaña creada.");
      else setSubmitError(result.error || (response.status === 413 ? "La imagen es demasiado grande." : "No fue posible crear la campaña."));
    } catch {
      setSubmitError("No fue posible crear la campaña.");
    } finally { setSubmitting(false); }
  }

  const destinationSummary = form.objective === "Ventas" ? form.destination
    : form.objective === "Prospectos" ? leadForms?.forms.find((item) => item.id === form.leadFormId)?.name || "Formulario instantáneo"
      : form.messagingApp === "WHATSAPP" ? "WhatsApp" : "Messenger";
  const publishNote = connected
    ? form.publish ? "Se creará en Meta y empezará a entregarse." : "Se creará en Meta en pausa para que la actives después."
    : "Modo demo: el lanzamiento se simula.";

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal campaign-modal"><div className="modal-head"><div><span>CREADOR DE CAMPAÑAS</span><h2>Nueva campaña</h2></div><button onClick={onClose}><X size={19}/></button></div><div className="stepper"><div className={step >= 1 ? "active" : ""}><span>{step > 1 ? <Check size={13}/> : "1"}</span>Objetivo</div><i/><div className={step >= 2 ? "active" : ""}><span>{step > 2 ? <Check size={13}/> : "2"}</span>Anuncio</div><i/><div className={step >= 3 ? "active" : ""}><span>3</span>Confirmar</div></div>
    <div className="modal-body">
      {step === 1 && <div className="form-step">
        <div className="field"><label>¿Qué quieres promocionar?</label><input autoFocus maxLength={120} placeholder="Ej. Colección de muebles de otoño" value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })}/><small>Describe el producto, servicio u oferta en una frase.</small></div>
        <div className="field"><label>Objetivo principal</label><div className="objective-grid">{(["Ventas", "Prospectos", "Mensajes"] as const).map((objective) => <button key={objective} type="button" className={form.objective === objective ? "selected" : ""} onClick={() => setForm({ ...form, objective })}>{objective === "Ventas" ? <CircleDollarSign size={19}/> : objective === "Prospectos" ? <Target size={19}/> : <MessageCircle size={19}/>}<span><b>{objective}</b><small>{OBJECTIVE_HINTS[objective]}</small></span>{form.objective === objective && <Check size={15}/>}</button>)}</div></div>
        {form.objective === "Ventas" && <div className="field"><label>Página de destino</label><input type="url" placeholder="https://tusitio.mx/producto" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}/><small>Debe tener instalado el Pixel con el evento Purchase.</small></div>}
        {form.objective === "Prospectos" && <div className="field"><label>Formulario instantáneo</label>
          {!connected ? <p className="field-note">En modo demo el formulario se simula. Con Meta conectado elegirás uno de tu Página.</p>
            : !leadForms ? <p className="field-note"><LoaderCircle className="spin" size={13}/> Cargando formularios de tu Página…</p>
              : leadForms.forms.length ? <select value={form.leadFormId} onChange={(e) => setForm({ ...form, leadFormId: e.target.value })}><option value="">Elige un formulario</option>{leadForms.forms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                : <p className="field-note warning">{leadForms.reason || "Tu Página no tiene formularios activos. Crea uno en Meta Business Suite → Formularios instantáneos."}</p>}
        </div>}
        {form.objective === "Mensajes" && <div className="field"><label>¿Dónde recibirás los mensajes?</label><div className="choice-row">{(["WHATSAPP", "MESSENGER"] as const).map((app) => <button key={app} type="button" className={form.messagingApp === app ? "selected" : ""} onClick={() => setForm({ ...form, messagingApp: app })}><MessageCircle size={16}/>{app === "WHATSAPP" ? "WhatsApp" : "Messenger"}</button>)}</div><small>{form.messagingApp === "WHATSAPP" ? "Tu Página necesita un número de WhatsApp Business vinculado." : "Los mensajes llegan a la bandeja de tu Página."}</small></div>}
      </div>}
      {step === 2 && <div className="form-step">
        <div className="field"><label>Imagen del anuncio{connected ? "" : " (opcional en demo)"}</label><label className="image-drop">{preview
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={preview} alt="Vista previa del anuncio"/>
          : <span><ImageIcon size={22}/><b>Elige una imagen JPG o PNG</b><small>Recomendado 1080×1080 px, hasta 4 MB</small></span>}<input type="file" accept="image/jpeg,image/png" onChange={(e) => chooseImage(e.target.files?.[0] ?? null)}/></label>{imageError && <p className="field-note warning">{imageError}</p>}</div>
        <div className="field"><label>Título <span className="char-count">{form.headline.length}/60</span></label><input maxLength={60} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })}/></div>
        <div className="field"><label>Texto principal <span className="char-count">{form.primaryText.length}/500</span></label><textarea maxLength={500} value={form.primaryText} onChange={(e) => setForm({ ...form, primaryText: e.target.value })}/></div>
        <div className="field"><label>Presupuesto diario</label><div className="money-input"><b>$</b><input type="number" min="100" value={form.dailyBudget} onChange={(e) => setForm({ ...form, dailyBudget: Number(e.target.value) })}/><em>MXN</em></div><small>Audiencia Advantage+ en México, de 18 a 65 años.</small></div>
        <div className="estimate-box"><Gauge size={20}/><div><b>Proyección de inversión</b><p>{money(estimatedMonth)} al mes; tu límite es {money(organization.monthlyLimit)}.</p></div><span className={estimatedMonth <= organization.monthlyLimit ? "safe" : "over"}>{estimatedMonth <= organization.monthlyLimit ? "Dentro del límite" : "Supera el límite"}</span></div>
      </div>}
      {step === 3 && <div className="form-step review-step">
        {preview && (
          // Local blob previews cannot go through next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="review-image" src={preview} alt="Imagen del anuncio"/>
        )}
        <div className="review-grid"><span><small>OFERTA</small><b>{form.offer}</b></span><span><small>OBJETIVO</small><b>{form.objective} · {destinationSummary}</b></span><span><small>INVERSIÓN DIARIA</small><b>{money(form.dailyBudget)}</b></span><span><small>TÍTULO</small><b>{form.headline}</b></span></div>
        <label className="publish-toggle"><input type="checkbox" checked={form.publish} onChange={(event) => setForm({ ...form, publish: event.target.checked })}/><span/><div><b>Publicar al terminar</b><small>{publishNote}</small></div></label>
        <div className="safety-note"><ShieldCheck size={17}/> El límite mensual y la variación máxima de 20% siempre se respetan.</div>
      </div>}
    </div>
    {submitError && <div className="modal-error"><AlertCircle size={15}/>{submitError}</div>}<div className="modal-footer"><button className="secondary-button" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? "Cancelar" : "Atrás"}</button>{step < 3 ? <button className="primary-button" disabled={!canContinue} onClick={next}>Continuar <ChevronRight size={16}/></button> : <button className="primary-button" onClick={submit} disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17}/> : <Rocket size={17}/>} {form.publish ? "Crear y publicar" : connected ? "Crear en pausa" : "Crear borrador"}</button>}</div></div></div>;
}

function ModeModal({ current, onClose, onSelect }: { current: AutomationMode; onClose: () => void; onSelect: (mode: AutomationMode) => void }) {
  const descriptions: Record<AutomationMode, string> = { observer: "Solo monitorea y explica hallazgos.", copilot: "Prepara cambios y espera tu aprobación.", autonomous: "Ejecuta optimizaciones dentro de tus límites.", yolo: "Crea y publica sin pedir aprobación." };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal mode-modal"><div className="modal-head"><div><span>NIVEL DE AUTONOMÍA</span><h2>¿Cómo debe trabajar Pulso?</h2></div><button onClick={onClose}><X size={19}/></button></div><div className="mode-list">{(["observer", "copilot", "autonomous", "yolo"] as AutomationMode[]).map((mode) => <button key={mode} className={`${mode} ${current === mode ? "selected" : ""}`} onClick={() => onSelect(mode)}><span className="mode-radio">{current === mode && <Check size={14}/>}</span><div><b>{MODE_LABELS[mode]}{mode === "autonomous" && <em>RECOMENDADO</em>}</b><p>{descriptions[mode]}</p></div>{mode === "yolo" ? <Zap size={19}/> : mode === "autonomous" ? <Bot size={19}/> : mode === "copilot" ? <Lightbulb size={19}/> : <Eye size={19}/>}</button>)}</div><div className="modal-hint"><ShieldCheck size={17}/> Los límites duros permanecen activos en todos los modos.</div></div></div>;
}
