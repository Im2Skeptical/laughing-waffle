---

Tree editor QOL

I want to do a pass on the tree editor improving several points to improve its use. Please implement each; if intervention is required you can pause that task, commit your progress if any to the git with the description outlining any neccessary requests or confirmation you need before proceeding.

After completing each task, commit it to the git with a sensible title and description.

After reaching the end of the list, roughly summarize changes and restate any incomplete tasks that require additional intervention.

---

Mermory issues - Currently if I work in the skill tree for a few minutes the memory use of the browser will slowly increase and then the tab containing the game will become unresponsive. Please investigate

---

Quick Tags - There should be some feature to quickly view/assign/remove commonly used tags on existing nodes or when creating new ones. The rough design should be some 'QuickTag' panel with a list of items you can click on and off. The items contained need to at minimum be

- colors (Black, Green, Blue, Red)
- Early, Mid, Late
- Hybrid
- Notable

There should be a clear on and off state for each quick tag item. Perhaps each is a box with a label and the background/text changes color when on or off and each acts as a toggle push button you click to turn on or off. Go with whatever seems semsible.

When you select an existing node these options in the quick tag panel will reflect what tags are attached. You should be able to use the items in the quick tag panel to quickly add and remove tags.

There should also be a create 'QuickNode' button. This will create a node based on items in the QuickTag panel. The idea is you should be able to select an existing node - which then has the items clearly show which tags are being used by that node - then be able to press the QuickNode button and you create a node with those tags. 

By default the QuickNode created can automatically assign an id that iterates on the id of the node who's tags were last read by the panel. So if I selected node with id "BlackBlueEarly_02" it will autogenerate the next id not yet taken (for example if there is BlackBlueEarly_03 and BlackBlueEarly_04 already it will pick BlackBlueEarly_05).
 
With these features we should be able to easily view a node's tags, edit those tags, and create nodes based on the tags of other nodes. 

As part of this stage you will need to do some work on the layout of the sidepanel - attached to the prompt is a picture of the current state of the info on the right hand side. Please lay things out a bit more neatly when making space for this. You will need to add some kind of system to hide/collapse features together as sensible - like having expandable/colaspable buttons or drawers to keep all the import/export/ settings together seperated from edit/information/save etc.

---

Although not exactly 'tags' - The Quicktag panel should also contain a similar way to see, change, and transfer ringId settings. But because tags are more like 'enums' and ringId is more like an 'array' loosly speaking, we want to treat ringId differently, perhaps an option from a dropdown or anything else more sensible. 

---

Currently the fallback for Auto Layout if information is missing from a single node is to use some other method rather than the ring method. I would rather this fallback be deprecated and cleanly removed, and we handle missing node cases in some simpler dumb way; if possible just ring sorting all other nodes and having the missing nodes all just act as 'pinned' where they get left alone/ or stack in some arbitrary empty space.

---

The 'e' and 'r' add and remove edge modes should toggle , so that the hotkey both enters and exits the mode.

--

 Exiting the 'e' and 'r' add and remove edge modes should deselect nodes 

---



