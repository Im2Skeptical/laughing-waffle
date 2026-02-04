
When I spawn followerPawns when a leader is occupying an envTile it often does a strange thing where the followerPawn will spawn in a hubTile. Please investigate

---

We need a way for the player to discard items. Please provide a little bin button/icon next to any inventory that you can drag items onto. Doing so will delete the item. 

---

We should be able to drag items onto a gamepiece and it will put it in the gamepieces inventory if there is space. If no space we pop up that inventory if invisible and do the flash red the inventory that is too full to accept item user feedback.

---

We need some extra feedback in the UI for performing actions/action intents. When you drag an inventory item or pawn, it should show a 'ghost' version of the actionlog entry inside the actionlog. When you release and the the action succeeds you see it confirm (probably a flash green flash that fades quickly).


Also when you attempt to perform a action intent that doesn't have a drag stage but has an action log entry, eg.  select crop, we can play the same green confirmation animation as it succeeds.

However for cases where we don't succeed such as we dont have the sufficent ap; we should also show the ghost action but it will quickly flash a red overlay and then 'drop off'.

The intent of this design is to both show the player where their corresponding actions are recorded and also indicate the costs of things without that number always present on screen; instead appearing in a eyecatching way when relevant.

---

We need to be able to turn off a tag , the player needs the freedom to be able to not do an action on a space if they do not want to. Each tag needs a toggle switch somewhere, probably a button/switch inside the tag lozenge on the left, and it toggles the tag on or off.

---


In implementing more sophistication for the UI, we need at least 4 states for our tags. Each needs to be visually distinguishable.

- "Currently Active" - default expanded and highest contrast, also probably slightly bigger

Note that because multiple pawns can be operating different tags depending on costs and requirements, more that one tag might show the "currently active" state. 

- "Highest priority but inactive" - default minimized but medium contrast

- "Lower than highest priority"- default minimized but lowest contrast - similar theme but paler version of highest priority

- "Bypassed" - due to player toggled it off / insufficient costs/ not meeting requirements/ events disabling it / - but show as different colour
 - probably slightly red.


---