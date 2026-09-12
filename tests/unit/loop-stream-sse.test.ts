import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgUiEvent } from "../../open-sse/ag-ui/index.ts";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-loop-sse-"));
process.env.DATA_DIR = DATA_DIR;

const { getDbInstance } = await import("../../src/lib/db/core.ts");
const flags = await import("../../src/lib/db/featureFlags.ts");
const loopStream = await import("../../src/app/api/loop/[id]/stream/route.ts");
const loopRunner = await import("../../src/lib/loopRunner.ts");
const { validateEventSequence, TERMINAL_EVENTS } = await import("../../open-sse/ag-ui/index.ts");

function ensureSchema(): void {
  const dir = path.join(process.cwd(), "src/lib/db/migrations");
  const file = fs.readdirSync(dir).find((f) => f.endsWith("_loop_engine_and_buzz_bridge.sql"));
  assert.ok(file, "loop engine / buzz bridge migration not found in src/lib/db/migrations");
  getDbInstance().exec(fs.readFileSync(path.join(dir, file), "utf8"));
  flags.setFeatureFlagOverride("LOOP_ENGINE_ENABLED", "true");
}

interface SseFrame {
  id?: number;
  event?: AgUiEvent;
  comment?: string;
  retry?: number;
}

function parseFrame(block: string): SseFrame {
  const frame: SseFrame = {};
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) frame.comment = line.slice(1).trim();
    else if (line.startsWith("id: ")) frame.id = Number(line.slice(4));
    else if (line.startsWith("retry: ")) frame.retry = Number(line.slice(7));
    else if (line.startsWith("data: ")) frame.event = JSON.parse(line.slice(6)) as AgUiEvent;
  }
  return frame;
}

/** Cliente SSE mínimo: lê o corpo INCREMENTALMENTE via getReader(), com prazo (nunca pendura). */
class SseClient {
  readonly frames: SseFrame[] = [];
  closed = false;
  private buffer = "";
  private pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  private readonly decoder = new TextDecoder();
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(res: Response) {
    assert.ok(res.body, "resposta sem corpo");
    this.reader = res.body.getReader();
  }

  get events(): AgUiEvent[] {
    return this.frames.flatMap((f) => (f.event ? [f.event] : []));
  }

  get lastId(): number | undefined {
    return this.frames.filter((f) => f.id !== undefined).at(-1)?.id;
  }

  hasEvent(type: AgUiEvent["type"]): boolean {
    return this.events.some((e) => e.type === type);
  }

  async readUntil(done: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!done()) {
      assert.equal(this.closed, false, "stream fechou antes da condição esperada");
      await this.pump(deadline - Date.now());
    }
  }

  readToClose(timeoutMs = 5_000): Promise<void> {
    return this.readUntil(() => this.closed, timeoutMs);
  }

  cancel(): Promise<void> {
    return this.reader.cancel();
  }

  private async pump(remainingMs: number): Promise<void> {
    assert.ok(remainingMs > 0, "timeout esperando frames SSE");
    this.pending ??= this.reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), remainingMs);
    });
    const result = await Promise.race([this.pending, timeout]);
    clearTimeout(timer);
    if (result === null) return;
    this.pending = null;
    if (result.done) {
      this.closed = true;
      return;
    }
    this.buffer += this.decoder.decode(result.value, { stream: true });
    let cut = this.buffer.indexOf("\n\n");
    while (cut !== -1) {
      this.frames.push(parseFrame(this.buffer.slice(0, cut)));
      this.buffer = this.buffer.slice(cut + 2);
      cut = this.buffer.indexOf("\n\n");
    }
  }
}

function openStream(runId: string, init: RequestInit = {}): Promise<Response> {
  return loopStream.GET(new Request(`http://localhost/api/loop/${runId}/stream`, init) as never, {
    params: Promise.resolve({ id: runId }),
  });
}

/** Timers vivos no processo (setTimeout/setInterval aparecem como "Timeout"). */
function activeTimeouts(): number {
  return process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
}

