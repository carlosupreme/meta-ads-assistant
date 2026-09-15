# Pulso AI

Web app para monitorear y optimizar Facebook e Instagram Ads con agentes autónomos. Está construida con Next.js, React, TypeScript y Supabase.

## Qué incluye

- Cuentas de usuario con Supabase Auth; cada usuario tiene su propio workspace.
- Espacios multiempresa con varias cuentas publicitarias.
- OAuth real de Meta con el token cifrado en el servidor.
- Importación de cuentas, campañas, conjuntos, anuncios e Insights.
- Dashboard de inversión, ingresos atribuidos, ROAS y resultados.
- Modos Observador, Copiloto, Autónomo y YOLO por negocio.
- Motor de optimización con límites duros y explicación de cada decisión.
- Centro de alertas y registro de actividad de seis agentes.
- IA generativa con OpenAI (`gpt-5-nano` para todos por ahora).
- Creador guiado de campañas y conceptos creativos.
- Endpoint de monitoreo programable en `/api/cron/monitor`.
- Persistencia en Supabase/PostgreSQL con RLS y control de concurrencia.

## Ejecutar localmente

Pulso necesita Supabase también en desarrollo. Configura las secciones **Supabase** y **Conectar Meta** y después:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) y crea una cuenta. Las cuentas nuevas empiezan con datos demo hasta conectar Meta.

## Supabase

