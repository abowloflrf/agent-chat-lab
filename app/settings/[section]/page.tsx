import { notFound } from "next/navigation";
import { isSettingsSection } from "@/lib/settings-sections";

// The UI is rendered by the persistent settings layout; this page only
// validates the section slug so unknown sections 404.
export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;

  if (!isSettingsSection(section)) {
    notFound();
  }

  return null;
}
