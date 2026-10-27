import type { DeviceAccessStore, DeviceSession } from "./device-access.types";
import { revalidateDeviceSession } from "./device-access.use-cases";

export const DEVICE_REVALIDATION_INTERVAL_MS = 15_000;
/** Transport owns connection close; fail closed within 20s even if persistence hangs. */
export function watchDeviceSession(
  session: DeviceSession,
  store: DeviceAccessStore,
  close: () => void,
) {
  let stopped = false,
    checking = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function reject() {
    if (!stopped) {
      stop();
      close();
    }
  }
  const timer = setInterval(() => {
    if (stopped || checking) return;
    checking = true;
    deadline = setTimeout(reject, 5_000);
    deadline.unref?.();
    void revalidateDeviceSession(session, store)
      .catch(reject)
      .finally(() => {
        clearTimeout(deadline);
        checking = false;
      });
  }, DEVICE_REVALIDATION_INTERVAL_MS);
  timer.unref?.();
  function stop() {
    stopped = true;
    clearInterval(timer);
    clearTimeout(deadline);
  }
  return stop;
}
