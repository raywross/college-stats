/**
 * The 2025–26 Common Data Set template table, loaded and indexed (lib/cds-sections.ts). For server code, merges, and
 * scripts; client components never import it (the table is ~390 KB): pass them the values they show.
 */
import file from "../data/reference/cds-template-2025-26.json" with { type: "json" };
import { loadTemplate, type TemplateFile, type TemplateTable } from "./cds-sections.ts";

/** loadTemplate checks every code and enum at load, so the cast from JSON's widened strings is guarded. */
export const CDS_TEMPLATE: TemplateTable = loadTemplate(file as TemplateFile);
