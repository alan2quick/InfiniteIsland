---
paths:
  - "public/js/main.js"
---

# Frame pipeline (loads only when you open public/js/main.js)

Everything goes through `tick(dt)` in [public/js/main.js](public/js/main.js), in this order:

1. **Island harvesting hit-stop** scales `dt` briefly on tool impacts. Combat uses `Player.freezePose` and guardian visual pose holds instead; its input, movement and authoritative timers always advance normally. Combat finish slow motion scales only visual poses, particles and camera easing. The day/night clock then advances, updates sky/water/exposure and the campfire night factor, before camera shadow tracking runs.
2. **`players.pollInput(dt)`** turns every device into per-player `actions`, and handles claiming, joins, leaves and the grace period.
3. **Targets:** each active, non-frozen player gets its own nearest interactable via `findNearest(pos, INTERACT_RADIUS)`, stored in the `targets` Map.
   All targets are computed before anyone acts. Nothing gets a target while the feast scene runs.
4. **Act, P1 first:**
   - An open dialog is driven only by its `dialog.owner`.
   - Otherwise, with a target: `getToolAction(held, target)` decides `dig` (`gathering.dig`), `chop` / `break` (`harvest.hit`), or a plain `interactions.interact`.
   - Interact with no target while holding an item calls `items.swing`.
   - Cancel calls `interactions.cancel` (the hop).
   - The pair panel swallows input, and any player's Cancel closes it.
5. **System updates:** `players.update`, `items`, `harvest`, `gathering`, `campfire`, `pickups`, `followCam` (centroid and zoom), `feast` (can override the camera and poses), `questTracker`, player rings and tags, `interactions`, `invBar`, `dialog`, `particles`.
6. **Prompt bubbles** are drawn per player, then the ambient systems run (title, water, props wind, sky, ambient).
