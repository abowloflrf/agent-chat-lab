export const settingsSections = ["model", "tools", "appearance", "stats", "conversations"] as const;

export type SettingsSection = (typeof settingsSections)[number];

export const defaultSettingsSection: SettingsSection = "model";

export function isSettingsSection(value: string): value is SettingsSection {
  return (settingsSections as readonly string[]).includes(value);
}

export const settingsSectionLabels: Record<
  SettingsSection,
  { full: string; short: string }
> = {
  model: { full: "模型配置", short: "模型" },
  tools: { full: "工具配置", short: "工具" },
  appearance: { full: "外观设置", short: "外观" },
  stats: { full: "用量统计", short: "用量" },
  conversations: { full: "会话管理", short: "会话" },
};
