"use client";

import { LocaleProvider } from "@/lib/i18n";
import { AppShell } from "@/components/layout/app-shell";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <AppShell>{children}</AppShell>
    </LocaleProvider>
  );
}
