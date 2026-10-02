/**
 * U.S. states, DC, and the territories, keyed by FIPS code: the codes IPEDS uses for where students come from
 * (EF part C `EFCSTATE`; specs/data-expansion/residence.md). Pure module, safe on the client.
 */
export interface StateInfo {
  fips: number;
  /** USPS code, e.g. "TN". */
  postal: string;
  name: string;
  /** One of the 50 states or DC (false for the territories). */
  state: boolean;
}

const LIST: readonly [number, string, string][] = [
  [1, "AL", "Alabama"], [2, "AK", "Alaska"], [4, "AZ", "Arizona"], [5, "AR", "Arkansas"], [6, "CA", "California"],
  [8, "CO", "Colorado"], [9, "CT", "Connecticut"], [10, "DE", "Delaware"], [11, "DC", "District of Columbia"],
  [12, "FL", "Florida"], [13, "GA", "Georgia"], [15, "HI", "Hawaii"], [16, "ID", "Idaho"], [17, "IL", "Illinois"],
  [18, "IN", "Indiana"], [19, "IA", "Iowa"], [20, "KS", "Kansas"], [21, "KY", "Kentucky"], [22, "LA", "Louisiana"],
  [23, "ME", "Maine"], [24, "MD", "Maryland"], [25, "MA", "Massachusetts"], [26, "MI", "Michigan"],
  [27, "MN", "Minnesota"], [28, "MS", "Mississippi"], [29, "MO", "Missouri"], [30, "MT", "Montana"],
  [31, "NE", "Nebraska"], [32, "NV", "Nevada"], [33, "NH", "New Hampshire"], [34, "NJ", "New Jersey"],
  [35, "NM", "New Mexico"], [36, "NY", "New York"], [37, "NC", "North Carolina"], [38, "ND", "North Dakota"],
  [39, "OH", "Ohio"], [40, "OK", "Oklahoma"], [41, "OR", "Oregon"], [42, "PA", "Pennsylvania"],
  [44, "RI", "Rhode Island"], [45, "SC", "South Carolina"], [46, "SD", "South Dakota"], [47, "TN", "Tennessee"],
  [48, "TX", "Texas"], [49, "UT", "Utah"], [50, "VT", "Vermont"], [51, "VA", "Virginia"], [53, "WA", "Washington"],
  [54, "WV", "West Virginia"], [55, "WI", "Wisconsin"], [56, "WY", "Wyoming"],
  [60, "AS", "American Samoa"], [64, "FM", "Federated States of Micronesia"], [66, "GU", "Guam"],
  [68, "MH", "Marshall Islands"], [69, "MP", "Northern Mariana Islands"], [70, "PW", "Palau"], [72, "PR", "Puerto Rico"],
  [78, "VI", "U.S. Virgin Islands"],
];

export const STATES: ReadonlyMap<number, StateInfo> = new Map(LIST.map(([fips, postal, name]) => [fips, { fips, postal, name, state: fips <= 56 }]));
const BY_POSTAL = new Map([...STATES.values()].map((s) => [s.postal, s]));

export function stateByFips(fips: number | string): StateInfo | null {
  return STATES.get(Number(fips)) ?? null;
}

export function stateByPostal(postal: string): StateInfo | null {
  return BY_POSTAL.get(postal.toUpperCase()) ?? null;
}

/** "Tennessee"; the code itself when unknown. */
export function stateName(postal: string): string {
  return stateByPostal(postal)?.name ?? postal;
}
