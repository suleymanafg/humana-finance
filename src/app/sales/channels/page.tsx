import SalesView from "@/components/SalesView";
import { salesData } from "@/lib/sales-data";
import type { SearchParams } from "@/lib/page-context";

export default async function SalesChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  const { month } = await searchParams;
  const { props } = await salesData(month);
  return <SalesView tab="channels" {...props} />;
}
