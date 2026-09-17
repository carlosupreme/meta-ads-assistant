# Pulso · Backoffice

Panel interno para ver el consumo de OpenAI de cada cliente de Pulso: costo estimado, tokens, errores, por cliente, negocio, función y página, y cada llamada con la respuesta exacta de OpenAI en JSON.

Es una app Next.js independiente dentro del repo. No importa nada de la app principal y se despliega aparte.

## Qué muestra

- **Resumen** (`/`): costo, llamadas, tokens, errores y tiempo promedio del periodo; costo diario; consumo por cliente (incluye clientes que aún no usan IA), por función y por página.
- **Cliente** (`/clients/<workspace>`): lo mismo para un cliente, por negocio, y sus últimas llamadas.
- **Llamadas** (`/calls`): filtros por periodo, cliente, función y estado, 50 por página.
- **Llamada** (`/calls/<id>`): quién, dónde, tokens y costo, el texto devuelto, el resultado que usó Pulso, la respuesta completa de OpenAI y la solicitud enviada.
- **JSON**: `Descargar JSON` en cada vista (`/api/export`, hasta 5,000 llamadas con su JSON completo) y en cada llamada (`/api/calls/<id>`).

Los días se cuentan en hora de Ciudad de México. El costo se calcula al registrar cada llamada con los precios de `lib/ai/usage.ts` de la app (USD por millón de tokens); los tokens quedan guardados para recalcularlo.

## Requisitos

1. Aplicar la migración `supabase/migrations/202609170001_create_pulso_ai_logs.sql` de la app (tabla `pulso_ai_logs` y vista `pulso_ai_usage_daily`).
2. Desplegar la app principal con el logger; las llamadas empiezan a registrarse desde ese despliegue.

## Desplegar en Vercel

1. Vercel → **Add New… → Project** → el mismo repositorio.
2. **Root Directory**: `backoffice`. Framework: Next.js.
3. Variables de entorno (ver `.env.example`):
   - `SUPABASE_URL` y `SUPABASE_SECRET_KEY`: las mismas de la app.
   - `BACKOFFICE_USER` y `BACKOFFICE_PASSWORD`: acceso con usuario y contraseña del navegador; la contraseña debe tener al menos 16 caracteres o el panel no abre.
4. Deploy. Opcional: en Settings → Git → **Ignored Build Step**, `git diff --quiet HEAD^ HEAD -- .` evita redespliegues cuando solo cambia la app.

La clave secreta lee los prompts y datos de todos los clientes: no la uses en otra app pública ni compartas el acceso al panel.

## Local

```bash
cd backoffice
cp .env.example .env.local   # y completa las variables
npm install
npm run dev                  # http://localhost:3100
npm test && npm run typecheck && npm run build
```
