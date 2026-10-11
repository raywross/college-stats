"use client";

import { useSyncExternalStore } from "react";
import { LOCAL_PROFILE_KEY, emptyProfile, sanitizeProfile, type StudentProfileData } from "@/lib/student-profile";

/**
 * Signed-out profile storage (student-profile.md "Behavior"): one JSON document in localStorage, wrapped so a
 * blocked or corrupt store never crashes the form. Mirrors lib/compare.ts's pattern (useSyncExternalStore, a
 * custom event for same-tab updates, "storage" for cross-tab) rather than useState+useEffect, so there's no
 * server/client mismatch and no setState-in-effect.
 */
const KEY = LOCAL_PROFILE_KEY;
const EVENT = "student-profile-updated";
const IMPORTED_FLAG_KEY = "student-profile-imported";

/** One empty profile for every "nothing stored" answer: useSyncExternalStore needs the same object each call, or
 *  React warns of an infinite loop (seen on the signed-out /plan, 2026-10-10). */
const EMPTY: StudentProfileData = emptyProfile();
const emptySnapshot = (): StudentProfileData => EMPTY;

let cache: { raw: string | null; data: StudentProfileData } = { raw: null, data: EMPTY };

function read(): StudentProfileData {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.data;
  let data: StudentProfileData;
  try {
    data = sanitizeProfile(raw ? JSON.parse(raw) : null);
  } catch {
    data = emptyProfile();
  }
  cache = { raw, data };
  return data;
}

function write(data: StudentProfileData) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private browsing or a full quota: the form still works for the session, it just won't persist.
  }
  window.dispatchEvent(new Event(EVENT));
}

function isEmpty(data: StudentProfileData): boolean {
  return JSON.stringify(data) === JSON.stringify(emptyProfile());
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function getLocalProfile(): StudentProfileData {
  return read();
}

export function setLocalProfile(data: StudentProfileData) {
  write(data);
}

/** The signed-out profile, and whether it holds anything worth offering to import. */
export function useLocalProfile(): { data: StudentProfileData; save: (next: StudentProfileData) => void; hasAnyLocalData: boolean } {
  const data = useSyncExternalStore(subscribe, read, emptySnapshot);
  return { data, save: write, hasAnyLocalData: !isEmpty(data) };
}

function offeredRaw(): boolean {
  if (typeof window === "undefined") return true; // server render: nothing to offer yet
  try {
    return window.localStorage.getItem(IMPORTED_FLAG_KEY) === "1";
  } catch {
    return true; // can't tell; err toward not nagging
  }
}

/**
 * Whether to show the one-time import offer right now: there's local data worth keeping, and it hasn't been
 * shown before. Reads through useSyncExternalStore (not plain state) so the server-rendered markup and the
 * client's first render agree — no hydration mismatch, no setState-in-effect.
 */
export function useShouldOfferImport(): boolean {
  const hasData = useSyncExternalStore(subscribe, () => !isEmpty(read()), () => false);
  const offered = useSyncExternalStore(subscribe, offeredRaw, () => true);
  return hasData && !offered;
}

export function markImportOffered() {
  try {
    window.localStorage.setItem(IMPORTED_FLAG_KEY, "1");
  } catch {
    // ignore
  }
}

export function clearLocalProfile() {
  try {
    window.localStorage.removeItem(LOCAL_PROFILE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}
