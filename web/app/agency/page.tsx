import AuthGate from "../../components/AuthGate";
import data from "../../data/bank.json";
import type { ExportedBank } from "../../../src/content/export";

export const metadata = { title: "Readyline: agency" };

export default function AgencyPage() {
  return <AuthGate data={data as unknown as ExportedBank} view="agency" />;
}
