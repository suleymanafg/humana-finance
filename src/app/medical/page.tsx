// «Медицинский отдел» — Humana sales in tins by region and prescriptions, for the
// medical team (role MEDICAL) and the owner. No money is loaded onto this page.
import { medicalData } from "@/lib/medical-data";
import MedicalView from "@/components/MedicalView";

export const dynamic = "force-dynamic";

export default async function MedicalPage() {
  return <MedicalView data={await medicalData()} />;
}
