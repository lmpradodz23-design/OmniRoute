export interface GuardrailLog {
  debug?: (tag: string, message: string, meta?: Record<string, unknown>) => void;
  info?: (tag: string, message: string, meta?: Record<string, unknown>) => void;
  warn?: (tag: string, message: string, meta?: Record<string, unknown>) => void;
  error?: (tag: string, message: string, meta?: Record<string, unknown>) => void;
}

export interface GuardrailContext {
  apiKeyInfo?: Record<string, unknown> | null;
  disabledGuardrails?: string[] | null;
  endpoint?: string | null;
  headers?: Headers | Record<string, unknown> | null;
  log?: GuardrailLog | Console | null;
  method?: string | null;
  model?: string | null;
  provider?: string | null;
  /** Caller lifecycle signal; media bridges treat request abort as a deliberate fail-open exception. */
  signal?: AbortSignal;
  sourceFormat?: string | null;
  stream?: boolean;
  targetFormat?: string | null;
}

export interface GuardrailResult<TValue = unknown> {
  block?: boolean;
  message?: string;
  meta?: Record<string, unknown> | null;
  modifiedPayload?: TValue;
  modifiedResponse?: TValue;
}

export interface GuardrailExecutionResult {
  blocked: boolean;
  error?: string;
  guardrail: string;
  message?: string;
  meta?: Record<string, unknown> | null;
  modified: boolean;
  skipped: boolean;
  stage: "pre" | "post";
}

export class BaseGuardrail {
  enabled: boolean;
  name: string;
  priority: number;
  /**
   * A mandatory guardrail is a security control (credential masking, PII masking,
   * prompt-injection guard): the request body/headers cannot disable it — only the
   * operator's per-key policy can — and when it throws, the registry fails CLOSED
   * (the request/response is rejected) instead of passing the payload through
   * unchecked. Media bridges and custom rules default to optional.
   */
  mandatory: boolean;

  constructor(
    name: string,
    options: { enabled?: boolean; priority?: number; mandatory?: boolean } = {}
  ) {
    this.name = name;
    this.enabled = options.enabled !== false;
    this.priority = options.priority ?? 100;
    this.mandatory = options.mandatory === true;
  }

  async preCall(
    _payload: unknown,
    _context: GuardrailContext
  ): Promise<GuardrailResult<unknown> | void> {
    return { block: false };
  }

  async postCall(
    _response: unknown,
    _context: GuardrailContext
  ): Promise<GuardrailResult<unknown> | void> {
    return { block: false };
  }
}