/** discover→plan→split→execute (efeito none: aprovado)→checkpoint→verify→(veredito ok) done. */
function advanceToDone(runId: string, stepId: string): void {
  for (let i = 0; i < 5; i++) loopRunner.advanceRun(runId);
  loopRunner.advanceRun(runId, { verdict: { stepId, approved: true, reason: "ok" } });
}

test("loop stream SSE: frames chegam antes do fim; run done -> RUN_FINISHED e fecha", async () => {
  ensureSchema();
  const run = loopRunner.startRun({ pattern: "sse-incremental" });
  const withStep = loopRunner.addStep(run.id, { title: "revisar issues" });

  const res = await openStream(run.id);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") || "", /text\/event-stream/);
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(res.headers.get("X-Accel-Buffering"), "no");

  const client = new SseClient(res);
  await client.readUntil(() => client.hasEvent("STATE_SNAPSHOT"));
  assert.equal(client.closed, false, "stream não pode fechar com o run ainda aberto");
  assert.equal(
    client.events.some((e) => TERMINAL_EVENTS.has(e.type)),
    false,
    "nenhum evento terminal enquanto o run não terminou"
  );
  assert.equal(client.events[0].type, "RUN_STARTED");
  assert.match(JSON.stringify(client.events), /revisar issues/);
  assert.ok(
    client.frames.some((f) => (f.retry ?? 0) > 0),
    "campo retry: ausente"
  );

  advanceToDone(run.id, withStep.steps[0].id);
  assert.equal(loopRunner.getLoopRun(run.id)!.status, "done");

  await client.readToClose();
  const events = client.events;
  assert.equal(events.at(-1)!.type, "RUN_FINISHED");
  const delta = events.find((e) => e.type === "STATE_DELTA");
  assert.ok(delta && delta.type === "STATE_DELTA", "mudança do run deve virar STATE_DELTA");
  assert.equal(delta.patch.status, "done");
  assert.match(JSON.stringify(events), /revisar issues \(verified\)/);
  assert.deepEqual(validateEventSequence(events), { ok: true, errors: [] });
});

test("loop stream SSE: run já terminal (failed) -> RUN_ERROR e fecha sem polling", async () => {
  ensureSchema();
  const run = loopRunner.startRun({ pattern: "sse-failed" });
  loopRunner.addStep(run.id, { title: "apagar", proposedEffect: { kind: "delete", summary: "x" } });
  for (let i = 0; i < 4; i++) loopRunner.advanceRun(run.id);
  assert.equal(loopRunner.getLoopRun(run.id)!.status, "failed");

  const baseline = activeTimeouts();
  const client = new SseClient(await openStream(run.id));
  await client.readToClose();
  const events = client.events;
  assert.deepEqual(
    events.map((e) => e.type),
    [
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "STATE_SNAPSHOT",
      "RUN_ERROR",
    ]
  );
  assert.deepEqual(validateEventSequence(events), { ok: true, errors: [] });
  assert.equal(activeTimeouts(), baseline, "run terminal não agenda polling");
});

test("loop stream SSE: abort do Request para o polling e fecha sem vazar timers", async () => {
  ensureSchema();
  const run = loopRunner.startRun({ pattern: "sse-abort" });
  loopRunner.addStep(run.id, { title: "a" });

  const baseline = activeTimeouts();
  const ac = new AbortController();
  const client = new SseClient(await openStream(run.id, { signal: ac.signal }));
  await client.readUntil(() => client.hasEvent("STATE_SNAPSHOT"));
  assert.equal(activeTimeouts(), baseline + 3, "poll + heartbeat + tempo máximo ativos");

  ac.abort();
  await client.readToClose(1_000);
  assert.equal(activeTimeouts(), baseline, "abort deve limpar todos os timers");
});

test("loop stream SSE: cancel() do leitor limpa os timers", async () => {
  ensureSchema();
  const run = loopRunner.startRun({ pattern: "sse-cancel" });

  const baseline = activeTimeouts();
  const client = new SseClient(await openStream(run.id));
  await client.readUntil(() => client.hasEvent("STATE_SNAPSHOT"));
  assert.equal(activeTimeouts(), baseline + 3);
  await client.cancel();
  assert.equal(activeTimeouts(), baseline, "cancel() deve limpar todos os timers");
});

