import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { McpToolDefinition, ToolContext } from "../types.js";

export const searchBikeSpecsSchema = z.object({
  query: z.string().min(1).describe("Motorcycle model name or manufacturer (e.g. 'Himalayan 450', 'Duke 390')"),
});

export async function searchBikeSpecsHandler(args: z.infer<typeof searchBikeSpecsSchema>, _context: ToolContext) {
  const q = args.query.trim();
  const bikes = await prisma.bikeModel.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { manufacturer: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    include: { manufacturer: true },
    take: 5,
  });

  return {
    success: true,
    results: bikes.map((b) => ({
      id: b.id,
      make: b.manufacturer.name,
      model: b.name,
      category: b.category,
      displacementCc: b.engineCc,
      startYear: b.startYear,
      endYear: b.endYear,
    })),
  };
}

export const searchBikeSpecsTool: McpToolDefinition<typeof searchBikeSpecsSchema> = {
  name: "search_bike_specs",
  description: "Search category and engine displacement for motorcycle models",
  schema: searchBikeSpecsSchema,
  handler: searchBikeSpecsHandler,
};
