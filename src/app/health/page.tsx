import { getComputed } from "@/lib/data";
import HealthView from "@/components/HealthView";

export default async function HealthPage() {
  const { computed } = await getComputed();
  return <HealthView checks={computed.healthChecks} />;
}
