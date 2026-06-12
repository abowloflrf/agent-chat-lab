import { redirect } from "next/navigation";
import { defaultSettingsSection } from "@/lib/settings-sections";

export default function SettingsPage() {
  redirect(`/settings/${defaultSettingsSection}`);
}
