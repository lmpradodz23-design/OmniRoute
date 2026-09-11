"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, EmptyState } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { useTranslations } from "next-intl";
import { useConfirmDialog } from "@/shared/hooks/useConfirmDialog";

interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  author?: string;
  status: string;
  enabled: boolean;
  hooks: string[];
}

export default function PluginsPage() {
  const { addNotification } = useNotificationStore();
  const t = useTranslations("plugins");
  const confirmDialog = useConfirmDialog();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins");
      if (res.ok) {
        const data = await res.json();
        setPlugins(data.plugins || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchPlugins();
    })();
  }, [fetchPlugins]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/plugins/scan", { method: "POST" });
      if (res.ok) {
        addNotification({ type: "success", message: t("pluginScanComplete") });
        await fetchPlugins();
      }
    } catch {
      addNotification({ type: "error", message: t("pluginScanFailed") });
    } finally {
      setScanning(false);
    }
  };

  const handleToggle = async (name: string, enable: boolean) => {
    const endpoint = enable ? "activate" : "deactivate";
    try {
      const res = await fetch(`/api/plugins/${name}/${endpoint}`, { method: "POST" });
      if (res.ok) {
        addNotification({
          type: "success",
          message: enable ? t("activated", { name }) : t("deactivated", { name }),
        });
        await fetchPlugins();
      }
    } catch {
      addNotification({
        type: "error",
        message: enable ? t("activateFailed", { name }) : t("deactivateFailed", { name }),
      });
    }
  };

  const handleUninstall = async (name: string) => {
    if (!(await confirmDialog(t("uninstallConfirm", { name })))) return;
    try {
      const res = await fetch(`/api/plugins/${name}`, { method: "DELETE" });
      if (res.ok) {
        addNotification({ type: "success", message: t("uninstalled", { name }) });
        await fetchPlugins();
      }
    } catch {
      addNotification({ type: "error", message: t("uninstallFailed", { name }) });
    }
  };

  if (loading) {
    return <div className="p-6">{t("loading")}</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      {/* P-2/P-3: plugins are trusted code — say so where the operator decides to run one. */}
      <div
        role="note"
        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
      >
        <p className="font-medium text-amber-700 dark:text-amber-300">{t("trustNoticeTitle")}</p>
        <p className="mt-1 text-text-muted">{t("trustNotice")}</p>
      </div>

      <div className="flex items-center justify-end">
        <Button onClick={handleScan} disabled={scanning}>
          {scanning ? t("scanning") : t("scanForPlugins")}
        </Button>
      </div>
      {plugins.length === 0 ? (
        <EmptyState title={t("noPlugins")} description={t("noPluginsDescription")} />
      ) : (
        <div className="grid gap-4">
          {plugins.map((plugin) => (
            <Card key={plugin.name} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{plugin.name}</h3>
                  <p className="text-sm text-gray-500">
                    v{plugin.version}
                    {plugin.author ? ` by ${plugin.author}` : ""}
                    {plugin.description ? ` — ${plugin.description}` : ""}
                  </p>
                  <div className="mt-1 flex gap-1">
                    {plugin.hooks.map((hook) => (
                      <span
                        key={hook}
                        className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
                      >
                        {hook}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={plugin.enabled ? "secondary" : "primary"}
                    onClick={() => handleToggle(plugin.name, !plugin.enabled)}
                  >
                    {plugin.enabled ? t("deactivate") : t("activate")}
                  </Button>
                  <Button variant="danger" onClick={() => handleUninstall(plugin.name)}>
                    {t("uninstall")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
