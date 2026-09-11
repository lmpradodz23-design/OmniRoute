import { DashboardLayout } from "@/shared/components";
import { ConfirmDialogProvider } from "@/shared/hooks/useConfirmDialog";

export default function DashboardRootLayout({ children }) {
  // U5: one shared, translated ConfirmModal for every destructive action in the dashboard.
  return (
    <ConfirmDialogProvider>
      <DashboardLayout>{children}</DashboardLayout>
    </ConfirmDialogProvider>
  );
}
