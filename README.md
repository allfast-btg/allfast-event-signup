# ALLFAST Event Signup

Reusable event signup + prize-drawing app for ALLFAST Supply.

## What it does

- 1 base entry for joining the ALLFAST email list.
- +1 self-reported bonus entry for following ALLFAST on Facebook.
- +1 self-reported bonus entry for following ALLFAST on Instagram.
- Google review button is intentionally separate from the drawing.
- One signup per email address per event.
- Admin page shows all entries.
- CSV export for email marketing follow-up.
- Weighted random drawing endpoint.

## Deploy on Render

### Easiest: Blueprint

1. Put these files in a GitHub repository.
2. In Render, choose **New > Blueprint**.
3. Connect the repository.
4. Render will create:
   - a Node web service
   - a PostgreSQL database
5. Deploy.

After deployment, add this environment variable to the web service:

`PUBLIC_URL=https://YOUR-RENDER-URL.onrender.com`

Or, after adding your custom domain:

`PUBLIC_URL=https://allfastsupply.com/win`

## Admin

The Render Blueprint automatically generates `ADMIN_PASSWORD`.

Open:

`https://YOUR-SITE/admin?key=YOUR_ADMIN_PASSWORD`

CSV export is linked from the admin page.

To draw a random winner, open:

`https://YOUR-SITE/admin/draw?key=YOUR_ADMIN_PASSWORD`

The draw is weighted by each customer's total number of entries.

## Recommended custom URL

A memorable permanent address is better than changing QR codes every event:

`https://allfastsupply.com/win`

Point that URL to this app or redirect it to the current deployed event page.

## QR code

Do NOT print the permanent QR until the final public URL is live.

For tomorrow, once the Render URL is live, create the QR from that exact URL. If you later use
`allfastsupply.com/win`, make the permanent signage QR point there.

## Reuse for future events

Change these environment variables in Render:

- `EVENT_SLUG`
- `EVENT_NAME`
- `EVENT_DATE`

Use a new unique EVENT_SLUG for each event. Existing entries remain in the database.

## Important promotion note

The Google review link is not connected to drawing entries. This intentionally avoids incentivizing Google reviews.
