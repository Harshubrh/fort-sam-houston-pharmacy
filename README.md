# Fort Sam Houston Community Pharmacy website

A responsive pharmacy website with separate Home, Services, About Us, Helpful Answers and private Visit history pages. The design uses white, gray and charcoal. The included Node.js backend supports visit requests, staff decisions, moderated website reviews and optional transactional SMS.

## Features

- Month calendar for preferred visit dates, with unavailable days disabled.
- Numbered, single-choice time slots using pharmacy hours and Central Time.
- Confirmation and mandatory denial reasons in private visitor history.
- Staff inbox and review moderation behind a server-checked login.
- A dated Google Maps rating snapshot and attributed review excerpts, separate from website-submitted feedback.
- Encrypted local storage, session cookies, CSRF/origin checks and request limits.
- Twilio SMS integration; preview mode is enabled by default.

## Project structure

- `dist/`: prepared public pages, scripts, styles and images.
- `source/one-page.html`, `*-components.mjs`, `fort-sam-content.mjs`: page sources.
- `build-detailed-pages.mjs`: builds the five public pages.
- `server.mjs` and `server/`: backend and encrypted storage.
- `business.mjs`: public business information, hours and Google snapshot.
- `test/`: synthetic backend tests with no live SMS delivery.

## Build and test

Use Node.js 22 or later. There are no external runtime packages.

```sh
npm test
npm run build
```

## Hostinger deployment

Deploy the complete repository as a Hostinger Node.js application, with entry file `server.mjs`, build command `npm run build` and start command `npm start`. Static HTML hosting alone does not run the forms, review storage, history or staff panel.

Set hosting variables using `.env.example` as a list of required settings. Configure a unique admin password, a random 32-byte base64 DATA_KEY, the exact HTTPS APP_ORIGIN, a private persistent DATA_DIR outside dist, and the operational PHARMACY_ALERT_PHONE. The operational number belongs in hosting configuration and is not included in this public repository.

Generate a DATA_KEY locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep the key with protected backups; changing it makes existing encrypted data unreadable. Run one Node process for this file-based store. Hostinger supplies PORT. Production requires HTTPS and server configuration before startup.

For local development, set NODE_ENV=development and APP_ORIGIN=http://127.0.0.1:4173, use a local private DATA_DIR and provide your own ADMIN_PASSWORD and DATA_KEY. Variables must be supplied in your shell or an ignored .env file; with a local .env, run `node --env-file=.env server.mjs`.

## Staff access and feedback

Open admin.html and sign in using ADMIN_USERNAME and ADMIN_PASSWORD from your hosting environment. The Helpful Answers shortcut `webxstudio` followed by Reset opens the same sign-in screen and requires fresh authentication.

Website reviews start as Pending. Staff can Publish, Hide or withhold them using the same privacy and relevance criteria for every star rating. Website reviews do not post to Google. The Google Maps snapshot is dated and must be maintained manually.

## SMS and private data

MESSAGE_MODE=preview prepares messages without sending them. Enable live delivery only after configuring the Twilio environment variables and a valid operational alert destination. The reserved example number used in local tests is not a real alert recipient. No messaging provider credentials, visitor records, review submissions or encryption keys are included.

The visit form collects general scheduling information; prescription activation and medical information belong in the pharmacy's official channels. Existing records must remain in the hosting provider's private persistent directory and outside Git.

## Current content

Business details and the dated 4.4/5 Google rating from 56 reviews were checked against the supplied [Google Maps listing](https://maps.app.goo.gl/6uJzSpausbuC3S4u5). The charcoal wordmark is a design asset, and the supplied interior photos are illustrative. Confirm branch operating details before production launch.
