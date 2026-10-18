# Privacy Policy

Tasteslikegood.org — VeganGenius Chef | Last updated: September 29, 2026

## 1. Who We Are

[www.tasteslikegood.org](/) (also referred to as **VeganGenius Chef**) is a vegan AI recipe generator web application that helps users discover, generate, and manage plant-based recipes using Google's Gemini AI. In this Privacy Policy, Tasteslikegood.org is referred to as "we", "us", or "our", and the user is referred to as "you".

We are the controller of personal data collected through this application.

---

## 2. Scope of This Privacy Policy

This Privacy Policy applies to all personal data collected when you use [www.tasteslikegood.org](/), including when you sign in with Google, generate recipes, save cookbooks, or use the application as a guest. By using our service, you agree to the collection and use of information in accordance with this policy.

---

## 3. Information We Collect

### 3.1 Account Information (Google Sign-In Users)

When you sign in with Google, we receive the following information from Google, based on the OAuth scopes you authorize:

| Scope              | What it allows                                                       | What we use it for                                  |
| ------------------ | -------------------------------------------------------------------- | --------------------------------------------------- |
| `openid`           | Confirms your Google identity                                        | User authentication and session management          |
| `userinfo.email`   | Your primary Google Account email address                            | Account creation, login identification, and contact |
| `userinfo.profile` | Your name and public profile information (including profile picture) | Displaying your name and avatar in the app          |

**No personal information from your Google Account is sent to the Gemini AI model.** Only the recipe prompt you type (e.g., "make a vegan pasta dish") is securely sent by our servers to Gemini to generate a recipe. All AI generation requests are made using a server-side API key managed by Tasteslikegood.org — not your personal Google account credentials or quota.

We do not request any other Google API scopes. We do not access your Google Drive, Gmail, Contacts, Calendar, or any other Google services.

### 3.2 Recipe Inputs and Prompts

Text you type into the recipe generator, including ingredients, dietary preferences, allergens, cooking constraints, and recipe prompts. This content is processed by Google Gemini AI to generate recipes and is stored in your account to populate your cookbook.

### 3.3 Guest User Data (No Account Required)

You may use the application without signing in. In this case:

- No Google Account data is collected
- Your recipes and cookbooks are stored locally in your browser's `localStorage`
- This data never leaves your device unless you choose to sign in, at which point it is migrated to your account
- Clearing your browser storage will permanently delete guest data

### 3.4 Usage and Analytics Data

Pages viewed, features used, recipes generated, and timestamps of activity. This data is used to operate and improve the service.

