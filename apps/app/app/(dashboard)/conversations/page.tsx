import { Suspense } from "react";
import { ConversationsPage } from "@/modules/conversations/ConversationsPage";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading conversations…</p>}>
      <ConversationsPage />
    </Suspense>
  );
}
