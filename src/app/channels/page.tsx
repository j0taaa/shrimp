import { ChannelsPanel } from "@/components/channels-panel";

export default function ChannelsPage() {
  return (
    <div className="p-4 md:p-6">
      <h2 className="mb-4 text-lg font-semibold">Channels</h2>
      <ChannelsPanel />
    </div>
  );
}
