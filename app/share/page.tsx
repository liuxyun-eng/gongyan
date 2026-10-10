import { requireUser } from "@/lib/auth";
import Share from "./share";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requireUser("/share");
  return <Share />;
}
