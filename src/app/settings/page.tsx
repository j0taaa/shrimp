import { SettingsPanel } from "@/components/settings-panel";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Settings</h2>
      <SettingsPanel />
    </div>
  );
}
