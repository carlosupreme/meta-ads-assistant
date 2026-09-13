# Pulso AI

MVP web desktop para monitorear y optimizar Facebook e Instagram Ads con agentes autónomos. Está construido con Next.js, React y TypeScript.

## Qué incluye

- Espacios multiempresa con varias cuentas publicitarias.
- OAuth real de Meta con el token cifrado en el servidor.
- Importación de cuentas, campañas e Insights del mes.
- Dashboard de inversión, ingresos atribuidos, ROAS y resultados.
- Modos Observador, Copiloto, Autónomo y YOLO por negocio.
- Motor de optimización con límites duros y explicación de cada decisión.
- Centro de alertas y registro de actividad de seis agentes.
- Capa de IA intercambiable: OpenAI, proveedores OpenAI-compatible y adaptadores futuros.
- Creador guiado de campañas y conceptos creativos.
- Modo demo completo cuando todavía no hay credenciales.
- Endpoint de monitoreo programable en `/api/cron/monitor`.
- Persistencia en Supabase/PostgreSQL con RLS y control de concurrencia.

## Ejecutar localmente

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Sin variables de Meta, la aplicación funciona con datos demo.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor** y ejecuta el contenido de:

   ```text
   supabase/migrations/202609040001_create_pulso_workspaces.sql
   ```

   Si utilizas Supabase CLI, también puedes aplicar todas las migraciones con `supabase db push`.

3. En `.env.local` agrega los datos del panel **Project Settings → API Keys**:

   ```bash
   SUPABASE_URL=https://tu-proyecto.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   PULSO_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
   ```

4. Reinicia `npm run dev`.

Pulso detecta Supabase automáticamente. Si la tabla todavía no tiene el workspace, importa el estado local existente; si no existe, carga los datos demo. Cuando faltan las variables continúa usando `data/workspace.json`, por lo que el desarrollo local no queda bloqueado.

`SUPABASE_SECRET_KEY` puede omitir RLS y nunca debe llevar el prefijo `NEXT_PUBLIC_` ni utilizarse desde el navegador. La aplicación solo crea el cliente administrativo en rutas y componentes de servidor. También se acepta temporalmente `SUPABASE_SERVICE_ROLE_KEY` para proyectos que todavía usan la llave legacy.

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
2. Copia `.env.example` como `.env.local`.
3. Completa `META_APP_ID` y `META_APP_SECRET`.
4. Genera `META_TOKEN_ENCRYPTION_KEY`:

   ```bash
   openssl rand -base64 32
   ```

5. En Facebook Login registra esta URI OAuth válida:

   ```text
   http://localhost:3000/api/meta/callback
   ```

6. Reinicia el servidor y selecciona **Conexiones → Conectar con Meta**.

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

En Vercel, `vercel.json` ejecuta el monitor cada hora. En otro proveedor, programa una llamada `GET /api/cron/monitor` con `Authorization: Bearer $CRON_SECRET`.

## Creador y publicación

En modo demo, el creador simula el lanzamiento para validar todo el recorrido. Con una cuenta real, Pulso importa Página, Instagram y Pixel/dataset, y puede crear la estructura completa de una campaña de ventas: campaña, ad set, audiencia México, creativo de enlace y anuncio. Todos los elementos se preparan pausados y solo se activan cuando el usuario marca **Publicar automáticamente**.

Las campañas nativas de formularios y mensajes se conservan como borrador hasta agregar al onboarding la selección explícita del formulario instantáneo o número de WhatsApp. Si Meta rechaza alguna parte de una creación, los elementos que ya haya aceptado permanecen pausados para evitar gasto accidental.

## Persistencia y producción

Con Supabase configurado, cada workspace se almacena como un documento JSONB en PostgreSQL. Las escrituras utilizan una columna de versión y reintentos optimistas para impedir que el cron y una acción del usuario se sobrescriban silenciosamente. La tabla incluye `owner_id`, políticas RLS y separación por `PULSO_WORKSPACE_ID`, dejándola preparada para conectar Supabase Auth en la siguiente iteración.

Sin Supabase, `data/workspace.json` permanece como fallback de desarrollo. Antes de abrir el SaaS a clientes externos todavía se debe agregar autenticación y obtener el workspace desde la sesión en lugar de una variable del servidor.

## Comandos de calidad

```bash
npm run typecheck
npm run lint
npm run build
```
