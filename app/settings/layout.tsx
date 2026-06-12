import { ProviderSettingsForm } from "@/components/provider-settings-form";

// The settings UI lives in the shared layout so it stays mounted while
// navigating between /settings/[section] routes. Only the section page below
// re-mounts on param change; keeping the form here avoids re-running its load
// effects and entry animation on every tab switch (no flicker). The active
// section is derived from the pathname inside the form.
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ProviderSettingsForm />
      {children}
    </>
  );
}