1. Crea un proyecto en Supabase.
2. En **SQL Editor** ejecuta, en orden, todas las migraciones de `supabase/migrations` (o `supabase db push` con Supabase CLI).
3. En **Authentication → Sign In / Providers** verifica que **Email** esté habilitado.
4. En **Authentication → URL Configuration** define el **Site URL** (por ejemplo `http://localhost:3000`) y agrega `http://localhost:3000/auth/confirm` en **Redirect URLs**.
5. En `.env.local` agrega los datos de **Project Settings → API Keys**:

   ```bash
   SUPABASE_URL=https://tu-proyecto.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

Cómo funciona:

- `middleware.ts` renueva la sesión en cada solicitud, envía a `/login` a quien no la tenga y responde `401` en las API. Cada ruta vuelve a verificar la sesión con `getClaims()` antes de tocar datos.
- El primer inicio de sesión crea el workspace del usuario (`owner_id` único y obligatorio) con datos demo.
- Al conectar Meta por primera vez se eliminan todos los datos demo (negocios, campañas, anuncios, métricas, actividad, alertas, creativos y acciones) y quedan solo las cuentas reales. Si la sincronización falla, no se guarda nada. Al reconectar después de desconectar, se conserva el historial real, incluidos los cambios de presupuesto que usan los guardrails.
- Las lecturas y escrituras usan la llave secreta solo en el servidor, siempre filtradas por el workspace del usuario autenticado. Las políticas RLS de la tabla permanecen activas como segunda barrera.
- Cada workspace se guarda como un documento JSONB. Las escrituras usan una columna de versión y reintentos optimistas para que el cron y una acción del usuario no se sobrescriban.
- Sin las variables de Supabase, la app responde `503` en lugar de quedar abierta.

`SUPABASE_SECRET_KEY` omite RLS: nunca le agregues el prefijo `NEXT_PUBLIC_` ni la uses desde el navegador. El inicio de sesión ocurre en server actions, así que tampoco la llave publicable necesita llegar al navegador.

## IA generativa con OpenAI

Pulso usa OpenAI como único proveedor. El motor de guardrails sigue siendo la autoridad final: los límites mensuales, la variación máxima de 20% y el bloqueo de borrado no dependen del modelo. OpenAI solo recibe métricas y contexto de campañas; entrega análisis, hasta tres acciones estructuradas y respuestas para el asesor conversacional.

1. Agrega la llave en el servidor (`.env.local` o Vercel):

   ```bash
   OPENAI_API_KEY=sk-...
   ```

2. Por ahora todos los workspaces usan `gpt-5-nano`, el modelo más económico de OpenAI, definido en `DEFAULT_AI_MODEL` de `lib/ai/openai.ts`. **Configuración → Modelo de IA** muestra el modelo y avisa si la llave no tiene acceso a él. Para volver a permitir que cada workspace elija, agrega modelos a `ALLOWED_AI_MODELS`; el selector reaparece cuando hay más de uno.

Pulso llama la Responses API únicamente desde el servidor y desactiva el almacenamiento de las respuestas (`store: false`).

## Conectar Meta

1. En Meta for Developers, abre tu aplicación y agrega Facebook Login y Marketing API.
2. Completa `META_APP_ID` y `META_APP_SECRET`.
3. Genera `META_TOKEN_ENCRYPTION_KEY`:

   ```bash
   openssl rand -base64 32
   ```

4. En Facebook Login registra esta URI OAuth válida:

   ```text
   http://localhost:3000/api/meta/callback
   ```

5. Reinicia el servidor y selecciona **Conexiones → Conectar con Meta**.

La integración solicita `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads` e `instagram_basic`. El token inicial se intercambia por uno de larga duración y se cifra antes de guardarse. En modo desarrollo solo funcionará con administradores, desarrolladores o testers de la app. Para ofrecer el SaaS a clientes externos habrá que completar App Review y los requisitos de acceso de Marketing API indicados por Meta.

La versión de Graph API se configura mediante `META_GRAPH_VERSION`; el valor inicial es `v26.0` para evitar acoplarla al código.

Cada sincronización también trae los fondos de cada cuenta publicitaria: si es de prepago, el método de pago tal como lo describe Meta, el saldo disponible, el gasto acumulado y el tope de gasto. El **Resumen** los muestra y avisa cuando una cuenta de prepago tiene $0, porque sus anuncios no se entregan. Una recarga en el Administrador de anuncios aparece en Pulso cuando Meta ya la acreditó y se vuelve a sincronizar.

## Funcionamiento del agente

Cada ciclo sigue el mismo recorrido:

1. **Sincroniza** campañas, conjuntos, anuncios e Insights (el cron lo hace antes de decidir).
2. **Planea** con reglas deterministas (`lib/optimizer.ts`) y, si OpenAI está configurado, suma hasta tres acciones estructuradas propuestas por el modelo.
3. **Valida** cada propuesta con los guardrails. Nada, ni reglas, ni IA, ni aprobaciones manuales, los evita.
4. **Resuelve según el modo**: Observador solo sugiere; Copiloto deja la propuesta en **Agentes IA → Aprobaciones pendientes** (expira en 48 h); Autónomo y YOLO ejecutan en Meta.
5. **Registra** razón, impacto, resultado o motivo del bloqueo en el registro de cambios.

Reglas del planeador:

| Situación | Acción |
| --- | --- |
| Gasto del mes ≥ límite | Pausa todas las campañas activas |
| Proyección a fin de mes > límite | Reduce primero las campañas con menor rendimiento hasta ajustar el ritmo |
| Más de 3 días de presupuesto sin resultados | Pausa la campaña |
| ROAS < 80% de la meta (o CPA 50% sobre el promedio) con 2 días de datos | Reduce 20% |
| Anuncio con frecuencia ≥ 4 y CTR < 70% de la mediana | Pausa el anuncio (fatiga) |
| Anuncio sin resultados que gastó más que su campaña en un día mientras otros convierten | Pausa el anuncio |
| ROAS ≥ 120% de la meta, tendencia estable y margen en el límite | Aumenta hasta 15% |
| Campaña que Pulso pausó por el límite mensual, en un mes nuevo con margen | La reactiva |
| Anuncio que Pulso pausó por fatiga hace 7 días o más, con su campaña activa | Lo reactiva |

Pulso solo deshace pausas propias: nunca reactiva lo que pausaste tú (desde Pulso o desde Meta) ni las pausas por falta de resultados, que no generan datos nuevos mientras están detenidas. Cualquier pausa vigente se puede reactivar con **Reactivar** en el registro de cambios, siempre sujeta a los guardrails.

Guardrails obligatorios:

- La proyección mensual nunca supera el límite establecido.
- Variación máxima de 20% por campaña, acumulada en 24 horas (historial en `budgetChanges`).
- Nunca se elimina nada; solo se pausa.
- Nunca se pausa el último anuncio activo de un conjunto.
- Las campañas con presupuesto total (lifetime) no se modifican.
- Con presupuesto por conjunto (ABO), el cambio se reparte proporcionalmente entre los conjuntos activos.

Un candado en el workspace impide que el cron y una ejecución manual optimicen al mismo tiempo. La ROAS objetivo se configura por negocio en **Configuración**.

```bash
npm test   # pruebas del planeador y los guardrails
```

El monitor se ejecuta con `GET /api/cron/monitor` y `Authorization: Bearer $CRON_SECRET`; ver **Desplegar gratis en Vercel** para programarlo.

## Control desde Pulso

En **Campañas** se administra todo sin abrir el Administrador de anuncios:

- **Estado de campañas**: pausa o reactiva con el botón de cada fila.
- **Filtro por página**: una cuenta publicitaria suele tener campañas de varias Páginas (incluidas publicaciones promocionadas). La sincronización detecta la Página de cada anuncio, por su creativo o por el id de la publicación, y la tabla permite filtrar por cualquiera de las Páginas que administra el perfil; cada campaña muestra sus Páginas bajo el nombre.
- **Anuncios**: la flecha de cada campaña muestra sus anuncios con gasto, CTR, frecuencia y resultados de 7 días, y permite pausarlos o reactivarlos.
- **Presupuesto diario**: haz clic en el monto para editarlo. Con presupuesto por conjunto, el cambio se reparte proporcionalmente.

Cada cambio se aplica en Meta al momento (`/api/control`) y queda en el registro como tuyo, así los agentes nunca lo deshacen. Tus cambios no están sujetos al 20% de los agentes, pero sí al límite mensual, igual que cualquier reactivación. Cuando fijas un presupuesto, el 20% de los agentes se mide desde ese nuevo valor. Puedes pausar incluso el último anuncio de un conjunto; los agentes no.

## Renovación de creativos

Pausar anuncios fatigados no basta si el conjunto se queda sin anuncios frescos. Pulso los reemplaza:

- **Detección**: un conjunto necesita renovación cuando tiene señales de fatiga (frecuencia ≥ 4 o una pausa por fatiga en curso) y le queda como máximo un anuncio activo sin fatiga. No se renueva el mismo conjunto más de una vez por semana.
- **Variante con IA**: con OpenAI configurado, el agente Creativos escribe texto nuevo a partir del mejor anuncio del conjunto (mismo producto y oferta, sin inventar precios ni testimonios) y propone un anuncio nuevo con la misma imagen, destino y botón.
- **Aprobación**: publicar texto con tu marca requiere una persona. La propuesta queda en **Aprobaciones pendientes** en Copiloto y Autónomo, se publica sola solo en YOLO y en Observador es una recomendación.
- **Manual**: en **Campañas**, dentro de la lista de anuncios, **Nuevo anuncio con texto renovado** permite elegir el anuncio base, pedir tres ángulos con **Sugerir con IA** o escribir el texto, y subir otra imagen si hace falta.

La sincronización guarda el `object_story_spec` de cada anuncio. Solo se clonan anuncios de imagen con enlace (Página, enlace e imagen); los de video, carrusel o catálogo se renuevan desde el creador de campañas.

## Creador y publicación

Con datos demo, el creador simula el lanzamiento. Con Meta conectado, **siempre crea la campaña real**: sube la imagen a la biblioteca de la cuenta publicitaria y arma campaña, conjunto (Advantage+ en México, 18–65 años), creativo con imagen y anuncio.

| Objetivo | Campaña | Conjunto | Botón del anuncio | Requisito |
| --- | --- | --- | --- | --- |
| Ventas | `OUTCOME_SALES` | Conversión Purchase del Pixel, destino sitio web | Comprar → tu URL | Pixel/dataset con Purchase |
| Prospectos | `OUTCOME_LEADS` | `LEAD_GENERATION` en el anuncio | Registrarte → formulario instantáneo | Formulario activo en la Página |
| Mensajes | `OUTCOME_ENGAGEMENT` | `CONVERSATIONS` en WhatsApp o Messenger | Enviar mensaje | WhatsApp Business vinculado a la Página (solo WhatsApp) |

- **Página que publica**: el creador lista todas las Páginas que administra el perfil conectado (las suyas y las de portafolios comerciales autorizados) y preselecciona la página predeterminada del negocio, que se cambia en **Configuración**. La sincronización conserva la página elegida mientras el perfil la siga administrando; si nunca se eligió, usa la página con nombre parecido a la cuenta publicitaria o la primera.
- La imagen es obligatoria: JPG o PNG de hasta 4 MB (Vercel limita las solicitudes a 4.5 MB). Recomendado 1080×1080 px.
- El título (hasta 60 caracteres) y el texto principal se prellenan según el objetivo y se pueden editar.
- Todo se crea en pausa; **Publicar al terminar** lo activa. Sin publicar, la campaña queda en Meta en pausa, lista para activarse.
- El presupuesto queda en el conjunto y se registra así, para que los agentes lo administren desde el primer ciclo.
- Si Meta rechaza el conjunto, el creativo o el anuncio, Pulso borra la campaña vacía que alcanzó a crear y muestra la explicación de Meta (por ejemplo, que la Página no tiene WhatsApp Business vinculado). Si solo falla la activación, todo queda en pausa para evitar gasto accidental.
- Los formularios instantáneos se leen con el permiso `pages_manage_ads`. Si conectaste Meta antes de este cambio, desconecta y vuelve a conectar para otorgarlo.

## Creador de campañas guiado con IA

**Nueva campaña** guía al dueño del negocio en cuatro pasos:

1. **Negocio**: qué promociona, cliente ideal, zona, sitio web (opcional), detalles y la Página que publica. **Recomendar con IA** (`POST /api/ai/campaign-plan`) propone objetivo, público, presupuesto diario y consejos, con la razón de cada uno. Las ubicaciones e intereses que sugiere se buscan en Meta y solo se usan los que Meta reconoce; si la IA propone Ventas sin Pixel o sin sitio web, se cambia a Mensajes.
2. **Público**: objetivo, edad, género, ubicaciones (país, estado o ciudad con radio de 17 km) e intereses, con buscador conectado a Meta (`GET /api/meta/targeting-search`). Con **Advantage+** (predeterminado), la edad y los intereses son sugerencias que Meta puede ampliar, la edad mínima firme es de hasta 25 y el género lo optimiza Meta. Con **público exacto** se aplican tal cual.
   Con **Prospectos**, si la Página no tiene formularios (o se quiere uno nuevo), **Crear formulario nuevo** arma el formulario instantáneo ahí mismo: nombre, título y descripción de bienvenida, datos que pide (nombre, correo, teléfono, ciudad), hasta 3 preguntas para calificar (respuesta libre u opción múltiple), tipo **Más volumen** o **Mayor intención**, aviso de privacidad (Meta lo exige; Pulso lo recuerda por negocio) y pantalla de agradecimiento con botón al sitio web. **Sugerir con IA** (`POST /api/ai/lead-form`) propone los textos y las preguntas. Se crea en la Página con `POST /api/meta/lead-forms` (token de Página vía `pages_manage_ads`) y queda elegido para la campaña.
3. **Anuncio**: foto (JPG/PNG hasta 4 MB) o video (MP4/MOV hasta 50 MB). **Sugerir copy** (`POST /api/ai/ad-copy`) envía a la IA una versión reducida de la foto o un cuadro del video y devuelve tres opciones con ángulos distintos.
4. **Confirmar** y publicar o crear en pausa.

Los videos no pasan por Vercel (límite de 4.5 MB por petición): el navegador los sube a Supabase Storage (bucket privado `pulso-ad-media`, se crea solo) con una URL firmada (`POST /api/media/video-upload`), Meta los descarga con `file_url`, Pulso espera a que terminen de procesarse (hasta 150 s) y usa el cuadro capturado como portada. El archivo temporal se borra al terminar.

## Vista por página

Además de la cuenta publicitaria, el menú lateral tiene un selector **Página** con las páginas que tienen campañas en esa cuenta (y las campañas sin página detectada). Al elegir una, el Dashboard (inversión, ingresos, ROAS, resultados y gráfica), Campañas y Agentes IA (tarjetas, revisión por campaña y el análisis campaña por campaña) muestran solo sus campañas. El límite mensual, los fondos y la proyección siguen siendo de toda la cuenta, porque así los cobra Meta. La gráfica por página suma las series diarias por campaña que guarda la sincronización (`campaignMetrics`), así que requiere sincronizar una vez después de actualizar. Nueva campaña preselecciona la página elegida.

## Equipo de agentes

Cada tarjeta en **Agentes IA** muestra un diagnóstico en vivo con los mismos umbrales con los que el agente actúa, su estado (al día, alerta o sin datos) y **Ver decisiones**, que abre su historial con el estado actual de cada cambio:

| Agente | Qué vigila y hace |
| --- | --- |
| Supervisor | Proyección del mes contra el límite; reduce el ritmo, pausa al tope y reactiva el mes siguiente |
| Estratega | Propuestas de estrategia con IA (requiere OpenAI) y registro de campañas creadas |
| Analista | Campañas con más de tres días de presupuesto sin resultados y anuncios que no convierten |
| Presupuesto | Campañas bajo la meta (reduce 20%) y la mejor sobre la meta (escala hasta 15%) |
| Audiencias | Frecuencia promedio por campaña; alerta desde 3 (solo avisa, no cambia nada) |
| Creativos | Anuncios con fatiga (frecuencia ≥ 4): pausa, reactiva tras 7 días y crea variantes con IA |

## Revisión por campaña

Cada análisis (manual o del monitor) deja en **Agentes IA → Revisión por campaña** un veredicto y un mensaje para **todas** las campañas del negocio, también las que van bien, ordenadas con los problemas primero y filtrables por veredicto:

| Veredicto | Cuándo |
| --- | --- |
| Atención | ROAS bajo 80% de la meta (o costo por resultado 50% sobre el promedio), gasto sin resultados o una reducción/pausa en este análisis |
| Vigilar | Ligeramente bajo la meta, o un cambio frenado por los límites |
| Aprendiendo | Todavía no junta dos días de presupuesto |
| Sin datos | No ha gastado |
| En meta / Excelente | En meta, o 20% por encima y candidata a escalar |
| Pausada / Borrador | Sin evaluación mientras no entregue; indica si la pausó Pulso y cuándo se reactivaría |

En **Agentes IA**, **Analizar campaña por campaña** primero revisa la cuenta completa (límite, ritmo y reglas) y después, con OpenAI configurado, analiza **cada campaña por separado** (`POST /api/agents/review`, una petición por campaña para no chocar con el tiempo máximo de Vercel). Cada tarjeta muestra el avance en vivo y se reemplaza con el veredicto y resumen de la IA (etiqueta **IA**) y, si los datos lo justifican, una acción que pasa por los mismos guardrails y respeta el modo: en Copiloto se aprueba o rechaza desde la misma tarjeta. Si la campaña ya tiene una acción de los agentes abierta o de las últimas 24 h, la IA no propone otra. Se puede detener a la mitad; los borradores y campañas sin gasto conservan la revisión por reglas.

Cada mensaje incluye la métrica contra la meta, anuncios con frecuencia alta y, si hubo, la acción de ese análisis con su estado. Se guarda solo la revisión más reciente por negocio, así los ciclos horarios no llenan el registro de actividad.

## Trabajo visible

Cada ciclo registra, por negocio y por día, cuántas veces se revisó la cuenta, cuántas campañas y anuncios activos se vigilaron, las verificaciones del ritmo de gasto contra el límite mensual, las señales de riesgo (fatiga, gasto sin resultados, bajo rendimiento o ritmo excedido) y los cambios aplicados o frenados. Se guardan cinco semanas.

- El **Resumen** muestra la semana en curso y la barra lateral la última revisión.
- El **reporte público** y el **correo semanal** lo cuentan en una frase: "Pulso revisó tu cuenta 168 veces, vigiló 48 anuncios en 6 campañas…". Una semana sin cambios se comunica como una buena semana, no como silencio.
- Una recomendación o un bloqueo que se repite dentro de 24 horas no se vuelve a registrar ni a contar, así los ciclos horarios no inflan las cifras ni llenan el registro.

## Reportes para clientes

En **Reportes**, cada negocio tiene:

- **Enlace compartible**: página pública de solo lectura en `/r/<token>` con los últimos 7 días (inversión, ingresos, ROAS, gráfica diaria), el uso del presupuesto del mes, las campañas y el trabajo de los agentes. El token es aleatorio (192 bits), no da acceso a Pulso, no se indexa y se puede **generar de nuevo** o **desactivar** en cualquier momento.
- **PDF**: el botón **Descargar PDF** de esa página abre el diálogo de impresión con estilos preparados para guardar como PDF.
- **Marca**: nombre de agencia y color principal, compartidos por todos los negocios del workspace.
- **Resumen semanal por correo**: hasta 20 correos por negocio. Cada persona recibe su propio mensaje con los indicadores de la semana y el enlace al reporte. Se envía los lunes (`/api/cron/weekly-report`) o con **Enviar ahora**.

Para activarlo:

1. Ejecuta la migración `supabase/migrations/202609130002_create_pulso_report_links.sql`. Los enlaces viven en una tabla con RLS y sin políticas: solo el servidor los lee.
2. Crea una cuenta en [Resend](https://resend.com), verifica tu dominio y crea una API key.
3. Agrega en el servidor:

   ```bash
   RESEND_API_KEY=re_...
   REPORTS_FROM_EMAIL="Reportes <reportes@tudominio.com>"
   ```

El cron semanal no reenvía un negocio si ya se envió en los últimos 6 días, y usa claves de idempotencia de Resend para que un reintento no duplique correos.

## Desplegar gratis en Vercel

El plan Hobby de Vercel ejecuta Next.js completo (páginas, API, middleware y cron). Es para uso personal o no comercial; cuando cobres a clientes, cambia a Pro.

1. **Supabase**
   - Ejecuta todas las migraciones de `supabase/migrations`.
   - En **Authentication → URL Configuration**, cambia el **Site URL** a `https://tu-app.vercel.app` y agrega `https://tu-app.vercel.app/auth/confirm` en **Redirect URLs**.
