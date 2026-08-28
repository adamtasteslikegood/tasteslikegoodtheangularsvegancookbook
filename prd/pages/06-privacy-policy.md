# Page PRD: Privacy Policy

- **Route:** `/privacy-policy`
- **Rendering:** Express static HTML
- **Users:** Everyone
- **Source:** `server/public/privacy-policy.html`
- **Displayed update date:** April 13, 2026

## Purpose

This standalone legal disclosure explains data collection/use, Google OAuth and Gemini, processors, retention, security, rights, and contact. It is public and works without Angular/JavaScript. Its facts must match runtime before v0.4.12 sign-off.

## Required content

1. Operator/controller and policy scope.
2. Account, recipe/prompt, guest, usage/device/log, cookie/storage data.
3. Purposes and no-sale/no-ad statements.
4. Google API Services Limited Use disclosure.
5. Applicable legal bases.
6. Google/GCP and legal disclosure circumstances.
7. Retention and security.
8. Access/correction/deletion/revocation/portability and regional rights.
9. Children's privacy and international transfer.
10. Change notice and privacy contact.

## Google/Gemini contract

- OAuth scopes: `openid`, `userinfo.email`, `userinfo.profile` only.
- App uses subject, primary email, name, picture for account/session UI.
- No Drive/Gmail/Contacts/Calendar scopes.
- Recipe prompts go server-side to Gemini with service credentials.
- Google account attributes/tokens are not added to model prompts.
- Authentication and model processing are described separately.

## Data categories to describe accurately

- Prompts/constraints/allergens, recipes, images, cookbooks, generated notes, private personal notes.
- Guest-session IDs and guest backend records where implemented.
- Session cookie and local storage.
- IP, browser/user agent, time/log/security/rate-limit and configured monitoring data.
- Explicitly public recipe content at indexable `/r/<slug>` and `/browse`.

## Known disclosure gaps

### Guest persistence

The page says guest recipes/cookbooks remain in local storage and never leave the device until sign-in. Runtime sends guest-scoped generation/recipe/cookbook operations to Flask/Cloud SQL for jobs, ownership, duplicate enforcement, and later merge. Either runtime or approved policy language/retention/deletion must change **[TBC]**.

### Account deletion

The page promises direct in-app account/data deletion. Inspected Angular/auth routes expose logout but no deletion control/API. Add/verify the promised path or revise the disclosure **[TBC]**.

### Analytics/retention

The page claims usage analytics, a guest-mode opt-out, and deletion within 30 days. Deployed instrumentation, owner workflow, and evidence are not fully encoded; verify with operational/privacy owner **[TBC]**.

## Security wording

Claims may cover HTTPS, GCP storage controls, signed secure sessions, Secret Manager/runtime secrets, private Flask ingress, authenticated proxy/worker calls, and public allowlisting. Avoid absolute guarantees. Update location/provider text if infrastructure changes.

## Accessibility

Responsive readable document, correct heading hierarchy/table headers, safe external links, functional `privacy@tasteslikegood.org`, and links from Angular/SSR footers.

## Acceptance

1. Public standalone HTML works without auth/JS and is linked everywhere.
2. OAuth scopes and Gemini separation match runtime.
3. Guest persistence, account deletion, analytics, and retention have verified disposition.
4. Material changes update the displayed date.
5. External/legal/mail links are valid/safe.
6. Staging remains non-indexable.
