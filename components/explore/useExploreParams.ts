"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Read and update Explore's URL state without scrolling to top. */
export function useExploreParams() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const update = useCallback(
    (changes: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page"); // any change to the result set starts over at page 1
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.push(qs ? `/explore?${qs}` : "/explore", { scroll: false });
    },
    [router, searchParams]
  );

  const getList = useCallback(
    (key: string) => searchParams.get(key)?.split(",").filter(Boolean) ?? [],
    [searchParams]
  );

  const toggleInList = useCallback(
    (key: string, value: string) => {
      const current = getList(key);
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      update({ [key]: next.length ? next.join(",") : null });
    },
    [getList, update]
  );

  return { searchParams, update, getList, toggleInList };
}
