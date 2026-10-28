import { Suspense } from "react";
import { DevicesPage } from "@/modules/devices/DevicesPage";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading devices…</p>}>
      <DevicesPage />
    </Suspense>
  );
}
