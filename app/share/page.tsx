import { requireUser, standalone } from "@/lib/auth";
import { redirect } from "next/navigation";
import Share from "./share";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requireUser("/share");
  if (!standalone()) redirect("http://127.0.0.1:6062/");
  return <Share />;
}
