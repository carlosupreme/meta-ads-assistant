"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock,
  FileText,
  Layers,
  Lock,
  Megaphone,
  MessageCircle,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Wand2,
  X,
  Zap,
} from "lucide-react";

// Formateador de moneda en pesos mexicanos
const money = (val: number, compact = false) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(val);

export function LandingPage() {
  // Estado para la calculadora de ROI
  const [clientAccounts, setClientAccounts] = useState(6);
  const [monthlySpend, setMonthlySpend] = useState(120000); // MXN

  // Estado para tabs interactivas del cockpit
  const [activeFeatureTab, setActiveFeatureTab] = useState<
    "guardrails" | "copilot" | "fatigue" | "reports"
  >("guardrails");

  // Estado para acordeón de FAQ
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Cálculos dinámicos de la calculadora
  const roiCalculations = useMemo(() => {
    // 1. Horas ahorradas: ~2.5 hrs por cuenta por mes en monitoreo manual de pacing y fatiga
    const hoursSaved = Math.round(clientAccounts * 2.8);
    const hourlyRate = 250; // $250 MXN/hr (~$12.5 USD) salario media buyer jr
    const timeValue = hoursSaved * hourlyRate;

    // 2. Presupuesto salvado de sobregasto y fatiga: promedio 3.5% del gasto
    const budgetSaved = Math.round(monthlySpend * 0.035);

    // 3. Valor total generado al mes
    const totalValue = timeValue + budgetSaved;

    // 4. Plan sugerido y costo
    let planName = "Pro Agencia";
    let planCost = 1599; // MXN/mes
    if (clientAccounts <= 3) {
      planName = "Starter";
      planCost = 599;
    } else if (clientAccounts > 10) {
      planName = "Scale";
      planCost = 2999;
    }

    const netSavings = totalValue - planCost;
    const roiMultiplier = Math.max(1, Math.round((totalValue / planCost) * 10) / 10);

    return {
      hoursSaved,
      timeValue,
      budgetSaved,
      totalValue,
      planName,
      planCost,
      netSavings,
      roiMultiplier,
    };
  }, [clientAccounts, monthlySpend]);

  return (
    <div className="landing-root">
      {/* 1. TOP ANNOUNCEMENT BANNER */}
      <div className="landing-banner">
        <div className="landing-banner-inner">
          <span className="banner-tag">Novedad</span>
          <p>
            <b>Versión 2.0 activa:</b> Guardrails con reactivación automática, creador con subida
            de imágenes y reportes para clientes con PDF y link revocable.
          </p>
          <a href="#guardrails" className="banner-link">
            Ver detalles <ArrowRight size={13} />
          </a>
        </div>
      </div>

      {/* 2. STICKY NAVBAR */}
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link href="/" className="landing-brand">
            <div className="landing-brand-mark">
              <Sparkles size={18} />
            </div>
            <span>PULSO</span>
            <span className="landing-ai-pill">AI</span>
          </Link>

          <nav className="landing-nav">
            <a href="#beneficios">Beneficios</a>
            <a href="#guardrails">Guardrails</a>
            <a href="#multicuenta">Multicuenta</a>
            <a href="#calculadora">Calculadora ROI</a>
            <a href="#precios">Planes</a>
            <a href="#faq">Preguntas</a>
          </nav>

          <div className="landing-header-actions">
            <Link href="/login" className="landing-btn-ghost">
              Entrar
            </Link>
            <Link href="/login?mode=signup" className="landing-btn-primary">
              Probar Demo Gratis
            </Link>
          </div>
        </div>
      </header>

      {/* 3. HERO SECTION */}
      <section className="landing-hero">
        <div className="landing-hero-backdrop" />
        <div className="landing-hero-content">
          <div className="landing-badge">
            <ShieldCheck size={15} />
            <span>El copiloto de Meta Ads para agencias y media buyers en México y LATAM</span>
          </div>

          <h1 className="landing-hero-title">
            Nunca más pagues de tu bolsillo un sobregasto en <span className="gradient-text">Meta Ads</span>.
          </h1>

          <p className="landing-hero-subtitle">
            El sistema operativo que protege los presupuestos de tus clientes con <b>límites duros</b>,
            detecta fatiga creativa 24/7 y genera <b>reportes profesionales en 1 clic</b>. Escala lo que funciona
            sin miedo a dejar campañas activas el fin de semana.
          </p>

          <div className="landing-hero-cta">
            <Link href="/login?mode=signup" className="landing-btn-hero">
              <Sparkles size={18} />
              <span>Probar Cuentas Demo Gratis</span>
              <ArrowRight size={17} />
            </Link>

            <a href="#precios" className="landing-btn-hero-secondary">
              <CircleDollarSign size={18} />
              <span>Ver planes</span>
            </a>
          </div>

          <div className="landing-hero-trust">
            <span>
              <Check size={14} className="green" /> Sin tarjeta requerida
            </span>
            <span>
              <Check size={14} className="green" /> Meta Marketing API Oficial
            </span>
            <span>
              <Check size={14} className="green" /> Configuración en 2 minutos
            </span>
            <span>
              <Check size={14} className="green" /> Pago fácil con SPEI o Factura
            </span>
          </div>

          {/* HERO COCKPIT SHOWCASE */}
          <div className="landing-cockpit-wrap">
            <div className="landing-cockpit-window">
              <div className="cockpit-header">
                <div className="cockpit-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="cockpit-title-bar">
                  <Lock size={12} />
                  <span>pulso.ai/workspace/casa-norte • Modo Copiloto Activo</span>
                </div>
                <div className="cockpit-meta-status">
                  <span className="live-dot" />
                  <span>Meta Sincronizado</span>
                </div>
              </div>

              {/* COCKPIT PREVIEW CONTENT */}
              <div className="cockpit-body">
                {/* Upper banner preview */}
                <div className="cockpit-banner-mock">
                  <div className="cockpit-banner-left">
                    <span className="badge-shield">
                      <ShieldCheck size={16} /> GUARDRAIL ACTIVO
                    </span>
                    <h4>Presupuesto del mes protegido: Casa Norte México</h4>
                    <p>
                      Inversión proyectada a fin de mes: <b>$73,400</b> de <b>$80,000 MXN</b>. Ritmo saludable.
                    </p>
                  </div>
                  <div className="cockpit-banner-right">
                    <div className="cockpit-health-circle">
                      <strong>96</strong>
                      <small>Salud</small>
                    </div>
                  </div>
                </div>

                {/* KPI Cards */}
                <div className="cockpit-kpi-grid">
                  <div className="cockpit-kpi-card">
                    <span>Inversión Mes</span>
                    <strong>$42,680</strong>
                    <small>53% de $80,000 MXN</small>
                    <div className="cockpit-progress-bar">
                      <i style={{ width: "53%" }} />
                    </div>
                  </div>
                  <div className="cockpit-kpi-card">
                    <span>Ingresos Atribuidos</span>
                    <strong className="green-text">$148,920</strong>
                    <small>+18.4% vs semana anterior</small>
                  </div>
                  <div className="cockpit-kpi-card">
                    <span>ROAS Real</span>
                    <strong className="purple-text">3.49×</strong>
                    <small>Meta de la cuenta: 3.00×</small>
                  </div>
                  <div className="cockpit-kpi-card">
                    <span>Fatiga Detectada</span>
                    <strong className="orange-text">2 Anuncios</strong>
                    <small>Pausados para evitar desperdicio</small>
                  </div>
                </div>

                {/* Floating highlights over cockpit */}
                <div className="cockpit-floating-tag left">
                  <Sparkles size={14} />
                  <span>
                    <b>Copiloto:</b> ¿Aprobar aumento del 15% en Remarketing? (+1.51× ROAS)
                  </span>
                </div>

                <div className="cockpit-floating-tag right">
                  <FileText size={14} />
                  <span>
                    <b>Reporte semanal listo:</b> Enlace público con tu marca generado
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. INTEGRATIONS / COMPATIBILITY STRIP */}
      <section className="landing-integrations">
        <div className="landing-integrations-inner">
          <p>CONECTIVIDAD NATIVA CON EL ECOSISTEMA DE PUBLICIDAD DE META</p>
          <div className="integration-badges">
            <div className="int-badge">
              <Megaphone size={16} /> Facebook Ads
            </div>
            <div className="int-badge">
              <Sparkles size={16} /> Instagram Ads
            </div>
            <div className="int-badge">
              <Target size={16} /> Pixel & Conversiones API
            </div>
            <div className="int-badge">
              <MessageCircle size={16} /> Campañas a WhatsApp
            </div>
            <div className="int-badge">
              <Zap size={16} /> Formularios Instantáneos (Leads)
            </div>
            <div className="int-badge">
              <Layers size={16} /> Advantage+ Shopping
            </div>
          </div>
        </div>
      </section>

      {/* 5. PAIN SECTION ("La pesadilla de gestionar anuncios para terceros") */}
      <section className="landing-pain-section" id="beneficios">
        <div className="landing-container">
          <div className="landing-section-header">
            <span className="section-eyebrow red">LA REALIDAD DE LAS AGENCIAS</span>
            <h2>¿Por qué Meta Ads Manager te quita el sueño?</h2>
            <p>
              Meta está diseñado para maximizar el gasto publicitario, no para proteger tu margen ni
              evitar que tu equipo cometa errores costosos.
            </p>
          </div>

          <div className="landing-pain-grid">
            <div className="pain-card">
              <div className="pain-icon red">
                <ShieldAlert size={24} />
              </div>
              <h3>El miedo al sobregasto del fin de semana</h3>
              <p>
                Un ajuste mal colocado el viernes por la tarde puede consumir el presupuesto de dos semanas
                para el lunes por la mañana. Cuando un cliente te exige el reembolso, tu margen del mes
                desaparece por completo.
              </p>
              <div className="pain-solution-tag">
                <b>Solución Pulso:</b> Pacing proyectado inquebrantable que frena el gasto antes de que supere el límite mensual.
              </div>
            </div>

            <div className="pain-card">
              <div className="pain-icon orange">
                <Activity size={24} />
              </div>
              <h3>Fatiga silenciosa que quema tu dinero</h3>
              <p>
                Los anuncios ganadores pierden fuerza poco a poco. La frecuencia sube a 4.5, el CTR se
                desploma 70% y el anuncio sigue gastando $800 pesos diarios sin generar una sola compra o lead.
              </p>
              <div className="pain-solution-tag">
                <b>Solución Pulso:</b> Detección de fatiga matemática que pausa el creativo quemado y lo deja descansar 7 días.
              </div>
            </div>

            <div className="pain-card">
              <div className="pain-icon violet">
                <FileText size={24} />
              </div>
              <h3>El calvario de los reportes cada lunes</h3>
              <p>
                Exportar CSVs de cada Business Manager, pelear con conectores lentos de Looker Studio y armar
                manualmente tablas para 8 clientes te cuesta entre 15 y 20 horas de trabajo no remunerado cada mes.
              </p>
              <div className="pain-solution-tag">
                <b>Solución Pulso:</b> Links de reporte públicos revocables con tu marca y botón de PDF en 1 solo clic.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. THE 4 PILLARS & GUARDRAILS (Interactive feature tabs) */}
      <section className="landing-guardrails-section" id="guardrails">
        <div className="landing-container">
          <div className="landing-section-header">
            <span className="section-eyebrow purple">SEGURIDAD AL 100%</span>
            <h2>Guardrails financieros: El cerebro que nunca duerme</h2>
            <p>
              A diferencia de las &ldquo;reglas automáticas&rdquo; frágiles de Meta, Pulso tiene límites duros
              grabados en código que nada puede saltarse.
            </p>
          </div>

          {/* Interactive tabs navigation */}
          <div className="feature-tabs-nav">
            <button
              type="button"
              className={activeFeatureTab === "guardrails" ? "active" : ""}
              onClick={() => setActiveFeatureTab("guardrails")}
            >
              <ShieldCheck size={18} />
              <span>1. Límites y Pacing</span>
            </button>
            <button
              type="button"
              className={activeFeatureTab === "copilot" ? "active" : ""}
              onClick={() => setActiveFeatureTab("copilot")}
            >
              <Bot size={18} />
              <span>2. Modos y Aprobaciones</span>
            </button>
            <button
              type="button"
              className={activeFeatureTab === "fatigue" ? "active" : ""}
              onClick={() => setActiveFeatureTab("fatigue")}
            >
              <Activity size={18} />
              <span>3. Control de Fatiga</span>
            </button>
            <button
              type="button"
              className={activeFeatureTab === "reports" ? "active" : ""}
              onClick={() => setActiveFeatureTab("reports")}
            >
              <Share2 size={18} />
              <span>4. Reportes para Clientes</span>
            </button>
          </div>

          {/* Interactive Tab Content */}
          <div className="feature-tab-display">
            {activeFeatureTab === "guardrails" && (
              <div className="tab-pane-content">
                <div className="tab-pane-info">
                  <span className="pill-status green">Regla Obligatoria</span>
                  <h3>Pacing Proyectado & Regla del 20%</h3>
                  <p>
                    Pulso calcula diariamente el gasto acumulado del mes más la inversión proyectada de cada
                    campaña activa. Si el ritmo amenaza con superar el límite mensual fijado, reduce
                    estratégicamente las campañas de menor rendimiento.
                  </p>
                  <ul className="feature-bullets">
                    <li>
                      <Check size={16} className="green" />
                      <b>Variación máxima de 20% en 24h:</b> Nunca altera los presupuestos de golpe para no
                      reiniciar la fase de aprendizaje de Meta.
                    </li>
                    <li>
                      <Check size={16} className="green" />
                      <b>Tope mensual infranqueable:</b> Si se alcanza el límite, pausa campañas activas de forma
                      preventiva y te avisa al instante.
                    </li>
                    <li>
                      <Check size={16} className="green" />
                      <b>Reactivación de inicio de mes:</b> Al comenzar el mes siguiente, reanuda las campañas
                      pausadas por límite de forma automática.
                    </li>
                  </ul>
                </div>
                <div className="tab-pane-preview">
                  <div className="mini-card-code">
                    <div className="code-head">
                      <span>optimizer.ts • Pacing Guardrail</span>
                      <small>Protección activa</small>
                    </div>
                    <pre>
                      <code>{`// Proyección matemática a fin de mes
const proyectado = gastoMes + (diarioActivo * diasRestantes);

if (proyectado > limiteMensual) {
  // Ajusta primero la campaña de peor ROAS
  reducirPresupuesto(campanaMasDebil, {
    maximoPermitido: 0.20, // Nunca más del 20%
    minimoDiario: $50 // Mínimo de entrega Meta
  });
}`}</code>
                    </pre>
                    <div className="code-footer">
                      <ShieldCheck size={15} /> Validado por 30 pruebas unitarias automatizadas
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeFeatureTab === "copilot" && (
              <div className="tab-pane-content">
                <div className="tab-pane-info">
                  <span className="pill-status purple">Control a tu Medida</span>
                  <h3>Elige qué tan autónomo quieres que sea Pulso</h3>
                  <p>
                    Tú decides el nivel de supervisión por cada cuenta publicitaria. Desde solo recibir
                    recomendaciones hasta dejar que Pulso ejecute ajustes mientras descansas.
                  </p>
                  <div className="modes-preview-list">
                    <div className="mode-item">
                      <b>Observador:</b> Solo analiza datos, identifica anomalías y te da ideas en el panel.
                    </div>
                    <div className="mode-item featured">
                      <b>Copiloto (Recomendado):</b> Prepara la propuesta con el antes/después y su impacto
                      financiero; tú apruebas o rechazas con 1 solo clic.
                    </div>
                    <div className="mode-item">
                      <b>Autónomo:</b> Ejecuta micro-ajustes automáticamente siempre dentro de los límites duros.
                    </div>
                  </div>
                </div>
                <div className="tab-pane-preview">
                  <div className="mini-approval-box">
                    <div className="approval-badge">PROPUESTA DE COPILOTO PENDIENTE</div>
                    <h4>Subir presupuesto de Remarketing · 30 días</h4>
                    <p>
                      Mantiene un ROAS de <b>4.12×</b> (meta: 3.00×), tendencia positiva y hay $14,000 MXN de margen
                      en el límite mensual.
                    </p>
                    <div className="budget-shift">
                      <span>$980/día</span>
                      <ArrowRight size={14} />
                      <b>$1,127/día (+15%)</b>
                    </div>
                    <div className="approval-btns">
                      <button type="button" className="btn-reject">
                        <X size={14} /> Rechazar
                      </button>
                      <button type="button" className="btn-approve">
                        <Check size={14} /> Aprobar y Aplicar en Meta
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeFeatureTab === "fatigue" && (
              <div className="tab-pane-content">
                <div className="tab-pane-info">
                  <span className="pill-status orange">Creatividad Eficiente</span>
                  <h3>Detén el sangrado de anuncios quemados</h3>
                  <p>
                    La fatiga de anuncios destruye el ROAS sin que te des cuenta. Pulso cruza frecuencia, CTR y
                    compras para proteger tu inversión antes de que el costo por adquisición se dispare.
                  </p>
                  <ul className="feature-bullets">
                    <li>
                      <Check size={16} className="green" />
                      <b>Frecuencia &ge; 4.0 y CTR &lt; 70% de la mediana:</b> Pausa el anuncio fatigado para
                      concentrar el presupuesto en los creativos vigentes.
                    </li>
                    <li>
                      <Check size={16} className="green" />
                      <b>Regla de entrega continua:</b> Pulso nunca pausará el último anuncio activo de un ad set
                      para no interrumpir la entrega del algoritmo.
                    </li>
                    <li>
                      <Check size={16} className="green" />
                      <b>Descanso de 7 días:</b> El anuncio descansa una semana y puede reactivarse con un público
                      fresco.
                    </li>
                  </ul>
                </div>
                <div className="tab-pane-preview">
                  <div className="fatigue-card-mock">
                    <div className="fatigue-header">
                      <AlertCircle size={17} className="orange-text" />
                      <b>Fatiga Creativa Detectada</b>
                    </div>
                    <div className="fatigue-row">
                      <span>Anuncio:</span> <b>Otoño · Detalle Madera</b>
                    </div>
                    <div className="fatigue-row">
                      <span>Frecuencia:</span> <b className="orange-text">4.6 (Límite: 4.0)</b>
                    </div>
                    <div className="fatigue-row">
                      <span>CTR actual:</span> <b>0.80% (Mediana: 1.80%)</b>
                    </div>
                    <div className="fatigue-row">
                      <span>Gasto sin compras:</span> <b>$3,890 MXN</b>
                    </div>
                    <div className="fatigue-status-tag">
                      <Check size={13} /> Pausado automáticamente en Meta Ads • Ahorro: ~$550/semana
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeFeatureTab === "reports" && (
              <div className="tab-pane-content">
                <div className="tab-pane-info">
                  <span className="pill-status blue">Para tus Clientes</span>
                  <h3>Reportes semanales listos con tu propia marca</h3>
                  <p>
                    Dile adiós a pasar horas creando PDFs en Canva o configurando dashboards que tus clientes
                    nunca abren. Pulso genera reportes ejecutivos limpios y comprensibles.
                  </p>
                  <ul className="feature-bullets">
                    <li>
                      <Check size={16} className="green" />
                      <b>Link público revocable (/r/token):</b> El cliente puede consultar sus resultados en
                      cualquier momento sin necesidad de tener cuenta de Pulso.
                    </li>
                    <li>
                      <Check size={16} className="green" />
                      <b>1 clic para Imprimir en PDF:</b> Estilos optimizados para generar un documento limpio y
                      formal listo para WhatsApp o correo.
                    </li>
                    <li>
                      <Check size={16} className="green" />
                      <b>Tu nombre y tu color:</b> El reporte muestra el nombre de tu agencia y tu color de acento,
                      reforzando tu profesionalismo.
                    </li>
                  </ul>
                </div>
                <div className="tab-pane-preview">
                  <div className="report-preview-box">
                    <div className="report-top">
                      <div className="report-agency-mock">
                        <span className="circle-dot" /> Tu Agencia Media
                      </div>
                      <span className="report-date-tag">Reporte Semanal</span>
                    </div>
                    <h4>Rendimiento de Publicidad · Casa Norte</h4>
                    <div className="report-mini-kpis">
                      <div>
                        <small>Inversión</small>
                        <b>$14,200</b>
                      </div>
                      <div>
                        <small>Ingresos</small>
                        <b className="green-text">$52,400</b>
                      </div>
                      <div>
                        <small>ROAS</small>
                        <b className="purple-text">3.69×</b>
                      </div>
                    </div>
                    <div className="report-agent-log-mini">
                      <small>Trabajo del equipo de medios esta semana:</small>
                      <p>✓ 1 ajuste de presupuesto para potenciar campaña ganadora</p>
                      <p>✓ 1 anuncio con fatiga pausado preventivamente</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 7. MULTI-ACCOUNT & CAMPAIGN CREATION */}
      <section className="landing-multi-section" id="multicuenta">
        <div className="landing-container">
          <div className="landing-grid-two">
            <div className="multi-text">
              <span className="section-eyebrow green">OPERACIÓN CENTRALIZADA</span>
              <h2>Gestiona 10 clientes sin saltar entre pestañas</h2>
              <p>
                Si manejas varias cuentas publicitarias, sabes lo lento que es cambiar de Business Manager en
                Meta. En Pulso tienes un selector instantáneo de organizaciones con métricas agregadas.
              </p>
              <div className="multi-points">
                <div className="point-item">
                  <div className="point-icon">
                    <Building2 size={18} />
                  </div>
                  <div>
                    <b>Espacios Multiempresa:</b> Cada cliente tiene su propio límite mensual, su ROAS objetivo y
                    su modo de automatización independiente.
                  </div>
                </div>
                <div className="point-item">
                  <div className="point-icon">
                    <Wand2 size={18} />
                  </div>
                  <div>
                    <b>Creador con Imágenes Reales:</b> Lanza campañas de Ventas con Pixel de compra, Prospectos
                    con formularios instantáneos o Mensajes a WhatsApp subiendo tus propias imágenes.
                  </div>
                </div>
                <div className="point-item">
                  <div className="point-icon">
                    <Bot size={18} />
                  </div>
                  <div>
                    <b>Asesor Estratégico en Español:</b> Pregúntale a Pulso: <i>&ldquo;¿Qué campaña debería escalar esta semana?&rdquo;</i> y recibe un análisis directo con los números reales de tu cuenta.
                  </div>
                </div>
              </div>
            </div>

            <div className="multi-visual">
              <div className="clients-stack-card">
                <div className="stack-header">
                  <Building2 size={16} />
                  <span>CUENTAS ACTIVAS MONITOREADAS</span>
                </div>
                <div className="client-item active">
                  <span className="avatar-chip cn">CN</span>
                  <div className="client-meta">
                    <b>Casa Norte México</b>
                    <small>E-commerce • Límite $80k • ROAS 3.49×</small>
                  </div>
                  <span className="status-pill green">En ritmo</span>
                </div>
                <div className="client-item">
                  <span className="avatar-chip bs">BS</span>
                  <div className="client-meta">
                    <b>Brava Studio</b>
                    <small>Leads & Citas • Límite $35k • ROAS 3.41×</small>
                  </div>
                  <span className="status-pill blue">Copiloto</span>
                </div>
                <div className="client-item">
                  <span className="avatar-chip lc">LC</span>
                  <div className="client-meta">
                    <b>Lumbre Café Gourmet</b>
                    <small>Mensajes WhatsApp • Límite $22k • ROAS 2.53×</small>
                  </div>
                  <span className="status-pill purple">Observador</span>
                </div>
                <div className="stack-footer">
                  <span>+ Conectar otra cuenta publicitaria en 1 clic</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. INTERACTIVE SAVINGS & ROI CALCULATOR */}
      <section className="landing-calc-section" id="calculadora">
        <div className="landing-container">
          <div className="landing-section-header">
            <span className="section-eyebrow violet">CALCULADORA DE RETORNO</span>
            <h2>¿Cuánto tiempo y dinero ahorra Pulso en tu agencia?</h2>
            <p>
              Calcula el impacto económico mensual según el número de cuentas y el volumen de inversión que
              gestionas.
            </p>
          </div>

          <div className="calc-container">
            {/* Sliders Area */}
            <div className="calc-controls">
              <div className="calc-slider-group">
                <div className="slider-header">
                  <label>Cuentas publicitarias administradas</label>
                  <strong>{clientAccounts} {clientAccounts === 1 ? "cuenta" : "cuentas"}</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={clientAccounts}
                  onChange={(e) => setClientAccounts(Number(e.target.value))}
                  className="calc-range"
                />
                <div className="range-marks">
                  <span>1 cuenta</span>
                  <span>10 cuentas</span>
                  <span>20 cuentas</span>
                </div>
              </div>

              <div className="calc-slider-group">
                <div className="slider-header">
                  <label>Inversión publicitaria mensual combinada</label>
                  <strong>{money(monthlySpend)} MXN</strong>
                </div>
                <input
                  type="range"
                  min="15000"
                  max="500000"
                  step="5000"
                  value={monthlySpend}
                  onChange={(e) => setMonthlySpend(Number(e.target.value))}
                  className="calc-range"
                />
                <div className="range-marks">
                  <span>$15,000</span>
                  <span>$250,000</span>
                  <span>$500,000 MXN</span>
                </div>
              </div>

              <div className="calc-disclaimer">
                <ShieldCheck size={16} />
                <p>
                  Estimaciones basadas en promedios de agencias en LATAM: 2.8 hrs/mes por cuenta ahorradas en
                  revisión de pacing y 3.5% de presupuesto protegido contra fatiga y sobregasto accidental.
                </p>
              </div>
            </div>

            {/* Results Card */}
            <div className="calc-results-card">
              <span className="calc-tag">IMPACTO MENSUAL ESTIMADO</span>

              <div className="result-metric-main">
                <small>Valor económico generado:</small>
                <strong>{money(roiCalculations.totalValue)}</strong>
                <span>al mes para tu operación</span>
              </div>

              <div className="result-breakdown">
                <div className="breakdown-row">
                  <span>
                    <Clock size={15} /> Horas de monitoreo recuperadas:
                  </span>
                  <b>{roiCalculations.hoursSaved} hrs/mes ({money(roiCalculations.timeValue)})</b>
                </div>
                <div className="breakdown-row">
                  <span>
                    <CircleDollarSign size={15} /> Presupuesto salvado de fatiga:
                  </span>
                  <b className="green-text">~{money(roiCalculations.budgetSaved)}/mes</b>
                </div>
                <div className="breakdown-row">
                  <span>
                    <Target size={15} /> Plan recomendado:
                  </span>
                  <b>
                    {roiCalculations.planName} ({money(roiCalculations.planCost)}/mes)
                  </b>
                </div>
              </div>

              <div className="roi-badge-box">
                <div className="roi-number">{roiCalculations.roiMultiplier}×</div>
                <div className="roi-text">
                  <b>Retorno sobre inversión</b>
                  <small>Generas {money(roiCalculations.netSavings)} de valor neto sobre el costo de Pulso.</small>
                </div>
              </div>

              <Link href="/login?mode=signup" className="calc-cta-btn">
                Comenzar con Cuentas Demo <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 9. PRICING & PLANS (with Pilot payment flexibility) */}
      <section className="landing-pricing-section" id="precios">
        <div className="landing-container">
          <div className="landing-section-header">
            <span className="section-eyebrow green">PRECIOS TRANSPARENTES</span>
            <h2>Planes diseñados para agencias y media buyers</h2>
            <p>Sin comisiones sobre el gasto publicitario. Un costo fijo mensual predecible.</p>
          </div>

          {/* PILOT PROGRAM FLEXIBILITY BANNER */}
          <div className="pilot-notice-banner">
            <div className="pilot-notice-icon">
              <Zap size={22} />
            </div>
            <div className="pilot-notice-copy">
              <h4>¿Quieres sumarte al Programa Piloto con tus primeras cuentas?</h4>
              <p>
                Durante nuestra fase de lanzamiento aceptamos <b>Transferencia Interbancaria (SPEI)</b>,{" "}
                <b>Factura Fiscal Mexicana (CFDI) con IVA desglosado</b> o pago acordado directo. Te
                acompañamos personalmente en el onboarding de tus primeras cuentas de Meta.
              </p>
            </div>
            <Link href="/login?mode=signup" className="pilot-notice-btn">
              Crear cuenta demo <ChevronRight size={16} />
            </Link>
          </div>

          {/* PRICING CARDS GRID */}
          <div className="pricing-grid">
            {/* PLAN 1: STARTER */}
            <div className="pricing-card">
              <div className="card-top">
                <span className="plan-name">STARTER</span>
                <p className="plan-desc">Para freelancers o negocios con 1 a 3 marcas activas.</p>
                <div className="plan-price">
                  <strong>$599</strong>
                  <span>MXN / mes</span>
                </div>
                <small className="price-usd">Aprox. $29 USD / mes</small>
              </div>

              <ul className="plan-features">
                <li>
                  <Check size={16} className="green" /> Hasta <b>3 cuentas publicitarias</b>
                </li>
                <li>
                  <Check size={16} className="green" /> Sincronización cada 12 horas
                </li>
                <li>
                  <Check size={16} className="green" /> Modos <b>Observador</b> y <b>Copiloto</b>
                </li>
                <li>
                  <Check size={16} className="green" /> Guardrails fijos de pacing y fatiga
                </li>
                <li>
                  <Check size={16} className="green" /> Acceso a datos demo inmediatos
                </li>
                <li className="dimmed">
                  <X size={16} /> Sin modo Autónomo continuo
                </li>
                <li className="dimmed">
                  <X size={16} /> Sin enlaces públicos para clientes
                </li>
              </ul>

              <div className="plan-cta">
                <Link href="/login?mode=signup" className="plan-btn secondary">
                  Probar Gratis
                </Link>
              </div>
            </div>

            {/* PLAN 2: PRO AGENCIA (FEATURED) */}
            <div className="pricing-card featured">
              <div className="featured-badge">MÁS POPULAR PARA AGENCIAS</div>
              <div className="card-top">
                <span className="plan-name">PRO AGENCIA</span>
                <p className="plan-desc">El balance ideal para agencias boutique en crecimiento.</p>
                <div className="plan-price">
                  <strong>$1,599</strong>
                  <span>MXN / mes</span>
                </div>
                <small className="price-usd">Aprox. $79 USD / mes</small>
              </div>

              <ul className="plan-features">
                <li>
                  <Check size={16} className="green" /> Hasta <b>10 cuentas publicitarias</b>
                </li>
                <li>
                  <Check size={16} className="green" /> Sincronización cada 2 horas y cron programable
                </li>
                <li>
                  <Check size={16} className="green" /> Todos los modos: <b>Observador, Copiloto y Autónomo</b>
                </li>
                <li>
                  <Check size={16} className="green" /> <b>Reportes para clientes:</b> Links (/r/token) y PDF
                </li>
                <li>
                  <Check size={16} className="green" /> Branding de tu agencia (nombre y color)
                </li>
                <li>
                  <Check size={16} className="green" /> Envío de <b>correo semanal automático</b> a clientes
                </li>
                <li>
                  <Check size={16} className="green" /> Creador multi-objetivo con subida de imágenes
                </li>
                <li>
                  <Check size={16} className="green" /> Asesor estratégico con IA en español
                </li>
              </ul>

              <div className="plan-cta">
                <Link href="/login?mode=signup" className="plan-btn primary">
                  Empezar con Plan Pro
                </Link>
              </div>
            </div>

            {/* PLAN 3: SCALE */}
            <div className="pricing-card">
              <div className="card-top">
                <span className="plan-name">SCALE</span>
                <p className="plan-desc">Para agencias consolidadas con alto volumen de cuentas.</p>
                <div className="plan-price">
                  <strong>$2,999</strong>
                  <span>MXN / mes</span>
                </div>
                <small className="price-usd">Aprox. $149 USD / mes</small>
              </div>

              <ul className="plan-features">
                <li>
                  <Check size={16} className="green" /> Hasta <b>25 cuentas publicitarias</b>
                </li>
                <li>
                  <Check size={16} className="green" /> Monitoreo continuo <b>cada hora</b>
                </li>
                <li>
                  <Check size={16} className="green" /> Todos los modos con límites personalizados
                </li>
                <li>
                  <Check size={16} className="green" /> Reportes ilimitados en PDF y correo
                </li>
                <li>
                  <Check size={16} className="green" /> <b>Onboarding asistido personalizado</b>
                </li>
                <li>
                  <Check size={16} className="green" /> Soporte prioritario directo por WhatsApp
                </li>
                <li>
                  <Check size={16} className="green" /> Factura mensual automática (CFDI)
                </li>
              </ul>

              <div className="plan-cta">
                <Link href="/login?mode=signup" className="plan-btn secondary">
                  Empezar con Scale
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10. FAQ SECTION */}
      <section className="landing-faq-section" id="faq">
        <div className="landing-container">
          <div className="landing-section-header">
            <span className="section-eyebrow violet">PREGUNTAS FRECUENTES</span>
            <h2>Todo lo que necesitas saber antes de empezar</h2>
          </div>

          <div className="faq-accordion">
            {[
              {
                q: "¿Pulso puede gastar más de lo que yo haya autorizado?",
                a: "No, en absoluto. A diferencia de las herramientas que prometen 'escalar automáticamente sin tope', el motor de Pulso fue programado con límites duros a nivel de código. Si una campaña o cuenta alcanza su límite mensual, la acción obligatoria es pausar o recortar presupuesto. El sistema tiene prohibido sobrepasar el límite configurado.",
              },
              {
                q: "¿Existe riesgo de baneo o penalización por parte de Meta?",
                a: "No. Pulso no utiliza scrapers, extensiones ocultas ni bots no autorizados. Nos conectamos exclusivamente a través de la Marketing API oficial de Meta usando tokens cifrados en el servidor con AES-256-GCM. Cada ajuste de presupuesto o estado se envía a través de los endpoints oficiales de Meta de la misma forma que lo harías tú a mano.",
              },
              {
                q: "¿Cómo funcionan los pagos mientras se activa Stripe?",
                a: "Actualmente operamos un programa piloto para agencias selectas. Puedes pagar mediante transferencia interbancaria (SPEI), pago directo o solicitar factura fiscal con IVA desglosado (CFDI). Una vez realizado tu pago, activamos tu workspace inmediatamente y te ayudamos en la conexión.",
              },
              {
                q: "¿Puedo probar la plataforma antes de conectar mis cuentas reales?",
                a: "¡Sí! Al registrarte con tu correo, tu espacio de trabajo se inicializa con datos de demostración idénticos a cuentas reales de e-commerce, captación de leads y mensajes a WhatsApp. Puedes explorar todos los paneles, probar las aprobaciones del Copiloto y generar reportes de ejemplo.",
              },
              {
                q: "¿Mis clientes sabrán que utilizo Pulso?",
                a: "Los reportes que generas y los correos semanales llevan el nombre y color de tu agencia. Pulso actúa como tu infraestructura operativa interna ('back-office'), dándote a ti el mérito de entregar reportes impecables y de nunca haberles sobregastado un peso.",
              },
              {
                q: "¿Qué sucede si decido desconectar Meta o cancelar?",
                a: "Puedes desconectar tu cuenta de Meta en cualquier momento con 1 solo clic desde la sección de Conexiones. Al desconectar, el token cifrado se elimina inmediatamente y tus campañas en Meta continúan funcionando con la configuración que tenían.",
              },
            ].map((faq, idx) => (
              <div
                key={faq.q}
                className={`faq-item ${openFaq === idx ? "open" : ""}`}
                onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
              >
                <div className="faq-question">
                  <span>{faq.q}</span>
                  <ChevronDown size={18} className="faq-arrow" />
                </div>
                {openFaq === idx && <div className="faq-answer">{faq.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 11. FINAL CTA BANNER */}
      <section className="landing-final-cta">
        <div className="landing-container">
          <div className="final-cta-box">
            <h2>Deja que tus anuncios trabajen. Deja de preocuparte por el presupuesto.</h2>
            <p>
              Crea tu cuenta demo gratis en 60 segundos o escríbenos directamente para activar el piloto en
              tu agencia con atención personalizada.
            </p>
            <div className="final-cta-btns">
              <Link href="/login?mode=signup" className="landing-btn-hero">
                <Sparkles size={17} />
                <span>Empezar con Cuentas Demo</span>
                <ArrowRight size={17} />
              </Link>
              <Link href="/login" className="landing-btn-hero-secondary light">
                <span>Ya tengo cuenta</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 12. FOOTER */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="footer-top">
            <div className="footer-brand">
              <div className="landing-brand-mark small">
                <Sparkles size={15} />
              </div>
              <span>PULSO AI</span>
              <p>Copiloto y guardrails de presupuesto para anunciantes de Meta Ads en México y LATAM.</p>
            </div>
            <div className="footer-links-col">
              <b>Producto</b>
              <a href="#beneficios">Beneficios</a>
              <a href="#guardrails">Guardrails de Seguridad</a>
              <a href="#multicuenta">Multicuenta</a>
              <a href="#calculadora">Calculadora ROI</a>
            </div>
            <div className="footer-links-col">
              <b>Acceso</b>
              <Link href="/login">Iniciar Sesión</Link>
              <Link href="/login?mode=signup">Crear Cuenta Demo</Link>
            </div>
          </div>

          <div className="footer-bottom">
            <p>© {new Date().getFullYear()} Pulso AI. Todos los derechos reservados.</p>
            <small>
              Pulso AI no está afiliado, respaldado ni administrado por Meta Platforms, Inc. Facebook e
              Instagram son marcas registradas de Meta Platforms, Inc.
            </small>
          </div>
        </div>
      </footer>

    </div>
  );
}
