"use client";

import SecurityTab from "../components/SecurityTab";
import BrowserAllowlistCard from "../components/browserAllowlist/BrowserAllowlistCard";

export default function SettingsSecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <SecurityTab />
      <BrowserAllowlistCard />
    </div>
  );
}
