// Same as playwright.config.mjs, recording a video of every test (one per state, gate G8).
import base from "./playwright.config.mjs";

export default { ...base, use: { ...base.use, video: "on" } };
