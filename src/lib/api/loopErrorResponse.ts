/**
 * Mapeia erros do Loop Runner para o envelope de erro padrão da API (`createErrorResponse`).
 *
 * Conflito de versão (escritor desatualizado) ou de estado/política → 409; run/etapa
 * inexistente → 404; qualquer outra falha → 500 com mensagem genérica (Hard Rule #12:
 * nunca a mensagem crua de um erro desconhecido).
 */
import { createErrorResponse } from "@/lib/api/errorResponse";
import { LoopRunConflictError } from "@/lib/db/loopEngine";
import { LoopNotFoundError, LoopStateError } from "@/lib/loopRunner";

export function loopErrorResponse(error: unknown): Response {
  if (error instanceof LoopRunConflictError || error instanceof LoopStateError) {
    return createErrorResponse({ status: 409, message: error.message, type: "conflict" });
  }
  if (error instanceof LoopNotFoundError) {
    return createErrorResponse({ status: 404, message: error.message, type: "not_found" });
  }
  return createErrorResponse({ status: 500, message: "Loop Engine request failed" });
}
