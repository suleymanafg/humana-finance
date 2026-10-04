// Loads the full raw dataset and runs the calculation engine once per request.
// Every page derives its figures from this single server-side computation.
import { cache } from "react";
import { prisma } from "./db";
import { compute } from "./engine/compute";
import { buildDataset } from "./dataset";

export const loadDataset = cache(() => buildDataset(prisma));

export const getComputed = cache(async () => {
  const dataset = await loadDataset();
  return { dataset, computed: compute(dataset) };
});
