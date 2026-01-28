Below are a list of mostly distinct patches/changes/feature updates. Please implement each; if intervention is required you can pause that task - commit your progress if any to the git with the description outlining any neccessary requests or confirmation you need before proceeding.

After completing each task, commit it to the git with a sensible title and description.

After reaching the end of the list, roughly summarize changes and restate any incomplete tasks that require additional intervention.

1.
Hub structure seems to only activates it's rest intent on the 1st position of the span and not the entire structure. So for detail the hearth hubStructure which is span 2 has 2 occupancy positions, and the one on the left a pawn will regain stamina but positioned on the right will not. Ideally a span 2 structure should only really have 1 space that pawns sit in and fan over - so implementation of this may resolve the issue.

2.
I can see some empty migration style shim scripts - specifically I think theres some inventory stuff floating around item-passives.js. please correct this and similar style redundant/out of date code

3.
If you don't have AP for an action we need to flash the entire action log red similar to the other feedback flashes we give, as well as the little AP counter box which will flash a little longer than the other flashes.

4.
Implement pause on start of character drag, inventory actions (movement/transfer/drag/split), select crop - basically everything in the action log. The players action may have to queue in some fashion as we often 'ride to the next tSec' - but it should feel to the player if I make a drag action while as the simulation plays, even very quickly, I can see the game pause as soon as able and my action input gets recorded sensibly if I had the valid resources to do so. Of course if it rides to the next tSec and all of a sudden the player lacks the capacity for that action we will block it. We need to be careful not to block toggle actions that show things like inventories

5.
Add a button on the bottom of the action log that resets the tSec of player actions. The button should also have a hotkey z to clear the action log and reset tSec - can show the hotkey in the buttons tooltip.

6.
Intents/tags need to be made visible and interactable on hubStructures in the same fashion as envTiles.

7.
Implement rudimentary save/load system. Should be able to at minimum quicksave and load - can use the debug menu for interaction with some rudimentary buttons. No need for a ui or file browsing - just 3 slots for saving and the ability to load them from different boots of the 'same enough' version of the game. Minimal sensible metadata attached to the save. Leave room to expand this system later.

---
end list