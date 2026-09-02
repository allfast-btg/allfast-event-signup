ALLFAST Duplicate Entry Fix

Replace ONLY server.js in GitHub with the server.js in this ZIP.
Leave the public folder exactly as it is.

This fixes duplicate entries correctly:
- The first signup is saved normally.
- A second signup using the same email for this event is rejected.
- The original name, phone, social selections, entry count, and Constant Contact status are NOT changed.
- The duplicate receives a clear message instead of "You're in!":
  "You're already entered! We already have an entry for this email address for today's drawing. Only one signup per email address is permitted."

After Render redeploys:
1. Submit an email address that is already in Admin.
2. Confirm the duplicate message appears.
3. Refresh Admin and confirm the original record and entry count are unchanged.
