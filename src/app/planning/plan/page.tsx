import { redirect } from "next/navigation";

// The IBP plan grid became «Заказы IBP»; old links land there.
export default function OldPlanPage() {
  redirect("/planning/orders");
}
