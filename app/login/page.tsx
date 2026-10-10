import { standalone } from "@/lib/auth";
import { redirect } from "next/navigation";
import Login from "./login";
export const dynamic = "force-dynamic";
export default function Page() {
  if (!standalone()) redirect("/");
  return <Login />;
}
