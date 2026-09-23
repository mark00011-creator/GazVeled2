import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";

function humanizeCameraError(e: unknown): string {
  const err = e as DOMException & { name?: string; message?: string };
  const name = err?.name ?? "";
  const msg = (err?.message ?? String(e)).toLowerCase();
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    msg.includes("permission denied") ||
    msg.includes("notallowed")
  ) {
    return "Nincs kamera jogosultság. A böngészőben engedd a kamerát ehhez az oldalhoz (címsor / lakat ikon), majd próbáld újra. HTTPS vagy localhost kell.";
  }
  if (name === "NotFoundError" || msg.includes("requested device not found")) {
    return "Nem található kamera ezen az eszközön.";
  }
  if (name === "NotReadableError" || msg.includes("could not start video")) {
    return "A kamera foglalt (másik app használja). Zárd be a másik kamera-alkalmazást, majd próbáld újra.";
  }
  if (msg.includes("secure") || msg.includes("https")) {
    return "A kamera csak biztonságos kapcsolaton (HTTPS) érhető el.";
  }
  return err?.message || "Kamera indítási hiba";
}

export function BarcodeScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ctrlRef = useRef<IScannerControls | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    (async () => {
      try {
        if (!window.isSecureContext) {
          throw new Error("A kamera csak HTTPS-en vagy localhoston működik.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        // Jogosultság OK – streamet azonnal leállítjuk; a ZXing saját streamet nyit
        stream.getTracks().forEach((t) => t.stop());

        const ctrl = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current!,
          (res, _e, c) => {
            if (res && !stopped) {
              stopped = true;
              onResult(res.getText());
              c.stop();
            }
          },
        );
        ctrlRef.current = ctrl;
      } catch (e) {
        setErr(humanizeCameraError(e));
      }
    })();
    return () => {
      stopped = true;
      ctrlRef.current?.stop();
    };
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-3 text-white">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4" /> Vonalkód / sorszám olvasás
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <video ref={videoRef} className="flex-1 object-cover" playsInline muted autoPlay />
      {err && (
        <div className="space-y-2 bg-destructive p-4 text-center text-sm text-destructive-foreground">
          <div className="font-semibold">Kamera / jogosultság</div>
          <div>{err}</div>
          <p className="text-xs opacity-90">
            Tippek: közelebb a kódhoz, jó fény, stabil tartás. Ha a böngésző egyszer elutasította a
            kamerát, a címsorban (lakat) engedélyezd újra.
          </p>
        </div>
      )}
      <div className="p-3 text-center text-xs text-white/60">
        Igazítsa a kamerát a vonalkódra vagy a palack sorszámára
      </div>
    </div>
  );
}
