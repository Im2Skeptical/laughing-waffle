Below are a list of mostly distinct patches/changes/feature updates. Please implement each; if intervention is required you can pause that task, commit your progress if any to the git with the description outlining any neccessary requests or confirmation you need before proceeding.

After completing each task, commit it to the git with a sensible title and description.

After reaching the end of the list, roughly summarize changes and restate any incomplete tasks that require additional intervention. 

---

I would like to address how rotChancePerSec currently works.

rotChancePerSec needs to be declared/attached with the tag perishable
and not a property of the item itself.

The perishability system tier needs to modify/multiply the base rotChancePerSec, bronze giving the highest rot chance and diamond giving the lowest. 

For now the base rotChancePerSec can exist as a single number acting as the base number for the perisiable tag to work off defined in gamerules-defs.  

---

By default, when we create gamepieces of a certain tier they should have their systems created at that tier. So a silver 'barley' item should have silver 'perishability', a silver 'storehouse' hubStructure should have silver 'distribution', etc. 

---

Rename 'crop' item tag with 'seed' making sure keeping all the previous functionality around selecting crop for planting. I think this will provide better support for future crops that may not have the output the same as the seed.

---

I would like to assess the state of depositing grain in the granary and how it handles perishability. This is distinct from its 'inventory', rather instead we are talking about the systems value holding the grain as a number. Do these system values reference any concept of perishability at the moment? 

If not please have them roll as if they were items. The rot when created will need to be added to a separate system pool. This behaviour needs to be maintained where all perishable items are stored as system pools, so storehouse and all future buildings that might host perishable items as system pools will need to operate with the same fucntionality. 

---

Granary hubStructure needs to improve the rot chance for items stored inside. We will do this using the tier system; using a passive on the structure tied to a tag called 'canPreserve' that upgrades the perishability of system pool stored grain by one tier

---

We need to expand the functionality of the distributor tags / or at least how pawns can use it. The design goal is for pawns to be able to satisfy eating intents from a storehouse that is a distributor and that contains edible items. They could do this as long as they stay in range of the disributor. To provide extra clarity, at the moment that means they would also be able to eat from a granary, however it is my intention that wheat not and barley not be edible without processing, however i am keeping them edible for dev purposes for now.


---