import { JobsPanel } from "@/components/jobs-panel";

export default function JobsPage() {
  return (
    <div className="p-4 md:p-6">
      <h2 className="mb-4 text-lg font-semibold">Jobs</h2>
      <JobsPanel />
    </div>
  );
}
