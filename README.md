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
- Capa de IA intercambiable: OpenAI, proveedores OpenAI-compatible y adaptadores futuros.
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
- El primer inicio de sesión crea el workspace del usuario (`owner_id` único y obligatorio).
- Las lecturas y escrituras usan la llave secreta solo en el servidor, siempre filtradas por el workspace del usuario autenticado. Las políticas RLS de la tabla permanecen activas como segunda barrera.
- Cada workspace se guarda como un documento JSONB. Las escrituras usan una columna de versión y reintentos optimistas para que el cron y una acción del usuario no se sobrescriban.
- Sin las variables de Supabase, la app responde `503` en lugar de quedar abierta.

`SUPABASE_SECRET_KEY` omite RLS: nunca le agregues el prefijo `NEXT_PUBLIC_` ni la uses desde el navegador. El inicio de sesión ocurre en server actions, así que tampoco la llave publicable necesita llegar al navegador.

## IA generativa y proveedores

Pulso mantiene el motor de seguridad local como autoridad final: los límites mensuales, la variación máxima de 20% y el bloqueo de borrado de campañas no dependen de un modelo de IA. El proveedor generativo únicamente recibe métricas y contexto de campañas; entrega análisis, recomendaciones y respuestas para el asesor conversacional.

Para habilitar OpenAI agrega en `.env.local`:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=tu_api_key
OPENAI_MODEL=gpt-6-astra
```

Después reinicia el servidor. En **Agentes IA** aparecerá OpenAI como conectado y podrás preguntar sobre la cuenta seleccionada. Pulso usa la Responses API solo desde el servidor y desactiva el almacenamiento de las respuestas.

La capa es intercambiable. Para un endpoint compatible con OpenAI:

```bash
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://tu-proveedor.example/v1
AI_API_KEY=tu_api_key
AI_MODEL=nombre-del-modelo
```

Gemini y un proveedor propio ya tienen contrato y estado visibles en la interfaz; únicamente falta añadir sus clientes concretos en `lib/ai/`, sin cambiar agentes, rutas ni interfaz.

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

La integración solicita `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement` e `instagram_basic`. El token inicial se intercambia por uno de larga duración y se cifra antes de guardarse. En modo desarrollo solo funcionará con administradores, desarrolladores o testers de la app. Para ofrecer el SaaS a clientes externos habrá que completar App Review y los requisitos de acceso de Marketing API indicados por Meta.

La versión de Graph API se configura mediante `META_GRAPH_VERSION`; el valor inicial es `v26.0` para evitar acoplarla al código.

## Funcionamiento del agente

Cada ciclo sigue el mismo recorrido:

1. **Sincroniza** campañas, conjuntos, anuncios e Insights (el cron lo hace antes de decidir).
2. **Planea** con reglas deterministas (`lib/optimizer.ts`) y, si hay proveedor de IA, suma hasta tres acciones estructuradas propuestas por el modelo.
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

## Creador y publicación

Con datos demo, el creador simula el lanzamiento para validar todo el recorrido. Con una cuenta real, Pulso importa Página, Instagram y Pixel/dataset, y puede crear la estructura completa de una campaña de ventas: campaña, ad set, audiencia México, creativo de enlace y anuncio. Todos los elementos se preparan pausados y solo se activan cuando el usuario marca **Publicar automáticamente**.

Las campañas nativas de formularios y mensajes se conservan como borrador hasta agregar al onboarding la selección explícita del formulario instantáneo o número de WhatsApp. Si Meta rechaza alguna parte de una creación, los elementos que ya haya aceptado permanecen pausados para evitar gasto accidental.

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
   | `AI_PROVIDER` y sus llaves | Igual que en `.env` |

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
