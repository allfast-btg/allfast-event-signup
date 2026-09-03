ALLFAST Clear Test Entries Control

Replace ONLY server.js in GitHub with this server.js.
Do not replace anything in /public.

This adds an admin-only "Clear Test Entries" link.

Safety:
- Requires the existing admin login.
- Shows a separate confirmation page.
- Requires typing exactly: DELETE ALL ENTRIES
- Deletes only rows for the current Tailgate Thursday event.
- Does NOT delete any Constant Contact contacts.

After Render redeploys:
1. Open /admin and log in.
2. Click "Clear Test Entries".
3. Type DELETE ALL ENTRIES.
4. Click the red DELETE ALL ENTRIES button.
5. Return to /admin and confirm the list is empty.

Important:
Use this only now, before live customer entries begin.
