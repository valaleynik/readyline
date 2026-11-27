import AuthGate from "../components/AuthGate";
import data from "../data/bank.json";
import type { ExportedBank } from "../../src/content/export";

export default function Page() {
  return <AuthGate data={data as unknown as ExportedBank} />;
}
