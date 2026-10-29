"use client";
import { useState } from "react";
import { useAuth } from "./auth-context";
import { LogOut } from "lucide-react";

export function OwnerMenu({ className }: { className?: string }) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <button
        type="button"
        className={className}
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
        <LogOut aria-hidden="true" className="h-4 w-4" />
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed ? <span role="alert">Could not sign out. Try again.</span> : null}
    </div>
  );
}
