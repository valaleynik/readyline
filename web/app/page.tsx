import StudyApp from "../components/StudyApp";
import data from "../data/bank.json";
import type { ExportedBank } from "../../src/content/export";

export default function Page() {
  return <StudyApp data={data as unknown as ExportedBank} />;
}
