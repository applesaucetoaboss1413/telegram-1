I will address the two critical issues by modifying `new_backend/src/bot.js`.

### 1. Fix `/promo` Command (Channel Promotion)
I will update the `bot.command('promo', ...)` handler to meet your specific content requirements:
- **Captions:** Include the cost (points + $) and benefit for each video (5s, 10s, 15s), reusing the logic from the demo menu.
- **Intro Text:** Update to a short hook explaining what demos are.
- **CTA:** Ensure the link is `https://t.me/<bot_username>?start=demo`.
- **Pinning:** Keep the existing logic to pin the intro message.
- **Idempotency:** As requested, this will only trigger when you run `/promo`, avoiding spam on restarts.

### 2. Fix Template Handlers (5s/10s/15s Demo Logic)
The issue with the 5s template not working is likely due to missing session state (`mode`, `duration`, `price`) when the template button is clicked directly. I will update the handlers (`demo_tmpl_5`, `demo_tmpl_10`, `demo_tmpl_15`) to:
- **Explicitly Set State:** Force `ctx.session.mode = 'demo'`, `ctx.session.duration = <5/10/15>`, and `ctx.session.price = <price>` to ensure the flow works even if the previous session state was incomplete.
- **Logging:** Add the requested `DEBUG` logs:
    - `DEBUG: demo_tmpl_5 handler, base_url=...` inside the handler.
    - `DEBUG: starting A2E job for demo_tmpl_5...` inside the photo handler when the job starts.

### 3. Verification
- I will verify the code changes ensure all necessary session variables are set before transitioning to the `awaiting_face` step.
- I will ensure no regressions in the existing webhook or `safeStop` logic.

### 4. Deliverables
- Updated `new_backend/src/bot.js`.
- A summary of how to use `/promo`.
- An explanation of the fixed 5s demo flow.
