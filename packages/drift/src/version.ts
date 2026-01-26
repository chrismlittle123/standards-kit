import { createRequire } from "module";
import { z } from "zod";

/**
 * Schema for validating package.json structure
 */
const packageJsonSchema = z.object({
  version: z.string(),
});

const require = createRequire(import.meta.url);
const rawPkg: unknown = require("../package.json");
const pkg = packageJsonSchema.parse(rawPkg);

export const version: string = pkg.version;