2. **GitHub y Vercel**
   - Sube el repositorio a GitHub.
   - En [vercel.com/new](https://vercel.com/new) importa el repo; Vercel detecta Next.js automáticamente.
3. **Variables de entorno** (Vercel → Settings → Environment Variables, entorno Production):

   | Variable | Valor |
   | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | `https://tu-app.vercel.app` |
   | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Desde Supabase → API Keys |
   | `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` | Desde tu app de Meta |
   | `META_TOKEN_ENCRYPTION_KEY` | Un valor fijo; si cambia, los tokens de Meta guardados dejan de descifrarse |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `OPENAI_API_KEY` | Tu llave de OpenAI |
   | `RESEND_API_KEY`, `REPORTS_FROM_EMAIL` | Desde Resend, con dominio verificado |

   `NEXT_PUBLIC_APP_URL` se fija al compilar: si la agregas después del primer despliegue, vuelve a desplegar.
4. **Meta**: en Facebook Login → Settings agrega `https://tu-app.vercel.app/api/meta/callback` a las URI de redirección OAuth válidas.
5. **Monitoreo cada hora**: Hobby solo permite el cron diario de `vercel.json`. Para revisar límites cada hora, crea un trabajo en [cron-job.org](https://cron-job.org):
   - URL: `https://tu-app.vercel.app/api/cron/monitor`, método `GET`, cada hora.
   - Encabezado: `Authorization: Bearer <tu CRON_SECRET>`.
   - cron-job.org corta la espera a los 30 s. Con muchas cuentas puede marcar timeout aunque el análisis termine en Vercel; confírmalo en los logs del proyecto.

## Comandos de calidad

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
