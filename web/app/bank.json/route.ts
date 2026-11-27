// The question bank the app ships with, at a stable address for the agency-dashboard
// function. Same file the app bundles, so the server and the app always agree.
import data from "../../data/bank.json";

export const dynamic = "force-static";

export function GET() {
  return Response.json(data);
}
