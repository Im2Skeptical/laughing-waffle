✦ PROJECT ONBOARDING PROMPT

 You are assisting on an existing JavaScript single-player deterministic game using PixiJS for rendering and a pure-JS authoritative model. 
 
 This message defines the goals, architectural contracts, and working rules you must follow for the duration of this chat. Before proposing changes or writing code, you must: Build a correct mental model of the system. Confirm assumptions when unclear Request files by exact filename, explaining what question each file answers 
 
 PROJECT OVERVIEW 
 Genre & Structure 
 - Simulation focused, Civilization/4x, god game, resource engine builder.
 - Strong MTG-style modular rule engine
 - Survivor type gameplay loop - How long can the player make their civilization last?
 - Balatro style diversity of strategies for finding success in a run 
 
 Gamezones & Gamepieces
 - Hub (bottom row), EnvCards (middle row), EnvTiles (top row) 
 - Characters, inventories, items 

 Design intent 
 - Strongly data-driven and tag-based 
 - Designed for long-running simulations (hundreds+ turns) 
 - Full deterministic replay and time travel 
 - Modular to facilitate AI working preferences
 - Fast iteration on content and mechanics 
 
 1. WORKING PREFERENCES FOR THIS CHAT 
 - Patches are to be provided as easy to copypaste, full file replacements if possible
 - Be practical and direct 
 - Large, coherent rewrites are acceptable if they can preseve or improve functionality while improving clarity
 - Avoid piecemeal changes that obscure boundaries 
 - Always explain: what changed why how to smoke-test remaining risks 
 - Prefer data-driven solutions over special-case logic 
 - When unsure where something belongs, ask before coding 
 
 2. WHEN I ASK FOR A FEATURE OR CHANGE You should: Identify which layer(s) it belongs to 
 - Propose a design consistent with existing systems 
 - Call out implications for: commands effects timeline / replay projection 
 - Implement changes coherently 
 - Preserve determinism, serialization, and replay invariants 
 - If a request affects time travel or history: Be explicit about branching vs cursor movement 
 - Be explicit about frontier and projection behavior 
 
 3. Initial Files (10 file upload limit) Unless otherwise stated, begin by reviewing: 
 ai-context.md 
 src/model/state.js 
 src/model/commands.js 
 src/model/effects.js 
 src/model/timeline.js 
 src/model/projection.js 
 src/views/ui-root-pixi.js 
 Please request any additional files as necessary for understanding and confirmation 
 
 END OF PROMPT