/**
 * POST /api/browser/check — avalia uma ação de navegador pela política determinística.
 * Body: { action: BrowserAction, allowedDomains?: string[] }.
 *
 * Autenticado (management) e gated por BROWSER_USE_ENABLED. Se allowedDomains não vier no corpo,
 * usa o override persistido no painel (key_value namespace 'browser'). Efeito externo → aprovação
 * humana; efeito originado na página → deny (prompt injection não escala). Não executa nada.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getDbInstance } from "@/lib/db/core";
import { traceSync } from "@/lib/otel";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import {
  decideBrowserAction,
  type BrowserAction,
} from "@omniroute/open-sse/browser-guard/index.ts";

function storedAllowlist(): string[] {
  try {
    const row = getDbInstance()
      .prepare(
        "SELECT value FROM key_value WHERE namespace = 'browser' AND key = 'allowed_domains'"
      )
      .get() as { value: string } | undefined;
    return row?.value ? (JSON.parse(row.value) as string[]) : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("BROWSER_USE_ENABLED")) {
    return NextResponse.json(
      { error: "Browser Use is disabled. Enable BROWSER_USE_ENABLED in the OmniRoute panel." },
      { status: 404 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: Partial<BrowserAction>;
    allowedDomains?: unknown;
  };
  const a = body.action;
  if (!a || typeof a.kind !== "string" || (a.origin !== "user" && a.origin !== "page")) {
    return NextResponse.json(
      { error: "action {kind, origin: 'user'|'page', url?} is required" },
      { status: 400 }
    );
  }
  const allowedDomains = Array.isArray(body.allowedDomains)
    ? (body.allowedDomains.filter((d) => typeof d === "string") as string[])
    : storedAllowlist();

  const verdict = traceSync(
    "browser.check",
    { route: "/api/browser/check", "http.method": "POST" },
    () => decideBrowserAction(a as BrowserAction, { enabled: true, allowedDomains })
  );
  return NextResponse.json({ verdict, allowedDomains });
}
