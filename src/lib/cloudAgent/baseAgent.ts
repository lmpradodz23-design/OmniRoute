import { randomBytes } from "node:crypto";
import { guardedFetch } from "@/shared/network/guardedFetch";
import { areIntegrationPrivateUrlsAllowed } from "@/shared/network/outboundUrlGuardPolicy";
import type {
  CloudAgentTask,
  CloudAgentStatus,
  CloudAgentSource,
  CloudAgentResult,
  CloudAgentActivity,
} from "./types.ts";

export interface AgentCredentials {
  apiKey: string;
  baseUrl?: string;
}

export interface CreateTaskParams {
  prompt: string;
  source: CloudAgentSource;
  options: {
    autoCreatePr?: boolean;
    planApprovalRequired?: boolean;
    environment?: Record<string, string>;
  };
}

export interface GetStatusResult {
  status: CloudAgentStatus;
  externalId?: string;
  result?: CloudAgentResult;
  activities: CloudAgentActivity[];
  error?: string;
}

/** Bound on the time to response headers for any cloud-agent REST call. */
const CLOUD_AGENT_TIMEOUT_MS = 60_000;

export interface AgentRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export abstract class CloudAgentBase {
  abstract readonly providerId: string;
  abstract readonly baseUrl: string;

  /**
   * SSRF S-6: the single egress for every adapter. `credentials.baseUrl` is operator data
   * (cloud_agent_credentials.base_url), so the target is validated by its RESOLVED address
   * (cloud metadata never; private/LAN under the local-first integration policy), the
   * connection is pinned to it and redirects are never followed. Adapters keep consuming a
   * real `Response`; a guard decision surfaces as `OutboundUrlGuardError`.
   */
  protected agentFetch(url: string, init: AgentRequestInit = {}): Promise<Response> {
    return guardedFetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      timeoutMs: CLOUD_AGENT_TIMEOUT_MS,
      allowPrivate: areIntegrationPrivateUrlsAllowed(),
    });
  }

  abstract createTask(
    params: CreateTaskParams,
    credentials: AgentCredentials
  ): Promise<CloudAgentTask>;

  abstract getStatus(externalId: string, credentials: AgentCredentials): Promise<GetStatusResult>;

  abstract approvePlan(externalId: string, credentials: AgentCredentials): Promise<void>;

  abstract sendMessage(
    externalId: string,
    message: string,
    credentials: AgentCredentials
  ): Promise<CloudAgentActivity>;

  abstract listSources(
    credentials: AgentCredentials
  ): Promise<{ name: string; url: string; branch?: string }[]>;

  protected mapStatus(status: string): CloudAgentStatus {
    const statusLower = status.toLowerCase();

    if (statusLower.includes("completed") || statusLower.includes("done")) {
      return "completed";
    }
    if (statusLower.includes("failed") || statusLower.includes("error")) {
      return "failed";
    }
    if (statusLower.includes("cancelled") || statusLower.includes("canceled")) {
      return "cancelled";
    }
    if (
      statusLower.includes("running") ||
      statusLower.includes("active") ||
      statusLower.includes("executing")
    ) {
      return "running";
    }
    if (
      statusLower.includes("pending") ||
      statusLower.includes("queued") ||
      statusLower.includes("waiting")
    ) {
      return "queued";
    }
    if (statusLower.includes("approval") || statusLower.includes("plan")) {
      return "awaiting_approval";
    }

    return "queued";
  }

  protected generateTaskId(): string {
    // Cryptographically secure suffix (not Math.random) — task IDs flow into
    // session/external identifiers, so they must be unpredictable (CodeQL js/insecure-randomness).
    return `task_${Date.now()}_${randomBytes(8).toString("hex")}`;
  }

  protected generateActivityId(): string {
    return `act_${Date.now()}_${randomBytes(8).toString("hex")}`;
  }
}
