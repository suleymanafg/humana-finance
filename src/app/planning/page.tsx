import { redirect } from "next/navigation";

// The section's landing screen is «Решения» (the design canvas makes it the
// entry point); the IBP worksheet moved to /planning/plan. Nav links and
// bookmarks pointing at /planning keep working through this redirect.
export default function PlanningIndex() {
  redirect("/planning/decisions");
}
