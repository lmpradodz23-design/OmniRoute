"use client";

/**
 * Password form of the Security tab: set / update the dashboard password and, when the
 * operator is enabling "Require login" with no password yet (U3), collect that first
 * password inline so it travels in the same request as `requireLogin: true`.
 * State and submission stay in `SecurityTab`; this component only renders the form.
 */

import { Button, Input } from "@/shared/components";
import { useTranslations } from "next-intl";
import { ErrorNotice, type StatusNotice } from "./ErrorNotice";

type PasswordFields = { current: string; new: string; confirm: string };

type SecurityPasswordFormProps = {
  passwords: PasswordFields;
  onPasswordsChange: (next: PasswordFields) => void;
  passStatus: StatusNotice;
  passLoading: boolean;
  enablingLogin: boolean;
  hasPassword: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancelEnableLogin: () => void;
};

export default function SecurityPasswordForm({
  passwords,
  onPasswordsChange,
  passStatus,
  passLoading,
  enablingLogin,
  hasPassword,
  onSubmit,
  onCancelEnableLogin,
}: SecurityPasswordFormProps) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 pt-4 border-t border-border/50">
      {enablingLogin && (
        <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
          {t("requireLoginNeedsPassword")}
        </p>
      )}
      {hasPassword && (
        <Input
          label={t("currentPassword")}
          type="password"
          placeholder={t("enterCurrentPassword")}
          value={passwords.current}
          onChange={(e) => onPasswordsChange({ ...passwords, current: e.target.value })}
          required
        />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label={t("newPassword")}
          type="password"
          placeholder={t("enterNewPassword")}
          value={passwords.new}
          onChange={(e) => onPasswordsChange({ ...passwords, new: e.target.value })}
          required
        />
        <Input
          label={t("confirmPassword")}
          type="password"
          placeholder={t("confirmPasswordPlaceholder")}
          value={passwords.confirm}
          onChange={(e) => onPasswordsChange({ ...passwords, confirm: e.target.value })}
          required
        />
      </div>

      {passStatus.message && (
        <ErrorNotice
          error={passStatus}
          showDetailsLabel={tc("showDetails")}
          tone={passStatus.type === "error" ? "error" : "success"}
        />
      )}

      <div className="pt-2 flex items-center gap-2">
        <Button type="submit" variant="primary" loading={passLoading}>
          {enablingLogin ? t("enableLogin") : hasPassword ? t("updatePassword") : t("setPassword")}
        </Button>
        {enablingLogin && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancelEnableLogin}
            disabled={passLoading}
          >
            {tc("cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
