// «Медицинский отдел» — Humana sales in tins by region and prescriptions (foils)
// by region, rep and doctor, for the medical director (role MEDICAL) and the
// owner. The month chosen at the top ends the period, the tables and the
// reps' reports.
import { pageContext, type SearchParams } from "@/lib/page-context";
import { medicalData } from "@/lib/medical-data";
import MedicalView from "@/components/MedicalView";

export const dynamic = "force-dynamic";

export default async function MedicalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  return <MedicalView data={await medicalData(ctx.monthId)} />;
}
