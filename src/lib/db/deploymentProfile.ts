/**
 * deploymentProfile — is this instance EXPOSED beyond the local machine? (finding #3 residual)
 *
 * The storage-encryption gate must not depend on NODE_ENV alone: an operator who binds the
 * server to a LAN or public interface (`HOST` / `HOSTNAME` — the variables run-next.mjs and the
 * Next standalone server read) has exposed the credential store to the network and needs
 * `STORAGE_ENCRYPTION_KEY` just as much as a production build does.
 *
 * Both server entry points default to `0.0.0.0` when nothing is set. That default is reported
 * as exposed by `isExposedBind` (readiness tells the truth), but it does NOT by itself trigger
 * the fail-closed gate in a dev profile — only an EXPLICIT non-loopback bind or
 * NODE_ENV=production does, so `npm run dev` keeps its passthrough convenience.
 *
 * Pure (env injectable) so it is unit-testable.
 */

export interface BindHostResolution {
  host: string;
  /** True when the operator set HOST/HOSTNAME themselves (as opposed to the 0.0.0.0 default). */
  explicit: boolean;
}

export function resolveBindHost(env: NodeJS.ProcessEnv = process.env): BindHostResolution {
  const raw = String(env.HOST || env.HOSTNAME || "").trim();
  return raw ? { host: raw, explicit: true } : { host: "0.0.0.0", explicit: false };
}

export function isLoopbackBindHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "::ffff:127.0.0.1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

/** True when the effective bind (explicit or default) reaches beyond loopback. */
export function isExposedBind(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isLoopbackBindHost(resolveBindHost(env).host);
}

/**
 * The profile in which sensitive storage MUST be encrypted: a production build, or an operator
 * who explicitly bound the server to a non-loopback address.
 */
export function isExposedDeploymentProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return true;
  const bind = resolveBindHost(env);
  return bind.explicit && !isLoopbackBindHost(bind.host);
}
