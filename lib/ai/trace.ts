import type { WorkspaceSession } from "../auth";
import type { Organization, WorkspaceData } from "../types";
import { AI_VIEWS, forOrganization, type AiTrace, type AiView } from "./usage";

/** Header the browser sets when one API route serves several views. */
export const VIEW_HEADER = "x-pulso-view";

// Routes used from a single view. /api/agents/run serves the dashboard and Agentes IA, so it relies on VIEW_HEADER.
const VIEW_BY_ROUTE: Record<string, AiView> = {
  "/api/agents/review": "agents",
  "/api/ai/ask": "agents",
  "/api/ai/campaign-plan": "new-campaign",
  "/api/ai/ad-copy": "new-campaign",
  "/api/ai/lead-form": "new-campaign",
  "/api/creatives/variants": "campaigns",
};

/** Trace for a call made while serving a signed-in person's request. */
export function requestTrace(request: Request, session: WorkspaceSession, organization?: Pick<Organization, "id" | "name">): AiTrace {
  const route = new URL(request.url).pathname;
  const header = request.headers.get(VIEW_HEADER);
  const view = AI_VIEWS.find((item) => item === header) ?? VIEW_BY_ROUTE[route];
  const trace: AiTrace = { workspaceId: session.workspaceId, ownerEmail: session.user.email || undefined, route, view, trigger: "user" };
  return organization ? forOrganization(trace, organization) : trace;
}

/** Trace for the scheduled monitor, which runs without anyone signed in. */
export function cronTrace(workspaceId: string, workspace: Pick<WorkspaceData, "user">, route: string): AiTrace {
  return { workspaceId, ownerEmail: workspace.user.email || undefined, route, view: "monitor", trigger: "cron" };
}
