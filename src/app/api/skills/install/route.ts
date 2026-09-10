import { NextResponse } from "next/server";
import { z } from "zod";
import { GLOBAL_SKILL_OWNER_ID, skillRegistry } from "@/lib/skills/registry";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { builtinSkills } from "@/lib/skills/builtins";

/**
 * P-8 (readiness audit): the field used to be called `handlerCode` and accepted up to
 * 50 000 characters, which read as "upload executable code". Nothing ever evaluated it —
 * the value is only a KEY into the executor's handler registry (`builtinSkills` plus
 * handlers registered in-process). The API now says so: `handler` names a registered
 * handler and an unknown name is rejected at install time instead of failing on first run.
 * `handlerCode` is still accepted as a deprecated alias with the same semantics.
 */
const HANDLER_NAME = /^[a-z][a-z0-9_-]{0,63}$/i;

const installManifestSchema = z
  .object({
    name: z.string().min(1).max(100),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "Version must be semver (e.g. 1.0.0)")
      .default("1.0.0"),
    description: z.string().max(500),
    schema: z.object({
      input: z.record(z.string(), z.unknown()).default({}),
      output: z.record(z.string(), z.unknown()).default({}),
    }),
    handler: z
      .string()
      .regex(HANDLER_NAME, "handler must name a registered skill handler")
      .optional(),
    /** @deprecated use `handler` */
    handlerCode: z
      .string()
      .regex(HANDLER_NAME, "handlerCode must name a registered skill handler")
      .optional(),
    apiKeyId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.handler && !value.handlerCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handler"],
        message: "handler is required",
      });
    }
  });

export function knownSkillHandlers(): string[] {
  return Object.keys(builtinSkills).sort();
}

export async function POST(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const rawBody = await request.json();
    const validation = validateBody(installManifestSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json(validation.error, { status: 400 });
    }

    const { name, version, description, schema, apiKeyId } = validation.data;
    const handler = (validation.data.handler ?? validation.data.handlerCode) as string;
    if (!Object.hasOwn(builtinSkills, handler)) {
      return NextResponse.json(
        {
          error: {
            code: "UNKNOWN_SKILL_HANDLER",
            message: `handler '${handler}' is not a registered skill handler`,
            handlers: knownSkillHandlers(),
          },
        },
        { status: 400 }
      );
    }

    const skill = await skillRegistry.register({
      name,
      version,
      description,
      schema: { input: schema.input, output: schema.output },
      handler,
      apiKeyId: apiKeyId || GLOBAL_SKILL_OWNER_ID,
      enabled: true,
    });

    return NextResponse.json({ success: true, id: skill.id });
  } catch (err: unknown) {
    const error = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error }, { status: 500 });
  }
}
