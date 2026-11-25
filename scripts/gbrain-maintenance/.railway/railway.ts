import { defineRailway, preserve, project, service } from 'railway/iac';
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = 'gbrain-maintenance';
export default defineRailway(() => {
  const gbrainMaintenance = service('gbrain-maintenance', {
    build: { buildEnvironment: 'V3', builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    deploy: { cronSchedule: '30 16 * * *', restartPolicyType: 'NEVER' },
    // The secrets live in Railway. preserve() declares them so config plan
    // keeps the existing values instead of rejecting them as undeclared.
    // Add an optional variable from README.md here before setting it.
    env: {
      GBRAIN_DATABASE_URL: preserve(),
      OPENAI_API_KEY: preserve(),
      SPRITES_TOKEN: preserve(),
    },
  });

  return project('believable-joy', {
    resources: [gbrainMaintenance],
  });
});
