

Below are a list of mostly distinct patches/changes/feature updates. Please implement each; if intervention is required you can pause that task, commit your progress if any to the git with the description outlining any neccessary requests or confirmation you need before proceeding.

After completing each task, commit it to the git with a sensible title and description.

After reaching the end of the list, roughly summarize changes and restate any incomplete tasks that require additional intervention. 

---

For the editor panel in the skill tree, it would be easier to have the add edge function seperate to the remove edge function. Please split into two separate modes / buttons. And they need hotkeys to ease the process. Please use 'e' for adding edges and 'r' for removing edges. Esc should exit both modes.

---

There are some leftover references to "character" before we made the more specific terms pawn and leaderPawn. For example I can specifically see lots of use of state.characters, getCharacterById, cmdPlaceCharacter, in the scenario defs characters placed by board column, etc. Perform a clean refactor for all references to character and make it reference 'pawn' or 'leaderPawn' where appropriate. 

---

For an initial pass on skill point gain, I want to attach it to the current population eating mechanic. We will award all leaderPawns skill points at the year end when the population check happens. For initial values 

- 1 skill point for no population change
- 3 skill points for population change
- 2 skill points for population halving

Have these changable in the gamerules-defs.js


---

Implement a "End of the year performance" window popup - it should report on the population change, give a total grain count, a total edibles count, and mention skill points gained. Will do more with the window later but just adding some gamey feedback.  For now it should also just end with "click to close" and we just have any click on the whole screen will close this window. The window will only appear on that tSec on the start of a new year if the player is scrubbing the timeline and just close immediatly if the player is scrubbing past. 

A reference should appear on the event log and clicking the losenge there should open and close the window.
---