// The whole engine: the commerce core plus every extension.
// Import this, not engine.js, anywhere a full world is made, so each world has every record type and tool.
// WHY: extensions add their tools when they are imported; one file keeps the list in one place.
export * from "./engine.js";
import "./comms.js";
import "./events.js";
import "./levers.js";
import "./campaigns.js";
import "./customers.js";
import "./reviews.js";
import "./tasks.js";
import "./knowledge.js";
import "../../simulation/world/extension.js";
import "../../simulation/world/people.js";
import "./suppliers-comms.js";
// WHY TypeScript here: new engine code is TypeScript. Node strips the types; bin/typescript.mjs does it inside node_modules.
import "./activity.ts";
