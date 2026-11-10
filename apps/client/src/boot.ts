import "./game/opening.ts";
import { gpuDevice } from "./game/gpu-device.ts";
import { fetchSchoolEarly } from "./game/school-early.ts";
import { onPhone } from "./phone-gate.ts";

if (onPhone()) void import("./phone-home.ts");
else {
  void gpuDevice();
  fetchSchoolEarly();
  void import("./drive.ts");
}
