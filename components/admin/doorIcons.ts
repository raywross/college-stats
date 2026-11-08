import { Database, Ellipsis, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import type { AdminDoorKey } from "@/lib/admin/console";

/** Each door's icon, the same in the rail, the tab bar, and the landing pages. */
export const DOOR_ICONS: Readonly<Record<AdminDoorKey, LucideIcon>> = { steward: ShieldCheck, people: Users, data: Database, more: Ellipsis };
