import { requireUser, standalone } from "@/lib/auth";
import Workspace from "./workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await requireUser("/");
  return (
    <Workspace
      browserUpload={standalone()}
      user={{
        id: user.userId,
        name: user.fullName || user.email.split("@")[0],
      }}
    />
  );
}
