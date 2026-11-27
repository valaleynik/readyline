import { createRoot } from "react-dom/client";
import StudyApp from "../components/StudyApp";
import data from "../data/bank.json";
import type { ExportedBank } from "../../src/content/export";

createRoot(document.getElementById("root")!).render(<StudyApp data={data as unknown as ExportedBank} />);