**Optional performance analytics (opt-in).** If, and only if, you choose “Allow analytics” in the analytics banner, we measure page load speed and errors, the pages you view, which recipes are viewed and saved, and how you arrived (the referring site and the standard campaign tags in the link: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` and `utm_term`), using Datadog Real User Monitoring. Until you allow it, the Datadog code is not loaded and nothing is sent. Page addresses are sent without their query strings, apart from those five campaign tags. We do not record your screen (no session replay), we do not record what you type or the text of what you click, and we do not use this data for advertising.

With that opt-in, the measurements are relayed through our servers to Datadog together with your IP address (used by Datadog to derive an approximate location: country and city) and your browser, operating system and device type. None of this is shared with Datadog if you do not allow analytics.

### 3.5 Device and Browser Information

Browser type, operating system, device type, IP address, and server log information. This is used for security, debugging, and abuse prevention.

### 3.6 Cookies and Similar Technologies

We use essential session cookies to maintain your login state. We may use preference cookies to remember your settings. We do not use third-party advertising cookies.

Your analytics choice is remembered in your browser’s `localStorage` (`tlg.analytics-consent`). Before you allow analytics, how you arrived is not sent to Datadog. If you follow a recipe’s save link before choosing, only those five campaign tags already in the page address are copied into the same-origin destination address to preserve attribution; our server receives that address as part of the ordinary navigation. If you allow analytics, the sanitized landing context (the page path, external referrer reduced to its origin and path, and those five campaign tags) is stored for this browser session in `sessionStorage` (`tlg.analytics-landing`) and sent to Datadog. Consented recipe actions waiting for the analytics code may also be stored temporarily in `sessionStorage` (`tlg.analytics-pending-actions`) and are removed after delivery or when you withdraw consent. When you turn analytics off, a one-word note (`tlg.analytics-notice`) is kept in `sessionStorage` only across the page reload, so the confirmation can be shown, and is then deleted. Datadog also keeps an anonymous session identifier in `localStorage` (`_dd_s_v2`). Datadog sets no cookies here.

---

## 4. How We Use Your Information

We use the information we collect to:

- Operate and provide the Tasteslikegood.org service
- Authenticate you via Google Sign-In and maintain secure sessions
- Display your name and profile picture within the application
- Generate AI recipes using Gemini via our server-side API integration
- Save and organize your recipes and cookbooks
- Analyze usage patterns to improve the application
- Detect and prevent fraud, abuse, or security incidents
- Comply with applicable legal obligations

We do **not** use your information to serve you advertisements. We do **not** sell, rent, or share your personal information with third parties for their own marketing purposes.

---

## 5. Google API Services — Limited Use Disclosure

Tasteslikegood.org's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the **Limited Use** requirements.

Specifically:

- We only use Google user data (email, name, profile picture) for the purpose of operating Tasteslikegood.org and providing features directly requested by you
- We do not transfer Google user data to third parties except as necessary to provide the service (e.g., our hosting infrastructure), or as required by law
- We do not use Google user data for serving advertisements
- We do not allow humans to read your Google user data unless you have given express permission, it is necessary for security purposes, or it is required by law
- We do not use Google user data for any purpose not described in this Privacy Policy

---

## 6. Legal Bases for Processing (GDPR / UK GDPR)

Where applicable, we process your personal data on the following legal bases:

- **Contract performance:** Processing necessary to provide the service you have requested
- **Legitimate interests:** Improving the service, maintaining security, and preventing abuse
- **Consent:** Where you have actively provided information (e.g., recipe prompts)
- **Legal compliance:** Where required by applicable law

---

## 7. How We Share Your Information

### 7.1 Google APIs

We use Google OAuth 2.0 for authentication and the Google Gemini API for AI recipe generation. Your authentication tokens are managed securely on our servers. Recipe prompts you submit are sent to the Gemini API — no Google Account personal data (name, email, profile picture) is included in those requests.

### 7.2 Hosting, Infrastructure, and Analytics Providers

Your data is processed on Google Cloud Platform (Cloud Run, Cloud SQL) infrastructure located in the United States (us-central1). Google Cloud acts as a data processor on our behalf under Google's standard data processing terms.

If you allow analytics (section 3.4), the measurements are relayed through our own servers to Datadog, Inc. (United States, US5 region), which acts as a data processor on our behalf under its data processing terms.

### 7.3 No Sale of Personal Data

We do not sell, rent, or trade your personal information to any third party.

### 7.4 Legal Requirements

We may disclose your information if required to do so by law, court order, or government authority, or if we believe in good faith that such disclosure is necessary to protect our rights, your safety, or the safety of others.

---

## 8. Data Retention

We retain your account information (email, name, profile picture) and your saved recipes and cookbooks for as long as your account is active. If you delete your account or request deletion, we will remove your personal data within 30 days, except where retention is required by law.

Guest data stored in your browser's `localStorage` is retained until you clear your browser storage or sign in and migrate it to an account.

---

## 9. Data Security

We implement reasonable technical and organizational measures to protect your personal data, including:

- HTTPS encryption for all data in transit
- Encrypted database storage on Google Cloud SQL
- Session tokens stored server-side with secure, signed cookies
- API keys and secrets managed via Google Secret Manager (never stored in code)

No method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security but are committed to protecting your data using industry-standard practices.

---

## 10. Your Choices and Rights

### 10.1 Access, Update, and Deletion

You may request access to, correction of, or deletion of your personal data at any time by contacting us at <privacy@tasteslikegood.org>. You may also delete your account and all associated data directly within the application.

### 10.2 Revoking Google Access

You may revoke our application's access to your Google Account at any time via your [Google Account Permissions](https://myaccount.google.com/permissions) page. Revoking access will sign you out of Tasteslikegood.org; your saved recipes will be retained unless you also request account deletion.

### 10.3 Analytics Choice

Performance analytics is off unless you allow it. While it is available, an “Analytics choice” button in the site footer lets you change your choice at any time. Turning it off stops the analytics session and reloads the page without the Datadog code. Browser tools that block tracking also prevent it.

### 10.4 GDPR and UK GDPR Rights

If you are located in the European Economic Area or United Kingdom, you have the right to:

- Access the personal data we hold about you
- Correct inaccurate or incomplete data
- Request erasure of your data
- Object to or restrict processing
- Request data portability
- Lodge a complaint with your local data protection authority

### 10.5 CCPA and US State Privacy Rights

If you are a California resident or covered by similar US state privacy laws, you have the right to:

- Know what personal information we collect and how it is used
- Request deletion of your personal information
- Opt out of the sale of your personal information (note: we do not sell personal information)
- Non-discrimination for exercising your privacy rights

To exercise any of these rights, contact us at <privacy@tasteslikegood.org>.

---

## 11. Children's Privacy

Tasteslikegood.org is not directed to children under the age of 13 (or 16 where applicable under local law). We do not knowingly collect personal information from children. If we become aware that a child has provided us with personal information, we will delete it promptly. If you believe a child has provided us with personal information, please contact us at <privacy@tasteslikegood.org>.

---

## 12. International Data Transfers

Tasteslikegood.org is operated from the United States. If you are accessing the service from outside the United States, your data may be transferred to and processed in the United States. We implement appropriate safeguards for international transfers as required by applicable law, including reliance on Google Cloud's data processing terms.

---

## 13. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. When we make material changes, we will notify you via an in-app notice or by updating the "Last updated" date at the top of this page. Your continued use of the service after changes are posted constitutes your acceptance of the updated policy.

---

## 14. Contact Information

For privacy-related questions, requests, or complaints, please contact us:

**Email:** <privacy@tasteslikegood.org>

**Mailing Address:**  
Tasteslikegood.org  
1467 Siskiyou Blvd \#189  
Ashland, OR 97520  
United States

We aim to respond to all privacy inquiries within 30 days.
