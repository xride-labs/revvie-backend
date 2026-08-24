/**
 * Generated validation matrix for every exported zod schema.
 *
 * The cases themselves are produced by src/testing/zodMatrix.ts — see the
 * engine header for how positive/negative/missing/wrong-blob classes are
 * derived. Any field added to any schema automatically gains full coverage
 * here without touching this file.
 */

import * as coreSchemas from "./schemas.js";
import * as chatSchemas from "./chat.schemas.js";
import { runModuleMatrix } from "../testing/zodMatrix.js";

runModuleMatrix("validators/schemas", coreSchemas);
runModuleMatrix("validators/chat.schemas", chatSchemas);
