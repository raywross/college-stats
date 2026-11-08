import { Fields, KeyValues } from "@/components/admin/Panel";
import type { RecordFields } from "@/lib/admin/record-words";

/**
 * Renders a `lib/admin/record-words.ts` formatter's result: its known fields as plain `<Fields>`, with whatever it
 * didn't know under `<details>Details</details>` (specs/product/admin-redesign.md "People": "Plain fields" — a
 * `KeyValues` dump stays only inside Details). `empty` shows when there are no known fields at all.
 */
export function RecordFieldsView({ fields, details, empty }: RecordFields & { empty?: string }) {
  const hasDetails = Object.keys(details).length > 0;
  return (
    <div className="space-y-2">
      {fields.length > 0 ? <Fields items={fields} /> : empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      {hasDetails && (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Details</summary>
          <div className="mt-2">
            <KeyValues data={details} />
          </div>
        </details>
      )}
    </div>
  );
}
