import type { SearchParams } from "@/lib/page-context";
import { overviewData } from "@/lib/overview-data";
import OverviewView from "@/components/OverviewView";

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <OverviewView {...await overviewData(sp.month)} />;
}
