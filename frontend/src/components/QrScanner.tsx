"use client";

import { Scanner } from "@yudiel/react-qr-scanner";

/** Camera QR scanner. Calls onToken with the emergency token found in a VitalID QR URL. */
export default function QrScanner({ onToken, onError }: { onToken: (token: string) => void; onError: (msg: string) => void }) {
  return (
    <div className="mx-auto max-w-xs overflow-hidden rounded-xl">
      <Scanner
        onScan={(codes) => {
          const raw = codes[0]?.rawValue || "";
          const m = raw.match(/\/e\/([A-Za-z0-9_-]+)/);
          if (m) onToken(m[1]);
          else onError("That QR isn't a VitalID card.");
        }}
        onError={(e) => onError(e instanceof Error ? e.message : "Camera unavailable")}
        constraints={{ facingMode: "environment" }}
      />
    </div>
  );
}
