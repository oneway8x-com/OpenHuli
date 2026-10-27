"use client";
import { useState } from "react";
import { useAuth } from "./auth-context";

export function OwnerMenu() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void logout()
            .then(() => window.location.assign("/login"))
            .catch(() => {
              setBusy(false);
              setFailed(true);
            });
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed ? <span role="alert">Could not sign out. Try again.</span> : null}
    </div>
  );
}
