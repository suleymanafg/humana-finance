import SalesView from "@/components/SalesView";
import { salesData } from "@/lib/sales-data";
import type { SearchParams } from "@/lib/page-context";

export default async function SalesOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const { month } = await searchParams;
  const { props } = await salesData(month, { withClients: true });
  return <SalesView tab="overview" {...props} />;
}
