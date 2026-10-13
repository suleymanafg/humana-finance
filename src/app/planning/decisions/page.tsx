import { redirect } from "next/navigation";

// The section was rebuilt around two decisions on one screen; old links land there.
export default function OldPlanningPage() {
  redirect("/planning");
}
