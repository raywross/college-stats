/**
 * The Data API's terms (specs/product/data-api.md "Terms"): the list /developers prints and the one line the key form
 * shows ("By making a key you agree…"). One place, so the two never differ. Pure module.
 */

/** The attribution line, with the dataset's retrieval date where the caller has it. */
export function attributionLine(retrieved?: string): string {
  return `Data: Quad, from College Scorecard and IPEDS${retrieved ? `, ${retrieved}` : ""}`;
}

export interface ApiTerm {
  /** Short label, bold in the list. */
  title: string;
  body: string;
}

export const API_TERMS: readonly ApiTerm[] = [
  {
    title: "Attribution",
    body: "Federal data is public domain. The derived values and the schema are Quad's, and you may use them with credit. Credit looks like this: “Data: Quad, from College Scorecard and IPEDS, and the date the data was retrieved.”",
  },
  {
    title: "Colleges' own figures",
    body: "Common Data Set and other college-reported values are the colleges' own publications. The API passes them along with their source and year, and you take on the same duty to cite them.",
  },
  {
    title: "No reselling, no lead generation",
    body: "Don't resell the data as a dataset, don't use it to generate leads that target students, and don't work around the limits.",
  },
  {
    title: "Keys are personal",
    body: "Don't share a key. If one leaks, revoke it and make another.",
  },
];

/** The one line above the Create button. */
export const TERMS_LINE =
  "By making a key you agree to the terms: credit Quad when you publish what you find, don't resell the data or use it to generate leads from students, and keep your key to yourself.";
