import { isDeviceOnline } from "@/lib/runtime/engine";
import { runtimes } from "@/lib/runtime/host";
import { bufferLength } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe used by the platform healthcheck and by the dashboard indicator. */
export async function GET() {
  return Response.json(
    {
      status: "ok",
      service: "autopilot-control-center",
      version: "1.0.0",
      runtime: {
        devicesOnline: [...runtimes.values()].filter((r) => isDeviceOnline(r.deviceId)).length,
        liveDevices: runtimes.size,
        eventBuffer: bufferLength(),
      },
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
