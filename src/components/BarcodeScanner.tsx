import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";

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
        const ctrl = await reader.decodeFromVideoDevice(
          undefined,
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
        setErr((e as Error).message);
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
          <Camera className="h-4 w-4" /> Vonalkód olvasás
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <video ref={videoRef} className="flex-1 object-cover" playsInline muted />
      {err && (
        <div className="bg-destructive p-3 text-center text-sm text-destructive-foreground">
          {err}
        </div>
      )}
      <div className="p-3 text-center text-xs text-white/60">Igazítsa a kamerát a vonalkódra</div>
    </div>
  );
}
