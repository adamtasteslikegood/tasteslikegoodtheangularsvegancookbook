import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "gbrain-maintenance";
export default defineRailway(() => {
  const gbrainMaintenance = service("gbrain-maintenance", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { cronSchedule: "30 16 * * *", restartPolicyType: "NEVER" },
  });

  return project("believable-joy", {
    variables: { managed: false },
    resources: [gbrainMaintenance],
  });
});
