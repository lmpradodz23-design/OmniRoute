"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input, Toggle, Modal } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import ProviderIcon from "@/shared/components/ProviderIcon";
import IPFilterSection from "./IPFilterSection";
import SessionInfoCard from "./SessionInfoCard";
import AuthzSection from "./AuthzSection";
import { useTranslations } from "next-intl";
import { presentApiError, type PresentedApiError } from "@/shared/utils/apiErrorPresentation";
import { ErrorNotice, type StatusNotice } from "./ErrorNotice";
import SecurityPasswordForm from "./SecurityPasswordForm";

/** Response body as JSON, or `null` when there is none / it does not parse. */
async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function SecurityTab() {
  const [settings, setSettings] = useState<any>({ requireLogin: false, hasPassword: false });
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState<StatusNotice>({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);

  const [requireLoginModalOpen, setRequireLoginModalOpen] = useState(false);
  const [pendingRequireLoginVal, setPendingRequireLoginVal] = useState<boolean | null>(null);
  const [requireLoginPassword, setRequireLoginPassword] = useState("");
  const [requireLoginError, setRequireLoginError] = useState<PresentedApiError | null>(null);
  const [requireLoginLoading, setRequireLoginLoading] = useState(false);
  const [toggleError, setToggleError] = useState<PresentedApiError | null>(null);
  // U3: "Require login" with no password yet — the password is asked for inline and sent
  // together with `requireLogin: true`; nothing is persisted before it exists.
  const [enablingLogin, setEnablingLogin] = useState(false);
  const [newBannedKeyword, setNewBannedKeyword] = useState("");

  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const getSettingsLabel = (key: string, fallback: string) =>
    typeof t.has === "function" && t.has(key) ? t(key) : fallback;
  // `common.apiErrors.*` lookup that tolerates a missing key (older catalogs).
  const translateApiError = (key: string) =>
    typeof tc.has !== "function" || tc.has(key) ? tc(key) : null;
  const describeError = (body: unknown, fallback: string, status?: number) =>
    presentApiError(body, { translate: translateApiError, fallback, status });

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettings(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const updateRequireLogin = async (requireLogin: boolean) => {
    setToggleError(null);
    if (settings.hasPassword) {
      setPendingRequireLoginVal(requireLogin);
      setRequireLoginPassword("");
      setRequireLoginError(null);
      setRequireLoginModalOpen(true);
      return;
    }

    if (requireLogin) {
      setEnablingLogin(true);
      setPassStatus({ type: "", message: "" });
      return;
    }
    if (enablingLogin) {
      setEnablingLogin(false);
      setPasswords({ current: "", new: "", confirm: "" });
      if (settings.requireLogin !== true) return; // only cancelling the inline prompt
    }

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin }),
      });
      if (res.ok) {
        setSettings((prev: any) => ({ ...prev, requireLogin }));
      } else {
        // U4: a failed toggle used to be silent — the switch just snapped back.
        setToggleError(describeError(await readBody(res), t("errorOccurred"), res.status));
      }
    } catch (err) {
      console.error("Failed to update require login:", err);
      setToggleError(describeError(null, t("errorOccurred")));
    }
  };

  const confirmRequireLoginUpdate = async () => {
    if (pendingRequireLoginVal === null) return;
    setRequireLoginLoading(true);
    setRequireLoginError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requireLogin: pendingRequireLoginVal,
          currentPassword: requireLoginPassword,
        }),
      });

      if (res.ok) {
        setSettings((prev: any) => ({ ...prev, requireLogin: pendingRequireLoginVal }));
        setRequireLoginModalOpen(false);
      } else {
        setRequireLoginError(describeError(await readBody(res), t("errorOccurred"), res.status));
      }
    } catch (err) {
      console.error("Failed to update require login:", err);
      setRequireLoginError(describeError(null, t("errorOccurred")));
    } finally {
      setRequireLoginLoading(false);
    }
  };

  const updateSetting = async (key: string, value: any) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, [key]: value }));
      }
    } catch (err) {
      console.error(`Failed to update ${key}:`, err);
    }
  };

  const toggleBlockedProvider = (providerId: string) => {
    const current: string[] = settings.blockedProviders || [];
    const updated = current.includes(providerId)
      ? current.filter((p) => p !== providerId)
      : [...current, providerId];
    updateSetting("blockedProviders", updated);
  };

  const customBannedSignals: string[] = settings.customBannedSignals || [];

  const addBannedKeyword = () => {
    const keyword = newBannedKeyword.trim().toLowerCase();
    if (!keyword || customBannedSignals.includes(keyword)) return;
    updateSetting("customBannedSignals", [...customBannedSignals, keyword]);
    setNewBannedKeyword("");
  };

  const removeBannedKeyword = (index: number) => {
    const updated = customBannedSignals.filter((_, i) => i !== index);
    updateSetting("customBannedSignals", updated);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: t("passwordsNoMatch") });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(enablingLogin ? { requireLogin: true } : {}),
          ...(settings.hasPassword ? { currentPassword: passwords.current } : {}),
          newPassword: passwords.new,
        }),
      });
      const data = await readBody(res);
      if (res.ok) {
        setPassStatus({ type: "success", message: t("passwordUpdated") });
        setPasswords({ current: "", new: "", confirm: "" });
        setSettings((prev: any) => ({
          ...prev,
          hasPassword: true,
          requireLogin: enablingLogin ? true : prev.requireLogin,
        }));
        setEnablingLogin(false);
      } else {
        const presented = describeError(data, t("failedUpdatePassword"), res.status);
        setPassStatus({ type: "error", message: presented.message, detail: presented.detail });
      }
    } catch {
      setPassStatus({ type: "error", message: t("errorOccurred") });
    } finally {
      setPassLoading(false);
    }
  };

  const blockedProviders: string[] = settings.blockedProviders || [];
  // Stored policy, or the inline "enable login" prompt in progress (U3).
  const loginRequired = settings.requireLogin === true || enablingLogin;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              shield
            </span>
          </div>
          <h3 className="text-lg font-semibold">{t("security")}</h3>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{t("requireLogin")}</p>
              <p className="text-sm text-text-muted">{t("requireLoginDesc")}</p>
            </div>
            <Toggle
              checked={loginRequired}
              onChange={() => updateRequireLogin(!loginRequired)}
              disabled={loading}
            />
          </div>
          {toggleError && <ErrorNotice error={toggleError} showDetailsLabel={tc("showDetails")} />}

          <Modal
            isOpen={requireLoginModalOpen}
            onClose={() => !requireLoginLoading && setRequireLoginModalOpen(false)}
            title={t("currentPassword")}
          >
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-muted">{t("enterCurrentPassword")}</p>
              <Input
                label={t("currentPassword")}
                type="password"
                placeholder={t("currentPassword")}
                value={requireLoginPassword}
                onChange={(e) => setRequireLoginPassword(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && requireLoginPassword && confirmRequireLoginUpdate()
                }
                autoFocus
                disabled={requireLoginLoading}
              />
              {requireLoginError && (
                <ErrorNotice error={requireLoginError} showDetailsLabel={tc("showDetails")} />
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setRequireLoginModalOpen(false)}
                  disabled={requireLoginLoading}
                >
                  {tc("cancel")}
                </Button>
                <Button
                  variant="primary"
                  onClick={confirmRequireLoginUpdate}
                  loading={requireLoginLoading}
                  disabled={!requireLoginPassword}
                >
                  {t("confirm")}
                </Button>
              </div>
            </div>
          </Modal>

          {loginRequired && (
            <SecurityPasswordForm
              passwords={passwords}
              onPasswordsChange={setPasswords}
              passStatus={passStatus}
              passLoading={passLoading}
              enablingLogin={enablingLogin}
              hasPassword={settings.hasPassword}
              onSubmit={handlePasswordChange}
              onCancelEnableLogin={() => updateRequireLogin(false)}
            />
          )}
        </div>
      </Card>

      <IPFilterSection />

      {/* API Endpoint Protection */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              api
            </span>
          </div>
          <h3 className="text-lg font-semibold">{t("apiEndpointProtection")}</h3>
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border/50 bg-black/[0.02] dark:bg-white/[0.02] p-3 text-sm text-text-muted">
            <p className="font-medium text-text">{t("authModelHeading")}</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>{t("authModelClient")}</li>
              <li>{t("authModelManagement")}</li>
              <li>{t("authModelPublic")}</li>
            </ul>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{t("bruteForceProtection")}</p>
              <p className="text-sm text-text-muted">{t("bruteForceProtectionDesc")}</p>
            </div>
            <Toggle
              checked={settings.bruteForceProtection !== false}
              onChange={() =>
                updateSetting("bruteForceProtection", !(settings.bruteForceProtection !== false))
              }
              disabled={loading}
            />
          </div>

          <div>
            <div className="mb-2">
              <p className="font-medium">{t("corsAllowedOrigins")}</p>
              <p className="text-sm text-text-muted">{t("corsAllowedOriginsDesc")}</p>
            </div>
            <Input
              type="text"
              placeholder="https://app.example.com, https://admin.example.com"
              value={typeof settings.corsOrigins === "string" ? settings.corsOrigins : ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, corsOrigins: e.target.value }))}
              onBlur={(e) => updateSetting("corsOrigins", e.target.value.trim())}
            />
          </div>

          {/* Blocked Providers */}
          <div>
            <div className="mb-3">
              <p className="font-medium">{t("blockedProviders")}</p>
              <p className="text-sm text-text-muted">{t("blockedProvidersDesc")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.values(AI_PROVIDERS).map((provider: any) => {
                const isBlocked = blockedProviders.includes(provider.id);
                return (
                  <button
                    key={provider.id}
                    onClick={() => toggleBlockedProvider(provider.id)}
                    disabled={loading}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      isBlocked
                        ? "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
                        : "bg-black/[0.02] dark:bg-white/[0.02] border-transparent text-text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
                    }`}
                    title={
                      isBlocked
                        ? t("unblockProviderTitle", { provider: provider.name })
                        : t("blockProviderTitle", { provider: provider.name })
                    }
                  >
                    {isBlocked ? (
                      <span className="material-symbols-outlined text-[14px]">block</span>
                    ) : (
                      <ProviderIcon
                        providerId={provider.id}
                        size={14}
                        className="shrink-0"
                        style={{ color: provider.color }}
                      />
                    )}
                    {provider.name}
                    {isBlocked && (
                      <span className="material-symbols-outlined text-[12px] text-red-500">
                        close
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {blockedProviders.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">warning</span>
                {t("providersBlocked", { count: blockedProviders.length })}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Custom Banned Keywords */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              report
            </span>
          </div>
          <div>
            <h3 className="text-lg font-semibold">
              {getSettingsLabel("customBannedSignals", "Banned Keywords")}
            </h3>
            <p className="text-sm text-text-muted">
              {getSettingsLabel(
                "customBannedSignalsDesc",
                "Additional keywords that trigger permanent account ban detection. Built-in keywords always apply."
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder={getSettingsLabel(
                "customBannedSignalsPlaceholder",
                "e.g. api key revoked"
              )}
              value={newBannedKeyword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNewBannedKeyword(e.target.value)
              }
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter") addBannedKeyword();
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              icon="add"
              onClick={addBannedKeyword}
              disabled={!newBannedKeyword.trim()}
            >
              {getSettingsLabel("add", "Add")}
            </Button>
          </div>
          {customBannedSignals.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {customBannedSignals.map((keyword, index) => (
                <div
                  key={index}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
                >
                  {keyword}
                  <button
                    onClick={() => removeBannedKeyword(index)}
                    className="material-symbols-outlined text-[12px] hover:opacity-70"
                  >
                    close
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              {getSettingsLabel(
                "noCustomBannedSignals",
                "No custom keywords. Only built-in keywords are active."
              )}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined">shield</span>
          </div>
          <div>
            <p className="font-medium">
              {getSettingsLabel("credentialRedaction", "Credential Redaction")}
            </p>
            <p className="text-sm text-text-muted">
              {getSettingsLabel(
                "credentialRedactionDesc",
                "Redact API keys, tokens, and secrets from context sent to providers and from responses."
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">
              {getSettingsLabel("enableCredentialRedaction", "Enable credential redaction")}
            </p>
            <p className="text-sm text-text-muted">
              {getSettingsLabel(
                "enableCredentialRedactionDesc",
                "Scrubs API keys, tokens, private keys, and JWTs from messages, tool calls, and responses."
              )}
            </p>
          </div>
          <Toggle
            checked={settings.credentialRedactionEnabled === true}
            onChange={() =>
              updateSetting("credentialRedactionEnabled", !settings.credentialRedactionEnabled)
            }
            disabled={loading}
          />
        </div>
      </Card>

      <AuthzSection />
      <SessionInfoCard />
    </div>
  );
}
