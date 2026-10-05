"use client";

import { useActionState } from "react";
import { ROLE_HINTS, type Profile } from "@/lib/accounts";
import { updateProfile, type ProfileFormState } from "./actions";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** Name, birth year, and "I'm a…" on /account. Email is shown, not edited (changing it is a later feature). */
export function ProfileForm({ profile, email }: { profile: Profile; email: string | null }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(updateProfile, { status: "idle" });
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <span className="block text-sm font-semibold">Email</span>
        <p className="mt-1.5 break-all text-base">{email ?? "—"}</p>
      </div>
      <div>
        <label className="block text-sm font-semibold" htmlFor="profile-name">
          Name
        </label>
        <input id="profile-name" name="display_name" defaultValue={profile.display_name ?? ""} maxLength={80} autoComplete="name" className={`${inputCls} mt-1.5`} placeholder="What should we call you?" />
      </div>
      <div>
        <label className="block text-sm font-semibold" htmlFor="profile-birth-year">
          Birth year
        </label>
        <input
          id="profile-birth-year"
          name="birth_year"
          defaultValue={profile.birth_year ?? ""}
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          required={profile.birth_year === null}
          autoComplete="bday-year"
          className={`${inputCls} mt-1.5`}
          placeholder="YYYY"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-sm font-semibold" htmlFor="profile-role">
          I&apos;m
        </label>
        <select id="profile-role" name="role_hint" defaultValue={profile.role_hint ?? "student"} className={`${inputCls} mt-1.5 sm:max-w-xs`}>
          {ROLE_HINTS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-muted-foreground">Only changes what we suggest first. Everyone can use every tool.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state.status === "saved" && (
          <span className="text-sm font-medium text-muted-foreground" role="status">
            Saved.
          </span>
        )}
        {state.status === "error" && (
          <span className="text-sm font-medium text-destructive" role="alert">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
