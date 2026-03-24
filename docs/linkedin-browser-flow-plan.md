# LockedIn Browser Flow Fix Plan

## Core Issue

LockedIn was treating LinkedIn messaging too much like a direct app target. The real flow has to be browser-first:

1. Start from the contact's full LinkedIn profile URL.
2. Open that profile in the configured browser.
3. Click the profile's **Message** button.
4. Wait for the compose overlay to appear.
5. Focus the message box, type the message, then click **Send**.

## Repair Prompt

Use this prompt for future maintenance work on the LinkedIn automation:

> Audit LockedIn's LinkedIn messaging flow end to end. Treat the saved `linkedinUrl` as the canonical source of truth, not just the slug. For reminders, open the profile URL and click **Message** so the compose overlay is ready for the user. For scheduled sends, open the profile URL, click **Message**, wait for the overlay, focus the message input, insert the message, and click **Send**. Keep all validation and normalization centered on real LinkedIn profile URLs (`linkedin.com/in/...`), and update UI/docs/tests to match the browser-driven flow.
