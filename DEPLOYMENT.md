# Deployment settings

See README.md for the build, test and Hostinger Node.js deployment steps. Keep all real settings in the hosting environment. Do not commit a real .env file.

Required: NODE_ENV, ADMIN_USERNAME, ADMIN_PASSWORD, DATA_KEY, APP_ORIGIN, DATA_DIR and PHARMACY_ALERT_PHONE. Run one Node process with a private persistent data directory.

Optional SMS: MESSAGE_MODE, TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_SMS_FROM or TWILIO_SMS_SERVICE_SID. Preview mode sends no messages.

Public website files are in dist. Internal code, deployment settings, local-preview helpers and data files must not be copied into public_html on a static server.
