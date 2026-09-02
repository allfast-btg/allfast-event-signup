ALLFAST Admin Login Fix V2

Replace ONLY server.js in GitHub with the server.js in this ZIP.
Do not replace anything in /public.

This corrected version:
- adds /admin/status
- adds a real /admin login form
- stores the successful admin login in a secure cookie
- removes the need to put the admin password in admin links
- enforces Phone as required on the server, matching the V5 form

After Render says Live:
1. Open https://allfast-event-signup.onrender.com/admin/status
2. Confirm adminPasswordConfigured is true
3. Open https://allfast-event-signup.onrender.com/admin
4. Enter the ADMIN_PASSWORD value from Render
