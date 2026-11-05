import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Android build skeleton (BC-01). The Capacitor shell is created by BC-10; until then there is
 * nothing to build. This script says so plainly instead of pretending, and fails as soon as a
 * Capacitor project exists but the build step has not been written (so the skeleton cannot be
 * forgotten once there is something to build).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const project = join(root, "packages", "android", "android");
if (!existsSync(project)) {
  console.log("android-build: SKELETON. packages/android/android does not exist yet (the Capacitor shell arrives in BC-10). Nothing to build; this is not a build result.");
  process.exit(0);
}
console.error("android-build: a Capacitor project exists, but this script has no Gradle build step yet. Add it (BC-10).");
process.exit(1);