test("loop stream SSE: Last-Event-ID retoma sem repetir seq e 204 após o terminal", async () => {
  ensureSchema();
  const run = loopRunner.startRun({ pattern: "sse-resume" });
  loopRunner.addStep(run.id, { title: "apagar", proposedEffect: { kind: "delete", summary: "x" } });

  const ac = new AbortController();
  const first = new SseClient(await openStream(run.id, { signal: ac.signal }));
  await first.readUntil(() => first.hasEvent("STATE_SNAPSHOT"));
  ac.abort();
  await first.readToClose(1_000);
  const lastId = first.lastId;
  assert.equal(typeof lastId, "number", "frames devem carregar id:");
  assert.equal(lastId, first.events.at(-1)!.seq, "id: do fim do bloco = seq do STATE_SNAPSHOT");

  loopRunner.advanceRun(run.id); // muda o run enquanto o cliente está desconectado

  const second = new SseClient(
    await openStream(run.id, { headers: { "Last-Event-ID": String(lastId) } })
  );
  await second.readUntil(() => second.hasEvent("STATE_SNAPSHOT"));
  assert.equal(second.hasEvent("RUN_STARTED"), false, "RUN_STARTED já visto não se repete");
  assert.ok(
    second.events.every((e) => e.seq > lastId!),
    "nenhum seq <= Last-Event-ID"
  );

  for (let i = 0; i < 3; i++) loopRunner.advanceRun(run.id); // -> execute -> deny -> failed
  assert.equal(loopRunner.getLoopRun(run.id)!.status, "failed");
  await second.readToClose();
  assert.equal(second.events.at(-1)!.type, "RUN_ERROR");
  assert.deepEqual(validateEventSequence([...first.events, ...second.events]), {
    ok: true,
    errors: [],
  });

  const terminalId = second.lastId;
  assert.equal(terminalId, second.events.at(-1)!.seq);
  const after = await openStream(run.id, { headers: { "Last-Event-ID": String(terminalId) } });
  assert.equal(after.status, 204, "terminal já entregue: 204 faz o EventSource parar");
});

test("loop stream SSE: heartbeat, tempo máximo com terminal e resume na mesma versão", async () => {
  ensureSchema();
  const { loopRunSseResponse } = await import("../../src/lib/loopRunStream.ts");
  const run = loopRunner.startRun({ pattern: "sse-lifetime" });
  loopRunner.addStep(run.id, { title: "a" });
  const current = loopRunner.getLoopRun(run.id)!;
  const url = `http://localhost/api/loop/${run.id}/stream`;

  const baseline = activeTimeouts();
  const client = new SseClient(
    loopRunSseResponse(current, new Request(url), {
      pollMs: 20,
      heartbeatMs: 25,
      maxLifetimeMs: 250,
    })
  );
  await client.readToClose(3_000);
  assert.ok(
    client.frames.some((f) => f.comment === "ping"),
    "heartbeat de comentário SSE ausente"
  );
  const terminal = client.events.at(-1)!;
  assert.equal(terminal.type, "RUN_ERROR");
  assert.match(terminal.type === "RUN_ERROR" ? terminal.message : "", /max lifetime/);
  assert.equal(client.frames.at(-1)!.id, undefined, "terminal de tempo não avança Last-Event-ID");
  assert.deepEqual(validateEventSequence(client.events), { ok: true, errors: [] });
  assert.equal(activeTimeouts(), baseline, "tempo máximo deve limpar todos os timers");

  const snapshotId = client.lastId!;
  const resumed = new SseClient(
    loopRunSseResponse(
      current,
      new Request(url, { headers: { "Last-Event-ID": String(snapshotId) } }),
      { pollMs: 20, heartbeatMs: 1_000, maxLifetimeMs: 150 }
    )
  );
  await resumed.readToClose(3_000);
  assert.deepEqual(
    resumed.events.map((e) => e.type),
    ["RUN_ERROR"],
    "mesma versão: nada já visto é reenviado"
  );
  assert.deepEqual(validateEventSequence([...client.events.slice(0, -1), ...resumed.events]), {
    ok: true,
    errors: [],
  });
  assert.equal(activeTimeouts(), baseline);
});
